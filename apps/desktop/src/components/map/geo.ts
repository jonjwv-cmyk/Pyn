import type { LatLng } from './map-types';

const EARTH_R = 6_371_000;
const REF_LAT = 57.9304;
const REF_LNG = 60.0355;
const REF_LAT_RAD = (REF_LAT * Math.PI) / 180;

export interface XYMeters {
  x: number;
  y: number;
}

export interface NearestPolylinePoint {
  point: LatLng;
  distance: number;
  segmentIndex: number;
  t: number;
}

export function latLngToMeters(p: LatLng): XYMeters {
  return {
    x: ((p.lng - REF_LNG) * Math.PI / 180) * EARTH_R * Math.cos(REF_LAT_RAD),
    y: ((p.lat - REF_LAT) * Math.PI / 180) * EARTH_R,
  };
}

export function metersToLatLng(p: XYMeters): LatLng {
  return {
    lat: REF_LAT + (p.y / EARTH_R) * 180 / Math.PI,
    lng: REF_LNG + (p.x / (EARTH_R * Math.cos(REF_LAT_RAD))) * 180 / Math.PI,
  };
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const am = latLngToMeters(a);
  const bm = latLngToMeters(b);
  return Math.hypot(am.x - bm.x, am.y - bm.y);
}

export function nearestPointOnPolyline(point: LatLng, polyline: LatLng[]): NearestPolylinePoint | null {
  if (polyline.length === 0) return null;
  if (polyline.length === 1) {
    const only = polyline[0]!;
    return { point: only, distance: distanceMeters(point, only), segmentIndex: 0, t: 0 };
  }

  const p = latLngToMeters(point);
  let best: NearestPolylinePoint | null = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const nearest = nearestOnSegment(p, latLngToMeters(polyline[i]!), latLngToMeters(polyline[i + 1]!));
    if (!best || nearest.distance < best.distance) {
      best = {
        point: metersToLatLng({ x: nearest.x, y: nearest.y }),
        distance: nearest.distance,
        segmentIndex: i,
        t: nearest.t,
      };
    }
  }
  return best;
}

export function distancePointToPolylineMeters(point: LatLng, polyline: LatLng[]): number {
  return nearestPointOnPolyline(point, polyline)?.distance ?? Infinity;
}

export function polylineLengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distanceMeters(points[i]!, points[i + 1]!);
  }
  return total;
}

export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 м';
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} км`;
}

// Границы старого встроенного снимка z17. Нужны только для мягкой миграции
// локального кэша, если пользователь успел поставить точки до перехода на MapLibre.
const LEGACY_BOUNDS = {
  north: 57.955674,
  south: 57.904634,
  west: 59.985352,
  east: 60.073242,
};

function mercY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function invMercY(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

function nearestOnSegment(p: XYMeters, a: XYMeters, b: XYMeters): XYMeters & { distance: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * abx;
  const y = a.y + t * aby;
  return { x, y, t, distance: Math.hypot(p.x - x, p.y - y) };
}

/** Нормализованная точка старой растровой подложки -> GPS. */
export function legacyNormToLatLng(x: number, y: number): LatLng {
  const lng = LEGACY_BOUNDS.west + x * (LEGACY_BOUNDS.east - LEGACY_BOUNDS.west);
  const yn = mercY(LEGACY_BOUNDS.north);
  const ys = mercY(LEGACY_BOUNDS.south);
  const lat = invMercY(yn + y * (ys - yn));
  return { lat, lng };
}
