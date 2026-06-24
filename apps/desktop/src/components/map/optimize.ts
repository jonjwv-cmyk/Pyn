/**
 * Логистическая оптимизация расположения склада отгрузки.
 *
 * Координаты карты теперь настоящие GPS (lat/lng), поэтому расстояния считаем
 * в локальной метрической проекции вокруг НТМК. Для площадки/района этого
 * достаточно точно и не требует внешнего геосервиса.
 */

import type { LatLng, MapRoad } from './map-types';
import { distanceMeters, latLngToMeters, metersToLatLng } from './geo';

export interface DemandPoint extends LatLng {
  weight: number;
}

export interface OptimizeInput {
  /** Текущее положение склада отгрузки. */
  source: LatLng;
  /** Точки спроса (куда возим) с весами (объём/кол-во). */
  demand: DemandPoint[];
  /** Нарисованные дороги — для привязки оптимума «к удобному месту». */
  roads: MapRoad[];
  /** Радиус привязки к дороге в метрах. */
  snapRadiusMeters?: number;
}

export interface OptimizeResult {
  /** Центр масс (грубо). */
  centroid: LatLng;
  /** Точный оптимум (геометрическая медиана). */
  optimal: LatLng;
  /** Оптимум, привязанный к ближайшей дороге (null — дорог рядом нет). */
  snapped: LatLng | null;
  currentCost: number;
  optimalCost: number;
  /** Стоимость в привязанной к дороге точке (если есть). */
  snappedCost: number | null;
  /** % экономии оптимума относительно текущего: (тек−опт)/тек×100. */
  improvementPct: number;
  /** % экономии привязанной точки относительно текущего. */
  snappedImprovementPct: number | null;
}

function dxy(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Суммарная транспортная стоимость точки loc до всех точек спроса. */
export function totalCost(loc: LatLng, demand: DemandPoint[]): number {
  let sum = 0;
  for (const d of demand) {
    sum += (d.weight || 0) * distanceMeters(loc, d);
  }
  return sum;
}

function weightedCentroid(demand: DemandPoint[]): LatLng {
  let x = 0;
  let y = 0;
  let wsum = 0;
  for (const d of demand) {
    const w = d.weight || 0;
    const m = latLngToMeters(d);
    x += m.x * w;
    y += m.y * w;
    wsum += w;
  }
  if (wsum <= 0) return { lat: 57.9304, lng: 60.0355 };
  return metersToLatLng({ x: x / wsum, y: y / wsum });
}

/** Геометрическая медиана через итерации Вейсфельда (в метрах). */
function geometricMedian(demand: DemandPoint[], start: LatLng): LatLng {
  let cur = latLngToMeters(start);
  const pts = demand.map((d) => ({ ...latLngToMeters(d), w: d.weight || 0 }));
  for (let iter = 0; iter < 80; iter++) {
    let numX = 0;
    let numY = 0;
    let den = 0;
    for (const p of pts) {
      const dist = dxy(cur.x, cur.y, p.x, p.y);
      if (dist < 1e-6) continue;
      const inv = p.w / dist;
      numX += p.x * inv;
      numY += p.y * inv;
      den += inv;
    }
    if (den <= 0) break;
    const next = { x: numX / den, y: numY / den };
    const move = dxy(cur.x, cur.y, next.x, next.y);
    cur = next;
    if (move < 0.01) break;
  }
  return metersToLatLng(cur);
}

function nearestOnSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; dist: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * abx;
  const y = a.y + t * aby;
  return { x, y, dist: dxy(p.x, p.y, x, y) };
}

/** Ближайшая точка на всех дорогах к loc; null если дальше радиуса/нет дорог. */
export function nearestOnRoads(loc: LatLng, roads: MapRoad[], maxDistMeters: number): LatLng | null {
  const lp = latLngToMeters(loc);
  let best: { x: number; y: number; dist: number } | null = null;
  for (const road of roads) {
    for (let i = 0; i < road.vertices.length - 1; i++) {
      const a = latLngToMeters(road.vertices[i]!);
      const b = latLngToMeters(road.vertices[i + 1]!);
      const cand = nearestOnSegment(lp, a, b);
      if (!best || cand.dist < best.dist) best = cand;
    }
  }
  if (!best || best.dist > maxDistMeters) return null;
  return metersToLatLng(best);
}

export function optimize(input: OptimizeInput): OptimizeResult | null {
  const { source, demand, roads } = input;
  const valid = demand.filter((d) => (d.weight || 0) > 0);
  if (valid.length === 0) return null;

  const centroid = weightedCentroid(valid);
  const optimal = geometricMedian(valid, centroid);
  const snapped = roads.length > 0
    ? nearestOnRoads(optimal, roads, input.snapRadiusMeters ?? 450)
    : null;

  const currentCost = totalCost(source, valid);
  const optimalCost = totalCost(optimal, valid);
  const snappedCost = snapped ? totalCost(snapped, valid) : null;

  const pct = (cost: number): number =>
    currentCost > 0 ? ((currentCost - cost) / currentCost) * 100 : 0;

  return {
    centroid,
    optimal,
    snapped,
    currentCost,
    optimalCost,
    snappedCost,
    improvementPct: pct(optimalCost),
    snappedImprovementPct: snappedCost != null ? pct(snappedCost) : null,
  };
}
