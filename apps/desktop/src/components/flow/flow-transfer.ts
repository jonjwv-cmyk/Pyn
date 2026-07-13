/**
 * T4 — модель переноса: подписи МАТ (как fmtCarryFrom на сайте), цепочка transfer_src.
 * День в Формировании = выбранный в Отчёте календарный день (ВТ 7 → ВТ 7).
 */
import type { FlowDeliveryRow } from '@pyn/core';

export const TRANSFER_REASON = 'перенос на другой день';

const TRANSFER_DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'] as const;

const MONTH_NOM_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/** «июль 8» или «июль 8 2025» — год только если ≠ refYear (как на сайте). */
function nomDateLabel(iso: string, refYear = new Date().getFullYear()): string {
  const day = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  const yearSuffix = y !== refYear ? ` ${y}` : '';
  return `${MONTH_NOM_RU[mo] ?? day.slice(5, 7)} ${d}${yearSuffix}`;
}

/**
 * Красная первая строка МАТ: день Отчёта-источника переноса.
 * «Перенос с СР июль 8» (год — только при переходе через год границы).
 */
export function transferMatPrefix(iso: string, refYear?: number): string {
  const day = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day ? `Перенос с ${day}` : '';
  const dow = TRANSFER_DOW[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? '';
  return `Перенос с ${dow} ${nomDateLabel(day, refYear)}`;
}

/** Обманка «выполнено»: «Было в плане на июль 8» (+ год по тому же правилу). */
export function planWasMatPrefix(iso: string, refYear?: number): string {
  const day = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day ? `Было в плане на ${day}` : '';
  return `Было в плане на ${nomDateLabel(day, refYear)}`;
}

/** Дата YYYY-MM-DD → «12 июня» (короткий показ в сообщениях UI). */
export function fmtTransferDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  const mo = Number(m[2]) - 1;
  const d = parseInt(m[3] ?? '1', 10);
  const short = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${d} ${short[mo] ?? m[2]}`;
}

/** Цепочка plan_date по transfer_src (старая → … → текущая). */
export function transferChainDates(
  r: FlowDeliveryRow,
  rowById: ReadonlyMap<number, FlowDeliveryRow>,
): string[] {
  const dates: string[] = [];
  const seen = new Set<number>();
  for (let cur: FlowDeliveryRow | undefined = r; cur && !seen.has(cur.id); ) {
    seen.add(cur.id);
    dates.unshift((cur.plan_date || '').slice(0, 10));
    const srcId: number = Number(cur.transfer_src) || 0;
    cur = srcId > 0 ? rowById.get(srcId) : undefined;
  }
  return dates;
}

/** Парсинг «перенос на другой день: YYYY-MM-DD» → целевая дата или ''. */
export function parseTransferTargetDate(failReason: string): string {
  const m = /^перенос на другой день: (\d{4}-\d{2}-\d{2})/.exec(String(failReason ?? '').trim());
  return m?.[1] ?? '';
}