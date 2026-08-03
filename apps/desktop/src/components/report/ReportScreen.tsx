import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Loader2, Printer } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import {
  computeFlowReport,
  emptyReportManualDay,
  flowDeliveriesGet,
  flowReportManualGet,
  flowReportManualSet,
  formatReportDaysTitle,
  type FlowDeliveriesChangedEvent,
  type FlowDeliveryRow,
  type ReportComputeResult,
  type ReportManualDay,
  type ReportManualLine,
  type ReportMode,
} from '@pyn/core';
import { nearestGraphDate } from '@/components/flow/flow-sandbox.fixtures';
import { whKey, whMapGet } from '@/components/flow/flow-warehouse';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  canUseLiveWarehouseScheduleForMonth,
  monthKey,
  useScheduleMonthsMeta,
} from '@/lib/schedule/use-schedule-sync';
import { useWsEvent } from '@/lib/ws';
import { useWarehousesStore } from '@/lib/warehouses-store';
import '@/components/pyn-dash/pyn-dash.css';
import {
  DashShell,
  DashHeader,
  DashPanel,
  DashList,
  DashRow,
  DashEmpty,
  DashChip,
} from '@/components/pyn-dash';
import { PynCalendar } from '@/components/pyn-table/PynCalendar';
import { daysOfQuarter, daysOfYear, nearestDataDay } from '@/components/flow/flow-transport-kpi';
import { ReportPrint } from './ReportPrint';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';
import {
  buildReportFleetGroups,
  countFleetPeople,
  countFleetVehicles,
  expeditorId,
  fleetGroupLine1,
  type ExpedGroup,
  type FleetFlowRole,
} from './report-fleet';
import { WorkspaceSurfaceToggle } from '@/components/WorkspaceSurfaceToggle';
import { useWorkspaceSurface } from '@/lib/workspace-surface';
import '@/components/workspace-surface.css';

function isoToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function monthOfDate(iso: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return Number.isInteger(year) && Number.isInteger(month) ? { year, month } : null;
}

/** День графика склада из frozen shops (как FlowPlanGrid). */
function frozenWeekdayOf(
  shops: ReadonlyArray<{
    rows: ReadonlyArray<{ weekday: string; warehouses: ReadonlyArray<{ code: string }> }>;
  }>,
  code: string,
): string | null {
  const target = whKey(code);
  if (!target) return null;
  for (const shop of shops) {
    for (const row of shop.rows) {
      if (row.warehouses.some((w) => whKey(w.code) === target)) return row.weekday;
    }
  }
  return null;
}

/**
 * Календарь дней сводки — как в Транспорте (PynCalendar):
 * месяц, «все дни», сброс, кварталы/год, подсветка дней с отчётом.
 */
function ReportDayPicker({
  selected,
  onChange,
  dayHints,
}: {
  selected: string[];
  onChange: (days: string[]) => void;
  /** iso → fixed report rows exist */
  dayHints: Map<string, boolean>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [qYear, setQYear] = useState(() => new Date().getFullYear());
  const selSet = useMemo(() => new Set(selected), [selected]);
  const sorted = useMemo(() => [...selected].sort(), [selected]);
  const dataDays = useMemo(() => {
    const s = new Set<string>();
    for (const [iso, ok] of dayHints) if (ok) s.add(iso);
    return s;
  }, [dayHints]);

  const setSel = (next: Set<string>): void => {
    onChange([...next].sort());
  };

  const quarterDays = (q: 1 | 2 | 3 | 4): string[] => daysOfQuarter(qYear, q);
  const quarterOn = (q: 1 | 2 | 3 | 4): boolean => {
    const d = quarterDays(q);
    return d.length > 0 && d.every((x) => selSet.has(x));
  };
  const toggleQuarter = (q: 1 | 2 | 3 | 4): void => {
    const d = quarterDays(q);
    const next = new Set(selSet);
    if (quarterOn(q)) {
      for (const x of d) next.delete(x);
    } else {
      for (const x of d) next.add(x);
    }
    setSel(next);
  };
  const yearOn = ([1, 2, 3, 4] as const).every((q) => quarterOn(q));
  const yearHasSelection = daysOfYear(qYear).some((d) => selSet.has(d));
  const toggleYear = (): void => {
    const days = daysOfYear(qYear);
    if (yearOn) {
      const next = new Set(selSet);
      for (const d of days) next.delete(d);
      setSel(next);
    } else {
      setSel(new Set([...selSet, ...days]));
    }
  };

  const label =
    sorted.length === 0
      ? 'Выбрать дни'
      : sorted.length === 1
        ? formatReportDaysTitle(sorted) || sorted[0]
        : `${formatReportDaysTitle(sorted)} · дней ${sorted.length}`;

  const active = selected.length > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Выбор дней сводки"
          className={cn(
            'flex h-6 max-w-[260px] items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
            active || open
              ? 'border-accent-clay/55 bg-accent-clay-bg text-accent-clay'
              : 'border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-secondary',
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="pyn-popover z-[200] w-[300px] border border-white/10 bg-[#2a2926] p-3 shadow-xl"
        >
          <PynCalendar
            selected={selSet}
            onChange={setSel}
            dataDays={dataDays}
            onReset={() => onChange([])}
            resetEnabled={selected.length > 0}
            primaryActionLabel="Последнее"
            onPrimaryAction={() => {
              const d = nearestDataDay(dataDays, isoToday()) ?? isoToday();
              onChange([d]);
            }}
          />
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Год · кварталы
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:text-zinc-200"
                  onClick={() => setQYear((y) => y - 1)}
                  aria-label="Предыдущий год"
                >
                  <ChevronLeft size={13} strokeWidth={1.75} />
                </button>
                <span
                  className={`w-9 text-center text-[11px] tabular-nums ${
                    yearHasSelection ? 'font-semibold text-[#e8a48a]' : 'text-zinc-300'
                  }`}
                >
                  {qYear}
                </span>
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:text-zinc-200"
                  onClick={() => setQYear((y) => y + 1)}
                  aria-label="Следующий год"
                >
                  <ChevronRight size={13} strokeWidth={1.75} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <DashChip active={yearOn} onClick={toggleYear}>
                Весь год
              </DashChip>
              {([1, 2, 3, 4] as const).map((q) => (
                <DashChip key={q} active={quarterOn(q)} onClick={() => toggleQuarter(q)}>
                  Q{q}
                </DashChip>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const MONTH_SHORT_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Подпись дня над ячейкой: «июл 22»; год только если ≠ текущий. */
function formatDayHead(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10)); // без ведущего нуля
  if (!y || !m || !day) return iso;
  const mon = MONTH_SHORT_RU[m - 1] ?? '';
  const curY = new Date().getFullYear();
  return y !== curY ? `${mon} ${day} ${y}` : `${mon} ${day}`;
}

/** Число — text-[12px]; без spinner-стрелок, просто ввод. */
function ManualNum({
  value,
  onChange,
  className,
  disabled,
  title,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText(value == null ? '' : String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      title={title}
      autoComplete="off"
      spellCheck={false}
      className={cn(
        'h-6 w-12 rounded border border-[var(--pd-border)] bg-black/20 px-1 text-left text-[12px] tabular-nums text-[var(--pd-text)] outline-none focus:border-[var(--pd-accent)]/50 disabled:opacity-40',
        className,
      )}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          onChange(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** Перед сохранением: одна строка тоннажа (массив для совместимости API). */
function cleanLines(lines: ReportManualLine[]): ReportManualLine[] {
  const tons = lines.find((l) => l.tons != null)?.tons ?? null;
  return tons == null ? [] : [{ warehouse: '', tons }];
}

type NumKey = 'sick' | 'vacation' | 'wood_prop' | 'shields' | 'goods_yard' | 'otl';

type B1Row =
  | { kind: 'head'; title: string }
  | {
      kind: 'data';
      label: string;
      unit: string;
      valueOf: (d: string) => number | null;
      onChange: (d: string, v: number | null) => void;
    };

/**
 * Блок 1:
 *  • 1-я строка: «Блок 1» | ЕИ | даты… (даты один раз)
 *  • далее секции ОТЛ / ДОК / … без повтора дат
 *  • слева sticky (название+ЕИ), справа scroll только дней (basis 0)
 */
function ManualBlock({
  days,
  byDay,
  onPatchDay,
}: {
  days: string[];
  byDay: Record<string, ReportManualDay>;
  onPatchDay: (day: string, patch: Partial<ReportManualDay>) => void;
}): JSX.Element {
  const headCls =
    'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pd-faint,#a6a39b)] whitespace-nowrap text-left';
  const rowH = 'h-7';
  const labelW = 'w-[13.5rem]';
  const unitW = 'w-8';
  const dayW = 'w-14';

  const numOf = (day: string, key: NumKey): number | null => {
    const v = byDay[day]?.[key];
    return typeof v === 'number' || v === null || v === undefined ? (v ?? null) : null;
  };
  const refrOf = (day: string): number | null => {
    const a = byDay[day]?.refr_9010;
    const b = byDay[day]?.refr_9030;
    if (typeof a === 'number') return a;
    if (typeof b === 'number') return b;
    return null;
  };
  const tonsOf = (day: string, field: 'lining' | 'restow'): number | null => {
    const line = byDay[day]?.[field]?.[0];
    return line && typeof line.tons === 'number' ? line.tons : null;
  };
  const setTons = (day: string, field: 'lining' | 'restow', tons: number | null): void => {
    onPatchDay(day, {
      [field]: tons == null ? [] : [{ warehouse: '', tons }],
    });
  };

  const rows: B1Row[] = [
    { kind: 'head', title: 'ОТЛ' },
    { kind: 'data', label: 'На больничном', unit: 'чел.', valueOf: (d) => numOf(d, 'sick'), onChange: (d, v) => onPatchDay(d, { sick: v }) },
    { kind: 'data', label: 'В отпуске', unit: 'чел.', valueOf: (d) => numOf(d, 'vacation'), onChange: (d, v) => onPatchDay(d, { vacation: v }) },
    { kind: 'data', label: 'Технология', unit: 'т', valueOf: (d) => numOf(d, 'otl'), onChange: (d, v) => onPatchDay(d, { otl: v }) },
    { kind: 'data', label: 'Товарный двор', unit: 'конт.', valueOf: (d) => numOf(d, 'goods_yard'), onChange: (d, v) => onPatchDay(d, { goods_yard: v }) },
    { kind: 'head', title: 'ДОК' },
    { kind: 'data', label: 'Реквизит деревянный', unit: 'рейс', valueOf: (d) => numOf(d, 'wood_prop'), onChange: (d, v) => onPatchDay(d, { wood_prop: v }) },
    { kind: 'data', label: 'Щиты', unit: 'рейс', valueOf: (d) => numOf(d, 'shields'), onChange: (d, v) => onPatchDay(d, { shields: v }) },
    { kind: 'head', title: 'Огнеупоры 9010 и 9030' },
    { kind: 'data', label: 'В рамках общей технологии', unit: 'т', valueOf: refrOf, onChange: (d, v) => onPatchDay(d, { refr_9010: v, refr_9030: v }) },
    { kind: 'data', label: 'Футеровка', unit: 'т', valueOf: (d) => tonsOf(d, 'lining'), onChange: (d, v) => setTons(d, 'lining', v) },
    { kind: 'data', label: 'Перескладировка', unit: 'т', valueOf: (d) => tonsOf(d, 'restow'), onChange: (d, v) => setTons(d, 'restow', v) },
  ];

  return (
    <div className="box-border min-w-0 w-full max-w-full overflow-hidden">
      {/*
        Слева sticky (без боковой линии), справа scroll дней.
        Разделители секций — тонкая линия от середины заголовка ОТЛ/ДОК/Огнеупоры.
      */}
      <div className="flex w-full min-w-0 max-w-full">
        {/* ─── фиксация: название + ЕИ ─── */}
        <div className="z-[1] shrink-0 bg-[var(--pd-elevated,#302f2d)] pr-2">
          {/* шапка: Показатель | ЕИ */}
          <div className={cn('flex items-center gap-2', rowH)}>
            <span className={cn(headCls, labelW, 'shrink-0')}>Показатель</span>
            <span className={cn(headCls, unitW, 'shrink-0')}>ЕИ</span>
          </div>
          {rows.map((r, i) =>
            r.kind === 'head' ? (
              <div
                key={`L-h-${i}`}
                className={cn('flex items-center', rowH)}
                style={{ width: 'calc(13.5rem + 0.5rem + 2rem)' }}
              >
                {/* ОТЛ/ДОК/… + тонкая линия от середины вправо (без боковой) */}
                <span className={cn(headCls, 'mr-2 shrink-0 text-[var(--pd-accent-soft)]')}>
                  {r.title}
                </span>
                <span className="h-px min-w-[1rem] flex-1 bg-[var(--pd-border)]" />
              </div>
            ) : (
              <div key={`L-d-${i}`} className={cn('flex items-center gap-2', rowH)}>
                <span
                  className={cn(
                    labelW,
                    'shrink-0 truncate text-left text-[12px] leading-none text-[var(--pd-text)]',
                  )}
                  title={r.label}
                >
                  {r.label}
                </span>
                <span
                  className={cn(
                    unitW,
                    'shrink-0 text-left text-[12px] tabular-nums text-[var(--pd-faint)]',
                  )}
                >
                  {r.unit}
                </span>
              </div>
            ),
          )}
        </div>

        {/* ─── дни: один scroll (даты + ячейки) ─── */}
        <div
          className="min-w-0 overflow-x-auto overscroll-x-contain"
          style={{ flex: '1 1 0%', width: 0 }}
        >
          <div className="inline-block min-w-full">
            <div className={cn('flex items-center', rowH)}>
              {days.length === 0 ? (
                <span className="px-1 text-[12px] text-[var(--pd-faint)]">выберите дни →</span>
              ) : (
                days.map((d) => (
                  <div key={d} className={cn(headCls, dayW, 'shrink-0 px-1')}>
                    {formatDayHead(d)}
                  </div>
                ))
              )}
            </div>
            {days.length > 0 &&
              rows.map((r, i) =>
                r.kind === 'head' ? (
                  <div key={`R-h-${i}`} className={cn('relative flex items-center', rowH)}>
                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--pd-border)]" />
                    {days.map((d) => (
                      <div key={d} className={cn(dayW, 'relative z-[1] shrink-0 px-1')} />
                    ))}
                  </div>
                ) : (
                  <div key={`R-d-${i}`} className={cn('flex items-center', rowH)}>
                    {days.map((d) => (
                      <div key={d} className={cn('flex shrink-0 justify-start px-1', dayW)}>
                        <ManualNum
                          value={r.valueOf(d)}
                          onChange={(v) => r.onChange(d, v)}
                        />
                      </div>
                    ))}
                  </div>
                ),
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Блок 2: машины / тип ТС / экспедиторы / От·СП.
 * embedded — внутри DashPanel (без своего заголовка).
 */
function FleetBlock({
  groups,
  embedded = false,
}: {
  groups: ExpedGroup[];
  embedded?: boolean;
}): JSX.Element | null {
  if (groups.length === 0) return null;

  return (
    <div className="box-border min-w-0 w-full max-w-full overflow-hidden">
      <div
        className={cn(
          'max-h-[min(40vh,320px)] min-w-0 overflow-y-auto overflow-x-hidden',
          !embedded && 'rounded-lg border border-[var(--pd-border)]',
        )}
      >
        <ul className="m-0 list-none space-y-0 p-0">
          {groups.map((g, i) => (
            <li
              key={`${g.garage || 'none'}-${i}`}
              className="border-b border-[var(--pd-border)] px-1 py-2 last:border-b-0 text-[12.5px] leading-snug text-[var(--pd-text)]"
            >
              <p className="m-0 break-words font-medium text-[var(--pd-text-strong)]">
                {fleetGroupLine1(g)}
              </p>
              <p className="m-0 mt-0.5 break-words text-[11px] text-[var(--pd-muted)]">
                <span className="text-[var(--pd-faint)]">От:</span> {g.frList || '—'}
              </p>
              <p className="m-0 mt-0.5 break-words text-[11px] text-[var(--pd-muted)]">
                <span className="text-[var(--pd-faint)]">СП:</span> {g.toList || '—'}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function shopWord(n: number): string {
  if (n === 1) return 'цех';
  if (n > 1 && n < 5) return 'цеха';
  return 'цехов';
}

function whWord(n: number): string {
  if (n === 1) return 'склад';
  if (n > 1 && n < 5) return 'склада';
  return 'складов';
}

function shippedTone(p: number): 'ok' | 'accent' | 'danger' {
  if (p >= 90) return 'ok';
  if (p >= 60) return 'accent';
  return 'danger';
}

function pctOf(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

/** ISO → день недели графика (ПН…ВС). */
function isoToWeekdayRu(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][d.getDay()] ?? '';
}

function normWd(s: string): string {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е');
}

/**
 * План по графику за выбранные дни: уникальные цеха и склады (to_wh),
 * которые по графику должны получать в эти дни.
 */
function computePlanFromSchedule(
  days: readonly string[],
  scheduleMetaMap: Map<
    string,
    {
      exists: boolean;
      shops: ReadonlyArray<{
        name: string;
        rows: ReadonlyArray<{
          weekday: string;
          warehouses: ReadonlyArray<{ code: string }>;
        }>;
      }>;
    }
  >,
  whByKey: Map<string, { id: string; shop_name?: string; in_schedule?: number; delivery_day?: string | null }>,
): { planShops: number; planWarehouses: number } {
  const shopSet = new Set<string>();
  const whSet = new Set<string>();

  for (const iso of days) {
    const wd = normWd(isoToWeekdayRu(iso));
    if (!wd) continue;
    const m = monthOfDate(iso);
    if (!m) continue;
    const meta = scheduleMetaMap.get(monthKey(m.year, m.month));

    if (meta?.shops?.length) {
      for (const shop of meta.shops) {
        const shopName = (shop.name || '').trim() || '—';
        for (const row of shop.rows) {
          if (normWd(row.weekday) !== wd) continue;
          for (const w of row.warehouses) {
            const code = whKey(w.code);
            if (!code) continue;
            whSet.add(code);
            shopSet.add(shopName);
          }
        }
      }
      continue;
    }

    if (
      canUseLiveWarehouseScheduleForMonth(m.year, m.month) &&
      (!meta || meta.exists !== false)
    ) {
      for (const w of whByKey.values()) {
        if (Number(w.in_schedule) !== 1) continue;
        if (normWd(String(w.delivery_day || '')) !== wd) continue;
        const code = whKey(w.id);
        if (!code) continue;
        whSet.add(code);
        const shop = (w.shop_name || '').trim() || code;
        shopSet.add(shop);
      }
    }
  }

  return { planShops: shopSet.size, planWarehouses: whSet.size };
}

/** Плитка KPI: верх = White, низ = Black. half = 2 колонки сетки. */
function SplitKpi({
  label,
  white,
  black,
  half,
}: {
  label: string;
  white: { value: ReactNode; meta?: ReactNode; tone?: 'ok' | 'accent' | 'danger' | 'default' };
  black: { value: ReactNode; meta?: ReactNode; tone?: 'ok' | 'accent' | 'danger' | 'default' };
  half?: boolean;
}): JSX.Element {
  const toneCls = (t?: string) =>
    t === 'ok'
      ? 'text-[var(--pd-ok-text)]'
      : t === 'accent'
        ? 'text-[var(--pd-accent-soft)]'
        : t === 'danger'
          ? 'text-[var(--pd-danger-soft)]'
          : 'text-[var(--pd-text-strong)]';

  const halfRow = (
    side: 'W' | 'B',
    data: { value: ReactNode; meta?: ReactNode; tone?: string },
  ) => (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col justify-center px-3.5 py-3',
        side === 'B' && 'bg-black/15',
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={cn(
            'report-side-dot inline-block h-2 w-2 shrink-0 rounded-full ring-2',
            side === 'W'
              ? 'report-side-dot--w bg-amber-400 ring-amber-200/50'
              : 'report-side-dot--b bg-zinc-300 ring-white/35',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'report-side-label text-[9px] font-semibold uppercase tracking-[0.12em]',
            side === 'W' ? 'report-side-label--w text-amber-200/90' : 'report-side-label--b text-zinc-300',
          )}
        >
          {side}
        </span>
      </div>
      <div
        className={cn(
          'text-[1.55rem] font-semibold tabular-nums leading-none tracking-tight',
          toneCls(data.tone),
        )}
      >
        {data.value}
      </div>
      {data.meta != null ? (
        <div className="mt-1.5 text-[12px] leading-snug tabular-nums text-[var(--pd-muted)]">
          {data.meta}
        </div>
      ) : null}
    </div>
  );

  return (
    <article
      className={cn(
        'pyn-dash-kpi !min-h-0 !p-0 overflow-hidden',
        half && 'pyn-dash-span-half',
      )}
    >
      <div className="border-b border-[var(--pd-border)] px-3.5 py-2">
        <span className="pyn-dash-kpi-label !mb-0">{label}</span>
      </div>
      <div className="flex min-h-[5.5rem] divide-x divide-[var(--pd-border)]">
        {halfRow('W', white)}
        {halfRow('B', black)}
      </div>
    </article>
  );
}

/** Большой блок: нет/вне графика + склады (% позиций/складов от плана). */
function GraphDetailPanel({
  result,
  planWarehouses,
}: {
  result: ReportComputeResult;
  planWarehouses: number;
}): JSX.Element {
  const ni = result.notInStats;
  const of = result.offStats;
  const whTotal = result.warehouseCount;
  const planPos = result.total; // позиции плана периода = все зафиксированные
  const posPct = (n: number) => pctOf(n, planPos);
  const whPct = (n: number) => pctOf(n, planWarehouses);
  const whPlanPct = pctOf(whTotal, planWarehouses);

  const sliceLines = (s: typeof ni) => (
    <>
      <div>
        {s.positions}{' '}
        {s.positions === 1 ? 'позиция' : s.positions > 1 && s.positions < 5 ? 'позиции' : 'позиций'}
        {planPos > 0 ? (
          <>
            {' '}
            <span className="text-[var(--pd-muted)]">{posPct(s.positions)}% от плана</span>
          </>
        ) : null}
      </div>
      <div>
        {s.warehouses} {whWord(s.warehouses)}
        {planWarehouses > 0 ? (
          <>
            {' '}
            <span className="text-[var(--pd-muted)]">{whPct(s.warehouses)}% от плана</span>
          </>
        ) : null}
      </div>
    </>
  );

  return (
    <DashPanel full tightHead title="График и склады" className="pyn-dash-span-full">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--pd-border)] bg-black/10 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
            Нет в графике
          </div>
          <div
            className={cn(
              'mt-1 text-[1.45rem] font-semibold tabular-nums leading-none',
              ni.shops > 0 ? 'text-[var(--pd-danger-soft)]' : 'text-[var(--pd-text-strong)]',
            )}
          >
            {ni.shops}
            <span className="ml-1.5 text-[0.95rem] font-medium text-[var(--pd-muted)]">
              {shopWord(ni.shops)}
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-[var(--pd-faint)]">
            {sliceLines(ni)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--pd-border)] bg-black/10 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
            Вне графика
          </div>
          <div
            className={cn(
              'mt-1 text-[1.45rem] font-semibold tabular-nums leading-none',
              of.shops > 0 ? 'text-[var(--pd-accent-soft)]' : 'text-[var(--pd-text-strong)]',
            )}
          >
            {of.shops}
            <span className="ml-1.5 text-[0.95rem] font-medium text-[var(--pd-muted)]">
              {shopWord(of.shops)}
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-[var(--pd-faint)]">
            {sliceLines(of)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--pd-border)] bg-black/10 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
            Склады
          </div>
          <div className="mt-1 text-[1.45rem] font-semibold tabular-nums leading-none text-[var(--pd-text-strong)]">
            {planWarehouses > 0 ? (
              <>
                {whPlanPct}
                <span className="text-[0.95rem] font-medium text-[var(--pd-muted)]">%</span>
              </>
            ) : (
              whTotal
            )}
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-[var(--pd-faint)]">
            <div>
              {planWarehouses > 0 ? (
                <>
                  {whTotal} из {planWarehouses}
                </>
              ) : (
                <>{whTotal}</>
              )}
            </div>
            <div>
              нет в графике {ni.warehouses}
              {planWarehouses > 0 ? (
                <span className="text-[var(--pd-muted)]"> ({whPct(ni.warehouses)}%)</span>
              ) : null}
              {' · '}
              вне {of.warehouses}
              {planWarehouses > 0 ? (
                <span className="text-[var(--pd-muted)]"> ({whPct(of.warehouses)}%)</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </DashPanel>
  );
}

/**
 * Панель White / Black — без дубля KPI: списки + причины (PDF = Блок 1).
 */
function ModePanel({
  mode,
  title,
  result,
  daysTitle,
  hasFleet,
  printMsg,
  onPrint,
}: {
  mode: ReportMode;
  title: string;
  result: ReportComputeResult;
  daysTitle: string;
  hasFleet: boolean;
  printMsg?: string;
  onPrint: (kind: 'dialog' | 'save', includeFleet: boolean) => void;
}): JSX.Element {
  const notIn = result.notInScheduleShops;
  const off = result.offScheduleShops;
  const shops = result.tree;
  const emptyHint = !daysTitle && result.total === 0;
  /** Тумблер «Блок 3» — по умолчанию выключен (юзер 2026-08-02). */
  const [includeFleet, setIncludeFleet] = useState(false);

  return (
    <DashPanel
      half
      tightHead
      title={
        <span className="inline-flex items-center gap-2">
          <span
            className={cn(
              'report-side-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2',
              mode === 'white'
                ? 'report-side-dot--w bg-amber-400 ring-amber-200/50'
                : 'report-side-dot--b bg-zinc-300 ring-white/35',
            )}
            aria-hidden
          />
          {title}
        </span>
      }
      headRight={
        <span className="flex items-center gap-1.5">
          {printMsg && (
            <span className="max-w-[140px] truncate text-[10.5px] text-[var(--pd-faint)]" title={printMsg}>
              {printMsg}
            </span>
          )}
          {hasFleet && (
            <button
              type="button"
              disabled={emptyHint}
              onClick={() => setIncludeFleet((v) => !v)}
              title={
                includeFleet
                  ? 'Блок 3 (ТС и экспедиторы) войдёт в печать/PDF'
                  : 'Блок 3 (ТС и экспедиторы) не войдёт в печать/PDF'
              }
              className={cn(
                'flex h-7 items-center rounded-md border px-2 text-[11.5px] font-medium outline-none transition-colors disabled:opacity-40',
                includeFleet
                  ? 'border-[var(--pd-accent)]/50 bg-[var(--pd-accent-dim)] text-[var(--pd-accent-soft)]'
                  : 'border-white/[0.1] bg-white/[0.04] text-[var(--pd-text)] hover:border-[var(--pd-accent)]/40 hover:bg-[var(--pd-accent-dim)]',
              )}
            >
              Блок 3
            </button>
          )}
          <button
            type="button"
            disabled={emptyHint}
            onClick={() => onPrint('dialog', includeFleet)}
            title="Печать"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] text-[var(--pd-text)] outline-none transition-colors hover:border-[var(--pd-accent)]/40 hover:bg-[var(--pd-accent-dim)] hover:text-[var(--pd-accent-soft)] disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={emptyHint}
            onClick={() => onPrint('save', includeFleet)}
            title="Скачать PDF"
            className="flex h-7 items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 text-[11.5px] font-medium text-[var(--pd-text)] outline-none transition-colors hover:border-[var(--pd-accent)]/40 hover:bg-[var(--pd-accent-dim)] hover:text-[var(--pd-accent-soft)] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            PDF
          </button>
        </span>
      }
      className={mode === 'white' ? 'ring-1 ring-amber-200/10' : 'ring-1 ring-slate-300/10'}
    >
      {emptyHint ? (
        <DashEmpty>Выберите дни для расчёта</DashEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          {notIn.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
                Нет в графике · {notIn.length} {shopWord(notIn.length)}
              </div>
              <DashList>
                {notIn.map((name, i) => (
                  <DashRow
                    key={name}
                    titleWrap
                    leading={
                      <span className="w-4 shrink-0 pt-0.5 text-center text-[12px] tabular-nums text-[var(--pd-faint)]">
                        {i + 1}.
                      </span>
                    }
                    title={name}
                  />
                ))}
              </DashList>
            </div>
          )}

          {off.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
                Вне графика · {off.length} {shopWord(off.length)}
              </div>
              <DashList>
                {off.map((name, i) => (
                  <DashRow
                    key={name}
                    titleWrap
                    leading={
                      <span className="w-4 shrink-0 pt-0.5 text-center text-[12px] tabular-nums text-[var(--pd-faint)]">
                        {i + 1}.
                      </span>
                    }
                    title={name}
                  />
                ))}
              </DashList>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--pd-faint)]">
              Из невывезенных
            </div>
            {shops.length === 0 ? (
              <DashEmpty>
                {result.total === 0
                  ? 'Нет зафиксированных позиций отчёта за выбранные дни.'
                  : 'Все позиции вывезены — причин невывоза нет.'}
              </DashEmpty>
            ) : (
              <div className="space-y-0">
                {shops.map((shop, i) => (
                  <div
                    key={shop.shop}
                    className="border-b border-[var(--pd-border)] py-1.5 last:border-b-0"
                  >
                    <div className="flex items-start gap-2 text-[12.5px] leading-snug">
                      <span className="w-5 shrink-0 text-center tabular-nums text-[var(--pd-faint)]">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 font-medium text-[var(--pd-text-strong)]">
                        {shop.shop}
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold text-[var(--pd-accent-soft)]">
                        [{shop.count}]
                      </span>
                    </div>
                    {shop.reasons.length > 0 && (
                      <ul className="m-0 ml-7 mt-1 list-none space-y-0.5 border-l border-[var(--pd-border)] p-0 pl-2.5">
                        {shop.reasons.map((r) => (
                          <li key={r.label} className="text-[12px] leading-snug text-[var(--pd-text)]">
                            {r.label}{' '}
                            <strong className="tabular-nums text-[var(--pd-text-strong)]">
                              [{r.count}]
                            </strong>
                            {r.notes.length > 0 && (
                              <ul className="m-0 ml-1.5 mt-0.5 list-none space-y-0.5 p-0 text-[11px] text-[var(--pd-muted)]">
                                {r.notes.map((n) => (
                                  <li key={n.note} className="leading-snug">
                                    {n.note}
                                    {n.count > 1 ? (
                                      <strong className="text-[var(--pd-text)]"> ×{n.count}</strong>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </DashPanel>
  );
}

/**
 * Раздел «Отчёт» — PDF White / Black (поток.docx §8).
 * Данные позиций: зафиксированный отчёт (fixation_id>0).
 * Ручные показатели: сервер flow_report_manual_*.
 */
export function ReportScreen(): JSX.Element {
  const [days, setDays] = useState<string[]>(() => [isoToday()]);
  const [rows, setRows] = useState<FlowDeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState<Record<string, ReportManualDay>>({});
  /** Silent print job: без превью — сразу dialog | save PDF (как Транспорт). */
  const [printJob, setPrintJob] = useState<{
    id: number;
    mode: ReportMode;
    kind: 'dialog' | 'save';
    includeFleet: boolean;
  } | null>(null);
  const printJobSeq = useRef(0);
  const [printMsg, setPrintMsg] = useState<{ mode: ReportMode; text: string } | null>(null);
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const whById = useWarehousesStore((st) => st.byId);
  // zero-insensitive lookup, как в FlowPlanGrid
  const whByKey = useMemo(
    () => new Map(Array.from(whById.values(), (w) => [whKey(w.id), w] as const)),
    [whById],
  );

  // Месяцы выбранных дней + из строк — для frozen schedule / ГРАФ.
  const scheduleMonths = useMemo(() => {
    const seen = new Set<string>();
    const out: { year: number; month: number }[] = [];
    const add = (iso: string) => {
      const m = monthOfDate(iso);
      if (!m) return;
      const k = monthKey(m.year, m.month);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(m);
    };
    for (const d of days) add(d);
    for (const r of rows) {
      if (Number(r.fixation_id) > 0) add(String(r.plan_date || ''));
    }
    return out;
  }, [days, rows]);
  const scheduleMetaMap = useScheduleMonthsMeta(scheduleMonths);

  const reportOpts = useMemo(() => {
    const resolveShop = (toWh: string): string => {
      const w = whMapGet(whByKey, toWh);
      const shop = (w?.shop_name || '').trim();
      return shop || String(toWh || '').trim() || '—';
    };
    /**
     * Как колонка ГРАФ:
     * · on  — «да» (день плана = график)
     * · off — дата (склад в графике, день другой)
     * · none — «нет» (склада нет в графике)
     */
    const graphKind = (r: FlowDeliveryRow): 'on' | 'off' | 'none' => {
      const wh = whMapGet(whByKey, r.to_wh);
      const m = monthOfDate(r.plan_date || '');
      const meta = m ? scheduleMetaMap.get(monthKey(m.year, m.month)) : undefined;
      let day: string | null = null;
      if (meta?.shops.length) {
        day = frozenWeekdayOf(meta.shops, r.to_wh);
      } else if (
        m &&
        canUseLiveWarehouseScheduleForMonth(m.year, m.month) &&
        (!meta || meta.exists !== false)
      ) {
        day = wh && Number(wh.in_schedule) === 1 ? wh.delivery_day : null;
      }
      if (!day) return 'none';
      const ref = /^\d{4}-\d{2}-\d{2}/.test(r.plan_date || '')
        ? String(r.plan_date).slice(0, 10)
        : isoToday();
      const near = nearestGraphDate(day, ref);
      if (near && near === ref) return 'on';
      if (!near) return 'none';
      return 'off';
    };
    return { resolveShop, graphKind };
  }, [whByKey, scheduleMetaMap]);

  // Подгрузка поставок (все; фильтр report+days на клиенте).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const all = await flowDeliveriesGet(api);
        if (!cancelled) setRows(all);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live: правки STAT/перенос/фиксация в Отчёте сразу в Сводке.
  useWsEvent<FlowDeliveriesChangedEvent>('flow_deliveries_changed', (e) => {
    setRows((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowDeliveryRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          if (Number(r.reserved) === 1) {
            byId.delete(r.id);
            continue;
          }
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      return next;
    });
  });

  // Ручные данные за выбранные дни.
  useEffect(() => {
    if (days.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await flowReportManualGet(api, days);
        if (cancelled) return;
        setManual((prev) => {
          const next = { ...prev };
          for (const d of days) {
            next[d] = data[d] ?? emptyReportManualDay();
          }
          return next;
        });
      } catch {
        /* empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days.join('|')]);

  const dayHints = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of rows) {
      if (!(Number(r.fixation_id) > 0)) continue;
      const d = String(r.plan_date || '').slice(0, 10);
      if (d) m.set(d, true);
    }
    return m;
  }, [rows]);

  const sortedDays = useMemo(() => [...days].sort(), [days]);
  const daysTitle = useMemo(
    () => formatReportDaysTitle(sortedDays),
    [sortedDays],
  );

  const white = useMemo(
    () => computeFlowReport(rows, 'white', sortedDays, reportOpts),
    [rows, sortedDays, reportOpts],
  );
  const black = useMemo(
    () => computeFlowReport(rows, 'black', sortedDays, reportOpts),
    [rows, sortedDays, reportOpts],
  );

  const scheduleSave = useCallback((day: string, data: ReportManualDay) => {
    const prev = saveTimers.current.get(day);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      const payload: ReportManualDay = {
        ...data,
        lining: cleanLines(data.lining ?? []),
        restow: cleanLines(data.restow ?? []),
      };
      void flowReportManualSet(api, day, payload).catch(() => {
        /* silent */
      });
    }, 450);
    saveTimers.current.set(day, t);
  }, []);

  const onPatchDay = useCallback(
    (day: string, patch: Partial<ReportManualDay>) => {
      setManual((prev) => {
        const base = prev[day] ?? emptyReportManualDay();
        const next = { ...base, ...patch };
        const all = { ...prev, [day]: next };
        scheduleSave(day, next);
        return all;
      });
    },
    [scheduleSave],
  );

  /** Блок 3: машины (только с гаражным + вывезено). */
  const fleetGroups = useMemo(
    () => buildReportFleetGroups(rows, sortedDays),
    [rows, sortedDays],
  );

  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);

  /** ФИО (exp) → роль потока по базе контактов. */
  const resolveFleetRole = useMemo(() => {
    const byId = new Map<string, FleetFlowRole>();
    for (const p of persons) {
      const g = String(p.broadcastGroup || '');
      let role: FleetFlowRole | null = null;
      if (g === 'Экспедиторы') role = 'expeditor';
      else if (g === 'Водители-экспедиторы') role = 'driver_expeditor';
      if (!role) continue;
      const id = expeditorId(p.fio);
      if (id) byId.set(id, role);
    }
    return (fio: string): FleetFlowRole | null => {
      const id = expeditorId(fio);
      if (!id) return null;
      return byId.get(id) ?? null;
    };
  }, [persons]);

  const fleetPeople = useMemo(
    () => countFleetPeople(fleetGroups, resolveFleetRole),
    [fleetGroups, resolveFleetRole],
  );

  const fleetTitle = useMemo(() => {
    const bits = [`ТС ${countFleetVehicles(fleetGroups)}`];
    bits.push(`Экспедиторы ${fleetPeople.expeditors}`);
    if (fleetPeople.driverExpeditors > 0) {
      bits.push(`Водители-экспедиторы ${fleetPeople.driverExpeditors}`);
    }
    if (fleetPeople.others > 0) {
      bits.push(`Иные ${fleetPeople.others}`);
    }
    return `Блок 3 · ${bits.join(' · ')}`;
  }, [fleetGroups, fleetPeople]);

  const periodMeta =
    sortedDays.length === 0
      ? 'выберите дни в календаре'
      : sortedDays.length === 1
        ? '1 день'
        : `дней ${sortedDays.length}`;

  const plan = useMemo(
    () => computePlanFromSchedule(sortedDays, scheduleMetaMap, whByKey),
    [sortedDays, scheduleMetaMap, whByKey],
  );

  const shopFactPct = (fact: number): number => pctOf(fact, plan.planShops);

  const launchPrint = useCallback(
    (mode: ReportMode, kind: 'dialog' | 'save', includeFleet: boolean) => {
      printJobSeq.current += 1;
      setPrintMsg(null);
      setPrintJob({ id: printJobSeq.current, mode, kind, includeFleet });
    },
    [],
  );

  useEffect(() => {
    if (!printMsg) return;
    const t = setTimeout(() => setPrintMsg(null), 4000);
    return () => clearTimeout(t);
  }, [printMsg]);

  const surface = useWorkspaceSurface('report');

  return (
    <main
      className="report-screen relative flex min-w-0 max-w-full flex-1 flex-col overflow-hidden"
      data-pyn-surface={surface}
    >
      <div className="drag-region flex h-9 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden px-4">
        <span className="no-drag-region shrink-0 text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          Сводка
        </span>
        <div className="no-drag-region ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--pd-faint)]" />
          )}
          <WorkspaceSurfaceToggle section="report" />
          <ReportDayPicker selected={days} onChange={setDays} dayHints={dayHints} />
        </div>
      </div>

      <WorkspaceCard>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DashShell aria-label="Дашборд сводки">
          <DashHeader
            full
            title={daysTitle || 'Период не выбран'}
            meta={periodMeta}
          />

          <SplitKpi
            half
            label="Вывезено позиций"
            white={{
              value: `${white.percent}%`,
              meta: (
                <>
                  {white.shipped} из {white.total}
                </>
              ),
              tone: shippedTone(white.percent),
            }}
            black={{
              value: `${black.percent}%`,
              meta: (
                <>
                  {black.shipped} из {black.total}
                </>
              ),
              tone: shippedTone(black.percent),
            }}
          />
          <SplitKpi
            half
            label="Цеха всего"
            white={{
              value:
                plan.planShops > 0
                  ? `${shopFactPct(white.shopCount)}%`
                  : white.shopCount,
              meta:
                plan.planShops > 0 ? (
                  <>
                    {white.shopCount} из {plan.planShops}
                  </>
                ) : (
                  white.shopCount
                ),
            }}
            black={{
              value:
                plan.planShops > 0
                  ? `${shopFactPct(black.shopCount)}%`
                  : black.shopCount,
              meta:
                plan.planShops > 0 ? (
                  <>
                    {black.shopCount} из {plan.planShops}
                  </>
                ) : (
                  black.shopCount
                ),
            }}
          />

          <GraphDetailPanel result={white} planWarehouses={plan.planWarehouses} />

          <ModePanel
            mode="white"
            title="White"
            result={white}
            daysTitle={daysTitle}
            hasFleet={fleetGroups.length > 0}
            printMsg={printMsg?.mode === 'white' ? printMsg.text : undefined}
            onPrint={(kind, includeFleet) => launchPrint('white', kind, includeFleet)}
          />
          <ModePanel
            mode="black"
            title="Black"
            result={black}
            daysTitle={daysTitle}
            hasFleet={fleetGroups.length > 0}
            printMsg={printMsg?.mode === 'black' ? printMsg.text : undefined}
            onPrint={(kind, includeFleet) => launchPrint('black', kind, includeFleet)}
          />

          <DashPanel full tightHead title="Блок 2">
            <ManualBlock days={sortedDays} byDay={manual} onPatchDay={onPatchDay} />
          </DashPanel>

          {fleetGroups.length > 0 && (
            <DashPanel full tightHead title={fleetTitle}>
              <FleetBlock groups={fleetGroups} embedded />
            </DashPanel>
          )}
        </DashShell>
      </div>
      </WorkspaceCard>

      {printJob && (
        <ReportPrint
          key={printJob.id}
          mode={printJob.mode}
          daysTitle={daysTitle}
          days={sortedDays}
          byDay={manual}
          result={printJob.mode === 'white' ? white : black}
          fleetGroups={fleetGroups}
          includeFleet={printJob.includeFleet}
          planShops={plan.planShops}
          planWarehouses={plan.planWarehouses}
          fleetPeople={fleetPeople}
          autoMode={printJob.kind}
          onDone={(text) => {
            setPrintJob(null);
            if (text) setPrintMsg({ mode: printJob.mode, text });
          }}
        />
      )}
    </main>
  );
}
