import type { ApiClient } from '../api/client';
import type { FlowSedRow } from './flow';

/**
 * Раздел «Поток», этап «План» — поставки (flow_deliveries). Модель «якорь +
 * поставки»: отметки/МОЛ/комментарий живут на ЯКОРЕ (позиция формирования,
 * ключ заказ+позиция), поставка — строка отгрузки (ключ поставка+П/П, FK ord+it).
 * Несколько поставок на позицию = несколько строк (частичные/дополнения).
 */
export interface FlowDeliveryRow {
  id: number;
  /** Номер поставки SAP. Пусто — черновик (создан «Сформировать план», ждёт SAP/zm_vl). */
  dlv: string;
  /** П/П — позиция внутри поставки. */
  dlv_pos: string;
  /** Якорь: заказ + позиция (FK на строку формирования). */
  ord: string;
  it: string;
  fr: string;
  to_wh: string;
  /** Уровень дробления на момент сборки (0 — основная). */
  split_level: number;
  /** Группа сборки `fr|to|L<level>` — черновая «поставка» до SAP-номера. */
  grp: string;
  no_num: string;
  mat: string;
  uom: string;
  /** Кол-во в поставке (правится руками → пересчёт KG/V на клиенте). */
  qty: number | null;
  /** День плана YYYY-MM-DD (группировка отчёта). */
  plan_date: string;
  /** Фиксация: 0 — не зафиксирована; batch_seq 1=план, 2+=дополнение. */
  fixation_id: number;
  batch_seq: number;
  /** З.8 FIX-override: ручной ранг фиксации (0=авто по batch_seq; 1=план; 2=доп.1; 3=доп.2…).
   *  Переопределяет живой ранг для ярлыка FIX и группировки экспорта. */
  fix_manual?: number;
  /** № транспортного заказа (№ТрЗкз). */
  trz: string;
  vehicle: string;
  exp1: string;
  exp2: string;
  /** ID — гаражный №/рейс. */
  ride_id: string;
  /** Статус выполнения: '' | 'увезли' | 'не увезли' | 'выполнено' (этап Отчёт; derived из stat). */
  done_stat: string;
  /** Причина невывоза (legacy + derived; при «не увезли»). */
  fail_reason: string;
  /** Иерархический STAT отчёта/плана (верхний уровень справочника). */
  stat?: string;
  /** Подстатус (B1). */
  stat_sub?: string;
  /** STAT NOTE — ручной комментарий к статусу. */
  stat_note?: string;
  /**
   * DAY факт (План/Отчёт) — только ручной; при вставке из буфера = DAY план.
   * YYYY-MM-DD или пусто. В печать не идёт.
   */
  day_fact?: string;
  off_schedule: number;
  /** «Справка» — места хранения с остатком (снимок на момент выгрузки). */
  stock_note: string;
  /** Остаток СУС / ММ (Запас СУС/ММ из zm_vl) — колонки остатков в выгрузке Плана. */
  stock_sus?: number | null;
  stock_mm?: number | null;
  /** Хвост выгрузки Плана (юзер 2026-07-04): ОСТАТ (СвОстЦС) / СПП Остат ЦС / «Складское место» SAP. */
  stock_cs?: number | null;
  spp_cs?: number | null;
  stock_place?: string;
  /** Ручная пастельная заливка строки «RRGGBB» (раскидка по машинам, юзер 2026-07-04);
   *  '' — нет. Идёт и в xlsx-выгрузку (приоритет над цветом машины по гаражному). */
  row_fill?: string;
  /** Кто/когда создал поставку в SAP (из zm_vl). */
  sap_created_by: string;
  sap_created_at: string;
  /** Факт прихода в цех (КолПрихода / Д.проводки) — OTIF/детектор обмана. */
  fact_qty: number | null;
  fact_dt: string;
  /** «На ком документ» (СЭД, на будущее). */
  sed_holder: string;
  /** 1 — в резерве (удалена, скрыта; восстановима до закрытия месяца). */
  reserved: number;
  reserved_at: string;
  /** Кто собрал план / вставил строку (у нас). */
  created_by: string;
  created_at: string;
  row_version: number;
  /** SNAPSHOT при фиксации (ТЗ §3.8): замороженные МОЛ / комментарий / «согласовал» с
   *  якоря на момент «Зафиксировать». Зафиксированная строка (fixation_id>0) читает их,
   *  черновик — живьём с якоря. Пусто у строк, зафиксированных до ввода snapshot. */
  snap_mol: string;
  snap_note: string;
  snap_approved: string;
  /** SNAPSHOT наших полей якоря при фиксации (План=слепок, юзер 2026-07-12):
   *  точка(и) / окно доставки / приоритет / оснастка-выгрузка на момент «Зафиксировать».
   *  Зафикс. строка читает их; черновик — живьём с якоря. Пусто у старых фиксаций. */
  snap_point?: string;
  snap_delivery?: string;
  snap_priority?: string;
  snap_unload?: string;
  /** З.18 заморозка: снап КГ/V на момент фиксации (null/undefined = не заморожено → живой из ВГХ).
   *  Сервер без базы ВГХ — значения шлёт клиент при «Зафиксировать». */
  snap_weight?: number | null;
  snap_volume?: number | null;
  /** SNAPSHOT «склад до» (Был/прежний склад-получатель) — заморожен при фиксации (п.1). */
  snap_pr: string;
  /** SNAPSHOT машины/экспедиторов/гаражного/заливки на момент фиксации (юзер 2026-07-05:
   *  «План — слепок, живые правки Отчёта в него не тянем»). План читает их у зафикс.
   *  строк; Отчёт — живые vehicle/exp1/exp2/ride_id/row_fill. Пусто у старых фиксаций. */
  snap_vehicle?: string;
  snap_exp1?: string;
  snap_exp2?: string;
  snap_ride?: string;
  snap_fill?: string;
  /** Связка строки-переноса с источником (П4): id исходной строки, с которой перенесли. 0 — нет. */
  transfer_src?: number;
  /** СЭД-снимок (сверка ZM_EDM_DOCS): статус движения документа (подписан/отклонен/аннулирован/
   *  на подписании/не передан), на ком сейчас (табель подписанта; ФИО — в sed_holder), даты
   *  запуска/подписания. `sap_open` — поставка есть в zm_vl открытых (целиком не закрыта). */
  sed_status?: string;
  sed_who_tab?: string;
  sed_launch_at?: string;
  sed_signed_at?: string;
  sap_open?: number;
  /** Q — аварийный/особый запас (юзер 2026-07-03; «Особый запас» из SAP-вставки). */
  q_spec?: string;
}

/** Одна правка поставки: id + версия (конфликт) + изменённые поля. */
export interface FlowDeliveryEdit {
  id: number;
  row_version: number;
  fields: Record<string, string | number | null>;
}

/** Прочитать поставки (резервные скрыты). `planDate` — только этот день плана. */
export async function flowDeliveriesGet(
  client: ApiClient,
  params?: { planDate?: string; includeReserved?: boolean },
): Promise<FlowDeliveryRow[]> {
  const wire = await client.call<{ rows?: FlowDeliveryRow[] }>('flow_deliveries_get', {
    plan_date: params?.planDate ?? '',
    include_reserved: params?.includeReserved ?? false,
  });
  return Array.isArray(wire.rows) ? wire.rows : [];
}

/** Применить правки поставок (оптимистик row_version; сервер рассылает `flow_deliveries_changed`). */
export async function flowDeliveriesEdit(
  client: ApiClient,
  edits: FlowDeliveryEdit[],
): Promise<{ applied: number[]; conflicts: number[]; rows: FlowDeliveryRow[] }> {
  const wire = await client.call<{ applied?: number[]; conflicts?: number[]; rows?: FlowDeliveryRow[] }>(
    'flow_deliveries_edit',
    { edits },
  );
  return {
    applied: Array.isArray(wire.applied) ? wire.applied : [],
    conflicts: Array.isArray(wire.conflicts) ? wire.conflicts : [],
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}

/** «Удалить» поставки = РЕЗЕРВ (скрыть, не стирать) — позиции вернутся в формирование. */
export async function flowDeliveriesDelete(client: ApiClient, ids: number[]): Promise<number[]> {
  const wire = await client.call<{ deleted?: number[] }>('flow_deliveries_delete', { ids });
  return Array.isArray(wire.deleted) ? wire.deleted : [];
}

/**
 * Перенос «на другой день» (В1, юзер 2026-07-02 — через Формирование). ДО фиксации —
 * двигаем plan_date черновика; ПОСЛЕ фиксации — строка Отчёта сереет «перенос…», а
 * позиция возвращается в Формирование с DAY = дата переноса. Копий не создаём: в План
 * позиция уйдёт по «Сформировать план» (наследуя живую поставку эпизода).
 * keepDlv=false — «позиция удалена из поставки»: наследования номера не будет.
 * Дата — только сегодня/будущее (`date_in_past`).
 */
export async function flowTransfer(
  client: ApiClient,
  ids: number[],
  toDate: string,
  keepDlv = true,
  opts?: { stat?: string; stat_sub?: string },
): Promise<{ transferred: number; rows: FlowDeliveryRow[] }> {
  const wire = await client.call<{ transferred?: number; rows?: FlowDeliveryRow[] }>('flow_transfer', {
    ids,
    to_date: toDate,
    keep_dlv: keepDlv,
    ...(opts?.stat ? { stat: opts.stat } : {}),
    ...(opts?.stat_sub ? { stat_sub: opts.stat_sub } : {}),
  });
  return {
    transferred: Number(wire.transferred) || 0,
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}

/** Итог «Сформировать план» на день. */
export interface FlowPlanFormResult {
  date: string;
  /** Создано черновых поставок (строк). */
  created: number;
  /** Сколько отдельных поставок получится (групп отправитель+получатель+уровень). */
  groups: number;
  /** Пропущено: позиция уже в плане (активная поставка есть). */
  skippedActive: number;
  /** Пропущено: нет сцепки ключа заказ+позиция. */
  noKey: number;
}

/**
 * «Зафиксировать» план на день: замораживает состав (первая фиксация даты =
 * батч 1 «план», повторные = 2+ «дополнение»). После — свободны только
 * машина/экспедиторы/ID и отметки отчёта. Ошибка `nothing_to_fix` — на дате
 * нет незафиксированных строк.
 */
export async function flowPlanFix(
  client: ApiClient,
  date: string,
  // З.18: снап КГ/V по id фиксируемой строки (сервер без базы ВГХ — считает клиент).
  snaps?: Record<number, { w: number; v: number }>,
): Promise<{ fixationId: number; batchSeq: number; fixed: number }> {
  const wire = await client.call<{ fixation_id?: number; batch_seq?: number; fixed?: number }>(
    'flow_plan_fix',
    snaps && Object.keys(snaps).length > 0 ? { date, snaps } : { date },
  );
  return {
    fixationId: Number(wire.fixation_id) || 0,
    batchSeq: Number(wire.batch_seq) || 0,
    fixed: Number(wire.fixed) || 0,
  };
}

/**
 * «Сформировать план»: собрать строки формирования с day_wk = date → черновые
 * поставки (группировка отправитель+получатель+уровень). Дата — только сегодня
 * или будущее; ошибки: `invalid_date` / `date_in_past`.
 */
export async function flowPlanForm(client: ApiClient, date: string): Promise<FlowPlanFormResult> {
  const wire = await client.call<{
    date?: string; created?: number; groups?: number; skipped_active?: number; no_key?: number;
  }>('flow_plan_form', { date });
  return {
    date: wire.date ?? date,
    created: Number(wire.created) || 0,
    groups: Number(wire.groups) || 0,
    skippedActive: Number(wire.skipped_active) || 0,
    noKey: Number(wire.no_key) || 0,
  };
}

/**
 * Дискретное событие истории позиции по якорю (заказ+позиция). Immutable журнал
 * движения ТМЦ (модель «якорь ord|it + эпизод dlv|dlv_pos»): смена статуса, возврат,
 * перенос, удаление-резерв, конфликт zm_vl. Эпизоды (строки поставок) дают остальное.
 */
export interface FlowDeliveryEvent {
  id: number;
  anchor_ord: string;
  anchor_it: string;
  delivery_id: number | null;
  dlv: string;
  dlv_pos: string;
  /** plan_form|fix|status_set|transfer_out|transfer_in|delete_reserve|zmvl_missing_reserve|… */
  event_kind: string;
  plan_date: string;
  qty: number | null;
  done_stat: string;
  fail_reason: string;
  vehicle: string;
  ride_id: string;
  expeditors: string;
  snap_mol: string;
  snap_approved: string;
  request: string;
  login: string;
  full_name: string;
  created_at: string;
  /** Доп. данные шага (для sed_step: { kind:'launch'|'sign'|'restart'|'wait', tab, seq }). */
  payload_json?: string;
}

/** Поля ручного добавления строки поставки (план/отчёт). Все, кроме target/planDate, опциональны. */
export interface FlowDeliveryAddInput {
  target: 'plan' | 'report';
  planDate: string;
  ord?: string;
  it?: string;
  fr?: string;
  to_wh?: string;
  no_num?: string;
  mat?: string;
  uom?: string;
  qty?: number | null;
  dlv?: string;
  dlv_pos?: string;
  /** МОЛ/комментарий ручной строки (юзер 2026-07-02): выбрать из списка склада или
   *  вписать свой; пусто + есть заказ+позиция → подтянется с формирования. */
  mol?: string;
  note?: string;
}

/**
 * Ручное добавление строки поставки (юзер 2026-06-15): created_by='manual:…' — её можно
 * удалять и править МОЛ/комментарий (не «железная база»). `target='report'` требует уже
 * зафиксированного дня (иначе `no_report_for_day`); `target='plan'` — дата сегодня/будущее.
 */
export async function flowDeliveryAdd(
  client: ApiClient,
  input: FlowDeliveryAddInput,
): Promise<{ id: number | null; fixationId: number; rows: FlowDeliveryRow[] }> {
  const wire = await client.call<{ id?: number; fixation_id?: number; rows?: FlowDeliveryRow[] }>(
    'flow_delivery_add',
    {
      target: input.target,
      plan_date: input.planDate,
      ord: input.ord ?? '',
      it: input.it ?? '',
      fr: input.fr ?? '',
      to_wh: input.to_wh ?? '',
      no_num: input.no_num ?? '',
      mat: input.mat ?? '',
      uom: input.uom ?? '',
      qty: input.qty ?? null,
      dlv: input.dlv ?? '',
      dlv_pos: input.dlv_pos ?? '',
      mol: input.mol ?? '',
      note: input.note ?? '',
    },
  );
  return {
    id: wire.id ?? null,
    fixationId: Number(wire.fixation_id) || 0,
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}

/**
 * История позиции по якорю: эпизоды (все строки поставок, включая резерв) + дискретные
 * события. Для карточки/колонки ИСТОРИЯ в Формировании (как в Транспорте). Вызывается
 * по требованию (открытие карточки) — не polling.
 */
export async function flowDeliveryEventsGet(
  client: ApiClient,
  ord: string,
  it: string,
): Promise<{ episodes: FlowDeliveryRow[]; events: FlowDeliveryEvent[] }> {
  const wire = await client.call<{ episodes?: FlowDeliveryRow[]; events?: FlowDeliveryEvent[] }>(
    'flow_delivery_events_get',
    { ord, it },
  );
  return {
    episodes: Array.isArray(wire.episodes) ? wire.episodes : [],
    events: Array.isArray(wire.events) ? wire.events : [],
  };
}

/**
 * Сверка СЭД (ZM_EDM_DOCS): клиент парсит выгрузку (`parseSedTsv`) → сервер считает статус движения
 * документа по каждой поставке (последний запуск, «время согл = подписано», дедуп повторов) и пишет
 * снимок (sed_status/holder/launch/signed) + события истории. Возвращает сводку прогона.
 */
export async function flowSedReconcile(
  client: ApiClient,
  rows: FlowSedRow[],
): Promise<{ received: number; docs: number; updated: number; events: number }> {
  const wire = await client.call<{ received?: number; docs?: number; updated?: number; events?: number }>(
    'flow_sed_reconcile',
    { rows },
  );
  return {
    received: Number(wire.received) || 0,
    docs: Number(wire.docs) || 0,
    updated: Number(wire.updated) || 0,
    events: Number(wire.events) || 0,
  };
}

// ============================================================
// Вставка/приём строк плана «до AL» (В2/В7, юзер 2026-07-02).
// ============================================================
// Один формат на два источника: результат макроса «Создание поставок» (ZM_VL grid)
// и ручная вставка из буфера (юзер копирует те же строки из SAP/Excel). ~38 колонок
// (A..AL), без заголовка, много пустых служебных. Числа оставляем СТРОКАМИ — сервер
// парсит своим zmNum («2.000,000» = 2000, «22.400» = 22.4 — точки НЕ тысячи, если
// нет запятой). Даты первой колонки — американские M/D/YY (так копирует ALV).

/** Строка вставки плана (сырьё «до AL», числа строками). */
export interface FlowPlanPasteRow {
  /** Всегда пусто (юзер 2026-07-02: дата первой колонки буфера — МУСОР для плана;
   *  строки встают на выбранный день / сегодня). Поле оставлено для совместимости. */
  plan_date: string;
  fr: string;
  to_wh: string;
  dlv: string;
  dlv_pos: string;
  trz: string;
  no_num: string;
  mat: string;
  uom: string;
  qty: string;
  ord: string;
  it: string;
  sap_created_by: string;
  sap_created_at: string;
  stock_note: string;
  /** «Запас ММ» (legacy, поглощён stock_vals). */
  stock_mm: string;
  /** НАЛИЧИЕ (юзер 2026-07-03): 5 колонок запасов буфера — Запас ММ (AB) / Запас СУС (AD) /
   *  Запас СМ1 (AH) / СМ2 (AJ) / СМ3 (AL), строками. ВСЕ нули/пусто → сервер пишет
   *  «нет на <дата создания>»; хоть одна > 0 → наличие есть. Пустой массив = неизвестно. */
  stock_vals: string[];
  /** Хвост xlsx-плана из буфера (юзер 2026-07-04, «данные уже есть — тянуть сразу»):
   *  ОСТАТ = СвОстЦС (V=21) / Запас СУС (AD=29) / СПП Ост ЦС (AC=28) / Склад место (AE=30). */
  stock_cs: string;
  stock_sus: string;
  spp_cs: string;
  stock_place: string;
  /** Q — аварийный/особый запас (кол. «Особый запас», K буфера). */
  q_spec: string;
}

/** M/D/YY|M/D/YYYY (ALV-копия, американский порядок) или DD.MM.YYYY → ISO ('' если нет). */
function planPasteDate(raw: string): string {
  const s = String(raw ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = (m[3] ?? '').length === 2 ? `20${m[3]}` : m[3] ?? '';
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (m) {
    const y = (m[3] ?? '').length === 2 ? `20${m[3]}` : m[3] ?? '';
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return '';
}

/** «10:53:58 AM»/«4:30:29 PM»/«14:30:29» → «HH:MM:SS» ('' если нечитаемо). */
function planPasteTime(raw: string): string {
  const s = String(raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const ap = (m[4] ?? '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

/** Колонки формата «до AL» (0-based, по живому образцу юзера 2026-07-02 + шапке SAP:
 *  Дата·…·Отп_Склад·Пол_Склад·…·Поставка·Позиция·ТЗ·…·Материал·Наименование·ЕИ·Объём
 *  поставки·…·СвОстЦС·НомЗаказа·ПозЗаказа·Создал·Дата создания·Время·Запас ММ·…места). */
const PP = {
  date: 0, fr: 2, to: 3, dlv: 6, dlvPos: 7, trz: 8, qSpec: 10,
  noNum: 11, mat: 12, uom: 13, qty: 14,
  ostat: 21, // СвОстЦС → ОСТАТ (хвост xlsx-плана)
  ord: 22, it: 23, createdBy: 24, createdDate: 25, createdTime: 26,
  stockMm: 27, spp: 28, stockSus: 29,
  place1: 30, place1Qty: 31, place2: 32,
} as const;
/** Колонки НАЛИЧИЯ (юзер 2026-07-03): Запас ММ (AB=27), Запас СУС (AD=29),
 *  Запас СМ1 (AH=33), Запас СМ2 (AJ=35), Запас СМ3 (AL=37). */
const PP_STOCKS = [27, 29, 33, 35, 37] as const;

/**
 * Разобрать TSV «до AL» (вставка из буфера ИЛИ вывод макроса создания поставок).
 * Строка валидна, если есть номер поставки или заказа (цифры). Заголовки/мусор
 * пропускаются. Места хранения → stock_note (место с запасом приоритетно).
 */
export function parsePlanPasteTsv(text: string): FlowPlanPasteRow[] {
  const out: FlowPlanPasteRow[] = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = line.split('\t').map((v) => String(v ?? '').trim());
    if (c.length < PP.it + 1) continue; // слишком узкая строка — не наш формат
    const dlv = /^\d+$/.test(c[PP.dlv] ?? '') ? (c[PP.dlv] as string) : '';
    const ord = /^\d+$/.test(c[PP.ord] ?? '') ? (c[PP.ord] as string) : '';
    if (!dlv && !ord) continue; // заголовок/мусор
    const createdDate = planPasteDate(c[PP.createdDate] ?? '');
    const createdTime = planPasteTime(c[PP.createdTime] ?? '');
    const stockNote = (c[PP.place1Qty] || c[PP.place1] || c[PP.place2] || '').trim();
    out.push({
      // Дату первой колонки НЕ читаем (мусор): строки встают на выбранный день плана.
      plan_date: '',
      fr: c[PP.fr] ?? '',
      to_wh: c[PP.to] ?? '',
      dlv,
      dlv_pos: c[PP.dlvPos] ?? '',
      trz: c[PP.trz] ?? '',
      no_num: c[PP.noNum] ?? '',
      mat: c[PP.mat] ?? '',
      uom: c[PP.uom] ?? '',
      qty: c[PP.qty] ?? '',
      ord,
      it: c[PP.it] ?? '',
      sap_created_by: c[PP.createdBy] ?? '',
      sap_created_at: createdDate ? `${createdDate} ${createdTime || '00:00:00'}` : '',
      stock_note: stockNote,
      // '' = колонки нет в буфере (наличие неизвестно); пустая ячейка = запаса нет → '0'.
      stock_mm: c.length > PP.stockMm ? (c[PP.stockMm] ?? '').trim() || '0' : '',
      // Все 5 колонок запасов (наличие); недоступные в короткой строке пропускаются.
      stock_vals: PP_STOCKS.filter((i) => c.length > i).map((i) => (c[i] ?? '').trim() || '0'),
      // Хвост xlsx-плана — сразу из буфера (юзер 2026-07-04), не ждём zm_vl-сверку.
      stock_cs: c[PP.ostat] ?? '',
      stock_sus: c[PP.stockSus] ?? '',
      spp_cs: c[PP.spp] ?? '',
      stock_place: c[PP.place1] ?? '',
      q_spec: c[PP.qSpec] ?? '',
    });
  }
  return out;
}

/** Итог приёма строк плана. */
export interface FlowPlanRowsApplyResult {
  received: number;
  /** Черновиков получило номер SAP («поставка создана»). */
  assigned: number;
  /** Существующих номерных строк обновлено (служебные поля). */
  updated: number;
  /** Вставлено новых строк плана. */
  inserted: number;
  /** id вставленных строк — для отмены вставки (undo). */
  insertedIds: number[];
  /** Точные дубли (ключ+поставка+qty) — не вставляли. */
  skippedDup: number;
}

/**
 * Отправить разобранные строки «до AL» серверу: матч черновиков по заказ+позиция
 * (присвоение номера), обновление существующих по поставка+П/П (без клоббера ручного),
 * остальное — вставка новыми строками (ниже текущих).
 * target='report' (юзер 2026-07-02): строки встают сразу в ОТЧЁТ своей даты (цепляются
 * к фиксации дня, при отсутствии создаётся), МОЛ/коммент/согласовал подтягиваются
 * с якоря формирования в snap_*.
 */
export async function flowPlanRowsApply(
  client: ApiClient,
  rows: FlowPlanPasteRow[],
  opts?: { planDate?: string; source?: 'macro' | 'paste'; target?: 'plan' | 'report' },
): Promise<FlowPlanRowsApplyResult> {
  const wire = await client.call<{
    received?: number; assigned?: number; updated?: number; inserted?: number;
    inserted_ids?: number[]; skipped_dup?: number;
  }>(
    'flow_plan_rows_apply',
    { rows, plan_date: opts?.planDate, source: opts?.source ?? 'paste', target: opts?.target ?? 'plan' },
  );
  return {
    received: Number(wire.received) || 0,
    assigned: Number(wire.assigned) || 0,
    updated: Number(wire.updated) || 0,
    inserted: Number(wire.inserted) || 0,
    insertedIds: Array.isArray(wire.inserted_ids) ? wire.inserted_ids.map(Number).filter(Number.isFinite) : [],
    skippedDup: Number(wire.skipped_dup) || 0,
  };
}

// ── Формат «Плана .xlsx» — СЕРВЕРНЫЙ (юзер 2026-07-02) ───────────────────────
// Раскладка выгрузки (колонки/заголовки/титулы/порядок складов сортировки) живёт на
// сервере: правки формата — без обновления приложения. Клиент тянет её перед выгрузкой
// и падает обратно на встроенный дефолт, если сервер недоступен.

export interface FlowXlsxColumn {
  /** id данных строки: request/fr/to/pr/clst/graph/fix/dlvord/dlv/dlv_pos/trz/mol/q/
   *  no_num/mat/uom/qty/kg/v/note/exp/vehicle_type/garage/stock_note. */
  id: string;
  head: string;
  width: number;
  /** Пресет оформления (эталон): text/text-r/text12-r/bold12-r/bold12-r-wrap/wrap12/
   *  wrap10/mol/num3/kgv/bold10. Пусто — по id. */
  style?: string;
}
export interface FlowXlsxLayout {
  plan: {
    columns: FlowXlsxColumn[];
    /** Шаблон заголовка «Наименования» с датой плана (эталон M1): '{DD} {MONTH} Наименование {YYYY}'. */
    matHead?: string;
    title?: string; // legacy (титул-строка не используется)
  };
  rest: { columns: FlowXlsxColumn[]; title?: string };
  /** Порядок специальных складов-отправителей сортировки APLAN. */
  special_fr?: string[];
}

/** Раскладка выгрузки с сервера; null — не получили (клиент возьмёт встроенный дефолт). */
export async function flowXlsxLayoutGet(client: ApiClient): Promise<FlowXlsxLayout | null> {
  try {
    const wire = await client.call<{ ok?: boolean; layout?: FlowXlsxLayout }>('flow_xlsx_layout_get', {});
    const l = wire.layout;
    if (!l || !Array.isArray(l.plan?.columns) || !Array.isArray(l.rest?.columns)) return null;
    return l;
  } catch {
    return null;
  }
}
