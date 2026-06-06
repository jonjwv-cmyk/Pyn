import type { ApiClient } from '../api/client';

/**
 * Раздел «Поток», Этап 1 «Формирование» — живое чтение/правки базы (flow_workflow).
 * Строка 1:1 с серверной колоночной формой + row_version для защиты от конфликта.
 */
export interface FlowRow {
  id: number;
  clst: string;
  ord: string;
  it: string;
  fr: string;
  to_wh: string;
  pr: string;
  day_wk: string;
  stat: string;
  time_at: string;
  pct: number | null;
  q: string;
  warn: string;
  no_num: string;
  mat: string;
  uom: string;
  qty: number | null;
  kg: number | null;
  v: number | null;
  note: string;
  mol: string;
  request: string;
  created_by: string;
  load_dt: string;
  chg: number | null;
  mat_full: string;
  row_version: number;
}

/** Одна правка строки: id + версия (для конфликта) + изменённые поля. */
export interface FlowEdit {
  id: number;
  row_version: number;
  fields: Record<string, string | number | null>;
}

/** Прочитать всю базу формирования. */
export async function flowWorkflowGet(client: ApiClient): Promise<FlowRow[]> {
  const wire = await client.call<{ rows?: FlowRow[] }>('flow_workflow_get', {});
  return Array.isArray(wire.rows) ? wire.rows : [];
}

/**
 * Применить правки (реалтайм). Сервер пишет с проверкой row_version и рассылает
 * `flow_changed` всем. Возвращает применённые/конфликтные id + актуальные строки
 * (по конфликтным — серверная версия, чтобы клиент «догнал»).
 */
export async function flowWorkflowEdit(
  client: ApiClient,
  edits: FlowEdit[],
): Promise<{ applied: number[]; conflicts: number[]; rows: FlowRow[] }> {
  const wire = await client.call<{ applied?: number[]; conflicts?: number[]; rows?: FlowRow[] }>(
    'flow_workflow_edit',
    { edits },
  );
  return {
    applied: Array.isArray(wire.applied) ? wire.applied : [],
    conflicts: Array.isArray(wire.conflicts) ? wire.conflicts : [],
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}
