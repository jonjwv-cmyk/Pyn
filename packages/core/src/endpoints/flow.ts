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

/**
 * Приём выгрузки заказов: приложение запускает VBS «Выгрузка заказов» (SAP→TSV),
 * парсит TSV (`parseOrdersTsv`) и шлёт строки сюда СВОИМ E2E-каналом (через
 * корп-прокси если есть → слепой VPS → воркер). Сервер корректирует (111→0111,
 * чистка чисел), обновляет формирование НА МЕСТЕ и рассылает реалтайм.
 */
export interface FlowImportRow {
  ord: string;
  it: string;
  fr: string;
  q: string;
  no_num: string;
  mat: string;
  uom: string;
  qty: string;
  kg: string;
  chg: string;
  created_by: string;
  load_dt: string;
  /** Сырой склад-получатель (TO_1); корректировку 111→0111 делает сервер. */
  to: string;
}

export interface FlowImportResult {
  received: number;
  updated: number;
  inserted: number;
  off: number;
  reappeared: number;
  staging_upserted: number;
}

/**
 * Разобрать TSV выгрузки заказов (как пишет VBS `Pyn-wf_orders.vbs`): без шапки,
 * строки через перевод строки, 13 колонок через TAB:
 * ORD·IT·FR·Q·NO.№·MAT·UoM·QTY·KG·CHG·CREATEDBY·LOADDT·TO_1.
 * Строки, где первая колонка не число (шапка/мусор) — пропускаем.
 */
export function parseOrdersTsv(tsv: string): FlowImportRow[] {
  const out: FlowImportRow[] = [];
  for (const raw of String(tsv ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const p = raw.split('\t');
    const ord = (p[0] ?? '').trim();
    if (!/^\d+$/.test(ord)) continue;
    out.push({
      ord,
      it: (p[1] ?? '').trim(),
      fr: (p[2] ?? '').trim(),
      q: (p[3] ?? '').trim(),
      no_num: (p[4] ?? '').trim(),
      mat: (p[5] ?? '').trim(),
      uom: (p[6] ?? '').trim(),
      qty: (p[7] ?? '').trim(),
      kg: (p[8] ?? '').trim(),
      chg: (p[9] ?? '').trim(),
      created_by: (p[10] ?? '').trim(),
      load_dt: (p[11] ?? '').trim(),
      to: (p[12] ?? '').trim(),
    });
  }
  return out;
}

/** Отправить разобранную выгрузку заказов на воркер (E2E через VPS). */
export async function flowImport(client: ApiClient, rows: FlowImportRow[]): Promise<FlowImportResult> {
  const wire = await client.call<Partial<FlowImportResult>>('flow_import', { rows });
  return {
    received: Number(wire.received) || 0,
    updated: Number(wire.updated) || 0,
    inserted: Number(wire.inserted) || 0,
    off: Number(wire.off) || 0,
    reappeared: Number(wire.reappeared) || 0,
    staging_upserted: Number(wire.staging_upserted) || 0,
  };
}
