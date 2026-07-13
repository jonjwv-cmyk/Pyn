import { nearestPointOnPolyline, polylineLengthMeters } from './geo';
import { getRoadGraph, graphEntriesForSegment, type RoadGraph } from './road-graph';
import type { LatLng, MapPoint, MapRoad } from './map-types';

export interface RoadNetworkQuality {
  roads: number;
  points: number;
  totalLengthKm: number;
  strictComponents: number;
  strictLargest: number[];
  operationalComponents: number;
  virtualTouchEdges: number;
  virtualOverlapEdges: number;
  virtualWeldEdges: number;
  shortRoadsUnder3m: number;
  shortRoadsUnder10m: number;
  pointsOver30m: number;
  maxPointDistanceMeters: number;
  /** Готовность именно матрицы между рабочими точками, а не каждого тех. огрызка. */
  routingReady: boolean;
}

export interface RoadNetworkIssue {
  id: string;
  kind: 'touch' | 'overlap' | 'weld';
  from: LatLng;
  to: LatLng;
  meters: number;
}

export function roadNetworkIssues(roads: MapRoad[]): RoadNetworkIssue[] {
  return getRoadGraph(roads).diagnostics.virtualConnectors.map((connector, index) => ({
    id: `${connector.kind}:${index}`,
    kind: connector.kind,
    from: connector.from,
    to: connector.to,
    meters: connector.meters,
  }));
}

export function inspectRoadNetwork(roads: MapRoad[], points: MapPoint[]): RoadNetworkQuality {
  const graph = getRoadGraph(roads);
  const lengths = roads.map((road) => polylineLengthMeters(road.vertices));
  const anchors = points.map((point) => nearestRoadAnchor(point, roads, graph));
  const operationalComponents = new Set(
    anchors.map((anchor) => anchor?.component).filter((value): value is number => value !== undefined),
  ).size;
  const pointDistances = anchors.map((anchor) => anchor?.distance ?? Infinity);
  const maxPointDistanceMeters = pointDistances.length > 0 ? Math.max(...pointDistances) : 0;

  return {
    roads: roads.length,
    points: points.length,
    totalLengthKm: lengths.reduce((sum, length) => sum + length, 0) / 1000,
    strictComponents: graph.diagnostics.strictComponents,
    strictLargest: graph.diagnostics.strictLargest,
    operationalComponents,
    virtualTouchEdges: graph.diagnostics.touchEdges,
    virtualOverlapEdges: graph.diagnostics.overlapEdges,
    virtualWeldEdges: graph.diagnostics.weldEdges,
    shortRoadsUnder3m: lengths.filter((length) => length < 3).length,
    shortRoadsUnder10m: lengths.filter((length) => length < 10).length,
    pointsOver30m: pointDistances.filter((distance) => distance > 30).length,
    maxPointDistanceMeters,
    routingReady: operationalComponents <= 1 && maxPointDistanceMeters <= 50,
  };
}

function nearestRoadAnchor(
  point: LatLng,
  roads: MapRoad[],
  graph: RoadGraph,
): { distance: number; component: number } | null {
  let best: { distance: number; a: LatLng; b: LatLng; point: LatLng } | null = null;
  for (const road of roads) {
    for (let index = 0; index < road.vertices.length - 1; index += 1) {
      const a = road.vertices[index]!;
      const b = road.vertices[index + 1]!;
      const hit = nearestPointOnPolyline(point, [a, b]);
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, a, b, point: hit.point };
    }
  }
  if (!best) return null;
  const entries = graphEntriesForSegment(graph, best.a, best.b, best.point);
  const componentOf = strictComponentIds(graph);
  const component = entries[0] ? componentOf[entries[0].node] : undefined;
  if (component === undefined) return null;
  return { distance: best.distance, component };
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
