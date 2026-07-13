/**
 * Персистентный дорожный ГРАФ для map-matching и маршрутов: переходы в HMM должны
 * считаться по РАССТОЯНИЮ ПО ДОРОГЕ (топология связной сети), а не по прямой.
 * Тогда матчер не «перепрыгивает» на параллельную/несвязную дорогу и не
 * закручивает петли на развилках/самопересечениях рисованной дороги.
 *
 * КЛЮЧЕВОЕ (ТЗ 2026-07-11): рисованная сеть — полилинии, которые пересекаются
 * СЕРЕДИНАМИ сегментов без общей вершины (X-перекрёстки, T-примыкания). Раньше
 * граф соединял дороги только по совпадающим вершинам и свариваемым концам —
 * такие перекрёстки были РАЗРЫВОМ топологии: по сети «не доехать», матчер
 * переносил машину между дорогами где попало (диагональные «сопли»), маршрут
 * мог не находиться. Теперь при построении сегменты РЕЖУТСЯ в местах взаимных
 * пересечений и примыканий (вершина у полотна другой дороги) — сеть = единая
 * паутина со ВСЕМИ перекрёстками, переходы возможны только через них.
 *
 * Граф строится ОДИН раз на массив дорог (мемо по ссылке), близкие концы
 * свариваются (weld). Дистанции между узлами — ограниченный Дейкстра с кэшем.
 */

import { distanceMeters, latLngToMeters, type XYMeters } from './geo';
import type { LatLng, MapRoad } from './map-types';

const LAT_DEG_PER_METER = 1 / 111_320;
const NODE_KEY_DECIMALS = 6;                 // ~0.11 м — совпадающие вершины = один узел
const DEFAULT_WELD_METERS = 7;               // закрываем небольшие недотянутые стыки, но не свариваем соседние карманы
const DIJKSTRA_CAP_METERS = 520;             // дальше переходы физически недостижимы между соседними фиксами
const WELD_CELL_METERS = 12;
const CUT_CELL_METERS = 55;                  // ячейки поиска пересечений сегментов
const TOUCH_METERS = 5;                      // вершина у полотна другой дороги = примыкание
const CUT_MIN_END_METERS = 0.6;              // разрезы впритык к концам не нужны (там и так узел)

// НАЛОЖЕНИЕ «линия на линию» (ТЗ 2026-07-11): рисованная поверх другой почти
// параллельная линия — это ТА ЖЕ дорога (пользователь так показывает «одна дорога /
// развилка»). Математического пересечения у таких пар нет (guard параллельности),
// раньше сеть их не связывала — переход шёл в обход через КОНЕЦ «палки» (диагональные
// «сопли» вниз к началу дороги, карманы у углов). Теперь близкие параллельные
// прогоны свариваем МОСТИКАМИ каждые ~7 м — по паутине можно перейти в любом месте
// наложения. Геометрия рисунка НЕ меняется: мостики живут только в графе.
const OVERLAP_METERS = 3.0;                  // ближе — та же дорога; реальные соседние проезды дальше
const OVERLAP_ANGLE_COS = 0.92;              // ≤ ~23° между направлениями линий
const OVERLAP_STEP_METERS = 7;               // шаг мостиков вдоль наложения
// Мост сажаем только на УЗЕЛ, реально стоящий в точке разреза; дальше — не мост.
const OVERLAP_NODE_TOLERANCE_METERS = 2.5;
// Перескок между копиями дороже реального бока: мосты — для связности сети и
// матчинга, а не как «срезки», иначе путь виляет между двойниками и режет углы.
const OVERLAP_BRIDGE_WEIGHT_FACTOR = 3;

export interface RoadGraph {
  nodes: LatLng[];
  adj: RoadGraphEdge[][];
  keyToNode: Map<string, number>;
  /** Цепочка узлов вдоль ИСХОДНОГО сегмента a→b (с узлами-перекрёстками): офсеты от a, м. */
  chains: Map<string, { nodes: number[]; offs: number[] }>;
  /** Кэш ограниченного Дейкстры: узел-источник → (узел → расстояние по дороге). */
  distCache: Map<number, Map<number, number>>;
  /** Версия геометрии дорог, на которой построен граф ([[roadGeometryVersion]]). */
  version: number;
  /** Сколько рёбер реально лежит на жёлтой геометрии, а сколько добавлено допусками. */
  diagnostics: RoadGraphDiagnostics;
}

export type RoadGraphEdgeKind = 'road' | 'touch' | 'overlap' | 'weld';

export interface RoadGraphEdge {
  to: number;
  w: number;
  kind: RoadGraphEdgeKind;
}

export interface RoadGraphDiagnostics {
  roadEdges: number;
  touchEdges: number;
  overlapEdges: number;
  weldEdges: number;
  /** Компоненты только по физическим жёлтым рёбрам, без виртуальных мостиков. */
  strictComponents: number;
  strictLargest: number[];
  virtualConnectors: Array<{
    kind: Exclude<RoadGraphEdgeKind, 'road'>;
    fromNode: number;
    toNode: number;
    from: LatLng;
    to: LatLng;
    meters: number;
  }>;
}

export interface RoadGraphHitEntry {
  a: LatLng;
  b: LatLng;
  offA: number;
  offB: number;
  point: LatLng;
}

/** Вход в граф с посадки: ближайшие узлы цепочки сегмента + офсеты до них. */
export interface RoadGraphEntry {
  node: number;
  off: number;
}

const graphMemo = new WeakMap<MapRoad[], RoadGraph>();

/**
 * Контент-версия геометрии жёлтой сети: меняется при ЛЮБОЙ правке вершин
 * (сдвиг/добавление/удаление/разрез/слияние/новая дорога). Все производные
 * структуры (граф, снап-индекс, результаты матчинга) обязаны считаться на
 * ТОЙ ЖЕ версии — рассинхрон означает «матчинг по старой дороге» и даёт
 * диагонали/мусорные соединения. Ссылочная мемоизация мутацию «по месту»
 * не ловит, контент-версия ловит.
 */
export function roadGeometryVersion(roads: MapRoad[]): number {
  let h = 0x811c9dc5;
  const mix = (value: number): void => {
    // Квантуем до ~1 см: дрожь float-сериализации не должна менять версию.
    const q = Math.round(value * 1e7);
    h ^= q & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  mix(roads.length);
  for (const road of roads) {
    mix(road.vertices.length);
    for (const v of road.vertices) {
      mix(v.lat);
      mix(v.lng);
    }
  }
  return h >>> 0;
}

/** Граф для данного массива дорог: кэш по ссылке, валидность — по версии геометрии. */
export function getRoadGraph(roads: MapRoad[]): RoadGraph {
  const version = roadGeometryVersion(roads);
  const cached = graphMemo.get(roads);
  if (cached && cached.version === version) return cached;
  const graph = buildRoadGraph(roads);
  graphMemo.set(roads, graph);
  logNetworkHealth(graph, roads);
  return graph;
}

function graphDebugEnabled(): boolean {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem('pyn-map-matching-debug') === '1';
  } catch {
    return false;
  }
}

/**
 * Сводка здоровья сети (под флагом `pyn-map-matching-debug`): будущий расчёт
 * маршрутов/OR-Tools ломают не визуальные дубли, а ОСТРОВА (несвязные компоненты
 * — между ними пути нет) и обрубки-огрызки, притягивающие точки. Здесь их видно
 * сразу после любой правки: компонент должна быть 1 (± дальние отдельные площадки).
 */
function logNetworkHealth(graph: RoadGraph, roads: MapRoad[]): void {
  if (!graphDebugEnabled() || graph.nodes.length === 0) return;
  const seen = new Array<boolean>(graph.nodes.length).fill(false);
  const sizes: number[] = [];
  for (let start = 0; start < graph.nodes.length; start += 1) {
    if (seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const node = stack.pop()!;
      size += 1;
      for (const edge of graph.adj[node]!) {
        if (!seen[edge.to]) {
          seen[edge.to] = true;
          stack.push(edge.to);
        }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  let stubs = 0;
  for (const road of roads) {
    let len = 0;
    for (let i = 1; i < road.vertices.length; i += 1) len += distanceMeters(road.vertices[i - 1]!, road.vertices[i]!);
    if (len > 0 && len < 10) stubs += 1;
  }
  // eslint-disable-next-line no-console
  console.debug('[road-graph] здоровье сети', {
    version: graph.version,
    nodes: graph.nodes.length,
    components: sizes.length,
    largest: sizes.slice(0, 3),
    stubRoadsUnder10m: stubs,
    strictComponents: graph.diagnostics.strictComponents,
    strictLargest: graph.diagnostics.strictLargest,
    virtualEdges: {
      touch: graph.diagnostics.touchEdges,
      overlap: graph.diagnostics.overlapEdges,
      weld: graph.diagnostics.weldEdges,
    },
  });
}

function componentSizes(adj: RoadGraphEdge[][], roadOnly = false): number[] {
  const seen = new Array<boolean>(adj.length).fill(false);
  const sizes: number[] = [];
  for (let start = 0; start < adj.length; start += 1) {
    if (seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const node = stack.pop()!;
      size += 1;
      for (const edge of adj[node]!) {
        if (roadOnly && edge.kind !== 'road') continue;
        if (!seen[edge.to]) {
          seen[edge.to] = true;
          stack.push(edge.to);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

function nodeKey(p: LatLng): string {
  return `${p.lat.toFixed(NODE_KEY_DECIMALS)}:${p.lng.toFixed(NODE_KEY_DECIMALS)}`;
}

function chainKey(a: LatLng, b: LatLng): string {
  return `${nodeKey(a)}|${nodeKey(b)}`;
}

interface BuildSeg {
  a: LatLng;
  b: LatLng;
  am: XYMeters;
  bm: XYMeters;
  lenMeters: number;
  /** t-параметры разрезов (перекрёстки/примыкания), 0..1 вдоль a→b. */
  cuts: number[];
}

interface TouchBridge {
  vertex: LatLng;
  segIndex: number;
  t: number;
}

/** Мостик наложения: точка t на сегменте A ↔ проекция на сегменте B (та же дорога). */
interface OverlapBridge {
  segA: number;
  tA: number;
  segB: number;
  tB: number;
}

/** Видимое пересечение впритык к концу палки: каноническое короткое road-ребро. */
interface NearIntersectionBridge {
  from: LatLng;
  to: LatLng;
}

interface CutBridges {
  touches: TouchBridge[];
  overlaps: OverlapBridge[];
  nearIntersections: NearIntersectionBridge[];
}

export function buildRoadGraph(roads: MapRoad[], weldMeters = DEFAULT_WELD_METERS): RoadGraph {
  const segs: BuildSeg[] = [];
  const segRoadOf: number[] = [];
  const endpoints: Array<{ p: LatLng; road: number }> = [];
  const roadEnds: LatLng[] = [];
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const v = roads[roadIndex]!.vertices;
    if (v.length < 2) continue;
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i]!;
      const b = v[i + 1]!;
      const lenMeters = distanceMeters(a, b);
      segs.push({ a, b, am: latLngToMeters(a), bm: latLngToMeters(b), lenMeters, cuts: [] });
      segRoadOf.push(roadIndex);
    }
    // Близкое T-примыкание может образовывать только КОНЕЦ ветки. Обычная
    // промежуточная вершина рядом с параллельным проездом не означает съезд:
    // прежнее правило создавало невидимые поперечные мосты и треугольники пути.
    endpoints.push({ p: v[0]!, road: roadIndex }, { p: v[v.length - 1]!, road: roadIndex });
    roadEnds.push(v[0]!, v[v.length - 1]!);
  }

  const { touches, overlaps, nearIntersections } = computeCutsAndBridges(segs, segRoadOf, endpoints);

  // ── Сборка узлов/рёбер: каждый сегмент — цепочка «конец, разрезы…, конец». ──
  const nodes: LatLng[] = [];
  const keyToNode = new Map<string, number>();
  const adj: RoadGraphEdge[][] = [];
  const edgeCounts: Record<RoadGraphEdgeKind, number> = { road: 0, touch: 0, overlap: 0, weld: 0 };

  const addNode = (p: LatLng): number => {
    const key = nodeKey(p);
    const existing = keyToNode.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push(p);
    keyToNode.set(key, index);
    adj.push([]);
    return index;
  };
  const addEdge = (a: number, b: number, w: number, kind: RoadGraphEdgeKind): void => {
    if (a === b || !Number.isFinite(w)) return;
    const existing = adj[a]!.find((e) => e.to === b);
    if (existing) {
      // Физическое ребро всегда важнее виртуального дубля между теми же узлами.
      if (kind === 'road' && existing.kind !== 'road') {
        edgeCounts[existing.kind] -= 1;
        edgeCounts.road += 1;
        existing.kind = 'road';
        existing.w = w;
        const reverse = adj[b]!.find((e) => e.to === a);
        if (reverse) { reverse.kind = 'road'; reverse.w = w; }
      }
      return;
    }
    adj[a]!.push({ to: b, w, kind });
    adj[b]!.push({ to: a, w, kind });
    edgeCounts[kind] += 1;
  };

  const chains = new Map<string, { nodes: number[]; offs: number[] }>();
  for (const seg of segs) {
    const ts = dedupeCutTs(seg.cuts, seg.lenMeters);
    const chainNodes: number[] = [];
    const offs: number[] = [];
    let prevNode = -1;
    let prevT = 0;
    for (const t of ts) {
      const p = t <= 0 ? seg.a : t >= 1 ? seg.b : lerpLatLng(seg.a, seg.b, t);
      const n = addNode(p);
      if (prevNode >= 0 && n !== prevNode) addEdge(prevNode, n, seg.lenMeters * (t - prevT), 'road');
      if (chainNodes[chainNodes.length - 1] !== n) {
        chainNodes.push(n);
        offs.push(seg.lenMeters * t);
      }
      prevNode = n;
      prevT = t;
    }
    chains.set(chainKey(seg.a, seg.b), { nodes: chainNodes, offs });
  }

  // Пересечение ближе 0.6 м к концу сегмента раньше терялось: cut у конца
  // отбрасывался, а endpoint и intersection имели разные nodeKey. Визуально
  // жёлтые палки соединены, но граф отправлял маршрут к следующему узлу ниже.
  // Соединяем только этот субметровый видимый стык физическим road-ребром.
  for (const bridge of nearIntersections) {
    const from = addNode(bridge.from);
    const to = addNode(bridge.to);
    addEdge(from, to, Math.max(0.01, distanceMeters(bridge.from, bridge.to)), 'road');
  }

  // T-примыкания: вершина одной дороги ↔ узел-разрез на полотне другой.
  for (const br of touches) {
    const seg = segs[br.segIndex]!;
    const chain = chains.get(chainKey(seg.a, seg.b));
    if (!chain) continue;
    const off = seg.lenMeters * br.t;
    const at = nearestChainIndex(chain.offs, off);
    if (at < 0) continue;
    const vNode = addNode(br.vertex);
    addEdge(vNode, chain.nodes[at]!, Math.max(0.01, distanceMeters(br.vertex, nodes[chain.nodes[at]!]!)), 'touch');
  }

  // Мостики наложений: узел-разрез на одной линии ↔ узел-разрез на её «двойнике».
  // Переход возможен ВДОЛЬ ВСЕГО наложения (не только через конец палки), но с
  // наценкой ×3: мост — связность для матчинга, а не «срезка» для кратчайшего
  // пути, иначе след виляет между копиями и рисует лишние углы.
  for (const ob of overlaps) {
    const na = chainNodeAtOffset(chains, segs[ob.segA]!, ob.tA);
    const nb = chainNodeAtOffset(chains, segs[ob.segB]!, ob.tB);
    if (na === undefined || nb === undefined || na === nb) continue;
    addEdge(na, nb, Math.max(0.4, distanceMeters(nodes[na]!, nodes[nb]!) * OVERLAP_BRIDGE_WEIGHT_FACTOR), 'overlap');
  }

  // Weld: «отлипшие» концы дорог, не дотянутые друг до друга (≤ weldMeters),
  // соединяем ребром — единая паутина (даже если геометрия не сшита вплотную).
  const endpointNodes = roadEnds.map((p) => keyToNode.get(nodeKey(p))).filter((n): n is number => n !== undefined);
  weldEndpoints(nodes, adj, addEdge, endpointNodes, weldMeters);

  const strictSizes = componentSizes(adj, true);
  const virtualConnectors = adj.flatMap((edges, from) => edges.flatMap((edge) => (
    edge.to > from && edge.kind !== 'road'
      ? [{ kind: edge.kind, fromNode: from, toNode: edge.to, from: nodes[from]!, to: nodes[edge.to]!, meters: distanceMeters(nodes[from]!, nodes[edge.to]!) }]
      : []
  )));
  return {
    nodes,
    adj,
    keyToNode,
    chains,
    distCache: new Map(),
    version: roadGeometryVersion(roads),
    diagnostics: {
      roadEdges: edgeCounts.road,
      touchEdges: edgeCounts.touch,
      overlapEdges: edgeCounts.overlap,
      weldEdges: edgeCounts.weld,
      strictComponents: strictSizes.length,
      strictLargest: strictSizes.slice(0, 12),
      virtualConnectors,
    },
  };
}

/**
 * Разрезы сегментов: X-пересечения пар сегментов + примыкания (вершина одной
 * дороги у полотна другой) + наложения почти параллельных линий («палка на
 * палку» = та же дорога). Кандидаты пар — через ячейки, чтобы не идти O(n²).
 */
function computeCutsAndBridges(
  segs: BuildSeg[],
  segRoadOf: number[],
  endpoints: Array<{ p: LatLng; road: number }>,
): CutBridges {
  const midLat = segs[0]?.a.lat ?? 57.92;
  const cellLat = CUT_CELL_METERS * LAT_DEG_PER_METER;
  const cellLng = cellLat / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const grid = new Map<string, number[]>();

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const r0 = Math.floor(Math.min(seg.a.lat, seg.b.lat) / cellLat);
    const r1 = Math.floor(Math.max(seg.a.lat, seg.b.lat) / cellLat);
    const c0 = Math.floor(Math.min(seg.a.lng, seg.b.lng) / cellLng);
    const c1 = Math.floor(Math.max(seg.a.lng, seg.b.lng) / cellLng);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${r}:${c}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
    }
  }

  // X-пересечения + наложения: пары сегментов из одной ячейки. Пары с ОБЩЕЙ
  // вершиной уже связаны узлом — ни разрезы, ни мосты им не нужны (мост поперёк
  // плавного поворота срезал бы угол хордой). Наложение проверяем только между
  // РАЗНЫМИ линиями. Своя полилиния уже связана по вершинам; мост внутри неё
  // создаёт ложный короткий путь через изгиб и рисует углы на истории.
  const overlaps: OverlapBridge[] = [];
  const nearIntersections: NearIntersectionBridge[] = [];
  const seenPairs = new Set<number>();
  for (const bucket of grid.values()) {
    for (let x = 0; x < bucket.length; x++) {
      for (let y = x + 1; y < bucket.length; y++) {
        const i = bucket[x]!;
        const j = bucket[y]!;
        const pairKey = i < j ? i * segs.length + j : j * segs.length + i;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const s1 = segs[i]!;
        const s2 = segs[j]!;
        if (sharesEndpoint(s1, s2)) continue;
        const hit = segmentIntersectionT(s1.am, s1.bm, s2.am, s2.bm);
        if (hit) {
          pushCut(s1, hit.t);
          pushCut(s2, hit.u);
          const intersection = lerpLatLng(s1.a, s1.b, hit.t);
          const s1End = nearCutEndpoint(s1, hit.t);
          const s2End = nearCutEndpoint(s2, hit.u);
          if (s1End && distanceMeters(s1End, intersection) > 0.01) {
            nearIntersections.push({ from: s1End, to: intersection });
          }
          if (s2End && distanceMeters(s2End, intersection) > 0.01) {
            nearIntersections.push({ from: s2End, to: intersection });
          }
          continue;
        }
        if (segRoadOf[i] === segRoadOf[j]) continue;
        collectOverlapBridges(s1, i, s2, j, overlaps);
      }
    }
  }

  // Примыкания: вершина дороги у ИНТЕРЬЕРА чужого сегмента (≤ TOUCH_METERS) —
  // режем чужой сегмент в проекции и потом соединяем мостиком.
  const bridges: TouchBridge[] = [];
  for (const { p, road } of endpoints) {
    const pm = latLngToMeters(p);
    const r0 = Math.floor(p.lat / cellLat);
    const c0 = Math.floor(p.lng / cellLng);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const i of grid.get(`${r0 + dr}:${c0 + dc}`) ?? []) {
          if (segRoadOf[i] === road) continue; // своя дорога — связана через вершины
          const seg = segs[i]!;
          const proj = projectOnSegment(pm, seg.am, seg.bm);
          if (proj.distance > TOUCH_METERS) continue;
          const offMeters = proj.t * seg.lenMeters;
          if (offMeters < CUT_MIN_END_METERS || seg.lenMeters - offMeters < CUT_MIN_END_METERS) continue;
          pushCut(seg, proj.t);
          bridges.push({ vertex: p, segIndex: i, t: proj.t });
        }
      }
    }
  }
  return { touches: bridges, overlaps, nearIntersections };
}

function nearCutEndpoint(seg: BuildSeg, t: number): LatLng | null {
  const fromA = t * seg.lenMeters;
  const fromB = (1 - t) * seg.lenMeters;
  if (fromA < CUT_MIN_END_METERS) return seg.a;
  if (fromB < CUT_MIN_END_METERS) return seg.b;
  return null;
}

/**
 * Наложение почти параллельных сегментов: сэмплируем КОРОТКИЙ с шагом ~7 м,
 * проецируем на длинный; где боком ≤ OVERLAP_METERS — режем оба и запоминаем
 * пару под мостик. Настоящие соседние проезды (дальше 3 м) не задеваются.
 */
function collectOverlapBridges(s1: BuildSeg, i: number, s2: BuildSeg, j: number, out: OverlapBridge[]): void {
  if (s1.lenMeters < 0.5 || s2.lenMeters < 0.5) return;
  const d1x = (s1.bm.x - s1.am.x) / s1.lenMeters;
  const d1y = (s1.bm.y - s1.am.y) / s1.lenMeters;
  const d2x = (s2.bm.x - s2.am.x) / s2.lenMeters;
  const d2y = (s2.bm.y - s2.am.y) / s2.lenMeters;
  if (Math.abs(d1x * d2x + d1y * d2y) < OVERLAP_ANGLE_COS) return;

  const [shortSeg, shortIdx, longSeg, longIdx] = s1.lenMeters <= s2.lenMeters
    ? [s1, i, s2, j] as const
    : [s2, j, s1, i] as const;
  const steps = Math.max(1, Math.round(shortSeg.lenMeters / OVERLAP_STEP_METERS));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const pm: XYMeters = {
      x: shortSeg.am.x + (shortSeg.bm.x - shortSeg.am.x) * t,
      y: shortSeg.am.y + (shortSeg.bm.y - shortSeg.am.y) * t,
    };
    const proj = projectOnSegment(pm, longSeg.am, longSeg.bm);
    if (proj.distance > OVERLAP_METERS) continue;
    pushCut(shortSeg, t);
    pushCut(longSeg, proj.t);
    out.push({ segA: shortIdx, tA: t, segB: longIdx, tB: proj.t });
  }
}

/** Узел цепочки сегмента, ближайший к офсету t·len (для посадки мостика). */
function chainNodeAtOffset(
  chains: Map<string, { nodes: number[]; offs: number[] }>,
  seg: BuildSeg,
  t: number,
): number | undefined {
  const chain = chains.get(chainKey(seg.a, seg.b));
  if (!chain || chain.nodes.length === 0) return undefined;
  const off = seg.lenMeters * t;
  let best = -1;
  let bestDelta = Infinity;
  for (let k = 0; k < chain.offs.length; k++) {
    const delta = Math.abs(chain.offs[k]! - off);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = k;
    }
  }
  return best >= 0 && bestDelta <= OVERLAP_NODE_TOLERANCE_METERS ? chain.nodes[best] : undefined;
}

function sharesEndpoint(s1: BuildSeg, s2: BuildSeg): boolean {
  const k1a = nodeKey(s1.a);
  const k1b = nodeKey(s1.b);
  const k2a = nodeKey(s2.a);
  const k2b = nodeKey(s2.b);
  return k1a === k2a || k1a === k2b || k1b === k2a || k1b === k2b;
}

function pushCut(seg: BuildSeg, t: number): void {
  if (seg.lenMeters <= CUT_MIN_END_METERS * 2) return;
  const minT = CUT_MIN_END_METERS / seg.lenMeters;
  if (t <= minT || t >= 1 - minT) return;
  seg.cuts.push(t);
}

/** Пересечение отрезков в метрах: t на первом, u на втором (строго внутри). */
function segmentIntersectionT(p1: XYMeters, p2: XYMeters, p3: XYMeters, p4: XYMeters): { t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  const len1 = Math.hypot(d1x, d1y);
  const len2 = Math.hypot(d2x, d2y);
  if (len1 < 0.05 || len2 < 0.05) return null;
  if (Math.abs(denom) < len1 * len2 * 1e-6) return null; // параллельные/коллинеарные
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

function projectOnSegment(p: XYMeters, a: XYMeters, b: XYMeters): { t: number; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-9) return { t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return { t, distance: Math.hypot(p.x - x, p.y - y) };
}

function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Сортировка + дедуп разрезов (ближе CUT_MIN_END_METERS слипаются) + концы 0/1. */
function dedupeCutTs(cuts: number[], lenMeters: number): number[] {
  const minGapT = lenMeters > 0 ? CUT_MIN_END_METERS / lenMeters : 1;
  const sorted = [...cuts].sort((x, y) => x - y);
  const ts: number[] = [0];
  for (const t of sorted) {
    if (t - ts[ts.length - 1]! >= minGapT && 1 - t >= minGapT) ts.push(t);
  }
  ts.push(1);
  return ts;
}

function nearestChainIndex(offs: number[], off: number): number {
  let best = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < offs.length; i++) {
    const delta = Math.abs(offs[i]! - off);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return bestDelta <= CUT_MIN_END_METERS + 0.05 ? best : -1;
}

function weldEndpoints(
  nodes: LatLng[],
  adj: RoadGraphEdge[][],
  addEdge: (a: number, b: number, w: number, kind: RoadGraphEdgeKind) => void,
  endpointNodes: number[],
  weldMeters: number,
): void {
  const cellLat = WELD_CELL_METERS * LAT_DEG_PER_METER;
  const midLat = nodes[0]?.lat ?? 57.92;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const cellLng = cellLat / cosLat;
  const grid = new Map<string, number[]>();
  const cell = (p: LatLng) => `${Math.floor(p.lat / cellLat)}:${Math.floor(p.lng / cellLng)}`;
  // индексируем ВСЕ узлы (конец дороги может стыковаться с серединой другой у вершины)
  for (let i = 0; i < nodes.length; i++) {
    const key = cell(nodes[i]!);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i); else grid.set(key, [i]);
  }
  const seen = new Set<number>();
  for (const ep of endpointNodes) {
    if (seen.has(ep)) continue;
    seen.add(ep);
    const p = nodes[ep]!;
    const r0 = Math.floor(p.lat / cellLat);
    const c0 = Math.floor(p.lng / cellLng);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const j of grid.get(`${r0 + dr}:${c0 + dc}`) ?? []) {
          if (j === ep) continue;
          const d = distanceMeters(p, nodes[j]!);
          if (d > weldMeters) continue;
          // At drawing precision a sub-metre endpoint gap is still the same
          // visible yellow junction. Keep wider proximity welds diagnostic-only,
          // but make this tiny connector part of the strict routable geometry.
          addEdge(ep, j, d, d <= CUT_MIN_END_METERS + 0.05 ? 'road' : 'weld');
        }
      }
    }
  }
}

/** Узел графа для вершины дороги (концы сегмента ищем по точному ключу). */
export function graphNodeOf(graph: RoadGraph, vertex: LatLng): number | undefined {
  return graph.keyToNode.get(nodeKey(vertex));
}

/**
 * Входы в граф для посадки на сегмент a→b с офсетом offA от a: два СОСЕДНИХ узла
 * цепочки (включая узлы-перекрёстки), между которыми лежит точка. Раньше входами
 * были только КОНЦЫ сегмента — путь «не видел» перекрёсток посреди сегмента.
 */
export function graphEntriesForHit(graph: RoadGraph, e: Omit<RoadGraphHitEntry, 'point'>): RoadGraphEntry[] {
  const chain = graph.chains.get(chainKey(e.a, e.b));
  if (chain && chain.nodes.length > 0) {
    const offs = chain.offs;
    let i = 0;
    while (i < offs.length - 1 && offs[i + 1]! <= e.offA) i++;
    const out: RoadGraphEntry[] = [{ node: chain.nodes[i]!, off: Math.max(0, Math.abs(e.offA - offs[i]!)) }];
    if (i + 1 < chain.nodes.length) out.push({ node: chain.nodes[i + 1]!, off: Math.max(0, Math.abs(offs[i + 1]! - e.offA)) });
    return out;
  }
  // Фоллбэк: сегмент не из этого графа — входим через концы по ключу.
  const out: RoadGraphEntry[] = [];
  const na = graph.keyToNode.get(nodeKey(e.a));
  const nb = graph.keyToNode.get(nodeKey(e.b));
  if (na !== undefined) out.push({ node: na, off: e.offA });
  if (nb !== undefined) out.push({ node: nb, off: e.offB });
  return out;
}

/** Входы в граф для точки, спроецированной на сегмент a→b (для маршрутов). */
export function graphEntriesForSegment(graph: RoadGraph, a: LatLng, b: LatLng, point: LatLng): RoadGraphEntry[] {
  const segLen = distanceMeters(a, b);
  const offA = Math.min(segLen, distanceMeters(a, point));
  return graphEntriesForHit(graph, { a, b, offA, offB: Math.max(0, segLen - offA) });
}

/** Ограниченный Дейкстра только по ВИДИМЫМ жёлтым рёбрам, до CAP. */
function distancesFrom(graph: RoadGraph, src: number): Map<number, number> {
  const cached = graph.distCache.get(src);
  if (cached) return cached;
  const dist = new Map<number, number>();
  dist.set(src, 0);
  // простая очередь с приоритетом на массиве (сеть локальная, cap маленький)
  const heap: Array<{ node: number; d: number }> = [{ node: src, d: 0 }];
  while (heap.length > 0) {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i]!.d < heap[bi]!.d) bi = i;
    const { node, d } = heap.splice(bi, 1)[0]!;
    if (d > (dist.get(node) ?? Infinity)) continue;
    if (d > DIJKSTRA_CAP_METERS) continue;
    for (const edge of graph.adj[node]!) {
      // touch/overlap/weld — только кандидаты диагностики старой геометрии.
      // Если жёлтого ребра нет на карте, PRO/маршрут использовать его не может.
      if (edge.kind !== 'road') continue;
      const nd = d + edge.w;
      if (nd <= DIJKSTRA_CAP_METERS && nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        heap.push({ node: edge.to, d: nd });
      }
    }
  }
  graph.distCache.set(src, dist);
  return dist;
}

function sameSegment(a: Omit<RoadGraphHitEntry, 'point'>, b: Omit<RoadGraphHitEntry, 'point'>): boolean {
  return nodeKey(a.a) === nodeKey(b.a) && nodeKey(a.b) === nodeKey(b.b);
}

/**
 * Расстояние ПО ДОРОГЕ между двумя посадками (каждая — проекция на сегмент a–b с
 * оффсетами до концов). Возвращает Infinity, если по сети недостижимо в пределах
 * CAP (тогда переход штрафуется как «перепрыгнул», а не проехал).
 */
export function roadGraphDistance(
  graph: RoadGraph,
  prev: Omit<RoadGraphHitEntry, 'point'>,
  cur: Omit<RoadGraphHitEntry, 'point'>,
): number {
  let best = Infinity;
  // тот же сегмент — расстояние вдоль сегмента напрямую
  if (sameSegment(prev, cur)) best = Math.abs(prev.offA - cur.offA);
  const pEntries = graphEntriesForHit(graph, prev);
  const cEntries = graphEntriesForHit(graph, cur);
  for (const pe of pEntries) {
    const from = distancesFrom(graph, pe.node);
    for (const ce of cEntries) {
      const mid = pe.node === ce.node ? 0 : from.get(ce.node);
      if (mid === undefined) continue;
      const total = pe.off + mid + ce.off;
      if (total < best) best = total;
    }
  }
  return best;
}

/**
 * Реальный путь ПО ПАУТИНЕ между двумя посадками. Используется для отрисовки:
 * если HMM выбрал две дорожные точки, синий след идёт по центру жёлтой дороги,
 * а не прямым срезом между ними.
 */
export function roadGraphPath(graph: RoadGraph, prev: RoadGraphHitEntry, cur: RoadGraphHitEntry): LatLng[] | null {
  // Оба попадания лежат на одном и том же сегменте: едем прямо вдоль центра
  // этого сегмента. Иначе кратчайший путь через узлы мог бы сходить к концу
  // сегмента и возвращаться, что визуально выглядит как маленький карман.
  if (sameSegment(prev, cur) || sameSegment(prev, { a: cur.b, b: cur.a, offA: cur.offB, offB: cur.offA })) {
    return cleanupPath([prev.point, cur.point]);
  }

  let best: { distance: number; nodes: number[] } | null = null;
  for (const pe of graphEntriesForHit(graph, prev)) {
    for (const ce of graphEntriesForHit(graph, cur)) {
      // PRO-полилиния может идти только по ФИЗИЧЕСКИМ жёлтым рёбрам. Виртуальные
      // touch/overlap/weld нужны лишь для диагностики старого рисунка; рисовать
      // их прямым стежком нельзя — это и были диагонали у развилок.
      const nodePath = shortestNodePath(graph, pe.node, ce.node, true);
      if (!nodePath) continue;
      const pathDistance = nodePath.distance + pe.off + ce.off;
      if (!best || pathDistance < best.distance) best = { distance: pathDistance, nodes: nodePath.nodes };
    }
  }
  if (!best || best.nodes.length === 0) return null;
  const points: LatLng[] = [prev.point, ...best.nodes.map((node) => graph.nodes[node]!), cur.point];
  return cleanupPath(points);
}

function shortestNodePath(
  graph: RoadGraph,
  src: number,
  dst: number,
  roadOnly = false,
): { distance: number; nodes: number[] } | null {
  if (src === dst) return { distance: 0, nodes: [src] };
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  dist.set(src, 0);
  const heap: Array<{ node: number; d: number }> = [{ node: src, d: 0 }];
  while (heap.length > 0) {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i]!.d < heap[bi]!.d) bi = i;
    const { node, d } = heap.splice(bi, 1)[0]!;
    if (d > (dist.get(node) ?? Infinity)) continue;
    if (node === dst) break;
    if (d > DIJKSTRA_CAP_METERS) continue;
    for (const edge of graph.adj[node]!) {
      if (roadOnly && edge.kind !== 'road') continue;
      const nd = d + edge.w;
      if (nd <= DIJKSTRA_CAP_METERS && nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, node);
        heap.push({ node: edge.to, d: nd });
      }
    }
  }
  const distance = dist.get(dst);
  if (distance === undefined) return null;
  const nodes = [dst];
  let cur = dst;
  while (cur !== src) {
    const p = prev.get(cur);
    if (p === undefined) return null;
    nodes.push(p);
    cur = p;
  }
  nodes.reverse();
  return { distance, nodes };
}

function cleanupPath(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || distanceMeters(prev, point) > 0.35) out.push(point);
  }
  return out;
}
