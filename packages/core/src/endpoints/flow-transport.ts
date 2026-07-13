import type { ApiClient } from '../api/client';

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

/**
 * Разобрать вставку из буфера — шаблон листа 🚚 КАК ЕСТЬ (TSV, 29 колонок):
 * ДАТА·Цв.куз.·ТИП·МОДЕЛЬ·доп.тн·тн·Д·Ш·В·№·ВЫЕЗД·ГОС.№·РАБОТА·⏰·СТАТУС·КОМЕНТ.·
 * ВОДИТЕЛЬ·СОТ.·ЭКСПЕДИТОРЫ·ОТ·СП·Заказ·max.доп.масса/кг·грузопод./кг·Д·Ш·В·ЗАПРЕТ·СОТ(raw).
 * Формульные колонки шаблона (доп.тн/тн/Д-Ш-В м/ВЫЕЗД/СОТ formatted) игнорируем —
 * берём «хвостовые» сырые (масса/габариты мм/запрет/телефон raw). Строки без даты
 * (шапка/мусор) пропускаем; строки без машины (напр. «Отклонен») сохраняем.
 */
export function parseTransportPaste(tsv: string): FlowTransportPasteRow[] {
  const out: FlowTransportPasteRow[] = [];
  for (const raw of String(tsv ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const p = raw.split('\t').map((x) => x.trim());
    const tdate = parseRuDate(p[0] ?? '');
    if (!tdate) continue; // шапка/мусор
    const work = p[12] ?? '';
    const garage = p[9] ?? '';
    if (!garage && !work) continue; // совсем пустая строка дня
    const banRaw = (p[27] ?? '').toLowerCase();
    out.push({
      tdate,
      garage_no: garage,
      color: p[1] ?? '',
      vtype: p[2] ?? '',
      model: p[3] ?? '',
      gos_no: p[11] ?? '',
      max_mass_kg: p[22] ?? '',
      capacity_kg: p[23] ?? '',
      len_mm: p[24] ?? '',
      wid_mm: p[25] ?? '',
      hei_mm: p[26] ?? '',
      ban: banRaw.startsWith('да') ? 1 : 0,
      work,
      time_range: p[13] ?? '',
      status: p[14] ?? '',
      comment: p[15] ?? '',
      driver: p[16] ?? '',
      driver_phone: (p[28] ?? '') || (p[17] ?? ''),
      expeditors: p[18] ?? '',
      ot: p[19] ?? '',
      sp: p[20] ?? '',
      order_no: p[21] ?? '',
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

/** Строки транспорта (все или один день). */
export async function flowTransportGet(client: ApiClient, date?: string): Promise<FlowTransportRow[]> {
  const wire = await client.call<{ rows?: FlowTransportRow[] }>('flow_transport_get', date ? { date } : {});
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
