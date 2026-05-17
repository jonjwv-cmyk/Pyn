import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import type { BaseMeta, MolRecord } from '../endpoints/base';

/**
 * Кеш справочника МОЛ в renderer'е. Источник правды — encrypted blob на
 * диске (`pyn:cache` с именем `mol-base`); store держит в памяти распарсенные
 * records для O(1) поиска и реактивного UI.
 *
 * Без `persist` middleware: persistence отдельная (через safeStorage в main),
 * store просто кеширует распакованную копию.
 */

export type MolLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Результат последнего refresh — для UI toast'а в попап-меню юзера:
 *   • `up-to-date` — серверная версия совпала с локальной, ничего не качали
 *   • `updated`    — скачали и распаковали новый snapshot
 *   • `error`      — что-то пошло не так (см. `errorMessage`)
 *   • `null`       — refresh ещё не было, либо последний result сбросили
 */
export type MolRefreshOutcome = 'up-to-date' | 'updated' | 'error' | null;

export interface MolState {
  records: MolRecord[];
  meta: BaseMeta | null;
  /** `Date.now()` когда выполнился последний успешный fetch версии с сервера. */
  lastSyncedAt: number | null;
  status: MolLoadStatus;
  /** Текстовое сообщение о последней ошибке (для UI toast'а). */
  errorMessage: string | null;
  /** Что произошло на последнем refresh — для feedback'а юзеру в попапе. */
  lastRefreshOutcome: MolRefreshOutcome;
  setLoaded: (args: {
    records: MolRecord[];
    meta: BaseMeta;
    syncedNow?: boolean;
  }) => void;
  setStatus: (status: MolLoadStatus, errorMessage?: string | null) => void;
  setRefreshOutcome: (outcome: MolRefreshOutcome) => void;
  clear: () => void;
}

const initializer: StateCreator<MolState> = (set) => ({
  records: [],
  meta: null,
  lastSyncedAt: null,
  status: 'idle',
  errorMessage: null,
  lastRefreshOutcome: null,
  setLoaded: ({ records, meta, syncedNow = false }) =>
    set((prev) => ({
      records,
      meta,
      status: 'loaded',
      errorMessage: null,
      lastSyncedAt: syncedNow ? Date.now() : prev.lastSyncedAt,
    })),
  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
  setRefreshOutcome: (outcome) => set({ lastRefreshOutcome: outcome }),
  clear: () =>
    set({
      records: [],
      meta: null,
      lastSyncedAt: null,
      status: 'idle',
      errorMessage: null,
      lastRefreshOutcome: null,
    }),
});

export function createMolStore(): UseBoundStore<StoreApi<MolState>> {
  return create<MolState>()(initializer);
}
