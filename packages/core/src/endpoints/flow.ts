import type { ApiClient } from '../api/client';

/**
 * Раздел «Поток», Этап 1 «Формирование» — живое чтение/правки базы (flow_workflow).
 * Строка 1:1 с серверной колоночной формой + row_version для защиты от конфликта.
 */
export interface FlowRow {
  id: number;
  // CLST в БД НЕ хранится — кластер/день чисто показ (расчёт из графика на клиенте).
  ord: string;
  it: string;
  fr: string;
  to_wh: string;
  pr: string;
  day_wk: string;
  stat: string;
  time_at: string;
  // % в БД НЕ хранится — производное (1 − qty/chg), считаем на клиенте (livePct).
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
  /** Когда заказ удалён (пропал из выгрузки → day_wk='OFF'). Пусто — активен. */
  off_at: string;
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

/**
 * Выбранный месяц формирования — ОБЩАЯ настройка раздела «Поток»: какой месяц
 * графика берётся за основу (CLST/даты). Хранится на сервере, меняется под
 * паролем, рассылается всем реалтайм. `updatedBy` — кто выбрал (для аватара).
 */
export interface FlowPlanMonth {
  year: number;
  month: number;
  /** Login выбравшего (для аватара). Пусто — месяц по умолчанию (не выбирали). */
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

interface FlowPlanMonthWire {
  year?: number;
  month?: number;
  updated_by?: string;
  updated_by_name?: string;
  updated_at?: string;
}

function wireToPlanMonth(wire: FlowPlanMonthWire, fallbackYear = 0, fallbackMonth = 0): FlowPlanMonth {
  return {
    year: Number(wire.year) || fallbackYear,
    month: Number(wire.month) || fallbackMonth,
    updatedBy: wire.updated_by ?? '',
    updatedByName: wire.updated_by_name ?? '',
    updatedAt: wire.updated_at ?? '',
  };
}

/** Прочитать выбранный месяц формирования. Не задан → текущий месяц (updatedBy пуст). */
export async function flowPlanMonthGet(client: ApiClient): Promise<FlowPlanMonth> {
  const wire = await client.call<FlowPlanMonthWire>('flow_plan_month_get', {});
  return wireToPlanMonth(wire);
}

/**
 * Сменить месяц формирования (общий для всех). Требует пароль. Сервер проверяет:
 * прошлый месяц нельзя, месяц без «дней без доставки» нельзя — бросает ApiError
 * с code `wrong_password` / `month_in_past` / `schedule_not_formed`. Успех →
 * сервер рассылает `flow_plan_month_changed` всем (CLST пересчитается у каждого).
 */
export async function flowPlanMonthSet(
  client: ApiClient,
  params: { year: number; month: number; password: string },
): Promise<FlowPlanMonth> {
  const wire = await client.call<FlowPlanMonthWire>('flow_plan_month_set', params);
  return wireToPlanMonth(wire, params.year, params.month);
}
