import type {
  FlowDeliveryRow,
  FlowRow,
  FlowTransportRow,
  FlowVehicle,
  OptimizationPayload,
} from '@pyn/core';
import { POINT_VEHICLE_TYPES, type MapPoint } from '@/components/map/map-types';
import { adjustedBodyTypeCapacityKg } from './flow-body-types';
import { deliveryRowEps, parseDeliveryWindow } from './flow-eps';
import {
  effectivePointNames,
  findPurposePoint,
  pointsForWarehouse,
  vehicleInfoForNames,
} from './flow-map-points';

interface LatLng { lat: number; lng: number }

function average(points: readonly LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function distanceM(a: LatLng, b: LatLng): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function timeRange(value: string, fallback: [number, number] = [510, 1170]): [number, number] {
  return parseDeliveryWindow(value) ?? fallback;
}

function vehicleTypeId(label: string): string {
  return POINT_VEHICLE_TYPES.find((vehicle) => vehicle.label.toLocaleLowerCase('ru') === label.trim().toLocaleLowerCase('ru'))?.id ?? '';
}

export interface FlowOptimizationBuildInput {
  rows: readonly FlowDeliveryRow[];
  anchors: ReadonlyMap<string, FlowRow>;
  mapPoints: readonly MapPoint[];
  transport: readonly FlowTransportRow[];
  vehicles: readonly FlowVehicle[];
  weightByNo: ReadonlyMap<string, number>;
}

export function buildFlowOptimizationPayload(input: FlowOptimizationBuildInput): {
  payload: OptimizationPayload;
  warnings: string[];
} {
  const warnings: string[] = [];
  const registry = new Map(input.vehicles.map((vehicle) => [vehicle.garage_no.trim(), vehicle]));
  const fleet = input.transport
    .filter((row) => row.garage_no.trim() && row.out_status.trim().toUpperCase() !== 'НЕТ' && row.status.trim().toLowerCase() !== 'отмена')
    .map((row) => {
      const ref = registry.get(row.garage_no.trim());
      const typeId = vehicleTypeId(row.vehicle_type || '');
      const [shiftStart, shiftEnd] = timeRange(
        row.fact_start && row.fact_end ? `${row.fact_start}-${row.fact_end}` : row.time_range,
      );
      return {
        id: row.garage_no.trim(),
        type_id: typeId,
        capacity_kg: Math.round(adjustedBodyTypeCapacityKg(row.vehicle_type || '', {
          capacityKg: ref?.capacity_kg,
          maxMassKg: ref?.max_mass_kg,
        }) || 0),
        start_node: 0,
        end_node: 0,
        shift_start_min: shiftStart,
        shift_end_min: shiftEnd,
      };
    });

  const sourceWarehouses = [...new Set(input.rows.map((row) => row.fr.trim()).filter(Boolean))];
  const depotCandidates = sourceWarehouses.flatMap((warehouse) =>
    pointsForWarehouse(input.mapPoints, warehouse, 'exped').map((point) => ({ lat: point.lat, lng: point.lng })),
  );
  const depot = average(depotCandidates) ?? { lat: 0, lng: 0 };
  if (depotCandidates.length === 0) warnings.push('Не заданы точки Экспедиции складов погрузки - используется fallback матрицы');

  const coords: LatLng[] = [depot];
  const positions = input.rows.map((row, index) => {
    const anchor = input.anchors.get(`${row.ord}|${row.it}`);
    const names = effectivePointNames(anchor?.point, input.mapPoints, row.to_wh, 'exped');
    const selectedPoints = names
      .map((name) => findPurposePoint(input.mapPoints, row.to_wh, name, 'exped'))
      .filter((point): point is MapPoint => point !== null);
    const warehousePoints = pointsForWarehouse(input.mapPoints, row.to_wh, 'exped');
    // Unknown selected point: use the average of all Expedition points of TO.
    const coord = average((selectedPoints.length > 0 ? selectedPoints : warehousePoints).map((point) => ({ lat: point.lat, lng: point.lng }))) ?? depot;
    coords.push(coord);

    const vehicleInfo = vehicleInfoForNames(input.mapPoints, row.to_wh, names, 'exped');
    if (names.length === 0) warnings.push(`${row.ord}|${row.it}: точка не выбрана, координаты усреднены`);
    if (vehicleInfo.warning) warnings.push(`${row.ord}|${row.it}: ${vehicleInfo.warning}`);
    const compatible = names.length === 0 || vehicleInfo.vehicleIds.length === 0
      ? null
      : fleet.filter((vehicle) => vehicleInfo.vehicleIds.includes(vehicle.type_id as never)).map((vehicle) => vehicle.id);
    const [windowStart, windowEnd] = timeRange(anchor?.delivery || '');
    const weight = input.weightByNo.get(row.no_num.trim()) || 0;
    const eps = deliveryRowEps(row, anchor).eps;
    const locked = String(row.ride_id || '').split('\n').map((value) => value.trim()).find(Boolean) || null;
    return {
      id: String(row.id),
      node: index + 1,
      demand_kg: Math.max(0, Math.round(weight * Number(row.qty || 0))),
      service_min: 30,
      window_start_min: windowStart,
      window_end_min: windowEnd,
      allowed_vehicle_ids: compatible,
      locked_vehicle_id: locked,
      eps,
    };
  });

  const timeMatrix = coords.map((from, fromIndex) => coords.map((to, toIndex) => {
    if (fromIndex === toIndex) return 0;
    if ((from.lat === 0 && from.lng === 0) || (to.lat === 0 && to.lng === 0)) return 20;
    return Math.max(1, Math.ceil((distanceM(from, to) * 1.6) / (20_000 / 60)));
  }));

  return {
    payload: { positions, vehicles: fleet, time_matrix: timeMatrix, time_limit_s: 8 },
    warnings: [...new Set(warnings)],
  };
}
