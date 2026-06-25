import { useMemo, useState } from 'react';
import { LocateFixed, MapPinned, Phone, Trash2, X } from 'lucide-react';
import { groupByWarehouse, type MolRecord } from '@pyn/core';
import { cn } from '@/lib/cn';
import { splitAndFormatWorkPhones } from '@/lib/mol-format';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { useMolStore } from '@/lib/stores';
import { WarehouseCard } from '@/components/mol/WarehouseSidebar';
import { useMapStore } from '@/lib/map-store';
import {
  AREA_COLORS,
  EMPTY_POINT_EQUIPMENT,
  VEHICLE_TYPES,
  roadPaintOption,
  vehicleLabel,
  type LatLng,
  type MapPoint,
  type MapRoadSuggestion,
  type VehicleType,
} from './map-types';
import type { MapSelection } from './MapCanvas';

interface Props {
  selection: MapSelection;
  onClose: () => void;
  onSelect: (selection: MapSelection) => void;
  onFocus: (latlng: LatLng) => void;
  onMovePointByMap: (id: string) => void;
}

/** Правая панель деталей выбранного объекта карты (точка / область / дорога). */
export function MapDetailPanel({ selection, onClose, onSelect, onFocus, onMovePointByMap }: Props) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-border-subtle/70 bg-bg-deep/20">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle/70 px-3">
        <span className="text-[12.5px] font-semibold text-text-strong">
          {selection.type === 'point'
            ? 'Точка склада'
            : selection.type === 'area'
              ? 'Область'
              : selection.type === 'roadSuggestion'
                ? 'Черновик дороги'
                : selection.type === 'roadAccess'
                  ? 'Особенности дороги'
                  : 'Дорога'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5">
        {selection.type === 'point' && (
          <PointEditor
            id={selection.id}
            onDeleted={onClose}
            onSelect={onSelect}
            onFocus={onFocus}
            onMoveByMap={onMovePointByMap}
          />
        )}
        {selection.type === 'area' && <AreaEditor id={selection.id} onDeleted={onClose} />}
        {selection.type === 'road' && <RoadEditor id={selection.id} onDeleted={onClose} />}
        {selection.type === 'roadSuggestion' && <RoadSuggestionEditor id={selection.id} onDone={onClose} />}
        {selection.type === 'roadAccess' && <RoadAccessEditor id={selection.id} onDeleted={onClose} />}
      </div>
    </aside>
  );
}

// ─── Точка ──────────────────────────────────────────────────────────────────

function PointEditor({
  id,
  onDeleted,
  onSelect,
  onFocus,
  onMoveByMap,
}: {
  id: string;
  onDeleted: () => void;
  onSelect: (selection: MapSelection) => void;
  onFocus: (latlng: LatLng) => void;
  onMoveByMap: (id: string) => void;
}) {
  const point = useMapStore((s) => s.doc.points.find((p) => p.id === id));
  const allPoints = useMapStore((s) => s.doc.points);
  const updatePoint = useMapStore((s) => s.updatePoint);
  const removePoint = useMapStore((s) => s.removePoint);

  if (!point) return null;
  const equipment = point.equipment ?? EMPTY_POINT_EQUIPMENT;

  return (
    <div className="space-y-2.5">
      <WarehousePicker
        value={point.warehouseId}
        onPick={(wid) => updatePoint(id, { warehouseId: wid })}
      />

      {/* Карточка склада «как в Цеха» (название цеха, телефоны, статус, график) */}
      {point.warehouseId && (
        <WarehouseCard
          warehouseId={point.warehouseId}
          hideMapLink
          onContactAction={(req) => { void navigator.clipboard?.writeText(req.target); }}
        />
      )}

      {/* МОЛы склада */}
      {point.warehouseId && <MolBlock warehouseId={point.warehouseId} />}

      {point.warehouseId && (
        <WarehousePointsBlock
          currentId={id}
          warehouseId={point.warehouseId}
          points={allPoints}
          onSelect={(pointId) => onSelect({ type: 'point', id: pointId })}
          onFocus={(p) => onFocus({ lat: p.lat, lng: p.lng })}
        />
      )}

      {/* Поля точки */}
      <Field label="Подпись на карте">
        <input
          value={point.label}
          onChange={(e) => updatePoint(id, { label: e.target.value })}
          placeholder={point.warehouseId ?? 'Точка'}
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>

      <Field label="Что выгружаем / место выгрузки">
        <textarea
          value={point.comment}
          onChange={(e) => updatePoint(id, { comment: e.target.value })}
          rows={2}
          className="w-full resize-none rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>

      <Field label="Объём отгрузок (вес для оптимизации)">
        <input
          type="number"
          min={0}
          step={1}
          value={point.weight}
          onChange={(e) => updatePoint(id, { weight: Math.max(0, Number(e.target.value) || 0) })}
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 font-mono text-[12.5px] tabular-nums text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>

      <Field label="Оснастка на месте">
        <div className="grid grid-cols-3 gap-1">
          <ToggleChip
            label="Кран"
            active={equipment.crane}
            onClick={() => updatePoint(id, { equipment: { ...equipment, crane: !equipment.crane } })}
          />
          <ToggleChip
            label="Погрузчик"
            active={equipment.forklift}
            onClick={() => updatePoint(id, { equipment: { ...equipment, forklift: !equipment.forklift } })}
          />
          <ToggleChip
            label="Штабелер"
            active={equipment.stacker}
            onClick={() => updatePoint(id, { equipment: { ...equipment, stacker: !equipment.stacker } })}
          />
        </div>
        {!equipment.crane && !equipment.forklift && !equipment.stacker && (
          <p className="mt-1 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
            Оснастка не выбрана — считаем ручную погрузку.
          </p>
        )}
      </Field>

      <button
        type="button"
        onClick={() => updatePoint(id, { rearUnload: !point.rearUnload })}
        className={cn(
          'flex h-7 w-full items-center justify-between rounded border px-2 text-[12px] outline-none transition-colors',
          point.rearUnload
            ? 'border-emerald-400/45 bg-emerald-400/10 text-emerald-200'
            : 'border-border-default text-text-muted hover:bg-bg-hover hover:text-text-secondary',
        )}
      >
        <span>ТМЦ сзади</span>
        <span>{point.rearUnload ? 'да' : 'нет'}</span>
      </button>

      <CoordsBlock point={point} />

      <button
        type="button"
        onClick={() => onMoveByMap(id)}
        className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-emerald-400/35 text-[12px] font-medium text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
      >
        <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.75} /> Переместить картой
      </button>

      <button
        type="button"
        onClick={() => { removePoint(id); onDeleted(); }}
        className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-danger/30 text-[12px] font-medium text-danger outline-none transition-colors hover:bg-danger/10"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Удалить точку
      </button>
    </div>
  );
}

function CoordsBlock({ point }: { point: MapPoint }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated/50 px-2.5 py-2 text-[11.5px]">
      <p className="text-text-muted">Координаты места выгрузки</p>
      <p className="mt-0.5 font-mono text-[12.5px] tabular-nums text-text-strong">
        {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
      </p>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(`${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`)}
        className="mt-0.5 text-[10.5px] text-text-muted underline-offset-2 outline-none hover:text-accent-clay hover:underline"
      >копировать GPS</button>
    </div>
  );
}

function WarehousePointsBlock({
  currentId,
  warehouseId,
  points,
  onSelect,
  onFocus,
}: {
  currentId: string;
  warehouseId: string;
  points: MapPoint[];
  onSelect: (id: string) => void;
  onFocus: (point: MapPoint) => void;
}) {
  const siblings = points.filter((p) => p.warehouseId === warehouseId);
  if (siblings.length <= 1) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/35 px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Точки склада {warehouseId}
      </p>
      <div className="space-y-1">
        {siblings.map((p, index) => {
          const active = p.id === currentId;
          const title = p.label.trim() || p.comment.trim() || `${warehouseId} · точка ${index + 1}`;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p.id);
                onFocus(p);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] outline-none transition-colors',
                active
                  ? 'border-emerald-400/45 bg-emerald-400/10 text-text-strong'
                  : 'border-border-subtle text-text-secondary hover:bg-bg-hover',
              )}
            >
              <MapPinned className="h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {p.rearUnload && <span className="shrink-0 rounded bg-emerald-400/15 px-1 text-[10px] text-emerald-200">сзади</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── МОЛы склада ──────────────────────────────────────────────────────────

function MolBlock({ warehouseId }: { warehouseId: string }) {
  const records = useMolStore((s) => s.records);
  const mols = useMemo(() => {
    const m = groupByWarehouse(records);
    return m.get(warehouseId.trim().toLowerCase()) ?? [];
  }, [records, warehouseId]);

  if (mols.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">МОЛы склада</p>
      <div className="space-y-2">
        {mols.map((r) => <MolRow key={r.remoteId} r={r} />)}
      </div>
    </div>
  );
}

function MolRow({ r }: { r: MolRecord }) {
  const phones = r.work ? splitAndFormatWorkPhones(r.work) : [];
  return (
    <div className="text-[12px]">
      <p className="font-semibold text-text-strong">{r.fio || '—'}</p>
      {r.position && <p className="text-text-muted">{r.position}</p>}
      {r.mobile && (
        <p className="mt-0.5 flex items-center gap-1.5 font-mono tabular-nums text-text-secondary">
          <Phone className="h-3 w-3 text-text-muted" strokeWidth={1.75} /> {r.mobile}
        </p>
      )}
      {phones.map((p, i) => (
        <p key={i} className="font-mono tabular-nums text-text-secondary">{p}</p>
      ))}
    </div>
  );
}

// ─── Выбор склада ─────────────────────────────────────────────────────────

function WarehousePicker({ value, onPick }: { value: string | null; onPick: (id: string | null) => void }) {
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc) return [];
    return warehouses
      .filter((w) => w.id.toLowerCase().includes(lc) || (w.shop_name ?? '').toLowerCase().includes(lc))
      .slice(0, 8);
  }, [q, warehouses]);

  return (
    <Field label="Склад">
      <div className="flex items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={value ? `Склад ${value} — заменить…` : 'Найти склад по номеру / цеху'}
          className="flex-1 rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
        {value && (
          <button
            type="button"
            onClick={() => onPick(null)}
            title="Отвязать склад"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
          ><X className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
        )}
      </div>
      {results.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border-subtle bg-bg-elevated">
          {results.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => { onPick(w.id); setQ(''); }}
              className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-[12px] outline-none transition-colors hover:bg-bg-hover"
            >
              <span className="font-semibold tabular-nums text-text-strong">{w.id}</span>
              <span className="truncate text-text-muted">{w.shop_name}</span>
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

// ─── Область ────────────────────────────────────────────────────────────────

function AreaEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const area = useMapStore((s) => s.doc.areas.find((a) => a.id === id));
  const updateArea = useMapStore((s) => s.updateArea);
  const removeArea = useMapStore((s) => s.removeArea);
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const shopNames = useMemo(
    () => Array.from(new Set(warehouses.map((w) => w.shop_name).filter(Boolean))).sort() as string[],
    [warehouses],
  );
  if (!area) return null;
  return (
    <div className="space-y-3">
      <Field label="Название области">
        <input
          value={area.name}
          onChange={(e) => updateArea(id, { name: e.target.value })}
          placeholder="напр. Конвертерный"
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>
      <Field label="Цвет">
        <div className="flex flex-wrap gap-1.5">
          {AREA_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => updateArea(id, { color: c })}
              className={cn('h-6 w-6 rounded-md outline-none ring-offset-1 ring-offset-bg-surface', area.color === c && 'ring-2 ring-white')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
      <Field label="Привязать к цеху (для фильтра)">
        <select
          value={area.shopName ?? ''}
          onChange={(e) => updateArea(id, { shopName: e.target.value || null })}
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        >
          <option value="">— без привязки —</option>
          {shopNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
      <DeleteBtn label="Удалить область" onClick={() => { removeArea(id); onDeleted(); }} />
    </div>
  );
}

// ─── Дорога ──────────────────────────────────────────────────────────────────

function RoadEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const road = useMapStore((s) => s.doc.roads.find((r) => r.id === id));
  const updateRoad = useMapStore((s) => s.updateRoad);
  const removeRoad = useMapStore((s) => s.removeRoad);
  if (!road) return null;
  return (
    <div className="space-y-3">
      <Field label="Название дороги">
        <input
          value={road.name}
          onChange={(e) => updateRoad(id, { name: e.target.value })}
          placeholder="напр. Главный въезд"
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>
      <p className="rounded-md border border-border-subtle bg-bg-elevated/50 px-2.5 py-2 text-[11.5px] text-text-muted">
        Точек: {road.vertices.length}. Дороги сохраняются как рабочий слой для будущего расчёта маршрутов.
      </p>
      <DeleteBtn label="Удалить дорогу" onClick={() => { removeRoad(id); onDeleted(); }} />
    </div>
  );
}

function RoadSuggestionEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const suggestion = useMapStore((s) => s.doc.roadSuggestions.find((r) => r.id === id));
  const acceptRoadSuggestion = useMapStore((s) => s.acceptRoadSuggestion);
  const rejectRoadSuggestion = useMapStore((s) => s.rejectRoadSuggestion);
  if (!suggestion) return null;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-text-secondary">
        <p className="font-semibold text-red-200">{suggestion.name || 'Черновой проезд'}</p>
        <p className="mt-1 text-text-muted">
          Источник: {formatSuggestionSource(suggestion)}. До подтверждения эта линия не участвует в расчёте маршрутов.
        </p>
        <p className="mt-1 text-text-muted">Точек: {suggestion.vertices.length}</p>
      </div>
      <button
        type="button"
        onClick={() => { acceptRoadSuggestion(id); onDone(); }}
        className="flex h-7 w-full items-center justify-center rounded border border-emerald-400/35 text-[12px] font-medium text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
      >
        Да, добавить в дорожную сеть
      </button>
      <DeleteBtn label="Нет, убрать черновик" onClick={() => { rejectRoadSuggestion(id); onDone(); }} />
    </div>
  );
}

function formatSuggestionSource(suggestion: MapRoadSuggestion): string {
  return suggestion.source === 'osm' ? 'OSM / открытая карта' : 'ИИ-черновик';
}

// ─── Особенности дороги (какие машины проедут) ───────────────────────────────

function RoadAccessEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const access = useMapStore((s) => s.doc.roadAccess.find((a) => a.id === id));
  const updateRoadAccess = useMapStore((s) => s.updateRoadAccess);
  const removeRoadAccess = useMapStore((s) => s.removeRoadAccess);
  if (!access) return null;

  const toggle = (v: VehicleType) => {
    const has = access.vehicles.includes(v);
    updateRoadAccess(id, {
      kind: 'limited',
      vehicles: has ? access.vehicles.filter((x) => x !== v) : [...access.vehicles, v],
    });
  };
  const closed = access.kind === 'closed';

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-2.5 py-2 text-[11.5px] text-text-secondary">
        Окрашенный участок дороги. Если ограничений нет — участок не красим: он считается проездным для всех.
      </p>

      <Field label="Режим участка">
        <button
          type="button"
          onClick={() => updateRoadAccess(id, { kind: 'closed', vehicles: [] })}
          className={cn(
            'mb-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors',
            closed
              ? 'border-red-400/55 bg-red-400/12 text-red-200'
              : 'border-border-default text-text-secondary hover:bg-bg-hover',
          )}
        >
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: roadPaintOption('closed').color }} />
          <span className="flex-1">{roadPaintOption('closed').label}</span>
        </button>
        <div className="space-y-1">
          {VEHICLE_TYPES.map((v) => {
            const on = !closed && access.vehicles.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggle(v.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors',
                  on
                    ? 'border-[#22D3EE]/50 bg-[#22D3EE]/12 text-text-strong'
                    : 'border-border-default text-text-secondary hover:bg-bg-hover',
                )}
                >
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-[3px] border text-[10px]', on ? 'border-[#22D3EE] bg-[#22D3EE] text-bg-deep' : 'border-border-default')}>
                  {on && '✓'}
                </span>
                <span className="flex-1">{vehicleLabel(v.id)}</span>
                <span className="font-mono text-[10.5px] text-text-muted">{v.short}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Заметка (необязательно)">
        <textarea
          value={access.note}
          onChange={(e) => updateRoadAccess(id, { note: e.target.value })}
          rows={2}
          placeholder="напр. узкий проезд, только пустые"
          className="w-full resize-none rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>

      <p className="text-[11px] text-text-muted">Точек трассы: {access.vertices.length}</p>

      <DeleteBtn label="Удалить особенность" onClick={() => { removeRoadAccess(id); onDeleted(); }} />
    </div>
  );
}

// ─── мелочи ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-7 rounded-md border px-1.5 text-[11.5px] outline-none transition-colors',
        active
          ? 'border-emerald-400/45 bg-emerald-400/10 text-emerald-200'
          : 'border-border-default text-text-muted hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      {label}
    </button>
  );
}

function DeleteBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-danger/30 text-[12px] font-medium text-danger outline-none transition-colors hover:bg-danger/10"
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
    </button>
  );
}
