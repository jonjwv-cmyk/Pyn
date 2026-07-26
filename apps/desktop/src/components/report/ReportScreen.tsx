import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Download,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
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
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { nearestGraphDate } from '@/components/flow/flow-sandbox.fixtures';
import { whKey, whMapGet } from '@/components/flow/flow-warehouse';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  canUseLiveWarehouseScheduleForMonth,
  monthKey,
  useScheduleMonthsMeta,
} from '@/lib/schedule/use-schedule-sync';
import { useWsEvent } from '@/lib/ws';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { ReportPrint } from './ReportPrint';
import {
  buildReportFleetGroups,
  countFleetExpeditors,
  countFleetVehicles,
  fleetGroupLine1,
  type ExpedGroup,
} from './report-fleet';

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

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

/** Multi-select календарь дней отчёта.
 *  Popover в `fixed` — тулбар/экран Сводки с overflow:hidden иначе обрезают absolute. */
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
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const today = isoToday();
  const selSet = useMemo(() => new Set(selected), [selected]);
  const sorted = useMemo(() => [...selected].sort(), [selected]);

  const [view, setView] = useState(() => {
    const base = sorted[0] || today;
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });

  const placePanel = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelPos({
      top: Math.round(r.bottom + 4),
      right: Math.round(window.innerWidth - r.right),
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    placePanel();
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onReposition = (): void => placePanel();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, placePanel]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    // mon=0
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(view.y, view.m, 0).getDate();
    const out: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < startPad; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${view.y}-${String(view.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push({ iso, day: d });
    }
    return out;
  }, [view]);

  const toggle = (iso: string): void => {
    if (selSet.has(iso)) onChange(selected.filter((x) => x !== iso));
    else onChange([...selected, iso].sort());
  };

  const label =
    sorted.length === 0
      ? 'Выбрать дни'
      : sorted.length === 1
        ? sorted[0]
        : `${sorted.length} дн.: ${formatReportDaysTitle(sorted) || sorted.join(', ')}`;

  const active = selected.length > 0;

  return (
    <>
      {/* Как LayerToggle на Карте: h-6, border, clay когда выбрано */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Выбор дней сводки"
        className={cn(
          'flex h-6 max-w-[220px] items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
          active || open
            ? 'border-accent-clay/55 bg-accent-clay-bg text-accent-clay'
            : 'border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-secondary',
        )}
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open && panelPos && (
        <div
          ref={panelRef}
          className="fixed z-[200] w-[280px] rounded-lg border border-border-subtle bg-bg-elevated p-2 shadow-xl"
          style={{ top: panelPos.top, right: panelPos.right }}
        >
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[12px] text-text-muted hover:bg-white/[0.06]"
              onClick={() =>
                setView((v) =>
                  v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 },
                )
              }
            >
              ‹
            </button>
            <span className="text-[12px] font-medium text-text-primary">
              {MONTHS_RU[view.m - 1]} {view.y}
            </span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[12px] text-text-muted hover:bg-white/[0.06]"
              onClick={() =>
                setView((v) =>
                  v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 },
                )
              }
            >
              ›
            </button>
          </div>
          <div className="mb-0.5 grid grid-cols-7 gap-0.5">
            {WEEKDAYS_SHORT.map((w) => (
              <div key={w} className="text-center text-[10px] text-text-muted">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              if (!c) return <div key={`e${i}`} />;
              const on = selSet.has(c.iso);
              const hasReport = dayHints.get(c.iso);
              return (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => toggle(c.iso)}
                  className={cn(
                    'relative h-7 rounded text-[12px] outline-none transition-colors',
                    on
                      ? 'bg-accent-clay text-white'
                      : 'text-text-primary hover:bg-white/[0.08]',
                    c.iso === today && !on && 'ring-1 ring-accent-clay/50',
                  )}
                  title={hasReport ? 'есть отчёт' : undefined}
                >
                  {c.day}
                  {hasReport && !on && (
                    <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-border-subtle pt-1.5">
            <button
              type="button"
              className="text-[11px] text-text-muted hover:text-text-primary"
              onClick={() => onChange([])}
            >
              Сбросить
            </button>
            <button
              type="button"
              className="text-[11px] text-accent-clay hover:underline"
              onClick={() => setOpen(false)}
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </>
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
        'h-6 w-12 rounded border border-border-subtle/80 bg-transparent px-1 text-left text-[12px] tabular-nums text-text-primary outline-none focus:border-accent-clay/50 disabled:opacity-40',
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
  const [open, setOpen] = useState(true);

  const headCls =
    'text-[12px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap text-left';
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

  /** Свёрнуто: только «Блок 1». */
  if (!open) {
    return (
      <div className="min-w-0 w-full">
        <button
          type="button"
          className={cn(headCls, 'flex items-center gap-1 hover:text-text-primary')}
          onClick={() => setOpen(true)}
        >
          <span className="w-2.5 text-[10px] opacity-70">▶</span>
          Блок 1
        </button>
      </div>
    );
  }

  return (
    <div className="box-border min-w-0 w-full max-w-full overflow-hidden">
      {/*
        Слева sticky (без боковой линии), справа scroll дней.
        Разделители секций — тонкая линия от середины заголовка ОТЛ/ДОК/Огнеупоры.
      */}
      <div className="flex w-full min-w-0 max-w-full">
        {/* ─── фиксация: название + ЕИ ─── */}
        <div className="z-[1] shrink-0 bg-bg-surface pr-2">
          {/* шапка: Блок 1 | ЕИ */}
          <div className={cn('flex items-center gap-2', rowH)}>
            <button
              type="button"
              className={cn(
                headCls,
                labelW,
                'flex shrink-0 items-center gap-1 hover:text-text-primary',
              )}
              onClick={() => setOpen(false)}
            >
              <span className="w-2.5 text-[10px] opacity-70">▼</span>
              Блок 1
            </button>
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
                <span className={cn(headCls, 'mr-2 shrink-0')}>{r.title}</span>
                <span className="h-px min-w-[1rem] flex-1 bg-border-subtle/70" />
              </div>
            ) : (
              <div key={`L-d-${i}`} className={cn('flex items-center gap-2', rowH)}>
                <span
                  className={cn(
                    labelW,
                    'shrink-0 truncate text-left text-[12px] leading-none text-text-primary/90',
                  )}
                  title={r.label}
                >
                  {r.label}
                </span>
                <span
                  className={cn(
                    unitW,
                    'shrink-0 text-left text-[12px] tabular-nums text-text-muted/55',
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
            {/* даты — один раз, строка Блок 1 */}
            <div className={cn('flex items-center', rowH)}>
              {days.length === 0 ? (
                <span className="px-1 text-[12px] text-text-muted/60">выберите дни →</span>
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
                  /* линия продолжается через колонки дней */
                  <div key={`R-h-${i}`} className={cn('relative flex items-center', rowH)}>
                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-subtle/70" />
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
 * Блок 2: машины / тип ТС / экспедиторы / От·СП (как шапка «Экспедиторам»).
 * Сворачивается как Блок 1. Если групп нет — null (блок скрыт).
 * Заголовок: «Блок 2 · ТС n · Экспедиторы m»
 */
function FleetBlock({ groups }: { groups: ExpedGroup[] }): JSX.Element | null {
  const [open, setOpen] = useState(true);
  if (groups.length === 0) return null;

  const tsCount = countFleetVehicles(groups);
  const expCount = countFleetExpeditors(groups);
  const countsLabel = (
    <span className="ml-1.5 font-normal normal-case tracking-normal text-text-muted">
      · ТС {tsCount} · Экспедиторы {expCount}
    </span>
  );

  const headCls =
    'text-[12px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap text-left';

  if (!open) {
    return (
      <div className="min-w-0 w-full">
        <button
          type="button"
          className={cn(headCls, 'flex items-center gap-1 hover:text-text-primary')}
          onClick={() => setOpen(true)}
        >
          <span className="w-2.5 text-[10px] opacity-70">▶</span>
          Блок 2
          {countsLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="box-border min-w-0 w-full max-w-full overflow-hidden">
      <button
        type="button"
        className={cn(headCls, 'mb-1.5 flex items-center gap-1 hover:text-text-primary')}
        onClick={() => setOpen(false)}
      >
        <span className="w-2.5 text-[10px] opacity-70">▼</span>
        Блок 2
        {countsLabel}
      </button>
      <div className="max-h-[min(40vh,280px)] min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border-subtle">
        <ul className="m-0 list-none space-y-0 p-0">
          {groups.map((g, i) => (
            <li
              key={`${g.garage || 'none'}-${i}`}
              className={cn(
                'border-b border-border-subtle/70 px-2.5 py-1.5 last:border-b-0',
                'text-[12px] leading-snug text-text-primary',
              )}
            >
              {/* 1: машина · тип · экспедиторы; 2: От; 3: СП — всегда отдельно, с переносом */}
              <p className="m-0 break-words font-medium text-text-strong">{fleetGroupLine1(g)}</p>
              <p className="m-0 mt-0.5 break-words text-[11px] text-text-secondary">
                <span className="text-text-muted">От:</span> {g.frList || '—'}
              </p>
              <p className="m-0 mt-0.5 break-words text-[11px] text-text-secondary">
                <span className="text-text-muted">СП:</span> {g.toList || '—'}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Колонка White/Black (Блок 3):
 *  · сверху фикс: % вывоза + вне графика (нумерация) + заголовок «Из невывезенных»
 *  · прокрутка только списка цехов (шапка таблицы №|Цех|поз. sticky)
 */
function ReportColumn({
  mode,
  title,
  result,
  daysTitle,
  onPrint,
}: {
  mode: ReportMode;
  title: string;
  result: ReportComputeResult;
  daysTitle: string;
  onPrint: () => void;
}): JSX.Element {
  const notIn = result.notInScheduleShops;
  const off = result.offScheduleShops;
  const shops = result.tree;
  const emptyHint = !daysTitle && result.total === 0;

  const shopWord = (n: number): string =>
    n === 1 ? 'цех' : n > 1 && n < 5 ? 'цеха' : 'цехов';

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border-subtle',
        mode === 'white' ? 'bg-white/[0.03]' : 'bg-black/20',
      )}
      data-report-mode={mode}
    >
      {/* шапка колонки */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <FileText
          className={cn(
            'h-4 w-4',
            mode === 'white' ? 'text-amber-200' : 'text-slate-300',
          )}
          strokeWidth={1.75}
        />
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        <button
          type="button"
          disabled={daysTitle === '' && result.total === 0}
          onClick={onPrint}
          title="Печать / PDF"
          className="ml-auto flex h-7 items-center gap-1.5 rounded-md bg-accent-clay-bg px-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/20 disabled:opacity-40"
        >
          <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
          Печать
        </button>
      </div>

      {emptyHint ? (
        <div className="px-3 py-2 text-[12px] text-text-muted">Выберите дни для расчёта</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-2 pb-0">
          {/* фиксированный блок сводки */}
          <div className="shrink-0 space-y-1.5 text-[12px] text-text-primary">
            <p className="m-0 leading-snug">
              По плану экспедиции вывезено{' '}
              <span className="font-semibold">{result.shipped}</span> из{' '}
              <span className="font-semibold">{result.total}</span> позиций —{' '}
              <span className="font-semibold">{result.percent}%</span>
            </p>
            {/* Нет в графике — только если есть; нумерованный список цехов */}
            {notIn.length > 0 && (
              <div>
                <p className="m-0 leading-snug">
                  Нет в графике:{' '}
                  <span className="font-semibold">{notIn.length}</span> {shopWord(notIn.length)}
                </p>
                <ol className="m-0 mt-0.5 list-none space-y-0.5 p-0 text-text-muted">
                  {notIn.map((name, i) => (
                    <li key={name} className="flex gap-1.5 leading-snug">
                      <span className="w-5 shrink-0 text-center tabular-nums">{i + 1}.</span>
                      <span className="min-w-0">{name}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {/* Вне графика — только если есть */}
            {off.length > 0 && (
              <div>
                <p className="m-0 leading-snug">
                  Вне графика:{' '}
                  <span className="font-semibold">{off.length}</span> {shopWord(off.length)}
                </p>
                <ol className="m-0 mt-0.5 list-none space-y-0.5 p-0 text-text-muted">
                  {off.map((name, i) => (
                    <li key={name} className="flex gap-1.5 leading-snug">
                      <span className="w-5 shrink-0 text-center tabular-nums">{i + 1}.</span>
                      <span className="min-w-0">{name}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="m-0 pb-1 font-semibold leading-snug">Из невывезенных</p>
          </div>

          {/* прокрутка только списка цехов; шапка таблицы sticky */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {shops.length === 0 ? (
              <p className="m-0 text-[12px] text-text-muted">
                {result.total === 0
                  ? 'Нет зафиксированных позиций отчёта за выбранные дни.'
                  : 'Все позиции вывезены — причин невывоза нет.'}
              </p>
            ) : (
              <table className="w-auto max-w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-[1] bg-bg-surface">
                  <tr className="text-left text-[11px] text-text-muted">
                    <th className="border-b border-border-subtle bg-bg-surface py-0.5 pr-2 text-center font-medium">
                      №
                    </th>
                    <th className="border-b border-border-subtle bg-bg-surface py-0.5 pr-2 font-medium">
                      Цех
                    </th>
                    <th className="border-b border-border-subtle bg-bg-surface py-0.5 text-left font-medium">
                      поз.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop, i) => (
                    <Fragment key={shop.shop}>
                      <tr>
                        <td className="py-0.5 pr-2 text-center align-middle tabular-nums text-text-muted">
                          {i + 1}
                        </td>
                        <td className="py-0.5 pr-2 align-top font-medium leading-snug">
                          {shop.shop}
                        </td>
                        <td className="py-0.5 text-left align-top tabular-nums">
                          <strong>[{shop.count}]</strong>
                        </td>
                      </tr>
                      {shop.reasons.length > 0 && (
                        <tr>
                          <td />
                          <td colSpan={2} className="pb-1.5 pl-0.5">
                            <ul className="m-0 list-none space-y-0.5 border-l border-border-subtle p-0 pl-2">
                              {shop.reasons.map((r) => (
                                <li key={r.label}>
                                  <div className="leading-snug">
                                    {r.label} <strong>[{r.count}]</strong>
                                  </div>
                                  {r.notes.length > 0 && (
                                    <ul className="ml-2 mt-0.5 list-none space-y-0.5 p-0 text-[11px] text-text-muted">
                                      {r.notes.map((n) => (
                                        <li key={n.note} className="leading-snug">
                                          {n.note}
                                          {n.count > 1 ? (
                                            <strong> ×{n.count}</strong>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
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
  const [printMode, setPrintMode] = useState<ReportMode | null>(null);
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

  /** Блок 2: машины на выбранные дни (fixation). */
  const fleetGroups = useMemo(
    () => buildReportFleetGroups(rows, sortedDays),
    [rows, sortedDays],
  );

  return (
    <div className="report-screen flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden">
      {/* Тулбар как на Карте: заголовок слева, действия ml-auto справа */}
      <div className="drag-region flex h-9 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden px-4">
        <span className="no-drag-region shrink-0 text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          Сводка
        </span>
        <div className="no-drag-region ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
          )}
          <ReportDayPicker selected={days} onChange={setDays} dayHints={dayHints} />
        </div>
      </div>
      <WorkspaceCard>
        <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col gap-1.5 overflow-hidden p-1.5">
          <div className="min-w-0 w-full max-w-full shrink-0 overflow-hidden">
            <ManualBlock
              days={sortedDays}
              byDay={manual}
              onPatchDay={onPatchDay}
            />
          </div>
          {/* Блок 2 — сбор машин; скрыт, если нет данных */}
          {fleetGroups.length > 0 && (
            <div className="min-w-0 w-full max-w-full shrink-0 overflow-hidden">
              <FleetBlock groups={fleetGroups} />
            </div>
          )}
          <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 gap-1.5 overflow-hidden">
            <ReportColumn
              mode="white"
              title="White"
              result={white}
              daysTitle={daysTitle}
              onPrint={() => setPrintMode('white')}
            />
            <ReportColumn
              mode="black"
              title="Black"
              result={black}
              daysTitle={daysTitle}
              onPrint={() => setPrintMode('black')}
            />
          </div>
        </div>
      </WorkspaceCard>
      {printMode && (
        <ReportPrint
          mode={printMode}
          daysTitle={daysTitle}
          days={sortedDays}
          byDay={manual}
          result={printMode === 'white' ? white : black}
          fleetGroups={fleetGroups}
          onClose={() => setPrintMode(null)}
        />
      )}
    </div>
  );
}
