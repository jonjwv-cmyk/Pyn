/**
 * vgh-store — база ВГХ (вес-габаритные характеристики) на клиенте.
 *
 * Небольшая база (~3.6к номенклатур) читается напрямую (`flow_vgh_get`, как
 * `flow_workflow_get`) — без R2-снэпшота. Источник KG/V и тех-имени для
 * формирования (считаются реалтайм: вес/объём на 1 ЕИ × количество) + данные
 * для карточки правки номенклатуры. Обновляется по WS `vgh_changed`.
 *
 * Индекс `byKey` — по НОРМАЛИЗОВАННОЙ номенклатуре (без пробелов, без ведущих
 * нулей для чисто-цифровых), чтобы матч с формированием не ломали ведущие нули.
 */

import { createZustandStore as create, type VghRow } from '@pyn/core';

export type VghSyncStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Нормализация номенклатуры для матча (зеркало серверного normKey). */
export function normVghKey(v: string | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v).trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    s = s.replace(/^0+/, '');
    if (!s) s = '0';
  }
  return s;
}

interface VghState {
  rows: VghRow[];
  /** Индекс по нормализованной номенклатуре (для KG/V в формировании). */
  byKey: Map<string, VghRow>;
  /** Индекс по точному no_num (для карточки правки). */
  byNoNum: Map<string, VghRow>;
  status: VghSyncStatus;

  lookup(noNum: string): VghRow | undefined;
  get(noNum: string): VghRow | undefined;

  setLoaded(rows: VghRow[]): void;
  setStatus(status: VghSyncStatus): void;
  /** Слияние изменённых строк (WS `vgh_changed` / ответ правки). */
  applyChanged(rows: VghRow[]): void;
}

function buildKeyIndex(arr: VghRow[]): Map<string, VghRow> {
  const m = new Map<string, VghRow>();
  for (const r of arr) {
    const k = normVghKey(r.no_num);
    if (k) m.set(k, r);
  }
  return m;
}

function buildNoIndex(arr: VghRow[]): Map<string, VghRow> {
  return new Map(arr.map((r) => [String(r.no_num), r]));
}

export const useVghStore = create<VghState>((set, get) => ({
  rows: [],
  byKey: new Map(),
  byNoNum: new Map(),
  status: 'idle',

  lookup(noNum) {
    return get().byKey.get(normVghKey(noNum));
  },
  get(noNum) {
    return get().byNoNum.get(String(noNum));
  },

  setLoaded(rows) {
    set({ rows, byKey: buildKeyIndex(rows), byNoNum: buildNoIndex(rows), status: 'loaded' });
  },
  setStatus(status) {
    set({ status });
  },

  applyChanged(changed) {
    if (!changed || changed.length === 0) return;
    set((s) => {
      const byNo = new Map(s.byNoNum);
      for (const r of changed) byNo.set(String(r.no_num), r);
      const rows = Array.from(byNo.values());
      return { rows, byNoNum: byNo, byKey: buildKeyIndex(rows) };
    });
  },
}));
