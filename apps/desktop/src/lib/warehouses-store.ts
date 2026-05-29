/**
 * Warehouses store — справочник складов («Цеха»-база) на клиенте.
 *
 * §warehouses-server-sync — теперь server-backed (как МОЛ): данные качаются
 * с сервера (`warehouses-repo.ts`), кэшируются зашифрованно (safeStorage),
 * правки карточки уходят на сервер. Вшитого seed'а больше нет — на холодном
 * старте до первого server-sync список пуст (как у МОЛ-базы); дальше работает
 * зашифрованный кэш.
 */

import {
  createZustandStore as create,
  type Warehouse,
  type WarehousesMeta,
} from '@pyn/core';

export type WarehouseSyncStatus = 'idle' | 'loading' | 'loaded' | 'error';
/** Итог последнего refresh — для toast'а в попап-меню (как у МОЛ-базы). */
export type WarehouseRefreshOutcome = 'up-to-date' | 'updated' | 'error' | null;

interface WarehousesState {
  warehouses: Warehouse[];
  byId: Map<string, Warehouse>;
  /** Версия/дата серверной базы (для меню «База данных Цеха»). null до sync. */
  meta: WarehousesMeta | null;
  status: WarehouseSyncStatus;
  /** Что произошло на последнем refresh — feedback юзеру в попапе. */
  lastRefreshOutcome: WarehouseRefreshOutcome;

  get(id: string): Warehouse | undefined;

  /** Заменить весь набор (после загрузки с сервера / из кэша). */
  setLoaded(p: { warehouses: Warehouse[]; meta: WarehousesMeta | null }): void;
  setStatus(status: WarehouseSyncStatus): void;
  setRefreshOutcome(outcome: WarehouseRefreshOutcome): void;
  /** Optimistic локальный патч одного склада (после server save). */
  patchLocal(id: string, fields: Partial<Warehouse>): void;
}

function buildIndex(arr: Warehouse[]): Map<string, Warehouse> {
  return new Map(arr.map((w) => [w.id, w]));
}

export const useWarehousesStore = create<WarehousesState>((set, get) => ({
  warehouses: [],
  byId: new Map(),
  meta: null,
  status: 'idle',
  lastRefreshOutcome: null,

  get(id: string) {
    return get().byId.get(id);
  },

  setLoaded({ warehouses, meta }) {
    set({ warehouses, byId: buildIndex(warehouses), meta, status: 'loaded' });
  },

  setStatus(status) {
    set({ status });
  },

  setRefreshOutcome(outcome) {
    set({ lastRefreshOutcome: outcome });
  },

  patchLocal(id, fields) {
    set((s) => {
      const next = s.warehouses.map((w) => (w.id === id ? { ...w, ...fields } : w));
      return { warehouses: next, byId: buildIndex(next) };
    });
  },
}));
