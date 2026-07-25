import {
  DAY_SHIFT_END_MONTHU_MIN,
  SHIFT_START_MIN,
  dayShiftEndMin,
  pickYear,
} from '@/lib/prod-calendar';
import type { ProdCalendarByYear } from '@/lib/prod-calendar/types';

/** Тип смены по префиксу работы (колонка РАБОТА). */
export type TransportShiftKind = 'day' | 'regular';

/** Полная дневная (1С/транспорт): 08:00–17:00; пятница 08:00–15:45. */
export const DAY_TRANSPORT_END_MIN = 17 * 60; // 1020
export const DAY_TRANSPORT_END_FRI_MIN = 15 * 60 + 45; // 945

/** Обычная полная: 08:00–20:00. */
export const REGULAR_END_MIN = 20 * 60; // 1200

/**
 * Вторая половина обычной смены (после обеда): 13:45–20:00.
 * Для 1.2 / 2.n / 3.n это норма (не жирная).
 */
export const REGULAR_AFTERNOON_START_MIN = 13 * 60 + 45; // 825

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
 * Ожидаемый тип смены (для оптимизации/календаря):
 * 1.1 / 7.n → обычная; 1.2 / 2.n / 3.n → «дневная» по умолчанию
 * (но в транспорте 1.2/2/3 допускают и обычную — см. isFullShiftRange).
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
 * Авто-жирный по отклонению от нормы:
 *  - 7.n (огнеупоры) / 1.1 — только обычная 08:00–20:00;
 *  - 1.2 / 2.n / 3.n — дневная ИЛИ обычная (см. isNormTimeRange).
 */
export function isAutoTimeBoldWork(work: string): boolean {
  const pm = parseWorkMajorMinor(work);
  if (!pm) return false;
  if (pm.major === 1 && (pm.minor === 1 || pm.minor === 2)) return true;
  if (pm.major === 2 || pm.major === 3 || pm.major === 7) return true;
  return false;
}

/** 7.n / 1.1 — только обычная 08–20. */
export function isStrictRegularWork(work: string): boolean {
  const pm = parseWorkMajorMinor(work);
  if (!pm) return false;
  if (pm.major === 7) return true;
  if (pm.major === 1 && pm.minor === 1) return true;
  return false;
}

/** 1.2 / 2.n / 3.n — дневная или обычная. */
export function isFlexibleDayOrRegularWork(work: string): boolean {
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

/** Конец дневной по произв. календарю (16:30 / 15:00 / −1ч). */
export function expectedShiftEndMin(
  kind: TransportShiftKind,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): number {
  if (kind === 'regular') return REGULAR_END_MIN;
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(tdate || '');
  if (!dm) return DAY_SHIFT_END_MONTHU_MIN;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  return dayShiftEndMin(pickYear(calByYear, y), y, mo, d) ?? DAY_SHIFT_END_MONTHU_MIN;
}

/** Старт: 08:00 (дневная/обычная); 08:30 допускается в isNormTimeRange. */
export function expectedShiftStartMin(_kind: TransportShiftKind): number {
  return SHIFT_START_MIN;
}

/** Обычная полная: 08:00–20:00. */
function isNormRegularFull(bounds: { startMin: number; endMin: number }): boolean {
  return bounds.startMin === SHIFT_START_MIN && bounds.endMin === REGULAR_END_MIN;
}

/** Обычная «вторая половина»: 13:45–20:00. */
function isNormRegularAfternoon(bounds: { startMin: number; endMin: number }): boolean {
  return bounds.startMin === REGULAR_AFTERNOON_START_MIN && bounds.endMin === REGULAR_END_MIN;
}

/**
 * Дневная полная смена МАШИНЫ (колонка ВРЕМЯ в Транспорте):
 *  - 08:00–17:00;
 *  - 08:00–15:45 (пятница).
 *
 * НЕ путать с 08:30 / −30 мин в конце — это наш учёт заказов/доставки
 * (подготовка и завершение смены), не норма работы машины.
 */
function isNormDayFull(bounds: { startMin: number; endMin: number }): boolean {
  if (bounds.startMin !== SHIFT_START_MIN) return false; // только 08:00, не 08:30
  if (bounds.endMin === DAY_TRANSPORT_END_MIN) return true; // 17:00
  if (bounds.endMin === DAY_TRANSPORT_END_FRI_MIN) return true; // 15:45
  return false;
}

/**
 * Нормальное (не жирное) время смены МАШИНЫ:
 *
 * 7.n / 1.1 — только обычная 08:00–20:00.
 *
 * 1.2 / 2.n / 3.n — дневная ИЛИ обычная:
 *   • дневная: 08:00–17:00 (пт 08:00–15:45);
 *   • обычная: 08:00–20:00;
 *   • обычная 2-я половина: 13:45–20:00.
 * 08:30 / 16:30 / «−30 мин» — не норма машины (учёт заказов).
 * Всё остальное — не норма → жирный.
 */
export function isNormTimeRange(
  timeRange: string,
  work: string,
  _tdate: string,
  _calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  const bounds = parseTimeRangeBounds(timeRange);
  if (!bounds) return true; // нет интервала — не красим

  if (isStrictRegularWork(work)) {
    return isNormRegularFull(bounds);
  }

  if (isFlexibleDayOrRegularWork(work)) {
    if (isNormDayFull(bounds)) return true;
    if (isNormRegularFull(bounds)) return true;
    if (isNormRegularAfternoon(bounds)) return true;
    return false;
  }

  // Работы без правила — «норма» (жирный только кнопкой).
  return true;
}

/** Полная смена (алиас для старых вызовов / оптимизации). */
export function isFullShiftRange(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  // Для оптимизации 1.2/2/3 «day»-старт 08:30; для UI-нормы используем isNormTimeRange.
  return isNormTimeRange(timeRange, work, tdate, calByYear);
}

/**
 * Отклонение от нормы → авто-жирный.
 */
export function isShiftUndershoot(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
): boolean {
  if (!isAutoTimeBoldWork(work)) return false;
  if (!parseTimeRangeBounds(timeRange)) return false;
  return !isNormTimeRange(timeRange, work, tdate, calByYear);
}

/** Показ: серверный флаг time_bold (0/1), выставляется при вставке или кнопкой. */
export function isTimeBoldFlag(timeBold: number | string | boolean | null | undefined): boolean {
  if (timeBold === true) return true;
  const n = Number(timeBold);
  return Number.isFinite(n) && n === 1;
}

/**
 * Показ жирного ВРЕМЯ:
 *  - 1.1 / 1.2 / 2.n / 3.n / 7.n — live по норме (устаревший time_bold не красит норму);
 *  - прочие — только ручной флаг «Жирный».
 */
export function shouldShowTimeBold(
  timeRange: string,
  work: string,
  tdate: string,
  calByYear: ProdCalendarByYear | null | undefined,
  timeBold: number | string | boolean | null | undefined,
): boolean {
  if (isAutoTimeBoldWork(work)) {
    return isShiftUndershoot(timeRange, work, tdate, calByYear);
  }
  return isTimeBoldFlag(timeBold);
}

/** Сайт: всегда норма 08:00–20:00. */
export function isFullSiteShift(timeRange: string): boolean {
  const bounds = parseTimeRangeBounds(timeRange);
  if (!bounds) return true;
  return bounds.startMin === SHIFT_START_MIN && bounds.endMin === REGULAR_END_MIN;
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
