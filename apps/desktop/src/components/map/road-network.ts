import { distanceMeters, latLngToMeters, metersToLatLng, nearestPointOnPolyline, polylineLengthMeters, type XYMeters } from './geo';
import { makeId, type LatLng, type MapRoad, type MapRoadSuggestion } from './map-types';

const DEFAULT_NODE_SNAP_TOLERANCE_METERS = 2.5;
const DEFAULT_SEGMENT_SNAP_TOLERANCE_METERS = 5;
const DEFAULT_SIMPLIFY_TOLERANCE_METERS = 1.4;
const DUPLICATE_VERTEX_TOLERANCE_METERS = 0.75;
const SEGMENT_INTERSECTION_EPSILON = 1e-7;

interface StitchRoadOptions {
  /** Узлы ближе этого расстояния считаем одним узлом сети. */
  nodeSnapToleranceMeters?: number;
  /** Конец линии можно притянуть к середине соседнего сегмента. */
  segmentSnapToleranceMeters?: number;
  /** Убирает дрожание руки, оставляя форму дороги. */
  simplifyToleranceMeters?: number;
}

type MergeCandidate = {
  dist: number;
  left: LatLng[];
  right: LatLng[];
};

type IntersectionInsertion = {
  segmentIndex: number;
  t: number;
  point: LatLng;
};

/**
 * Сшивает близко соприкасающиеся линии дорог в одну ломаную.
 * Это не визуальный эффект: после сшивки дорога хранится как единая линия сети.
 */
export function stitchRoadSegments(
  roads: MapRoad[],
  options: StitchRoadOptions = {},
): MapRoad[] {
  const nodeSnapToleranceMeters = options.nodeSnapToleranceMeters ?? DEFAULT_NODE_SNAP_TOLERANCE_METERS;
  const segmentSnapToleranceMeters = options.segmentSnapToleranceMeters ?? DEFAULT_SEGMENT_SNAP_TOLERANCE_METERS;
  const simplifyToleranceMeters = options.simplifyToleranceMeters ?? DEFAULT_SIMPLIFY_TOLERANCE_METERS;
  let result = roads
    .map((road) => ({
      ...road,
      vertices: normalizeVertices(road.vertices, simplifyToleranceMeters),
    }))
    .filter((road) => road.vertices.length >= 2);

  result = splitRoadIntersections(result);
  result = snapRoadEndpointsToNetwork(result, nodeSnapToleranceMeters, segmentSnapToleranceMeters);

  let changed = true;
  while (changed) {
    changed = false;

    outer:
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const merged = tryMergeRoads(result[i]!, result[j]!, nodeSnapToleranceMeters);
        if (!merged) continue;
        result = [
          ...result.slice(0, i),
          merged,
          ...result.slice(i + 1, j),
          ...result.slice(j + 1),
        ];
        changed = true;
        break outer;
      }
    }
  }

  // НЕ упрощаем (Douglas-Peucker) в конце: дрожание уже убрано в самом начале, а
  // узлы пересечений/стыков лежат на прямой и DP их выкинул бы — тогда дороги
  // визуально пересекаются, но в графе НЕ связаны (ломает будущий авто-маршрут).
  // Здесь только дедуп совпадающих точек.
  return result.map((road) => ({ ...road, vertices: cleanupVertices(road.vertices) }));
}

function splitRoadIntersections(roads: MapRoad[]): MapRoad[] {
  const insertions = roads.map(() => [] as IntersectionInsertion[]);

  for (let roadA = 0; roadA < roads.length; roadA++) {
    const verticesA = roads[roadA]!.vertices;
    for (let roadB = roadA + 1; roadB < roads.length; roadB++) {
      const verticesB = roads[roadB]!.vertices;
      for (let segmentA = 0; segmentA < verticesA.length - 1; segmentA++) {
        const a0 = verticesA[segmentA]!;
        const a1 = verticesA[segmentA + 1]!;
        const am0 = latLngToMeters(a0);
        const am1 = latLngToMeters(a1);
        for (let segmentB = 0; segmentB < verticesB.length - 1; segmentB++) {
          const b0 = verticesB[segmentB]!;
          const b1 = verticesB[segmentB + 1]!;
          const hit = segmentIntersection(am0, am1, latLngToMeters(b0), latLngToMeters(b1));
          if (!hit) continue;
          const point = metersToLatLng({ x: hit.x, y: hit.y });
          insertions[roadA]!.push({ segmentIndex: segmentA, t: hit.tA, point });
          insertions[roadB]!.push({ segmentIndex: segmentB, t: hit.tB, point });
        }
      }
    }
  }

  return roads.map((road, index) => {
    const nextVertices = applyIntersectionInsertions(road.vertices, insertions[index]!);
    return { ...road, vertices: nextVertices };
  });
}

function applyIntersectionInsertions(vertices: LatLng[], insertions: IntersectionInsertion[]): LatLng[] {
  if (insertions.length === 0) return vertices;

  const bySegment = new Map<number, IntersectionInsertion[]>();
  for (const insertion of insertions) {
    const list = bySegment.get(insertion.segmentIndex) ?? [];
    list.push(insertion);
    bySegment.set(insertion.segmentIndex, list);
  }

  const result: LatLng[] = [];
  for (let segmentIndex = 0; segmentIndex < vertices.length - 1; segmentIndex++) {
    if (result.length === 0) result.push(vertices[segmentIndex]!);
    const segmentInsertions = (bySegment.get(segmentIndex) ?? []).sort((a, b) => a.t - b.t);
    for (const insertion of segmentInsertions) {
      pushIfDistinct(result, insertion.point);
    }
    pushIfDistinct(result, vertices[segmentIndex + 1]!);
  }
  return cleanupVertices(result);
}

function segmentIntersection(
  a0: XYMeters,
  a1: XYMeters,
  b0: XYMeters,
  b1: XYMeters,
): (XYMeters & { tA: number; tB: number }) | null {
  const rx = a1.x - a0.x;
  const ry = a1.y - a0.y;
  const sx = b1.x - b0.x;
  const sy = b1.y - b0.y;
  const denom = cross(rx, ry, sx, sy);
  if (Math.abs(denom) < SEGMENT_INTERSECTION_EPSILON) return null;

  const qpx = b0.x - a0.x;
  const qpy = b0.y - a0.y;
  const tA = cross(qpx, qpy, sx, sy) / denom;
  const tB = cross(qpx, qpy, rx, ry) / denom;
  if (tA < -SEGMENT_INTERSECTION_EPSILON || tA > 1 + SEGMENT_INTERSECTION_EPSILON) return null;
  if (tB < -SEGMENT_INTERSECTION_EPSILON || tB > 1 + SEGMENT_INTERSECTION_EPSILON) return null;

  return {
    x: a0.x + tA * rx,
    y: a0.y + tA * ry,
    tA: Math.max(0, Math.min(1, tA)),
    tB: Math.max(0, Math.min(1, tB)),
  };
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function tryMergeRoads(
  a: MapRoad,
  b: MapRoad,
  toleranceMeters: number,
): MapRoad | null {
  const av = a.vertices;
  const bv = b.vertices;
  const aStart = av[0]!;
  const aEnd = av[av.length - 1]!;
  const bStart = bv[0]!;
  const bEnd = bv[bv.length - 1]!;

  const candidates: MergeCandidate[] = [
    { dist: distanceMeters(aEnd, bStart), left: av, right: bv },
    { dist: distanceMeters(aStart, bEnd), left: bv, right: av },
    { dist: distanceMeters(aStart, bStart), left: [...av].reverse(), right: bv },
    { dist: distanceMeters(aEnd, bEnd), left: av, right: [...bv].reverse() },
  ].sort((x, y) => x.dist - y.dist);

  const best = candidates[0]!;
  if (best.dist > toleranceMeters) return null;

  const join = midpoint(best.left[best.left.length - 1]!, best.right[0]!);
  // cleanup (дедуп), но без DP-упрощения — иначе теряются узлы стыков на прямой.
  const vertices = cleanupVertices([
    ...best.left.slice(0, -1),
    join,
    ...best.right.slice(1),
  ]);

  if (vertices.length < 2) return null;
  return {
    id: a.id,
    name: a.name.trim() || b.name.trim(),
    sourceId: a.sourceId || b.sourceId,
    vertices,
  };
}

function snapRoadEndpointsToNetwork(
  roads: MapRoad[],
  nodeToleranceMeters: number,
  segmentToleranceMeters: number,
): MapRoad[] {
  let result = roads.map((road) => ({ ...road, vertices: [...road.vertices] }));

  for (let i = 0; i < result.length; i++) {
    const road = result[i]!;
    for (const endpointIndex of [0, road.vertices.length - 1]) {
      const endpoint = road.vertices[endpointIndex]!;
      const snap = findBestSnap(result, i, endpoint, nodeToleranceMeters, segmentToleranceMeters);
      if (!snap) continue;

      road.vertices[endpointIndex] = snap.point;
      if (snap.kind === 'segment') {
        const target = result[snap.roadIndex]!;
        const nextVertices = [...target.vertices];
        const insertAt = snap.segmentIndex + 1;
        const prev = nextVertices[snap.segmentIndex]!;
        const next = nextVertices[insertAt]!;
        if (distanceMeters(prev, snap.point) > DUPLICATE_VERTEX_TOLERANCE_METERS && distanceMeters(next, snap.point) > DUPLICATE_VERTEX_TOLERANCE_METERS) {
          nextVertices.splice(insertAt, 0, snap.point);
          result[snap.roadIndex] = { ...target, vertices: nextVertices };
        }
      }
    }
  }

  result = collapseNearbyVertices(result, nodeToleranceMeters);
  return result.map((road) => ({ ...road, vertices: cleanupVertices(road.vertices) }));
}

function findBestSnap(
  roads: MapRoad[],
  currentRoadIndex: number,
  endpoint: LatLng,
  nodeToleranceMeters: number,
  segmentToleranceMeters: number,
): { kind: 'node' | 'segment'; roadIndex: number; segmentIndex: number; point: LatLng; dist: number } | null {
  let best: { kind: 'node' | 'segment'; roadIndex: number; segmentIndex: number; point: LatLng; dist: number } | null = null;
  const endpointMeters = latLngToMeters(endpoint);

  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const road = roads[roadIndex]!;
    for (let vertexIndex = 0; vertexIndex < road.vertices.length; vertexIndex++) {
      if (roadIndex === currentRoadIndex && (vertexIndex === 0 || vertexIndex === road.vertices.length - 1)) continue;
      const vertex = road.vertices[vertexIndex]!;
      const dist = distanceMeters(endpoint, vertex);
      if (dist <= nodeToleranceMeters && (!best || dist < best.dist)) {
        best = { kind: 'node', roadIndex, segmentIndex: Math.max(0, vertexIndex - 1), point: vertex, dist };
      }
    }

    for (let segmentIndex = 0; segmentIndex < road.vertices.length - 1; segmentIndex++) {
      if (roadIndex === currentRoadIndex) continue;
      const projected = nearestOnSegment(endpointMeters, latLngToMeters(road.vertices[segmentIndex]!), latLngToMeters(road.vertices[segmentIndex + 1]!));
      if (projected.t <= 0.04 || projected.t >= 0.96) continue;
      if (projected.dist <= segmentToleranceMeters && (!best || projected.dist < best.dist)) {
        best = {
          kind: 'segment',
          roadIndex,
          segmentIndex,
          point: metersToLatLng({ x: projected.x, y: projected.y }),
          dist: projected.dist,
        };
      }
    }
  }

  return best;
}

function collapseNearbyVertices(roads: MapRoad[], toleranceMeters: number): MapRoad[] {
  const clusters: LatLng[][] = [];
  for (const road of roads) {
    for (const vertex of road.vertices) {
      const cluster = clusters.find((items) => items.some((item) => distanceMeters(item, vertex) <= toleranceMeters));
      if (cluster) cluster.push(vertex);
      else clusters.push([vertex]);
    }
  }

  const centers = clusters.map((items) => ({
    items,
    point: averagePoint(items),
  }));

  return roads.map((road) => ({
    ...road,
    vertices: cleanupVertices(road.vertices.map((vertex) => {
      const hit = centers.find((cluster) => cluster.items.includes(vertex));
      return hit?.point ?? vertex;
    })),
  }));
}

function normalizeVertices(vertices: LatLng[], simplifyToleranceMeters: number): LatLng[] {
  return cleanupVertices(simplifyPolyline(cleanupVertices(vertices), simplifyToleranceMeters));
}

// ─── Подтверждение красной линии (точная геометрия, без «рисования заново») ────

const CONFIRM_SNAP_TOLERANCE_METERS = 16;
const MIN_LEFTOVER_SUGGESTION_LENGTH_METERS = 6;

interface PolyPos { segmentIndex: number; t: number; arc: number }

function cumulativeArcs(poly: LatLng[]): number[] {
  const arcs = [0];
  for (let i = 0; i < poly.length - 1; i++) arcs.push(arcs[i]! + distanceMeters(poly[i]!, poly[i + 1]!));
  return arcs;
}
function posFromHit(arcs: number[], segmentIndex: number, t: number): PolyPos {
  const segLen = arcs[segmentIndex + 1]! - arcs[segmentIndex]!;
  return { segmentIndex, t, arc: arcs[segmentIndex]! + t * segLen };
}
function pointAtPos(poly: LatLng[], pos: PolyPos): LatLng {
  const a = poly[pos.segmentIndex]!;
  const b = poly[pos.segmentIndex + 1] ?? a;
  return { lat: a.lat + (b.lat - a.lat) * pos.t, lng: a.lng + (b.lng - a.lng) * pos.t };
}
/** Точная под-ломаная красной линии между двумя позициями (a.arc ≤ b.arc). */
function subPolyline(poly: LatLng[], a: PolyPos, b: PolyPos): LatLng[] {
  const out: LatLng[] = [pointAtPos(poly, a)];
  for (let i = a.segmentIndex + 1; i <= b.segmentIndex; i++) out.push(poly[i]!);
  out.push(pointAtPos(poly, b));
  return cleanupVertices(out);
}

/**
 * Подтверждение красной линии БЕЗ перерисовки: курсорная трасса лишь ВЫБИРАЕТ
 * участок красной, а в дорогу кладём её ТОЧНУЮ геометрию (вершины красной) между
 * спроецированными началом и концом трассы. Красная режется ровно в этих точках
 * на остатки (которые остаются красными) — без «разрыва» и без дублей при
 * повторном проходе (там красной уже нет). Продолжение соседнего участка
 * стыкуется ровно в той же вершине → дороги соединяются.
 */
export function confirmTraceToRoad(
  suggestions: MapRoadSuggestion[],
  trace: LatLng[],
): { roadVertices: LatLng[]; suggestions: MapRoadSuggestion[] } {
  if (trace.length < 2) return { roadVertices: trace, suggestions };

  // Красная линия с наибольшим покрытием трассой.
  let bestIdx = -1;
  let bestCovered = 0;
  suggestions.forEach((sug, idx) => {
    let covered = 0;
    for (const p of trace) {
      const hit = nearestPointOnPolyline(p, sug.vertices);
      if (hit && hit.distance <= CONFIRM_SNAP_TOLERANCE_METERS) covered++;
    }
    if (covered > bestCovered) { bestCovered = covered; bestIdx = idx; }
  });
  if (bestIdx < 0) return { roadVertices: trace, suggestions }; // красной рядом нет

  const sug = suggestions[bestIdx]!;
  const poly = sug.vertices;
  const startHit = nearestPointOnPolyline(trace[0]!, poly);
  const endHit = nearestPointOnPolyline(trace[trace.length - 1]!, poly);
  if (!startHit || !endHit || poly.length < 2) return { roadVertices: trace, suggestions };

  const arcs = cumulativeArcs(poly);
  let a = posFromHit(arcs, startHit.segmentIndex, startHit.t);
  let b = posFromHit(arcs, endHit.segmentIndex, endHit.t);
  if (a.arc > b.arc) { const tmp = a; a = b; b = tmp; }

  const roadVertices = subPolyline(poly, a, b);
  if (roadVertices.length < 2) return { roadVertices: trace, suggestions };

  const startPos: PolyPos = { segmentIndex: 0, t: 0, arc: 0 };
  const endPos: PolyPos = { segmentIndex: poly.length - 2, t: 1, arc: arcs[arcs.length - 1]! };
  const before = subPolyline(poly, startPos, a);
  const after = subPolyline(poly, b, endPos);
  const leftovers: MapRoadSuggestion[] = [];
  if (polylineLengthMeters(before) >= MIN_LEFTOVER_SUGGESTION_LENGTH_METERS) {
    leftovers.push({ ...sug, id: `${sug.id}:l:${makeId()}`, vertices: before });
  }
  if (polylineLengthMeters(after) >= MIN_LEFTOVER_SUGGESTION_LENGTH_METERS) {
    leftovers.push({ ...sug, id: `${sug.id}:l:${makeId()}`, vertices: after });
  }
  const nextSuggestions = suggestions.flatMap((s, i) => (i === bestIdx ? leftovers : [s]));
  return { roadVertices, suggestions: nextSuggestions };
}

/**
 * Сглаживание ломаной нарисованной «от руки» (Чайкин, срезание углов). Убирает
 * дрожание курсора, оставляя форму дороги — линия аккуратная, не прямая, но и не
 * извилистая. Концы сохраняются. Применяется ОДИН раз при создании своей дороги
 * (потом обычный simplify в stitchRoadSegments прорежет лишние точки).
 */
export function smoothPolyline(vertices: LatLng[], iterations = 2): LatLng[] {
  if (vertices.length <= 2) return vertices;
  let pts = cleanupVertices(vertices);
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const next: LatLng[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      next.push({ lat: a.lat * 0.75 + b.lat * 0.25, lng: a.lng * 0.75 + b.lng * 0.25 });
      next.push({ lat: a.lat * 0.25 + b.lat * 0.75, lng: a.lng * 0.25 + b.lng * 0.75 });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

const MIN_ERASED_PIECE_LENGTH_METERS = 4;

/**
 * Частичный «ластик»: стирает КУСОК дороги под трассой, а не всю дорогу. Дорога —
 * это паутина/сеть, поэтому вырезаем участок [eMin..eMax] (по дуге), где ластик
 * прошёл близко, и возвращаем уцелевшие куски (до и после выреза) как отдельные
 * дороги — образуется разрыв, в который можно дорисовать свою линию.
 */
export function eraseRoadByTrace(road: MapRoad, trace: LatLng[], toleranceMeters: number): MapRoad[] {
  const poly = road.vertices;
  if (poly.length < 2 || trace.length < 1) return [road];

  const arcs = cumulativeArcs(poly);
  const total = arcs[arcs.length - 1]!;
  let eMin = Infinity;
  let eMax = -Infinity;
  for (const p of trace) {
    const hit = nearestPointOnPolyline(p, poly);
    if (!hit || hit.distance > toleranceMeters) continue;
    const arc = posFromHit(arcs, hit.segmentIndex, hit.t).arc;
    if (arc < eMin) eMin = arc;
    if (arc > eMax) eMax = arc;
  }
  if (!Number.isFinite(eMin)) return [road]; // ластик не задел эту дорогу

  // Расширяем вырез на радиус ластика с каждой стороны — чтобы был видимый разрыв.
  eMin = Math.max(0, eMin - toleranceMeters);
  eMax = Math.min(total, eMax + toleranceMeters);

  const pieces: MapRoad[] = [];
  const before = subPolyline(poly, posFromArc(arcs, 0), posFromArc(arcs, eMin));
  const after = subPolyline(poly, posFromArc(arcs, eMax), posFromArc(arcs, total));
  if (polylineLengthMeters(before) >= MIN_ERASED_PIECE_LENGTH_METERS) {
    pieces.push({ ...road, vertices: before });
  }
  if (polylineLengthMeters(after) >= MIN_ERASED_PIECE_LENGTH_METERS) {
    pieces.push({ ...road, id: makeId(), vertices: after });
  }
  return pieces;
}

function posFromArc(arcs: number[], arc: number): PolyPos {
  const clamped = Math.max(0, Math.min(arcs[arcs.length - 1]!, arc));
  for (let i = 0; i < arcs.length - 1; i++) {
    const segLen = arcs[i + 1]! - arcs[i]!;
    if (clamped <= arcs[i + 1]! || i === arcs.length - 2) {
      const t = segLen > 0 ? (clamped - arcs[i]!) / segLen : 0;
      return { segmentIndex: i, t: Math.max(0, Math.min(1, t)), arc: clamped };
    }
  }
  return { segmentIndex: 0, t: 0, arc: 0 };
}

/**
 * «Выпрямить» нарисованную от руки дорогу: сильное прореживание (Douglas-Peucker)
 * убирает дрожание и делает участки прямыми, затем лёгкий Чайкин скругляет реальные
 * повороты, чтобы линия не выглядела «угловатой». Концы сохраняются.
 */
export function straightenPolyline(vertices: LatLng[], toleranceMeters = 4): LatLng[] {
  if (vertices.length <= 2) return cleanupVertices(vertices);
  const simplified = simplifyPolyline(cleanupVertices(vertices), toleranceMeters);
  if (simplified.length <= 2) return simplified;
  return smoothPolyline(simplified, 1);
}

function cleanupVertices(vertices: LatLng[]): LatLng[] {
  const cleaned: LatLng[] = [];
  for (const vertex of vertices) {
    pushIfDistinct(cleaned, vertex);
  }
  return cleaned;
}

function pushIfDistinct(vertices: LatLng[], vertex: LatLng): void {
  const prev = vertices[vertices.length - 1];
  if (!prev) {
    vertices.push(vertex);
  } else if (distanceMeters(prev, vertex) <= DUPLICATE_VERTEX_TOLERANCE_METERS) {
    vertices[vertices.length - 1] = midpoint(prev, vertex);
  } else {
    vertices.push(vertex);
  }
}

function simplifyPolyline(vertices: LatLng[], toleranceMeters: number): LatLng[] {
  if (vertices.length <= 2 || toleranceMeters <= 0) return vertices;
  const pts = vertices.map(latLngToMeters);
  const keep = new Array(vertices.length).fill(false);
  keep[0] = true;
  keep[vertices.length - 1] = true;
  simplifyRange(pts, keep, 0, pts.length - 1, toleranceMeters);
  return vertices.filter((_, index) => keep[index]);
}

function simplifyRange(points: XYMeters[], keep: boolean[], start: number, end: number, toleranceMeters: number): void {
  if (end <= start + 1) return;
  let maxDist = -1;
  let maxIndex = -1;
  const a = points[start]!;
  const b = points[end]!;
  for (let i = start + 1; i < end; i++) {
    const dist = distancePointToSegment(points[i]!, a, b);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxIndex < 0 || maxDist <= toleranceMeters) return;
  keep[maxIndex] = true;
  simplifyRange(points, keep, start, maxIndex, toleranceMeters);
  simplifyRange(points, keep, maxIndex, end, toleranceMeters);
}

function nearestOnSegment(p: XYMeters, a: XYMeters, b: XYMeters): XYMeters & { dist: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * abx;
  const y = a.y + t * aby;
  return { x, y, t, dist: Math.hypot(p.x - x, p.y - y) };
}

function distancePointToSegment(p: XYMeters, a: XYMeters, b: XYMeters): number {
  return nearestOnSegment(p, a, b).dist;
}

function midpoint(a: LatLng, b: LatLng): LatLng {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}

function averagePoint(points: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const point of points) {
    lat += point.lat;
    lng += point.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}
