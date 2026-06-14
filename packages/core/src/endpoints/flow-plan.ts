import type { ApiClient } from '../api/client';

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
  /** № транспортного заказа (№ТрЗкз). */
  trz: string;
  vehicle: string;
  exp1: string;
  exp2: string;
  /** ID — гаражный №/рейс. */
  ride_id: string;
  /** Статус выполнения: '' | 'увезли' | 'не увезли' (этап Отчёт). */
  done_stat: string;
  /** Причина невывоза (при «не увезли»). */
  fail_reason: string;
  off_schedule: number;
  /** «Справка» — места хранения с остатком (снимок на момент выгрузки). */
  stock_note: string;
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
  /** SNAPSHOT «склад до» (Был/прежний склад-получатель) — заморожен при фиксации (п.1). */
  snap_pr: string;
  /** Связка строки-переноса с источником (П4): id исходной строки, с которой перенесли. 0 — нет. */
  transfer_src?: number;
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
 * Перенос поставок «на другой день» (ТЗ §5.4/§12). ДО фиксации — двигаем plan_date;
 * ПОСЛЕ фиксации — старую помечаем «перенос на другой день» (серый), копию-черновик
 * кладём в новый день. Дата — только сегодня/будущее (`date_in_past`).
 */
export async function flowTransfer(
  client: ApiClient,
  ids: number[],
  toDate: string,
  target: 'plan' | 'report' = 'plan',
  keepDlv = true,
): Promise<{ transferred: number; rows: FlowDeliveryRow[] }> {
  const wire = await client.call<{ transferred?: number; rows?: FlowDeliveryRow[] }>('flow_transfer', {
    ids,
    to_date: toDate,
    target,
    keep_dlv: keepDlv,
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
): Promise<{ fixationId: number; batchSeq: number; fixed: number }> {
  const wire = await client.call<{ fixation_id?: number; batch_seq?: number; fixed?: number }>(
    'flow_plan_fix',
    { date },
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
