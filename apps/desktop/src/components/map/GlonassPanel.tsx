import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, Crosshair, History, Loader2, RotateCw, Satellite, Search, Square, X } from 'lucide-react';
import { flowTransportGet, flowVehiclesGet } from '@pyn/core';
import { api } from '@/lib/api';
import {
  useGlonassStore,
  vehicleStatus,
  STATUS_LABEL,
  STATUS_COLOR,
  GLONASS_PRO_COLOR,
  GLONASS_RAW_COLOR,
  type GlonassPosition,
  type GlonassVehicle,
} from './glonass-store';
import {
  brandFromModel,
  formatGosPlate,
  todayYmdYekaterinburg,
} from './glonass-format';
import { computeGlonassLayout, GLONASS_STATUS_SAMPLE } from './glonass-layout';

type DayMeta = { vehicleType: string; brand: string; driver: string };

/** Кэш meta на день — не дёргаем transport/vehicles на каждый ре-рендер/fleet.length. */
let dayMetaCache: { day: string; at: number; map: Map<string, DayMeta> } | null = null;
const DAY_META_TTL_MS = 90_000;

const EMPTY_META: DayMeta = { vehicleType: '', brand: '', driver: '' };

/** @deprecated use store weatherLeftPx */
export const GLONASS_WEATHER_LEFT_PX = 382;
const COL_ACTIONS = '1.65rem';

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
  const cancelHistoryLoading = useGlonassStore((s) => s.cancelHistoryLoading);
  const showPro = useGlonassStore((s) => s.showPro);
  const showRaw = useGlonassStore((s) => s.showRaw);
  const setShowPro = useGlonassStore((s) => s.setShowPro);
  const setShowRaw = useGlonassStore((s) => s.setShowRaw);
  const setPanelLayout = useGlonassStore((s) => s.setPanelLayout);
  const panelWidthPx = useGlonassStore((s) => s.panelWidthPx);
  const pillWidthPx = useGlonassStore((s) => s.pillWidthPx);

  const [query, setQuery] = useState('');
  /** Гаражный → тип ТС / марка / водитель (кэш 90с, без FlowTransportGrid). */
  const [dayMeta, setDayMeta] = useState<Map<string, DayMeta>>(
    () => dayMetaCache?.map ?? new Map(),
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const day = todayYmdYekaterinburg();
    const now = Date.now();
    if (dayMetaCache && dayMetaCache.day === day && now - dayMetaCache.at < DAY_META_TTL_MS) {
      setDayMeta(dayMetaCache.map);
      return;
    }
    void (async () => {
      try {
        const [vehs, trRows] = await Promise.all([
          flowVehiclesGet(api),
          flowTransportGet(api, day),
        ]);
        if (cancelled) return;
        const brandByGarage = new Map<string, string>();
        for (const v of vehs) {
          const g = (v.garage_no || '').trim();
          if (!g) continue;
          const brand = brandFromModel(v.model || '');
          if (brand) brandByGarage.set(g.toUpperCase(), brand);
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
        for (const k of new Set([...brandByGarage.keys(), ...driverByGarage.keys(), ...trTypeByGarage.keys()])) {
          next.set(k, {
            vehicleType: trTypeByGarage.get(k) || '',
            brand: brandByGarage.get(k) || '',
            driver: driverByGarage.get(k) || '',
          });
        }
        dayMetaCache = { day, at: Date.now(), map: next };
        setDayMeta(next);
      } catch {
        /* сеть — список без meta */
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fleet;
    return fleet.filter((v) => {
      const m = dayMeta.get((v.garage || '').toUpperCase());
      return (
        v.garage.toLowerCase().includes(q) ||
        v.gos.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (m?.driver || '').toLowerCase().includes(q) ||
        (m?.brand || '').toLowerCase().includes(q) ||
        (m?.vehicleType || '').toLowerCase().includes(q)
      );
    });
  }, [fleet, query, dayMeta]);

  // Выбранные — наверх (лёгкая сортировка).
  const ordered = useMemo(() => {
    if (selected.size === 0) return filtered;
    return [...filtered].sort((a, b) => {
      const sa = selected.has(a.id) ? 0 : 1;
      const sb = selected.has(b.id) ? 0 : 1;
      return sa - sb;
    });
  }, [filtered, selected]);

  // Ширина панели = пилл(«В движении 999 км/ч») + max ФИО + кнопки; погода сдвигается.
  useEffect(() => {
    if (!open) return;
    const drivers = [...dayMeta.values()].map((m) => m.driver);
    const layout = computeGlonassLayout(drivers);
    setPanelLayout({
      panelWidth: layout.panelWidth,
      weatherLeft: layout.weatherLeft,
      pillWidth: layout.pillWidth,
    });
  }, [open, dayMeta, setPanelLayout]);

  const onToggle = useCallback((id: number) => toggleSelect(id), [toggleSelect]);
  const onFollowToggle = useCallback((id: number) => {
    setFollow(followId === id ? null : id);
  }, [followId, setFollow]);

  if (!open) return null;

  return (
    <div
      className="absolute left-3 top-3 z-[6] flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-[0_18px_58px_rgba(0,0,0,0.46)]"
      style={{ width: panelWidthPx }}
    >
      {/* Шапка — компактнее */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2.5">
        <Satellite className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[12.5px] font-semibold text-text-strong">Глонасс</span>
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
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Закрыть"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Поиск */}
      <div className="shrink-0 px-2.5 pb-1.5 pt-2">
        <div className="flex h-7 items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-elevated px-2">
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

      {/* PRO / сырой ГЛОНАСС — компактно */}
      <div className="shrink-0 border-y border-border-subtle bg-bg-elevated px-2.5 py-1.5">
        <div className="grid grid-cols-2 gap-1" aria-label="Отображение маршрута">
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
        {historyLoading && (
          <div className="mt-1.5 rounded-lg border border-border-subtle bg-bg-surface px-2 py-1">
            <div className="flex items-center gap-2 text-[10.5px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" />
              <span className="min-w-0 flex-1 truncate">{historyLoading.label}</span>
              <span className="font-mono tabular-nums">{historyLoading.done}/{historyLoading.total}</span>
              <button
                type="button"
                title="Остановить"
                onClick={cancelHistoryLoading}
                className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-strong"
              >
                <Square className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Список парка — история: иконка у строки → календарь → «История» */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1">
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
        {ordered.map((v) => (
          <VehicleRow
            key={v.id}
            v={v}
            meta={dayMeta.get((v.garage || '').toUpperCase()) ?? EMPTY_META}
            checked={selected.has(v.id)}
            following={followId === v.id}
            position={positions.get(v.id)}
            onToggle={onToggle}
            onFocus={onFocusVehicle}
            onFollowToggle={onFollowToggle}
            historyBusy={!!historyLoading}
            pillWidthPx={pillWidthPx}
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
        'flex h-7 items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-semibold outline-none transition-colors',
        on ? 'border-white/25 bg-white/10 text-text-strong' : 'border-border-subtle bg-bg-surface text-text-muted hover:bg-bg-hover',
      ].join(' ')}
    >
      <span className="h-[3px] w-5 shrink-0 rounded-full" style={{ backgroundColor: color, opacity: on ? 1 : 0.38 }} />
      <span className="min-w-0 flex-1 text-left">{label}</span>
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[9px]"
        style={on ? { borderColor: color, backgroundColor: `${color}24`, color } : undefined}
      >{on ? '✓' : ''}</span>
    </button>
  );
}

/** Календарь дня (inline) — для попапа «История» у строки. */
function InlineDayCalendar({ value, onChange }: {
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
    <div className="w-[272px]">
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
    </div>
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

/**
 * Строка — CSS grid, кнопки не наезжают на ФИО:
 *  [пилл 7.5rem] [ФИО / гос+марка 1fr] [⊙+🕘 1.65rem]
 * Плотно, без лишней пустоты в пилле.
 */
const VehicleRow = memo(function VehicleRow({
  v,
  meta,
  checked,
  following,
  position,
  onToggle,
  onFocus,
  onFollowToggle,
  historyBusy,
  pillWidthPx,
}: {
  v: GlonassVehicle;
  meta: DayMeta;
  checked: boolean;
  following: boolean;
  position: GlonassPosition | undefined;
  onToggle: (id: number) => void;
  onFocus: (pos: GlonassPosition) => void;
  onFollowToggle: (id: number) => void;
  historyBusy: boolean;
  pillWidthPx: number;
}) {
  const status = vehicleStatus(position);
  const color = STATUS_COLOR[status];
  const gosFmt = formatGosPlate(v.gos) || '';
  const speedText = position?.speed == null || !Number.isFinite(position.speed)
    ? '— км/ч'
    : `${Math.min(999, Math.round(position.speed))} км/ч`;
  const statusLabel = STATUS_LABEL[status];
  const type = meta.vehicleType.trim();
  const brand = meta.brand.trim();
  const driver = meta.driver.trim();

  return (
    <div
      className={
        'grid w-full items-stretch gap-x-1.5 rounded-lg px-1.5 py-0.5 transition-colors ' +
        (checked ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]')
      }
      style={{ gridTemplateColumns: `${pillWidthPx}px minmax(0, 1fr) ${COL_ACTIONS}` }}
    >
      {/* Пилл: стр.1 гаражный+тип · стр.2 «В движении 999 км/ч» без переноса */}
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onToggle(v.id)}
        title={`${statusLabel} ${speedText} · эталон ширины: ${GLONASS_STATUS_SAMPLE}`}
        className="flex w-full cursor-pointer flex-col items-start justify-center gap-px rounded-md border px-1.5 py-1 text-left outline-none transition-[filter] hover:brightness-110"
        style={{
          minHeight: 42,
          borderColor: `${color}${checked ? 'ee' : '99'}`,
          backgroundColor: `${color}${checked ? '5c' : '40'}`,
        }}
      >
        <span className="flex w-full min-w-0 items-baseline gap-1 leading-none">
          <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-white">
            {v.garage || '—'}
          </span>
          {type ? (
            <span className="min-w-0 truncate text-[10px] font-semibold text-white/95" title={type}>
              {type}
            </span>
          ) : null}
        </span>
        <span className="w-full whitespace-nowrap text-[10.5px] font-semibold leading-tight text-white">
          {statusLabel}{' '}
          <span className="font-mono tabular-nums font-medium">{speedText}</span>
        </span>
      </button>

      {/* ФИО целиком (колонка расширяется под max ФИО); 2-я: гос + марка */}
      <button
        type="button"
        disabled={!position}
        title={driver || (position ? 'Перейти к машине на карте' : 'Координат пока нет')}
        onClick={() => { if (position) onFocus(position); }}
        className="flex min-w-0 flex-col justify-center gap-px overflow-hidden text-left outline-none disabled:cursor-default"
        style={{ minHeight: 42 }}
      >
        <span className="block min-w-0 truncate text-[12px] font-medium leading-tight text-text-strong">
          {driver || '\u00a0'}
        </span>
        <span className="flex min-w-0 items-baseline gap-1 overflow-hidden leading-tight">
          {gosFmt ? (
            <span className="shrink-0 font-mono text-[11.5px] font-semibold tabular-nums text-text-strong">
              {gosFmt}
            </span>
          ) : null}
          {brand ? (
            <span className="min-w-0 truncate text-[11.5px] font-medium text-text-secondary">
              {brand}
            </span>
          ) : null}
          {!gosFmt && !brand ? <span className="text-[11.5px]">{'\u00a0'}</span> : null}
        </span>
      </button>

      <div className="flex flex-col items-center justify-center gap-0.5 self-center">
        <button
          type="button"
          aria-label={following ? 'Перестать следить' : 'Следить за машиной'}
          aria-pressed={following}
          title={position ? (following ? 'Слежу' : 'Следить / найти') : 'Координат пока нет'}
          disabled={!position}
          onClick={() => onFollowToggle(v.id)}
          className={
            'flex h-6 w-6 items-center justify-center rounded-md border outline-none transition-colors disabled:cursor-default disabled:opacity-35 ' +
            (following
              ? 'border-accent-clay/60 bg-accent-clay/18 text-accent-clay'
              : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-bg-hover hover:text-text-strong')
          }
        >
          <Crosshair className="h-3.5 w-3.5" />
        </button>
        <VehicleHistoryButton vehicleId={v.id} garage={v.garage} busy={historyBusy} />
      </div>
    </div>
  );
});

/** Иконка истории → календарь → «История» (без подписки на store в каждой строке). */
function VehicleHistoryButton({
  vehicleId,
  garage,
  busy,
}: {
  vehicleId: number;
  garage: string;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => toLocalDateValue(new Date()));

  const run = () => {
    const [from, to] = localDayRangeToIso(day);
    void useGlonassStore.getState().createHistoryLayer(vehicleId, from, to).then(() => setOpen(false));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={`История · ${garage || vehicleId}`}
          disabled={busy}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-text-muted outline-none transition-colors hover:border-border-subtle hover:bg-bg-hover hover:text-sky-300 disabled:opacity-40"
        >
          <History className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[760] rounded-2xl border border-border-default bg-bg-elevated p-3 text-text-primary shadow-[0_18px_58px_rgba(0,0,0,0.5)] outline-none"
        >
          <div className="mb-2 text-[11px] font-semibold text-text-strong">
            История · {garage || vehicleId}
          </div>
          <InlineDayCalendar value={day} onChange={setDay} />
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 text-[12px] font-semibold text-sky-200 outline-none transition-colors hover:bg-sky-500/22 disabled:opacity-45"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
            История
          </button>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
