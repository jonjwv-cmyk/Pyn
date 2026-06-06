/**
 * vgh-repo — загрузка/синк базы ВГХ (flow_vgh) с сервера в `useVghStore`.
 *
 * База небольшая → читаем напрямую (`flow_vgh_get`). Загружаем лениво при первом
 * монтировании потребителя (формирование KG/V, экран ВГХ), кэшируем в сторе на
 * сессию (повторный вход — мгновенно), обновляем по WS `vgh_changed`.
 */

import { flowVghGet, type VghRow } from '@pyn/core';
import { api } from './api';
import { useVghStore } from './vgh-store';

let loadOnce: Promise<void> | null = null;

/** Загрузить базу ВГХ один раз за сессию (повторные вызовы — тот же промис). */
export function ensureVghLoaded(): Promise<void> {
  if (loadOnce) return loadOnce;
  loadOnce = doLoad();
  return loadOnce;
}

/** Принудительно перечитать базу ВГХ (manual refresh). */
export function refreshVgh(): Promise<void> {
  loadOnce = doLoad();
  return loadOnce;
}

async function doLoad(): Promise<void> {
  const store = useVghStore.getState();
  if (store.status !== 'loaded') store.setStatus('loading');
  try {
    const rows = await flowVghGet(api);
    useVghStore.getState().setLoaded(rows);
  } catch (err) {
    useVghStore.getState().setStatus('error');
    // eslint-disable-next-line no-console
    console.warn('[pyn:vgh] load failed:', err);
  }
}

/** Слить изменённые строки базы (WS `vgh_changed` / ответ правки карточки). */
export function applyVghChanged(rows: VghRow[]): void {
  useVghStore.getState().applyChanged(rows);
}
