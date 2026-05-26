/**
 * Warehouse — справочник складов (D1 table `warehouses`).
 * См. /db/warehouses/schema.sql для авторитетного определения.
 */

export type WarehouseCluster = 'КХП' | 'НТМК' | 'ВЫЕЗД';
export type WarehouseWeekday = 'ПН' | 'ВТ' | 'СР' | 'ЧТ' | 'ПТ' | 'СБ' | 'ВС';

export interface Warehouse {
  /** PK, immutable. Может содержать буквы: '2803', '824Т', 'OTKZ', '824Ц'. */
  id: string;

  // ── Static reference ─────────────────────────────────────────────────
  shop_name: string;          // 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ'
  shop_code: string | null;   // '128'
  description: string | null; // 'Склад МОЛ' / 'Промежуточный склад'
  designation: string | null; // 'АТЦ СпОд и ВспМ'
  keeper: string | null;      // 'АТЦ СПОД И ВСПМ'
  work_phone: string | null;  // '49 71 95' (multiline OK)
  legacy_id: string | null;   // '028Д'

  // ── Schedule attributes (editable from Pyn admin) ────────────────────
  cluster: WarehouseCluster | null;
  delivery_day: WarehouseWeekday | null;
  in_schedule: 0 | 1;

  // ── Flow markers ─────────────────────────────────────────────────────
  is_shipping: 0 | 1; // 1 = с этого склада ОТГРУЖАЕМ (не привозим)
  is_removed: 0 | 1;  // 1 = удалён (auto при отсутствии в next import)
}

/** Канонический порядок кластеров в графике: НТМК → ВЫЕЗД → КХП. */
export const CLUSTER_ORDER: Record<WarehouseCluster, number> = {
  НТМК: 0,
  ВЫЕЗД: 1,
  КХП: 2,
};

/** Состояние склада для UI color-coding (приоритет сверху-вниз). */
export type WarehouseState = 'removed' | 'shipping' | 'scheduled' | 'idle';

export function getWarehouseState(w: Warehouse): WarehouseState {
  if (w.is_removed) return 'removed';
  if (w.is_shipping) return 'shipping';
  if (w.in_schedule) return 'scheduled';
  return 'idle';
}
