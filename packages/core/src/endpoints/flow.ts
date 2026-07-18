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
  /** Текущее кол-во заказа = ИСТИНА из выгрузки (перезаписывается при импорте). */
  qty: number | null;
  /** «Изначально по заказу» — кол-во на момент ПЕРВОЙ выгрузки позиции, неизменно (справка).
   *  Опционально: снимок/старые строки без него (бэкфилл = qty). */
  ordered_init?: number | null;
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
  /** §15 — даты отправки на согласование (CSV ISO); ставит кнопка «Согласование». */
  approved_dates?: string;
  /** П1.12 «Согл» — галочка 0/1 (пусто / да). Держится, пока не снимут. */
  sogl?: number;
  /** НАШИ поля (НЕ из САП; поля ЯКОРЯ — видны/правятся в Формировании/Плане/Отчёте,
   *  как mol/note/approved). Модель сайта в Поток (юзер 2026-07-12):
   *  • point — точка(и) выгрузки с карты; `\n` разделяет до 3 точек (мульти-точка: один
   *    якорь → визуально N строк; кол-во НЕ множим — одна позиция для расчёта);
   *  • delivery — окно доставки «HH:MM–HH:MM» (08:30–19:30), пусто = вся смена;
   *  • priority — high|mid|low (дефолт low), кормит Балл (EPS);
   *  • unload_equip — override оснастки выгрузки (CSV ключей crane,forklift…); пусто =
   *    производная от точки (оснастка точки с карты). Погрузка/Балл — производные, не хранятся. */
  point?: string;
  delivery?: string;
  priority?: string;
  unload_equip?: string;
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

export type FlowColLayoutGrid = 'formation' | 'plan' | 'report';

/** Per-user порядок колонок (T6). Пустой `value` — не задан. */
export async function flowColLayoutGet(
  client: ApiClient,
  grid: FlowColLayoutGrid,
): Promise<{ value: string }> {
  const wire = await client.call<{ ok?: boolean; value?: string }>('flow_col_layout_get', { grid });
  return { value: typeof wire.value === 'string' ? wire.value : '' };
}

/** Сохранить per-user layout колонок (JSON-строка или '' = сброс). */
export async function flowColLayoutSet(
  client: ApiClient,
  grid: FlowColLayoutGrid,
  value: string,
): Promise<{ value: string }> {
  const wire = await client.call<{ ok?: boolean; value?: string }>('flow_col_layout_set', { grid, value });
  return { value: typeof wire.value === 'string' ? wire.value : value };
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
  /** 1 — успех, 0 — ошибка (текст в error). */
  ok?: number;
  error?: string;
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
 * Пол_Склад→to_wh, Объем поставки→qty(план), ДатаПлановОМ→plan_date, КолПрихода→fact_qty,
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
  /** Остаток СУС (Запас СУС из zm_vl) — колонка остатков в выгрузке Плана. */
  stock_sus: string;
  /** Остаток ММ (Запас ММ из zm_vl). */
  stock_mm: string;
  /** ОСТАТ — свободный остаток ЦС (СвОстЦС) — хвост выгрузки Плана (юзер 2026-07-04). */
  stock_cs: string;
  /** СПП Остат ЦС. */
  spp_cs: string;
  /** «Складское место» SAP (основное; обычно пусто). */
  stock_place: string;
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
  // ⚠️ qty = «Объем поставки» (кол-во поставки, col 15). НЕ «Объем Пост» (col 104) — он в выгрузках
  // ВСЕГДА 0 (проверено на эталонах zm_vl). Раньше брали 'Объем Пост' первым → qty=0 у создаваемых
  // поставок. Порядок кандидатов: сначала верная колонка, 'Объем Пост' оставлен лишь как фолбэк.
  const iQty = col('Объем поставки', 'Объем Пост');
  const iPlanDt = col('ДатаПлановОМ');
  const iFactQty = col('КолПрихода');
  const iFactDt = col('Дата проводки', 'ДатаДокДвМат');
  const iCreBy = col('Создал');
  const iCreDt = col('Дата создания');
  const iCreTm = col('Время');
  const iSus = col('Запас СУС'); // остаток СУС (колонка остатков)
  const iMm = col('Запас ММ'); // остаток ММ
  const iCs = col('СвОстЦС'); // ОСТАТ — свободный остаток ЦС (хвост xlsx-плана)
  const iSpp = col('СПП Остат ЦС', 'СПП Ост ЦС');
  const iPlace = col('Складское место'); // основное SAP-место (обычно пусто)
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
    factQty: 86, qty: 14, del: 143, // qty=col15 «Объем поставки» (0-based 14); col104 «Объем Пост»=0
    sus: -1, mm: -1, // остаток СУС / ММ — только по имени заголовка (безголовый TSV пропускает)
    cs: 21, spp: 28, place: 30, // СвОстЦС / СПП Остат ЦС / Складское место (хвост xlsx-плана)
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
      stock_sus: at(p, ix(iSus, fixed.sus)),
      stock_mm: at(p, ix(iMm, fixed.mm)),
      stock_cs: at(p, ix(iCs, fixed.cs)),
      spp_cs: at(p, ix(iSpp, fixed.spp)),
      stock_place: at(p, ix(iPlace, fixed.place)),
      deleted: at(p, ix(iDel, fixed.del)),
    });
  }
  return out;
}

/**
 * Нормализованная строка выгрузки СЭД (`ZM_EDM_DOCS`). Это пока только приёмник
 * TSV для будущего `flow_delivery_events`: макрос СЭД может быть не ALV-grid,
 * поэтому парсер принимает и TSV с заголовком, и 33-колоночный порядок из
 * `данные из СЭД.XLSX`.
 */
export interface FlowSedRow {
  icon: string;
  work_status: string;
  document_status: string;
  journal: string;
  sent_date: string;
  sent_time: string;
  sent_by: string;
  approval_status: string;
  approved_date: string;
  approved_time: string;
  open_sed_doc: string;
  open_file: string;
  approved_by_name: string;
  approved_by_tab: string;
  returned: string;
  dlv: string;
  sap_created_date: string;
  plant: string;
  storage: string;
  material_doc: string;
  material_doc_year: string;
  doc_date: string;
  posting_date: string;
  reference: string;
  header_text: string;
  receiving_plant: string;
  receiving_storage: string;
  movement_type: string;
  shop: string;
  receipt_material_doc: string;
  receipt_material_doc_year: string;
  sed_doc_id: string;
  comment: string;
}

/**
 * Разобрать TSV СЭД. Header-driven путь устойчив к копированию списка с шапкой;
 * fallback — фиксированные 33 колонки из `данные из СЭД.XLSX`:
 * icon/status/work/doc/journal/sent/approval/delivery/material docs/UNID/comment.
 * Excel serial dates/times приводим к ISO-like строкам, SAP-текст оставляем как есть.
 */
export function parseSedTsv(tsv: string): FlowSedRow[] {
  const lines = String(tsv ?? '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) return [];
  const normH = (h: string): string =>
    String(h ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '')
      .replace(/ё/g, 'е')
      .toLowerCase();
  const header = (lines[0] ?? '').split('\t');
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = normH(h);
    if (k && !idx.has(k)) idx.set(k, i);
  });
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = idx.get(normH(n));
      if (i != null) return i;
    }
    return -1;
  };
  const iDlv = col('Поставка');
  const iJournal = col('Журнал');
  const iSentDate = col('ДтОтпрСЭД', 'Дата отправки СЭД');
  const iSedDocId = col('ID документа в СЭД', 'UNID');
  const hasHeader = iDlv >= 0 && (iJournal >= 0 || iSentDate >= 0 || iSedDocId >= 0);
  const fixed = {
    icon: 0,
    workStatus: 1,
    documentStatus: 2,
    journal: 3,
    sentDate: 4,
    sentTime: 5,
    sentBy: 6,
    approvalStatus: 7,
    approvedDate: 8,
    approvedTime: 9,
    openSedDoc: 10,
    openFile: 11,
    approvedByName: 12,
    approvedByTab: 13,
    returned: 14,
    dlv: 15,
    sapCreatedDate: 16,
    plant: 17,
    storage: 18,
    materialDoc: 19,
    materialDocYear: 20,
    docDate: 21,
    postingDate: 22,
    reference: 23,
    headerText: 24,
    receivingPlant: 25,
    receivingStorage: 26,
    movementType: 27,
    shop: 28,
    receiptMaterialDoc: 29,
    receiptMaterialDocYear: 30,
    sedDocId: 31,
    comment: 32,
  };
  const ix = (named: number, fallback: number): number => (hasHeader ? named : fallback);
  const at = (p: string[], i: number): string => (i >= 0 ? (p[i] ?? '').trim() : '');
  const serialNum = (s: string): number | null => {
    const raw = String(s ?? '').replace(',', '.').trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const excelDate = (s: string): string => {
    const n = serialNum(s);
    if (n == null || n <= 0 || n < 20000) return s.trim();
    const ms = Math.round((n - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  };
  const excelTime = (s: string): string => {
    const n = serialNum(s);
    if (n == null || n < 0 || n >= 1) return s.trim();
    const total = Math.round(n * 86400);
    const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };
  const dateAt = (p: string[], i: number): string => excelDate(at(p, i));
  const timeAt = (p: string[], i: number): string => excelTime(at(p, i));
  const out: FlowSedRow[] = [];
  for (let li = hasHeader ? 1 : 0; li < lines.length; li++) {
    const p = (lines[li] ?? '').split('\t');
    const dlv = at(p, ix(iDlv, fixed.dlv));
    const sedDocId = at(p, ix(iSedDocId, fixed.sedDocId));
    const materialDoc = at(p, ix(col('Документ материала'), fixed.materialDoc));
    if (!dlv && !sedDocId && !materialDoc) continue;
    out.push({
      icon: at(p, fixed.icon),
      work_status: at(p, ix(col('Статус работы'), fixed.workStatus)),
      document_status: at(p, ix(col('Статус документа'), fixed.documentStatus)),
      journal: at(p, ix(iJournal, fixed.journal)),
      sent_date: dateAt(p, ix(iSentDate, fixed.sentDate)),
      sent_time: timeAt(p, ix(col('ВрОтпрСЭД', 'Время отправки СЭД'), fixed.sentTime)),
      sent_by: at(p, ix(col('КемОтпрСЭД', 'Кем отправлено СЭД'), fixed.sentBy)),
      approval_status: at(p, ix(col('СтСоглДокС', 'СтСоглДокСЭД', 'Статус согласования документа'), fixed.approvalStatus)),
      approved_date: dateAt(p, ix(col('ДтСоглДокС', 'ДтСоглДокСЭД', 'Дата согласования документа'), fixed.approvedDate)),
      approved_time: timeAt(p, ix(col('ВрСоглДокС', 'ВрСоглДокСЭД', 'Время согласования документа'), fixed.approvedTime)),
      open_sed_doc: at(p, ix(col('ОткрДокСЭД'), fixed.openSedDoc)),
      open_file: at(p, ix(col('ОткрФайл'), fixed.openFile)),
      approved_by_name: at(p, ix(col('ФИОСоглСЭД'), fixed.approvedByName)),
      approved_by_tab: at(p, ix(col('ТабСоглСЭД'), fixed.approvedByTab)),
      returned: at(p, ix(col('Возврат'), fixed.returned)),
      dlv,
      sap_created_date: dateAt(p, ix(col('Дата создания'), fixed.sapCreatedDate)),
      plant: at(p, ix(col('Завод'), fixed.plant)),
      storage: at(p, ix(col('Склад'), fixed.storage)),
      material_doc: materialDoc,
      material_doc_year: at(p, ix(col('ГодДокумМатериала'), fixed.materialDocYear)),
      doc_date: dateAt(p, ix(col('Дата документа'), fixed.docDate)),
      posting_date: dateAt(p, ix(col('Дата проводки'), fixed.postingDate)),
      reference: at(p, ix(col('Ссылка'), fixed.reference)),
      header_text: at(p, ix(col('Текст заголовка документа'), fixed.headerText)),
      receiving_plant: at(p, ix(col('Принимающий завод'), fixed.receivingPlant)),
      receiving_storage: at(p, ix(col('Принимающий склад'), fixed.receivingStorage)),
      movement_type: at(p, ix(col('Вид движения'), fixed.movementType)),
      shop: at(p, ix(col('ПрЦех'), fixed.shop)),
      receipt_material_doc: at(p, ix(col('ДМ поступл'), fixed.receiptMaterialDoc)),
      receipt_material_doc_year: at(p, ix(col('Год ДМ пос'), fixed.receiptMaterialDocYear)),
      sed_doc_id: sedDocId,
      comment: at(p, ix(col('Комментари', 'Комментарий'), fixed.comment)),
    });
  }
  return out;
}

/** Прочитать журнал прогонов выгрузки (новые сверху) для раздела LOG. */
export async function flowImportRunsGet(client: ApiClient, limit?: number): Promise<FlowImportRun[]> {
  const wire = await client.call<{ runs?: FlowImportRun[] }>('flow_import_runs_get', limit ? { limit } : {});
  return Array.isArray(wire.runs) ? wire.runs : [];
}

/** Прогон подгрузки SAP (zm_vl/СЭД) — мониторинг (ТЗ E «видеть, корректно ли передаются данные»). */
export interface FlowSapRun {
  id: number;
  /** 'zmvl' | 'sed' — какой источник тянули. */
  kind: string;
  login: string;
  full_name: string;
  /** 1 — полная выгрузка (zm_vl все); 0 — открытые/частичная. */
  full_load: number;
  started_at: string;
  finished_at: string;
  received: number;
  assigned: number;
  updated: number;
  inserted: number;
  reserved: number;
  total_before: number;
  total_after: number;
  /** 1 — успех, 0 — ошибка (текст в error). */
  ok: number;
  error: string;
}

/** Прочитать журнал прогонов подгрузки SAP (новые сверху) для раздела LOG. */
export async function flowSapRunsGet(client: ApiClient, limit?: number): Promise<FlowSapRun[]> {
  const wire = await client.call<{ runs?: FlowSapRun[] }>('flow_sap_runs_get', limit ? { limit } : {});
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

/** Прогон синхронизации базы МОЛ (SAP HTML → persons). */
export interface FlowMolsRun {
  id: number;
  login: string;
  full_name: string;
  started_at: string;
  finished_at: string;
  received: number;
  mol_before: number;
  mol_after: number;
  new_tabs: string;
  new_count: number;
  ok: number;
  error: string;
}

export async function flowMolsRunsGet(client: ApiClient, limit?: number): Promise<FlowMolsRun[]> {
  const wire = await client.call<{ runs?: FlowMolsRun[] }>('flow_mols_runs_get', limit ? { limit } : {});
  return Array.isArray(wire.runs) ? wire.runs : [];
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

// ── Остатки по складам (flow_stock_wh) ───────────────────────────────────────
// Приложение гонит SAP-макрос остатков (Y_DVK_31000007) СРАЗУ ПОСЛЕ заказов, получает
// TSV С ШАПКОЙ (тех. имена колонок). Делим TSV на строки/колонки БЕЗ смысловой разборки
// и шлём чанками — СМЫСЛОВОЙ маппинг «колонка → склад/материал/кол-во/ЕИ» на сервере
// (тюнится без пересборки EXE). Парсинг здесь — только split по табам/строкам.

export interface FlowStockImportResult {
  /** Тех. имена колонок (шапка) — видно, что реально пришло из SAP. */
  header: string[];
  /** Индексы распознанных полей сервером: { wh, no_num, mat, uom, qty } (−1 = не найдено). */
  map: Record<string, number>;
  /** Сколько строк данных отправлено всего. */
  received: number;
  /** Сколько строк сервер записал (0 если колонки не распознаны — тогда тюним маппинг). */
  inserted: number;
  /** Итоговое число строк в таблице остатков после прогона. */
  total: number;
  /** Записал ли сервер хоть что-то (false при columns_unmapped — см. header/map). */
  stored: boolean;
}

export interface FlowStockRow {
  wh: string;
  no_num: string;
  mat: string;
  uom: string;
  qty: number;
}

/** Размер чанка строк остатков на один запрос (бережём payload/лимиты CF). */
const STOCK_CHUNK = 800;

/**
 * Отправка выгрузки остатков на сервер чанками. `tsv` — сырой вывод макроса (1-я строка =
 * шапка тех. имён колонок). `warehouses` — список складов из файла (для снимка: сервер
 * чистит остатки именно по ним на первом чанке).
 */
export async function flowStockImport(
  client: ApiClient,
  tsv: string,
  warehouses: string[],
): Promise<FlowStockImportResult> {
  const lines = String(tsv ?? '').split(/\r?\n/);
  while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  const header = (lines.shift() ?? '').split('\t');
  const dataRows = lines.map((l) => l.split('\t'));

  const chunks: string[][][] = [];
  for (let i = 0; i < dataRows.length; i += STOCK_CHUNK) chunks.push(dataRows.slice(i, i + STOCK_CHUNK));
  if (chunks.length === 0) chunks.push([]); // пустая выгрузка — всё равно шлём шапку (инспекция)

  let received = 0;
  let inserted = 0;
  let total = 0;
  let map: Record<string, number> = {};
  let stored = false;
  for (let i = 0; i < chunks.length; i += 1) {
    const wire = await client.call<Partial<FlowStockImportResult>>('flow_stock_import', {
      header,
      rows: chunks[i] ?? [],
      first: i === 0,
      last: i === chunks.length - 1,
      warehouses: i === 0 ? warehouses : undefined,
    });
    received += Number(wire.received) || 0;
    inserted += Number(wire.inserted) || 0;
    total = Number(wire.total) || total;
    if (wire.map) map = wire.map;
    if (wire.stored) stored = true;
  }
  return { header, map, received, inserted, total, stored };
}

/** Остатки для набора складов → клиент строит карту наличия для формирования. */
export async function flowStockGet(client: ApiClient, warehouses?: string[]): Promise<FlowStockRow[]> {
  const wire = await client.call<{ rows?: Array<Partial<FlowStockRow>> }>(
    'flow_stock_get',
    warehouses && warehouses.length ? { warehouses } : {},
  );
  return (wire.rows ?? []).map((r) => ({
    wh: String(r.wh ?? ''),
    no_num: String(r.no_num ?? ''),
    mat: String(r.mat ?? ''),
    uom: String(r.uom ?? ''),
    qty: Number(r.qty) || 0,
  }));
}

export interface FlowStockStatus {
  lastAt: string;
  rowsTotal: number;
  warehouses: number;
  header: string[];
  map: Record<string, number>;
  sample: string[][];
  candidates: Record<string, string[]>;
}

/** Последняя живая шапка/маппинг/пример выгрузки остатков — для диагностики/тюнинга колонок. */
export async function flowStockStatus(client: ApiClient): Promise<FlowStockStatus> {
  const wire = await client.call<{
    last_at?: string; rows_total?: number; warehouses?: number;
    header?: string[]; map?: Record<string, number>; sample?: string[][];
    candidates?: Record<string, string[]>;
  }>('flow_stock_status', {});
  return {
    lastAt: wire.last_at ?? '',
    rowsTotal: Number(wire.rows_total) || 0,
    warehouses: Number(wire.warehouses) || 0,
    header: wire.header ?? [],
    map: wire.map ?? {},
    sample: wire.sample ?? [],
    candidates: wire.candidates ?? {},
  };
}
