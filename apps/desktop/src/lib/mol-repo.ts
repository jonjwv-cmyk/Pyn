import {
  baseDownloadUrl,
  baseVersion,
  parseSnapshotJson,
  type BaseMeta,
  type MolRecord,
} from '@pyn/core';
import { api } from './api';
import { useMolStore } from './stores';

const CACHE_NAME = 'mol-base';

interface CachePayload {
  meta: BaseMeta;
  records: MolRecord[];
}

/**
 * Загрузка кеша справочника МОЛ с диска (encrypted через safeStorage).
 * Возвращает true если кеш найден и распарсен.
 *
 * На холодном старте Pyn'a вызывается до открытия раздела «МОЛы» —
 * чтобы юзер сразу увидел старую базу пока в фоне идёт refresh от сервера.
 */
export async function loadMolFromCache(): Promise<boolean> {
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed.meta || !Array.isArray(parsed.records)) return false;
    useMolStore.getState().setLoaded({
      records: parsed.records,
      meta: parsed.meta,
      // Это load из кеша, server fetch ещё не было — `lastSyncedAt` не обновляем.
      syncedNow: false,
    });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:mol] cache load failed:', err);
    return false;
  }
}

/**
 * Через сколько ms сбрасываем `lastRefreshOutcome` после успеха («База
 * актуальна» / «База обновлена» в попапе показывается этот промежуток).
 */
const REFRESH_TOAST_MS = 3_500;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Проверяет server-side версию и при расхождении — скачивает новый snapshot.
 * Возвращает true если база действительно обновилась (новые записи в store).
 *
 *   • `force=true` — UI ВСЕГДА видит status='loading' пока идёт проверка,
 *     даже если данные в store уже есть; полоска прогресса в попапе не
 *     пропадает раньше времени.
 *   • Background refresh (force=false с уже загруженными данными) — silent:
 *     status не дёргаем, чтобы не мигать UI.
 *
 * `lastRefreshOutcome` ставится в `'up-to-date' | 'updated' | 'error'` —
 * для feedback'а в попап-меню. Через REFRESH_TOAST_MS автоматом сбросится.
 */
export async function refreshMolFromServer(opts: { force?: boolean } = {}): Promise<boolean> {
  const { force = false } = opts;
  const store = useMolStore.getState();
  const wasLoaded = store.status === 'loaded' && store.records.length > 0;
  // force=true (юзерский клик) — ВСЕГДА показываем loading.
  if (force || !wasLoaded) store.setStatus('loading');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  // Сбрасываем прошлый outcome чтобы UI не показывал «База актуальна» от
  // предыдущего refresh пока идёт новый.
  store.setRefreshOutcome(null);

  const scheduleToastReset = () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      useMolStore.getState().setRefreshOutcome(null);
      toastTimer = null;
    }, REFRESH_TOAST_MS);
  };

  try {
    // serverMeta включает recordsCount + previous (с тем же recordsCount)
    // — authoritative для UI-индикатора «ранее N (+10)». Клиент тонкий:
    // никакой собственной истории количеств не ведёт.
    const serverMeta = await baseVersion(api);
    const localMeta = store.meta;
    if (localMeta && localMeta.version === serverMeta.version) {
      // Версии совпадают — снапшот не качаем. НО обновляем meta — server
      // мог обновить `previous` (например после set_app_version без import).
      useMolStore.setState({
        meta: serverMeta,
        lastSyncedAt: Date.now(),
        status: 'loaded',
        errorMessage: null,
        lastRefreshOutcome: 'up-to-date',
      });
      // Persist обновлённый meta в кеш (records те же).
      await window.pyn.cache.save(
        CACHE_NAME,
        JSON.stringify({ meta: serverMeta, records: store.records }),
      );
      scheduleToastReset();
      return false;
    }

    // Версия отличается — качаем snapshot.
    const info = await baseDownloadUrl(api);
    if (!info.url || !info.blobKeyB64 || !info.blobNonceB64) {
      throw new Error('base_download_url returned empty fields');
    }
    const plainJson = await window.pyn.mol.fetchSnapshot(
      info.url,
      info.blobKeyB64,
      info.blobNonceB64,
    );
    const { records } = parseSnapshotJson(plainJson);

    // Используем server-supplied meta (с recordsCount + previous) как единый
    // источник правды — никаких client-side подсчётов «было/стало».
    useMolStore.getState().setLoaded({
      records,
      meta: serverMeta,
      syncedNow: true,
    });
    useMolStore.getState().setRefreshOutcome('updated');
    scheduleToastReset();
    await window.pyn.cache.save(
      CACHE_NAME,
      JSON.stringify({ meta: serverMeta, records }),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось обновить базу';
    const finalStatus = wasLoaded ? 'loaded' : 'error';
    useMolStore.setState({
      status: finalStatus,
      errorMessage: message,
      lastRefreshOutcome: 'error',
    });
    scheduleToastReset();
    // eslint-disable-next-line no-console
    console.error('[pyn:mol] refresh failed:', err);
    return false;
  }
}

/**
 * Composite: показать кеш сразу + запустить refresh в фоне. Удобно вызвать
 * один раз при mount-е MolScreen.
 */
export async function initMol(): Promise<void> {
  await loadMolFromCache();
  await refreshMolFromServer();
}
