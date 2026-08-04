/**
 * Блок 3 Сводки: сбор машин (как шапка «Экспедиторам»).
 *
 * Несколько дней = ОДИН пул:
 *  · только строки с гаражным № (машина указана);
 *  · только вывезенные (выполнено / самовывоз / цех·самовывоз);
 *  · без машины + не вывезено → в блок 3 НЕ попадает (ошибка «фантомных» складов);
 *  · экспедиторы в счётчике — по роли потока (см. countFleetPeople).
 */
import type { FlowDeliveryRow } from '@pyn/core';
import { isFlowStatShipped } from '@pyn/core';
import {
  buildExpedGroups,
  type ExpedGroup,
  type ExpedXlsxRow,
} from '@/components/flow/flow-export-xlsx';

function splitMulti(raw: string): string[] {
  return String(raw || '')
    .split(/[\n;,|/]+/)
    .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

function deliveryExps(r: FlowDeliveryRow): string[] {
  return splitMulti([r.exp1 || '', r.exp2 || ''].filter(Boolean).join('\n'));
}

/**
 * Ключ гаражного для слияния дней: «гр. № 363» / «363» / « 363 » → один.
 * Пустой → '' (не ТС).
 */
export function normGarageKey(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^(гр\.?\s*№\s*|гр\.?\s*№?|№\s*)/i, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s.toUpperCase();
}

/**
 * Идентификатор экспедитора для unique-счёта:
 *  · табельный «1053184» → tab:…;
 *  · ФИО «Иванов Иван Петрович» / «Иванов И.» → fio:ИВАНОВ|И
 *    (один человек на 3 дня = 1, даже если в один день полное, в другой — кратко).
 */
export function expeditorId(raw: string): string {
  let t = String(raw || '')
    .trim()
    .replace(/^\d+[.)]\s*/, '');
  if (!t) return '';
  // отрезать телефон в конце
  t = t
    .replace(/[,\s;]*(\+?7|8)[\s\-()]?\d[\d\s\-()]{8,}\s*$/i, '')
    .trim();
  if (!t) return '';
  if (/^\d{4,10}$/.test(t)) return `tab:${t}`;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const fam = words[0]!.replace(/[.,]/g, '').toUpperCase();
  const namePart = (words[1] ?? '').replace(/[.,]/g, '');
  const init = namePart.slice(0, 1).toUpperCase();
  if (!fam) return '';
  return `fio:${fam}|${init}`;
}

/** Уникальные подписи экспедиторов (по id), предпочитаем более полное ФИО. */
export function uniqExpeditorLabels(fios: readonly string[]): string[] {
  const byId = new Map<string, string>();
  for (const f of fios) {
    const id = expeditorId(f);
    if (!id) continue;
    const label = f.trim().replace(/^\d+[.)]\s*/, '');
    const cur = byId.get(id);
    if (!cur || label.length > cur.length) byId.set(id, label);
  }
  return [...byId.values()];
}

function rowStatRaw(r: FlowDeliveryRow): { stat: string; sub: string } {
  const stat = String(r.stat || '').trim();
  const sub = String(r.stat_sub || '').trim();
  if (stat) return { stat, sub };
  const ds = String(r.done_stat || '').trim();
  if (ds === 'выполнено' || ds === 'увезли') return { stat: 'выполнено', sub: '' };
  if (ds === 'самовывоз') return { stat: 'самовывоз', sub: '' };
  return { stat: '', sub: '' };
}

/**
 * Зафиксированные строки выбранных дней → группы машин.
 * Все дни сливаются: один гаражный = одна машина, От/СП — только с этой машины.
 * Пустой результат → блок 3 не показываем.
 */
export function buildReportFleetGroups(
  rows: readonly FlowDeliveryRow[],
  days: readonly string[],
): ExpedGroup[] {
  const daySet = new Set(days.map((d) => String(d).slice(0, 10)).filter(Boolean));
  if (daySet.size === 0) return [];

  /** normKey → как показывать гаражный (первый «красивый» вид). */
  const garageDisplay = new Map<string, string>();
  const inputs: ExpedXlsxRow[] = [];

  for (const r of rows) {
    if (!(Number(r.fixation_id) > 0)) continue;
    if (Number(r.reserved) > 0) continue;
    // Только с машиной (гаражный). Без № → в блок 3 не пишем (даже если есть От/СП).
    const garageRaw = splitMulti(r.ride_id || '')[0] ?? '';
    const gKey = normGarageKey(garageRaw);
    if (!gKey) continue;

    // Только вывезенное. Не выполнено / не самовывоз + нет машины уже отсечено;
    // с машиной, но не вывезено — в сводку машин тоже не тащим.
    const { stat, sub } = rowStatRaw(r);
    if (!isFlowStatShipped(stat, sub)) continue;

    /**
     * Машина считается в дне, где РЕАЛЬНО увезли: DAY факт, иначе DAY плана.
     * Досрочная строка уезжает в свой день факта вместе с машиной, а в дне
     * плана выпадает из блока 3 — машина остаётся там только если есть другие
     * вывезенные строки этого дня (юзер 2026-08-04).
     */
    const factRaw = String(r.day_fact || '').slice(0, 10);
    const pd = /^\d{4}-\d{2}-\d{2}$/.test(factRaw)
      ? factRaw
      : String(r.plan_date || '').slice(0, 10);
    if (!daySet.has(pd)) continue;

    if (!garageDisplay.has(gKey)) {
      const disp = garageRaw
        .trim()
        .replace(/^(гр\.?\s*№\s*|гр\.?\s*№?|№\s*)/i, '')
        .trim();
      garageDisplay.set(gKey, disp || gKey);
    }

    const vehicleType = splitMulti(r.vehicle || '').join(', ');
    const exps = deliveryExps(r);

    inputs.push({
      fr: String(r.fr || '').trim(),
      to_wh: String(r.to_wh || '').trim(),
      dlv: String(r.dlv || '').trim(),
      dlv_pos: String(r.dlv_pos || '').trim(),
      mat: String(r.mat || '').trim(),
      no_num: String(r.no_num || '').trim(),
      qty: r.qty ?? null,
      clst: '',
      garage: gKey,
      vehicleType,
      expeditors: exps,
      mol: '',
      molPhone: '',
      uom: String(r.uom || '').trim(),
      kg: null,
      v: null,
      note: '',
      matNote: '',
      fillArgb: '',
    });
  }

  const groups = buildExpedGroups(inputs);
  // пустой гаражный (если buildExpedGroups вдруг сгруппировал) — выкинуть
  return groups
    .filter((g) => !!normGarageKey(g.garage))
    .map((g) => {
      const key = normGarageKey(g.garage);
      return {
        ...g,
        garage: key ? garageDisplay.get(key) || g.garage : '',
        expeditors: uniqExpeditorLabels(g.expeditors),
      };
    });
}

/** ТС = уникальные гаражные №; «Без машины» = 0. */
export function countFleetVehicles(groups: readonly ExpedGroup[]): number {
  const keys = new Set<string>();
  for (const g of groups) {
    const k = normGarageKey(g.garage);
    if (k) keys.add(k);
  }
  return keys.size;
}

/** Роль потока контакта (broadcastGroup). */
export type FleetFlowRole = 'expeditor' | 'driver_expeditor' | 'other';

/**
 * Уникальные лица из шапок машин, разбитые по роли потока:
 *  · Экспедиторы — только «Экспедиторы»;
 *  · Водители-экспедиторы — «Водители-экспедиторы»;
 *  · Иные — указаны в exp, но роли потока нет.
 * resolveRole(fio) → роль по базе контактов (null = иной).
 */
export function countFleetPeople(
  groups: readonly ExpedGroup[],
  resolveRole: (fio: string) => FleetFlowRole | null,
): { expeditors: number; driverExpeditors: number; others: number } {
  const byRole = {
    expeditor: new Set<string>(),
    driver_expeditor: new Set<string>(),
    other: new Set<string>(),
  };
  for (const g of groups) {
    for (const fio of g.expeditors) {
      const id = expeditorId(fio);
      if (!id) continue;
      const role = resolveRole(fio) ?? 'other';
      byRole[role].add(id);
    }
  }
  return {
    expeditors: byRole.expeditor.size,
    driverExpeditors: byRole.driver_expeditor.size,
    others: byRole.other.size,
  };
}

/** @deprecated → countFleetPeople; оставляет только роль «Экспедиторы». */
export function countFleetExpeditors(
  groups: readonly ExpedGroup[],
  resolveRole?: (fio: string) => FleetFlowRole | null,
): number {
  if (!resolveRole) {
    const seen = new Set<string>();
    for (const g of groups) {
      for (const fio of g.expeditors) {
        const id = expeditorId(fio);
        if (id) seen.add(id);
      }
    }
    return seen.size;
  }
  return countFleetPeople(groups, resolveRole).expeditors;
}

/** Однострочный заголовок машины (как xlsx line1). */
export function fleetGroupLine1(g: ExpedGroup): string {
  const base = g.garage
    ? ['гр. №', g.garage, g.vehicleType].filter(Boolean).join('   ')
    : g.vehicleType
      ? `Без №   ${g.vehicleType}`
      : 'Без машины';
  if (g.expeditors.length === 0) return `${base}   Экспедитор не указан`;
  const exp = g.expeditors.map((f, i) => `${i + 1}. ${f}`).join('   ');
  return `${base}   ${exp}`;
}

export type { ExpedGroup };
