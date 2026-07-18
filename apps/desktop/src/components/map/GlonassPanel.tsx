import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Crosshair, Loader2, RotateCw, Route, Satellite, Search, Square, X } from 'lucide-react';
import { flowTransportGet, flowVehiclesGet } from '@pyn/core';
import { api } from '@/lib/api';
import { vehicleBrand } from '@/components/flow/FlowTransportGrid';
import {
  useGlonassStore,
  vehicleStatus,
  STATUS_LABEL,
  STATUS_COLOR,
  formatGlonassSpeed,
  GLONASS_PRO_COLOR,
  GLONASS_RAW_COLOR,
  type GlonassPosition,
  type GlonassStatus,
  type GlonassVehicle,
} from './glonass-store';
import {
  formatGosPlate,
  todayYmdYekaterinburg,
} from './glonass-format';

type DayMeta = { vehicleType: string; brand: string; driver: string };

/** Колонки: фиксированные ширины → список читается как таблица. */
const COL_GARAGE_TRACK = '3.6rem'; // кнопка + «статус скорость» под ней
const COL_GARAGE = '2.6rem';
const COL_GOS = '5.6rem'; // «Т 955 РК»
const COL_BRAND = 'minmax(2.8rem, 1fr)';
const COL_FOLLOW = '1.5rem';
const COL_PILL = '4.6rem';

/**
 * Панель «Глонасс» — поиск/выбор машин для слежения на карте. Плитка поверх
 * карты (лево-верх). Весь парк скопом НЕ показываем на карте: здесь ищем/отмечаем
 * нужные — отмеченные рисуются точками и опрашиваются по позиции.
 */
export function GlonassPanel({ onFocusVehicle }: { onFocusVehicle: (pos: GlonassPosition) => void }) {
  const open = useGlonassStore((s) => s.open);
  const fleet = useGlonassStore((s) => s.fleet);
  const loading = useGlonassStore((s) => s.loading);
  const error = useGlonassStore((s) => s.error);
  const selected = useGlonassStore((s) => s.selected);
  const positions = useGlonassStore((s) => s.positions);
  const offline = useGlonassStore((s) => s.offline);
  const followId = useGlonassStore((s) => s.followId);
  const setFollow = useGlonassStore((s) => s.setFollow);
  const historyLoading = useGlonassStore((s) => s.historyLoading);
  const setOpen = useGlonassStore((s) => s.setOpen);
  const toggleSelect = useGlonassStore((s) => s.toggleSelect);
  const clearSelected = useGlonassStore((s) => s.clearSelected);
  const loadFleet = useGlonassStore((s) => s.loadFleet);
  const createHistoryLayer = useGlonassStore((s) => s.createHistoryLayer);
  const createYearRoadLayer = useGlonassStore((s) => s.createYearRoadLayer);
  const cancelHistoryLoading = useGlonassStore((s) => s.cancelHistoryLoading);
  const showPro = useGlonassStore((s) => s.showPro);
  const showRaw = useGlonassStore((s) => s.showRaw);
  const setShowPro = useGlonassStore((s) => s.setShowPro);
  const setShowRaw = useGlonassStore((s) => s.setShowRaw);

  const [query, setQuery] = useState('');
  const [historyVehicleId, setHistoryVehicleId] = useState<number | ''>('');
  const [historyDay, setHistoryDay] = useState(() => toLocalDateValue(new Date()));
  /** Гаражный → тип ТС / марка / водитель на сегодня. */
  const [dayMeta, setDayMeta] = useState<Map<string, DayMeta>>(() => new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const day = todayYmdYekaterinburg();
    void (async () => {
      try {
        const [vehs, trRows] = await Promise.all([
          flowVehiclesGet(api),
          flowTransportGet(api, day),
        ]);
        if (cancelled) return;
        const brandByGarage = new Map<string, string>();
        const modelTypeByGarage = new Map<string, string>();
        for (const v of vehs) {
          const g = (v.garage_no || '').trim();
          if (!g) continue;
          const key = g.toUpperCase();
          const brand = vehicleBrand(v.model || '') || '';
          if (brand) brandByGarage.set(key, brand);
          // model целиком — fallback типа, если в транспорте нет vehicle_type
          if ((v.model || '').trim()) modelTypeByGarage.set(key, v.model.trim());
        }
        const driverByGarage = new Map<string, string>();
        const trTypeByGarage = new Map<string, string>();
        for (const r of trRows) {
          const g = (r.garage_no || '').trim();
          if (!g) continue;
          const key = g.toUpperCase();
          if (r.driver?.trim() && !driverByGarage.has(key)) driverByGarage.set(key, r.driver.trim());
          if (r.vehicle_type?.trim()) trTypeByGarage.set(key, r.vehicle_type.trim());
        }
        const next = new Map<string, DayMeta>();
        const keys = new Set([
          ...brandByGarage.keys(),
          ...modelTypeByGarage.keys(),
          ...driverByGarage.keys(),
          ...trTypeByGarage.keys(),
        ]);
        for (const k of keys) {
          const brand = brandByGarage.get(k) || '';
          const vtype = trTypeByGarage.get(k) || '';
          // Тип ТС = vehicle_type из транспорта; марка отдельно (КамАЗ). Не дублировать.
          next.set(k, {
            vehicleType: vtype,
            brand,
            driver: driverByGarage.get(k) || '',
          });
        }
        setDayMeta(next);
      } catch {
        /* нет сессии / сеть — список Глонасс всё равно работает */
      }
    })();
    return () => { cancelled = true; };
  }, [open, fleet.length]);

  const metaOf = (v: GlonassVehicle): DayMeta =>
    dayMeta.get((v.garage || '').toUpperCase()) ?? { vehicleType: '', brand: '', driver: '' };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fleet;
    return fleet.filter((v) => {
      const m = dayMeta.get((v.garage || '').toUpperCase());
      const gos = formatGosPlate(v.gos).toLowerCase();
      return (
        v.garage.toLowerCase().includes(q) ||
        v.gos.toLowerCase().includes(q) ||
        gos.includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (m?.driver || '').toLowerCase().includes(q) ||
        (m?.brand || '').toLowerCase().includes(q) ||
        (m?.vehicleType || '').toLowerCase().includes(q)
      );
    });
  }, [fleet, query, dayMeta]);

  // Выбранные — наверх, затем по гаражному номеру.
  const ordered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const sa = selected.has(a.id) ? 0 : 1;
      const sb = selected.has(b.id) ? 0 : 1;
      return sa - sb;
    });
  }, [filtered, selected]);

  const firstSelectedId = useMemo(() => Array.from(selected)[0] ?? null, [selected]);
  useEffect(() => {
    const fallback = firstSelectedId ?? fleet[0]?.id ?? '';
    setHistoryVehicleId((cur) => (cur && fleet.some((v) => v.id === cur) ? cur : fallback));
  }, [firstSelectedId, fleet]);

  const createDayHistory = () => {
    if (!historyVehicleId) return;
    const [from, to] = localDayRangeToIso(historyDay);
    void createHistoryLayer(Number(historyVehicleId), from, to);
  };

  const createSelectedYearHistory = () => {
    const ids = selected.size > 0 ? Array.from(selected) : (historyVehicleId ? [Number(historyVehicleId)] : []);
    void createYearRoadLayer(ids, yearStartIso(), new Date().toISOString());
  };

  const createFleetYearHistory = () => {
    void createYearRoadLayer(fleet.map((v) => v.id), yearStartIso(), new Date().toISOString());
  };

  if (!open) return null;

  return (
    <div className="absolute left-3 top-3 z-[6] flex max-h-[calc(100%-1.5rem)] w-[382px] flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-[0_18px_58px_rgba(0,0,0,0.46)]">
      {/* Шапка */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <Satellite className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[13px] font-semibold text-text-strong">Глонасс</span>
        {selected.size > 0 && (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
            {selected.size}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Обновить парк"
            onClick={() => loadFleet()}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Закрыть"
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Поиск */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-elevated px-2">
          <Search className="h-3.5 w-3.5 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Гаражный № или госномер…"
            className="w-full bg-transparent text-[12px] text-text-strong placeholder:text-text-muted/70 outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-text-muted hover:text-text-strong">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Статус-строка опроса */}
      {selected.size > 0 && (
        <div className="shrink-0 px-3 pb-1 text-[10.5px] text-text-muted">
          {offline ? 'Парк не на связи — позиций сейчас нет' : 'Ведём на карте: ' + selected.size}
          {selected.size > 0 && (
            <button type="button" onClick={clearSelected} className="ml-2 text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
              снять все
            </button>
          )}
        </div>
      )}

      <div className="shrink-0 border-y border-border-subtle bg-bg-elevated px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          <Clock className="h-3.5 w-3.5" />
          История движения
        </div>
        <div className="grid gap-1.5">
          <div className="grid grid-cols-2 gap-1.5" aria-label="Отображение маршрута">
            <HistoryModeToggle
              label="PRO"
              color={GLONASS_PRO_COLOR}
              on={showPro}
              onClick={() => setShowPro(!showPro)}
            />
            <HistoryModeToggle
              label="ГЛОНАСС"
              color={GLONASS_RAW_COLOR}
              on={showRaw}
              onClick={() => setShowRaw(!showRaw)}
            />
          </div>
          <HistoryVehiclePicker
            fleet={fleet}
            positions={positions}
            value={historyVehicleId}
            onChange={setHistoryVehicleId}
            metaOf={metaOf}
          />
          <HistoryDateField value={historyDay} onChange={setHistoryDay} />
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-1.5">
            <button
              type="button"
              disabled={!historyVehicleId || !!historyLoading}
              onClick={createDayHistory}
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-500/12 px-2 text-[11px] font-semibold text-sky-200 outline-none transition-colors hover:bg-sky-500/18 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Route className="h-3.5 w-3.5" />
              День
            </button>
            <button
              type="button"
              disabled={(!historyVehicleId && selected.size === 0) || !!historyLoading}
              onClick={createSelectedYearHistory}
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-pink-400/35 bg-pink-500/12 px-2 text-[11px] font-semibold text-pink-200 outline-none transition-colors hover:bg-pink-500/18 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="h-2.5 w-4 rounded-full bg-[#F472D0]" />
              Выбран.
            </button>
            <button
              type="button"
              disabled={fleet.length === 0 || !!historyLoading}
              onClick={createFleetYearHistory}
              className="flex h-8 items-center justify-center gap-1 rounded-lg border border-pink-400/35 bg-pink-500/12 px-2 text-[11px] font-semibold text-pink-200 outline-none transition-colors hover:bg-pink-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              title="Розовые следы с 01.01.2026 по всему парку"
            >
              Весь парк
            </button>
          </div>
          {historyLoading && (
            <div className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1.5">
              <div className="flex items-center gap-2 text-[10.5px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-pink-300" />
                <span className="min-w-0 flex-1 truncate">{historyLoading.label}</span>
                <span className="font-mono tabular-nums">{historyLoading.done}/{historyLoading.total}</span>
                {(historyLoading.failed ?? 0) > 0 && (
                  <span className="rounded bg-rose-500/12 px-1 font-mono text-[9.5px] text-rose-300">
                    −{historyLoading.failed}
                  </span>
                )}
                <button
                  type="button"
                  title="Остановить загрузку"
                  onClick={cancelHistoryLoading}
                  className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-strong"
                >
                  <Square className="h-3 w-3" />
                </button>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-pink-400 transition-[width]"
                  style={{ width: `${historyLoading.total > 0 ? Math.round((historyLoading.done / historyLoading.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Список парка */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5">
        {loading && fleet.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка парка…
          </div>
        )}
        {error && (
          <div className="px-2 py-3 text-[11.5px] text-rose-300/90">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && fleet.length > 0 && (
          <div className="px-2 py-3 text-[11.5px] text-text-muted">Ничего не найдено</div>
        )}
        {ordered.length > 0 && (
          <div
            className="grid items-center gap-x-1.5 gap-y-0 px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-wide text-text-muted/70"
            style={{ gridTemplateColumns: `${COL_GARAGE_TRACK} ${COL_GOS} ${COL_BRAND} ${COL_FOLLOW}` }}
          >
            <span>Гар.</span>
            <span>Гос</span>
            <span>Марка</span>
            <span />
          </div>
        )}
        {ordered.map((v) => (
          <VehicleRow
            key={v.id}
            v={v}
            meta={metaOf(v)}
            checked={selected.has(v.id)}
            following={followId === v.id}
            position={positions.get(v.id)}
            onToggle={() => toggleSelect(v.id)}
            onFocus={onFocusVehicle}
            onFollow={() => setFollow(followId === v.id ? null : v.id)}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryModeToggle({ label, color, on, onClick }: {
  label: string;
  color: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={onClick}
      className={[
        'flex h-8 items-center gap-2 rounded-lg border px-2 text-[11.5px] font-semibold outline-none transition-colors',
        on ? 'border-white/25 bg-white/10 text-text-strong' : 'border-border-subtle bg-bg-surface text-text-muted hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className="h-[3px] w-7 shrink-0 rounded-full" style={{ backgroundColor: color, opacity: on ? 1 : 0.38 }} />
      <span className="min-w-0 flex-1 text-left">{label}</span>
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]"
        style={on ? { borderColor: color, backgroundColor: `${color}24`, color } : undefined}
      >{on ? '✓' : ''}</span>
    </button>
  );
}

function HistoryDateField({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = useMemo(() => parseLocalDate(value), [value]);
  const [view, setView] = useState(() => ({ year: selected.year, month: selected.month }));
  const days = useMemo(() => buildMonthDays(view.year, view.month), [view.year, view.month]);
  const monthTitle = useMemo(() => (
    new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(view.year, view.month - 1, 1))
  ), [view.year, view.month]);

  useEffect(() => {
    setView({ year: selected.year, month: selected.month });
  }, [selected.year, selected.month]);

  const setDate = (year: number, month: number, day: number) => {
    onChange(formatLocalDate({ year, month, day }));
  };
  const moveMonth = (delta: number) => {
    const next = new Date(view.year, view.month - 1 + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() + 1 });
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface px-2 text-left text-[11px] text-text-secondary outline-none transition-colors hover:border-accent-clay/45 hover:bg-bg-hover data-[state=open]:border-accent-clay/55 data-[state=open]:text-text-strong"
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="shrink-0 font-semibold text-text-muted">День</span>
          <span className="min-w-0 truncate font-mono tabular-nums text-text-strong">{formatDateButton(selected)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[760] w-[292px] rounded-2xl border border-border-default bg-bg-elevated p-3 text-text-primary shadow-[0_18px_58px_rgba(0,0,0,0.5)] outline-none"
        >
          <div className="flex h-7 items-center justify-between">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-[12px] font-semibold text-text-strong first-letter:uppercase">{monthTitle}</div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[9.5px] font-semibold uppercase tracking-wide text-text-muted">
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((day, index) => {
              const selectedDay = day && day.year === selected.year && day.month === selected.month && day.day === selected.day;
              return day ? (
                <button
                  key={`${day.year}-${day.month}-${day.day}`}
                  type="button"
                  onClick={() => setDate(day.year, day.month, day.day)}
                  className={[
                    'h-7 rounded-lg text-[11.5px] tabular-nums outline-none transition-colors',
                    selectedDay
                      ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/45'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                  ].join(' ')}
                >
                  {day.day}
                </button>
              ) : <span key={`blank-${index}`} />;
            })}
          </div>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function toLocalDateValue(date: Date): string {
  return formatLocalDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

function localDayRangeToIso(value: string): [string, string] {
  const d = parseLocalDate(value);
  const from = new Date(d.year, d.month - 1, d.day, 0, 0, 0, 0);
  const to = new Date(d.year, d.month - 1, d.day + 1, 0, 0, 0, 0);
  return [from.toISOString(), to.toISOString()];
}

function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const parts = value.split('-').map((part) => Number(part));
  const yearRaw = parts[0];
  const monthRaw = parts[1];
  const dayRaw = parts[2];
  const valid = typeof yearRaw === 'number' && typeof monthRaw === 'number' && typeof dayRaw === 'number'
    && Number.isFinite(yearRaw) && Number.isFinite(monthRaw) && Number.isFinite(dayRaw);
  const date = valid
    ? new Date(yearRaw, monthRaw - 1, dayRaw)
    : new Date();
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  return { year: safe.getFullYear(), month: safe.getMonth() + 1, day: safe.getDate() };
}

function formatLocalDate(parts: { year: number; month: number; day: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function formatDateButton(parts: { year: number; month: number; day: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
}

function buildMonthDays(year: number, month: number): Array<{ year: number; month: number; day: number } | null> {
  const first = new Date(year, month - 1, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Monday first.
  const daysInMonth = new Date(year, month, 0).getDate();
  const out: Array<{ year: number; month: number; day: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) out.push(null);
  for (let day = 1; day <= daysInMonth; day++) out.push({ year, month, day });
  while (out.length % 7 !== 0) out.push(null);
  return out;
}

function yearStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).toISOString();
}

/**
 * Список отслеживания (не история) — колонки:
 *   [кнопка гар. цветом]  |  гос  |  марка  |  ⊙
 *   [статус  скорость  ]  |  ФИО водителя (на всю ширину описания)
 */
function VehicleRow({ v, meta, checked, following, position, onToggle, onFocus, onFollow }: {
  v: GlonassVehicle;
  meta: DayMeta;
  checked: boolean;
  following: boolean;
  position: GlonassPosition | undefined;
  onToggle: () => void;
  onFocus: (pos: GlonassPosition) => void;
  onFollow: () => void;
}) {
  const status = vehicleStatus(position);
  const statusColor = STATUS_COLOR[status];
  const gos = formatGosPlate(v.gos) || v.gos || '—';
  const brand = meta.brand || '—';
  const driver = meta.driver.trim();
  const mapTip = position ? 'Перейти к машине на карте' : 'Координат пока нет';

  return (
    <div
      className={
        'grid w-full items-start gap-x-1.5 gap-y-0.5 rounded-xl border px-2 py-1.5 transition-colors ' +
        (checked ? 'border-emerald-400/35 bg-emerald-500/12' : 'border-transparent hover:border-border-subtle hover:bg-bg-elevated')
      }
      style={{ gridTemplateColumns: `${COL_GARAGE_TRACK} ${COL_GOS} ${COL_BRAND} ${COL_FOLLOW}` }}
    >
      {/* Блок гаражного: цветная кнопка + ниже «статус скорость» */}
      <div className="flex flex-col items-stretch gap-0.5">
        <button
          type="button"
          aria-label={checked ? 'Скрыть машину с карты' : 'Показать машину на карте'}
          aria-pressed={checked}
          onClick={onToggle}
          className="flex h-7 w-full items-center justify-center rounded-lg border text-[11px] font-semibold tabular-nums transition-colors"
          style={{
            borderColor: checked ? statusColor : `${statusColor}66`,
            backgroundColor: checked ? `${statusColor}38` : `${statusColor}14`,
            color: checked ? '#F8FAFC' : statusColor,
          }}
        >
          {v.garage || '—'}
        </button>
        <div
          className="px-0.5 text-center text-[8px] font-medium leading-tight"
          style={{ color: statusColor }}
          title={`${STATUS_LABEL[status]} ${formatGlonassSpeed(position?.speed)}`}
        >
          <span className="line-clamp-2">
            {STATUS_LABEL[status]}{' '}
            <span className="font-mono tabular-nums opacity-90">
              {formatGlonassSpeed(position?.speed)}
            </span>
          </span>
        </div>
      </div>

      {/* Гос · марка · следить — строка 1 */}
      <button
        type="button"
        title={mapTip}
        disabled={!position}
        onClick={() => { if (position) onFocus(position); }}
        className="min-w-0 self-center truncate text-left font-mono text-[11.5px] font-semibold tabular-nums leading-tight text-text-strong outline-none disabled:cursor-default"
      >
        {gos}
      </button>
      <button
        type="button"
        title={mapTip}
        disabled={!position}
        onClick={() => { if (position) onFocus(position); }}
        className="min-w-0 self-center truncate text-left text-[11.5px] font-medium leading-tight text-text-strong outline-none disabled:cursor-default"
      >
        {brand}
      </button>
      <button
        type="button"
        aria-label={following ? 'Перестать следить' : 'Следить за машиной'}
        aria-pressed={following}
        title={position ? (following ? 'Слежу — камера едет за машиной' : 'Следить: камера едет за машиной') : 'Координат пока нет'}
        disabled={!position}
        onClick={onFollow}
        className={
          'flex h-7 w-7 items-center justify-center self-center justify-self-end rounded-lg border outline-none transition-colors disabled:cursor-default disabled:opacity-35 ' +
          (following
            ? 'border-accent-clay/60 bg-accent-clay/18 text-accent-clay'
            : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-bg-hover hover:text-text-strong')
        }
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>

      {/* ФИО водителя — вторая строка на всю ширину описания */}
      <button
        type="button"
        title={driver || mapTip}
        disabled={!position}
        onClick={() => { if (position) onFocus(position); }}
        className="col-start-2 col-end-4 min-w-0 truncate text-left text-[11px] leading-snug text-text-muted outline-none disabled:cursor-default"
      >
        {driver || '—'}
      </button>
    </div>
  );
}

/**
 * История — выпадающий список колонками:
 *   [пилюля по центру]  гаражный  гос  марка
 *                       ФИО водителя целиком (вторая строка)
 */
function HistoryVehiclePicker({
  fleet,
  positions,
  value,
  onChange,
  metaOf,
}: {
  fleet: GlonassVehicle[];
  positions: Map<number, GlonassPosition>;
  value: number | '';
  onChange: (id: number | '') => void;
  metaOf: (v: GlonassVehicle) => DayMeta;
}) {
  const selected = fleet.find((v) => v.id === value) ?? null;
  const selectedMeta = selected ? metaOf(selected) : null;
  const selectedStatus = vehicleStatus(selected ? positions.get(selected.id) : undefined);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-auto min-h-9 w-full min-w-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-surface px-2 py-1.5 text-left outline-none transition-colors hover:border-accent-clay/45 data-[state=open]:border-accent-clay/55"
        >
          {selected ? (
            <HistoryCols
              compact
              status={selectedStatus}
              garage={selected.garage}
              gos={formatGosPlate(selected.gos) || selected.gos}
              brand={selectedMeta?.brand || ''}
              driver={selectedMeta?.driver || ''}
            />
          ) : (
            <span className="flex-1 text-[11.5px] text-text-muted">Выберите машину</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[760] max-h-[300px] w-[min(420px,var(--radix-popover-trigger-width))] overflow-y-auto rounded-xl border border-border-default bg-bg-elevated p-1 shadow-[0_18px_58px_rgba(0,0,0,0.5)] outline-none"
        >
          {/* Шапка колонок — чтобы пункты читались как таблица */}
          <div
            className="sticky top-0 z-[1] grid items-center gap-x-1.5 border-b border-border-subtle bg-bg-elevated px-2 py-1 text-[9px] uppercase tracking-wide text-text-muted/70"
            style={{ gridTemplateColumns: `${COL_PILL} ${COL_GARAGE} ${COL_GOS} ${COL_BRAND}` }}
          >
            <span>Статус</span>
            <span>Гар.</span>
            <span>Гос</span>
            <span>Марка</span>
          </div>
          {fleet.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-text-muted">Парк пуст</div>
          )}
          {fleet.map((v) => {
            const st = vehicleStatus(positions.get(v.id));
            const m = metaOf(v);
            const on = v.id === value;
            return (
              <Popover.Close asChild key={v.id}>
                <button
                  type="button"
                  onClick={() => onChange(v.id)}
                  className={
                    'w-full rounded-lg px-1.5 py-1.5 text-left transition-colors ' +
                    (on ? 'bg-emerald-500/14' : 'hover:bg-bg-hover')
                  }
                >
                  <HistoryCols
                    status={st}
                    garage={v.garage}
                    gos={formatGosPlate(v.gos) || v.gos}
                    brand={m.brand}
                    driver={m.driver}
                  />
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function HistoryCols({
  status,
  garage,
  gos,
  brand,
  driver,
  compact = false,
}: {
  status: GlonassStatus;
  garage: string;
  gos: string;
  brand: string;
  driver: string;
  compact?: boolean;
}) {
  return (
    <div
      className="grid min-w-0 flex-1 items-center gap-x-1.5 gap-y-0.5"
      style={{ gridTemplateColumns: `${COL_PILL} ${COL_GARAGE} ${COL_GOS} ${COL_BRAND}` }}
    >
      <div className="flex items-center justify-center self-stretch">
        <StatusPill status={status} />
      </div>
      <span className="truncate text-center font-mono text-[11.5px] font-semibold tabular-nums text-text-strong">
        {garage || '—'}
      </span>
      <span className="truncate font-mono text-[11.5px] font-semibold tabular-nums text-text-strong">
        {gos || '—'}
      </span>
      <span className="truncate text-[11.5px] font-medium text-text-strong">
        {brand || '—'}
      </span>
      {/* ФИО — вторая строка, на всю ширину правых колонок */}
      <span
        className={
          'col-start-2 col-end-5 min-w-0 text-[11px] leading-snug text-text-muted ' +
          (compact ? 'truncate' : 'whitespace-normal break-words')
        }
      >
        {driver || '—'}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: GlonassStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex max-w-full shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-center text-[9px] font-semibold leading-none"
      style={{
        color,
        backgroundColor: `${color}22`,
        boxShadow: `inset 0 0 0 1px ${color}55`,
      }}
      title={STATUS_LABEL[status]}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
