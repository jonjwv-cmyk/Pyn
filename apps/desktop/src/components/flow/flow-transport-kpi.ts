/**
 * KPI / аналитика транспорта.
 * Фокус: работы (строки), статусы, план/факт, водители, типы ТС.
 */

import { parseTimeRangeBounds } from './flow-transport-shift';

export type AnalyticsRange = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year';

/**
 * Зерно периода дашборда (как выбираем → как рисуем):
 *  day     — точки/столбцы по дням
 *  week    — по неделям (пн)
 *  month   — по месяцам
 *  quarter — по кварталам
 *  year    — по годам
 */
export type PeriodGrain = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TransportKpiRow {
  tdate: string;
  status: string;
  out_status: string;
  garage_no: string;
  vehicle_type: string;
  /** Работа/задание, напр. «1.1. Технология КЦ» */
  work: string;
  time_range: string;
  time_bold: number;
  fact_start: string;
  fact_end: string;
  driver: string;
  driver_phone: string;
  force_json: string;
}

export interface StatusBreakdown {
  status: string;
  count: number;
  pct: number;
}

export interface VehicleTypeStat {
  type: string;
  works: number;
  factHours: number;
  planHours: number;
  /** Доля факт-часов в периоде, % */
  weightPct: number;
  /** Размещен + Дополнение */
  okWorks: number;
}

export interface DriverStat {
  fio: string;
  phone: string;
  works: number;
  factHours: number;
  /** Доля факт-часов водителя от всех факт-часов периода, % */
  workPct: number;
  isMol: boolean;
}

export interface ChartMonthGroup {
  title: string;
  cols: number;
}

export interface TransportKpis {
  periodLabel: string;
  /** Число строк (работ) в анализе */
  worksCount: number;
  /** Размещен */
  doneCount: number;
  /** Дополнение — доп. машины, важно */
  extraCount: number;
  /** Все статусы кроме Размещен */
  statusBreakdown: StatusBreakdown[];
  totalPlanHours: number;
  totalFactHours: number;
  /** Разница: факт − план */
  hoursDiff: number;
  /** bar — один бакет (день), line — динамика */
  chartMode: 'bar' | 'line';
  chartLabels: string[];
  /** ISO-ключи бакетов (день YYYY-MM-DD или месяц YYYY-MM) */
  chartKeys: string[];
  /** Группы месяцев под осью (линейный, несколько месяцев) */
  chartGroups: ChartMonthGroup[];
  planHours: number[];
  factHours: number[];
  byType: VehicleTypeStat[];
  drivers: DriverStat[];
  /** Уникальные названия работ в периоде (до фильтра галочек) */
  availableWorks: string[];
}

export interface PeriodAnchor {
  year: number;
  month: number;
  quarter: 1 | 2 | 3 | 4;
  half: 1 | 2;
  dayIso: string;
}

export function defaultPeriodAnchor(now = new Date()): PeriodAnchor {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return {
    year: y,
    month: m,
    quarter: (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4,
    half: m <= 6 ? 1 : 2,
    dayIso: toIso(startOfDay(now)),
  };
}

export interface ComputeTransportKpisOpts {
  customDays?: string[];
  /** YYYY-MM, multi-select для range=month. Пусто → якорь.month */
  customMonths?: string[];
  /** null/undefined = все работы; иначе только выбранные имена */
  includedWorks?: ReadonlySet<string> | null;
  molByFio?: ReadonlyMap<string, boolean>;
  anchor?: PeriodAnchor;
  /** Как агрегировать график (не фильтр строк). По умолчанию day. */
  chartGrain?: PeriodGrain;
}

/** Телефон: `8  901  438  8831`. */
export function formatPhoneRu(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  let n = digits;
  if (n.length === 11 && n.startsWith('7')) n = `8${n.slice(1)}`;
  if (n.length === 10) n = `8${n}`;
  if (n.length === 11 && n.startsWith('8')) {
    return `${n[0]}  ${n.slice(1, 4)}  ${n.slice(4, 7)}  ${n.slice(7)}`;
  }
  return String(raw || '').trim();
}

/** Уникальные работы (имена), без пустых, сортировка ru. */
export function uniqueWorkNames(rows: TransportKpiRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const w = (r.work || '').trim();
    if (w) set.add(w);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Подпись мультимесяцев: «июль 2026» / «июл–сен 2026» / «3 мес». */
export function formatMonthsLabel(yms: string[]): string {
  const sorted = [...yms].filter(Boolean).sort();
  if (sorted.length === 0) return '';
  if (sorted.length === 1) return formatMonthRu(sorted[0]!);
  const years = new Set(sorted.map((y) => y.slice(0, 4)));
  if (years.size === 1) {
    const y = sorted[0]!.slice(0, 4);
    const first = Number(sorted[0]!.slice(5, 7)) - 1;
    const last = Number(sorted[sorted.length - 1]!.slice(5, 7)) - 1;
    const contiguous =
      sorted.length === last - first + 1 &&
      sorted.every((ym, i) => {
        const expect = `${y}-${String(first + 1 + i).padStart(2, '0')}`;
        return ym === expect;
      });
    if (contiguous) {
      const a = (MONTH_FULL[first] ?? '').slice(0, 3);
      const b = (MONTH_FULL[last] ?? '').slice(0, 3);
      return `${a}–${b} ${y}`;
    }
    return sorted.map((ym) => (MONTH_FULL[Number(ym.slice(5, 7)) - 1] ?? ym).slice(0, 3)).join(', ') + ` ${y}`;
  }
  return `${sorted.length} мес.`;
}

function parseHm(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hoursFromRange(timeRange: string): number {
  const b = parseTimeRangeBounds(timeRange);
  if (!b) return 0;
  let d = b.endMin - b.startMin;
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 10) / 10;
}

export function hoursFromStartEnd(start: string, end: string): number {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s == null || e == null) return 0;
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 10) / 10;
}

/**
 * Машина реально «в этом дне» только если есть план ИЛИ факт (юзер 2026-08-02: пустые
 * строки без времени — не работа, не должны считаться/подсвечиваться в календаре).
 */
export function rowHasActivity(r: Pick<TransportKpiRow, 'time_range' | 'fact_start' | 'fact_end'>): boolean {
  return hoursFromRange(r.time_range) > 0 || hoursFromStartEnd(r.fact_start, r.fact_end) > 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeekMon(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const MONTH_FULL = [
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
const MONTH_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function fmtDayMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3]) return iso;
  const mo = Number(m[2]) - 1;
  return `${Number(m[3])} ${MONTH_GEN[mo] ?? m[2]} ${m[1]}`;
}

export function fmtDayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3]) return iso;
  const mo = Number(m[2]) - 1;
  return `${Number(m[3])} ${MONTH_GEN[mo] ?? m[2]}`;
}

/**
 * Человекочитаемый период: «июль 2026», «3–10 августа 2026», «Q2 2026»…
 */
export function formatPeriodLabel(
  range: AnalyticsRange,
  anchor: PeriodAnchor,
  customDays?: string[],
): string {
  if (range === 'day' && customDays && customDays.length > 0) {
    const sorted = [...customDays].sort();
    if (sorted.length === 1) return fmtDayMonthYear(sorted[0]!);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const y1 = first.slice(0, 4);
    const y2 = last.slice(0, 4);
    if (first.slice(0, 7) === last.slice(0, 7)) {
      // один месяц
      const m = Number(first.slice(5, 7)) - 1;
      const d1 = Number(first.slice(8, 10));
      const d2 = Number(last.slice(8, 10));
      return `${d1}–${d2} ${MONTH_GEN[m] ?? ''} ${y1}`.replace(/\s+/g, ' ').trim();
    }
    return y1 === y2
      ? `${fmtDayMonth(first)} – ${fmtDayMonth(last)} ${y1}`
      : `${fmtDayMonthYear(first)} – ${fmtDayMonthYear(last)}`;
  }
  const b = periodBounds(range, anchor);
  return b.label;
}

export function periodBounds(
  range: AnalyticsRange,
  anchor: PeriodAnchor,
  now = new Date(),
): { start: string; end: string; prevStart: string; prevEnd: string; label: string } {
  if (range === 'day') {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(anchor.dayIso) ? anchor.dayIso : toIso(startOfDay(now));
    const d = new Date(start + 'T12:00:00');
    const prev = toIso(addDays(d, -1));
    return { start, end: start, prevStart: prev, prevEnd: prev, label: fmtDayMonthYear(start) };
  }
  if (range === 'week') {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(anchor.dayIso)
      ? new Date(anchor.dayIso + 'T12:00:00')
      : startOfDay(now);
    const mon = startOfWeekMon(base);
    const sun = addDays(mon, 6);
    const prevMon = addDays(mon, -7);
    const monIso = toIso(mon);
    const sunIso = toIso(sun);
    const y = monIso.slice(0, 4);
    const label =
      monIso.slice(0, 7) === sunIso.slice(0, 7)
        ? `${Number(monIso.slice(8, 10))}–${Number(sunIso.slice(8, 10))} ${MONTH_GEN[Number(monIso.slice(5, 7)) - 1] ?? ''} ${y}`
        : `${fmtDayMonth(monIso)} – ${fmtDayMonthYear(sunIso)}`;
    return {
      start: monIso,
      end: sunIso,
      prevStart: toIso(prevMon),
      prevEnd: toIso(addDays(prevMon, 6)),
      label: label.replace(/\s+/g, ' ').trim(),
    };
  }
  if (range === 'month') {
    const y = anchor.year;
    const m = Math.min(12, Math.max(1, anchor.month)) - 1;
    const prevY = m === 0 ? y - 1 : y;
    const prevM = m === 0 ? 11 : m - 1;
    return {
      start: toIso(new Date(y, m, 1)),
      end: toIso(new Date(y, m + 1, 0)),
      prevStart: toIso(new Date(prevY, prevM, 1)),
      prevEnd: toIso(new Date(prevY, prevM + 1, 0)),
      label: `${MONTH_FULL[m] ?? m + 1} ${y}`,
    };
  }
  if (range === 'quarter') {
    const y = anchor.year;
    const q = Math.min(4, Math.max(1, anchor.quarter)) as 1 | 2 | 3 | 4;
    const q0 = (q - 1) * 3;
    const pq = q === 1 ? 4 : ((q - 1) as 1 | 2 | 3 | 4);
    const pqy = q === 1 ? y - 1 : y;
    const pq0 = (pq - 1) * 3;
    return {
      start: toIso(new Date(y, q0, 1)),
      end: toIso(new Date(y, q0 + 3, 0)),
      prevStart: toIso(new Date(pqy, pq0, 1)),
      prevEnd: toIso(new Date(pqy, pq0 + 3, 0)),
      label: `${q}-й квартал ${y}`,
    };
  }
  if (range === 'half') {
    const y = anchor.year;
    const half = anchor.half === 2 ? 2 : 1;
    const h0 = half === 1 ? 0 : 6;
    const phy = half === 1 ? y - 1 : y;
    const ph0 = half === 1 ? 6 : 0;
    return {
      start: toIso(new Date(y, h0, 1)),
      end: toIso(new Date(y, h0 + 6, 0)),
      prevStart: toIso(new Date(phy, ph0, 1)),
      prevEnd: toIso(new Date(phy, ph0 + 6, 0)),
      label: half === 1 ? `1-е полугодие ${y}` : `2-е полугодие ${y}`,
    };
  }
  const y = anchor.year;
  return {
    start: toIso(new Date(y, 0, 1)),
    end: toIso(new Date(y, 11, 31)),
    prevStart: toIso(new Date(y - 1, 0, 1)),
    prevEnd: toIso(new Date(y - 1, 11, 31)),
    label: String(y),
  };
}

function inRange(tdate: string, start: string, end: string): boolean {
  return !!tdate && tdate >= start && tdate <= end;
}

function chartBucketKey(tdate: string, range: AnalyticsRange): string {
  if (range === 'year' || range === 'half' || range === 'quarter') return tdate.slice(0, 7);
  return tdate;
}

function chartLabel(key: string, range: AnalyticsRange): string {
  if (range === 'year' || range === 'half' || range === 'quarter') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m?.[1] || !m[2]) return key;
    const mi = Number(m[2]) - 1;
    return `${MONTH_FULL[mi]?.slice(0, 3) ?? m[2]} ${m[1].slice(2)}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m?.[1] || !m[2] || !m[3]) return key;
  return `${Number(m[3])}.${m[2]}`;
}

function monthGroupsFromDayKeys(keys: string[]): ChartMonthGroup[] {
  if (keys.length === 0) return [];
  const groups: ChartMonthGroup[] = [];
  let curYm = '';
  let cols = 0;
  for (const k of keys) {
    const ym = k.slice(0, 7);
    if (ym !== curYm) {
      if (curYm && cols > 0) {
        const mi = Number(curYm.slice(5, 7)) - 1;
        groups.push({ title: MONTH_FULL[mi] ?? curYm, cols });
      }
      curYm = ym;
      cols = 1;
    } else {
      cols += 1;
    }
  }
  if (curYm && cols > 0) {
    const mi = Number(curYm.slice(5, 7)) - 1;
    groups.push({ title: MONTH_FULL[mi] ?? curYm, cols });
  }
  // Группы имеют смысл, если месяцев > 1
  return groups.length > 1 ? groups : [];
}

function bucketSeries(
  rows: TransportKpiRow[],
  range: AnalyticsRange,
): {
  keys: string[];
  labels: string[];
  plan: number[];
  fact: number[];
  groups: ChartMonthGroup[];
} {
  const buckets = new Map<string, { plan: number; fact: number }>();
  for (const r of rows) {
    const k = chartBucketKey(r.tdate, range);
    if (!k) continue;
    const acc = buckets.get(k) ?? { plan: 0, fact: 0 };
    acc.plan += hoursFromRange(r.time_range);
    acc.fact += hoursFromStartEnd(r.fact_start, r.fact_end);
    buckets.set(k, acc);
  }
  const keys = [...buckets.keys()].sort();
  const isDay = range === 'day' || range === 'week' || range === 'month';
  return {
    keys,
    labels: keys.map((k) => chartLabel(k, range)),
    plan: keys.map((k) => Math.round((buckets.get(k)?.plan ?? 0) * 10) / 10),
    fact: keys.map((k) => Math.round((buckets.get(k)?.fact ?? 0) * 10) / 10),
    groups: isDay ? monthGroupsFromDayKeys(keys) : [],
  };
}

/** Строки только по периоду (без фильтра работ). */
export function rowsInPeriod(
  rows: TransportKpiRow[],
  range: AnalyticsRange,
  opts: ComputeTransportKpisOpts = {},
  now = new Date(),
): TransportKpiRow[] {
  const custom = (opts.customDays ?? []).filter(Boolean).sort();
  const months = (opts.customMonths ?? []).filter(Boolean).sort();
  const anchor = opts.anchor ?? defaultPeriodAnchor(now);

  if (range === 'day') {
    // customDays = выбранные дни; пустой набор → нет строк (не «сегодня по умолчанию»)
    if (custom.length === 0) return [];
    const set = new Set(custom);
    return rows.filter((r) => set.has(r.tdate));
  }
  if (range === 'month' && months.length > 0) {
    const set = new Set(months);
    return rows.filter((r) => set.has((r.tdate || '').slice(0, 7)));
  }
  const b = periodBounds(range, anchor, now);
  return rows.filter((r) => inRange(r.tdate, b.start, b.end));
}

/** Все статусы (включая Размещен). % и count от общего числа строк периода. */
function statusBreakdown(rows: TransportKpiRow[]): StatusBreakdown[] {
  const map = new Map<string, number>();
  const den = rows.length || 1;
  for (const r of rows) {
    const st = (r.status || '').trim() || '—';
    map.set(st, (map.get(st) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([status, count]) => ({
      status,
      count,
      pct: Math.round((count / den) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status, 'ru'));
}

function seriesFromBuckets(
  buckets: Map<string, { plan: number; fact: number }>,
  labelRange: AnalyticsRange,
): {
  keys: string[];
  labels: string[];
  plan: number[];
  fact: number[];
  groups: ChartMonthGroup[];
} {
  const keys = [...buckets.keys()].sort();
  const isDay = keys.length > 0 && keys[0]!.length === 10;
  return {
    keys,
    labels: keys.map((k) => chartLabel(k, labelRange)),
    plan: keys.map((k) => Math.round((buckets.get(k)?.plan ?? 0) * 10) / 10),
    fact: keys.map((k) => Math.round((buckets.get(k)?.fact ?? 0) * 10) / 10),
    groups: isDay ? monthGroupsFromDayKeys(keys) : [],
  };
}

function byVehicleType(rows: TransportKpiRow[]): VehicleTypeStat[] {
  const map = new Map<
    string,
    { works: number; ok: number; plan: number; fact: number }
  >();
  let totalFact = 0;
  for (const r of rows) {
    const t = (r.vehicle_type || '').trim() || 'Без типа';
    const acc = map.get(t) ?? { works: 0, ok: 0, plan: 0, fact: 0 };
    acc.works += 1;
    const st = (r.status || '').trim();
    if (st === 'Размещен' || st === 'Дополнение') acc.ok += 1;
    const fh = hoursFromStartEnd(r.fact_start, r.fact_end);
    acc.plan += hoursFromRange(r.time_range);
    acc.fact += fh;
    totalFact += fh;
    map.set(t, acc);
  }
  const den = totalFact || 1;
  return [...map.entries()]
    // Только план без факта (ещё не выполнено) — юзер 2026-08-02: «в факте не показываем».
    .filter(([, v]) => v.fact > 0)
    .map(([type, v]) => ({
      type,
      works: v.works,
      factHours: Math.round(v.fact * 10) / 10,
      planHours: Math.round(v.plan * 10) / 10,
      weightPct: Math.round((v.fact / den) * 1000) / 10,
      okWorks: v.ok,
    }))
    .sort((a, b) => b.factHours - a.factHours || b.works - a.works);
}

function driverStats(
  rows: TransportKpiRow[],
  totalFactHours: number,
  molByFio?: ReadonlyMap<string, boolean>,
): DriverStat[] {
  const map = new Map<string, { phone: string; works: number; factHours: number }>();
  for (const r of rows) {
    const fio = (r.driver || '').trim();
    if (!fio) continue;
    const acc = map.get(fio) ?? { phone: '', works: 0, factHours: 0 };
    acc.works += 1;
    acc.factHours += hoursFromStartEnd(r.fact_start, r.fact_end);
    if (!acc.phone && r.driver_phone) acc.phone = formatPhoneRu(r.driver_phone);
    map.set(fio, acc);
  }
  const den = totalFactHours || 1;
  return [...map.entries()]
    // Только план без факта (ещё не выполнено) — юзер 2026-08-02: «в факте не показываем».
    .filter(([, v]) => v.factHours > 0)
    .map(([fio, v]) => ({
      fio,
      phone: v.phone,
      works: v.works,
      factHours: Math.round(v.factHours * 10) / 10,
      workPct: Math.round((v.factHours / den) * 1000) / 10,
      isMol: Boolean(molByFio?.get(fio) || molByFio?.get(fio.toUpperCase())),
    }))
    .sort((a, b) => b.factHours - a.factHours || b.works - a.works)
    .slice(0, 50);
}

export function computeTransportKpis(
  rows: TransportKpiRow[],
  range: AnalyticsRange,
  now = new Date(),
  opts: ComputeTransportKpisOpts = {},
): TransportKpis {
  const custom = (opts.customDays ?? []).filter(Boolean).sort();
  const months = (opts.customMonths ?? []).filter(Boolean).sort();
  const anchor = opts.anchor ?? defaultPeriodAnchor(now);

  const inPeriod = rowsInPeriod(rows, range, opts, now);
  const availableWorks = uniqueWorkNames(inPeriod);

  let cur = inPeriod;
  if (opts.includedWorks && opts.includedWorks.size > 0) {
    cur = inPeriod.filter((r) => opts.includedWorks!.has((r.work || '').trim()));
  } else if (opts.includedWorks && opts.includedWorks.size === 0) {
    cur = [];
  }
  // Пустые строки (нет ни плана, ни факта) не считаем «машиной в этом дне».
  cur = cur.filter(rowHasActivity);

  let periodLabel: string;
  let chartRange: AnalyticsRange = range;
  if (range === 'day' && custom.length > 0) {
    periodLabel = formatPeriodLabel('day', anchor, custom);
    chartRange = 'day';
  } else if (range === 'month' && months.length > 0) {
    periodLabel = formatMonthsLabel(months);
    // Несколько месяцев → дневные точки на линейном графике
    chartRange = months.length > 1 ? 'day' : 'month';
  } else {
    periodLabel = periodBounds(range, anchor, now).label;
  }

  let totalPlan = 0;
  let totalFact = 0;
  let doneCount = 0;
  let extraCount = 0;
  for (const r of cur) {
    totalPlan += hoursFromRange(r.time_range);
    totalFact += hoursFromStartEnd(r.fact_start, r.fact_end);
    const st = (r.status || '').trim();
    if (st === 'Размещен') doneCount += 1;
    if (st === 'Дополнение') extraCount += 1;
  }

  /**
   * График только по строкам cur (где есть машины).
   * Агрегация = chartGrain: день / неделя / месяц / квартал / год.
   * Пустые периоды без строк не рисуем.
   */
  const grain: PeriodGrain = opts.chartGrain ?? 'day';

  let series: ReturnType<typeof bucketSeries>;
  let chartMode: 'bar' | 'line';

  if (cur.length === 0) {
    series = { keys: [], labels: [], plan: [], fact: [], groups: [] };
    chartMode = 'bar';
  } else {
    const raw = new Map<string, { plan: number; fact: number }>();
    for (const r of cur) {
      const td = (r.tdate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(td)) continue;
      const k = grainBucketKey(td, grain);
      if (!k) continue;
      const acc = raw.get(k) ?? { plan: 0, fact: 0 };
      acc.plan += hoursFromRange(r.time_range);
      acc.fact += hoursFromStartEnd(r.fact_start, r.fact_end);
      raw.set(k, acc);
    }
    const keys = [...raw.keys()].sort();
    series = {
      keys,
      labels: keys.map((k) => grainBucketLabel(k, grain)),
      plan: keys.map((k) => Math.round((raw.get(k)?.plan ?? 0) * 10) / 10),
      fact: keys.map((k) => Math.round((raw.get(k)?.fact ?? 0) * 10) / 10),
      groups: grain === 'day' ? monthGroupsFromDayKeys(keys) : [],
    };
    chartMode = series.keys.length <= 1 ? 'bar' : 'line';
  }

  void chartRange;

  const planH = Math.round(totalPlan * 10) / 10;
  const factH = Math.round(totalFact * 10) / 10;

  return {
    periodLabel,
    worksCount: cur.length,
    doneCount,
    extraCount,
    statusBreakdown: statusBreakdown(cur),
    totalPlanHours: planH,
    totalFactHours: factH,
    hoursDiff: Math.round((factH - planH) * 10) / 10,
    chartMode,
    chartLabels: series.labels,
    chartKeys: series.keys,
    chartGroups: series.groups,
    planHours: series.plan,
    factHours: series.fact,
    byType: byVehicleType(cur),
    drivers: driverStats(cur, totalFact, opts.molByFio),
    availableWorks,
  };
}

export function formatMonthRu(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m?.[1] || !m[2]) return ym;
  const mi = Number(m[2]) - 1;
  return `${MONTH_FULL[mi] ?? m[2]} ${m[1]}`;
}

/** Все дни месяца YYYY-MM-DD. */
export function daysOfMonth(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  return out;
}

/** Все дни квартала (1–4). */
export function daysOfQuarter(year: number, quarter: 1 | 2 | 3 | 4): string[] {
  const m0 = (quarter - 1) * 3 + 1;
  return [...daysOfMonth(year, m0), ...daysOfMonth(year, m0 + 1), ...daysOfMonth(year, m0 + 2)];
}

/** Все дни года. */
export function daysOfYear(year: number): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m += 1) out.push(...daysOfMonth(year, m));
  return out;
}

/**
 * Зерно графика — не кнопка, а вывод из формы выбранных дней (юзер 2026-08-02:
 * «зерно графика убираем, в календаре уже настроено»):
 *  · есть хоть один НЕполный месяц → по дням (сравнивать нечего/дни вперемешку);
 *  · один полный месяц → по дням (сравнивать не с чем);
 *  · 2+ полных месяца, из них год целиком → по месяцам (год разбит на месяцы);
 *  · 2+ полных месяца, ровно целые кварталы → по кварталам;
 *  · 2+ полных месяца иначе → по месяцам.
 */
export function inferChartGrain(days: ReadonlySet<string>): PeriodGrain {
  if (days.size === 0) return 'day';
  const countByMonth = new Map<string, number>();
  for (const d of days) {
    const ym = d.slice(0, 7);
    countByMonth.set(ym, (countByMonth.get(ym) ?? 0) + 1);
  }
  const wholeMonths: string[] = [];
  for (const [ym, count] of countByMonth) {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    if (count !== daysOfMonth(y, m).length) return 'day';
    wholeMonths.push(ym);
  }
  if (wholeMonths.length <= 1) return 'day';

  const monthsByYear = new Map<string, Set<number>>();
  for (const ym of wholeMonths) {
    const y = ym.slice(0, 4);
    const m = Number(ym.slice(5, 7));
    (monthsByYear.get(y) ?? monthsByYear.set(y, new Set()).get(y)!).add(m);
  }
  for (const months of monthsByYear.values()) {
    if (months.size === 12) return 'month';
  }

  const quarterOf = (m: number): number => Math.floor((m - 1) / 3) + 1;
  for (const months of monthsByYear.values()) {
    for (const m of months) {
      const q = quarterOf(m);
      const qMonths = [1, 2, 3].map((i) => (q - 1) * 3 + i);
      if (!qMonths.every((qm) => months.has(qm))) return 'month';
    }
  }
  return 'quarter';
}

/** Дни недели (пн–вс), monIso = понедельник. */
export function daysOfWeekFromMon(monIso: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monIso)) return [];
  const mon = new Date(monIso + 'T12:00:00');
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) out.push(toIso(addDays(mon, i)));
  return out;
}

/** Текущий месяц целиком (по умолчанию для дашборда). */
export function defaultPeriodDays(now = new Date()): string[] {
  return daysOfMonth(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Ближайший день с реальными данными (юзер 2026-08-02: «самый актуальный день по
 * стандарту» — если сегодня 2-е число, а машин нет, показать 3-е). Идём вперёд/назад
 * от `from` по одному дню; при равном расстоянии — вперёд (в будущее) побеждает.
 */
export function nearestDataDay(dataDays: ReadonlySet<string>, from: string, maxScan = 120): string | null {
  if (dataDays.has(from)) return from;
  const base = new Date(from + 'T12:00:00');
  for (let i = 1; i <= maxScan; i += 1) {
    const fwd = toIso(addDays(base, i));
    if (dataDays.has(fwd)) return fwd;
    const back = toIso(addDays(base, -i));
    if (dataDays.has(back)) return back;
  }
  return null;
}

/** Подпись периода из набора дней. */
export function labelFromSelectedDays(days: string[]): string {
  const sorted = [...days].filter(Boolean).sort();
  if (sorted.length === 0) return 'Период не выбран';
  return formatPeriodLabel('day', defaultPeriodAnchor(), sorted);
}

/** Ключ бакета графика по зерну. */
export function grainBucketKey(tdate: string, grain: PeriodGrain): string {
  const td = (tdate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(td)) return '';
  if (grain === 'day') return td;
  if (grain === 'week') {
    const mon = startOfWeekMon(new Date(td + 'T12:00:00'));
    return toIso(mon);
  }
  if (grain === 'month') return td.slice(0, 7);
  if (grain === 'quarter') {
    const y = td.slice(0, 4);
    const m = Number(td.slice(5, 7));
    const q = (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
    return `${y}-Q${q}`;
  }
  return td.slice(0, 4);
}

export function grainBucketLabel(key: string, grain: PeriodGrain): string {
  if (grain === 'day') {
    // Юзер 2026-08-02: под осью — голое число дня (без ведущих нулей, без месяца);
    // месяц(ы) читаются по group-полосе (monthGroupsFromDayKeys) под осью.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m?.[1] || !m[2] || !m[3]) return key;
    return `${Number(m[3])}`;
  }
  if (grain === 'week') {
    const mon = key;
    const sun = toIso(addDays(new Date(mon + 'T12:00:00'), 6));
    return `${fmtDayMonth(mon)}–${fmtDayMonth(sun)}`.replace(/\s+/g, ' ').trim();
  }
  if (grain === 'month') return formatMonthRu(key);
  if (grain === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!m?.[1] || !m[2]) return key;
    return `Q${m[2]} ${m[1]}`;
  }
  return key;
}
