import { useMemo, useState } from 'react';
import { Phone, Trash2, X } from 'lucide-react';
import { groupByWarehouse, type MolRecord } from '@pyn/core';
import { cn } from '@/lib/cn';
import { splitAndFormatWorkPhones } from '@/lib/mol-format';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { useMolStore } from '@/lib/stores';
import { WarehouseCard } from '@/components/mol/WarehouseSidebar';
import { useMapStore } from '@/lib/map-store';
import { AREA_COLORS, VEHICLE_TYPES, type MapPoint, type MapRoadSuggestion, type VehicleType } from './map-types';
import type { MapSelection } from './MapCanvas';

interface Props {
  selection: MapSelection;
  onClose: () => void;
}

/** Правая панель деталей выбранного объекта карты (точка / область / дорога). */
export function MapDetailPanel({ selection, onClose }: Props) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border-subtle bg-bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-3">
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
      <div className="flex-1 overflow-y-auto p-3">
        {selection.type === 'point' && <PointEditor id={selection.id} onDeleted={onClose} />}
        {selection.type === 'area' && <AreaEditor id={selection.id} onDeleted={onClose} />}
        {selection.type === 'road' && <RoadEditor id={selection.id} onDeleted={onClose} />}
        {selection.type === 'roadSuggestion' && <RoadSuggestionEditor id={selection.id} onDone={onClose} />}
        {selection.type === 'roadAccess' && <RoadAccessEditor id={selection.id} onDeleted={onClose} />}
      </div>
    </aside>
  );
}

// ─── Точка ──────────────────────────────────────────────────────────────────

function PointEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const point = useMapStore((s) => s.doc.points.find((p) => p.id === id));
  const updatePoint = useMapStore((s) => s.updatePoint);
  const removePoint = useMapStore((s) => s.removePoint);
  const warehouses = useWarehousesStore((s) => s.warehouses);

  if (!point) return null;

  return (
    <div className="space-y-3">
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

      <CoordsBlock point={point} />

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
      vehicles: has ? access.vehicles.filter((x) => x !== v) : [...access.vehicles, v],
    });
  };

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-2.5 py-2 text-[11.5px] text-text-secondary">
        Обведённый участок дороги. Отметьте, какие машины здесь проедут — по плану будет видно проходимость.
      </p>

      <Field label="Кто может ехать">
        <div className="space-y-1">
          {VEHICLE_TYPES.map((v) => {
            const on = access.vehicles.includes(v.id);
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
                <span className="flex-1">{v.label}</span>
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
