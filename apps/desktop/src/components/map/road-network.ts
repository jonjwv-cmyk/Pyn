import { distanceMeters, latLngToMeters, metersToLatLng, nearestPointOnPolyline, polylineLengthMeters, type XYMeters } from './geo';
import { makeId, type LatLng, type MapRoad, type MapRoadSuggestion } from './map-types';
import { buildRoadGraph, type RoadGraph, type RoadGraphEdgeKind } from './road-graph';

const DEFAULT_NODE_SNAP_TOLERANCE_METERS = 2.5;
const DEFAULT_SEGMENT_SNAP_TOLERANCE_METERS = 5;
const DEFAULT_SIMPLIFY_TOLERANCE_METERS = 1.4;
const DUPLICATE_VERTEX_TOLERANCE_METERS = 0.75;
const SEGMENT_INTERSECTION_EPSILON = 1e-7;
const SEGMENT_SNAP_EDGE_GUARD = 0.04;

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

/**
 * Материализует реальные X/T-пересечения в сохранённой геометрии: одна и та же
 * координата узла вставляется в обе линии. В отличие от runtime-мостиков графа
 * это уже настоящий узел жёлтой сети и безопасная основа для маршрутизатора.
 *
 * `changedRoadIds` ограничивает дорогую проверку парами, где менялась хотя бы
 * одна линия — обычное рисование не пересчитывает попарно всю сеть.
 */
export function materializeRoadIntersections(
  roads: MapRoad[],
  changedRoadIds?: ReadonlySet<string>,
): MapRoad[] {
  return splitRoadIntersections(roads, changedRoadIds)
    .map((road) => ({ ...road, vertices: stableCleanupVertices(road.vertices) }))
    .filter((road) => road.vertices.length >= 2);
}

export interface RoadNormalizationReport {
  roadsBefore: number;
  roadsAfter: number;
  changedRoads: number;
  insertedIntersectionVertices: number;
  snappedEndpoints: number;
  ambiguousEndpoints: number;
  maxEndpointMoveMeters: number;
  addedConnectorRoads: number;
  strictComponentsBefore: number;
  strictComponentsAfter: number;
  unresolvedComponents: number;
}

export interface RoadNormalizationResult {
  roads: MapRoad[];
  report: RoadNormalizationReport;
}

export interface RoadNormalizationOptions {
  /** Для старой карты по умолчанию 0: сохраняем координаты, добавляя явные рёбра. */
  endpointSnapMeters?: number;
  /** Материализовать минимальный набор безопасных touch/weld-соединителей. */
  connectComponents?: boolean;
}

interface EndpointSnapCandidate {
  kind: 'node' | 'segment';
  roadIndex: number;
  segmentIndex: number;
  point: LatLng;
  dist: number;
}

/**
 * Безопасная нормализация старого рисунка. Не упрощает форму, не удаляет линии и
 * не склеивает параллельные проезды. Автоматически делает только два однозначных
 * действия: материализует реальные пересечения и притягивает конец не дальше
 * `snapMeters` к единственному ближайшему узлу/полотну.
 */
export function normalizeRoadTopology(
  source: MapRoad[],
  options: RoadNormalizationOptions = {},
): RoadNormalizationResult {
  const snapMeters = Math.max(0, options.endpointSnapMeters ?? 0);
  const connectComponents = options.connectComponents ?? true;
  const sourceIds = new Set(source.map((road) => road.id));
  const beforeVertices = new Map(source.map((road) => [road.id, road.vertices.length]));
  let roads = materializeRoadIntersections(source.map((road) => ({ ...road, vertices: stableCleanupVertices(road.vertices) })));
  const strictComponentsBefore = buildRoadGraph(roads).diagnostics.strictComponents;
  let snappedEndpoints = 0;
  let ambiguousEndpoints = 0;
  let maxEndpointMoveMeters = 0;

  for (let roadIndex = 0; snapMeters > 0 && roadIndex < roads.length; roadIndex += 1) {
    for (const side of ['start', 'end'] as const) {
      const road = roads[roadIndex]!;
      const endpointIndex = side === 'start' ? 0 : road.vertices.length - 1;
      const endpoint = road.vertices[endpointIndex]!;
      const candidates = endpointSnapCandidates(roads, roadIndex, endpoint, snapMeters);
      const best = candidates[0];
      if (!best || best.dist <= 0.05) continue;
      const competing = candidates.find((candidate, index) => (
        index > 0 &&
        candidate.dist <= best.dist + 0.75 &&
        distanceMeters(candidate.point, best.point) > DUPLICATE_VERTEX_TOLERANCE_METERS
      ));
      if (competing) {
        ambiguousEndpoints += 1;
        continue;
      }

      const nextVertices = [...road.vertices];
      nextVertices[endpointIndex] = best.point;
      roads[roadIndex] = { ...road, vertices: stableCleanupVertices(nextVertices) };
      if (best.kind === 'segment') {
        const target = roads[best.roadIndex]!;
        roads[best.roadIndex] = insertJointVertex(target, best.point);
      }
      snappedEndpoints += 1;
      maxEndpointMoveMeters = Math.max(maxEndpointMoveMeters, best.dist);
    }
  }

  roads = materializeRoadIntersections(roads);
  const connected = connectComponents ? materializeMinimumConnectors(roads) : { roads, added: 0 };
  roads = materializeRoadIntersections(connected.roads, new Set(connected.roads.slice(roads.length).map((road) => road.id)));
  const strictComponentsAfter = buildRoadGraph(roads, 0).diagnostics.strictComponents;
  const insertedIntersectionVertices = roads.reduce((sum, road) => (
    sum + (beforeVertices.has(road.id) ? Math.max(0, road.vertices.length - beforeVertices.get(road.id)!) : 0)
  ), 0);
  const original = new Map(source.map((road) => [road.id, road.vertices]));
  const changedRoads = roads.filter((road) => original.has(road.id) && !sameVertices(original.get(road.id), road.vertices)).length;
  const addedConnectorRoads = roads.filter((road) => !sourceIds.has(road.id)).length;

  return {
    roads,
    report: {
      roadsBefore: source.length,
      roadsAfter: roads.length,
      changedRoads,
      insertedIntersectionVertices,
      snappedEndpoints,
      ambiguousEndpoints,
      maxEndpointMoveMeters,
      addedConnectorRoads,
      strictComponentsBefore,
      strictComponentsAfter,
      unresolvedComponents: Math.max(0, strictComponentsAfter - 1),
    },
  };
}

function endpointSnapCandidates(
  roads: MapRoad[],
  currentRoadIndex: number,
  endpoint: LatLng,
  toleranceMeters: number,
): EndpointSnapCandidate[] {
  const out: EndpointSnapCandidate[] = [];
  const endpointMeters = latLngToMeters(endpoint);
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
    if (roadIndex === currentRoadIndex) continue;
    const road = roads[roadIndex]!;
    for (let vertexIndex = 0; vertexIndex < road.vertices.length; vertexIndex += 1) {
      const point = road.vertices[vertexIndex]!;
      const dist = distanceMeters(endpoint, point);
      if (dist <= toleranceMeters) {
        out.push({ kind: 'node', roadIndex, segmentIndex: Math.max(0, vertexIndex - 1), point, dist });
      }
    }
    for (let segmentIndex = 0; segmentIndex < road.vertices.length - 1; segmentIndex += 1) {
      const projected = nearestOnSegment(
        endpointMeters,
        latLngToMeters(road.vertices[segmentIndex]!),
        latLngToMeters(road.vertices[segmentIndex + 1]!),
      );
      if (projected.t <= SEGMENT_SNAP_EDGE_GUARD || projected.t >= 1 - SEGMENT_SNAP_EDGE_GUARD) continue;
      if (projected.dist <= toleranceMeters) {
        out.push({
          kind: 'segment',
          roadIndex,
          segmentIndex,
          point: metersToLatLng({ x: projected.x, y: projected.y }),
          dist: projected.dist,
        });
      }
    }
  }
  return out
    .sort((a, b) => a.dist - b.dist)
    .filter((candidate, index, all) => !all.slice(0, index).some((prev) => (
      distanceMeters(prev.point, candidate.point) <= DUPLICATE_VERTEX_TOLERANCE_METERS
    )));
}

function materializeMinimumConnectors(source: MapRoad[]): { roads: MapRoad[]; added: number } {
  const graph = buildRoadGraph(source);
  if (graph.diagnostics.strictComponents <= 1) return { roads: source, added: 0 };
  const componentOf = strictComponentIds(graph);
  const parent = Array.from({ length: graph.diagnostics.strictComponents }, (_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const unite = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[rb] = ra;
    return true;
  };

  const candidates = graph.diagnostics.virtualConnectors
    .filter((connector) => connector.kind !== 'overlap' || connector.meters <= 0.5)
    .map((connector) => ({
      ...connector,
      fromComponent: componentOf[connector.fromNode]!,
      toComponent: componentOf[connector.toNode]!,
      score: connector.meters + connectorKindPenalty(connector.kind),
    }))
    .filter((connector) => connector.fromComponent !== connector.toComponent)
    .sort((a, b) => a.score - b.score);

  const knownIds = new Set(source.map((road) => road.id));
  const connectors: MapRoad[] = [];
  for (const connector of candidates) {
    if (!unite(connector.fromComponent, connector.toComponent)) continue;
    let id = topologyConnectorId(connector.from, connector.to);
    let suffix = 1;
    while (knownIds.has(id)) id = `${topologyConnectorId(connector.from, connector.to)}:${suffix++}`;
    knownIds.add(id);
    connectors.push({ id, name: '', vertices: [connector.from, connector.to] });
  }
  return { roads: [...source, ...connectors], added: connectors.length };
}

function strictComponentIds(graph: RoadGraph): number[] {
  const componentOf = new Array<number>(graph.nodes.length).fill(-1);
  let component = 0;
  for (let start = 0; start < graph.nodes.length; start += 1) {
    if (componentOf[start] !== -1) continue;
    const stack = [start];
    componentOf[start] = component;
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const edge of graph.adj[node]!) {
        if (edge.kind !== 'road' || componentOf[edge.to] !== -1) continue;
        componentOf[edge.to] = component;
        stack.push(edge.to);
      }
    }
    component += 1;
  }
  return componentOf;
}

function connectorKindPenalty(kind: Exclude<RoadGraphEdgeKind, 'road'>): number {
  if (kind === 'touch') return 0;
  if (kind === 'weld') return 0.5;
  return 100;
}

function topologyConnectorId(a: LatLng, b: LatLng): string {
  const pa = `${a.lat.toFixed(7)},${a.lng.toFixed(7)}`;
  const pb = `${b.lat.toFixed(7)},${b.lng.toFixed(7)}`;
  const key = pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `topology-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sameVertices(a: LatLng[] | undefined, b: LatLng[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((point, index) => (
    point.lat === b[index]!.lat && point.lng === b[index]!.lng
  ));
}

function splitRoadIntersections(roads: MapRoad[], changedRoadIds?: ReadonlySet<string>): MapRoad[] {
  const insertions = roads.map(() => [] as IntersectionInsertion[]);

  for (let roadA = 0; roadA < roads.length; roadA++) {
    const verticesA = roads[roadA]!.vertices;
    for (let roadB = roadA + 1; roadB < roads.length; roadB++) {
      if (changedRoadIds && !changedRoadIds.has(roads[roadA]!.id) && !changedRoadIds.has(roads[roadB]!.id)) continue;
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
      pushStable(result, insertion.point);
    }
    pushStable(result, vertices[segmentIndex + 1]!);
  }
  return stableCleanupVertices(result);
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
      if (projected.t <= SEGMENT_SNAP_EDGE_GUARD || projected.t >= 1 - SEGMENT_SNAP_EDGE_GUARD) continue;
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

// ─── Слияние «палка-на-палку» (ТЗ 2026-07-12) ──────────────────────────────────
// Рисованная сеть содержит штрихи, наложенные СЛОЕМ на другие штрихи (продолжение
// дороги рисовали внахлёст, дорисовки поверх). Правило юзера: «палка легла слоем
// на палку → это ОДНА дорога; легла перекрёстно → развилка». Перекрёстные случаи
// уже материализует splitRoadIntersections; здесь сшиваем ПАРАЛЛЕЛЬНЫЕ наложения:
//   • канон — более ДЛИННАЯ дорога, её геометрию не двигаем;
//   • накрытая часть короткой (боковое ≤ 6 м, ось ≤ 22°) удаляется;
//   • торчащие хвосты-продолжения пришиваются к канону видимым узлом-стыком.
// Соседние НАСТОЯЩИЕ параллельные проезды не задеваются: они дальше 6 м либо
// расходятся по направлению.

const MERGE_LATERAL_METERS = 6;
const MERGE_ANGLE_DEG = 22;
const MERGE_SAMPLE_STEP_METERS = 2;
const MERGE_GAP_SAMPLES = 4;          // «дырки» покрытия до ~8 м не рвут наложение
const MERGE_MIN_OVERLAP_METERS = 10;  // короче — случайное касание, не слой
const MERGE_MIN_TAIL_METERS = 3;      // огрызок короче — поглощается целиком
const MERGE_MAX_PASSES = 6;

export interface RoadMergeReport {
  pairsConsidered: number;
  roadsAbsorbed: number;
  roadsTrimmed: number;
  jointsInserted: number;
  metersRemoved: number;
  passes: number;
}

export interface RoadMergeResult {
  roads: MapRoad[];
  report: RoadMergeReport;
}

export function mergeOverlappingRoads(source: MapRoad[]): RoadMergeResult {
  const roads: MapRoad[] = source.map((road) => ({ ...road, vertices: road.vertices.slice() }));
  const report: RoadMergeReport = {
    pairsConsidered: 0,
    roadsAbsorbed: 0,
    roadsTrimmed: 0,
    jointsInserted: 0,
    metersRemoved: 0,
    passes: 0,
  };

  for (let pass = 0; pass < MERGE_MAX_PASSES; pass += 1) {
    const modified = new Set<number>();
    let applied = false;
    const order = roads
      .map((road, index) => ({ index, length: polylineLengthMeters(road.vertices) }))
      .filter((item) => roads[item.index]!.vertices.length >= 2)
      .sort((a, b) => a.length - b.length); // короткие вливаются первыми

    for (const { index: shortIndex, length: shortLength } of order) {
      if (modified.has(shortIndex) || shortLength < 0.5) continue;
      const short = roads[shortIndex]!;
      const shortBox = roadBounds(short.vertices, MERGE_LATERAL_METERS + 2);

      for (let canonIndex = 0; canonIndex < roads.length; canonIndex += 1) {
        if (canonIndex === shortIndex || modified.has(canonIndex)) continue;
        const canon = roads[canonIndex]!;
        if (canon.vertices.length < 2) continue;
        const canonLength = polylineLengthMeters(canon.vertices);
        // Канон строго длиннее (при равенстве — стабильный порядок по id).
        if (canonLength < shortLength || (canonLength === shortLength && canon.id <= short.id)) continue;
        if (!boundsIntersect(shortBox, roadBounds(canon.vertices, 0))) continue;

        report.pairsConsidered += 1;
        const outcome = mergeShortIntoCanon(short, canon);
        if (!outcome) continue;
        // Поглощение не должно рвать связность: если конец короткой сидит на
        // ТРЕТЬЕЙ дороге, а до канона оттуда дальше 0.9 м — короткая работает
        // перемычкой; удалив её, получим разрыв (и вечный цикл с нормализацией,
        // которая перемычку добавляет обратно).
        if (outcome.tails.length === 0 && absorbBreaksLink(short, canonIndex, shortIndex, roads)) continue;

        roads[canonIndex] = outcome.canon;
        roads[shortIndex] = outcome.tails[0] ?? { ...short, vertices: [] };
        for (let extra = 1; extra < outcome.tails.length; extra += 1) roads.push(outcome.tails[extra]!);
        report.jointsInserted += outcome.jointsInserted;
        report.metersRemoved += outcome.metersRemoved;
        if (outcome.tails.length === 0) report.roadsAbsorbed += 1;
        else report.roadsTrimmed += 1;
        modified.add(shortIndex);
        modified.add(canonIndex);
        applied = true;
        break;
      }
    }

    report.passes = pass + 1;
    if (!applied) break;
  }

  return { roads: roads.filter((road) => road.vertices.length >= 2), report };
}

interface MergeOutcome {
  canon: MapRoad;
  tails: MapRoad[];
  jointsInserted: number;
  metersRemoved: number;
}

/** Конец короткой сидит на третьей дороге, а канон оттуда дальше 0.9 м? */
function absorbBreaksLink(short: MapRoad, canonIndex: number, shortIndex: number, roads: MapRoad[]): boolean {
  const canon = roads[canonIndex]!;
  for (const endpoint of [short.vertices[0]!, short.vertices[short.vertices.length - 1]!]) {
    const canonHit = nearestPointOnPolyline(endpoint, canon.vertices);
    if (canonHit && canonHit.distance <= 0.9) continue; // конец и так на каноне
    for (let index = 0; index < roads.length; index += 1) {
      if (index === canonIndex || index === shortIndex) continue;
      const other = roads[index]!;
      if (other.vertices.length < 2) continue;
      const hit = nearestPointOnPolyline(endpoint, other.vertices);
      if (hit && hit.distance <= DUPLICATE_VERTEX_TOLERANCE_METERS) return true;
    }
  }
  return false;
}

/** Покрытие короткой канонной дорогой; null — наложения слоем нет. */
function mergeShortIntoCanon(short: MapRoad, canon: MapRoad): MergeOutcome | null {
  const arcs = cumulativeArcs(short.vertices);
  const total = arcs[arcs.length - 1]!;
  if (total < 0.5) return null;
  const sampleCount = Math.max(2, Math.ceil(total / MERGE_SAMPLE_STEP_METERS) + 1);
  const covered: boolean[] = new Array(sampleCount).fill(false);

  for (let s = 0; s < sampleCount; s += 1) {
    const arc = (total * s) / (sampleCount - 1);
    const pos = posAtArc(short.vertices, arcs, arc);
    const point = pointAtPos(short.vertices, pos);
    const hit = nearestPointOnPolyline(point, canon.vertices);
    if (!hit || hit.distance > MERGE_LATERAL_METERS) continue;
    const shortDir = segmentBearing(short.vertices, pos.segmentIndex);
    const canonDir = segmentBearing(canon.vertices, hit.segmentIndex);
    if (shortDir == null || canonDir == null) continue;
    if (axisAngleDiff(shortDir, canonDir) > MERGE_ANGLE_DEG) continue;
    covered[s] = true;
  }

  // Замыкаем короткие дырки: GPS-рисование дрожит, слой прерывается на 1-2 сэмпла.
  for (let s = 0; s < sampleCount; s += 1) {
    if (covered[s]) continue;
    let gapEnd = s;
    while (gapEnd < sampleCount && !covered[gapEnd]) gapEnd += 1;
    if (s > 0 && gapEnd < sampleCount && gapEnd - s <= MERGE_GAP_SAMPLES) {
      for (let k = s; k < gapEnd; k += 1) covered[k] = true;
    }
    s = gapEnd;
  }

  // Диапазоны покрытия в метрах дуги.
  const step = total / (sampleCount - 1);
  const ranges: Array<{ from: number; to: number }> = [];
  for (let s = 0; s < sampleCount; s += 1) {
    if (!covered[s]) continue;
    let e = s;
    while (e + 1 < sampleCount && covered[e + 1]) e += 1;
    ranges.push({ from: s * step, to: e * step });
    s = e;
  }
  const strong = ranges.filter((range) => (
    range.to - range.from >= MERGE_MIN_OVERLAP_METERS ||
    // короткий штрих, накрытый почти целиком, поглощаем даже если он < 10 м
    (range.to - range.from >= total * 0.9 && total <= MERGE_MIN_OVERLAP_METERS * 2)
  ));
  if (strong.length === 0) return null;

  // Хвосты — непокрытые куски между/вокруг диапазонов.
  let canonNext = canon;
  let joints = 0;
  let removed = 0;
  const tails: MapRoad[] = [];
  let cursor = 0;
  const attach = (arc: number): LatLng => {
    const pos = posAtArc(short.vertices, arcs, arc);
    const cut = pointAtPos(short.vertices, pos);
    const hit = nearestPointOnPolyline(cut, canonNext.vertices);
    const joint = hit ? hit.point : cut;
    if (hit && hit.distance > 0.05) {
      canonNext = insertJointVertex(canonNext, joint);
      joints += 1;
    }
    return joint;
  };

  for (const range of strong) {
    if (range.from - cursor >= MERGE_MIN_TAIL_METERS) {
      const piece = subPolyline(
        short.vertices,
        posAtArc(short.vertices, arcs, cursor),
        posAtArc(short.vertices, arcs, range.from),
      );
      // пришиваем срез хвоста к канону видимым узлом
      const joint = attach(range.from);
      if (distanceMeters(piece[piece.length - 1]!, joint) > 0.05) piece.push(joint);
      if (piece.length >= 2 && polylineLengthMeters(piece) >= MERGE_MIN_TAIL_METERS) {
        tails.push({ ...short, id: tails.length === 0 ? short.id : makeId(), vertices: piece });
      }
    }
    removed += range.to - range.from;
    cursor = range.to;
  }
  if (total - cursor >= MERGE_MIN_TAIL_METERS) {
    const piece = subPolyline(
      short.vertices,
      posAtArc(short.vertices, arcs, cursor),
      posAtArc(short.vertices, arcs, total),
    );
    const joint = attach(cursor);
    if (distanceMeters(piece[0]!, joint) > 0.05) piece.unshift(joint);
    if (piece.length >= 2 && polylineLengthMeters(piece) >= MERGE_MIN_TAIL_METERS) {
      tails.push({ ...short, id: tails.length === 0 ? short.id : makeId(), vertices: piece });
    }
  }

  // Наложение должно быть реальным: если покрытие ничтожно — не трогаем.
  if (removed < MERGE_MIN_OVERLAP_METERS && removed < total * 0.9) return null;

  return { canon: canonNext, tails, jointsInserted: joints, metersRemoved: removed };
}

function posAtArc(poly: LatLng[], arcs: number[], arc: number): PolyPos {
  const clamped = Math.max(0, Math.min(arcs[arcs.length - 1]!, arc));
  let segmentIndex = 0;
  while (segmentIndex < arcs.length - 2 && arcs[segmentIndex + 1]! < clamped) segmentIndex += 1;
  const segLen = arcs[segmentIndex + 1]! - arcs[segmentIndex]!;
  const t = segLen > 0 ? (clamped - arcs[segmentIndex]!) / segLen : 0;
  return { segmentIndex, t, arc: clamped };
}

/** Азимут сегмента полилинии (°), null для вырожденного. */
function segmentBearing(poly: LatLng[], segmentIndex: number): number | null {
  const a = poly[Math.max(0, Math.min(segmentIndex, poly.length - 2))]!;
  const b = poly[Math.max(1, Math.min(segmentIndex + 1, poly.length - 1))]!;
  const am = latLngToMeters(a);
  const bm = latLngToMeters(b);
  const dx = bm.x - am.x;
  const dy = bm.y - am.y;
  if (Math.hypot(dx, dy) < 0.2) return null;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Разница осей (мод 180°): наложение слоем не зависит от направления рисования. */
function axisAngleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

interface RoadBounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

function roadBounds(vertices: LatLng[], padMeters: number): RoadBounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const v of vertices) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lng < minLng) minLng = v.lng;
    if (v.lng > maxLng) maxLng = v.lng;
  }
  const padLat = padMeters / 111_320;
  const padLng = padLat / Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
}

function boundsIntersect(a: RoadBounds, b: RoadBounds): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

// ─── Материализация схождений (швы вместо невидимых мостиков) ─────────────────
// Граф соединяет несостыкованные места невидимыми рёбрами (overlap ≤3м, touch
// ≤5м, weld ≤7м) — маршрут и ПРО-след через них ЕЗДЯТ, а видимой развилки нет:
// след рисует стежок «по воздуху» между жёлтыми. По принципу юзера («сошлись —
// развилка») впаиваем ШОВ: обе линии получают ОБЩУЮ вершину в середине зазора
// (каждая гнётся ≤3.5 м в одной точке). Невидимое становится видимым узлом.

const WELD_MATERIALIZE_MAX_METERS = 7;
const WELD_MATERIALIZE_DEDUPE_METERS = 4;

export interface ConvergenceWeldResult {
  roads: MapRoad[];
  welds: number;
}

export function materializeConvergenceWelds(source: MapRoad[]): ConvergenceWeldResult {
  const roads: MapRoad[] = source.map((road) => ({ ...road, vertices: road.vertices.slice() }));
  const graph = buildRoadGraph(roads);
  const connectors = [...graph.diagnostics.virtualConnectors]
    .filter((connector) => connector.meters <= WELD_MATERIALIZE_MAX_METERS)
    .sort((a, b) => a.meters - b.meters);

  const placed: LatLng[] = [];
  let welds = 0;
  for (const connector of connectors) {
    const mid = {
      lat: (connector.from.lat + connector.to.lat) / 2,
      lng: (connector.from.lng + connector.to.lng) / 2,
    };
    if (placed.some((p) => distanceMeters(p, mid) < WELD_MATERIALIZE_DEDUPE_METERS)) continue;
    const ra = roadIndexAtPoint(roads, connector.from);
    const rb = roadIndexAtPoint(roads, connector.to);
    if (ra < 0 || rb < 0 || ra === rb) continue;
    // Уже сшиты: общая вершина этих дорог рядом — второй шов не нужен (иначе
    // повторный запуск зашивал бы одно место бесконечно, теряя идемпотентность).
    if (roadsShareVertexNear(roads[ra]!, roads[rb]!, mid, 8)) continue;
    roads[ra] = bendRoadThroughPoint(roads[ra]!, connector.from, mid);
    roads[rb] = bendRoadThroughPoint(roads[rb]!, connector.to, mid);
    placed.push(mid);
    welds += 1;
  }
  return { roads, welds };
}

/** Есть ли у двух дорог общая (совпадающая) вершина в радиусе от точки. */
function roadsShareVertexNear(a: MapRoad, b: MapRoad, around: LatLng, radiusMeters: number): boolean {
  for (const va of a.vertices) {
    if (distanceMeters(va, around) > radiusMeters) continue;
    for (const vb of b.vertices) {
      if (distanceMeters(va, vb) <= DUPLICATE_VERTEX_TOLERANCE_METERS) return true;
    }
  }
  return false;
}

/** Дорога, на чьём полотне лежит точка (допуск 0.6 м — концы мостиков лежат точно). */
function roadIndexAtPoint(roads: MapRoad[], point: LatLng): number {
  let best = -1;
  let bestDist = 0.6;
  for (let index = 0; index < roads.length; index += 1) {
    const hit = nearestPointOnPolyline(point, roads[index]!.vertices);
    if (hit && hit.distance <= bestDist) {
      best = index;
      bestDist = hit.distance;
    }
  }
  return best;
}

/** Вставляет в полотно вершину точно в `target`, в месте проекции `at` (шов). */
function bendRoadThroughPoint(road: MapRoad, at: LatLng, target: LatLng): MapRoad {
  const hit = nearestPointOnPolyline(at, road.vertices);
  if (!hit) return road;
  // Совпадающая вершина рядом — просто гнём её в target.
  for (let i = 0; i < road.vertices.length; i += 1) {
    if (distanceMeters(road.vertices[i]!, hit.point) <= DUPLICATE_VERTEX_TOLERANCE_METERS) {
      const vertices = road.vertices.slice();
      vertices[i] = target;
      return { ...road, vertices: stableCleanupVertices(vertices) };
    }
  }
  const vertices = [
    ...road.vertices.slice(0, hit.segmentIndex + 1),
    target,
    ...road.vertices.slice(hit.segmentIndex + 1),
  ];
  return { ...road, vertices: stableCleanupVertices(vertices) };
}

// ─── V-схождения дальнего зазора (настоящий перекрёсток, нарисованный врозь) ──
// Два ДЛИННЫХ полотна сходятся клином до ≤12 м и расходятся в обе стороны —
// это настоящий перекрёсток, нарисованный с зазором (кейс r121/r134: зазор 9 м,
// треки реально переезжают, а связи нет → след рвался на каждом переезде).
// Параллельные проезды вдоль забора так не выглядят: у них профиль расстояний
// ровный, без V-образного минимума.

const VCONV_MAX_GAP_METERS = 12;
const VCONV_MIN_ROAD_METERS = 100;
const VCONV_SIDE_OFFSET_METERS = 30;
const VCONV_SIDE_RATIO = 2;

export function materializeVConvergences(source: MapRoad[]): ConvergenceWeldResult {
  const roads: MapRoad[] = source.map((road) => ({ ...road, vertices: road.vertices.slice() }));
  let welds = 0;
  for (let ia = 0; ia < roads.length; ia += 1) {
    const A = roads[ia]!;
    if (A.vertices.length < 2 || polylineLengthMeters(A.vertices) < VCONV_MIN_ROAD_METERS) continue;
    for (let ib = ia + 1; ib < roads.length; ib += 1) {
      const B = roads[ib]!;
      if (B.vertices.length < 2 || polylineLengthMeters(B.vertices) < VCONV_MIN_ROAD_METERS) continue;
      if (!boundsIntersect(roadBounds(A.vertices, VCONV_MAX_GAP_METERS), roadBounds(B.vertices, 0))) continue;
      const v = findVConvergence(roads[ia]!, roads[ib]!);
      if (!v) continue;
      if (roadsShareVertexNear(roads[ia]!, roads[ib]!, v.mid, VCONV_SIDE_OFFSET_METERS)) continue;
      roads[ia] = bendRoadThroughPoint(roads[ia]!, v.onA, v.mid);
      roads[ib] = bendRoadThroughPoint(roads[ib]!, v.onB, v.mid);
      welds += 1;
    }
  }
  return { roads, welds };
}

function findVConvergence(A: MapRoad, B: MapRoad): { onA: LatLng; onB: LatLng; mid: LatLng } | null {
  // Профиль расстояний B→A по дуге B; ищем глобальный минимум ≤ 12 м.
  const arcs = cumulativeArcs(B.vertices);
  const total = arcs[arcs.length - 1]!;
  const step = 4;
  let best: { arc: number; dist: number; onA: LatLng; onB: LatLng } | null = null;
  const at = (arc: number): LatLng => pointAtPos(B.vertices, posAtArc(B.vertices, arcs, arc));
  for (let arc = 0; arc <= total; arc += step) {
    const p = at(arc);
    const hit = nearestPointOnPolyline(p, A.vertices);
    if (!hit || hit.distance > VCONV_MAX_GAP_METERS) continue;
    if (!best || hit.distance < best.dist) best = { arc, dist: hit.distance, onA: hit.point, onB: p };
  }
  if (!best) return null;
  // V-образность: по обе стороны от минимума зазор растёт минимум вдвое.
  for (const side of [-1, 1]) {
    const arc = best.arc + side * VCONV_SIDE_OFFSET_METERS;
    if (arc < 0 || arc > total) return null; // минимум у конца — это не клин, а стык концов (им занимается weld)
    const hit = nearestPointOnPolyline(at(arc), A.vertices);
    const dist = hit ? hit.distance : Infinity;
    if (dist < Math.max(best.dist * VCONV_SIDE_RATIO, best.dist + 6)) return null;
  }
  const mid = { lat: (best.onA.lat + best.onB.lat) / 2, lng: (best.onA.lng + best.onB.lng) / 2 };
  return { onA: best.onA, onB: best.onB, mid };
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

const DRAW_ATTACH_NODE_METERS = 3;
const DRAW_ATTACH_SEGMENT_METERS = 5;
const JOINT_ON_LINE_TOLERANCE_METERS = 0.6;

/**
 * Приведение линии, нарисованной от руки (ТЗ 2026-07-11 «выравнивание, если рука
 * дрожит»): лёгкий Douglas-Peucker (~1.6 м) выпрямляет дрожание на почти прямых
 * участках, затем ОДИН проход Чайкина скругляет реальные повороты. Форма дороги
 * сохраняется — только аккуратнее.
 */
export function tidyDrawnRoad(vertices: LatLng[]): LatLng[] {
  const cleaned = cleanupVertices(vertices);
  if (cleaned.length <= 2) return cleaned;
  return smoothPolyline(simplifyPolyline(cleaned, 1.6), 1);
}

/**
 * Прилипание КОНЦОВ новой линии к существующей сети: недотянутый или чуть
 * переехавший конец садится ТОЧНО на ближайшую дорогу (вершину или полотно) —
 * «зашла на другую жёлтую → одна сеть». Взамен целевой дороге возвращаем точку
 * стыка, чтобы store вставил там вершину (точка лежит НА её линии — рисунок
 * не меняется, но сеть связана и в данных, а не только в графе).
 */
export function attachRoadEndpointsToNetwork(
  vertices: LatLng[],
  roads: MapRoad[],
): { vertices: LatLng[]; joints: Array<{ roadId: string; point: LatLng }> } {
  if (vertices.length < 2 || roads.length === 0) return { vertices, joints: [] };
  const out = [...vertices];
  const joints: Array<{ roadId: string; point: LatLng }> = [];
  for (const endIndex of [0, out.length - 1]) {
    const snap = findBestSnap(roads, -1, out[endIndex]!, DRAW_ATTACH_NODE_METERS, DRAW_ATTACH_SEGMENT_METERS);
    if (!snap) continue;
    out[endIndex] = snap.point;
    if (snap.kind === 'segment') joints.push({ roadId: roads[snap.roadIndex]!.id, point: snap.point });
  }
  return { vertices: cleanupVertices(out), joints };
}

/** Вершина-стык на полотне дороги: вставляется только точка, лежащая НА линии. */
export function insertJointVertex(road: MapRoad, point: LatLng): MapRoad {
  const hit = nearestPointOnPolyline(point, road.vertices);
  if (!hit || hit.distance > JOINT_ON_LINE_TOLERANCE_METERS) return road;
  const prev = road.vertices[hit.segmentIndex]!;
  const next = road.vertices[hit.segmentIndex + 1]!;
  if (
    distanceMeters(prev, point) <= DUPLICATE_VERTEX_TOLERANCE_METERS ||
    distanceMeters(next, point) <= DUPLICATE_VERTEX_TOLERANCE_METERS
  ) return road;
  const vertices = [...road.vertices];
  vertices.splice(hit.segmentIndex + 1, 0, point);
  return { ...road, vertices };
}

const MIN_ERASED_PIECE_LENGTH_METERS = 2.5;

/**
 * Частичный «ластик»: стирает КУСОК дороги под трассой, а не всю дорогу. Дорога —
 * это паутина/сеть, поэтому вырезаем участок [eMin..eMax] (по дуге), где ластик
 * прошёл близко, и возвращаем уцелевшие куски (до и после выреза) как отдельные
 * дороги — образуется разрыв, в который можно дорисовать свою линию.
 *
 * Режем «как пальцем в Paint»: трасса уплотняется (быстрый мах мыши не оставляет
 * пропусков), вырез = ровно след кисти (без раздувания на полный радиус) — можно
 * делать мелкие точечные пробелы.
 */
export function eraseRoadByTrace(road: MapRoad, trace: LatLng[], toleranceMeters: number): MapRoad[] {
  const poly = road.vertices;
  if (poly.length < 2 || trace.length < 1) return [road];

  const arcs = cumulativeArcs(poly);
  const total = arcs[arcs.length - 1]!;
  let eMin = Infinity;
  let eMax = -Infinity;
  for (const p of densifyTrace(trace, Math.max(0.6, toleranceMeters * 0.5))) {
    const hit = nearestPointOnPolyline(p, poly);
    if (!hit || hit.distance > toleranceMeters) continue;
    const arc = posFromHit(arcs, hit.segmentIndex, hit.t).arc;
    if (arc < eMin) eMin = arc;
    if (arc > eMax) eMax = arc;
  }
  if (!Number.isFinite(eMin)) return [road]; // ластик не задел эту дорогу

  // Небольшой запас по краям — след круглый, но точечный тычок остаётся точечным.
  const pad = Math.min(toleranceMeters * 0.5, 2);
  eMin = Math.max(0, eMin - pad);
  eMax = Math.min(total, eMax + pad);

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

/** Уплотнение трассы кисти: промежуточные точки с шагом ≤ step (быстрый мах — без дыр). */
function densifyTrace(trace: LatLng[], stepMeters: number): LatLng[] {
  if (trace.length < 2) return trace;
  const out: LatLng[] = [trace[0]!];
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1]!;
    const b = trace[i]!;
    const len = distanceMeters(a, b);
    const steps = Math.min(400, Math.ceil(len / stepMeters));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return out;
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

/** Дедуп для миграции: не усредняет координаты и потому строго идемпотентен. */
function stableCleanupVertices(vertices: LatLng[]): LatLng[] {
  const cleaned: LatLng[] = [];
  for (const vertex of vertices) pushStable(cleaned, vertex);
  return cleaned;
}

function pushStable(vertices: LatLng[], vertex: LatLng): void {
  const prev = vertices[vertices.length - 1];
  if (!prev || distanceMeters(prev, vertex) > DUPLICATE_VERTEX_TOLERANCE_METERS) vertices.push(vertex);
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

/**
 * Точки пересечения двух ломаных (планарно, в метрах). Нужно для кандидатов на
 * ж/д переезд: где внешняя ж/д линия (OSM) пересекает нашу нарисованную дорогу.
 * bbox-прескрин, чтобы не гонять сегмент×сегмент по далёким парам.
 */
export function polylineIntersections(a: LatLng[], b: LatLng[]): LatLng[] {
  if (a.length < 2 || b.length < 2) return [];
  const pad = 0.0003; // ~30 м
  const boxA = polyBBox(a);
  const boxB = polyBBox(b);
  if (
    boxA[0] - pad > boxB[2] || boxB[0] - pad > boxA[2] ||
    boxA[1] - pad > boxB[3] || boxB[1] - pad > boxA[3]
  ) return [];
  const out: LatLng[] = [];
  const am = a.map(latLngToMeters);
  const bm = b.map(latLngToMeters);
  for (let i = 0; i < am.length - 1; i++) {
    for (let j = 0; j < bm.length - 1; j++) {
      const hit = segmentIntersection(am[i]!, am[i + 1]!, bm[j]!, bm[j + 1]!);
      if (hit) out.push(metersToLatLng(hit));
    }
  }
  return out;
}

function polyBBox(points: LatLng[]): [number, number, number, number] {
  let s = Infinity; let w = Infinity; let n = -Infinity; let e = -Infinity;
  for (const p of points) {
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
  }
  return [s, w, n, e];
}
