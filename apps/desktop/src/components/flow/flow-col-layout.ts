// §T6 — порядок колонок per-user на сервере (кнопка «Перестановка»).

/** Вид грида с собственным layout (Формирование / План / Отчёт). */
export type FlowGridKind = 'formation' | 'plan' | 'report';

export interface FlowColLayoutState {
  /** Кнопка «Перестановка» включена → показываем сохранённый порядок. */
  customOn: boolean;
  /** id колонок в пользовательском порядке (включая 🟡, если были в наборе). */
  colOrder: string[];
}

export const EMPTY_COL_LAYOUT: FlowColLayoutState = { customOn: false, colOrder: [] };

const GRID_KINDS = new Set<FlowGridKind>(['formation', 'plan', 'report']);

export function isFlowGridKind(v: string): v is FlowGridKind {
  return GRID_KINDS.has(v as FlowGridKind);
}

/** Применить сохранённый порядок; неизвестные/новые колонки — в хвост. */
export function applyColOrder<T extends { id: string }>(
  cols: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...cols];
  const byId = new Map(cols.map((c) => [c.id, c]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const c = byId.get(id);
    if (c) {
      out.push(c);
      seen.add(id);
    }
  }
  for (const c of cols) if (!seen.has(c.id)) out.push(c);
  return out;
}

export function serializeColLayout(state: FlowColLayoutState): string {
  return JSON.stringify({
    customOn: !!state.customOn,
    colOrder: [...state.colOrder],
  });
}

export function parseColLayout(raw: string | null | undefined): FlowColLayoutState {
  if (!raw || !raw.trim()) return EMPTY_COL_LAYOUT;
  try {
    const o = JSON.parse(raw) as Partial<FlowColLayoutState>;
    const colOrder = Array.isArray(o.colOrder) ? o.colOrder.map(String).filter(Boolean) : [];
    return { customOn: !!o.customOn, colOrder };
  } catch {
    return EMPTY_COL_LAYOUT;
  }
}