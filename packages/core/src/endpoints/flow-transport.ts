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

/** Вставка из буфера: upsert машин + строки дня (повтор того же дня не дублирует). */
export async function flowTransportPaste(
  client: ApiClient,
  rows: FlowTransportPasteRow[],
): Promise<FlowTransportPasteResult> {
  const wire = await client.call<{
    inserted?: number; updated?: number; auto_added?: number; vehicles?: number; dates?: string[];
    inserted_ids?: number[];
  }>('flow_transport_paste', { rows });
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
