/**
 * Блок 2 Сводки: сбор машин (как шапка файла «Экспедиторам»).
 *
 * Несколько дней в сводке = ОДИН пул:
 *  · ТС — уникальные гаражные № (без гаражного не считается);
 *  · экспедиторы — уникальные по id (фамилия+инициал / табельный), не «на каждый день».
 */
import type { FlowDeliveryRow } from '@pyn/core';
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

/**
 * Зафиксированные строки выбранных дней → группы машин.
 * Все дни сливаются: один гаражный = одна машина, От/СП — объединение.
 * Пустой результат → блок 2 не показываем.
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
    const pd = String(r.plan_date || '').slice(0, 10);
    if (!daySet.has(pd)) continue;

    const garageRaw = splitMulti(r.ride_id || '')[0] ?? '';
    const gKey = normGarageKey(garageRaw);
    if (gKey && !garageDisplay.has(gKey)) {
      // display: без «ГР. №», как введённый номер
      const disp = garageRaw
        .trim()
        .replace(/^(гр\.?\s*№\s*|гр\.?\s*№?|№\s*)/i, '')
        .trim();
      garageDisplay.set(gKey, disp || gKey);
    }

    const vehicleType = splitMulti(r.vehicle || '').join(', ');
    const exps = deliveryExps(r);
    if (!gKey && !vehicleType && exps.length === 0 && !r.fr && !r.to_wh) continue;

    inputs.push({
      fr: String(r.fr || '').trim(),
      to_wh: String(r.to_wh || '').trim(),
      dlv: String(r.dlv || '').trim(),
      dlv_pos: String(r.dlv_pos || '').trim(),
      mat: String(r.mat || '').trim(),
      no_num: String(r.no_num || '').trim(),
      qty: r.qty ?? null,
      clst: '',
      // ключ слияния по дням — нормализованный гаражный
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
  // display-гаражный + уникальные экспедиторы (один человек на N дней)
  return groups.map((g) => {
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

/** Экспедиторы = уникальные id по всем машинам/дням (не × число дней). */
export function countFleetExpeditors(groups: readonly ExpedGroup[]): number {
  const seen = new Set<string>();
  for (const g of groups) {
    for (const fio of g.expeditors) {
      const id = expeditorId(fio);
      if (id) seen.add(id);
    }
  }
  return seen.size;
}

/** Однострочный заголовок машины (как xlsx line1). */
export function fleetGroupLine1(g: ExpedGroup): string {
  const base = g.garage
    ? ['гр. №', g.garage, g.vehicleType].filter(Boolean).join('   ')
    : g.vehicleType
      ? `Без №   ${g.vehicleType}`
      : 'Без машины';
  if (g.expeditors.length === 0) return base;
  const exp = g.expeditors.map((f, i) => `${i + 1}. ${f}`).join('   ');
  return `${base}   ${exp}`;
}

export type { ExpedGroup };
