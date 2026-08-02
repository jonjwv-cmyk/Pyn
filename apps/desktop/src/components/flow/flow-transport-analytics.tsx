/**
 * Дашборд транспорта: период · план/факт · статусы · водители · типы ТС.
 * UI = конструктор @/components/pyn-dash (общий для всех дашбордов).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApexOptions } from 'apexcharts';
import {
  computeTransportKpis,
  labelFromSelectedDays,
  daysOfMonth,
  daysOfQuarter,
  daysOfYear,
  daysOfWeekFromMon,
  defaultPeriodDays,
  weeksOfMonth,
  yearsFromRows,
  type PeriodGrain,
  type TransportKpiRow,
  type VehicleTypeStat,
  type DriverStat,
  type ChartMonthGroup,
} from './flow-transport-kpi';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, Layers, ListChecks, RotateCcw } from 'lucide-react';
import { PynCalendar } from '@/components/pyn-table/PynCalendar';
import '@/components/pyn-dash/pyn-dash.css';
import {
  DashShell,
  DashHeader,
  DashKpi,
  DashDelta,
  DashPanel,
  DashList,
  DashRow,
  DashMolBadge,
  DashTrack,
  DashStatBar,
  DashLegend,
  DashLegLine,
  DashLegDot,
  DashLegSep,
  DashChip,
  DashSegment,
  DashSegBtn,
} from '@/components/pyn-dash';

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

const GRAIN_OPTS: { id: PeriodGrain; label: string; hint: string }[] = [
  { id: 'day', label: 'Дни', hint: 'Выбор дней → график по дням' },
  { id: 'week', label: 'Нед.', hint: 'Недели → график по неделям' },
  { id: 'month', label: 'Мес.', hint: 'Месяцы → график по месяцам' },
  { id: 'quarter', label: 'Кварт.', hint: 'Кварталы → график по кварталам' },
  { id: 'year', label: 'Год', hint: 'Год → график по годам' },
];

function worksWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'работ';
  if (b === 1) return 'работа';
  if (b >= 2 && b <= 4) return 'работы';
  return 'работ';
}

function mergeDays(base: Set<string>, add: string[]): Set<string> {
  const next = new Set(base);
  for (const d of add) next.add(d);
  return next;
}

export interface AnalyticsToolbarProps {
  rows: TransportKpiRow[];
  /** Зерно: как выбираем и как рисуем график. */
  grain: PeriodGrain;
  onGrainChange: (g: PeriodGrain) => void;
  /** Выбранные дни YYYY-MM-DD (фильтр строк; всегда дни с машинами в KPI). */
  selectedDays: Set<string>;
  onSelectedDaysChange: (s: Set<string>) => void;
  workFilter: Set<string> | null;
  onWorkFilterChange: (s: Set<string> | null) => void;
  availableWorks: string[];
  onReset: () => void;
}

/**
 * Период дашборда:
 *  · зерно (Дни|Нед|Мес|Кварт|Год) — и UI выбора, и бакеты графика
 *  · дни/недели/месяцы… → selectedDays (фильтр строк)
 *  · на графике только периоды, где есть машины
 */
export function AnalyticsToolbar({
  rows,
  grain,
  onGrainChange,
  selectedDays,
  onSelectedDaysChange,
  workFilter,
  onWorkFilterChange,
  availableWorks,
  onReset,
}: AnalyticsToolbarProps): JSX.Element {
  const [pickOpen, setPickOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [blockYear, setBlockYear] = useState(() => new Date().getFullYear());
  const [weekMonth, setWeekMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  });

  const years = useMemo(() => yearsFromRows(rows), [rows]);
  const dataDays = useMemo(() => new Set(rows.map((r) => r.tdate).filter(Boolean)), [rows]);
  const sorted = useMemo(() => [...selectedDays].sort(), [selectedDays]);
  const periodLabel = useMemo(() => labelFromSelectedDays(sorted), [sorted]);
  const weekOpts = useMemo(() => weeksOfMonth(weekMonth.y, weekMonth.m), [weekMonth.y, weekMonth.m]);

  const worksTotal = availableWorks.length;
  const worksOn = workFilter == null ? worksTotal : workFilter.size;
  const worksPartial = workFilter != null && workFilter.size < worksTotal;

  const setOnly = (days: string[]) => {
    onSelectedDaysChange(new Set(days));
    setPickOpen(false);
  };

  return (
    <>
      <DashSegment scroll aria-label="Зерно периода">
        {GRAIN_OPTS.map((o) => (
          <DashSegBtn
            key={o.id}
            active={grain === o.id}
            title={o.hint}
            onClick={() => {
              onGrainChange(o.id);
              setPickOpen(true);
            }}
          >
            {o.label}
          </DashSegBtn>
        ))}
      </DashSegment>

      <Popover.Root open={pickOpen} onOpenChange={setPickOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="flow-tab-tool-btn max-w-[240px] truncate px-2"
            data-active="true"
            title="Выбор периода"
          >
            {grain === 'day' ? <CalendarDays size={14} strokeWidth={1.75} /> : <Layers size={14} strokeWidth={1.75} />}
            <span className="truncate">{periodLabel}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={8} className="pyn-popover z-50 w-[300px] p-3">
            {grain === 'day' && (
              <>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Дни · график по дням (только с машинами)
                </div>
                <PynCalendar
                  selected={selectedDays}
                  onChange={onSelectedDaysChange}
                  dataDays={dataDays}
                  onSelectMonth={(ym) => {
                    const y = Number(ym.slice(0, 4));
                    const m = Number(ym.slice(5, 7));
                    onSelectedDaysChange(new Set(daysOfMonth(y, m)));
                  }}
                  onReset={() => onSelectedDaysChange(new Set())}
                  resetEnabled={selectedDays.size > 0}
                />
              </>
            )}

            {grain === 'week' && (
              <>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Недели · график по неделям
                </div>
                <div className="mb-2 text-[10.5px] font-medium text-zinc-500">Месяц для списка недель</div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {(years.length ? years : [weekMonth.y]).map((y) => (
                    <DashChip key={y} active={weekMonth.y === y} onClick={() => setWeekMonth((p) => ({ ...p, y }))}>
                      {y}
                    </DashChip>
                  ))}
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {MONTHS_SHORT.map((name, i) => (
                    <DashChip
                      key={name}
                      active={weekMonth.m === i + 1}
                      onClick={() => setWeekMonth((p) => ({ ...p, m: i + 1 }))}
                    >
                      {name}
                    </DashChip>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  {weekOpts.map((w, idx) => {
                    const weekDays = daysOfWeekFromMon(w.mon);
                    const allOn = weekDays.length > 0 && weekDays.every((d) => selectedDays.has(d));
                    return (
                      <DashChip
                        key={w.mon}
                        active={allOn}
                        onClick={() => {
                          if (allOn) {
                            const next = new Set(selectedDays);
                            for (const d of weekDays) next.delete(d);
                            onSelectedDaysChange(next);
                          } else {
                            onSelectedDaysChange(mergeDays(selectedDays, weekDays));
                          }
                        }}
                      >
                        Нед. {idx + 1} · {w.label}
                      </DashChip>
                    );
                  })}
                </div>
              </>
            )}

            {grain === 'month' && (
              <>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Месяцы · график по месяцам
                </div>
                <div className="mb-2 text-[10.5px] font-medium text-zinc-500">Год</div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {(years.length ? years : [blockYear]).map((y) => (
                    <DashChip key={y} active={blockYear === y} onClick={() => setBlockYear(y)}>
                      {y}
                    </DashChip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {MONTHS_SHORT.map((name, i) => {
                    const days = daysOfMonth(blockYear, i + 1);
                    const allOn = days.every((d) => selectedDays.has(d));
                    return (
                      <DashChip
                        key={name}
                        active={allOn}
                        onClick={() => {
                          if (allOn) {
                            const next = new Set(selectedDays);
                            for (const d of days) next.delete(d);
                            onSelectedDaysChange(next);
                          } else {
                            onSelectedDaysChange(mergeDays(selectedDays, days));
                          }
                        }}
                      >
                        {name}
                      </DashChip>
                    );
                  })}
                </div>
              </>
            )}

            {grain === 'quarter' && (
              <>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Кварталы · график по кварталам
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {(years.length ? years : [blockYear]).map((y) => (
                    <DashChip key={y} active={blockYear === y} onClick={() => setBlockYear(y)}>
                      {y}
                    </DashChip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {([1, 2, 3, 4] as const).map((q) => {
                    const days = daysOfQuarter(blockYear, q);
                    const allOn = days.every((d) => selectedDays.has(d));
                    return (
                      <DashChip
                        key={q}
                        active={allOn}
                        onClick={() => {
                          if (allOn) {
                            const next = new Set(selectedDays);
                            for (const d of days) next.delete(d);
                            onSelectedDaysChange(next);
                          } else {
                            onSelectedDaysChange(mergeDays(selectedDays, days));
                          }
                        }}
                      >
                        Q{q}
                      </DashChip>
                    );
                  })}
                </div>
              </>
            )}

            {grain === 'year' && (
              <>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Год · график по годам
                </div>
                <div className="flex flex-wrap gap-1">
                  {(years.length ? years : [blockYear]).map((y) => {
                    const days = daysOfYear(y);
                    const allOn = days.length > 0 && days.every((d) => selectedDays.has(d));
                    return (
                      <DashChip
                        key={y}
                        active={allOn}
                        onClick={() => {
                          if (allOn) onSelectedDaysChange(new Set());
                          else setOnly(days);
                        }}
                      >
                        {y}
                      </DashChip>
                    );
                  })}
                </div>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Работы в анализе */}
      <Popover.Root open={worksOpen} onOpenChange={setWorksOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="flow-tab-tool-btn px-2"
            data-active={worksPartial ? 'true' : 'false'}
            title="Работы в анализе"
          >
            <ListChecks size={14} strokeWidth={1.75} />
            <span className="tabular-nums">{worksTotal === 0 ? 'Работы' : `${worksOn}/${worksTotal}`}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={8} className="pyn-popover z-50 w-[320px] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Работы в анализе
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="flow-tab-tool-btn px-1.5 text-[11px]"
                  onClick={() => onWorkFilterChange(null)}
                >
                  Все
                </button>
                <button
                  type="button"
                  className="flow-tab-tool-btn px-1.5 text-[11px]"
                  onClick={() => onWorkFilterChange(new Set())}
                >
                  Снять
                </button>
              </div>
            </div>
            {availableWorks.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-zinc-500">Нет работ за период</div>
            ) : (
              <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto pr-0.5">
                {availableWorks.map((w) => {
                  const on = workFilter == null || workFilter.has(w);
                  return (
                    <label
                      key={w}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/[0.04]"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[#d97757]"
                        checked={on}
                        onChange={() => {
                          const base =
                            workFilter == null ? new Set(availableWorks) : new Set(workFilter);
                          if (base.has(w)) base.delete(w);
                          else base.add(w);
                          if (base.size === availableWorks.length) onWorkFilterChange(null);
                          else onWorkFilterChange(base);
                        }}
                      />
                      <span className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-200">{w}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <button type="button" className="flow-tab-tool-btn px-1.5" title="Сброс к текущему месяцу" onClick={onReset}>
        <RotateCcw size={13} strokeWidth={1.75} />
      </button>
    </>
  );
}

const POINT_EPS = 0.05;

function tipDiffHtml(p: number, f: number): string {
  if (f > p + POINT_EPS) {
    const d = Math.round((f - p) * 10) / 10;
    return `<div class="pyn-apex-tip-ok">разница +${d} ч</div>`;
  }
  if (f < p - POINT_EPS) {
    const d = Math.round((p - f) * 10) / 10;
    return `<div class="pyn-apex-tip-low">разница −${d} ч</div>`;
  }
  return `<div class="pyn-apex-tip-ok" style="opacity:.75">разница 0 ч</div>`;
}

function PlanFactChart({
  labels,
  plan,
  fact,
  mode,
  groups,
}: {
  labels: string[];
  plan: number[];
  fact: number[];
  mode: 'bar' | 'line';
  groups: ChartMonthGroup[];
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);
  const [err, setErr] = useState('');

  // Стабильный ключ — не гоняем effect на каждый новый [] reference
  const dataKey = useMemo(
    () =>
      `${mode}|${labels.length}|${labels.join('·')}|${plan.join(',')}|${fact.join(',')}|${groups
        .map((g) => `${g.title}:${g.cols}`)
        .join(';')}`,
    [mode, labels, plan, fact, groups],
  );

  useEffect(() => {
    let cancelled = false;
    if (!hostRef.current || labels.length === 0) return;

    // снимок данных для этого прогона
    const cats = labels.slice();
    const planData = plan.map((n) => Number(n) || 0);
    const factData = fact.map((n) => Number(n) || 0);
    const isBar = mode === 'bar';
    const n = cats.length;
    const groupsSnap = groups.slice();

    void (async () => {
      try {
        const mod = await import('apexcharts');
        const ApexCtor = mod.default;
        if (cancelled || !hostRef.current) return;

        chartRef.current?.destroy();
        chartRef.current = null;
        // очистить DOM — Apex 6 иногда оставляет мусор
        hostRef.current.innerHTML = '';

        const tipHtml = (i: number) => {
          const p = planData[i] ?? 0;
          const f = factData[i] ?? 0;
          return `<div class="pyn-apex-tip">
            <div class="pyn-apex-tip-x">${cats[i] || 'Период'}</div>
            <div><span style="color:#a6a39b">План</span> · ${p} ч</div>
            <div><span style="color:#d97757">Факт</span> · ${f} ч</div>
            ${tipDiffHtml(p, f)}
          </div>`;
        };

        const base: ApexOptions = {
          chart: {
            // area = линия с заливкой; bar = столбцы на 1 день
            type: isBar ? 'bar' : 'area',
            height: isBar ? 280 : 300,
            toolbar: { show: false },
            background: 'transparent',
            fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
            animations: { enabled: n < 90, speed: 350 },
            zoom: { enabled: false },
            foreColor: '#ceccc5',
            redrawOnParentResize: true,
            redrawOnWindowResize: true,
          },
          theme: { mode: 'dark' },
          series: [
            { name: 'План', data: planData },
            { name: 'Факт', data: factData },
          ],
          colors: ['#a6a39b', '#d97757'],
          dataLabels: isBar
            ? {
                enabled: true,
                offsetY: -14,
                style: { fontSize: '11px', colors: ['#ceccc5'] },
                formatter: (val, opts) => {
                  if (!opts || opts.seriesIndex !== 1) return '';
                  const i = opts.dataPointIndex ?? 0;
                  const p = planData[i] ?? 0;
                  const f = Number(val) || 0;
                  const d = Math.round((f - p) * 10) / 10;
                  if (Math.abs(d) <= POINT_EPS) return '0';
                  return d > 0 ? `+${d}` : `${d}`;
                },
              }
            : { enabled: false },
          stroke: isBar
            ? { show: true, width: 0 }
            : {
                curve: n > 40 ? 'straight' : 'smooth',
                width: [2, 2.75],
                lineCap: 'round',
              },
          fill: isBar
            ? { type: 'solid', opacity: 0.92 }
            : {
                type: 'gradient',
                gradient: {
                  shadeIntensity: 1,
                  opacityFrom: 0.28,
                  opacityTo: 0.03,
                  stops: [0, 85, 100],
                },
              },
          markers: isBar
            ? { size: 0 }
            : (() => {
                // точки: зелёные выше плана, peach совпало (как раньше)
                type Disc = {
                  seriesIndex: number;
                  dataPointIndex: number;
                  fillColor: string;
                  strokeColor: string;
                  size: number;
                  shape?: string;
                };
                const discrete: Disc[] = [];
                for (let i = 0; i < factData.length; i++) {
                  const f = factData[i] ?? 0;
                  const p = planData[i] ?? 0;
                  if (f > p + POINT_EPS) {
                    discrete.push({
                      seriesIndex: 1,
                      dataPointIndex: i,
                      fillColor: '#7dc061',
                      strokeColor: 'rgba(31,30,27,0.9)',
                      size: 5,
                      shape: 'circle',
                    });
                  } else if (Math.abs(f - p) <= POINT_EPS) {
                    discrete.push({
                      seriesIndex: 1,
                      dataPointIndex: i,
                      fillColor: '#e8a48a',
                      strokeColor: 'rgba(31,30,27,0.9)',
                      size: 5,
                      shape: 'circle',
                    });
                  }
                }
                return {
                  size: 0,
                  hover: { size: 5, sizeOffset: 0 },
                  strokeWidth: 1.5,
                  discrete: discrete as never,
                };
              })(),
          grid: {
            borderColor: 'rgba(234,221,216,0.08)',
            strokeDashArray: 3,
            xaxis: { lines: { show: false } },
            padding: { left: 4, right: 8, top: isBar ? 16 : 8, bottom: 4 },
          },
          xaxis: {
            type: 'category',
            categories: cats,
            // все дни-категории с подписями снизу (как раньше)
            labels: {
              show: true,
              style: { colors: '#a6a39b', fontSize: '10px' },
              rotate: n > 14 ? -35 : 0,
              hideOverlappingLabels: n > 24,
            },
            axisBorder: { show: false },
            axisTicks: { show: false },
            tooltip: { enabled: false },
            crosshairs: isBar
              ? { show: false }
              : {
                  show: true,
                  width: 1,
                  position: 'back',
                  opacity: 0.9,
                  stroke: { color: 'rgba(232, 164, 138, 0.65)', width: 1, dashArray: 0 },
                },
          },
          yaxis: {
            min: 0,
            forceNiceScale: true,
            labels: {
              style: { colors: '#a6a39b', fontSize: '10px' },
              formatter: (v: number) => `${Math.round(v)}`,
            },
          },
          legend: { show: false },
          tooltip: {
            enabled: true,
            shared: true,
            intersect: false,
            followCursor: !isBar,
            custom: ({ dataPointIndex }) => tipHtml(dataPointIndex ?? 0),
          },
        };

        if (isBar) {
          base.plotOptions = {
            bar: {
              horizontal: false,
              columnWidth: n <= 2 ? '42%' : '52%',
              borderRadius: 5,
              borderRadiusApplication: 'end',
            },
          };
        }

        // группы месяцев — только если сумма cols == n (иначе Apex 6 падает)
        if (!isBar && groupsSnap.length > 1) {
          const sum = groupsSnap.reduce((a, g) => a + g.cols, 0);
          if (sum === n && base.xaxis) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (base.xaxis as any).group = {
              style: {
                fontSize: '10px',
                fontWeight: 600,
                colors: groupsSnap.map(() => '#a6a39b'),
              },
              groups: groupsSnap.map((g) => ({ title: g.title, cols: g.cols })),
            };
          }
        }

        const host = hostRef.current;
        if (!host || cancelled) return;
        const chart = new ApexCtor(host, base);
        await chart.render();
        if (cancelled) {
          chart.destroy();
          return;
        }
        chartRef.current = chart;
        setErr('');
      } catch (e) {
        if (!cancelled) {
          console.error('[PlanFactChart]', e);
          setErr(String(e instanceof Error ? e.message : e));
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        chartRef.current?.destroy();
      } catch {
        /* ignore */
      }
      chartRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
    // dataKey covers labels/plan/fact/mode/groups
  }, [dataKey, labels, plan, fact, mode, groups]);

  if (labels.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[12px] text-zinc-500">
        Нет данных для графика
      </div>
    );
  }

  return (
    <div className="w-full">
      {err ? (
        <div className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11.5px] text-rose-300">
          График: {err}
        </div>
      ) : null}
      <div ref={hostRef} className="pyn-apex-host w-full" style={{ minHeight: mode === 'bar' ? 280 : 300 }} />
    </div>
  );
}

function statusTone(status: string): 'ok' | 'accent' | 'danger' | 'muted' {
  const s = status.trim();
  if (s === 'Размещен') return 'ok';
  if (s === 'Дополнение') return 'accent';
  if (s === 'Отмена' || s === 'Отклонен' || s === 'НЕТ') return 'danger';
  return 'muted';
}

function DriverList({ items }: { items: DriverStat[] }): JSX.Element {
  if (items.length === 0) {
    return <DashList empty="Нет водителей">{[]}</DashList>;
  }
  return (
    <DashList>
      {items.map((d) => (
        <DashRow
          key={d.fio}
          titleWrap
          subMeta
          title={d.fio}
          subtitle={
            <>
              <span className="pyn-dash-phone">{d.phone || '—'}</span>
              {d.isMol ? <DashMolBadge /> : null}
            </>
          }
          track={<DashTrack pct={d.workPct} />}
          side={
            <>
              <div className="pyn-dash-row-metric">{d.factHours} ч</div>
              <div className="pyn-dash-row-hint">{d.workPct}% от всех</div>
              <div className="pyn-dash-row-faint">
                {d.works} {worksWord(d.works)}
              </div>
            </>
          }
        />
      ))}
    </DashList>
  );
}

function TypeList({ items }: { items: VehicleTypeStat[] }): JSX.Element {
  if (items.length === 0) {
    return <DashList empty="Нет типов ТС">{[]}</DashList>;
  }
  return (
    <DashList>
      {items.map((it) => (
        <DashRow
          key={it.type}
          title={it.type}
          subtitle={`${it.factHours} ч · ${it.works} ${worksWord(it.works)}`}
          track={<DashTrack pct={it.weightPct} />}
          side={
            <>
              <div className="pyn-dash-row-metric">{it.weightPct}%</div>
              <div className="pyn-dash-row-faint">{it.factHours} ч</div>
            </>
          }
        />
      ))}
    </DashList>
  );
}

function StatusSummary({ items }: { items: { status: string; count: number; pct: number }[] }): JSX.Element {
  if (items.length === 0) {
    return <DashList empty="Нет статусов">{[]}</DashList>;
  }
  return (
    <div className="pyn-dash-stack">
      {items.map((it) => (
        <DashStatBar
          key={it.status}
          name={it.status}
          count={it.count}
          pct={it.pct}
          maxCount={100}
          tone={statusTone(it.status)}
        />
      ))}
    </div>
  );
}

export function FlowTransportAnalytics({
  rows,
  molByFio,
  selectedDays,
  grain,
  workFilter,
}: {
  rows: TransportKpiRow[];
  molByFio?: ReadonlyMap<string, boolean>;
  selectedDays: Set<string>;
  grain: PeriodGrain;
  workFilter: Set<string> | null;
}): JSX.Element {
  const customDays = useMemo(() => [...selectedDays].sort(), [selectedDays]);

  const kpis = useMemo(
    () =>
      computeTransportKpis(rows, 'day', new Date(), {
        customDays,
        includedWorks: workFilter,
        molByFio,
        chartGrain: grain,
      }),
    [rows, customDays, workFilter, molByFio, grain],
  );

  const diff = kpis.hoursDiff;
  const factWorks = kpis.doneCount + kpis.extraCount;
  const showChart =
    kpis.chartLabels.length >= 1 &&
    (kpis.totalPlanHours > 0 || kpis.totalFactHours > 0 || kpis.worksCount > 0);

  return (
    <DashShell aria-label="Аналитика транспорта">
      <DashHeader
        title={kpis.periodLabel}
        meta={
          <>
            {kpis.worksCount} {worksWord(kpis.worksCount)}
          </>
        }
      />

      <DashKpi label="Работы план" value={kpis.worksCount} valueTone="accent" />
      <DashKpi
        label="Работы факт"
        value={factWorks}
        valueSize="sm"
        meta={
          <>
            размещен {kpis.doneCount}
            {kpis.extraCount > 0 ? (
              <>
                {' · '}
                <span className="pd-accent">доп. {kpis.extraCount}</span>
              </>
            ) : null}
          </>
        }
      />
      <DashKpi
        label="План / факт"
        valueSize="xs"
        value={
          <>
            {kpis.totalPlanHours}
            <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--pd-muted)' }}>
              {' '}
              / {kpis.totalFactHours}
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--pd-muted)' }}> ч</span>
          </>
        }
        meta={
          <>
            разница <DashDelta value={diff} suffix=" ч" />
          </>
        }
      />
      <DashKpi
        label="План экспедиции"
        value="—"
        valueSize="sm"
        meta={<span className="text-zinc-500">в разработке</span>}
      />

      {showChart ? (
        <DashPanel
          full
          title="План / факт"
          headRight={
            <DashLegend>
              <DashLegLine kind="plan">План</DashLegLine>
              <DashLegLine kind="fact">Факт</DashLegLine>
              {kpis.chartMode === 'line' ? (
                <>
                  <DashLegSep />
                  <DashLegDot kind="match">совпало</DashLegDot>
                  <DashLegDot kind="over">выше плана</DashLegDot>
                </>
              ) : null}
            </DashLegend>
          }
        >
          <PlanFactChart
            labels={kpis.chartLabels}
            plan={kpis.planHours}
            fact={kpis.factHours}
            mode={kpis.chartMode}
            groups={kpis.chartGroups}
          />
        </DashPanel>
      ) : null}

      {/* Три равных блока: статусы · типы · водители */}
      <div className="pyn-dash-span-full pyn-dash-trio">
        <DashPanel title="Сводка статусов">
          <StatusSummary items={kpis.statusBreakdown} />
        </DashPanel>
        <DashPanel title="Типы ТС">
          <TypeList items={kpis.byType} />
        </DashPanel>
        <DashPanel title="Водители">
          <DriverList items={kpis.drivers} />
        </DashPanel>
      </div>
    </DashShell>
  );
}

/** Для chrome: availableWorks без фильтра галочек. */
export function useTransportAvailableWorks(rows: TransportKpiRow[], selectedDays: Set<string>): string[] {
  return useMemo(() => {
    const customDays = [...selectedDays].sort();
    const k = computeTransportKpis(rows, 'day', new Date(), {
      customDays,
      includedWorks: null,
    });
    return k.availableWorks;
  }, [rows, selectedDays]);
}

export { defaultPeriodDays, labelFromSelectedDays };
