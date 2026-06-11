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
  /** Флаг «статус задан/снят руками»: 0 — авто (полный расчёт на клиенте), 1 — ручной (держим как есть). */
  stat_manual: number;
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
  /** «Кто согласовал» — поле якоря, заполняется руками (видно во всех видах). */
  approved_by: string;
  /** Доставка вне графика (0/1). */
  off_schedule: number;
  /** Уровень дробления поставки: 0 — основная (дефолт), 1..3 — отдельные поставки
   *  внутри связки отправитель+получатель (ключ группировки = fr+to+уровень). */
  split_level: number;
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
 * Удалить строки формирования по id — сервер удаляет ТОЛЬКО OFF-строки (активные
 * защищены). Рассылает `flow_changed{deleted}` всем. Возвращает реально удалённые id.
 */
export async function flowWorkflowDelete(client: ApiClient, ids: number[]): Promise<number[]> {
  const wire = await client.call<{ deleted?: number[] }>('flow_workflow_delete', { ids });
  return Array.isArray(wire.deleted) ? wire.deleted : [];
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
 * «Вид» раздела «Поток» (фильтры / сортировка / порядок / масштаб) — UI-слой НАД
 * данными: строки таблицы не меняет (как filter-views в Google-таблицах). ОБЩИЙ вид
 * хранится на сервере и синхронен всем; `value` — непрозрачная JSON-строка вида (клиент
 * сам сериализует/разбирает её), пусто — вида нет (по умолчанию). `updatedBy` — кто
 * последний менял (для аватара). Личный вид живёт в localStorage клиента, сюда не ходит.
 */
export interface FlowView {
  /** JSON-строка состояния вида. Пустая строка — общий вид сброшен (по умолчанию). */
  value: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

interface FlowViewWire {
  value?: string;
  updated_by?: string;
  updated_by_name?: string;
  updated_at?: string;
}

function wireToFlowView(wire: FlowViewWire): FlowView {
  return {
    value: typeof wire.value === 'string' ? wire.value : '',
    updatedBy: wire.updated_by ?? '',
    updatedByName: wire.updated_by_name ?? '',
    updatedAt: wire.updated_at ?? '',
  };
}

/** Прочитать общий вид раздела «Поток». Не задан → `value` пустой. */
export async function flowViewGet(client: ApiClient): Promise<FlowView> {
  const wire = await client.call<FlowViewWire>('flow_view_get', {});
  return wireToFlowView(wire);
}

/**
 * Сохранить/сбросить общий вид (admin). `value` — JSON-строка вида (пустая строка =
 * сброс к виду по умолчанию). Сервер пишет автора и рассылает `flow_view_changed` всем
 * (клиенты в режиме «Общий» применяют вид + обновляют аватар автора). Чисто UI.
 */
export async function flowViewSet(client: ApiClient, value: string): Promise<FlowView> {
  const wire = await client.call<FlowViewWire>('flow_view_set', { value });
  return wireToFlowView(wire);
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
  /** Сколько строк сменили склад-получатель (для журнала LOG). */
  to_changed: number;
  staging_upserted: number;
  /** Сколько строк было в формировании до прогона / стало после / удалено (подчищено). */
  total_before: number;
  total_after: number;
  deleted: number;
}

/** Запись журнала прогона выгрузки заказов (раздел LOG): кто/когда + итоги. */
export interface FlowImportRun {
  id: number;
  login: string;
  full_name: string;
  /** Момент нажатия «Выгрузка заказов» (ISO) — включает прогон VBS/SAP. */
  started_at: string;
  /** Момент полного завершения пересчёта на сервере (ISO). */
  finished_at: string;
  received: number;
  inserted: number;
  updated: number;
  off_marked: number;
  reappeared: number;
  to_changed: number;
  staging_upserted: number;
  /** Было в формировании до прогона / стало после / удалено (подчищено) — для строки LOG. */
  total_before: number;
  total_after: number;
  deleted: number;
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

/**
 * Отправить разобранную выгрузку заказов на воркер (E2E через VPS). `startedAt` —
 * ISO-момент нажатия кнопки на клиенте (включает прогон VBS/SAP); сервер пишет его
 * в журнал прогона (раздел LOG) как начало, конец = завершение пересчёта.
 */
export async function flowImport(
  client: ApiClient,
  rows: FlowImportRow[],
  startedAt?: string,
): Promise<FlowImportResult> {
  const wire = await client.call<Partial<FlowImportResult>>('flow_import', { rows, started_at: startedAt });
  return {
    received: Number(wire.received) || 0,
    updated: Number(wire.updated) || 0,
    inserted: Number(wire.inserted) || 0,
    off: Number(wire.off) || 0,
    reappeared: Number(wire.reappeared) || 0,
    to_changed: Number(wire.to_changed) || 0,
    staging_upserted: Number(wire.staging_upserted) || 0,
    total_before: Number(wire.total_before) || 0,
    total_after: Number(wire.total_after) || 0,
    deleted: Number(wire.deleted) || 0,
  };
}

/** Прочитать журнал прогонов выгрузки (новые сверху) для раздела LOG. */
export async function flowImportRunsGet(client: ApiClient, limit?: number): Promise<FlowImportRun[]> {
  const wire = await client.call<{ runs?: FlowImportRun[] }>('flow_import_runs_get', limit ? { limit } : {});
  return Array.isArray(wire.runs) ? wire.runs : [];
}

/** Кнопки-скрипты раздела «Скрипты»: OBD / zm_vl / СЭД / МОЛы. */
export type FlowScriptId = 'obd' | 'zmvl' | 'sed' | 'mols';

export interface FlowScriptPress {
  id: string;
  by: string;
  byName: string;
  at: string;
}

/** Нажать кнопку скрипта (фиксируется кто/когда; прогоны подключатся позже). */
export async function flowScriptPress(client: ApiClient, id: FlowScriptId): Promise<FlowScriptPress> {
  const wire = await client.call<{ id?: string; by?: string; by_name?: string; at?: string }>(
    'flow_script_press',
    { id },
  );
  return { id: wire.id ?? id, by: wire.by ?? '', byName: wire.by_name ?? '', at: wire.at ?? '' };
}

/** Последние нажатия всех кнопок (подсветка при входе в раздел). */
export async function flowScriptPressesGet(client: ApiClient): Promise<FlowScriptPress[]> {
  const wire = await client.call<{ presses?: Array<{ id?: string; by?: string; by_name?: string; at?: string }> }>(
    'flow_script_presses_get',
    {},
  );
  return (wire.presses ?? []).map((p) => ({
    id: p.id ?? '',
    by: p.by ?? '',
    byName: p.by_name ?? '',
    at: p.at ?? '',
  }));
}
