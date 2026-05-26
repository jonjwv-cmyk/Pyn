/**
 * Warehouses store — справочник складов на клиенте.
 *
 * Источник истины (future): D1 `warehouses` table + CF Worker endpoints.
 * Сейчас: seed-данные из xlsx импорта (534 склада) + локальные edits в localStorage.
 *
 * Когда сервер-эндпоинты появятся — заменим эту прослойку на сетевую sync.
 */

import {
  createZustandStore as create,
  type Warehouse,
  type WarehouseCluster,
  type WarehouseWeekday,
} from '@pyn/core';
import seedRaw from '@/data/warehouses-seed.json';

const STORAGE_KEY = 'pyn:warehouses:v1';

interface WarehousesState {
  warehouses: Warehouse[];
  byId: Map<string, Warehouse>;

  // Selectors
  get(id: string): Warehouse | undefined;

  // Mutations
  updateSchedule(id: string, cluster: WarehouseCluster | null, day: WarehouseWeekday | null): void;
  toggleShipping(id: string): void;
  markRemoved(id: string, removed: boolean): void;
  updateFields(id: string, patch: Partial<Warehouse>): void;
  deleteWarehouse(id: string): void;

  // Bulk
  reset(): void;
}

function loadState(): Warehouse[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Warehouse[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return seedRaw as Warehouse[];
}

function persist(warehouses: Warehouse[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(warehouses));
  } catch {
    /* quota ignore */
  }
}

function buildIndex(arr: Warehouse[]): Map<string, Warehouse> {
  return new Map(arr.map((w) => [w.id, w]));
}

export const useWarehousesStore = create<WarehousesState>((set, get) => {
  const initial = loadState();
  return {
    warehouses: initial,
    byId: buildIndex(initial),

    get(id: string) {
      return get().byId.get(id);
    },

    updateSchedule(id, cluster, day) {
      set((s) => {
        const next = s.warehouses.map((w) =>
          w.id === id
            ? {
                ...w,
                cluster,
                delivery_day: day,
                in_schedule: cluster && day ? (1 as const) : (0 as const),
              }
            : w,
        );
        persist(next);
        return { warehouses: next, byId: buildIndex(next) };
      });
    },

    toggleShipping(id) {
      set((s) => {
        const next = s.warehouses.map((w) =>
          w.id === id ? { ...w, is_shipping: w.is_shipping ? (0 as const) : (1 as const) } : w,
        );
        persist(next);
        return { warehouses: next, byId: buildIndex(next) };
      });
    },

    markRemoved(id, removed) {
      set((s) => {
        const next = s.warehouses.map((w) =>
          w.id === id ? { ...w, is_removed: removed ? (1 as const) : (0 as const) } : w,
        );
        persist(next);
        return { warehouses: next, byId: buildIndex(next) };
      });
    },

    updateFields(id, patch) {
      set((s) => {
        const next = s.warehouses.map((w) => (w.id === id ? { ...w, ...patch } : w));
        persist(next);
        return { warehouses: next, byId: buildIndex(next) };
      });
    },

    deleteWarehouse(id) {
      set((s) => {
        const next = s.warehouses.filter((w) => w.id !== id);
        persist(next);
        return { warehouses: next, byId: buildIndex(next) };
      });
    },

    reset() {
      const fresh = seedRaw as Warehouse[];
      persist(fresh);
      set({ warehouses: fresh, byId: buildIndex(fresh) });
    },
  };
});
