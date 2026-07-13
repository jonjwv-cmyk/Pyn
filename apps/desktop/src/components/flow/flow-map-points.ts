// ============================================================
// flow-map-points.ts - bridge map -> Flow/site logistics semantics.
// ============================================================

import {
  EQUIPMENT_META,
  vehicleLabel,
  type MapPoint,
  type PointEquipment,
  type PointPurpose,
  type VehicleType,
} from '@/components/map/map-types';

/** A point belongs to a flow only when that purpose is explicitly selected. */
export function pointHasPurpose(point: MapPoint, purpose: PointPurpose): boolean {
  return Array.isArray(point.purposes) && point.purposes.includes(purpose);
}

export function pointsForWarehouse(
  points: readonly MapPoint[],
  warehouse: string,
  purpose: PointPurpose,
): MapPoint[] {
  const wh = String(warehouse || '').trim();
  if (!wh) return [];
  return points.filter(
    (point) =>
      String(point.warehouseId || '').trim() === wh &&
      pointHasPurpose(point, purpose) &&
      Boolean(String(point.label || '').trim()),
  );
}

export function pointNamesForWarehouse(
  points: readonly MapPoint[],
  warehouse: string,
  purpose: PointPurpose,
): string[] {
  return [...new Set(pointsForWarehouse(points, warehouse, purpose).map((point) => point.label.trim()))];
}

/** One point is filled automatically; several remain unselected. */
export function effectivePointNames(
  rowPoint: string | undefined,
  points: readonly MapPoint[],
  warehouse: string,
  purpose: PointPurpose,
): string[] {
  const selected = String(rowPoint || '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (selected.length > 0) return selected;
  const available = pointNamesForWarehouse(points, warehouse, purpose);
  return available.length === 1 ? available : [];
}

export function findPurposePoint(
  points: readonly MapPoint[],
  warehouse: string,
  label: string,
  purpose: PointPurpose,
): MapPoint | null {
  const normalized = String(label || '').trim().toLocaleLowerCase('ru');
  if (!normalized) return null;
  return (
    pointsForWarehouse(points, warehouse, purpose).find(
      (point) => point.label.trim().toLocaleLowerCase('ru') === normalized,
    ) ?? null
  );
}

/**
 * Modern map documents use the explicit purpose matrix. An empty column means
 * no vehicle types are marked. `allowedVehicles` is only a legacy fallback for
 * documents that do not have the matrix at all.
 */
export function vehiclesForPurpose(point: MapPoint, purpose: PointPurpose): VehicleType[] {
  const matrix = point.vehiclesByPurpose;
  if (matrix && typeof matrix === 'object') {
    return Array.isArray(matrix[purpose]) ? [...matrix[purpose]!] : [];
  }
  return Array.isArray(point.allowedVehicles) ? [...point.allowedVehicles] : [];
}

export function rearVehiclesForPurpose(point: MapPoint, purpose: PointPurpose): Set<VehicleType> {
  const matrix = point.rearByPurpose;
  if (matrix && typeof matrix === 'object') {
    return new Set(Array.isArray(matrix[purpose]) ? matrix[purpose] : []);
  }
  return point.rearUnload ? new Set(vehiclesForPurpose(point, purpose)) : new Set();
}

function vehicleRank(id: VehicleType, rear: ReadonlySet<VehicleType>, allowed: readonly VehicleType[]): number {
  const hasRearPullman = allowed.some(
    (candidate) => /^pullman/.test(candidate) && rear.has(candidate),
  );
  if (id === 'bort' && hasRearPullman) return -100;
  if (/^pullman/.test(id) && rear.has(id)) return -50 + allowed.indexOf(id);
  return allowed.indexOf(id);
}

export interface PointVehicleInfo {
  lines: string[];
  vehicleIds: VehicleType[];
  rearVehicleIds: VehicleType[];
  incomplete: boolean;
  warning: string;
}

/** Vehicle compatibility for selected points. Flow passes `exped`, site passes `tech`. */
export function vehicleInfoForNames(
  points: readonly MapPoint[],
  warehouse: string,
  names: readonly string[],
  purpose: PointPurpose,
): PointVehicleInfo {
  if (names.length === 0) {
    return { lines: [], vehicleIds: [], rearVehicleIds: [], incomplete: false, warning: '' };
  }

  const ids: VehicleType[] = [];
  const rear = new Set<VehicleType>();
  let missingPoint = false;
  for (const name of names) {
    const point = findPurposePoint(points, warehouse, name, purpose);
    if (!point) {
      missingPoint = true;
      continue;
    }
    for (const id of vehiclesForPurpose(point, purpose)) if (!ids.includes(id)) ids.push(id);
    for (const id of rearVehiclesForPurpose(point, purpose)) rear.add(id);
  }

  const sorted = [...ids].sort((a, b) => vehicleRank(a, rear, ids) - vehicleRank(b, rear, ids));
  const hasRearPullman = sorted.some((id) => /^pullman/.test(id) && rear.has(id));
  const lines = sorted.map((id) => {
    if (id === 'bort' && hasRearPullman) return `${vehicleLabel(id)} (приоритет)`;
    return `${vehicleLabel(id)}${rear.has(id) ? ' (сзади)' : ''}`;
  });
  const incomplete = missingPoint || sorted.length === 0;
  return {
    lines,
    vehicleIds: sorted,
    rearVehicleIds: sorted.filter((id) => rear.has(id)),
    incomplete,
    warning: incomplete
      ? 'Не отмечены типы ТС для назначения точки - расчет маршрута может быть неточным'
      : '',
  };
}

export function loadInfoForNames(
  points: readonly MapPoint[],
  warehouse: string,
  names: readonly string[],
  purpose: PointPurpose,
): string {
  return vehicleInfoForNames(points, warehouse, names, purpose).lines.join('\n');
}

export function unloadEquipKeysForNames(
  points: readonly MapPoint[],
  warehouse: string,
  names: readonly string[],
  purpose: PointPurpose,
): string[] {
  const keys = new Set<keyof PointEquipment>();
  for (const name of names) {
    const point = findPurposePoint(points, warehouse, name, purpose);
    if (!point) continue;
    for (const meta of EQUIPMENT_META) if (point.equipment?.[meta.key]) keys.add(meta.key);
  }
  return [...keys];
}

export const EQUIP_KEY_TO_LABEL: Record<string, string> = Object.fromEntries(
  EQUIPMENT_META.map((meta) => [meta.key, meta.label]),
);
export const EQUIP_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  EQUIPMENT_META.map((meta) => [meta.label, meta.key]),
);
export const EQUIP_LABELS: readonly string[] = EQUIPMENT_META.map((meta) => meta.label);

/** Override is stored as labels separated by newlines; empty means derive from the point. */
export function unloadDisplay(
  override: string | undefined,
  points: readonly MapPoint[],
  warehouse: string,
  names: readonly string[],
  purpose: PointPurpose,
): string {
  if (names.length === 0) return '';
  const overridden = String(override || '')
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (overridden.length > 0) return overridden.join('\n');
  return unloadEquipKeysForNames(points, warehouse, names, purpose)
    .map((key) => EQUIP_KEY_TO_LABEL[key] ?? key)
    .join('\n');
}
