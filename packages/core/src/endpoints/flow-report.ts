import type { ApiClient } from '../api/client';
import {
  formatFlowStat,
  isFlowStatShipped,
  whiteEffectiveStat,
} from '../flow-stat';
import type { FlowDeliveryRow } from './flow-plan';

/**
 * Строка футеровки / перескладировки.
 * · Футеровка: `warehouse` = склад, `to` пусто.
 * · Перескладировка: `warehouse` = с, `to` = на.
 */
export interface ReportManualLine {
  warehouse: string;
  /** Направление «на» (перескладировка). */
  to?: string;
  tons: number | null;
}

/** Ручные оперативные данные за один день (Блок 1 PDF). */
export interface ReportManualDay {
  sick: number | null;
  vacation: number | null;
  wood_prop: number | null;
  shields: number | null;
  goods_yard: number | null;
  refr_9010: number | null;
  refr_9030: number | null;
  otl: number | null;
  lining: ReportManualLine[];
  restow: ReportManualLine[];
}

export function emptyReportManualDay(): ReportManualDay {
  return {
    sick: null,
    vacation: null,
    wood_prop: null,
    shields: null,
    goods_yard: null,
    refr_9010: null,
    refr_9030: null,
    otl: null,
    lining: [],
    restow: [],
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseLines(raw: unknown): ReportManualLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    const warehouse = String(o.warehouse ?? o.wh ?? o.from ?? '').trim();
    const to = String(o.to ?? '').trim();
    return {
      warehouse,
      ...(to ? { to } : {}),
      tons: numOrNull(o.tons ?? o.value),
    };
  });
}

export function normalizeReportManualDay(raw: unknown): ReportManualDay {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sick: numOrNull(o.sick),
    vacation: numOrNull(o.vacation),
    wood_prop: numOrNull(o.wood_prop),
    shields: numOrNull(o.shields),
    goods_yard: numOrNull(o.goods_yard),
    refr_9010: numOrNull(o.refr_9010),
    refr_9030: numOrNull(o.refr_9030),
    otl: numOrNull(o.otl),
    lining: parseLines(o.lining),
    restow: parseLines(o.restow),
  };
}

/**
 * GET: ручные данные за дни. `days` — YYYY-MM-DD[].
 *
 * `updatedAt` — когда день последний раз сохраняли (ISO UTC сервера). Нужен
 * для 30-минутной грации замка Блока 2; старый сервер поля не отдаёт, тогда
 * карта пустая и грация просто не срабатывает.
 */
export async function flowReportManualGet(
  client: ApiClient,
  days: string[],
): Promise<{ days: Record<string, ReportManualDay>; updatedAt: Record<string, string> }> {
  const wire = await client.call<{
    days?: Record<string, unknown>;
    updated_at?: Record<string, unknown>;
  }>('flow_report_manual_get', { days });
  const out: Record<string, ReportManualDay> = {};
  const updatedAt: Record<string, string> = {};
  const src = wire.days && typeof wire.days === 'object' ? wire.days : {};
  const upd = wire.updated_at && typeof wire.updated_at === 'object' ? wire.updated_at : {};
  for (const d of days) {
    const key = String(d).slice(0, 10);
    out[key] = normalizeReportManualDay(src[key]);
    const at = upd[key];
    if (typeof at === 'string' && at) updatedAt[key] = at;
  }
  return { days: out, updatedAt };
}

/** SET: сохранить ручные данные одного дня. */
export async function flowReportManualSet(
  client: ApiClient,
  day: string,
  data: ReportManualDay,
): Promise<ReportManualDay> {
  const wire = await client.call<{ data?: unknown }>('flow_report_manual_set', {
    day: String(day).slice(0, 10),
    data,
  });
  return normalizeReportManualDay(wire.data ?? data);
}

/** Грация на исправление опечатки после сохранения (юзер 2026-08-04). */
export const REPORT_MANUAL_GRACE_MS = 30 * 60 * 1000;

/** Есть ли в дне Блока 2 хоть одно заполненное значение. */
export function isReportManualDayEmpty(d: ReportManualDay | null | undefined): boolean {
  if (!d) return true;
  const nums: (number | null)[] = [
    d.sick,
    d.vacation,
    d.wood_prop,
    d.shields,
    d.goods_yard,
    d.refr_9010,
    d.refr_9030,
    d.otl,
  ];
  if (nums.some((n) => n != null)) return false;
  const hasLine = (list: ReportManualLine[] | undefined): boolean =>
    Array.isArray(list) && list.some((l) => l && (l.tons != null || (l.warehouse || '').trim()));
  return !hasLine(d.lining) && !hasLine(d.restow);
}

/**
 * Замок Блока 2 для админов и пользователей (разработчик не ограничен).
 *
 * Правило (юзер 2026-08-04): отчёт за день пишут в сам день и в СЛЕДУЮЩИЙ
 * РАБОЧИЙ день; дальше день закрыт — чтобы не затереть данные случайно.
 * Понедельник заполняют в пн и вт, со среды он закрыт. Выходные и праздники
 * подтягиваются к ближайшему рабочему дню сами: если чт–вс нерабочие, все
 * четыре дня открыты в понедельник и закрываются во вторник.
 *
 * Исключения:
 *  · день пустой — вносить можно когда угодно (ничего не затираем);
 *  · 30 минут после сохранения — на исправление опечатки.
 *
 * ВАЖНО: то же правило продублировано на сервере (`handlers-flow.js`,
 * `manualDayEditable`). Меняешь здесь — меняй там.
 */
export function isReportManualDayEditable(opts: {
  /** День отчёта, YYYY-MM-DD. */
  day: string;
  /** Сегодня в местной зоне, YYYY-MM-DD. */
  today: string;
  /** Рабочий ли день по производственному календарю. */
  isWorkingDay: (iso: string) => boolean;
  /** Разработчик / суперадмин — без ограничений. */
  isDev?: boolean;
  /** Пустой день можно заполнять всегда. */
  isEmpty?: boolean;
  /** Когда день последний раз сохраняли (мс epoch); null — неизвестно. */
  updatedAtMs?: number | null;
  /** Сейчас (мс epoch) — для грации. */
  nowMs?: number;
}): boolean {
  if (opts.isDev) return true;
  if (opts.isEmpty) return true;

  const day = String(opts.day || '').slice(0, 10);
  const today = String(opts.today || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return true;
  // Сам день и будущее — всегда открыто.
  if (day >= today) return true;

  // Открыто по сам следующий РАБОЧИЙ день включительно.
  const deadline = nextWorkingDayIso(day, opts.isWorkingDay);
  if (deadline && today <= deadline) return true;

  const at = opts.updatedAtMs;
  if (at != null && Number.isFinite(at)) {
    const now = opts.nowMs ?? Date.now();
    if (now - at < REPORT_MANUAL_GRACE_MS) return true;
  }
  return false;
}

/** Первый рабочий день строго после `iso`. Ищем не дальше 30 суток. */
export function nextWorkingDayIso(iso: string, isWorkingDay: (d: string) => boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  for (let i = 0; i < 30; i++) {
    d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (isWorkingDay(next)) return next;
  }
  return null;
}

export type ReportMode = 'white' | 'black';

export interface ReportTreeNote {
  note: string;
  count: number;
}

export interface ReportTreeReason {
  label: string;
  count: number;
  notes: ReportTreeNote[];
}

export interface ReportTreeShop {
  shop: string;
  count: number;
  reasons: ReportTreeReason[];
}

/** Как колонка ГРАФ: on=«да», off=дата (день ≠ график), none=нет в графике. */
export type ReportGraphKind = 'on' | 'off' | 'none';

/** День расхождения + сколько позиций (ISO-дата). */
export interface ReportShiftDay {
  day: string;
  count: number;
}

/**
 * Цех среза расхождения плана и факта, с разбивкой по «другому» дню — тому,
 * который не совпадает с днём отчёта:
 *  · сверх плана — дни ПЛАНА этих строк («за какой день сверх»);
 *  · опережение / смещение — дни ФАКТА («когда увезли»).
 */
export interface ReportShiftShop {
  shop: string;
  count: number;
  days: ReportShiftDay[];
  /** Только «сверх плана»: цеха не было в плане дня, он добавился этой работой. */
  isNew?: boolean;
}

/**
 * Срез «нет в графике» / «вне графика»:
 * % цехов от всех цехов, позиции и % от плана, склады (точки) и % от всех складов.
 */
export interface ReportSliceStats {
  shops: number;
  /** % цехов от shopCount. */
  shopPct: number;
  positions: number;
  /** % позиций от total. */
  positionPct: number;
  warehouses: number;
  /** % складов (to_wh) от warehouseCount. */
  warehousePct: number;
}

export interface ReportComputeResult {
  mode: ReportMode;
  total: number;
  shipped: number;
  percent: number;
  /** Не вывезенные (для дерева причин). */
  notShipped: number;
  /** Уникальные цеха в периоде (все позиции отчёта). */
  shopCount: number;
  /** Уникальные склады получения (to_wh) за период. */
  warehouseCount: number;
  /**
   * Цеха, которых нет в графике (ГРАФ = «нет» / «—»).
   * Пустой массив → блок «Нет в графике» не показываем.
   */
  notInScheduleShops: string[];
  /**
   * Цеха вне графика (ГРАФ = дата: день плана ≠ день графика).
   * Пустой → блок «Вне графика» не показываем.
   */
  offScheduleShops: string[];
  notInStats: ReportSliceStats;
  offStats: ReportSliceStats;
  /**
   * «Опережение плана» — строки ДНЯ ПЛАНА, увезённые раньше срока
   * (DAY факт < DAY плана). Часть плана дня и уже засчитаны в shipped;
   * срез только показывает, сколько плана закрыто досрочно.
   */
  aheadStats: ReportSliceStats;
  aheadShops: ReportShiftShop[];
  /**
   * «Смещённый тайминг» — строки ДНЯ ПЛАНА, увезённые позже (DAY факт > DAY
   * плана), когда дату факта поставили руками. Перенос сюда НЕ попадает: там
   * строки переезжают на новый день самостоятельными записями.
   */
  shiftedStats: ReportSliceStats;
  shiftedShops: ReportShiftShop[];
  /**
   * «Сверх плана» — увезённое в выбранный день по строкам ЧУЖОГО дня плана
   * (DAY факт внутри выбора, DAY плана — снаружи). В total/percent НЕ входит:
   * иначе знаменатель дня задним числом раздувается.
   *
   * `shops`/`warehouses` — ВСЕ затронутые, чтобы список сходился с карточкой:
   * сумма позиций по `overShops` = `positions`, а число строк списка = `shops`.
   * Их `shopPct`/`warehousePct` НЕ выводим: цеха сверхплановых строк не
   * подмножество цехов дня, доля может быть >100%. «Насколько день вырос»
   * отвечают `overNewShops`/`overNewWarehouses` (юзер 2026-08-04).
   */
  overStats: ReportSliceStats;
  /** Цеха/склады, которых в плане дня НЕ было — день вырос на столько. */
  overNewShops: number;
  overNewWarehouses: number;
  overShops: ReportShiftShop[];
  tree: ReportTreeShop[];
}

export interface FlowReportOpts {
  /** Склад → название цеха (shop_name). */
  resolveShop?: (toWh: string) => string;
  /**
   * Классификация по ГРАФ:
   * · on — «да» (день плана = график)
   * · off — дата (склад в графике, но день другой)
   * · none — нет в графике
   */
  graphKind?: (row: FlowDeliveryRow) => ReportGraphKind;
  /** @deprecated используйте graphKind; true ≈ off|none */
  isOffSchedule?: (row: FlowDeliveryRow) => boolean;
}

function rowStat(r: FlowDeliveryRow): { stat: string; sub: string } {
  const stat = String(r.stat || '').trim();
  const sub = String(r.stat_sub || '').trim();
  if (stat) return { stat, sub };
  // legacy bridge
  const ds = String(r.done_stat || '').trim();
  if (ds === 'выполнено' || ds === 'увезли') return { stat: 'выполнено', sub: '' };
  return { stat: '', sub: '' };
}

function effectiveForMode(
  mode: ReportMode,
  stat: string,
  sub: string,
): { stat: string; sub: string } {
  if (mode === 'white') return whiteEffectiveStat(stat, sub);
  return { stat, sub };
}

/**
 * Расчёт White/Black по строкам ОТЧЁТА (fixation_id>0), **построчно**.
 * Дерево — только невывезенные, группировка по цеху (не по номеру склада).
 */
function emptySlice(): ReportSliceStats {
  return {
    shops: 0,
    shopPct: 0,
    positions: 0,
    positionPct: 0,
    warehouses: 0,
    warehousePct: 0,
  };
}

function emptyReportResult(mode: ReportMode): ReportComputeResult {
  return {
    mode,
    total: 0,
    shipped: 0,
    percent: 0,
    notShipped: 0,
    shopCount: 0,
    warehouseCount: 0,
    notInScheduleShops: [],
    offScheduleShops: [],
    notInStats: emptySlice(),
    offStats: emptySlice(),
    aheadStats: emptySlice(),
    aheadShops: [],
    shiftedStats: emptySlice(),
    shiftedShops: [],
    overStats: emptySlice(),
    overNewShops: 0,
    overNewWarehouses: 0,
    overShops: [],
    tree: [],
  };
}

/** DAY факт строки как ISO-дата; пусто/мусор → ''. */
function factDayOf(r: FlowDeliveryRow): string {
  const d = String(r.day_fact || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

/**
 * Вывезено по ФАКТИЧЕСКИ проставленному статусу, без White-проекции:
 * в White всё «не жёлтое» превращается в «выполнено», и тогда досрочными
 * стали бы строки, которые никто не увозил.
 */
function isShippedRaw(r: FlowDeliveryRow): boolean {
  const { stat, sub } = rowStat(r);
  return isFlowStatShipped(stat, sub);
}

/** Цех → день → сколько позиций. */
type ShiftAcc = Map<string, Map<string, number>>;

function bumpShift(acc: ShiftAcc, shop: string, day: string): void {
  let byDay = acc.get(shop);
  if (!byDay) {
    byDay = new Map();
    acc.set(shop, byDay);
  }
  byDay.set(day, (byDay.get(day) || 0) + 1);
}

/** Цеха по алфавиту, дни внутри — по возрастанию даты. */
function buildShiftShops(acc: ShiftAcc): ReportShiftShop[] {
  return [...acc.entries()]
    .map(([shop, byDay]) => {
      let count = 0;
      const days: ReportShiftDay[] = [];
      for (const [day, n] of byDay.entries()) {
        count += n;
        days.push({ day, count: n });
      }
      days.sort((a, b) => a.day.localeCompare(b.day));
      return { shop, count, days };
    })
    .sort((a, b) => a.shop.localeCompare(b.shop, 'ru'));
}

export function computeFlowReport(
  rows: readonly FlowDeliveryRow[],
  mode: ReportMode,
  selectedDays?: readonly string[],
  opts?: FlowReportOpts,
): ReportComputeResult {
  // Пустой выбор дней → нулевой отчёт (не «все дни»). undefined = без фильтра (legacy).
  if (selectedDays !== undefined && selectedDays.length === 0) {
    return emptyReportResult(mode);
  }

  const daySet =
    selectedDays && selectedDays.length > 0
      ? new Set(selectedDays.map((d) => String(d).slice(0, 10)))
      : null;

  const reportRows = rows.filter((r) => {
    if (!(Number(r.fixation_id) > 0)) return false;
    if (!daySet) return true;
    const d = String(r.plan_date || '').slice(0, 10);
    return daySet.has(d);
  });

  const shopOf = (r: FlowDeliveryRow): string => {
    const wh = String(r.to_wh || '').trim();
    if (!wh) return '—';
    const s = opts?.resolveShop?.(wh)?.trim();
    return s || wh;
  };

  let shipped = 0;
  // Невывезенные: shop → total; reasons только при реальном STAT (не «без статуса»).
  // «выполнено»/shipped — только в total/percent, в дерево не идёт.
  const shopCounts = new Map<string, number>();
  const allShops = new Set<string>();
  const allWh = new Set<string>();
  const map = new Map<string, Map<string, Map<string, number>>>();
  const notInSet = new Set<string>();
  const offShopSet = new Set<string>();
  let notInPositions = 0;
  let offPositions = 0;
  const notInWh = new Set<string>();
  const offWh = new Set<string>();
  // Опережение плана / смещённый тайминг — строки дня плана с ручным DAY факт.
  // В разбивке — день ФАКТА: «когда увезли» (юзер 2026-08-04).
  const aheadAcc: ShiftAcc = new Map();
  const aheadWh = new Set<string>();
  let aheadPositions = 0;
  const shiftedAcc: ShiftAcc = new Map();
  const shiftedWh = new Set<string>();
  let shiftedPositions = 0;

  const kindOf = (r: FlowDeliveryRow): ReportGraphKind => {
    if (opts?.graphKind) return opts.graphKind(r);
    // legacy: isOffSchedule true → none (старое поведение «не в schedule»)
    if (opts?.isOffSchedule?.(r)) return 'none';
    return 'on';
  };

  const whKeyOf = (r: FlowDeliveryRow): string => String(r.to_wh || '').trim() || '—';

  for (const r of reportRows) {
    const shop = shopOf(r);
    const wh = whKeyOf(r);
    allShops.add(shop);
    allWh.add(wh);
    const gk = kindOf(r);
    if (gk === 'none') {
      notInSet.add(shop);
      notInPositions += 1;
      notInWh.add(wh);
    } else if (gk === 'off') {
      offShopSet.add(shop);
      offPositions += 1;
      offWh.add(wh);
    }

    // Факт разошёлся с планом (дату ставили руками) → опережение / смещение.
    const fd = factDayOf(r);
    const pd = String(r.plan_date || '').slice(0, 10);
    if (fd && pd && fd !== pd && isShippedRaw(r)) {
      if (fd < pd) {
        bumpShift(aheadAcc, shop, fd);
        aheadWh.add(wh);
        aheadPositions += 1;
      } else {
        bumpShift(shiftedAcc, shop, fd);
        shiftedWh.add(wh);
        shiftedPositions += 1;
      }
    }

    const raw = rowStat(r);
    const eff = effectiveForMode(mode, raw.stat, raw.sub);
    if (isFlowStatShipped(eff.stat, eff.sub)) {
      shipped += 1;
      continue;
    }
    shopCounts.set(shop, (shopCounts.get(shop) || 0) + 1);
    // Пустой статус — только в счётчике цеха, без ветки «без статуса».
    if (!eff.stat) continue;
    const label = formatFlowStat(eff.stat, eff.sub) || eff.stat;
    const note = String(r.stat_note || '').trim(); // пустой note не показываем
    let byReason = map.get(shop);
    if (!byReason) {
      byReason = new Map();
      map.set(shop, byReason);
    }
    let byNote = byReason.get(label);
    if (!byNote) {
      byNote = new Map();
      byReason.set(label, byNote);
    }
    byNote.set(note, (byNote.get(note) || 0) + 1);
  }

  /**
   * Сверх плана: увезено в выбранный день, но строка принадлежит ЧУЖОМУ дню
   * плана. Если день плана тоже внутри выбора — строка уже посчитана как план
   * периода, второй раз не берём (никакого двойного счёта при выборе «пн+вт»).
   */
  // В разбивке — день ПЛАНА: «за какой день сверх» (юзер 2026-08-04).
  const overAcc: ShiftAcc = new Map();
  const overWh = new Set<string>();
  // Подмножество: чего в плане дня не было — «день вырос».
  const overNewShopSet = new Set<string>();
  const overNewWhSet = new Set<string>();
  let overPositions = 0;
  if (daySet) {
    for (const r of rows) {
      if (!(Number(r.fixation_id) > 0)) continue;
      if (Number(r.reserved) > 0) continue;
      const fd = factDayOf(r);
      if (!fd || !daySet.has(fd)) continue;
      const pd = String(r.plan_date || '').slice(0, 10);
      if (!pd || pd === fd || daySet.has(pd)) continue;
      if (!isShippedRaw(r)) continue;
      overPositions += 1;
      // Считаем ВСЕ затронутые цеха и склады — тогда список сходится с
      // карточкой. «Новизну» держим отдельным множеством, а не отбором.
      const shop = shopOf(r);
      bumpShift(overAcc, shop, pd);
      if (!allShops.has(shop)) overNewShopSet.add(shop);
      const wh = whKeyOf(r);
      overWh.add(wh);
      if (!allWh.has(wh)) overNewWhSet.add(wh);
    }
  }

  const total = reportRows.length;
  const notShipped = total - shipped;
  const percent = total > 0 ? Math.round((shipped / total) * 1000) / 10 : 0;
  const shopCount = allShops.size;
  const warehouseCount = allWh.size;

  const pctOf = (n: number, d: number): number =>
    d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

  const sliceOf = (
    shops: number,
    positions: number,
    warehouses: number,
  ): ReportSliceStats => ({
    shops,
    shopPct: pctOf(shops, shopCount),
    positions,
    positionPct: pctOf(positions, total),
    warehouses,
    warehousePct: pctOf(warehouses, warehouseCount),
  });

  const tree: ReportTreeShop[] = [...shopCounts.entries()]
    .map(([shop, count]) => {
      const byReason = map.get(shop);
      const reasons: ReportTreeReason[] = byReason
        ? [...byReason.entries()]
            .map(([label, byNote]) => {
              let reasonCount = 0;
              const notes: ReportTreeNote[] = [];
              for (const [note, n] of byNote.entries()) {
                reasonCount += n;
                if (note) notes.push({ note, count: n });
              }
              notes.sort((a, b) => b.count - a.count || a.note.localeCompare(b.note, 'ru'));
              return { label, count: reasonCount, notes };
            })
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
        : [];
      return { shop, count, reasons };
    })
    // Алфавит (ru); только невывезенные цеха (shopCounts уже без shipped).
    .sort((a, b) => a.shop.localeCompare(b.shop, 'ru'));

  const notInScheduleShops = [...notInSet].sort((a, b) => a.localeCompare(b, 'ru'));
  const offScheduleShops = [...offShopSet].sort((a, b) => a.localeCompare(b, 'ru'));

  return {
    mode,
    total,
    shipped,
    percent,
    notShipped,
    shopCount,
    warehouseCount,
    notInScheduleShops,
    offScheduleShops,
    notInStats: sliceOf(notInScheduleShops.length, notInPositions, notInWh.size),
    offStats: sliceOf(offScheduleShops.length, offPositions, offWh.size),
    aheadStats: sliceOf(aheadAcc.size, aheadPositions, aheadWh.size),
    aheadShops: buildShiftShops(aheadAcc),
    shiftedStats: sliceOf(shiftedAcc.size, shiftedPositions, shiftedWh.size),
    shiftedShops: buildShiftShops(shiftedAcc),
    overStats: sliceOf(overAcc.size, overPositions, overWh.size),
    overNewShops: overNewShopSet.size,
    overNewWarehouses: overNewWhSet.size,
    overShops: buildShiftShops(overAcc).map((s) =>
      overNewShopSet.has(s.shop) ? { ...s, isNew: true } : s,
    ),
    tree,
  };
}

const MONTHS_RU = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/**
 * Дни расхождения → «август 4, 7»: месяц впереди, затем числа (юзер 2026-08-04).
 * Разные месяцы разделяются точкой: «июль 31 · август 3».
 */
export function formatShiftDays(days: readonly ReportShiftDay[]): string {
  const byMonth = new Map<string, number[]>();
  for (const d of days) {
    const iso = String(d.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const key = iso.slice(0, 7);
    const arr = byMonth.get(key) ?? [];
    arr.push(Number(iso.slice(8, 10)));
    byMonth.set(key, arr);
  }
  const parts: string[] = [];
  for (const [key, nums] of [...byMonth.entries()].sort()) {
    const name = MONTHS_RU[Number(key.slice(5, 7)) - 1] || key;
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    parts.push(`${name} ${uniq.join(', ')}`);
  }
  return parts.join(' · ');
}

/** Заголовок дат: «Июль 22-23 2026» / «Июль 22, 25 2026» / «Июль 31 и Август 1-2 2026». */
export function formatReportDaysTitle(days: readonly string[]): string {
  const sorted = [...new Set(days.map((d) => String(d).slice(0, 10)).filter(Boolean))].sort();
  if (!sorted.length) return '';
  const MONTHS = MONTHS_RU;
  const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // group by YYYY-MM
  const byMonth = new Map<string, number[]>();
  for (const iso of sorted) {
    const y = iso.slice(0, 4);
    const m = iso.slice(5, 7);
    const day = Number(iso.slice(8, 10));
    const key = `${y}-${m}`;
    const arr = byMonth.get(key) ?? [];
    arr.push(day);
    byMonth.set(key, arr);
  }
  const years = new Set([...byMonth.keys()].map((k) => k.slice(0, 4)));
  const multiYear = years.size > 1;
  const parts: string[] = [];
  for (const [key, ds] of [...byMonth.entries()].sort()) {
    const y = key.slice(0, 4);
    const m = Number(key.slice(5, 7));
    const name = cap(MONTHS[m - 1] || key);
    ds.sort((a, b) => a - b);
    // compress consecutive
    const segs: string[] = [];
    let i = 0;
    while (i < ds.length) {
      let j = i;
      while (j + 1 < ds.length && ds[j + 1] === ds[j]! + 1) j += 1;
      if (j === i) segs.push(String(ds[i]));
      else if (j === i + 1) segs.push(`${ds[i]}, ${ds[j]}`);
      else segs.push(`${ds[i]}-${ds[j]}`);
      i = j + 1;
    }
    // при разных годах — год у каждой группы; иначе год один раз в конце
    parts.push(multiYear ? `${name} ${segs.join(', ')} ${y}` : `${name} ${segs.join(', ')}`);
  }
  let body: string;
  if (parts.length === 1) body = parts[0]!;
  else if (parts.length === 2) body = `${parts[0]} и ${parts[1]}`;
  else body = parts.slice(0, -1).join(', ') + ' и ' + parts[parts.length - 1];
  if (multiYear) return body;
  const onlyYear = [...years][0];
  return onlyYear ? `${body} ${onlyYear}` : body;
}
