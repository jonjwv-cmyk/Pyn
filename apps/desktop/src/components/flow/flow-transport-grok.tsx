/**
 * Grok-оболочка Транспорта: вкладки Разнарядка | Дашборд.
 * Одна chrome-строка: вкладки + тулбары списка (не две полосы).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flowTransportGet, type FlowTransportRow } from '@pyn/core';
import { api } from '@/lib/api';
import '@/components/pyn-table/pyn-table-theme.css';
import { FlowTabulatorTransport } from './flow-tabulator-transport';
import {
  AnalyticsToolbar,
  FlowTransportAnalytics,
  useTransportAvailableWorks,
} from './flow-transport-analytics';
import { defaultPeriodDays, nearestDataDay, rowHasActivity, type TransportKpiRow } from './flow-transport-kpi';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';

type GrokTab = 'list' | 'dashboard';

const TABS: { id: GrokTab; label: string; hint: string }[] = [
  { id: 'list', label: 'Разнарядка', hint: 'Список машин · фильтры · правка' },
  { id: 'dashboard', label: 'Дашборд', hint: 'План/факт · работы · водители' },
];

function toKpiRows(rows: FlowTransportRow[]): TransportKpiRow[] {
  return rows.map((r) => ({
    tdate: r.tdate,
    status: r.status,
    out_status: r.out_status || '',
    garage_no: r.garage_no || '',
    vehicle_type: r.vehicle_type || '',
    work: r.work || '',
    time_range: r.time_range || '',
    time_bold: Number(r.time_bold ?? 0),
    fact_start: r.fact_start || '',
    fact_end: r.fact_end || '',
    driver: r.driver || '',
    driver_phone: r.driver_phone || '',
    force_json: r.force_json || '[]',
  }));
}

function TransportDashboardPane({ chromeLeading }: { chromeLeading: ReactNode }): JSX.Element {
  const [rows, setRows] = useState<TransportKpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  /** Фильтр строк: календарные дни выбранного периода. */
  const [selectedDays, setSelectedDays] = useState<Set<string>>(
    () => new Set(defaultPeriodDays()),
  );
  const [workFilter, setWorkFilter] = useState<Set<string> | null>(null);
  const persons = usePersonsStore((s) => s.persons);

  useEffect(() => {
    void initPersons();
  }, []);

  const molByFio = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const p of persons) {
      if (!p.isMol || !p.fio.trim()) continue;
      m.set(p.fio, true);
      m.set(p.fio.toUpperCase(), true);
    }
    return m;
  }, [persons]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const tr = (await flowTransportGet(api)) as FlowTransportRow[];
      setRows(toKpiRows(tr ?? []));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // По умолчанию — самый актуальный день, а не весь месяц (юзер 2026-08-02: «если
  // 2-е число, а машин нет, покажет 3-е»). Срабатывает один раз, после первой
  // загрузки строк, и не трогает выбор, если юзер уже сам его поменял.
  const smartDefaultRef = useRef(false);
  useEffect(() => {
    if (smartDefaultRef.current || rows.length === 0) return;
    smartDefaultRef.current = true;
    const activeDays = new Set(rows.filter(rowHasActivity).map((r) => r.tdate).filter(Boolean));
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const d = nearestDataDay(activeDays, today);
    if (d) setSelectedDays(new Set([d]));
  }, [rows]);

  const availableWorks = useTransportAvailableWorks(rows, selectedDays);

  useEffect(() => {
    if (workFilter == null) return;
    const avail = new Set(availableWorks);
    let changed = false;
    const next = new Set<string>();
    for (const w of workFilter) {
      if (avail.has(w)) next.add(w);
      else changed = true;
    }
    if (changed) {
      if (next.size === availableWorks.length) setWorkFilter(null);
      else setWorkFilter(next);
    }
  }, [availableWorks, workFilter]);

  return (
    <div className="pyn-table-root flex h-full min-h-0 flex-col overflow-hidden" data-pyn-table-theme="grok">
      <div className="pyn-table-chrome flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <div className="flex shrink-0 items-center">{chromeLeading}</div>
        <div className="flow-tab-toolbar flex min-w-0 flex-1 flex-wrap items-center gap-0.5 p-0.5">
          <AnalyticsToolbar
            rows={rows}
            selectedDays={selectedDays}
            onSelectedDaysChange={(s) => {
              setSelectedDays(s);
              setWorkFilter(null);
            }}
            workFilter={workFilter}
            onWorkFilterChange={setWorkFilter}
            availableWorks={availableWorks}
          />
          <button
            type="button"
            className="flow-tab-tool-btn ml-auto px-2"
            onClick={() => void load()}
            disabled={loading}
            title="Обновить метрики"
          >
            {loading ? '…' : 'Обновить'}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {err ? <div className="px-4 py-6 text-[12.5px] text-rose-400">{err}</div> : null}
        {loading && rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12.5px] text-zinc-500">Загрузка метрик…</div>
        ) : (
          <FlowTransportAnalytics
            rows={rows}
            molByFio={molByFio}
            selectedDays={selectedDays}
            workFilter={workFilter}
          />
        )}
      </div>
    </div>
  );
}

export function FlowTransportGrok(): JSX.Element {
  const [tab, setTab] = useState<GrokTab>('list');

  const tabs = useMemo(
    () => (
      <div className="pyn-segment" role="tablist" aria-label="Разделы транспорта">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            title={t.hint}
            aria-selected={tab === t.id}
            data-active={tab === t.id ? 'true' : 'false'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    ),
    [tab],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-surface">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            visibility: tab === 'list' ? 'visible' : 'hidden',
            pointerEvents: tab === 'list' ? 'auto' : 'none',
            zIndex: tab === 'list' ? 1 : 0,
          }}
          aria-hidden={tab !== 'list'}
        >
          <FlowTabulatorTransport theme="grok" chromeLeading={tabs} />
        </div>
        <div
          className="absolute inset-0"
          style={{
            visibility: tab === 'dashboard' ? 'visible' : 'hidden',
            pointerEvents: tab === 'dashboard' ? 'auto' : 'none',
            zIndex: tab === 'dashboard' ? 1 : 0,
          }}
          aria-hidden={tab !== 'dashboard'}
        >
          <TransportDashboardPane chromeLeading={tabs} />
        </div>
      </div>
    </div>
  );
}
