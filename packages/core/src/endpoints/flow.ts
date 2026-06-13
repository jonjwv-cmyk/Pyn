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

/** Прочитать общий вид раздела «Транспорт» (отдельный от «Потока»). */
export async function flowTransportViewGet(client: ApiClient): Promise<FlowView> {
  const wire = await client.call<FlowViewWire>('flow_transport_view_get', {});
  return wireToFlowView(wire);
}

/** Сохранить/сбросить общий вид «Транспорта» (admin). Сервер шлёт `flow_transport_view_changed`. */
export async function flowTransportViewSet(client: ApiClient, value: string): Promise<FlowView> {
  const wire = await client.call<FlowViewWire>('flow_transport_view_set', { value });
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

/**
 * Нормализованная строка выгрузки zm_vl (полная сверка поставок, ТЗ §5.2). Клиент
 * сопоставляет колонки реальной выгрузки (по ИМЕНАМ заголовков, см. `parseZmvlTsv`)
 * в эти поля и шлёт на сервер `flow_zmvl_reconcile`. Карта: Поставка→dlv, Позиция→
 * dlv_pos, НомЗаказа→ord, ПозЗаказа→it, Номер транспортного заказа→trz, Отп_Склад→fr,
 * Пол_Склад→to_wh, Объем Пост→qty(план), ДатаПлановОМ→plan_date, КолПрихода→fact_qty,
 * Дата проводки→fact_dt, Создал→sap_created_by, Дата создания+Время→sap_created_at,
 * места с остатком→stock_note, Удалить→deleted.
 */
export interface FlowZmvlRow {
  dlv: string;
  dlv_pos: string;
  ord: string;
  it: string;
  trz: string;
  fr: string;
  to_wh: string;
  /** Плановый объём поставки (строкой как в выгрузке; сервер нормализует число). */
  qty: string;
  /** Плановая дата (ДатаПлановОМ) — сервер приведёт к YYYY-MM-DD. */
  plan_date: string;
  /** КолПрихода (факт пришло в цех). */
  fact_qty: string;
  /** Дата проводки факта. */
  fact_dt: string;
  sap_created_by: string;
  sap_created_at: string;
  /** «Справка»: места хранения с НЕнулевым остатком (собирает клиент). */
  stock_note: string;
  /** Признак удаления SAP («Удалить»). */
  deleted: string;
}

export interface FlowZmvlReconcileResult {
  received: number;
  /** Сколько черновиков получили SAP-номер (создание поставки). */
  assigned: number;
  updated: number;
  inserted: number;
  /** Сколько поставок ушло в резерв (исчезли из полной выгрузки / помечены удалёнными). */
  reserved: number;
  full: boolean;
}

/**
 * Полная сверка поставок по zm_vl (ТЗ §5.2): новый номер→черновику, факт прихода,
 * исчезла→резерв (позиция снова открыта). `full` (по умолчанию true) включает
 * reserve-missing — ставить ТОЛЬКО на ПОЛНОЙ выгрузке (все статусы), иначе снесёт план.
 */
export async function flowZmvlReconcile(
  client: ApiClient,
  rows: FlowZmvlRow[],
  full = true,
): Promise<FlowZmvlReconcileResult> {
  const wire = await client.call<Partial<FlowZmvlReconcileResult>>('flow_zmvl_reconcile', { rows, full });
  return {
    received: Number(wire.received) || 0,
    assigned: Number(wire.assigned) || 0,
    updated: Number(wire.updated) || 0,
    inserted: Number(wire.inserted) || 0,
    reserved: Number(wire.reserved) || 0,
    full: wire.full !== false,
  };
}

/**
 * Разобрать TSV полной выгрузки zm_vl (152 колонки, эталон `все колонки zm_vl.XLSX`).
 * Матч колонок по ИМЕНАМ заголовков (ПЕРВАЯ строка TSV) — устойчиво к перестановке/
 * подмножеству колонок при доработке макроса. Дубли заголовков («Позиция», «Базовая
 * ЕИ») → берём ПЕРВОЕ вхождение (это нужные: Позиция=поз.поставки, ЕИ=базовая).
 * Заголовки нормализуем (trim + схлоп пробелов + срез хвостовой точки «КолПрихода.»).
 * Строка без «Поставка» и без «НомЗаказа» — пропуск (шапка/мусор).
 */
export function parseZmvlTsv(tsv: string): FlowZmvlRow[] {
  const lines = String(tsv ?? '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) return [];
  const normH = (h: string): string =>
    String(h ?? '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').toLowerCase();
  const header = (lines[0] ?? '').split('\t');
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = normH(h);
    if (k && !idx.has(k)) idx.set(k, i); // первое вхождение
  });
  // Найти индекс по списку кандидатов (нормализованных) — первый совпавший.
  const col = (...names: string[]): number => {
    for (const n of names) {
      const k = normH(n);
      const i = idx.get(k);
      if (i != null) return i;
    }
    return -1;
  };
  const iDlv = col('Поставка');
  const iPos = col('Позиция');
  const iOrd = col('НомЗаказа');
  const iIt = col('ПозЗаказа');
  const iTrz = col('Номер транспортного заказа');
  const iFr = col('Отп_Склад');
  const iTo = col('Пол_Склад');
  const iQty = col('Объем Пост', 'Объем поставки');
  const iPlanDt = col('ДатаПлановОМ');
  const iFactQty = col('КолПрихода');
  const iFactDt = col('Дата проводки', 'ДатаДокДвМат');
  const iCreBy = col('Создал');
  const iCreDt = col('Дата создания');
  const iCreTm = col('Время');
  const iDel = col('Удалить');
  const iUom = col('Базовая ЕИ');
  const iNo = col('Материал');
  const iMat = col('Наименование материала');
  // SAP grid API macros (`WF_PLAN_VBS`) can return data rows without a header. In that
  // case we use the exact 152-column order from `все колонки zm_vl.XLSX`.
  const hasHeader = iDlv >= 0 && iOrd >= 0;
  const fixed = {
    dlv: 6, pos: 7, trz: 8, fr: 2, to: 3, no: 11, mat: 12, uom: 13,
    ord: 22, it: 23, creBy: 24, creDt: 25, creTm: 26, factDt: 64, planDt: 68,
    factQty: 86, qty: 103, del: 143,
    stock: [[30, 21], [32, 33], [34, 35], [36, 37]] as Array<[number, number]>,
  };
  const ix = (named: number, fallback: number): number => (hasHeader ? named : fallback);
  // «Справка» — места хранения с НЕнулевым остатком (ТЗ §7): пары место→запас.
  const stockPairs: Array<[number, number]> = [
    [ix(col('Складское место'), fixed.stock[0]?.[0] ?? -1), ix(col('СвОстЦС'), fixed.stock[0]?.[1] ?? -1)],
    [ix(col('Складское место1'), fixed.stock[1]?.[0] ?? -1), ix(col('Запас СМ1'), fixed.stock[1]?.[1] ?? -1)],
    [ix(col('Складское место2'), fixed.stock[2]?.[0] ?? -1), ix(col('Запас СМ2'), fixed.stock[2]?.[1] ?? -1)],
    [ix(col('Складское место3'), fixed.stock[3]?.[0] ?? -1), ix(col('Запас СМ3'), fixed.stock[3]?.[1] ?? -1)],
  ];
  const at = (p: string[], i: number): string => (i >= 0 ? (p[i] ?? '').trim() : '');
  const posNum = (s: string): boolean => {
    const n = Number(String(s).replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0;
  };
  const out: FlowZmvlRow[] = [];
  for (let li = hasHeader ? 1 : 0; li < lines.length; li++) {
    const p = (lines[li] ?? '').split('\t');
    const dlv = at(p, ix(iDlv, fixed.dlv));
    const ord = at(p, ix(iOrd, fixed.ord));
    if (!dlv && !ord) continue;
    const place: string[] = [];
    for (const [pi, qi] of stockPairs) {
      const pl = at(p, pi);
      const q = at(p, qi);
      if (pl && posNum(q)) place.push(`${pl}:${q}`);
    }
    const creDt = at(p, ix(iCreDt, fixed.creDt));
    const creTm = at(p, ix(iCreTm, fixed.creTm));
    out.push({
      dlv,
      dlv_pos: at(p, ix(iPos, fixed.pos)),
      ord,
      it: at(p, ix(iIt, fixed.it)),
      trz: at(p, ix(iTrz, fixed.trz)),
      fr: at(p, ix(iFr, fixed.fr)),
      to_wh: at(p, ix(iTo, fixed.to)),
      qty: at(p, ix(iQty, fixed.qty)),
      plan_date: at(p, ix(iPlanDt, fixed.planDt)),
      fact_qty: at(p, ix(iFactQty, fixed.factQty)),
      fact_dt: at(p, ix(iFactDt, fixed.factDt)),
      sap_created_by: at(p, ix(iCreBy, fixed.creBy)),
      sap_created_at: [creDt, creTm].filter(Boolean).join(' '),
      stock_note: place.join('; '),
      deleted: at(p, ix(iDel, fixed.del)),
    });
  }
  return out;
}

/** Прочитать журнал прогонов выгрузки (новые сверху) для раздела LOG. */
export async function flowImportRunsGet(client: ApiClient, limit?: number): Promise<FlowImportRun[]> {
  const wire = await client.call<{ runs?: FlowImportRun[] }>('flow_import_runs_get', limit ? { limit } : {});
  return Array.isArray(wire.runs) ? wire.runs : [];
}

/** Кнопки-скрипты сайдбара: OBD / zm_vl / СЭД / МОЛы / Контакты / OTIF5. */
export type FlowScriptId = 'obd' | 'zmvl' | 'sed' | 'mols' | 'contacts' | 'otif5';

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

/** Запись журнала нажатия кнопки-скрипта (раздел LOG). */
export interface FlowScriptRun {
  id: number;
  scriptId: string;
  login: string;
  fullName: string;
  at: string;
}

/** Журнал нажатий кнопок-скриптов (раздел LOG, новые сверху). */
export async function flowScriptRunsGet(client: ApiClient, limit?: number): Promise<FlowScriptRun[]> {
  const wire = await client.call<{ runs?: Array<{ id?: number; script_id?: string; login?: string; full_name?: string; at?: string }> }>(
    'flow_script_runs_get',
    limit ? { limit } : {},
  );
  return (wire.runs ?? []).map((r) => ({
    id: Number(r.id) || 0,
    scriptId: r.script_id ?? '',
    login: r.login ?? '',
    fullName: r.full_name ?? '',
    at: r.at ?? '',
  }));
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
