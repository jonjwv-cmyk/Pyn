import type { ApiClient } from '../api/client';
import type { ApiCallOptions } from '../api/transport';

/**
 * Раздел «Поток», вкладка «Транспорт» — реестр «машина на день» (эталон — лист 🚚).
 * База машин (`flow_vehicles`, ключ ГАРАЖНЫЙ №) + строки дня (`flow_transport`).
 * Вставка из буфера (шаблон выгрузки как есть) наполняет обе; показ «без мусора» —
 * расчётные колонки (тн/габариты в метрах/ВЫЕЗД/формат телефона) клиент считает
 * сам из базы машин.
 */
export interface FlowVehicle {
  /** Гаражный № — ключ машины (371, 5114…); он же ID для колонки ID плана. */
  garage_no: string;
  color: string;
  vtype: string;
  model: string;
  gos_no: string;
  /** ДОП. ТН из 1С, кг. Справочно, не наша расчётная грузоподъёмность. */
  max_mass_kg: number | null;
  /** ТН (ГРУЗОП.) из 1С, кг. Справочно, не наша расчётная грузоподъёмность. */
  capacity_kg: number | null;
  /** Габариты кузова, мм (показ в метрах). */
  len_mm: number | null;
  wid_mm: number | null;
  hei_mm: number | null;
  /** Запрет выезда (1=Да → колонка ВЫЕЗД показывает НЕТ). */
  ban: number;
  /** Водитель по умолчанию (ФИО) + сот. (raw, формат на показе). */
  driver: string;
  driver_phone: string;
  note: string;
  updated_by: string;
  updated_at: string;
  row_version: number;
}

/** Строка «машина на день». */
export interface FlowTransportRow {
  id: number;
  /** День YYYY-MM-DD. */
  tdate: string;
  garage_no: string;
  /** РАБОТА/задание («1.1. Технология КЦ»; «0.*» — постоянные наши машины). */
  work: string;
  /** ⏰ «08:00-20:00». */
  time_range: string;
  /**
   * Жирное ВРЕМЯ: 0/1. Авто при вставке (неполная дневная 1.2/2.n/3.n),
   * дальше только кнопка вручную (ТЗ 17.07 п.11).
   */
  time_bold?: number;
  /** '' | Новый | Открыт | Отклонен | Отмена | Размещен (строго как в эталоне). */
  status: string;
  comment: string;
  /** Водитель НА ДЕНЬ (из выгрузки/машины; правится). */
  driver: string;
  driver_phone: string;
  expeditors: string;
  ot: string;
  sp: string;
  /** Заказ (НТ000…), может быть пуст. */
  order_no: string;
  /** Ручная колонка ВЫЕЗД: '' | ДА | НЕТ. Не заполняется из буфера. */
  out_status: string;
  /** БЕЗ ЭКСП.: '' | ДА | НЕТ (только приложение). */
  no_exp_status: string;
  /** Свой ТИП ТС на день: Фургон КХП / Борт / Пульман 9м / ... */
  vehicle_type: string;
  /** Факт начало/конец работы машины, HH:MM без ведущего нуля на показе. */
  fact_start: string;
  fact_end: string;
  /** JSON массива форс-мажоров [{reason,start,end,comment}]. */
  force_json: string;
  created_by: string;
  created_at: string;
  row_version: number;
}

/** Допустимые статусы строки (выпадашка эталона). */
export const FLOW_TRANSPORT_STATUSES = ['Новый', 'Открыт', 'Отклонен', 'Отмена', 'Размещен'] as const;

/** Строка вставки из буфера (разобранный шаблон) — поля машины + поля дня. */
export interface FlowTransportPasteRow {
  tdate: string;
  garage_no: string;
  color: string;
  vtype: string;
  model: string;
  gos_no: string;
  max_mass_kg: string;
  capacity_kg: string;
  len_mm: string;
  wid_mm: string;
  hei_mm: string;
  ban: number;
  work: string;
  time_range: string;
  /** 0/1 — клиент считает при вставке (неполная дневная смена). */
  time_bold?: number;
  status: string;
  comment: string;
  driver: string;
  driver_phone: string;
  expeditors: string;
  ot: string;
  sp: string;
  order_no: string;
  out_status?: string;
  no_exp_status?: string;
  vehicle_type?: string;
  fact_start?: string;
  fact_end?: string;
  force_json?: string;
}

/** «08.06.2026» / «2026-06-08» / с временем → 'YYYY-MM-DD'. Пусто — не дата. */
function parseRuDate(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return '';
}

const T = (v: unknown) => String(v == null ? '' : v).trim();

/** Гаражный № в ячейке (без пробелов). */
function looksGarageNo(raw: string): boolean {
  const s = T(raw).replace(/\s+/g, '');
  return /^\d{1,5}$/.test(s);
}

/** Полный шаблон (29 кол.) или укороченный без формульного блока (24 кол.). */
type TransportPasteLayout = 'full' | 'short';

function detectTransportPasteLayout(parts: string[]): TransportPasteLayout | null {
  if (!parseRuDate(parts[0] ?? '')) return null;
  if (parts.length >= 10 && looksGarageNo(parts[9] ?? '')) return 'full';
  if (parts.length >= 5 && looksGarageNo(parts[4] ?? '')) return 'short';
  return null;
}

/** Индексы полей вставки (без заголовка). */
const PASTE_IDX = {
  full: {
    garage: 9, gos: 11, work: 12, time: 13, status: 14, comment: 15, driver: 16,
    phoneFmt: 17, exp: 18, ot: 19, sp: 20, order: 21, maxMass: 22, capacity: 23,
    len: 24, wid: 25, hei: 26, ban: 27, phoneRaw: 28,
  },
  // Без формульных колонок 4–8 (доп.тн/тн/Д/Ш/В) — типичная копия «как есть».
  short: {
    garage: 4, gos: 6, work: 7, time: 8, status: 9, comment: 10, driver: 11,
    phoneFmt: 12, exp: 13, ot: 14, sp: 15, order: 16, maxMass: 17, capacity: 18,
    len: 19, wid: 20, hei: 21, ban: 22, phoneRaw: 23,
  },
} as const;

function pick(parts: string[], idx: number): string {
  return idx >= 0 && idx < parts.length ? T(parts[idx]) : '';
}

function parsePasteNumber(raw: string): number | null {
  const s = T(raw).replace(/\s+/g, '').replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Габарит в мм из сырой ячейки; отсекаем массы/мусор. */
function parsePasteDimMm(raw: string, kind: 'len' | 'wid' | 'hei'): string {
  const n = parsePasteNumber(raw);
  if (n == null) return '';
  const ranges = {
    len: [2500, 25000],
    wid: [1400, 3600],
    hei: [120, 6000],
  } as const;
  const [lo, hi] = ranges[kind];
  if (n < lo || n > hi) return '';
  return String(Math.round(n));
}

type PasteFieldIdx = { len: number; wid: number; hei: number };

function parsePasteDims(parts: string[], idx: PasteFieldIdx): { len_mm: string; wid_mm: string; hei_mm: string } {
  const len = parsePasteDimMm(pick(parts, idx.len), 'len');
  const wid = parsePasteDimMm(pick(parts, idx.wid), 'wid');
  const hei = parsePasteDimMm(pick(parts, idx.hei), 'hei');
  // Частично заполненный хвост (Excel обрезал пустые) — не тянем capacity в «длину».
  if (!len && (pick(parts, idx.wid) || pick(parts, idx.hei))) return { len_mm: '', wid_mm: wid, hei_mm: hei };
  return { len_mm: len, wid_mm: wid, hei_mm: hei };
}

function parseTransportPasteRow(parts: string[], layout: TransportPasteLayout): FlowTransportPasteRow | null {
  const idx = PASTE_IDX[layout];
  const tdate = parseRuDate(parts[0] ?? '');
  if (!tdate) return null;
  const garage = pick(parts, idx.garage);
  const work = pick(parts, idx.work);
  if (!garage && !work) return null;
  const dims = parsePasteDims(parts, idx);
  const banRaw = pick(parts, idx.ban).toLowerCase();
  return {
    tdate,
    garage_no: garage,
    color: pick(parts, 1),
    vtype: pick(parts, 2),
    model: pick(parts, 3),
    gos_no: pick(parts, idx.gos),
    max_mass_kg: pick(parts, idx.maxMass),
    capacity_kg: pick(parts, idx.capacity),
    ...dims,
    ban: banRaw.startsWith('да') ? 1 : 0,
    work,
    time_range: pick(parts, idx.time),
    status: pick(parts, idx.status),
    comment: pick(parts, idx.comment),
    driver: pick(parts, idx.driver),
    driver_phone: pick(parts, idx.phoneRaw) || pick(parts, idx.phoneFmt),
    expeditors: pick(parts, idx.exp),
    ot: pick(parts, idx.ot),
    sp: pick(parts, idx.sp),
    order_no: pick(parts, idx.order),
  };
}

/**
 * Разобрать вставку из буфера — шаблон листа 🚚 (TSV, без заголовка):
 * полный 29 кол. или укороченный 24 кол. (без формульного блока 4–8).
 * Сырые габариты мм — только из хвоста; пустые в буфере = «нет данных» (сброс
 * старых неверных значений на сервере). Строки без даты пропускаем.
 */
export function parseTransportPaste(tsv: string): FlowTransportPasteRow[] {
  const out: FlowTransportPasteRow[] = [];
  let layout: TransportPasteLayout | null = null;
  for (const raw of String(tsv ?? '').split(/\r?\n/)) {
    if (!T(raw)) continue;
    const parts = raw.split('\t').map((x) => x.trim());
    const rowLayout: TransportPasteLayout | null = layout ?? detectTransportPasteLayout(parts);
    if (!rowLayout) continue;
    layout = rowLayout;
    const row = parseTransportPasteRow(parts, rowLayout);
    if (row) out.push(row);
  }
  return out;
}

// ── Спец-вставка из 1С (заголовки → наши колонки) ────────────────────────────

/** Нормализованный ключ заголовка: lower, без NBSP/точек/скобок, схлопнутые пробелы. */
function normHeaderKey(raw: string): string {
  return T(raw)
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[.\u2026()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «17.07.2026 8:00:00» / «17.07.2026 8:00» → { date: YYYY-MM-DD, hm: H:MM }. */
function parse1cDateTime(raw: string): { date: string; hm: string } {
  const s = T(raw).replace(/\u00a0/g, ' ');
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(s)
    ?? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(s);
  if (!m) return { date: '', hm: '' };
  let date = '';
  let hh = '';
  let mm = '';
  if (m[0].includes('-') && /^\d{4}/.test(m[0])) {
    date = `${m[1]}-${m[2]}-${m[3]}`;
    hh = m[4] ?? '';
    mm = m[5] ?? '';
  } else {
    date = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    hh = m[4] ?? '';
    mm = m[5] ?? '';
  }
  if (!hh) return { date, hm: '' };
  return { date, hm: `${Number(hh)}:${mm}` };
}

/** Пятница: конец 17:00 → 15:45 (норма смены на комбинате). */
function normalizeFridayEndHm(tdate: string, endHm: string): string {
  if (!tdate || !endHm) return endHm;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tdate);
  if (!dm) return endHm;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  // JS: 0=Вс … 5=Пт. Полдень UTC-safe: Date.UTC.
  const dow = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
  if (dow !== 5) return endHm;
  const m = /^(\d{1,2}):(\d{2})$/.exec(endHm.trim());
  if (!m) return endHm;
  if (Number(m[1]) === 17 && Number(m[2]) === 0) return '15:45';
  return endHm;
}

/**
 * Признак спец-вставки 1С: в первой непустой строке есть колонка «Статус»
 * (в обычном шаблоне 🚚 заголовков нет; «Статус» в шапке 1С — маркер).
 */
export function isTransport1cPaste(tsv: string): boolean {
  for (const raw of String(tsv ?? '').split(/\r?\n/)) {
    if (!T(raw)) continue;
    const parts = raw.split('\t').map((x) => normHeaderKey(x));
    const hasStatus = parts.some((h) => h === 'статус' || h.startsWith('статус '));
    const hasDepart = parts.some((h) => h === 'отправление' || h.startsWith('отправление'));
    const hasArrive = parts.some((h) => h === 'прибытие' || h.startsWith('прибытие'));
    const hasNumber = parts.some((h) => h === 'номер');
    return hasStatus && (hasDepart || hasArrive || hasNumber);
  }
  return false;
}

/**
 * Спец-вставка из 1С: маппинг ПО ЗАГОЛОВКАМ.
 *   Номер → ЗАКАЗ; Статус → Статус; Комментарий → РАБОТА;
 *   Отправление → ДАТА + начало ВРЕМЯ; Прибытие → конец ВРЕМЯ;
 *   Треб. ТС (тип) → ТИП ТС; Гос номер → gos (если есть).
 * Лишние колонки игнорируются. Пятница 17:00 → 15:45.
 */
export function parseTransport1cPaste(tsv: string): FlowTransportPasteRow[] {
  const lines = String(tsv ?? '').split(/\r?\n/).filter((l) => T(l));
  if (lines.length < 2) return [];
  const headerParts = (lines[0] ?? '').split('\t').map((x) => x.trim());
  const keys = headerParts.map(normHeaderKey);
  const idxOf = (...cands: string[]): number => {
    for (const c of cands) {
      const i = keys.findIndex((h) => h === c || h.startsWith(`${c} `));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iOrder = idxOf('номер');
  const iStatus = idxOf('статус');
  const iWork = idxOf('комментарий');
  const iDepart = idxOf('отправление');
  const iArrive = idxOf('прибытие');
  if (iStatus < 0) return [];
  // «Треб. ТС (тип)» и «Гос номер» — 1С-шные, НЕ наши: ТИП ТС/gos_no остаются
  // своими (наследуются на сервере), 1С-текст в них не льём (юзер 2026-08-02).

  const out: FlowTransportPasteRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const parts = (lines[li] ?? '').split('\t').map((x) => x.trim());
    if (parts.every((p) => !T(p))) continue;
    const order = iOrder >= 0 ? pick(parts, iOrder) : '';
    const status = iStatus >= 0 ? pick(parts, iStatus) : '';
    const work = iWork >= 0 ? pick(parts, iWork) : '';
    const dep = parse1cDateTime(iDepart >= 0 ? pick(parts, iDepart) : '');
    const arr = parse1cDateTime(iArrive >= 0 ? pick(parts, iArrive) : '');
    const tdate = dep.date || arr.date;
    if (!tdate) continue;
    if (!order && !work && !status) continue;
    let endHm = arr.hm;
    endHm = normalizeFridayEndHm(tdate, endHm);
    const startHm = dep.hm;
    const time_range = startHm && endHm ? `${startHm}-${endHm}` : startHm || endHm || '';
    // Факт нач/кон — только для Размещён/Дополнение (юзер 2026-08-02); для
    // Отклонён/Отмена/Открыт и т.д. остаются пустыми (план виден, факт — нет).
    const factApplies = status === 'Размещен' || status === 'Дополнение';
    const factParts = factApplies
      ? [...time_range.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${Number(m[1])}:${m[2]}`)
      : [];
    out.push({
      tdate,
      garage_no: '',
      color: '',
      vtype: '',
      model: '',
      gos_no: '',
      max_mass_kg: '',
      capacity_kg: '',
      len_mm: '',
      wid_mm: '',
      hei_mm: '',
      ban: 0,
      work,
      time_range,
      status,
      comment: '',
      driver: '',
      driver_phone: '',
      expeditors: '',
      ot: '',
      sp: '',
      order_no: order,
      fact_start: factParts[0] || '',
      fact_end: factParts[1] || '',
    });
  }
  return out;
}

/** Вся база машин. */
export async function flowVehiclesGet(client: ApiClient): Promise<FlowVehicle[]> {
  const wire = await client.call<{ rows?: FlowVehicle[] }>('flow_vehicles_get', {});
  return Array.isArray(wire.rows) ? wire.rows : [];
}

/** Карточка машины (создание/правка; пустые значения затирают — явная правка). */
export async function flowVehiclesUpsert(
  client: ApiClient,
  vehicle: Partial<FlowVehicle> & { garage_no: string },
): Promise<FlowVehicle | null> {
  const wire = await client.call<{ vehicle?: FlowVehicle }>('flow_vehicles_upsert', { vehicle });
  return wire.vehicle ?? null;
}

/** Строки транспорта (все или один день). Без date — вся база (~3k строк), нужен увеличенный timeout. */
export async function flowTransportGet(
  client: ApiClient,
  date?: string,
  opts?: ApiCallOptions,
): Promise<FlowTransportRow[]> {
  const wire = await client.call<{ rows?: FlowTransportRow[] }>(
    'flow_transport_get',
    date ? { date } : {},
    opts ?? (date ? undefined : { timeoutMs: 120_000 }),
  );
  return Array.isArray(wire.rows) ? wire.rows : [];
}

export interface FlowTransportPasteResult {
  inserted: number;
  updated: number;
  /** Авто-добавленные «0.*»-строки (постоянные машины) на новые даты. */
  autoAdded: number;
  vehicles: number;
  dates: string[];
  /** ID вставленных НОВЫХ строк (для «отменить вставку» — удалить их обратно). */
  insertedIds: number[];
}

/** Режим вставки: `template` — лист 🚚 (статус → Размещен); `1c` — спец-вставка 1С (статус из буфера). */
export type FlowTransportPasteMode = 'template' | '1c';

/** Вставка из буфера: upsert машин + строки дня (повтор того же дня не дублирует). */
export async function flowTransportPaste(
  client: ApiClient,
  rows: FlowTransportPasteRow[],
  opts?: { mode?: FlowTransportPasteMode },
): Promise<FlowTransportPasteResult> {
  const mode: FlowTransportPasteMode = opts?.mode === '1c' ? '1c' : 'template';
  const wire = await client.call<{
    inserted?: number; updated?: number; auto_added?: number; vehicles?: number; dates?: string[];
    inserted_ids?: number[];
  }>('flow_transport_paste', { rows, mode });
  return {
    inserted: Number(wire.inserted) || 0,
    updated: Number(wire.updated) || 0,
    autoAdded: Number(wire.auto_added) || 0,
    vehicles: Number(wire.vehicles) || 0,
    dates: Array.isArray(wire.dates) ? wire.dates : [],
    insertedIds: Array.isArray(wire.inserted_ids) ? wire.inserted_ids.map(Number).filter(Number.isFinite) : [],
  };
}

/** Одна правка строки дня. */
export interface FlowTransportEdit {
  id: number;
  row_version: number;
  fields: Record<string, string | number | null>;
}

/** Правки строк дня (оптимистик row_version; реалтайм flow_transport_changed). */
export async function flowTransportEdit(
  client: ApiClient,
  edits: FlowTransportEdit[],
): Promise<{ applied: number[]; conflicts: number[]; rows: FlowTransportRow[] }> {
  const wire = await client.call<{ applied?: number[]; conflicts?: number[]; rows?: FlowTransportRow[] }>(
    'flow_transport_edit',
    { edits },
  );
  return {
    applied: Array.isArray(wire.applied) ? wire.applied : [],
    conflicts: Array.isArray(wire.conflicts) ? wire.conflicts : [],
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}

/**
 * Добавить строку транспорта на дату. Гаражный № необязателен: пустая строка
 * нужна для ручной работы/заказа/ТИП ТС. Если гаражный указан и машины нет в
 * базе → ApiError `vehicle_not_found`.
 */
export async function flowTransportAdd(
  client: ApiClient,
  params: { date: string; garageNo?: string; work?: string; timeRange?: string; orderNo?: string },
): Promise<FlowTransportRow | null> {
  const wire = await client.call<{ row?: FlowTransportRow }>('flow_transport_add', {
    date: params.date,
    garage_no: params.garageNo ?? '',
    work: params.work ?? '',
    time_range: params.timeRange ?? '',
    order_no: params.orderNo ?? '',
  });
  return wire.row ?? null;
}

/** Удалить строки дня (рабочий реестр — без резерва). */
export async function flowTransportDelete(client: ApiClient, ids: number[]): Promise<number[]> {
  const wire = await client.call<{ deleted?: number[] }>('flow_transport_delete', { ids });
  return Array.isArray(wire.deleted) ? wire.deleted : [];
}

/** Одна запись истории правок строки (право-клик ячейки, юзер 2026-08-02). */
export interface FlowTransportHistoryEntry {
  id: number;
  rowId: number;
  /** Имя поля ('(строка)' — событие уровня строки: вставлена/добавлена). */
  field: string;
  oldValue: string;
  newValue: string;
  /** 'edit' | 'paste' | 'paste_auto' | 'add'. */
  kind: string;
  changedBy: string;
  changedByName: string;
  changedAt: string;
}

interface FlowTransportHistoryWire {
  id?: number;
  row_id?: number;
  field?: string;
  old_value?: string;
  new_value?: string;
  kind?: string;
  changed_by?: string;
  changed_by_name?: string;
  changed_at?: string;
}

/** История правок одной строки (все поля) — для право-клика ячейки в гриде. */
export async function flowTransportHistoryGet(
  client: ApiClient,
  rowId: number,
): Promise<FlowTransportHistoryEntry[]> {
  const wire = await client.call<{ rows?: FlowTransportHistoryWire[] }>('flow_transport_history_get', {
    row_id: rowId,
  });
  const rows = Array.isArray(wire.rows) ? wire.rows : [];
  return rows.map((w) => ({
    id: Number(w.id) || 0,
    rowId: Number(w.row_id) || 0,
    field: w.field ?? '',
    oldValue: w.old_value ?? '',
    newValue: w.new_value ?? '',
    kind: w.kind ?? '',
    changedBy: w.changed_by ?? '',
    changedByName: w.changed_by_name ?? '',
    changedAt: w.changed_at ?? '',
  }));
}
