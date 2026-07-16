/**
 * Сборка payload OR-Tools для Потока.
 *
 * Окна доставки + смена машины:
 *  - обычная (7.x / 1.1): 08:00–20:00, обед 12:00–12:30;
 *  - дневная (1.2 / 2.x): 08:00–конец из производственного календаря
 *    (ПН–ЧТ 17:00, ПТ 15:45, предпраздничный −1ч);
 *  - факт начала/конца и time_range строки Транспорта;
 *  - открытый форс-мажор → машина не в плане;
 *  - окна получателя clamp'ятся в рамки смены (не шире 08:00–20:00).
 *
 * Г/п: эталон типа + уточнение 1С (adjustedBodyTypeCapacityKg).
 */
import type {
  FlowDeliveryRow,
  FlowRow,
  FlowTransportRow,
  FlowVehicle,
  OptimizationBreakInput,
  OptimizationPayload,
  OptimizationVehicleInput,
} from '@pyn/core';
import { POINT_VEHICLE_TYPES, type MapPoint } from '@/components/map/map-types';
import {
  DAY_LUNCH_END_MIN,
  DAY_LUNCH_START_MIN,
  SHIFT_LUNCH_END_MIN,
  SHIFT_LUNCH_START_MIN,
  SHIFT_START_MIN,
  dayShiftEndMin,
  isNonWorkingDay,
  pickYear,
  type ProdCalendarByYear,
} from '@/lib/prod-calendar';
import { adjustedBodyTypeCapacityKg } from './flow-body-types';
import { deliveryRowEps, parseDeliveryWindow } from './flow-eps';
import {
  expectedShiftEndMin,
  expectedShiftKind,
  parseTimeRangeBounds,
  type TransportShiftKind,
} from './flow-transport-shift';
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

function vehicleTypeId(label: string): string {
  return POINT_VEHICLE_TYPES.find(
    (vehicle) => vehicle.label.toLocaleLowerCase('ru') === label.trim().toLocaleLowerCase('ru'),
  )?.id ?? '';
}

function hmToMin(value: string | null | undefined): number | null {
  const m = /(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseForceList(raw: string | null | undefined): Array<{ reason: string; start: string; end: string }> {
  try {
    const rows = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      reason: String((r as { reason?: string; title?: string })?.reason
        || (r as { title?: string })?.title || '').trim(),
      start: String((r as { start?: string; from?: string })?.start
        || (r as { from?: string })?.from || '').trim(),
      end: String((r as { end?: string; to?: string })?.end
        || (r as { to?: string })?.to || '').trim(),
    })).filter((r) => r.reason || r.start || r.end);
  } catch {
    return [];
  }
}

/**
 * Рамка смены машины на дату:
 *  - kind из префикса РАБОТА + конец дневной смены из произв. календаря;
 *  - fact_start / time_range / fact_end уточняют;
 *  - обед + закрытые форс-мажоры → breaks.
 */
export function vehicleShiftForTransport(
  row: FlowTransportRow,
  calByYear: ProdCalendarByYear | null | undefined,
): {
  kind: TransportShiftKind | null;
  shiftStartMin: number;
  shiftEndMin: number;
  breaks: OptimizationBreakInput[];
  skip: boolean;
  skipReason?: string;
} {
  const kind = expectedShiftKind(row.work || '');
  const tdate = String(row.tdate || '').slice(0, 10);
  const expectedEnd = kind
    ? expectedShiftEndMin(kind, tdate, calByYear)
    : 20 * 60;

  // Дневная смена: конец из произв. календаря; нерабочий день → машина не в плане.
  let dayEnd: number | null = expectedEnd;
  if (kind === 'day') {
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(tdate);
    if (dm) {
      const y = Number(dm[1]);
      const mo = Number(dm[2]);
      const d = Number(dm[3]);
      const cal = pickYear(calByYear, y);
      if (isNonWorkingDay(cal, y, mo, d)) {
        return {
          kind,
          shiftStartMin: SHIFT_START_MIN,
          shiftEndMin: expectedEnd,
          breaks: [],
          skip: true,
          skipReason: 'нерабочий день (производственный календарь)',
        };
      }
      dayEnd = dayShiftEndMin(cal, y, mo, d) ?? expectedEnd;
    }
  }

  const plan = parseTimeRangeBounds(row.time_range || '');
  let startMin = SHIFT_START_MIN;
  const factStart = hmToMin(row.fact_start);
  if (factStart != null) startMin = Math.max(SHIFT_START_MIN, factStart);
  else if (plan) startMin = Math.max(SHIFT_START_MIN, plan.startMin);

  let endMin = dayEnd ?? expectedEnd;
  const factEnd = hmToMin(row.fact_end);
  if (factEnd != null) endMin = Math.min(factEnd, endMin);
  else if (plan) endMin = Math.min(plan.endMin, endMin);
  if (endMin <= startMin) endMin = Math.min(expectedEnd, startMin + 60);

  const forces = parseForceList(row.force_json);
  // Открытый форс (начало без конца) → машина вне плана.
  if (forces.some((f) => f.start && !f.end)) {
    return {
      kind,
      shiftStartMin: startMin,
      shiftEndMin: endMin,
      breaks: [],
      skip: true,
      skipReason: 'открытый форс-мажор',
    };
  }

  const breaks: OptimizationBreakInput[] = [];
  // Обед: дневная 12:00–12:45; обычная 12:00–12:30.
  const lunchStart = kind === 'day' ? DAY_LUNCH_START_MIN : SHIFT_LUNCH_START_MIN;
  const lunchEnd = kind === 'day' ? DAY_LUNCH_END_MIN : SHIFT_LUNCH_END_MIN;
  if (lunchEnd > startMin && lunchStart < endMin) {
    breaks.push({ start_min: lunchStart, end_min: lunchEnd, label: 'lunch' });
  }
  for (const f of forces) {
    const a = hmToMin(f.start);
    const b = hmToMin(f.end);
    if (a == null || b == null || b <= a) continue;
    if (b <= startMin || a >= endMin) continue;
    breaks.push({
      start_min: a,
      end_min: b,
      label: (f.reason || 'force').slice(0, 40),
    });
  }

  return { kind, shiftStartMin: startMin, shiftEndMin: endMin, breaks, skip: false };
}

/** Clamp окна доставки в рамки [08:00, outerEnd] (по умолчанию 20:00). */
export function clampDeliveryWindow(
  delivery: string | null | undefined,
  outerStart = SHIFT_START_MIN,
  outerEnd = 20 * 60,
): [number, number] {
  const parsed = parseDeliveryWindow(delivery);
  let start = parsed ? parsed[0] : outerStart;
  let end = parsed ? parsed[1] : outerEnd;
  start = Math.max(outerStart, Math.min(outerEnd - 1, start));
  end = Math.max(start + 1, Math.min(outerEnd, end));
  return [start, end];
}

export interface FlowOptimizationBuildInput {
  rows: readonly FlowDeliveryRow[];
  anchors: ReadonlyMap<string, FlowRow>;
  mapPoints: readonly MapPoint[];
  transport: readonly FlowTransportRow[];
  vehicles: readonly FlowVehicle[];
  weightByNo: ReadonlyMap<string, number>;
  /** Операционный день YYYY-MM-DD (для дневной смены / календаря). */
  operationalDay?: string;
  /** Производственный календарь (seed ∪ сервер). */
  calByYear?: ProdCalendarByYear | null;
}

export function buildFlowOptimizationPayload(input: FlowOptimizationBuildInput): {
  payload: OptimizationPayload;
  warnings: string[];
  meta: {
    operational_day: string;
    vehicles_in: number;
    vehicles_skipped: number;
    day_shift_used: boolean;
  };
} {
  const warnings: string[] = [];
  const calByYear = input.calByYear ?? null;
  const operationalDay = String(
    input.operationalDay
    || input.transport[0]?.tdate
    || new Date().toISOString().slice(0, 10),
  ).slice(0, 10);

  const registry = new Map(input.vehicles.map((vehicle) => [vehicle.garage_no.trim(), vehicle]));
  const fleet: OptimizationVehicleInput[] = [];
  let skipped = 0;
  let dayShiftUsed = false;

  for (const row of input.transport) {
    if (!row.garage_no.trim()) continue;
    if (row.out_status.trim().toUpperCase() === 'НЕТ') continue;
    if (row.status.trim().toLowerCase() === 'отмена') continue;

    const shift = vehicleShiftForTransport(row, calByYear);
    if (shift.kind === 'day') dayShiftUsed = true;
    if (shift.skip) {
      skipped += 1;
      warnings.push(`${row.garage_no}: ${shift.skipReason || 'пропуск'}`);
      continue;
    }

    const ref = registry.get(row.garage_no.trim());
    const typeId = vehicleTypeId(row.vehicle_type || '');
    fleet.push({
      id: row.garage_no.trim(),
      type_id: typeId,
      capacity_kg: Math.round(adjustedBodyTypeCapacityKg(row.vehicle_type || '', {
        capacityKg: ref?.capacity_kg,
        maxMassKg: ref?.max_mass_kg,
      }) || 0),
      start_node: 0,
      end_node: 0,
      shift_start_min: shift.shiftStartMin,
      shift_end_min: shift.shiftEndMin,
      breaks: shift.breaks,
    });
  }

  const sourceWarehouses = [...new Set(input.rows.map((row) => row.fr.trim()).filter(Boolean))];
  const depotCandidates = sourceWarehouses.flatMap((warehouse) =>
    pointsForWarehouse(input.mapPoints, warehouse, 'exped').map((point) => ({ lat: point.lat, lng: point.lng })),
  );
  const depot = average(depotCandidates) ?? { lat: 0, lng: 0 };
  if (depotCandidates.length === 0) {
    warnings.push('Не заданы точки Экспедиции складов погрузки - используется fallback матрицы');
  }

  // Внешняя рамка окон получателя: 08:00–20:00 (обычная смена).
  // Дневные машины всё равно упрутся в свой shift_end раньше.
  const OUTER_START = SHIFT_START_MIN;
  const OUTER_END = 20 * 60;

  const coords: LatLng[] = [depot];
  const positions = input.rows.map((row, index) => {
    const anchor = input.anchors.get(`${row.ord}|${row.it}`);
    const names = effectivePointNames(anchor?.point, input.mapPoints, row.to_wh, 'exped');
    const selectedPoints = names
      .map((name) => findPurposePoint(input.mapPoints, row.to_wh, name, 'exped'))
      .filter((point): point is MapPoint => point !== null);
    const warehousePoints = pointsForWarehouse(input.mapPoints, row.to_wh, 'exped');
    const coord = average(
      (selectedPoints.length > 0 ? selectedPoints : warehousePoints)
        .map((point) => ({ lat: point.lat, lng: point.lng })),
    ) ?? depot;
    coords.push(coord);

    const vehicleInfo = vehicleInfoForNames(input.mapPoints, row.to_wh, names, 'exped');
    if (names.length === 0) warnings.push(`${row.ord}|${row.it}: точка не выбрана, координаты усреднены`);
    if (vehicleInfo.warning) warnings.push(`${row.ord}|${row.it}: ${vehicleInfo.warning}`);
    const compatible = names.length === 0 || vehicleInfo.vehicleIds.length === 0
      ? null
      : fleet
        .filter((vehicle) => vehicleInfo.vehicleIds.includes(vehicle.type_id as never))
        .map((vehicle) => vehicle.id);
    const [windowStart, windowEnd] = clampDeliveryWindow(
      anchor?.delivery || '',
      OUTER_START,
      OUTER_END,
    );
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
    payload: {
      positions,
      vehicles: fleet,
      time_matrix: timeMatrix,
      time_limit_s: 8,
    },
    warnings: [...new Set(warnings)],
    meta: {
      operational_day: operationalDay,
      vehicles_in: fleet.length,
      vehicles_skipped: skipped,
      day_shift_used: dayShiftUsed,
    },
  };
}
