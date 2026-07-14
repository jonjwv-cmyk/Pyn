/**
 * Публичный API производственного календаря. Импортируй отсюда:
 *   import { useProdCalendarYear, dayShiftWindow } from '@/lib/prod-calendar';
 */
import { useProdCalendarStore } from './store';
import { pickYear } from './compute';
import type { ProdCalendarYear } from './types';

export * from './types';
export * from './compute';
export { PROD_CALENDAR_SEED, PROD_CALENDAR_2026 } from './data';
export { useProdCalendarStore } from './store';

/** Реактивный календарь запрошенного года (seed до server-sync, потом серверный). */
export function useProdCalendarYear(year: number): ProdCalendarYear {
  const byYear = useProdCalendarStore((s) => s.byYear);
  return pickYear(byYear, year);
}
