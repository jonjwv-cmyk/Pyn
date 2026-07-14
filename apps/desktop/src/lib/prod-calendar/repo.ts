/**
 * Загрузка производственного календаря с сервера (D1 `prod_calendar`) в store.
 * Вызывается на старте после логина. При ошибке (нет сети / сервер не задеплоен)
 * store остаётся на seed — раздел «График» и окно ОКНО работают офлайн.
 */
import { prodCalendarGet } from '@pyn/core';
import { api } from '@/lib/api';
import { useProdCalendarStore } from './store';

export async function refreshProdCalendarFromServer(): Promise<void> {
  try {
    const years = await prodCalendarGet(api);
    if (years && Object.keys(years).length > 0) {
      useProdCalendarStore.getState().setFromServer(years);
    }
  } catch {
    /* офлайн / старый сервер — остаёмся на seed */
  }
}
