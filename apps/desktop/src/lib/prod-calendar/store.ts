/**
 * Store производственного календаря. Инициализируется seed'ом (bootstrap), при
 * получении данных с сервера (`prod_calendar_get` / WS `prod_calendar_changed`)
 * серверные годы накрывают seed. Данные не секретные — без шифрования/persist,
 * на холодном старте всегда есть seed.
 */
import { createZustandStore as create } from '@pyn/core';
import type { ProdCalendarByYear } from './types';
import { PROD_CALENDAR_SEED } from './data';

interface ProdCalendarState {
  /** seed ∪ серверные годы (серверные накрывают seed по ключу-году). */
  byYear: ProdCalendarByYear;
  /** true после первого успешного ответа сервера. */
  serverLoaded: boolean;
  /** Заменить/дополнить годы данными сервера. */
  setFromServer(years: ProdCalendarByYear): void;
}

export const useProdCalendarStore = create<ProdCalendarState>((set) => ({
  byYear: { ...PROD_CALENDAR_SEED },
  serverLoaded: false,
  setFromServer: (years) =>
    set((s) => ({
      byYear: { ...PROD_CALENDAR_SEED, ...s.byYear, ...years },
      serverLoaded: true,
    })),
}));
