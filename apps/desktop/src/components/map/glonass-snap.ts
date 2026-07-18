/**
 * Выравнивание ГЛОНАСС-данных к карте (ТЗ 2026-07-09/10): сырой GPS кривой —
 * фикс может пройти рядом с дорогой «сквозь здание» или около развилки. Поэтому
 * позиции машин и треки ПРИКРЕПЛЯЕМ выравниванием:
 *   • рядом наша ТОЧКА-пин (≤ 12 м) → машина «стоит у точки»: ставим в 2.5 м от
 *     пина, точка приоритетнее дороги;
 *   • рядом наша ДОРОГА → сажаем на линию дороги;
 *   • история/след строятся не как набор ближайших точек, а как map matching:
 *     берём несколько кандидатов дороги и держим инерцию текущей линии, чтобы
 *     короткие ответвления не давали «заезд вправо-назад-вперёд».
 *
 * Выравнивание — слой ПРЕДСТАВЛЕНИЯ: сырые данные не переписываются.
 */

import { distanceMeters, latLngToMeters, nearestPointOnPolyline, type XYMeters } from './geo';
import { getRoadGraph, roadGeometryVersion, roadGraphDistance, roadGraphPath, type RoadGraph, type RoadGraphHitEntry } from './road-graph';
import { computeFastestRoute } from './route-network';
import type { LatLng, MapPoint, MapRoad } from './map-types';

export const GLONASS_ROAD_SNAP_METERS = 46;
export const GLONASS_POINT_SNAP_METERS = 12;
export const GLONASS_POINT_STANDOFF_METERS = 2.5;
export const GLONASS_TRACK_BREAK_METERS = 700;
export const GLONASS_TRACK_MIN_GAP_METERS = 2;
const GLONASS_TRACK_ROUTE_FILL_METERS = 5;   // порог: короткие шаги на углах тоже ведём по дороге, но не роутим совсем крошечные
const GLONASS_TRACK_ROUTE_FILL_MAX_POINTS = 1400;
const GLONASS_TRACK_ROUTE_FILL_MAX_CONNECTIONS = 2000;
// Фоллбэк ПОЛНЫМ маршрутизатором (без CAP) — только когда сам шаг GPS длинный
// (редкие фиксы, легитимный объезд). На коротком шаге «путь по графу не нашёлся»
// означает локальный разрыв сети (стёрли/перерисовали дорогу) — честный разрыв
// следа, а не 150-метровый «мусорный» объезд, где машина не ехала.
const GLONASS_FALLBACK_ROUTE_MIN_RAW_METERS = 120;
const GLONASS_MATCH_CANDIDATES = 9;
const GLONASS_ROAD_SWITCH_PENALTY = 138;
const GLONASS_HEADING_SOFT_DEG = 20;
const GLONASS_HEADING_COST_PER_DEG = 1.35;
const GLONASS_HEADING_HARD_DEG = 68;
const GLONASS_HEADING_HARD_PENALTY = 95;
const GLONASS_SHORT_RAW_LOOP_METERS = 36;
const GLONASS_SHORT_RAW_LOOP_PENALTY = 220;
const GLONASS_TIMED_TRANSITION_MAX_GAP_MS = 90_000;
const GLONASS_TIMED_TRANSITION_FACTOR = 1.5;
const GLONASS_TIMED_TRANSITION_BUFFER_METERS = 12;
const GLONASS_TIMED_TRANSITION_MIN_METERS = 30;
const GLONASS_TIMED_TRANSITION_PENALTY = 180;
const GLONASS_SHORT_ROAD_EXCURSION_POINTS = 9;
const GLONASS_SHORT_ROAD_EXCURSION_RAW_METERS = 145;
const GLONASS_SHORT_ROAD_EXCURSION_MAX_SNAP_METERS = 30;
const GLONASS_SHORT_ROAD_EXCURSION_MIN_EXCESS_METERS = 55;
const GLONASS_SHORT_ROAD_EXCURSION_MIN_IMPROVEMENT_METERS = 35;

// Финальная зачистка «соплей» — тонких диагональных отростков, где след выскочил
// вбок и вернулся (одиночный мисматч матчинга у развилки / самопересечения жёлтой
// дороги). Режем вершину, только если путь через неё — резкий крюк «туда-обратно»
// на КОРОТКОМ плече. Плавный поворот дороги (крюк почти отсутствует) и настоящий
// длинный съезд (длинное плечо) не трогаем — чтобы след шёл чётко по дороге.
const GLONASS_SPUR_MAX_DETOUR_METERS = 46;   // длиннее — это уже съезд, не «сопля»
const GLONASS_SPUR_DETOUR_RATIO = 1.7;       // крюк должен быть заметно длиннее хорды

// «Треугольники» на развороте: машина уехала и вернулась, а матчер на 1–2 фикса
// заскочил на соседнюю ветку развилки — след сам себя пересекает маленькой петлёй.
// Такую петлю (короткую, с реальным поперечным пересечением) вырезаем целиком:
// проезд «туда-обратно по той же дороге» петли не образует (линии накладываются,
// а не пересекаются) и остаётся как есть.
const GLONASS_CROSS_LOOP_MAX_METERS = 220;   // длиннее — реальный объезд, не артефакт
const GLONASS_CROSS_LOOP_WINDOW = 22;        // ищем пересечение только в коротком окне

// Прямой «мостик» между посадками на РАЗНЫХ дорогах — источник диагональных
// соплей у развилок (обе дороги рядом, диагональ проходит проверку «вдоль
// дороги»). Перекрёстки теперь есть в графе (разрезы сегментов), поэтому переход
// между дорогами ВСЕГДА возможен по сети — прямую оставляем только «вплотную».

// «Вне дороги» как явное состояние HMM (Newson–Krumm с off-road-стейтом): машина
// МОЖЕТ сойти с нарисованной дороги, если GPS уверенно и СВЯЗНО ведёт в сторону
// (карман / круговой объезд). Тюнинг живьём — это две ручки:
//   • EMISSION = «насколько далеко» надо отъехать, чтобы жаться к следу, а не к
//     дороге (порог ≈ EMISSION / 2.6 метров; 70 ≈ 27 м);
//   • ENTER/EXIT = «насколько надолго» — одиночный прыжок съезд не окупает, длинный
//     реальный объезд окупается и рисуется по сырому следу.
// ТЗ 2026-07-11 «дорога — истина»: данные GPS прыгают, но по движению понятно,
// что машина едет ПО дороге → в радиусе захвата дорога побеждает практически
// всегда (порог ≈ 46 м = радиус захвата). Off-road остаётся только для мест,
// где нарисованной дороги реально нет.
const GLONASS_OFFROAD_EMISSION = 145;       // порог ≈ 46 м: в радиусе захвата — дорога (145: магнит сильнее, ТЗ 2026-07-12)
const GLONASS_OFFROAD_ENTER = 60;
const GLONASS_OFFROAD_EXIT = 60;
const GLONASS_OFFROAD_MIN_RUN = 6;          // «несколько связных фиксов»: короче — не съезд, а шум → назад на дорогу
const GLONASS_OFFROAD_MAX_STEP_METERS = 48; // дальше — разрыв, а не ложный мост через здание

// Деспайк ДО матчинга: одиночный фикс-выброс (прыжок «туда-обратно» через здание)
// исключаем. Карман — это НЕСКОЛЬКО связных фиксов, его не трогаем; спайк — ОДНА
// точка, после удаления которой след возвращается к тренду.
const GLONASS_DESPIKE_MIN_METERS = 26;
const GLONASS_DESPIKE_RATIO = 3.4;

const GLONASS_REPLAY_DENSE_STEP_METERS = 7;
const GLONASS_REPLAY_DENSE_STEP_MS = 2500;
const GLONASS_REPLAY_MAX_POINTS = 12_000;

// Защитная диагностика матчинга (ТЗ 2026-07-11): в консоли DevTools выполнить
// `localStorage.setItem('pyn-map-matching-debug', '1')` — начнут логироваться
// пары посадок, между которыми НЕ нашёлся путь по жёлтой сети (id дорог/сегментов,
// прямое и сырое расстояние, версия геометрии). Так видно, ГДЕ сеть разорвана,
// вместо угадывания по диагоналям.
function snapDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('pyn-map-matching-debug') === '1';
  } catch {
    return false;
  }
}

function logUnroutedPair(a: MatchedRoadPoint, b: MatchedRoadPoint, direct: number, rawDirect: number, graph: RoadGraph | null): void {
  if (!snapDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug('[glonass-snap] нет пути по жёлтой сети между посадками', {
    from: { road: a.roadIndex, segment: a.segmentIndex },
    to: { road: b.roadIndex, segment: b.segmentIndex },
    directMeters: Math.round(direct),
    rawMeters: Math.round(rawDirect),
    roadsVersion: graph?.version ?? null,
  });
}

const CELL_METERS = 60;
const LAT_DEG_PER_METER = 1 / 111_320;
// Двойники «линия на линию»: рисованные копии одной дороги расходятся до ~3.5 м
// (скрины 2026-07-11: параллельные синие вдоль одной жёлтой при зазоре 2–4 м).
// Порог согласован с OVERLAP_METERS графа (3 м): всё, что мостится как «та же
// дорога», канонизируется и в посадках. Реальные соседние проезды дальше.
const GLONASS_TWIN_LATERAL_METERS = 3.6;
const GLONASS_TWIN_DIRECTION_COS = 0.99; // почти одна ось: разница направлений < ~8°

interface RoadSnapSegment {
  roadIndex: number;
  segmentIndex: number;
  a: LatLng;
  b: LatLng;
  /** Терминальные сегменты дороги: a — самое начало, b — самый конец линии. */
  endA: boolean;
  endB: boolean;
}

interface RoadSnapHit extends RoadSnapSegment {
  point: LatLng;
  distance: number;
  t: number;
  /** Метры «за конец дороги» вдоль её оси: посадка прижата к терминальной
   *  вершине, а машина реально уехала дальше (дорога недорисована). */
  overshoot: number;
}

interface MatchedRoadPoint extends RoadSnapHit {
  raw: LatLng;
  rawIndex: number;
}

interface MatchRow {
  raw: LatLng;
  rawIndex: number;
  heading: number | null;
  candidates: RoadSnapHit[];
}

interface MatchState {
  cost: number;
  prev: number;
}

export interface RoadSnapIndex {
  cellLat: number;
  cellLng: number;
  cells: Map<string, RoadSnapSegment[]>;
  /** Длина каждой дороги, м (по roadIndex) — для выбора канона среди двойников. */
  roadLengths: number[];
  /** Версия геометрии дорог, на которой построен индекс (сверяется с графом). */
  version: number;
}

export type TimedLatLng = LatLng & {
  time: string;
  speed?: number | null;
  /** Перед этой точкой пути по дороге НЕТ (разрыв сети/сигнала): линию следа
   *  здесь рвём, маркер телепортируется — диагональ не рисуем. */
  gapBefore?: boolean;
};

export interface GlonassTrackSnapOptions {
  /** История хранит реальные повторные проезды и развороты; их нельзя удалять
   *  геометрической постобработкой только потому, что линия образовала петлю. */
  preserveTraversals?: boolean;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** Индекс сегментов дорог по ячейкам (сегмент кладётся во все задетые ячейки + запас). */
export function buildRoadSnapIndex(roads: MapRoad[]): RoadSnapIndex {
  const midLat = roads.length > 0 ? roads[0]!.vertices[0]?.lat ?? 57.92 : 57.92;
  const cellLat = CELL_METERS * LAT_DEG_PER_METER;
  const cellLng = CELL_METERS * LAT_DEG_PER_METER / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const padLat = GLONASS_ROAD_SNAP_METERS * LAT_DEG_PER_METER;
  const padLng = padLat / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const cells = new Map<string, RoadSnapSegment[]>();
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const road = roads[roadIndex]!;
    for (let segmentIndex = 0; segmentIndex < road.vertices.length - 1; segmentIndex++) {
      const a = road.vertices[segmentIndex]!;
      const b = road.vertices[segmentIndex + 1]!;
      const south = Math.min(a.lat, b.lat) - padLat;
      const north = Math.max(a.lat, b.lat) + padLat;
      const west = Math.min(a.lng, b.lng) - padLng;
      const east = Math.max(a.lng, b.lng) + padLng;
      const r0 = Math.floor(south / cellLat);
      const r1 = Math.floor(north / cellLat);
      const c0 = Math.floor(west / cellLng);
      const c1 = Math.floor(east / cellLng);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const key = cellKey(r, c);
          const bucket = cells.get(key);
          const segment = {
            roadIndex,
            segmentIndex,
            a,
            b,
            endA: segmentIndex === 0,
            endB: segmentIndex === road.vertices.length - 2,
          };
          if (bucket) bucket.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  const roadLengths = roads.map((road) => {
    let len = 0;
    for (let i = 1; i < road.vertices.length; i += 1) len += distanceMeters(road.vertices[i - 1]!, road.vertices[i]!);
    return len;
  });
  return { cellLat, cellLng, cells, roadLengths, version: roadGeometryVersion(roads) };
}

/**
 * Страховка согласованности (ТЗ: «универсальный пересчёт после любой правки
 * жёлтой сети»): индекс, граф и посадки ОБЯЗАНЫ считаться на одной версии
 * геометрии. Если индекс отстал (мутация «по месту», застрявшая ссылка) —
 * пересобираем на актуальных дорогах, а не матчим по старой геометрии.
 */
function ensureFreshIndex(index: RoadSnapIndex, roads: MapRoad[], graph: RoadGraph | null): RoadSnapIndex {
  if (!graph || index.version === graph.version) return index;
  // eslint-disable-next-line no-console
  console.warn('[glonass-snap] снап-индекс отстал от геометрии дорог — пересобираю', {
    indexVersion: index.version,
    roadsVersion: graph.version,
  });
  return buildRoadSnapIndex(roads);
}

/** Ближайшая посадка на дорогу в радиусе захвата (или null). */
export function snapToRoadIndex(index: RoadSnapIndex, p: LatLng): { point: LatLng; distance: number } | null {
  const hit = roadCandidates(index, p, GLONASS_ROAD_SNAP_METERS)[0] ?? null;
  return hit ? { point: hit.point, distance: hit.distance } : null;
}

/**
 * Live-маркер: посадка на дорогу с «липкостью» к предыдущей точке.
 * Наивный nearest на каждом poll прыгает между параллельными проездами
 * (2+ машин «слетают» с дороги). Штраф за разрыв с prev держит полосу;
 * телепорт >55 м отклоняем, если GPS почти не сдвинулся. Радиус — близко к
 * базовому: раньше был раздут (+22), из-за чего машины во дворах утаскивало
 * на дорогу; мелкую дрожь теперь гасит дедбенд у маркера, не радиус.
 */
export function stickySnapToRoad(
  index: RoadSnapIndex,
  p: LatLng,
  prev: LatLng | null | undefined,
  radiusMeters = GLONASS_ROAD_SNAP_METERS + 6,
): LatLng {
  const candidates = roadCandidates(index, p, radiusMeters);
  if (candidates.length === 0) {
    // Вне сети: если prev ещё рядом с GPS — держим, иначе сырой GPS.
    if (prev && distanceMeters(prev, p) < 90) return prev;
    return p;
  }
  if (!prev) return candidates[0]!.point;

  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const c of candidates) {
    const continuity = distanceMeters(c.point, prev);
    const score = c.distance + continuity * 0.9;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  const jump = distanceMeters(best.point, prev);
  const gpsMove = distanceMeters(p, prev);
  // Телепорт на соседнюю ветку при почти неподвижном GPS — оставляем кандидата
  // ближе к prev (инерция дороги).
  if (jump > 55 && jump > gpsMove + 28) {
    let near = candidates[0]!;
    let nearD = distanceMeters(near.point, prev);
    for (const c of candidates) {
      const d = distanceMeters(c.point, prev);
      if (d < nearD) {
        nearD = d;
        near = c;
      }
    }
    if (nearD < jump * 0.75) return near.point;
  }
  return best.point;
}

/** Позиция машины: точка-пин приоритетнее (стоит у точки), иначе дорога, иначе сырое. */
export function snapGlonassPosition(p: LatLng, index: RoadSnapIndex, points: MapPoint[]): LatLng {
  let bestPoint: { point: MapPoint; distance: number } | null = null;
  for (const mp of points) {
    const d = distanceMeters(p, mp);
    if (d > GLONASS_POINT_SNAP_METERS) continue;
    if (!bestPoint || d < bestPoint.distance) bestPoint = { point: mp, distance: d };
  }
  if (bestPoint) return standOff(bestPoint.point, p, GLONASS_POINT_STANDOFF_METERS);
  const road = snapToRoadIndex(index, p);
  return road ? road.point : p;
}

/** Трек: каждую точку сажаем на дорогу, если она в радиусе захвата (только дороги). */
export function snapGlonassTrack(points: LatLng[], index: RoadSnapIndex): LatLng[] {
  return snapGlonassTrackSegments(points, index).flat();
}

/**
 * Трек для отрисовки: сначала map matching с инерцией дороги, затем заполнение
 * углов по дорожному графу. Если расхождение слишком сильное/дорога не связана,
 * участок разрываем вместо рисования диагонали через здания.
 */
export function snapGlonassTrackSegments(
  points: LatLng[],
  index: RoadSnapIndex,
  roads: MapRoad[] = [],
  options: GlonassTrackSnapOptions = {},
): LatLng[][] {
  if (points.length === 0) return [];
  if (index.cells.size === 0) return splitTrack(cleanNearDuplicates(points), GLONASS_TRACK_BREAK_METERS);

  const graph = roads.length > 0 ? getRoadGraph(roads) : null;
  const freshIndex = ensureFreshIndex(index, roads, graph);
  const matchedGroups = mapMatchRoadGroups(points, freshIndex, graph, roads);
  const out: LatLng[][] = [];
  for (const group of matchedGroups) {
    if (group.length < 2) continue;
    const segments = roads.length > 0
      ? fillMatchedGroupByRoadGraph(group, roads, graph)
      : [cleanNearDuplicates(group.map((p) => p.point))];
    for (const segment of segments) {
      const base = cleanNearDuplicates(segment);
      // Жёсткий допуск 2.5 м: вырезка не имеет права рисовать хорду по воздуху.
      const chordOk = roads.length > 0
        ? (a: LatLng, b: LatLng) => straightSegmentLooksRoadLike(a, b, roads, 2.5)
        : undefined;
      const clean = options.preserveTraversals
        ? base
        : cutShortCrossLoops(pruneTrackSpurs(base, chordOk), chordOk);
      if (clean.length >= 2) out.push(clean);
    }
  }
  return roads.length > 0 ? enforceVisibleRoadSegments(out, roads, freshIndex) : out;
}

/**
 * Final PRO invariant: every rendered edge follows visible yellow geometry.
 * Post-processing may remove intermediate vertices and accidentally leave a
 * short chord. Repair it with a bounded road route; if that is impossible,
 * split the line instead of drawing blue beside the road.
 */
function enforceVisibleRoadSegments(segments: LatLng[][], roads: MapRoad[], index: RoadSnapIndex): LatLng[][] {
  const out: LatLng[][] = [];
  for (const segment of segments) {
    if (segment.length < 2) continue;
    let current: LatLng[] = [segment[0]!];
    for (let i = 1; i < segment.length; i += 1) {
      const a = current[current.length - 1]!;
      const b = segment[i]!;
      const direct = distanceMeters(a, b);
      if (edgeFollowsRoadIndex(a, b, index, 1.5)) {
        appendExactRoadPoints(current, [b]);
        continue;
      }

      const sameRoadRepair = exactCommonRoadPath(a, b, index, roads);
      if (sameRoadRepair) {
        appendExactRoadPoints(current, sameRoadRepair.slice(1));
        continue;
      }

      const route = computeFastestRoute(roads, a, b);
      const routeLimit = Math.max(35, direct * 2.2 + 20);
      const routeVisible = route &&
        route.path.length >= 2 &&
        route.distanceMeters <= routeLimit &&
        route.path.every((point) => visibleRoadDistance(index, point) <= 1.5) &&
        route.path.slice(1).every((point, routeIndex) => (
          edgeFollowsRoadIndex(route.path[routeIndex]!, point, index, 1.5)
        ));
      if (routeVisible) {
        appendExactRoadPoints(current, route!.path.slice(1));
        continue;
      }

      pushExactRoadSegment(out, current);
      current = [b];
    }
    pushExactRoadSegment(out, current);
  }
  return out;
}

function exactCommonRoadPath(a: LatLng, b: LatLng, index: RoadSnapIndex, roads: MapRoad[]): LatLng[] | null {
  const aHits = roadCandidates(index, a, 2.5).filter((hit) => hit.roadIndex >= 0);
  const bHits = roadCandidates(index, b, 2.5).filter((hit) => hit.roadIndex >= 0);
  let best: LatLng[] | null = null;
  let bestMeters = Infinity;
  for (const aHit of aHits) {
    for (const bHit of bHits) {
      if (aHit.roadIndex !== bHit.roadIndex) continue;
      const path = pathAlongSameRoad(roads, aHit, bHit);
      if (path.length < 2 || !path.slice(1).every((point, i) => edgeFollowsRoadIndex(path[i]!, point, index, 1.5))) continue;
      const meters = polylineMeters(path);
      if (meters < bestMeters) {
        best = path;
        bestMeters = meters;
      }
    }
  }
  return best;
}

function edgeFollowsRoadIndex(a: LatLng, b: LatLng, index: RoadSnapIndex, toleranceMeters: number): boolean {
  const direct = distanceMeters(a, b);
  const steps = Math.max(1, Math.min(16, Math.ceil(direct / 4)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    if (visibleRoadDistance(index, point) > toleranceMeters) return false;
  }
  return true;
}

/** Raw distance to every drawn segment, without HMM twin canonicalization. */
function visibleRoadDistance(index: RoadSnapIndex, p: LatLng): number {
  const row = Math.floor(p.lat / index.cellLat);
  const col = Math.floor(p.lng / index.cellLng);
  const seen = new Set<string>();
  let best = Infinity;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      for (const segment of index.cells.get(cellKey(row + dr, col + dc)) ?? []) {
        const key = `${segment.roadIndex}:${segment.segmentIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hit = nearestPointOnPolyline(p, [segment.a, segment.b]);
        if (hit && hit.distance < best) best = hit.distance;
      }
    }
  }
  return best;
}

function appendExactRoadPoints(out: LatLng[], points: LatLng[]): void {
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || distanceMeters(prev, point) > 0.05) out.push(point);
  }
}

function pushExactRoadSegment(out: LatLng[][], segment: LatLng[]): void {
  if (segment.length >= 2) out.push(segment);
}

/**
 * Исторический проигрыватель получает уже стабильный дорожный путь с
 * промежуточными timed-точками. Тогда машина едет по линии между GPS-фиксами,
 * а не телепортируется от одной редкой точки сайта к другой.
 */
export function snapGlonassReplayPoints<T extends TimedLatLng>(
  points: T[],
  index: RoadSnapIndex,
  roads: MapRoad[] = [],
): T[] {
  const valid = points.filter((p) => (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Number.isFinite(Date.parse(p.time))
  ));
  // Одиночные GPS-выбросы выкидываем из пути СРАЗУ: раньше они исключались из
  // матчинга, но доклеивались в путь сырыми — маркер уезжал «рядом с дорогой».
  const spikes = detectSpikes(valid);
  const source = valid.filter((_, i) => !spikes[i]);
  if (source.length < 2 || index.cells.size === 0) return source;

  const graph = roads.length > 0 ? getRoadGraph(roads) : null;
  const freshIndex = ensureFreshIndex(index, roads, graph);
  const matchedGroups = mapMatchRoadGroups(source, freshIndex, graph, roads);
  if (matchedGroups.length === 0) return source;

  const out: T[] = [];
  let lastRawIndex = -1;
  for (const group of matchedGroups) {
    const firstIndex = group[0]?.rawIndex ?? -1;
    if (firstIndex > lastRawIndex + 1) appendRawTimedGap(out, source, lastRawIndex + 1, firstIndex, freshIndex);
    appendTimedGroup(out, group, source, roads, graph);
    lastRawIndex = group[group.length - 1]?.rawIndex ?? lastRawIndex;
    if (out.length >= GLONASS_REPLAY_MAX_POINTS) break;
  }
  if (out.length < GLONASS_REPLAY_MAX_POINTS && lastRawIndex < source.length - 1) {
    appendRawTimedGap(out, source, lastRawIndex + 1, source.length, freshIndex);
  }

  // Проигрыватель обязан повторять реальную историю. Геометрические петли здесь
  // не вырезаем: замкнутый объезд вокруг здания может быть настоящим проездом.
  return out.length >= 2 ? out : source;
}

/**
 * Visible PRO history uses the exact same timed matcher as replay. This keeps
 * the blue line and moving replay marker on one route decision, then enforces
 * the visible-yellow invariant and preserves explicit graph gaps.
 */
export function snapGlonassHistorySegments<T extends TimedLatLng>(
  points: T[],
  index: RoadSnapIndex,
  roads: MapRoad[],
): LatLng[][] {
  const timed = snapGlonassReplayPoints(points, index, roads);
  const segments: LatLng[][] = [];
  let current: LatLng[] = [];
  for (const point of timed) {
    if (point.gapBefore && current.length >= 2) {
      segments.push(current);
      current = [];
    }
    current.push({ lat: point.lat, lng: point.lng });
  }
  if (current.length >= 2) segments.push(current);
  const visible = enforceVisibleRoadSegments(segments, roads, index);
  return healShortVisibleRoadGaps(visible, roads, index);
}

/**
 * A matcher split caused by a tiny drawing/topology tolerance must not leave a
 * visible hole in PRO history. Join only nearby ends with a short route whose
 * every edge is demonstrably on the yellow geometry; real telemetry gaps and
 * remote graph detours stay split.
 */
function healShortVisibleRoadGaps(segments: LatLng[][], roads: MapRoad[], index: RoadSnapIndex): LatLng[][] {
  const out: LatLng[][] = [];
  for (const segment of segments) {
    if (segment.length < 2) continue;
    const previous = out[out.length - 1];
    if (!previous) {
      out.push([...segment]);
      continue;
    }

    const a = previous[previous.length - 1]!;
    const b = segment[0]!;
    const direct = distanceMeters(a, b);
    if (direct > 35) {
      out.push([...segment]);
      continue;
    }

    const route = computeFastestRoute(roads, a, b);
    const routeLimit = Math.max(18, direct * 1.5 + 3);
    const routeVisible = route &&
      route.path.length >= 2 &&
      route.distanceMeters <= routeLimit &&
      route.path.slice(1).every((point, routeIndex) => (
        edgeFollowsRoadIndex(route.path[routeIndex]!, point, index, 1.5)
      ));
    if (!routeVisible) {
      out.push([...segment]);
      continue;
    }

    appendExactRoadPoints(previous, route.path.slice(1));
    appendExactRoadPoints(previous, segment.slice(1));
  }
  return out;
}

function mapMatchRoadGroups(points: LatLng[], index: RoadSnapIndex, graph: RoadGraph | null = null, roads: MapRoad[] = []): MatchedRoadPoint[][] {
  const spike = detectSpikes(points);
  const rows: MatchRow[] = [];
  const groups: MatchedRoadPoint[][] = [];

  const flush = () => {
    if (rows.length >= 2) {
      const roadMatched = keepCoherentOffRoad(matchGroup(rows, graph), rows);
      const reattached = reattachParallelOffRoadRuns(roadMatched, rows, roads);
      const clamped = clampTurnOvershoots(reattached, rows, roads);
      const stable = suppressShortRoadExcursions(clamped, rows, graph);
      const matched = simplifyOffRoadRuns(stable);
      if (matched.length >= 2) groups.push(matched);
    }
    rows.length = 0;
  };

  // Точка ВСЕГДА получает off-road-кандидата (сырую позицию) вдобавок к дорожным —
  // Viterbi сам решает: жаться к дороге рядом или ехать по следу, когда съехал.
  // Группу рвём только на реальном разрыве трека (долгая пропажа сигнала).
  let lastRaw: LatLng | null = null;
  for (let i = 0; i < points.length; i++) {
    if (spike[i]) continue;
    const raw = points[i]!;
    if (lastRaw && distanceMeters(lastRaw, raw) > GLONASS_TRACK_BREAK_METERS) flush();
    const candidates = roadCandidates(index, raw, GLONASS_ROAD_SNAP_METERS);
    candidates.push(offRoadHit(raw));
    rows.push({ raw, rawIndex: i, heading: rawHeading(points, i, spike), candidates });
    lastRaw = raw;
    if (rows.length > GLONASS_TRACK_ROUTE_FILL_MAX_POINTS) flush();
  }
  flush();
  return groups;
}

/** Off-road-кандидат: «машина стоит/едет вне нарисованной дороги» — на сыром фиксе. */
function offRoadHit(raw: LatLng): RoadSnapHit {
  return { roadIndex: -1, segmentIndex: -1, a: raw, b: raw, endA: false, endB: false, point: raw, distance: 0, t: 0, overshoot: 0 };
}

/**
 * Off-road-состояние оставляем только для СВЯЗНЫХ прогонов ≥ MIN_RUN фиксов —
 * это и есть «машина реально уехала и трекинг показывает логику проезда». Одиночные
 * 1–2 точки, заскочившие в off-road, — это шум: возвращаем на ближайшую дорогу (а
 * если дороги рядом нет вовсе — оставляем, машина действительно далеко).
 */
function keepCoherentOffRoad(matched: MatchedRoadPoint[], rows: MatchRow[]): MatchedRoadPoint[] {
  const out = matched.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i]!.roadIndex !== -1) { i += 1; continue; }
    let end = i;
    while (end < out.length && out[end]!.roadIndex === -1) end += 1;
    if (end - i < GLONASS_OFFROAD_MIN_RUN) {
      for (let k = i; k < end; k += 1) {
        const road = bestRoadCandidate(rows[k]!);
        if (road) out[k] = { ...road, raw: out[k]!.raw, rawIndex: out[k]!.rawIndex };
      }
    }
    i = end;
  }
  return out;
}

// «Две параллельные синие при одной жёлтой» (машина 401, 9 июля): GPS уехал за
// радиус захвата (46 м), кандидатов дороги нет → прогон ушёл в off-road и рисуется
// сырым ПАРАЛЛЕЛЬНО дороге. Если движение идёт вдоль ЕДИНСТВЕННОЙ дороги рядом
// (направление совпадает, боковое смещение стабильно, второй дороги-кандидата нет)
// — это она и есть: пересаживаем прогон на неё. Реальный съезд в карман/на другую
// дорогу не задеваем: там либо направление расходится, либо смещение «плывёт»,
// либо есть вторая дорога.
const GLONASS_PARALLEL_REATTACH_MAX_METERS = 80;
const GLONASS_PARALLEL_REATTACH_ANGLE_DEG = 28;
const GLONASS_PARALLEL_REATTACH_MIN_POINTS = 2;
const GLONASS_PARALLEL_REATTACH_SPREAD_METERS = 26;
const GLONASS_PARALLEL_REATTACH_SECOND_ROAD_MARGIN_METERS = 15;

function reattachParallelOffRoadRuns(
  matched: MatchedRoadPoint[],
  rows: MatchRow[],
  roads: MapRoad[],
): MatchedRoadPoint[] {
  if (roads.length === 0 || matched.length !== rows.length) return matched;
  const out = matched.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i]!.roadIndex !== -1) { i += 1; continue; }
    let end = i;
    while (end < out.length && out[end]!.roadIndex === -1) end += 1;
    if (end - i >= GLONASS_PARALLEL_REATTACH_MIN_POINTS) {
      const replacement = matchRunToSingleParallelRoad(out.slice(i, end), rows.slice(i, end), roads);
      if (replacement) {
        for (let k = 0; k < replacement.length; k += 1) out[i + k] = replacement[k]!;
      }
    }
    i = end;
  }
  return out;
}

function matchRunToSingleParallelRoad(
  run: MatchedRoadPoint[],
  rows: MatchRow[],
  roads: MapRoad[],
): MatchedRoadPoint[] | null {
  let commonRoad = -1;
  let minLateral = Infinity;
  let maxLateral = 0;
  const hits: MatchedRoadPoint[] = [];

  for (let k = 0; k < run.length; k += 1) {
    const raw = run[k]!.raw;
    let best: { roadIndex: number; point: LatLng; distance: number; segmentIndex: number; t: number } | null = null;
    let secondRoadDistance = Infinity;
    for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
      const road = roads[roadIndex]!;
      if (road.vertices.length < 2) continue;
      const hit = nearestPointOnPolyline(raw, road.vertices);
      if (!hit || hit.distance > GLONASS_PARALLEL_REATTACH_MAX_METERS) continue;
      if (!best || hit.distance < best.distance) {
        if (best && best.roadIndex !== roadIndex) secondRoadDistance = Math.min(secondRoadDistance, best.distance);
        best = { roadIndex, point: hit.point, distance: hit.distance, segmentIndex: hit.segmentIndex, t: hit.t };
      } else if (roadIndex !== best.roadIndex) {
        secondRoadDistance = Math.min(secondRoadDistance, hit.distance);
      }
    }
    if (!best) return null;
    if (commonRoad === -1) commonRoad = best.roadIndex;
    // Вся «дорожка» должна лечь на ОДНУ дорогу, и второй допустимой рядом нет.
    if (best.roadIndex !== commonRoad) return null;
    if (secondRoadDistance < best.distance + GLONASS_PARALLEL_REATTACH_SECOND_ROAD_MARGIN_METERS) return null;

    const road = roads[commonRoad]!;
    const a = road.vertices[best.segmentIndex]!;
    const b = road.vertices[best.segmentIndex + 1]!;
    // Движение — строго вдоль оси дороги, иначе это отъезд/подъезд, не дрейф GPS.
    const heading = rows[k]!.heading;
    if (heading != null) {
      const seg = bearingBetween(a, b);
      const diff = Math.min(angleDiff(heading, seg), angleDiff(heading, (seg + 180) % 360));
      if (diff > GLONASS_PARALLEL_REATTACH_ANGLE_DEG) return null;
    }
    minLateral = Math.min(minLateral, best.distance);
    maxLateral = Math.max(maxLateral, best.distance);
    hits.push({
      roadIndex: commonRoad,
      segmentIndex: best.segmentIndex,
      a,
      b,
      endA: best.segmentIndex === 0,
      endB: best.segmentIndex === road.vertices.length - 2,
      point: best.point,
      distance: best.distance,
      t: best.t,
      overshoot: 0,
      raw,
      rawIndex: run[k]!.rawIndex,
    });
  }

  // Смещение стабильно (постоянный дрейф GPS) — а не «отъехал и вернулся».
  if (maxLateral - minLateral > GLONASS_PARALLEL_REATTACH_SPREAD_METERS) return null;
  return hits;
}

// «Сопля у поворота» (ТЗ 2026-07-12, скриншоты): на повороте GPS по инерции
// мажет мимо угла — фиксы проецируются на продолжение текущей дороги за
// перекрёстком, хотя следующая ветка доказывает более раннюю точку поворота.
const GLONASS_TURN_OVERSHOOT_MAX_METERS = 45;
const GLONASS_TURN_OVERSHOOT_MIN_METERS = 8;
const GLONASS_TURN_OVERSHOOT_MAX_POINTS = 8;
const GLONASS_TURN_OVERSHOOT_RETURN_METERS = 8;

/** Счётчики для офлайн-диагностики (харнесс); в приложении ни на что не влияют. */
export const glonassSnapStats = {
  midReversalsClamped: 0,
  edgeOvershootsClamped: 0,
  midReversalsKeptByHeading: 0,
  edgeOvershootsKeptByHeading: 0,
};

function roadPrefixLengths(road: MapRoad): number[] {
  const prefix: number[] = [0];
  for (let i = 1; i < road.vertices.length; i += 1) {
    prefix.push(prefix[i - 1]! + distanceMeters(road.vertices[i - 1]!, road.vertices[i]!));
  }
  return prefix;
}

function clampTurnOvershoots(matched: MatchedRoadPoint[], rows: MatchRow[], roads: MapRoad[]): MatchedRoadPoint[] {
  if (matched.length < 3 || matched.length !== rows.length || roads.length === 0) return matched;
  const prefixCache = new Map<number, number[]>();
  const along = (hit: MatchedRoadPoint): number => {
    let prefix = prefixCache.get(hit.roadIndex);
    if (!prefix) {
      prefix = roadPrefixLengths(roads[hit.roadIndex]!);
      prefixCache.set(hit.roadIndex, prefix);
    }
    return (prefix[hit.segmentIndex] ?? 0) + hit.t * distanceMeters(hit.a, hit.b);
  };
  const out = matched.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i]!.roadIndex < 0) { i += 1; continue; }
    let end = i;
    while (end + 1 < out.length && out[end + 1]!.roadIndex === out[i]!.roadIndex) end += 1;
    // A run out and back on the same visible road is legitimate history. It
    // paints the same yellow geometry twice and cannot create a side spur, so
    // never collapse it from noisy heading alone. False turn overshoots are
    // handled below only where the matcher actually switches road branches.
    clampEdgeOvershoot(out, i, end, along, false);
    clampEdgeOvershoot(out, i, end, along, true);
    i = end + 1;
  }
  return out;
}

/** Внутри прогона: ушёл по дороге и ВЕРНУЛСЯ, курс — поперёк оси → снос, прижимаем. */
function clampMidReversals(
  out: MatchedRoadPoint[],
  from: number,
  to: number,
  along: (hit: MatchedRoadPoint) => number,
  misaligned: (k: number) => boolean | null,
): void {
  let k0 = from;
  while (k0 < to - 1) {
    const base = along(out[k0]!);
    let apex = 0;
    let k2 = -1;
    for (let k = k0 + 1; k <= Math.min(to, k0 + GLONASS_TURN_OVERSHOOT_MAX_POINTS); k += 1) {
      const offset = Math.abs(along(out[k]!) - base);
      if (offset > apex) apex = offset;
      if (k > k0 + 1 && apex >= GLONASS_TURN_OVERSHOOT_MIN_METERS && offset <= GLONASS_TURN_OVERSHOOT_RETURN_METERS) {
        k2 = k;
        break;
      }
    }
    if (k2 < 0 || apex > GLONASS_TURN_OVERSHOOT_MAX_METERS) { k0 += 1; continue; }
    const drifting: number[] = [];
    for (let k = k0 + 1; k < k2; k += 1) {
      if (Math.abs(along(out[k]!) - base) > 3) drifting.push(k);
    }
    if (drifting.length === 0) { k0 += 1; continue; }
    const verdicts = drifting.map(misaligned).filter((v): v is boolean => v != null);
    const bad = verdicts.filter(Boolean).length;
    // Курс по оси дороги (туда и обратно) — реальный заезд, не трогаем.
    if (verdicts.length === 0 || bad * 2 < verdicts.length) {
      glonassSnapStats.midReversalsKeptByHeading += 1;
      k0 += 1;
      continue;
    }
    glonassSnapStats.midReversalsClamped += 1;
    for (const k of drifting) out[k] = { ...out[k0]!, raw: out[k]!.raw, rawIndex: out[k]!.rawIndex };
    k0 = k2;
  }
}

/**
 * Край прогона перед сменой дороги: заехал ЗА перекрёсток и след вернулся через
 * него на другую дорогу (классический «overshoot на повороте»). Точка входа —
 * посадка, ближайшая к соседней дороге; хвост дальше неё с поперечным курсом
 * прижимаем к входу.
 */
function clampEdgeOvershoot(
  out: MatchedRoadPoint[],
  from: number,
  to: number,
  along: (hit: MatchedRoadPoint) => number,
  atEnd: boolean,
): void {
  const neighbor = out[atEnd ? to + 1 : from - 1];
  if (!neighbor || neighbor.roadIndex < 0 || neighbor.roadIndex === out[from]!.roadIndex) return;
  const windowStart = atEnd ? Math.max(from, to - GLONASS_TURN_OVERSHOOT_MAX_POINTS + 1) : from;
  const windowEnd = atEnd ? to : Math.min(to, from + GLONASS_TURN_OVERSHOOT_MAX_POINTS - 1);
  let entry = -1;
  let entryDist = Infinity;
  for (let k = windowStart; k <= windowEnd; k += 1) {
    const d = distanceMeters(out[k]!.point, neighbor.point);
    if (d < entryDist) { entryDist = d; entry = k; }
  }
  const edge = atEnd ? to : from;
  if (entry < 0 || entry === edge) return;
  if (distanceMeters(out[edge]!.point, neighbor.point) < entryDist + 6) return;
  const excursion = Math.abs(along(out[edge]!) - along(out[entry]!));
  if (excursion < GLONASS_TURN_OVERSHOOT_MIN_METERS || excursion > GLONASS_TURN_OVERSHOOT_MAX_METERS) return;
  const ks: number[] = [];
  for (let k = Math.min(entry, edge); k <= Math.max(entry, edge); k += 1) {
    if (k !== entry) ks.push(k);
  }
  // The following road proves where the turn happened. Continuing away from
  // that junction on the old branch and then appearing on the new branch is
  // topologically impossible; raw GPS heading must not preserve this tail.
  glonassSnapStats.edgeOvershootsClamped += 1;
  for (const k of ks) out[k] = { ...out[entry]!, raw: out[k]!.raw, rawIndex: out[k]!.rawIndex };
}

const GLONASS_OFFROAD_SIMPLIFY_METERS = 10;

/**
 * Вне нарисованных дорог GPS «скребёт» зигзагами (площадки, широкие развилки) —
 * каждый прогон off-road прореживаем (Дуглас–Пекер): общий ход проезда остаётся,
 * дрожание-паутинка уходит. Дорожные посадки не трогаем.
 */
function simplifyOffRoadRuns(matched: MatchedRoadPoint[]): MatchedRoadPoint[] {
  const out: MatchedRoadPoint[] = [];
  let i = 0;
  while (i < matched.length) {
    if (matched[i]!.roadIndex !== -1) {
      out.push(matched[i]!);
      i += 1;
      continue;
    }
    let end = i;
    while (end < matched.length && matched[end]!.roadIndex === -1) end += 1;
    const run = matched.slice(i, end);
    if (run.length <= 3) {
      out.push(...run);
    } else {
      const keep = douglasPeuckerKeep(run.map((m) => m.point), GLONASS_OFFROAD_SIMPLIFY_METERS);
      for (let k = 0; k < run.length; k += 1) {
        if (keep[k]) out.push(run[k]!);
      }
    }
    i = end;
  }
  return out;
}

function douglasPeuckerKeep(points: LatLng[], epsilonMeters: number): boolean[] {
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    let worst = -1;
    let worstDist = 0;
    for (let k = from + 1; k < to; k += 1) {
      const d = distancePointToSegmentMeters(points[k]!, points[from]!, points[to]!);
      if (d > worstDist) {
        worstDist = d;
        worst = k;
      }
    }
    if (worst >= 0 && worstDist > epsilonMeters) {
      keep[worst] = true;
      stack.push([from, worst], [worst, to]);
    }
  }
  return keep;
}

function bestRoadCandidate(row: MatchRow): RoadSnapHit | null {
  let best: RoadSnapHit | null = null;
  for (const candidate of row.candidates) {
    if (candidate.roadIndex === -1) continue;
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

/**
 * Убираем короткий ложный заезд на соседнюю ветку: A → B на 1–4 фикса → A.
 * Подмена разрешена только когда текущая ветка создаёт большой крюк по графу,
 * а кандидаты основной дороги рядом и дают существенно более связный путь.
 */
function suppressShortRoadExcursions(
  matched: MatchedRoadPoint[],
  rows: MatchRow[],
  graph: RoadGraph | null,
): MatchedRoadPoint[] {
  if (!graph || matched.length < 4 || matched.length !== rows.length) return matched;
  const out = matched.slice();
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    let start = 1;
    while (start < out.length - 1) {
      const excursionRoad = out[start]!.roadIndex;
      let end = start + 1;
      while (end < out.length && out[end]!.roadIndex === excursionRoad) end += 1;
      const targetRoad = out[start - 1]!.roadIndex;
      const runLength = end - start;
      if (
        excursionRoad >= 0 &&
        targetRoad >= 0 &&
        excursionRoad !== targetRoad &&
        end < out.length &&
        out[end]!.roadIndex === targetRoad &&
        runLength <= GLONASS_SHORT_ROAD_EXCURSION_POINTS
      ) {
        const replacements = matchRunOnRoad(out, rows, start, end, targetRoad, graph);
        const maxSnap = replacements
          ? replacements.reduce((max, candidate) => Math.max(max, candidate.distance), 0)
          : Infinity;
        const currentSlice = out.slice(start - 1, end + 1);
        const replacementSlice = replacements ? [out[start - 1]!, ...replacements, out[end]!] : [];
        const rawMeters = rawPolylineMeters(currentSlice);
        const currentExcess = maxRoadTransitionExcess(currentSlice, graph);
        const replacementExcess = replacements?.length === runLength
          ? maxRoadTransitionExcess(replacementSlice, graph)
          : Infinity;
        if (
          rawMeters <= GLONASS_SHORT_ROAD_EXCURSION_RAW_METERS &&
          maxSnap <= GLONASS_SHORT_ROAD_EXCURSION_MAX_SNAP_METERS &&
          currentExcess >= GLONASS_SHORT_ROAD_EXCURSION_MIN_EXCESS_METERS &&
          replacementExcess + GLONASS_SHORT_ROAD_EXCURSION_MIN_IMPROVEMENT_METERS <= currentExcess
        ) {
          for (let i = 0; i < replacements!.length; i += 1) out[start + i] = replacements![i]!;
          changed = true;
        }
      }
      start = Math.max(start + 1, end);
    }
    if (!changed) break;
  }
  return out;
}

function matchRunOnRoad(
  matched: MatchedRoadPoint[],
  rows: MatchRow[],
  start: number,
  end: number,
  roadIndex: number,
  graph: RoadGraph,
): MatchedRoadPoint[] | null {
  const choices = rows.slice(start, end).map((row) => row.candidates.filter((candidate) => (
    candidate.roadIndex === roadIndex && candidate.distance <= GLONASS_SHORT_ROAD_EXCURSION_MAX_SNAP_METERS
  )));
  if (choices.some((candidates) => candidates.length === 0)) return null;

  const states: MatchState[][] = choices.map((candidates) => candidates.map(() => ({ cost: Infinity, prev: -1 })));
  for (let c = 0; c < choices[0]!.length; c += 1) {
    const candidate = choices[0]![c]!;
    states[0]![c] = {
      cost: transitionCost(rows[start - 1]!, matched[start - 1]!, rows[start]!, candidate, graph) + emissionCost(rows[start]!, candidate),
      prev: -1,
    };
  }
  for (let offset = 1; offset < choices.length; offset += 1) {
    const rowIndex = start + offset;
    for (let c = 0; c < choices[offset]!.length; c += 1) {
      const candidate = choices[offset]![c]!;
      let best = { cost: Infinity, prev: -1 };
      for (let p = 0; p < choices[offset - 1]!.length; p += 1) {
        const prev = choices[offset - 1]![p]!;
        const cost = states[offset - 1]![p]!.cost +
          transitionCost(rows[rowIndex - 1]!, prev, rows[rowIndex]!, candidate, graph) +
          emissionCost(rows[rowIndex]!, candidate);
        if (cost < best.cost) best = { cost, prev: p };
      }
      states[offset]![c] = best;
    }
  }

  const lastOffset = choices.length - 1;
  let bestLast = -1;
  let bestCost = Infinity;
  for (let c = 0; c < choices[lastOffset]!.length; c += 1) {
    const candidate = choices[lastOffset]![c]!;
    const cost = states[lastOffset]![c]!.cost +
      transitionCost(rows[end - 1]!, candidate, rows[end]!, matched[end]!, graph);
    if (cost < bestCost) {
      bestCost = cost;
      bestLast = c;
    }
  }
  if (bestLast < 0 || !Number.isFinite(bestCost)) return null;

  const out = new Array<MatchedRoadPoint>(choices.length);
  for (let offset = lastOffset, candidateIndex = bestLast; offset >= 0; offset -= 1) {
    const sourceIndex = start + offset;
    const candidate = choices[offset]![candidateIndex]!;
    out[offset] = { ...candidate, raw: matched[sourceIndex]!.raw, rawIndex: matched[sourceIndex]!.rawIndex };
    candidateIndex = states[offset]![candidateIndex]!.prev;
  }
  return out;
}

function rawPolylineMeters(points: MatchedRoadPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1]!.raw, points[i]!.raw);
  return total;
}

function maxRoadTransitionExcess(points: MatchedRoadPoint[], graph: RoadGraph): number {
  let worst = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.roadIndex < 0 || b.roadIndex < 0) return Infinity;
    const roadMeters = roadGraphDistance(graph, hitEntry(a), hitEntry(b));
    if (!Number.isFinite(roadMeters)) return Infinity;
    worst = Math.max(worst, roadMeters - distanceMeters(a.raw, b.raw));
  }
  return worst;
}

/**
 * Индексы одиночных выбросов GPS (прыжок «туда-обратно», типично сквозь здание):
 * их исключаем из матчинга. Карман/объезд — это НЕСКОЛЬКО связных фиксов подряд,
 * геометрически он не одиночный выброс, поэтому здесь не гасится и уезжает в
 * off-road-состояние матчинга.
 */
function detectSpikes(points: LatLng[]): boolean[] {
  const spike = new Array<boolean>(points.length).fill(false);
  for (let i = 1; i < points.length - 1; i++) {
    let a = i - 1;
    while (a >= 0 && spike[a]) a -= 1;
    let b = i + 1;
    while (b < points.length && spike[b]) b += 1;
    if (a < 0 || b >= points.length) continue;
    const inLeg = distanceMeters(points[a]!, points[i]!);
    const outLeg = distanceMeters(points[i]!, points[b]!);
    if (inLeg < GLONASS_DESPIKE_MIN_METERS && outLeg < GLONASS_DESPIKE_MIN_METERS) continue;
    const straight = distanceMeters(points[a]!, points[b]!);
    if (inLeg + outLeg > Math.max(straight * GLONASS_DESPIKE_RATIO, straight + GLONASS_DESPIKE_MIN_METERS)) {
      spike[i] = true;
    }
  }
  return spike;
}

function matchGroup(rows: MatchRow[], graph: RoadGraph | null): MatchedRoadPoint[] {
  const states: MatchState[][] = rows.map((row) => row.candidates.map(() => ({ cost: Infinity, prev: -1 })));
  for (let c = 0; c < rows[0]!.candidates.length; c++) {
    states[0]![c] = { cost: emissionCost(rows[0]!, rows[0]!.candidates[c]!), prev: -1 };
  }

  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1]!;
    const row = rows[i]!;
    for (let c = 0; c < row.candidates.length; c++) {
      const candidate = row.candidates[c]!;
      const emit = emissionCost(row, candidate);
      let best = { cost: Infinity, prev: -1 };
      for (let p = 0; p < prevRow.candidates.length; p++) {
        const prevState = states[i - 1]![p]!;
        const prevCandidate = prevRow.candidates[p]!;
        const cost = prevState.cost + transitionCost(prevRow, prevCandidate, row, candidate, graph) + emit;
        if (cost < best.cost) best = { cost, prev: p };
      }
      states[i]![c] = best;
    }
  }

  const lastStates = states[states.length - 1]!;
  let bestIndex = 0;
  for (let i = 1; i < lastStates.length; i++) {
    if (lastStates[i]!.cost < lastStates[bestIndex]!.cost) bestIndex = i;
  }

  const out = new Array<MatchedRoadPoint>(rows.length);
  for (let rowIndex = rows.length - 1, candidateIndex = bestIndex; rowIndex >= 0; rowIndex--) {
    const row = rows[rowIndex]!;
    const candidate = row.candidates[candidateIndex] ?? row.candidates[0]!;
    out[rowIndex] = { ...candidate, raw: row.raw, rawIndex: row.rawIndex };
    candidateIndex = states[rowIndex]![candidateIndex]?.prev ?? 0;
    if (candidateIndex < 0) candidateIndex = 0;
  }
  return out;
}

function emissionCost(row: MatchRow, hit: RoadSnapHit): number {
  if (hit.roadIndex === -1) return GLONASS_OFFROAD_EMISSION; // «вне дороги» — фикс. цена
  let cost = hit.distance * 2.6;
  // Машина УЕХАЛА ЗА КОНЕЦ недорисованной дороги: чем дальше за конец, тем
  // дороже держаться за терминальную вершину — след честно уходит в сырой,
  // а не рисует «якорь»-огрызки от конца дороги.
  cost += hit.overshoot * 2.2;
  const bestDistance = bestRoadDistance(row);
  if (Number.isFinite(bestDistance) && hit.distance > bestDistance + 8) {
    const extra = hit.distance - bestDistance - 8;
    cost += extra * 4.5;
    if (bestDistance <= 18) cost += 24;
  }
  if (row.heading != null) {
    const seg = bearingBetween(hit.a, hit.b);
    const diff = Math.min(angleDiff(row.heading, seg), angleDiff(row.heading, (seg + 180) % 360));
    // At a junction the nearest segment is often the wrong branch. Direction
    // must dominate a small lateral GPS advantage; otherwise a straight/left
    // pass paints a short spur down the neighbouring road.
    if (diff > GLONASS_HEADING_SOFT_DEG) {
      cost += (diff - GLONASS_HEADING_SOFT_DEG) * GLONASS_HEADING_COST_PER_DEG;
    }
    if (diff > GLONASS_HEADING_HARD_DEG) cost += GLONASS_HEADING_HARD_PENALTY;
  }
  return cost;
}

function bestRoadDistance(row: MatchRow): number {
  let best = Infinity;
  for (const candidate of row.candidates) {
    if (candidate.roadIndex !== -1 && candidate.distance < best) best = candidate.distance;
  }
  return best;
}

function transitionCost(prevRow: MatchRow, prev: RoadSnapHit, row: MatchRow, hit: RoadSnapHit, graph: RoadGraph | null): number {
  const rawDist = distanceMeters(prevRow.raw, row.raw);
  const prevOff = prev.roadIndex === -1;
  const hitOff = hit.roadIndex === -1;

  if (prevOff || hitOff) {
    // Вне дороги считаем по СЫРОМУ расстоянию (кандидат = сырой фикс). Съезд с
    // дороги и возврат штрафуем — тогда одиночный прыжок не окупается, а длинный
    // связный объезд окупается и рисуется по следу.
    let cost = rawDist * 0.1;
    if (prevOff && hitOff) cost -= 4;                        // едем вне дороги — держим состояние
    if (!prevOff && hitOff) cost += GLONASS_OFFROAD_ENTER;   // съехал с дороги
    if (prevOff && !hitOff) cost += GLONASS_OFFROAD_EXIT;    // вернулся на дорогу
    return cost;
  }

  const sameRoad = prev.roadIndex === hit.roadIndex;
  // ТОПОЛОГИЯ (HMM Newson–Krumm): цена перехода = насколько путь ПО ДОРОГЕ между
  // посадками совпал с пройденным по GPS. Прыжок на несвязную/параллельную дорогу
  // недостижим по сети (или крюк) → дорого; связная развилка достижима → дёшево.
  const roadDist = graph
    ? roadGraphDistance(graph, hitEntry(prev), hitEntry(hit))
    : distanceMeters(prev.point, hit.point);

  if (!Number.isFinite(roadDist)) {
    // По сети не дотянуться в пределах CAP — это «перепрыгнул», не «проехал».
    const snapDist = distanceMeters(prev.point, hit.point);
    return GLONASS_ROAD_SWITCH_PENALTY + 200 + snapDist * 0.2 + Math.abs(snapDist - rawDist) * 0.4;
  }

  let cost = roadDist * 0.06 + Math.abs(roadDist - rawDist) * 0.5;
  if (!sameRoad) cost += 16;   // барьер смены дороги (связную развилку допускаем)
  else cost -= 9;              // инерция: держим текущую дорогу — не прыгаем по трём веткам развилки
  const timedLimit = timedTransitionLimit(prevRow.raw, row.raw, rawDist);
  if (roadDist > timedLimit) {
    // Зрелые map-matcher'ы учитывают не только геометрию, но и время. Путь на
    // 120 м между метками через 9 секунд при скорости 15 км/ч — ложная ветка,
    // даже если топологически по ней можно проехать.
    cost += GLONASS_TIMED_TRANSITION_PENALTY + (roadDist - timedLimit) * 1.4;
  }
  // Физически нереальный крюк по дороге относительно шага GPS → редкий фикс/петля.
  if (rawDist < GLONASS_SHORT_RAW_LOOP_METERS && roadDist > rawDist * 2.2 + 28) {
    cost += GLONASS_SHORT_RAW_LOOP_PENALTY + (roadDist - rawDist) * 0.7;
  }
  if (rawDist > 0 && roadDist > rawDist * 3.2 + 60) cost += 80;
  return cost;
}

function timedTransitionLimit(a: LatLng, b: LatLng, rawMeters: number): number {
  const ta = timedValue(a, 'time');
  const tb = timedValue(b, 'time');
  if (typeof ta !== 'string' || typeof tb !== 'string') return Infinity;
  const gapMs = Math.abs(Date.parse(tb) - Date.parse(ta));
  if (!(gapMs > 0) || gapMs > GLONASS_TIMED_TRANSITION_MAX_GAP_MS) return Infinity;
  const sa = Number(timedValue(a, 'speed'));
  const sb = Number(timedValue(b, 'speed'));
  const reportedKmh = Math.max(0, Number.isFinite(sa) ? sa : 0, Number.isFinite(sb) ? sb : 0);
  const reportedMeters = reportedKmh / 3.6 * (gapMs / 1000);
  const movementMeters = Math.max(rawMeters, reportedMeters);
  return Math.max(
    GLONASS_TIMED_TRANSITION_MIN_METERS,
    movementMeters * GLONASS_TIMED_TRANSITION_FACTOR + GLONASS_TIMED_TRANSITION_BUFFER_METERS,
  );
}

function timedValue(point: LatLng, key: 'time' | 'speed'): unknown {
  return (point as LatLng & Partial<TimedLatLng>)[key];
}

/** Посадка → вход в дорожный граф: концы сегмента a/b + оффсеты до точки по сегменту. */
function hitEntry(hit: RoadSnapHit): RoadGraphHitEntry {
  const segLen = distanceMeters(hit.a, hit.b);
  return { a: hit.a, b: hit.b, offA: hit.t * segLen, offB: (1 - hit.t) * segLen, point: hit.point };
}

function fillMatchedGroupByRoadGraph(group: MatchedRoadPoint[], roads: MapRoad[], graph: RoadGraph | null): LatLng[][] {
  if (group.length < 2) return [];
  const segments: LatLng[][] = [];
  let current: LatLng[] = [group[0]!.point];
  let routed = 0;

  for (let i = 0; i < group.length - 1; i++) {
    const a = group[i]!;
    const b = group[i + 1]!;
    const direct = distanceMeters(a.point, b.point);
    const rawDirect = distanceMeters(a.raw, b.raw);
    let path: LatLng[] | null = null;

    if (a.roadIndex === -1 || b.roadIndex === -1) {
      // Вне дороги — по СЫРОМУ следу (реальный проезд), без подтяжки к дороге.
      path = rawDirect <= GLONASS_OFFROAD_MAX_STEP_METERS ? [a.point, b.point] : null;
    } else if (a.roadIndex === b.roadIndex) {
      const sameRoadPath = graph
        ? roadGraphPath(graph, hitEntry(a), hitEntry(b))
        : pathAlongSameRoad(roads, a, b);
      // Короткий путь по СВОЕЙ дороге не может быть «неразумным»: коридорная
      // проверка тут рвала непрерывный проезд в проплешины (ТЗ 2026-07-12).
      const sameOk = sameRoadPath && (
        shortOwnRoadPathAcceptable(sameRoadPath, direct) ||
        matchedPathLooksReasonable(sameRoadPath, direct, rawDirect, a.raw, b.raw, undefined, Math.max(a.distance, b.distance))
      );
      path = sameOk ? sameRoadPath : null;
    } else if (routed < GLONASS_TRACK_ROUTE_FILL_MAX_CONNECTIONS) {
      // Роутим переход между дорогами ВСЕГДА (раньше зазоры < 5 м вообще не
      // маршрутизировались — у каждого перекрёстка оставалась жёлтая дырка).
      const graphPath = graph ? roadGraphPath(graph, hitEntry(a), hitEntry(b)) : null;
      if (
        graphPath &&
        graphPath.length >= 2 &&
        networkPathLooksReasonable(graphPath, direct, rawDirect) &&
        networkPathMatchesObservation(graphPath, a.raw, b.raw, Math.max(a.distance, b.distance))
      ) {
        routed += 1;
        path = graphPath;
      } else if (rawDirect >= GLONASS_FALLBACK_ROUTE_MIN_RAW_METERS) {
        const route = computeFastestRoute(roads, a.point, b.point);
        if (
          route &&
          route.path.length >= 2 &&
          networkPathLooksReasonable(route.path, direct, rawDirect, route.distanceMeters) &&
          networkPathMatchesObservation(route.path, a.raw, b.raw, Math.max(a.distance, b.distance))
        ) {
          routed += 1;
          path = route.path;
        }
      }
      if (!path) logUnroutedPair(a, b, direct, rawDirect, graph);
    }

    if (path && path.length >= 2) {
      appendPoints(current, path.slice(1));
      continue;
    }

    // Маленький зазор допустим прямой линией; большой — лучше разорвать, чем
    // нарисовать ложный проезд через здание/ответвление.
    if (straightConnectorAllowed(a, b, direct, rawDirect, roads)) {
      appendPoints(current, [b.point]);
    } else {
      pushLatLngSegment(segments, current);
      current = [b.point];
    }
  }

  pushLatLngSegment(segments, current);
  return segments;
}

function matchedPathLooksReasonable(
  path: LatLng[],
  directMeters: number,
  rawMeters: number,
  rawA: LatLng,
  rawB: LatLng,
  knownPathMeters?: number,
  snapDistanceMeters = 0,
): boolean {
  const pathMeters = knownPathMeters ?? polylineMeters(path);
  return pathLooksReasonable(pathMeters, directMeters, rawMeters) &&
    pathFollowsRawCorridor(path, pathMeters, rawA, rawB, snapDistanceMeters);
}

/**
 * Переход между РАЗНЫМИ дорогами уже проверен HMM по топологии. Здесь не
 * сравниваем его с прямой GPS-хордой: на повороте вокруг здания хорда как раз
 * ошибочна. Ограничиваем только абсурдно длинные обходы.
 */
function networkPathLooksReasonable(
  path: LatLng[],
  directMeters: number,
  rawMeters: number,
  knownPathMeters?: number,
): boolean {
  return pathLooksReasonable(knownPathMeters ?? polylineMeters(path), directMeters, rawMeters);
}

/**
 * A short observation must not be expanded into a remote network loop. Long
 * sparse observations may legitimately go around a building, but for a local
 * junction the routed path has to remain near the raw movement corridor.
 */
function networkPathMatchesObservation(
  path: LatLng[],
  rawA: LatLng,
  rawB: LatLng,
  snapDistanceMeters: number,
): boolean {
  const rawMeters = distanceMeters(rawA, rawB);
  if (!Number.isFinite(rawMeters) || rawMeters >= GLONASS_FALLBACK_ROUTE_MIN_RAW_METERS) return true;
  // Network turns naturally bow away from a GPS chord. Reject only a clearly
  // remote detour (the large V/loop from the screenshots), not an ordinary
  // corner around a building.
  const corridor = Math.max(42, rawMeters * 0.9 + 24, snapDistanceMeters + 14);
  return maxPathDistanceFromRawSegment(path, rawA, rawB) <= corridor;
}

function pathLooksReasonable(pathMeters: number, directMeters: number, rawMeters: number): boolean {
  // Предпочитаем идти ПО ДОРОГЕ, а не диагональю: принимаем сетевой путь, если он
  // не абсурдно длиннее прямой/сырого шага. Порог с запасом (крюк вокруг здания,
  // разворот), но не настолько, чтобы уводить «в обход полкарты».
  const rawRef = rawMeters > 0 ? rawMeters : directMeters;
  const localLimit = Math.max(56, directMeters * 4.5 + 70, rawRef * 1.8 + 70);
  const absoluteLimit = Math.max(directMeters, rawRef) + 450;
  return pathMeters <= Math.min(localLimit, absoluteLimit);
}

function pathFollowsRawCorridor(
  path: LatLng[],
  pathMeters: number,
  rawA: LatLng,
  rawB: LatLng,
  snapDistanceMeters = 0,
): boolean {
  if (path.length < 2 || pathMeters <= 8) return true;
  const rawMeters = distanceMeters(rawA, rawB);
  if (!Number.isFinite(rawMeters)) return true;
  if (rawMeters < 2) return pathMeters <= 18;

  // Для коротких редких фиксов особенно важно не выбирать соседнюю петлю:
  // raw идёт вдоль дороги, значит сетевой путь не должен уходить в карман на 50 м.
  const corridor = rawMeters < GLONASS_SHORT_RAW_LOOP_METERS
    ? Math.max(20, rawMeters * 0.65 + 14)
    : Math.max(30, Math.min(56, rawMeters * 0.26 + 18));
  return maxPathDistanceFromRawSegment(path, rawA, rawB) <= Math.max(corridor, snapDistanceMeters + 8);
}

function maxPathDistanceFromRawSegment(path: LatLng[], rawA: LatLng, rawB: LatLng): number {
  let maxDistance = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = distanceMeters(a, b);
    const steps = Math.max(1, Math.min(12, Math.ceil(len / 8)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
      maxDistance = Math.max(maxDistance, distancePointToSegmentMeters(point, rawA, rawB));
    }
  }
  return maxDistance;
}

function distancePointToSegmentMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const p = latLngToMeters(point);
  return distanceXYToSegment(p, latLngToMeters(a), latLngToMeters(b));
}

function distanceXYToSegment(p: XYMeters, a: XYMeters, b: XYMeters): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return Math.hypot(p.x - x, p.y - y);
}

function straightSegmentLooksRoadLike(a: LatLng, b: LatLng, roads: MapRoad[], toleranceMeters = 8): boolean {
  const direct = distanceMeters(a, b);
  if (direct <= Math.min(8, toleranceMeters * 1.5)) return true;
  const steps = Math.max(2, Math.min(10, Math.ceil(direct / 5)));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    if (distanceToNearestRoad(point, roads) > toleranceMeters) return false;
  }
  return true;
}

function distanceToNearestRoad(point: LatLng, roads: MapRoad[]): number {
  let best = Infinity;
  for (const road of roads) {
    const hit = nearestPointOnPolyline(point, road.vertices);
    if (hit && hit.distance < best) best = hit.distance;
  }
  return best;
}

function pathAlongSameRoad(roads: MapRoad[], a: RoadSnapHit, b: RoadSnapHit): LatLng[] {
  const road = roads[a.roadIndex];
  if (!road || road.vertices.length < 2) return [a.point, b.point];
  const from = a.segmentIndex + a.t;
  const to = b.segmentIndex + b.t;
  const path: LatLng[] = [a.point];

  if (from <= to) {
    for (let i = a.segmentIndex + 1; i <= b.segmentIndex; i++) {
      const vertex = road.vertices[i];
      if (vertex) path.push(vertex);
    }
  } else {
    for (let i = a.segmentIndex; i >= b.segmentIndex + 1; i--) {
      const vertex = road.vertices[i];
      if (vertex) path.push(vertex);
    }
  }
  path.push(b.point);
  return cleanNearDuplicates(path);
}

function appendRawTimedGap<T extends TimedLatLng>(out: T[], source: T[], from: number, to: number, index: RoadSnapIndex): void {
  for (let i = from; i < to && out.length < GLONASS_REPLAY_MAX_POINTS; i += 1) {
    const p = source[i]!;
    // «Дорога — истина»: даже точки-зазоры (между группами матчинга) сажаем на
    // дорогу, если она в радиусе захвата — маркер не должен ехать рядом с ней.
    const road = snapToRoadIndex(index, p);
    const target = road ? { ...p, lat: road.point.lat, lng: road.point.lng } : p;
    // Длинный скачок без пути по дороге — разрыв следа, не диагональ.
    const prev = out[out.length - 1];
    const gap = prev != null && distanceMeters(prev, target) > GLONASS_OFFROAD_MAX_STEP_METERS;
    appendTimedPoint(out, gap ? { ...target, gapBefore: true } : target);
  }
}

function appendTimedGroup<T extends TimedLatLng>(
  out: T[],
  group: MatchedRoadPoint[],
  source: T[],
  roads: MapRoad[],
  graph: RoadGraph | null,
): void {
  if (group.length === 0 || out.length >= GLONASS_REPLAY_MAX_POINTS) return;
  const routed = { count: 0 };
  const first = group[0]!;
  const prevOut = out[out.length - 1];
  const firstGap = prevOut != null && distanceMeters(prevOut, first.point) > GLONASS_OFFROAD_MAX_STEP_METERS;
  appendTimedPoint(out, makeTimedPoint(first.point, source[first.rawIndex]!, Date.parse(source[first.rawIndex]!.time), source[first.rawIndex]!.speed ?? null, firstGap));

  for (let i = 0; i < group.length - 1 && out.length < GLONASS_REPLAY_MAX_POINTS; i += 1) {
    const a = group[i]!;
    const b = group[i + 1]!;
    const from = source[a.rawIndex]!;
    const to = source[b.rawIndex]!;
    const path = matchedPairPath(a, b, from, to, roads, graph, routed);
    if (path && path.length >= 2) {
      appendDensifiedTimedPath(out, path, from, to);
    } else {
      // Пути по ВИДИМОЙ жёлтой дороге нет — всегда разрыв. Размер зазора не
      // даёт права проигрывателю ехать по невидимому прямому стежку.
      const gap = distanceMeters(a.point, b.point) > 0.5;
      appendTimedPoint(out, makeTimedPoint(b.point, to, Date.parse(to.time), to.speed ?? null, gap));
    }
  }
}

function matchedPairPath(
  a: MatchedRoadPoint,
  b: MatchedRoadPoint,
  from: TimedLatLng,
  to: TimedLatLng,
  roads: MapRoad[],
  graph: RoadGraph | null,
  routed: { count: number },
): LatLng[] | null {
  const direct = distanceMeters(a.point, b.point);
  const rawDirect = distanceMeters(from, to);
  if (a.roadIndex === -1 || b.roadIndex === -1) {
    // Вне дороги — по сырому следу (потом уплотняется по времени проигрывателем).
    return rawDirect <= GLONASS_OFFROAD_MAX_STEP_METERS ? [a.point, b.point] : null;
  }
  if (a.roadIndex === b.roadIndex) {
    const sameRoadPath = graph
      ? roadGraphPath(graph, hitEntry(a), hitEntry(b))
      : pathAlongSameRoad(roads, a, b);
    const sameOk = sameRoadPath && (
      shortOwnRoadPathAcceptable(sameRoadPath, direct) ||
      matchedPathLooksReasonable(sameRoadPath, direct, rawDirect, from, to, undefined, Math.max(a.distance, b.distance))
    );
    return sameOk ? sameRoadPath : null;
  }

  if (roads.length > 0 && routed.count < GLONASS_TRACK_ROUTE_FILL_MAX_CONNECTIONS) {
    const graphPath = graph ? roadGraphPath(graph, hitEntry(a), hitEntry(b)) : null;
    if (
      graphPath &&
      graphPath.length >= 2 &&
      networkPathLooksReasonable(graphPath, direct, rawDirect) &&
      networkPathMatchesObservation(graphPath, from, to, Math.max(a.distance, b.distance))
    ) {
      routed.count += 1;
      return graphPath;
    }
    if (rawDirect >= GLONASS_FALLBACK_ROUTE_MIN_RAW_METERS) {
      const route = computeFastestRoute(roads, a.point, b.point);
      if (
        route &&
        route.path.length >= 2 &&
        networkPathLooksReasonable(route.path, direct, rawDirect, route.distanceMeters) &&
        networkPathMatchesObservation(route.path, from, to, Math.max(a.distance, b.distance))
      ) {
        routed.count += 1;
        return route.path;
      }
    }
    logUnroutedPair(a, b, direct, rawDirect, graph);
  }

  if (straightConnectorAllowed(a, b, direct, rawDirect, roads)) return [a.point, b.point];
  return null;
}

/** Короткий путь по своей дороге всегда честный: он и есть жёлтая геометрия. */
function shortOwnRoadPathAcceptable(path: LatLng[], directMeters: number): boolean {
  return polylineMeters(path) <= Math.max(60, directMeters * 2 + 30);
}

/**
 * Разрешаем ли прямой «мостик» между двумя посадками без пути по графу. Мостик
 * до 8 м допустим, только если он ЛЕЖИТ на жёлтой (допуск 2.5 м) — переход через
 * перекрёсток, где узла в графе нет. Длиннее/в воздухе — разрыв, не диагональ.
 */
function straightConnectorAllowed(a: MatchedRoadPoint, b: MatchedRoadPoint, direct: number, _rawDirect: number, roads: MapRoad[]): boolean {
  if (direct > 8) return false;
  return straightSegmentLooksRoadLike(a.point, b.point, roads, 2.5);
}

function appendDensifiedTimedPath<T extends TimedLatLng>(out: T[], path: LatLng[], from: T, to: T): void {
  const fromMs = Date.parse(from.time);
  const toMs = Date.parse(to.time);
  const totalMeters = polylineMeters(path);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || totalMeters < 0.5) {
    appendTimedPoint(out, makeTimedPoint(path[path.length - 1]!, to, Date.parse(to.time), to.speed ?? null));
    return;
  }

  const byDistance = Math.ceil(totalMeters / GLONASS_REPLAY_DENSE_STEP_METERS);
  // Уплотнение по ВРЕМЕНИ — только когда есть заметный путь (плавная езда).
  // Пауза на месте (стоянка теперь ВНУТРИ непрерывной линии) не должна рожать
  // десятки «ползущих» точек и съедать лимит реплея — маркер и так стоит между
  // двумя точками стоянки.
  const byTime = totalMeters >= 15 ? Math.ceil((toMs - fromMs) / GLONASS_REPLAY_DENSE_STEP_MS) : 1;
  const steps = Math.max(1, Math.min(180, Math.max(byDistance, byTime)));
  // Равномерные сэмплы РЕЖУТ углы дороги: вершина полилинии попадает МЕЖДУ
  // шагами, и на повороте хорда уходит до ~3 м мимо жёлтой (ТЗ 2026-07-12,
  // «жёлтый уголок выглядывает»). Целевые дистанции = равномерная сетка ПЛЮС
  // каждая вершина пути — угол всегда попадает в вывод точно.
  const targets: number[] = [];
  for (let step = 1; step <= steps; step += 1) targets.push((totalMeters * step) / steps);
  let walked = 0;
  for (let i = 1; i < path.length - 1; i += 1) {
    walked += distanceMeters(path[i - 1]!, path[i]!);
    targets.push(walked);
  }
  targets.sort((a, b) => a - b);
  let emitted = 0;
  for (const target of targets) {
    if (out.length >= GLONASS_REPLAY_MAX_POINTS || emitted >= 240) break;
    const ratio = Math.min(1, target / totalMeters);
    appendTimedPoint(out, makeTimedPoint(
      interpolatePoint(path, ratio),
      to,
      fromMs + (toMs - fromMs) * ratio,
      interpolateNullable(from.speed ?? null, to.speed ?? null, ratio),
    ));
    emitted += 1;
  }
}

function appendTimedPoint<T extends TimedLatLng>(out: T[], point: T): void {
  if (out.length >= GLONASS_REPLAY_MAX_POINTS) return;
  const prev = out[out.length - 1];
  if (prev) {
    const gapMs = Math.abs(Date.parse(point.time) - Date.parse(prev.time));
    if (distanceMeters(prev, point) < 0.35 && (!Number.isFinite(gapMs) || gapMs < 1000)) return;
  }
  out.push(point);
}

function makeTimedPoint<T extends TimedLatLng>(
  point: LatLng,
  base: T,
  timeMs: number,
  speed: number | null,
  gapBefore = false,
): T {
  return {
    ...base,
    lat: point.lat,
    lng: point.lng,
    time: Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : base.time,
    speed,
    gapBefore: gapBefore ? true : undefined,
  };
}

function interpolateNullable(a: number | null, b: number | null, ratio: number): number | null {
  if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * ratio;
  return ratio < 0.5 ? a : b;
}

function interpolatePoint(path: LatLng[], ratio: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0]!;
  const target = polylineMeters(path) * Math.max(0, Math.min(1, ratio));
  let walked = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = distanceMeters(a, b);
    if (walked + len >= target) {
      const t = len > 0 ? (target - walked) / len : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    walked += len;
  }
  return path[path.length - 1]!;
}

function roadCandidates(index: RoadSnapIndex, p: LatLng, radiusMeters: number): RoadSnapHit[] {
  const row = Math.floor(p.lat / index.cellLat);
  const col = Math.floor(p.lng / index.cellLng);
  const seen = new Set<string>();
  const out: RoadSnapHit[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const bucket = index.cells.get(cellKey(row + dr, col + dc));
      if (!bucket) continue;
      for (const segment of bucket) {
        const key = `${segment.roadIndex}:${segment.segmentIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hit = nearestPointOnPolyline(p, [segment.a, segment.b]);
        if (!hit || hit.distance > radiusMeters) continue;
        out.push({
          ...segment,
          point: hit.point,
          distance: hit.distance,
          t: hit.t,
          overshoot: segmentOvershoot(segment, hit.t, p),
        });
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance);
  // Копии, реально нарисованные «линия на линию», приводим к одной СТАБИЛЬНОЙ
  // геометрии. Выбор ближайшей копии на каждом фиксе уже пробовали — GPS-дрожь
  // заставляла след прыгать между ними. Побеждает постоянный канон (см. twinWins),
  // и только при почти полном совпадении оси; соседние проезды и развилки не трогаем.
  return canonicalizeTwinRoadCandidates(out, index.roadLengths).slice(0, GLONASS_MATCH_CANDIDATES);
}

function canonicalizeTwinRoadCandidates(candidates: RoadSnapHit[], roadLengths: number[]): RoadSnapHit[] {
  return candidates.filter((candidate) => !candidates.some((other) => (
    other.roadIndex !== candidate.roadIndex &&
    twinRoadHits(candidate, other) &&
    twinWins(other, candidate, roadLengths)
  )));
}

/**
 * Канон пары двойников — ДЛИННЕЙШАЯ дорога: короткий обрубок-огрызок (остаток
 * старой линии в центре развилки) проигрывает живой ветке и не притягивает след.
 * При равной длине — меньший roadIndex, чтобы канон был стабилен между фиксами.
 */
function twinWins(a: RoadSnapHit, b: RoadSnapHit, roadLengths: number[]): boolean {
  const lenA = roadLengths[a.roadIndex] ?? 0;
  const lenB = roadLengths[b.roadIndex] ?? 0;
  if (Math.abs(lenA - lenB) > 1) return lenA > lenB;
  return a.roadIndex < b.roadIndex;
}

function twinRoadHits(a: RoadSnapHit, b: RoadSnapHit): boolean {
  if (distanceMeters(a.point, b.point) > GLONASS_TWIN_LATERAL_METERS) return false;
  const am = latLngToMeters(a.a);
  const bm = latLngToMeters(a.b);
  const cm = latLngToMeters(b.a);
  const dm = latLngToMeters(b.b);
  const abx = bm.x - am.x;
  const aby = bm.y - am.y;
  const cdx = dm.x - cm.x;
  const cdy = dm.y - cm.y;
  const abLen = Math.hypot(abx, aby);
  const cdLen = Math.hypot(cdx, cdy);
  if (abLen < 1 || cdLen < 1) return false;
  return Math.abs((abx * cdx + aby * cdy) / (abLen * cdLen)) >= GLONASS_TWIN_DIRECTION_COS;
}

/**
 * «Заезд за конец дороги»: если посадка прижата к терминальной вершине (дорога
 * недорисована, машина уехала дальше вдоль оси) — возвращаем метры выезда за
 * конец. Без этого фиксы до 46 м липнут к последней вершине («якорь») и след
 * рисует огрызки от конца дороги вместо честного сырого продолжения.
 */
function segmentOvershoot(segment: RoadSnapSegment, tClamped: number, p: LatLng): number {
  const beyondB = segment.endB && tClamped >= 0.999;
  const beyondA = segment.endA && tClamped <= 0.001;
  if (!beyondA && !beyondB) return 0;
  const am = latLngToMeters(segment.a);
  const bm = latLngToMeters(segment.b);
  const pm = latLngToMeters(p);
  const abx = bm.x - am.x;
  const aby = bm.y - am.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return 0;
  const tUnclamped = ((pm.x - am.x) * abx + (pm.y - am.y) * aby) / len2;
  const segLen = Math.sqrt(len2);
  if (beyondB && tUnclamped > 1) return (tUnclamped - 1) * segLen;
  if (beyondA && tUnclamped < 0) return -tUnclamped * segLen;
  return 0;
}

/** Точка в `meters` от пина в направлении исходного фикса (фикс на пине → на юг). */
function standOff(pin: LatLng, raw: LatLng, meters: number): LatLng {
  const latRad = (pin.lat * Math.PI) / 180;
  const dx = (raw.lng - pin.lng) * Math.cos(latRad);
  const dy = raw.lat - pin.lat;
  const len = Math.hypot(dx, dy);
  const mLat = meters * LAT_DEG_PER_METER;
  const mLng = mLat / Math.max(0.2, Math.cos(latRad));
  if (len === 0) return { lat: pin.lat - mLat, lng: pin.lng };
  return {
    lat: pin.lat + (dy / len) * mLat,
    lng: pin.lng + (dx / len) * mLng,
  };
}

function rawHeading(points: LatLng[], index: number, spike?: boolean[]): number | null {
  const current = points[index];
  if (!current) return null;
  let prev: LatLng | null = null;
  let next: LatLng | null = null;
  for (let i = index - 1; i >= 0; i--) {
    if (spike?.[i]) continue;
    if (distanceMeters(points[i]!, current) >= 4) {
      prev = points[i]!;
      break;
    }
  }
  for (let i = index + 1; i < points.length; i++) {
    if (spike?.[i]) continue;
    if (distanceMeters(points[i]!, current) >= 4) {
      next = points[i]!;
      break;
    }
  }
  if (prev && next) return bearingBetween(prev, next);
  if (prev) return bearingBetween(prev, current);
  if (next) return bearingBetween(current, next);
  return null;
}

function bearingBetween(a: LatLng, b: LatLng): number {
  const latRad = (a.lat * Math.PI) / 180;
  const dx = (b.lng - a.lng) * Math.cos(latRad);
  const dy = b.lat - a.lat;
  if (Math.hypot(dx, dy) < 1e-12) return 0;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(d, 360 - d);
}

/**
 * Убираем тонкие «сопли» — короткие отростки следа «выскочил вбок и вернулся».
 * Вершину режем, если путь через неё заметно длиннее прямой хорды (крюк) и при
 * этом сам крюк короткий. Плавные повороты (крюк ≈ 0) и длинные съезды (крюк
 * длинный) остаются. Несколько проходов — чтобы схлопнуть и вложенные отростки.
 */
export function pruneTrackSpurs<T extends LatLng>(
  points: T[],
  chordAllowed?: (a: LatLng, b: LatLng) => boolean,
): T[] {
  if (points.length < 3) return points;
  let work = points;
  for (let pass = 0; pass < 4; pass += 1) {
    const out: T[] = [work[0]!];
    let removed = false;
    for (let i = 1; i < work.length - 1; i += 1) {
      const a = out[out.length - 1]!;
      // Окно до 4 вершин: сопля из графовых узлов «туда-обратно» ловится, а
      // реальные развороты-петли (плавные дуги из многих вершин) не режутся —
      // окно 8 на живой истории превращало их в жёсткие углы.
      let cut = 0;
      for (let w = 1; w <= 4 && i + w - 1 < work.length - 1; w += 1) {
        const c = work[i + w]!;
        let detour = distanceMeters(a, work[i]!);
        for (let k = 0; k < w - 1; k += 1) detour += distanceMeters(work[i + k]!, work[i + k + 1]!);
        detour += distanceMeters(work[i + w - 1]!, c);
        const chord = distanceMeters(a, c);
        if (detour <= GLONASS_SPUR_MAX_DETOUR_METERS && detour >= chord * GLONASS_SPUR_DETOUR_RATIO + 5) {
          // Хорда после выреза обязана лежать НА жёлтой: проезд через острую
          // Y-развилку геометрически похож на «соплю», но резать его нельзя —
          // выйдет стежок по воздуху мимо узла (ТЗ 2026-07-12).
          if (chordAllowed && !chordAllowed(a, c)) continue;
          cut = w;
          break;
        }
      }
      if (cut > 0) {
        removed = true; // выскок «туда-обратно» — выкидываем вершины-отростки
        i += cut - 1;
        continue;
      }
      out.push(work[i]!);
    }
    out.push(work[work.length - 1]!);
    work = out;
    if (!removed) break;
  }
  return work;
}

/**
 * Вырезаем короткие САМОПЕРЕСЕКАЮЩИЕСЯ петли («треугольники» у развилки при
 * развороте): если сегмент следа поперечно пересекает другой сегмент в коротком
 * окне и петля между ними короткая — интересен только проезд «дальше и обратно»,
 * а не ужимка вбок, поэтому петлю выбрасываем целиком. Наложение «туда-обратно
 * по той же дороге» (почти параллельные линии) пересечением не считается.
 */
export function cutShortCrossLoops<T extends LatLng>(
  points: T[],
  chordAllowed?: (a: LatLng, b: LatLng) => boolean,
): T[] {
  let work = points;
  for (let pass = 0; pass < 6 && work.length >= 4; pass += 1) {
    let cutFrom = -1;
    let cutTo = -1;
    outer: for (let i = 0; i < work.length - 3; i += 1) {
      let loopLen = 0;
      const jMax = Math.min(work.length - 2, i + GLONASS_CROSS_LOOP_WINDOW);
      for (let j = i + 2; j <= jMax; j += 1) {
        loopLen += distanceMeters(work[j - 1]!, work[j]!);
        if (loopLen > GLONASS_CROSS_LOOP_MAX_METERS) break;
        if (segmentsCrossTransversal(work[i]!, work[i + 1]!, work[j]!, work[j + 1]!)) {
          // Склейка берегов петли обязана лежать на жёлтой — иначе не режем.
          if (chordAllowed && !chordAllowed(work[i]!, work[j + 1]!)) continue;
          cutFrom = i;
          cutTo = j;
          break outer;
        }
      }
    }
    if (cutFrom < 0) break;
    work = [...work.slice(0, cutFrom + 1), ...work.slice(cutTo + 1)];
  }
  return work;
}

/** Поперечное пересечение отрезков ab×cd (без касаний концами и без коллинеарных наложений). */
function segmentsCrossTransversal(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const p1 = latLngToMeters(a);
  const p2 = latLngToMeters(b);
  const p3 = latLngToMeters(c);
  const p4 = latLngToMeters(d);
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const len1 = Math.hypot(d1x, d1y);
  const len2 = Math.hypot(d2x, d2y);
  if (len1 < 0.5 || len2 < 0.5) return false;
  const denom = d1x * d2y - d1y * d2x;
  // Почти параллельные (ретрейс той же дороги) — не пересечение, а наложение.
  if (Math.abs(denom) < len1 * len2 * 0.2) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t > 0.03 && t < 0.97 && u > 0.03 && u < 0.97;
}

function cleanNearDuplicates(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const prev = out[out.length - 1];
    if (prev && distanceMeters(prev, point) < GLONASS_TRACK_MIN_GAP_METERS) {
      // Вершину-УГОЛ не выкидываем даже вплотную к предыдущей: пропуск вершины
      // срезает угол жёлтой дороги хордой (ТЗ 2026-07-12).
      const next = points[i + 1];
      const isCorner = next != null &&
        distanceMeters(prev, point) >= 0.5 &&
        distanceMeters(point, next) >= GLONASS_TRACK_MIN_GAP_METERS &&
        angleDiff(bearingBetween(prev, point), bearingBetween(point, next)) > 28;
      if (!isCorner) continue;
    }
    out.push(point);
  }
  return out;
}

function polylineMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distanceMeters(points[i]!, points[i + 1]!);
  }
  return total;
}

function splitTrack(points: LatLng[], maxGapMeters: number): LatLng[][] {
  const out: LatLng[][] = [];
  let cur: LatLng[] = [];
  for (const point of points) {
    const prev = cur[cur.length - 1];
    if (prev && distanceMeters(prev, point) > maxGapMeters) {
      pushLatLngSegment(out, cur);
      cur = [];
    }
    cur.push(point);
  }
  pushLatLngSegment(out, cur);
  return out;
}

function appendPoints(out: LatLng[], points: LatLng[]): void {
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const prev = out[out.length - 1];
    if (prev && distanceMeters(prev, point) < GLONASS_TRACK_MIN_GAP_METERS) {
      // Вершину-УГОЛ пути не выкидываем: пропуск режет угол дороги хордой.
      const next = points[i + 1];
      const isCorner = next != null &&
        distanceMeters(prev, point) >= 0.5 &&
        distanceMeters(point, next) >= GLONASS_TRACK_MIN_GAP_METERS &&
        angleDiff(bearingBetween(prev, point), bearingBetween(point, next)) > 28;
      if (!isCorner) continue;
    }
    out.push(point);
  }
}

function pushLatLngSegment(out: LatLng[][], segment: LatLng[]): void {
  const clean = cleanNearDuplicates(segment);
  if (clean.length >= 2) out.push(clean);
}
