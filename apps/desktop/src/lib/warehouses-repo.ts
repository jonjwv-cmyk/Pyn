/**
 * warehouses-repo — server-sync справочника складов («Цеха»-база), один-в-один
 * с `mol-repo.ts`:
 *   • кэш-старт из зашифрованного safeStorage-кэша (window.pyn.cache);
 *   • фон-обновление: version check → при расхождении R2-снэпшот (decrypt+gunzip);
 *   • правка карточки → на сервер (warehouse_update) + optimistic local + кэш;
 *   • live-обновление по WS 'warehouses_changed' (вызывает refresh из App.tsx).
 */

import {
  warehousesVersion,
  warehousesDownloadUrl,
  warehousesDownload,
  warehouseUpdate,
  parseWarehousesSnapshotJson,
  type Warehouse,
  type WarehousePatch,
  type WarehousesMeta,
} from '@pyn/core';
import { api } from './api';
import { useWarehousesStore } from './warehouses-store';

const CACHE_NAME = 'warehouses-base';

interface CachePayload {
  meta: WarehousesMeta | null;
  warehouses: Warehouse[];
}

async function saveCache(): Promise<void> {
  const s = useWarehousesStore.getState();
  try {
    await window.pyn?.cache?.save(
      CACHE_NAME,
      JSON.stringify({ meta: s.meta, warehouses: s.warehouses } satisfies CachePayload),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:wh] cache save failed:', err);
  }
}

/** Загрузка кэша с диска (encrypted через safeStorage). true если найден. */
export async function loadWarehousesFromCache(): Promise<boolean> {
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!Array.isArray(parsed.warehouses) || parsed.warehouses.length === 0) return false;
    useWarehousesStore.getState().setLoaded({
      warehouses: parsed.warehouses,
      meta: parsed.meta ?? null,
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:wh] cache load failed:', err);
    return false;
  }
}

/**
 * Через сколько ms сбрасываем `lastRefreshOutcome` после refresh — столько
 * времени в попап-меню висит «База актуальна» / «обновлена» / «ошибка».
 */
const REFRESH_TOAST_MS = 3_500;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Проверяет серверную версию и при расхождении качает новый R2-снэпшот.
 * Возвращает true если база реально обновилась. `lastRefreshOutcome`
 * ставится в up-to-date | updated | error (toast в попапе) и автоматом
 * сбрасывается через REFRESH_TOAST_MS — 1:1 с mol-repo.
 */
export async function refreshWarehousesFromServer(opts: { force?: boolean } = {}): Promise<boolean> {
  const store = useWarehousesStore.getState();
  const wasLoaded = store.status === 'loaded';
  if (opts.force || !wasLoaded) store.setStatus('loading');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  // Сбрасываем прошлый outcome, чтобы не мигал старый результат пока идёт новый.
  store.setRefreshOutcome(null);

  const scheduleToastReset = () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      useWarehousesStore.getState().setRefreshOutcome(null);
      toastTimer = null;
    }, REFRESH_TOAST_MS);
  };

  try {
    const serverMeta = await warehousesVersion(api);
    const localMeta = store.meta;
    if (localMeta && localMeta.version === serverMeta.version) {
      // Версии совпали — снэпшот не качаем, обновляем meta (previous/counts).
      useWarehousesStore.setState({
        meta: serverMeta,
        status: 'loaded',
        lastRefreshOutcome: 'up-to-date',
      });
      await saveCache();
      scheduleToastReset();
      return false;
    }

    // Эффективный путь — зашифрованный gzip-слепок из R2 через preload. Если слепок недоступен
    // (cdn раздаёт VPS; в DEV cloud-режиме воркер base-снимки не отдаёт) — fallback на прямой JSON
    // (warehousesDownload через E2E-API → идёт через воркер, работает и в cloud). 1:1 как у persons.
    let warehouses: Warehouse[] | null = null;
    const hasBridge = typeof window.pyn?.warehouses?.fetchSnapshot === 'function';
    if (hasBridge) {
      try {
        const info = await warehousesDownloadUrl(api);
        if (info.url && info.blobKeyB64 && info.blobNonceB64) {
          const plainJson = await window.pyn.warehouses.fetchSnapshot(
            info.url,
            info.blobKeyB64,
            info.blobNonceB64,
          );
          warehouses = parseWarehousesSnapshotJson(plainJson).warehouses;
        }
      } catch (blobErr) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:wh] blob path failed, falling back to direct JSON:', blobErr);
      }
    }
    if (!warehouses) {
      warehouses = (await warehousesDownload(api)).warehouses;
    }
    useWarehousesStore.getState().setLoaded({ warehouses, meta: serverMeta });
    useWarehousesStore.getState().setRefreshOutcome('updated');
    await saveCache();
    scheduleToastReset();
    return true;
  } catch (err) {
    useWarehousesStore.setState({
      status: wasLoaded ? 'loaded' : 'error',
      lastRefreshOutcome: 'error',
    });
    scheduleToastReset();
    // eslint-disable-next-line no-console
    console.error('[pyn:wh] refresh failed:', err);
    return false;
  }
}

/** Кэш сразу + refresh в фоне. Вызывается из App.tsx после login. */
export async function initWarehouses(): Promise<void> {
  await loadWarehousesFromCache();
  await refreshWarehousesFromServer();
}

/**
 * Правка карточки склада: optimistic local-патч + отправка на сервер. Сервер
 * поднимает версию/дату (warehouse_update) + рассылает WS другим клиентам.
 * При ошибке откатываемся через refresh с сервера и пробрасываем исключение.
 */
export async function saveWarehouse(id: string, patch: WarehousePatch): Promise<void> {
  const store = useWarehousesStore.getState();
  store.patchLocal(id, patch as Partial<Warehouse>);
  try {
    const res = await warehouseUpdate(api, { id, patch });
    const meta = useWarehousesStore.getState().meta;
    if (meta) {
      useWarehousesStore.setState({
        meta: {
          ...meta,
          version: res.version || meta.version,
          updatedAt: res.updatedAt || meta.updatedAt,
        },
      });
    }
    await saveCache();
  } catch (err) {
    await refreshWarehousesFromServer({ force: true });
    throw err;
  }
}
