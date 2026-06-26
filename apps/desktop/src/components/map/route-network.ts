import { distanceMeters, nearestPointOnPolyline, polylineLengthMeters } from './geo';
import type { LatLng, MapRoad } from './map-types';

export interface RouteResult {
  path: LatLng[];
  distanceMeters: number;
  nodes: number;
}

interface SnapResult {
  roadIndex: number;
  segmentIndex: number;
  point: LatLng;
  a: LatLng;
  b: LatLng;
}

/**
 * Базовый маршрут по нашей дорожной сети: точки склада цепляются к ближайшему
 * сегменту дороги, дальше идёт кратчайший путь по узлам. Позже сюда же лягут
 * ограничения по машине и времени разгрузки.
 */
export function computeFastestRoute(
  roads: MapRoad[],
  from: LatLng,
  to: LatLng,
): RouteResult | null {
  const usableRoads = roads.filter((road) => road.vertices.length >= 2);
  if (usableRoads.length === 0) return null;

  const graph = makeGraph();
  for (const road of usableRoads) {
    for (let i = 0; i < road.vertices.length - 1; i++) {
      const a = graph.addNode(road.vertices[i]!);
      const b = graph.addNode(road.vertices[i + 1]!);
      graph.addEdge(a, b, distanceMeters(road.vertices[i]!, road.vertices[i + 1]!));
    }
  }

  const startNode = graph.addNode(from);
  const finishNode = graph.addNode(to);
  const startSnap = nearestRoadSegment(from, usableRoads);
  const finishSnap = nearestRoadSegment(to, usableRoads);
  if (!startSnap || !finishSnap) return null;

  const startRoadNode = connectSnap(graph, startSnap);
  const finishRoadNode = connectSnap(graph, finishSnap);
  graph.addEdge(startNode, startRoadNode, distanceMeters(from, startSnap.point));
  graph.addEdge(finishNode, finishRoadNode, distanceMeters(to, finishSnap.point));

  if (startSnap.roadIndex === finishSnap.roadIndex && startSnap.segmentIndex === finishSnap.segmentIndex) {
    graph.addEdge(startRoadNode, finishRoadNode, distanceMeters(startSnap.point, finishSnap.point));
  }

  const route = graph.shortestPath(startNode, finishNode);
  if (route.length < 2) return null;
  const path = cleanupPath(route.map((index) => graph.nodes[index]!));
  if (path.length < 2) return null;

  return {
    path,
    distanceMeters: polylineLengthMeters(path),
    nodes: path.length,
  };
}

function nearestRoadSegment(point: LatLng, roads: MapRoad[]): SnapResult | null {
  let best: (SnapResult & { distance: number }) | null = null;
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    const vertices = roads[roadIndex]!.vertices;
    for (let segmentIndex = 0; segmentIndex < vertices.length - 1; segmentIndex++) {
      const a = vertices[segmentIndex]!;
      const b = vertices[segmentIndex + 1]!;
      const hit = nearestPointOnPolyline(point, [a, b]);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) {
        best = { roadIndex, segmentIndex, point: hit.point, a, b, distance: hit.distance };
      }
    }
  }
  return best;
}

function connectSnap(graph: RoadGraph, snap: SnapResult): number {
  const node = graph.addNode(snap.point);
  const a = graph.addNode(snap.a);
  const b = graph.addNode(snap.b);
  graph.addEdge(node, a, distanceMeters(snap.point, snap.a));
  graph.addEdge(node, b, distanceMeters(snap.point, snap.b));
  return node;
}

interface RoadGraph {
  nodes: LatLng[];
  addNode(point: LatLng): number;
  addEdge(a: number, b: number, weight: number): void;
  shortestPath(from: number, to: number): number[];
}

function makeGraph(): RoadGraph {
  const nodes: LatLng[] = [];
  const byKey = new Map<string, number>();
  const edges: Array<Array<{ to: number; weight: number }>> = [];

  const addNode = (point: LatLng): number => {
    const key = keyOf(point);
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push(point);
    byKey.set(key, index);
    edges.push([]);
    return index;
  };

  const addEdge = (a: number, b: number, weight: number): void => {
    if (a === b || !Number.isFinite(weight)) return;
    edges[a]!.push({ to: b, weight });
    edges[b]!.push({ to: a, weight });
  };

  const shortestPath = (from: number, to: number): number[] => {
    const dist = new Array(nodes.length).fill(Infinity) as number[];
    const prev = new Array(nodes.length).fill(-1) as number[];
    const seen = new Array(nodes.length).fill(false) as boolean[];
    dist[from] = 0;

    for (let iter = 0; iter < nodes.length; iter++) {
      let current = -1;
      let best = Infinity;
      for (let i = 0; i < dist.length; i++) {
        if (!seen[i] && dist[i]! < best) {
          best = dist[i]!;
          current = i;
        }
      }
      if (current < 0 || current === to) break;
      seen[current] = true;
      for (const edge of edges[current]!) {
        const next = dist[current]! + edge.weight;
        if (next < dist[edge.to]!) {
          dist[edge.to] = next;
          prev[edge.to] = current;
        }
      }
    }

    if (!Number.isFinite(dist[to]!)) return [];
    const path: number[] = [];
    for (let node = to; node >= 0; node = prev[node]!) path.push(node);
    return path.reverse();
  };

  return { nodes, addNode, addEdge, shortestPath };
}

function keyOf(point: LatLng): string {
  return `${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
}

function cleanupPath(path: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const point of path) {
    const prev = out[out.length - 1];
    if (!prev || distanceMeters(prev, point) > 0.25) out.push(point);
  }
  return out;
}
