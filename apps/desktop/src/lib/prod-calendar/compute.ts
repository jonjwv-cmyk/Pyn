/**
 * Чистые функции над производственным календарём: рабочий/нерабочий день,
 * предпраздничный (−1ч), первый/последний рабочий день месяца, окно ДНЕВНОЙ смены.
 *
 * Все «минуты» — минуты от полуночи локального дня Екатеринбурга (смена считается
 * по местному времени комбината). Функции сами по себе tz-agnostic: принимают
 * (year, month 1..12, day) и возвращают числа; вызывающий передаёт екб-дату.
 */
import type { ProdCalendarByYear, ProdCalendarYear } from './types';
import { PROD_CALENDAR_FALLBACK_YEAR, PROD_CALENDAR_SEED } from './data';

// ── Константы смен ───────────────────────────────────────────────────────────
/** Начало любой смены — 08:00. */
export const SHIFT_START_MIN = 8 * 60; // 480
/** Конец дневной смены ПН-ЧТ — 17:00. */
export const DAY_SHIFT_END_MONTHU_MIN = 17 * 60; // 1020
/** Конец дневной смены ПТ — 15:45. */
export const DAY_SHIFT_END_FRI_MIN = 15 * 60 + 45; // 945
/** Сколько минут отнять в предпраздничный день. */
export const SHORT_DAY_CUT_MIN = 60;

/** Обед ДНЕВНОЙ смены: 12:00–12:45. */
export const DAY_LUNCH_START_MIN = 12 * 60; // 720
export const DAY_LUNCH_END_MIN = 12 * 60 + 45; // 765
/** Обед ОБЫЧНОЙ смены 08:00–20:00 (сайт/технология): 12:00–12:30. */
export const SHIFT_LUNCH_START_MIN = 12 * 60; // 720
export const SHIFT_LUNCH_END_MIN = 12 * 60 + 30; // 750

// ── Утилиты дат ──────────────────────────────────────────────────────────────
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
/** `MM-DD` для (month 1..12, day). */
export function toMmDd(month: number, day: number): string {
  return `${pad2(month)}-${pad2(day)}`;
}
/** JS getDay() (0=Вс..6=Сб) для (year, month 1..12, day). */
export function weekdayJs(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}
/** Сб/Вс. */
export function isWeekend(year: number, month: number, day: number): boolean {
  const dow = weekdayJs(year, month, day);
  return dow === 0 || dow === 6;
}
/** Число дней в месяце (month 1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ── Выбор календаря года ─────────────────────────────────────────────────────
/**
 * Календарь на год из карты (сервер-данные ∪ seed). Если года нет — берём seed
 * фолбэк-года, но с подменённым `year` (чтобы выходные считались верно для
 * запрошенного года; праздники фолбэка — лучше, чем пусто).
 */
export function pickYear(
  byYear: ProdCalendarByYear | null | undefined,
  year: number,
): ProdCalendarYear {
  const src = byYear ?? PROD_CALENDAR_SEED;
  if (src[year]) return src[year];
  const seed = PROD_CALENDAR_SEED[year];
  if (seed) return seed;
  const fb = src[PROD_CALENDAR_FALLBACK_YEAR] ?? PROD_CALENDAR_SEED[PROD_CALENDAR_FALLBACK_YEAR];
  return fb ? { ...fb, year } : { year, holidays: [], shortDays: [], workingWeekends: [] };
}

// ── Классификация дня ────────────────────────────────────────────────────────
/** Предпраздничный (−1ч). */
export function isShortDay(cal: ProdCalendarYear, month: number, day: number): boolean {
  return cal.shortDays.includes(toMmDd(month, day));
}
/** Нерабочий день = (выходной И не рабочая суббота) ИЛИ праздник. */
export function isNonWorkingDay(
  cal: ProdCalendarYear,
  year: number,
  month: number,
  day: number,
): boolean {
  const md = toMmDd(month, day);
  if (cal.holidays.includes(md)) return true;
  if (isWeekend(year, month, day)) return !cal.workingWeekends.includes(md);
  return false;
}
/** Рабочий день (в т.ч. предпраздничный — он рабочий). */
export function isWorkingDay(
  cal: ProdCalendarYear,
  year: number,
  month: number,
  day: number,
): boolean {
  return !isNonWorkingDay(cal, year, month, day);
}

/** Первый рабочий день месяца (число 1..31) или null. */
export function firstWorkingDay(cal: ProdCalendarYear, year: number, month: number): number | null {
  const last = daysInMonth(year, month);
  for (let d = 1; d <= last; d++) {
    if (isWorkingDay(cal, year, month, d)) return d;
  }
  return null;
}
/** Последний рабочий день месяца (число 1..31) или null. */
export function lastWorkingDay(cal: ProdCalendarYear, year: number, month: number): number | null {
  const last = daysInMonth(year, month);
  for (let d = last; d >= 1; d--) {
    if (isWorkingDay(cal, year, month, d)) return d;
  }
  return null;
}

/**
 * Авто «не возим» для раздела ГРАФИК: все нерабочие дни месяца (выходные +
 * праздники) ∪ первый рабочий день ∪ последний рабочий день месяца. Эти дни
 * зафиксированы автоматически — снять руками нельзя. Возвращает отсортированный
 * уникальный список чисел месяца.
 */
export function autoNonDeliveryDays(
  cal: ProdCalendarYear,
  year: number,
  month: number,
): number[] {
  const set = new Set<number>();
  const last = daysInMonth(year, month);
  for (let d = 1; d <= last; d++) {
    if (isNonWorkingDay(cal, year, month, d)) set.add(d);
  }
  const fw = firstWorkingDay(cal, year, month);
  const lw = lastWorkingDay(cal, year, month);
  if (fw != null) set.add(fw);
  if (lw != null) set.add(lw);
  return [...set].sort((a, b) => a - b);
}

/** Числа месяца, помеченные как предпраздничные (для звёздочки в графике). */
export function shortDaysOfMonth(
  cal: ProdCalendarYear,
  year: number,
  month: number,
): number[] {
  const out: number[] = [];
  const last = daysInMonth(year, month);
  for (let d = 1; d <= last; d++) {
    if (isShortDay(cal, month, d)) out.push(d);
  }
  return out;
}

// ── Окно дневной смены ───────────────────────────────────────────────────────
/**
 * Конец дневной смены (минуты) для конкретной даты, с учётом сокращения:
 *  - ПН-ЧТ: 17:00, ПТ: 15:45
 *  - предпраздничный → минус 60 мин (16:00 / 14:45)
 *  - нерабочий день → null (смены нет)
 */
export function dayShiftEndMin(
  cal: ProdCalendarYear,
  year: number,
  month: number,
  day: number,
): number | null {
  if (isNonWorkingDay(cal, year, month, day)) return null;
  const dow = weekdayJs(year, month, day);
  let end = dow === 5 ? DAY_SHIFT_END_FRI_MIN : DAY_SHIFT_END_MONTHU_MIN;
  if (isShortDay(cal, month, day)) end -= SHORT_DAY_CUT_MIN;
  return end;
}

/** Окно дневной смены `{ startMin, endMin }` для даты, либо null (нерабочий). */
export function dayShiftWindow(
  cal: ProdCalendarYear,
  year: number,
  month: number,
  day: number,
): { startMin: number; endMin: number } | null {
  const endMin = dayShiftEndMin(cal, year, month, day);
  if (endMin == null) return null;
  return { startMin: SHIFT_START_MIN, endMin };
}

// ── Форматирование ───────────────────────────────────────────────────────────
/** Минуты → `HH:MM`. */
export function fmtHm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}
