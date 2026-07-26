/**
 * Расписание питомца по Екатеринбургу + дневная смена (prod calendar).
 *
 * Дневная смена: 08:30 → конец по календарю
 *   ПН–ЧТ 16:30, ПТ 15:00, предпраздничный −1ч (15:30 / 14:00).
 * Обед дневной: 12:00–12:45; remind за 1ч.
 * Конец смены: badge за 1ч до endMin.
 */
import {
  DAY_LUNCH_END_MIN,
  DAY_LUNCH_START_MIN,
  DAY_SHIFT_START_MIN,
  dayShiftEndMin,
  dayShiftWindow,
  fmtHm,
  isNonWorkingDay,
  pickYear,
} from '@/lib/prod-calendar';
import { useProdCalendarStore } from '@/lib/prod-calendar/store';

export type SchedulePhase = 'none' | 'lunch_soon' | 'lunch' | 'shift_end_soon';

export interface PetScheduleSnapshot {
  phase: SchedulePhase;
  /** Плашка над питомцем. */
  badge: string | null;
  /** Выходной / праздник (и не «рабочая суббота»). */
  isNonWorking: boolean;
  /** Вне окна дневной смены (в т.ч. весь нерабочий день). */
  isOffHours: boolean;
  /** Конец смены HH:MM или null. */
  endLabel: string | null;
  year: number;
  month: number;
  day: number;
  minOfDay: number;
}

export function yekMinutesNow(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yekaterinburg',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** YYYY-MM-DD в Yek. */
export function yekDayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

export function yekDateParts(now = Date.now()): { year: number; month: number; day: number } {
  const key = yekDayKey(now);
  const [ys, ms, ds] = key.split('-');
  return { year: Number(ys), month: Number(ms), day: Number(ds) };
}

function currentCal(year: number) {
  return pickYear(useProdCalendarStore.getState().byYear, year);
}

/** Полный снимок для badge + overtime. */
export function petScheduleAt(now = Date.now()): PetScheduleSnapshot {
  const { year, month, day } = yekDateParts(now);
  const cal = currentCal(year);
  const minOfDay = yekMinutesNow(now);
  const nonWorking = isNonWorkingDay(cal, year, month, day);
  const win = dayShiftWindow(cal, year, month, day);
  const endMin = dayShiftEndMin(cal, year, month, day);
  const endLabel = endMin != null ? fmtHm(endMin) : null;

  if (!nonWorking) {
    // Обед дневной смены
    if (minOfDay >= DAY_LUNCH_START_MIN && minOfDay < DAY_LUNCH_END_MIN) {
      return {
        phase: 'lunch',
        badge: 'Обед · кушаю 🥢',
        isNonWorking: false,
        isOffHours: false,
        endLabel,
        year,
        month,
        day,
        minOfDay,
      };
    }
    if (minOfDay >= DAY_LUNCH_START_MIN - 60 && minOfDay < DAY_LUNCH_START_MIN) {
      const m = DAY_LUNCH_START_MIN - minOfDay;
      return {
        phase: 'lunch_soon',
        badge: m >= 55 ? 'Скоро обед · через 1 ч' : `Скоро обед · через ${m} мин`,
        isNonWorking: false,
        isOffHours: false,
        endLabel,
        year,
        month,
        day,
        minOfDay,
      };
    }

    // За 1 час до конца дневной смены (календарь / предпраздничный / пт)
    if (win && minOfDay >= win.endMin - 60 && minOfDay < win.endMin) {
      const m = win.endMin - minOfDay;
      return {
        phase: 'shift_end_soon',
        badge:
          m >= 55
            ? `Скоро конец смены · ${endLabel ?? ''}`
            : `Скоро конец смены · через ${m} мин`,
        isNonWorking: false,
        isOffHours: false,
        endLabel,
        year,
        month,
        day,
        minOfDay,
      };
    }

    const offHours =
      !win || minOfDay < DAY_SHIFT_START_MIN || (endMin != null && minOfDay >= endMin);

    return {
      phase: 'none',
      badge: null,
      isNonWorking: false,
      isOffHours: offHours,
      endLabel,
      year,
      month,
      day,
      minOfDay,
    };
  }

  // Выходной / праздник
  return {
    phase: 'none',
    badge: null,
    isNonWorking: true,
    isOffHours: true,
    endLabel: null,
    year,
    month,
    day,
    minOfDay,
  };
}


