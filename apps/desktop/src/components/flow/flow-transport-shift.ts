import {
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
 * Ожидаемый тип смены по префиксу работы (ТЗ п.12):
 * 1.1 → обычная 08:00–20:00; 1.2 → дневная; 2.n → дневная; 7.n → обычная.
 * Прочие префиксы — правила нет (не подсвечиваем).
 */
export function expectedShiftKind(work: string): TransportShiftKind | null {
  const pm = parseWorkMajorMinor(work);
  if (!pm) return null;
  if (pm.major === 1 && pm.minor === 1) return 'regular';
  if (pm.major === 1 && pm.minor === 2) return 'day';
  if (pm.major === 2) return 'day';
  if (pm.major === 7) return 'regular';
  return null;
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
  if (!dm) return 17 * 60;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  return dayShiftEndMin(pickYear(calByYear, y), y, mo, d) ?? 17 * 60;
}

/** Полная смена = старт 08:00 и конец по норме типа смены на дату. */
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
  return bounds.startMin === SHIFT_START_MIN && bounds.endMin === expectedEnd;
}

/** Нужно жирнить ВРЕМЯ — дали меньше, чем полная смена по правилу префикса. */
export function isShiftUndershoot(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  return !isFullShiftRange(timeRange, work, tdate, calByYear);
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