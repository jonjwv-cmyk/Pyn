import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Loader2, RotateCw, Route, Satellite, Search, Square, X } from 'lucide-react';
import {
  useGlonassStore,
  vehicleStatus,
  STATUS_LABEL,
  STATUS_COLOR,
  formatGlonassSpeed,
  type GlonassPosition,
  type GlonassVehicle,
} from './glonass-store';

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
  const historyLoading = useGlonassStore((s) => s.historyLoading);
  const setOpen = useGlonassStore((s) => s.setOpen);
  const toggleSelect = useGlonassStore((s) => s.toggleSelect);
  const clearSelected = useGlonassStore((s) => s.clearSelected);
  const loadFleet = useGlonassStore((s) => s.loadFleet);
  const createHistoryLayer = useGlonassStore((s) => s.createHistoryLayer);
  const createYearRoadLayer = useGlonassStore((s) => s.createYearRoadLayer);
  const cancelHistoryLoading = useGlonassStore((s) => s.cancelHistoryLoading);

  const [query, setQuery] = useState('');
  const [historyVehicleId, setHistoryVehicleId] = useState<number | ''>('');
  const [historyFrom, setHistoryFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 2 * 60 * 60 * 1000)));
  const [historyTo, setHistoryTo] = useState(() => toLocalInputValue(new Date()));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fleet;
    return fleet.filter((v) =>
      v.garage.toLowerCase().includes(q) ||
      v.gos.toLowerCase().includes(q) ||
      v.name.toLowerCase().includes(q),
    );
  }, [fleet, query]);

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

  const createPeriodHistory = () => {
    if (!historyVehicleId) return;
    void createHistoryLayer(Number(historyVehicleId), localInputToIso(historyFrom), localInputToIso(historyTo));
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
    <div className="absolute left-3 top-3 z-[6] flex max-h-[calc(100%-1.5rem)] w-[356px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-deep/92 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md">
      {/* Шапка */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle/70 px-3">
        <Satellite className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[12.5px] font-semibold text-text-strong">Глонасс</span>
        {selected.size > 0 && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            {selected.size}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Обновить парк"
            onClick={() => loadFleet()}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Закрыть"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Поиск */}
      <div className="shrink-0 px-2.5 pb-1.5 pt-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-surface px-2 py-1">
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

      <div className="shrink-0 border-y border-border-subtle/65 bg-bg-surface/45 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          <Clock className="h-3.5 w-3.5" />
          История движения
        </div>
        <div className="grid gap-1.5">
          <select
            value={historyVehicleId}
            onChange={(e) => setHistoryVehicleId(Number(e.target.value) || '')}
            className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-deep px-2 text-[11.5px] text-text-strong outline-none"
          >
            <option value="">Выберите машину</option>
            {fleet.map((v) => (
              <option key={v.id} value={v.id}>{v.garage ? `${v.garage} · ` : ''}{v.gos || v.name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="datetime-local"
              value={historyFrom}
              onChange={(e) => setHistoryFrom(e.target.value)}
              className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-deep px-2 text-[11px] text-text-secondary outline-none"
            />
            <input
              type="datetime-local"
              value={historyTo}
              onChange={(e) => setHistoryTo(e.target.value)}
              className="h-7 min-w-0 rounded-md border border-border-subtle bg-bg-deep px-2 text-[11px] text-text-secondary outline-none"
            />
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-1.5">
            <button
              type="button"
              disabled={!historyVehicleId || !!historyLoading}
              onClick={createPeriodHistory}
              className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-sky-400/35 bg-sky-500/12 px-2 text-[11px] font-semibold text-sky-200 outline-none transition-colors hover:bg-sky-500/18 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Route className="h-3.5 w-3.5" />
              Маршрут
            </button>
            <button
              type="button"
              disabled={(!historyVehicleId && selected.size === 0) || !!historyLoading}
              onClick={createSelectedYearHistory}
              className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-pink-400/35 bg-pink-500/12 px-2 text-[11px] font-semibold text-pink-200 outline-none transition-colors hover:bg-pink-500/18 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="h-2.5 w-4 rounded-full bg-[#F472D0]" />
              Выбран.
            </button>
            <button
              type="button"
              disabled={fleet.length === 0 || !!historyLoading}
              onClick={createFleetYearHistory}
              className="flex h-7 items-center justify-center gap-1 rounded-md border border-pink-400/35 bg-pink-500/12 px-2 text-[11px] font-semibold text-pink-200 outline-none transition-colors hover:bg-pink-500/18 disabled:cursor-not-allowed disabled:opacity-45"
              title="Розовые следы с 01.01.2026 по всему парку"
            >
              Весь парк
            </button>
          </div>
          {historyLoading && (
            <div className="rounded-md border border-border-subtle bg-bg-deep/80 px-2 py-1.5">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
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
          <div className="grid grid-cols-[54px_minmax(0,1fr)_98px] items-center gap-2 px-2 pb-1 pt-0.5 text-[9.5px] uppercase tracking-wide text-text-muted/75">
            <span>Гар.</span>
            <span>Машина</span>
            <span>Статус</span>
          </div>
        )}
        {ordered.map((v) => (
          <VehicleRow
            key={v.id}
            v={v}
            checked={selected.has(v.id)}
            position={positions.get(v.id)}
            onToggle={() => toggleSelect(v.id)}
            onFocus={onFocusVehicle}
          />
        ))}
      </div>
    </div>
  );
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function yearStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).toISOString();
}

function VehicleRow({ v, checked, position, onToggle, onFocus }: {
  v: GlonassVehicle;
  checked: boolean;
  position: GlonassPosition | undefined;
  onToggle: () => void;
  onFocus: (pos: GlonassPosition) => void;
}) {
  const status = vehicleStatus(position);
  const statusColor = STATUS_COLOR[status];
  const title = position ? 'Перейти к машине на карте' : 'Координат пока нет';

  return (
    <div
      className={
        'grid w-full grid-cols-[54px_minmax(0,1fr)_98px] items-center gap-2 rounded-md px-2 py-1.5 transition-colors ' +
        (checked ? 'bg-emerald-500/12' : 'hover:bg-bg-hover')
      }
    >
      <button
        type="button"
        aria-label={checked ? 'Скрыть машину с карты' : 'Показать машину на карте'}
        aria-pressed={checked}
        onClick={onToggle}
        className={
          'flex h-7 w-full items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-semibold tabular-nums transition-colors ' +
          (checked
            ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100'
            : 'border-white/15 bg-bg-surface text-text-muted hover:border-emerald-400/70 hover:text-text-strong')
        }
      >
        <span>{v.garage || '—'}</span>
        {checked && <Check className="h-3 w-3" />}
      </button>

      <button
        type="button"
        title={title}
        disabled={!position}
        onClick={() => { if (position) onFocus(position); }}
        className="min-w-0 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="block whitespace-normal break-words text-[12px] font-medium leading-[1.18] text-text-strong">
          {v.gos || v.name}
        </span>
      </button>

      <button
        type="button"
        title={title}
        disabled={!position}
        onClick={() => { if (position) onFocus(position); }}
        className="grid min-w-0 grid-cols-[11px_minmax(0,1fr)] items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10.5px] leading-[1.1] text-text-muted outline-none transition-colors hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.08)]" style={{ backgroundColor: statusColor }} />
        <span className="min-w-0">
          <span className="block whitespace-normal break-words">{STATUS_LABEL[status]}</span>
          <span className="block whitespace-nowrap font-mono text-[9.5px] tabular-nums text-text-muted/75">
            {formatGlonassSpeed(position?.speed)}
          </span>
        </span>
      </button>
    </div>
  );
}
