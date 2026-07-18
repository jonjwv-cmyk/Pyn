import {
  DAY_SHIFT_END_MONTHU_MIN,
  DAY_SHIFT_START_MIN,
  SHIFT_START_MIN,
  dayShiftEndMin,
  pickYear,
} from '@/lib/prod-calendar';
import type { ProdCalendarByYear } from '@/lib/prod-calendar/types';

/** Тип смены по префиксу работы (колонка РАБОТА). */
export type TransportShiftKind = 'day' | 'regular';

/** «6.1. …» → { major: 6, minor: 1 }. */
export function parseWorkMajorMinor(work: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)/.exec((work || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Ведущий числовой блок («8.2 …» → 8). */
export function workMajorPrefix(work: string): number | null {
  const m = /^(\d+)/.exec((work || '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Ожидаемый тип смены по префиксу работы:
 * 1.1 → обычная 08:00–20:00; 1.2 / 2.n / 3.n → дневная (произв. календарь);
 * 7.n → обычная. Прочие — правил нет.
 */
export function expectedShiftKind(work: string): TransportShiftKind | null {
  const pm = parseWorkMajorMinor(work);
  if (!pm) return null;
  if (pm.major === 1 && pm.minor === 1) return 'regular';
  if (pm.major === 1 && pm.minor === 2) return 'day';
  if (pm.major === 2) return 'day';
  if (pm.major === 3) return 'day';
  if (pm.major === 7) return 'regular';
  return null;
}

/**
 * Авто-жирное ВРЕМЯ (только при вставке): дневная смена 1.2 / 2.n / 3.n,
 * если время короче полной смены по произв. календарю (ТЗ 17.07 п.11).
 */
export function isAutoTimeBoldWork(work: string): boolean {
  const pm = parseWorkMajorMinor(work);
  if (!pm) return false;
  if (pm.major === 1 && pm.minor === 2) return true;
  if (pm.major === 2 || pm.major === 3) return true;
  return false;
}

/** Парсинг «08:00-20:00» / «8:00 – 17:00» → минуты от полуночи. */
export function parseTimeRangeBounds(timeRange: string): { startMin: number; endMin: number } | null {
  const m = /(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/.exec(timeRange || '');
  if (!m) return null;
  return {
    startMin: Number(m[1]) * 60 + Number(m[2]),
    endMin: Number(m[3]) * 60 + Number(m[4]),
  };
}

export function expectedShiftEndMin(
  kind: TransportShiftKind,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): number {
  if (kind === 'regular') return 20 * 60;
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(tdate || '');
  if (!dm) return DAY_SHIFT_END_MONTHU_MIN;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  return dayShiftEndMin(pickYear(calByYear, y), y, mo, d) ?? DAY_SHIFT_END_MONTHU_MIN;
}

/** Старт смены по типу: обычная 08:00, дневная 08:30. */
export function expectedShiftStartMin(kind: TransportShiftKind): number {
  return kind === 'day' ? DAY_SHIFT_START_MIN : SHIFT_START_MIN;
}

/** Полная смена = старт по норме типа (08:00/08:30) и конец по норме на дату. */
export function isFullShiftRange(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  const kind = expectedShiftKind(work);
  if (!kind) return true;
  const bounds = parseTimeRangeBounds(timeRange);
  if (!bounds) return true;
  const expectedEnd = expectedShiftEndMin(kind, tdate, calByYear);
  return bounds.startMin === expectedShiftStartMin(kind) && bounds.endMin === expectedEnd;
}

/**
 * Авто-кандидат на жирное ВРЕМЯ при вставке: работа 1.2/2.n/3.n и смена
 * короче дневной нормы (старт 08:30 + конец из произв. календаря).
 */
export function isShiftUndershoot(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  if (!isAutoTimeBoldWork(work)) return false;
  return !isFullShiftRange(timeRange, work, tdate, calByYear);
}

/** Показ: серверный флаг time_bold (0/1), выставляется при вставке или кнопкой. */
export function isTimeBoldFlag(timeBold: number | string | boolean | null | undefined): boolean {
  if (timeBold === true) return true;
  const n = Number(timeBold);
  return Number.isFinite(n) && n === 1;
}

/** Сайт: всегда норма 08:00–20:00. */
export function isFullSiteShift(timeRange: string): boolean {
  const bounds = parseTimeRangeBounds(timeRange);
  if (!bounds) return true;
  return bounds.startMin === SHIFT_START_MIN && bounds.endMin === 20 * 60;
}

/** Печать: строка блока ДОК (работы 6.x). */
export function isDokRow(work: string): boolean {
  return workMajorPrefix(work) === 6;
}

/** Печать: строка блока ОКАЛИНА (работы 8.x). */
export function isOkalinaRow(work: string): boolean {
  return workMajorPrefix(work) === 8;
}

/**
 * Печать: 7.x — всегда; 6.x — по галочке ДОК; 8.x — по галочке ОКАЛИНА;
 * остальные — всегда.
 */
export function shouldPrintTransportRow(work: string, printDok: boolean, printOkalina: boolean): boolean {
  const major = workMajorPrefix(work);
  if (major === 7) return true;
  if (major === 6) return printDok;
  if (major === 8) return printOkalina;
  return true;
}