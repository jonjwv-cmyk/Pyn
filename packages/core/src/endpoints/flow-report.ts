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

/** GET: ручные данные за дни. `days` — YYYY-MM-DD[]. */
export async function flowReportManualGet(
  client: ApiClient,
  days: string[],
): Promise<Record<string, ReportManualDay>> {
  const wire = await client.call<{ days?: Record<string, unknown> }>('flow_report_manual_get', {
    days,
  });
  const out: Record<string, ReportManualDay> = {};
  const src = wire.days && typeof wire.days === 'object' ? wire.days : {};
  for (const d of days) {
    const key = String(d).slice(0, 10);
    out[key] = normalizeReportManualDay(src[key]);
  }
  return out;
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
    tree: [],
  };
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
    tree,
  };
}

/** Заголовок дат: «Июль 22-23 2026» / «Июль 22, 25 2026» / «Июль 31 и Август 1-2 2026». */
export function formatReportDaysTitle(days: readonly string[]): string {
  const sorted = [...new Set(days.map((d) => String(d).slice(0, 10)).filter(Boolean))].sort();
  if (!sorted.length) return '';
  const MONTHS = [
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
