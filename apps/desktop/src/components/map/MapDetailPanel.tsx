import { useEffect, useMemo, useState } from 'react';
import { Copy, LocateFixed, MapPinned, Navigation, TrainTrack, Trash2, Warehouse, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { useMapStore } from '@/lib/map-store';
import {
  AREA_COLORS,
  EMPTY_POINT_EQUIPMENT,
  EQUIPMENT_META,
  POINT_VEHICLE_TYPES,
  VEHICLE_TYPES,
  roadPaintOption,
  vehicleLabel,
  type LatLng,
  type MapPoint,
  type MapRoadSuggestion,
  type VehicleType,
} from './map-types';
import type { MapSelection } from './MapCanvas';
import { formatDistanceMeters } from './geo';
import type { RouteResult } from './route-network';

interface Props {
  selection: MapSelection;
  /** developer — правка доступна; admin — только просмотр. */
  canEdit: boolean;
  onClose: () => void;
  onSelect: (selection: MapSelection) => void;
  onFocus: (latlng: LatLng) => void;
  onMovePointByMap: (id: string) => void;
  /** Создана копия точки — родитель наводится на неё и включает «перемещение». */
  onDuplicatedPoint: (id: string) => void;
  routeSourcePointId: string | null;
  routeResult: RouteResult | null;
  /** Машина, по которой считается маршрут (для подписи/предупреждения). */
  routeVehicle: VehicleType | null;
  onSetRouteFromPoint: (id: string) => void;
  onClearRoute: () => void;
  /** Открыть оверлей «карточка склада + МОЛы» поверх карты. */
  onShowWarehouseCard: (warehouseId: string) => void;
}

/** Плитка-карточка деталей выбранного объекта (точка / область / дорога / переезд). */
export function MapDetailPanel({
  selection,
  canEdit,
  onClose,
  onSelect,
  onFocus,
  onMovePointByMap,
  onDuplicatedPoint,
  routeSourcePointId,
  routeResult,
  routeVehicle,
  onSetRouteFromPoint,
  onClearRoute,
  onShowWarehouseCard,
}: Props) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle/70 px-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-strong">
          {selection.type === 'point'
            ? 'Точка склада'
            : selection.type === 'area'
              ? 'Область'
              : selection.type === 'crossing'
                ? 'Ж/д переезд'
                : selection.type === 'railway'
                  ? 'Ж/д путь'
                  : selection.type === 'roadSuggestion'
                    ? 'Черновик дороги'
                    : selection.type === 'roadAccess'
                      ? 'Особенности дороги'
                      : 'Дорога'}
          {!canEdit && <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-text-muted">просмотр</span>}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {selection.type === 'point' && (
          <PointEditor
            id={selection.id}
            canEdit={canEdit}
            onDeleted={onClose}
            onSelect={onSelect}
            onFocus={onFocus}
            onMoveByMap={onMovePointByMap}
            onDuplicated={onDuplicatedPoint}
            routeSourcePointId={routeSourcePointId}
            routeResult={routeResult}
            routeVehicle={routeVehicle}
            onSetRouteFromPoint={onSetRouteFromPoint}
            onClearRoute={onClearRoute}
            onShowWarehouseCard={onShowWarehouseCard}
          />
        )}
        {selection.type === 'area' && <AreaEditor id={selection.id} canEdit={canEdit} onDeleted={onClose} />}
        {selection.type === 'road' && <RoadEditor id={selection.id} canEdit={canEdit} onDeleted={onClose} />}
        {selection.type === 'crossing' && <CrossingEditor id={selection.id} canEdit={canEdit} onDeleted={onClose} />}
        {selection.type === 'railway' && <RailwayEditor id={selection.id} canEdit={canEdit} onDeleted={onClose} />}
        {selection.type === 'roadSuggestion' && <RoadSuggestionEditor id={selection.id} canEdit={canEdit} onDone={onClose} />}
        {selection.type === 'roadAccess' && <RoadAccessEditor id={selection.id} canEdit={canEdit} onDeleted={onClose} />}
      </div>
    </div>
  );
}

// ─── Точка ──────────────────────────────────────────────────────────────────

function PointEditor({
  id,
  canEdit,
  onDeleted,
  onSelect,
  onFocus,
  onMoveByMap,
  onDuplicated,
  routeSourcePointId,
  routeResult,
  routeVehicle,
  onSetRouteFromPoint,
  onClearRoute,
  onShowWarehouseCard,
}: {
  id: string;
  canEdit: boolean;
  onDeleted: () => void;
  onSelect: (selection: MapSelection) => void;
  onFocus: (latlng: LatLng) => void;
  onMoveByMap: (id: string) => void;
  onDuplicated: (id: string) => void;
  routeSourcePointId: string | null;
  routeResult: RouteResult | null;
  routeVehicle: VehicleType | null;
  onSetRouteFromPoint: (id: string) => void;
  onClearRoute: () => void;
  onShowWarehouseCard: (warehouseId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const point = useMapStore((s) => s.doc.points.find((p) => p.id === id));
  const allPoints = useMapStore((s) => s.doc.points);
  const updatePoint = useMapStore((s) => s.updatePoint);
  const removePoint = useMapStore((s) => s.removePoint);
  const duplicatePoint = useMapStore((s) => s.duplicatePoint);

  useEffect(() => {
    if (canEdit && point && !point.warehouseId) setEditing(true);
  }, [canEdit, point]);

  if (!point) return null;
  const equipment = point.equipment ?? EMPTY_POINT_EQUIPMENT;
  const allowedVehicles = point.allowedVehicles ?? [];
  const siblingPointCount = point.warehouseId
    ? allPoints.filter((p) => p.warehouseId === point.warehouseId).length
    : 0;

  return (
    <div className="space-y-2.5">
      <PointSummary point={point} />
      <RoutePointBlock
        point={point}
        routeSourcePointId={routeSourcePointId}
        routeResult={routeResult}
        routeVehicle={routeVehicle}
        onSetRouteFromPoint={onSetRouteFromPoint}
        onClearRoute={onClearRoute}
      />

      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="flex h-7 w-full items-center justify-between rounded border border-border-default px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <span>{editing ? 'Скрыть правку точки' : 'Редактировать точку'}</span>
          <span>{editing ? '−' : '+'}</span>
        </button>
      )}

      {canEdit && editing && (
        <WarehousePicker
          value={point.warehouseId}
          onPick={(wid) => updatePoint(id, { warehouseId: wid })}
        />
      )}

      {/* Данные склада (карточка «как в Цеха» + МОЛы) — оверлеем ПОВЕРХ карты,
          в панели точки остаются чисто данные точки (юзер 2026-07-05). */}
      {point.warehouseId && !editing && (
        <button
          type="button"
          onClick={() => onShowWarehouseCard(point.warehouseId!)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-accent-clay/40 bg-accent-clay-bg/50 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/15"
        >
          <Warehouse className="h-3.5 w-3.5" strokeWidth={1.75} /> Карточка склада и МОЛы
        </button>
      )}

      {point.warehouseId && siblingPointCount > 1 && (
        <FoldBlock title="Точки выгрузки" defaultOpen>
          <WarehousePointsBlock
            currentId={id}
            warehouseId={point.warehouseId}
            points={allPoints}
            onSelect={(pointId) => onSelect({ type: 'point', id: pointId })}
            onFocus={(p) => onFocus({ lat: p.lat, lng: p.lng })}
          />
        </FoldBlock>
      )}

      {canEdit && editing && (
        <>
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

          <Field label="Оснастка на месте (что грузит/разгружает)">
            <div className="grid grid-cols-2 gap-1">
              {EQUIPMENT_META.map((m) => (
                <ToggleChip
                  key={m.key}
                  label={m.label}
                  active={!!equipment[m.key]}
                  onClick={() => updatePoint(id, { equipment: { ...equipment, [m.key]: !equipment[m.key] } })}
                />
              ))}
            </div>
            {EQUIPMENT_META.every((m) => !equipment[m.key]) && (
              <p className="mt-1 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200">
                Оснастка не выбрана — отметьте, чем грузят (или «РУЧНОЕ»).
              </p>
            )}
          </Field>

          <Field label="Какая машина заедет в точку">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => updatePoint(id, { allowedVehicles: [] })}
                className={cn(
                  'flex h-7 w-full items-center justify-between rounded border px-2 text-[12px] outline-none transition-colors',
                  allowedVehicles.length === 0
                    ? 'border-emerald-400/45 bg-emerald-400/10 text-emerald-200'
                    : 'border-border-default text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                )}
              >
                <span>Все машины</span>
                <span>{allowedVehicles.length === 0 ? '✓' : ''}</span>
              </button>
              <div className="grid grid-cols-2 gap-1">
                {POINT_VEHICLE_TYPES.map((vehicle) => {
                  const active = allowedVehicles.includes(vehicle.id);
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? allowedVehicles.filter((id) => id !== vehicle.id)
                          : [...allowedVehicles, vehicle.id];
                        updatePoint(id, { allowedVehicles: next });
                      }}
                      className={cn(
                        'min-h-7 rounded-md border px-1.5 text-[11.5px] outline-none transition-colors',
                        active
                          ? 'border-[#22D3EE]/50 bg-[#22D3EE]/12 text-text-strong'
                          : 'border-border-default text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                      )}
                    >
                      {vehicle.short}
                    </button>
                  );
                })}
              </div>
            </div>
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
        </>
      )}

      {canEdit && editing ? (
        <CoordsEditBlock
          point={point}
          onCommit={(latlng) => {
            updatePoint(id, latlng);
            onFocus(latlng);
          }}
        />
      ) : (
        <CoordsBlock point={point} />
      )}

      {canEdit && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onMoveByMap(id)}
            className="flex h-7 items-center justify-center gap-1.5 rounded border border-emerald-400/35 text-[12px] font-medium text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
          >
            <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.75} /> Переместить
          </button>
          <button
            type="button"
            onClick={() => {
              const copyId = duplicatePoint(id);
              if (copyId) onDuplicated(copyId);
            }}
            className="flex h-7 items-center justify-center gap-1.5 rounded border border-sky-400/35 text-[12px] font-medium text-sky-300 outline-none transition-colors hover:bg-sky-400/10"
            title="Копия точки со всеми данными — потом поставьте её на нужное место"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} /> Дублировать
          </button>
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => { removePoint(id); onDeleted(); }}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-danger/30 text-[12px] font-medium text-danger outline-none transition-colors hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Удалить точку
        </button>
      )}
    </div>
  );
}

function PointSummary({ point }: { point: MapPoint }) {
  const warehouse = useWarehousesStore((s) => (point.warehouseId ? s.byId.get(point.warehouseId) : undefined));
  const equipment = point.equipment ?? EMPTY_POINT_EQUIPMENT;
  const equipmentList = EQUIPMENT_META
    .filter((m) => equipment[m.key])
    .map((m) => m.label.toLowerCase());
  const allowedVehicles = point.allowedVehicles ?? [];
  const title = point.warehouseId
    ? `Склад ${point.warehouseId}`
    : point.label.trim() || 'Точка без склада';
  const place = point.comment.trim() || point.label.trim() || 'место выгрузки не подписано';
  const vehicles = allowedVehicles.length === 0
    ? 'Все машины'
    : allowedVehicles.map(vehicleLabel).join(', ');

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated/35 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <MapPinned className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-text-strong">{title}</p>
          {warehouse?.shop_name && <p className="mt-0.5 truncate text-[12px] text-text-muted">{warehouse.shop_name}</p>}
          <p className="mt-1 text-[12.5px] text-text-secondary">{place}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11.5px]">
        <InfoPill label="Заезд" value={vehicles} />
        <InfoPill label="Оснастка" value={equipmentList.length > 0 ? equipmentList.join(', ') : 'не указано'} />
        {point.rearUnload && <InfoPill label="Нюанс" value="ТМЦ сзади" />}
        {point.weight > 1 && <InfoPill label="Вес" value={String(point.weight)} />}
      </div>
    </section>
  );
}

function RoutePointBlock({
  point,
  routeSourcePointId,
  routeResult,
  routeVehicle,
  onSetRouteFromPoint,
  onClearRoute,
}: {
  point: MapPoint;
  routeSourcePointId: string | null;
  routeResult: RouteResult | null;
  routeVehicle: VehicleType | null;
  onSetRouteFromPoint: (id: string) => void;
  onClearRoute: () => void;
}) {
  const isSource = routeSourcePointId === point.id;
  const hasSource = routeSourcePointId !== null;
  return (
    <section className="rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-3 py-2.5 text-[12px]">
      <div className="flex items-start gap-2">
        <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-strong">
            Маршрут по дорогам
            {routeVehicle && <span className="ml-1 font-normal text-text-muted">· {vehicleLabel(routeVehicle)}</span>}
          </p>
          {!hasSource && <p className="mt-0.5 text-text-muted">Выберите эту точку стартом, затем кликните точку назначения.</p>}
          {isSource && <p className="mt-0.5 text-sky-200">Эта точка выбрана стартом маршрута.</p>}
          {hasSource && !isSource && routeResult && (
            <>
              <p className="mt-0.5 font-mono tabular-nums text-sky-200">
                {formatDistanceMeters(routeResult.distanceMeters)} · узлов {routeResult.nodes}
              </p>
              {routeResult.passesBlocked && (
                <p className="mt-0.5 text-amber-200">⚠ Кратчайший путь идёт через запрещённый для этой машины участок.</p>
              )}
            </>
          )}
          {hasSource && !isSource && !routeResult && (
            <p className="mt-0.5 text-amber-200">Маршрут не найден: рядом нет сшитой дорожной сети.</p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSetRouteFromPoint(point.id)}
          className="h-7 flex-1 rounded border border-sky-400/35 px-2 text-[12px] font-medium text-sky-200 outline-none transition-colors hover:bg-sky-400/10"
        >
          {isSource ? 'Старт выбран' : 'Маршрут отсюда'}
        </button>
        {hasSource && (
          <button
            type="button"
            onClick={onClearRoute}
            className="h-7 rounded border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            Сбросить
          </button>
        )}
      </div>
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-bg-deep/35 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</p>
      <p className="truncate text-text-secondary" title={value}>{value}</p>
    </div>
  );
}

function FoldBlock({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border-subtle/80 bg-bg-deep/[0.18]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between px-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted outline-none transition-colors hover:text-text-secondary"
      >
        <span>{title}</span>
        <span className="text-[14px] leading-none">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </section>
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

/** '57,919494' → 57.919494; пусто/мусор → null (Number('') даёт 0 — отсекаем). */
function parseCoord(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Правка координат точки руками (юзер 2026-07-05). Ввод широты/долготы,
 * понимает вставку пары «57.919494, 60.028350» в поле широты. Коммит —
 * Enter или потеря фокуса; после коммита карта наводится на новое место.
 */
function CoordsEditBlock({ point, onCommit }: { point: MapPoint; onCommit: (latlng: LatLng) => void }) {
  const [lat, setLat] = useState(point.lat.toFixed(6));
  const [lng, setLng] = useState(point.lng.toFixed(6));

  // Точку переместили мышью/выбрали другую — обновляем поля.
  useEffect(() => {
    setLat(point.lat.toFixed(6));
    setLng(point.lng.toFixed(6));
  }, [point.id, point.lat, point.lng]);

  const latVal = parseCoord(lat);
  const lngVal = parseCoord(lng);
  const valid = latVal !== null && lngVal !== null
    && Math.abs(latVal) <= 90 && Math.abs(lngVal) <= 180;
  const changed = valid && (latVal !== point.lat || lngVal !== point.lng);

  const commit = () => {
    if (changed && latVal !== null && lngVal !== null) onCommit({ lat: latVal, lng: lngVal });
  };

  // Вставили «lat, lng» одной строкой — раскладываем по полям.
  const onLatChange = (raw: string) => {
    const pair = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(raw);
    if (pair) {
      setLat(pair[1]!.replace(',', '.'));
      setLng(pair[2]!.replace(',', '.'));
    } else {
      setLat(raw);
    }
  };

  const inputCls = cn(
    'w-full rounded border bg-bg-surface px-2 py-1 font-mono text-[12.5px] tabular-nums text-text-primary outline-none focus:border-accent-clay/40',
    valid ? 'border-border-default' : 'border-danger/45',
  );

  return (
    <Field label="Координаты места выгрузки (широта / долгота)">
      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={lat}
          onChange={(e) => onLatChange(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          placeholder="57.919494"
          className={inputCls}
        />
        <input
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          placeholder="60.028350"
          className={inputCls}
        />
      </div>
      {!valid && (
        <p className="mt-1 text-[10.5px] text-danger">
          Нужны числа: широта −90…90, долгота −180…180.
        </p>
      )}
      <p className="mt-1 text-[10.5px] text-text-muted">
        Можно вставить пару «57.919494, 60.028350» в поле широты. Enter — применить.
      </p>
    </Field>
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

function AreaEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const area = useMapStore((s) => s.doc.areas.find((a) => a.id === id));
  const updateArea = useMapStore((s) => s.updateArea);
  const removeArea = useMapStore((s) => s.removeArea);
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const shopNames = useMemo(
    () => Array.from(new Set(warehouses.map((w) => w.shop_name).filter(Boolean))).sort() as string[],
    [warehouses],
  );
  if (!area) return null;
  if (!canEdit) {
    return (
      <div className="space-y-2">
        <ReadonlyLine label="Название" value={area.name || '—'} />
        {area.shopName && <ReadonlyLine label="Цех" value={area.shopName} />}
      </div>
    );
  }
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

function RoadEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const road = useMapStore((s) => s.doc.roads.find((r) => r.id === id));
  const updateRoad = useMapStore((s) => s.updateRoad);
  const removeRoad = useMapStore((s) => s.removeRoad);
  if (!road) return null;
  if (!canEdit) {
    return (
      <div className="space-y-2">
        <ReadonlyLine label="Дорога" value={road.name.trim() || '—'} />
        <ReadonlyLine label="Точек" value={String(road.vertices.length)} />
      </div>
    );
  }
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

function RailwayEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const railway = useMapStore((s) => (s.doc.railways ?? []).find((r) => r.id === id));
  const updateRailway = useMapStore((s) => s.updateRailway);
  const removeRailway = useMapStore((s) => s.removeRailway);
  if (!railway) return null;
  if (!canEdit) {
    return (
      <div className="space-y-2">
        <ReadonlyLine label="Ж/д путь" value={railway.name.trim() || '—'} />
        <ReadonlyLine label="Точек" value={String(railway.vertices.length)} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Field label="Название пути">
        <input
          value={railway.name}
          onChange={(e) => updateRailway(id, { name: e.target.value })}
          placeholder="напр. Подъездной путь №3"
          className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
        />
      </Field>
      <p className="rounded-md border border-border-subtle bg-bg-elevated/50 px-2.5 py-2 text-[11.5px] text-text-muted">
        Точек: {railway.vertices.length}. Ж/д путь — визуальный слой, в авто-маршрутах не участвует.
      </p>
      <DeleteBtn label="Удалить ж/д путь" onClick={() => { removeRailway(id); onDeleted(); }} />
    </div>
  );
}

function RoadSuggestionEditor({ id, canEdit, onDone }: { id: string; canEdit: boolean; onDone: () => void }) {
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
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => { acceptRoadSuggestion(id); onDone(); }}
            className="flex h-7 w-full items-center justify-center rounded border border-emerald-400/35 text-[12px] font-medium text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
          >
            Да, добавить в дорожную сеть
          </button>
          <DeleteBtn label="Нет, убрать черновик" onClick={() => { rejectRoadSuggestion(id); onDone(); }} />
        </>
      )}
    </div>
  );
}

function formatSuggestionSource(suggestion: MapRoadSuggestion): string {
  return suggestion.source === 'osm' ? 'OSM / открытая карта' : 'ИИ-черновик';
}

// ─── Ж/д переезд ──────────────────────────────────────────────────────────────

function CrossingEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const crossing = useMapStore((s) => (s.doc.crossings ?? []).find((c) => c.id === id));
  const updateCrossing = useMapStore((s) => s.updateCrossing);
  const removeCrossing = useMapStore((s) => s.removeCrossing);
  if (!crossing) return null;

  return (
    <div className="space-y-3">
      <section className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2.5">
        <TrainTrack className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.75} />
        <div className="min-w-0 flex-1 text-[12px]">
          <p className="font-semibold text-text-strong">{crossing.name.trim() || 'Ж/д переезд'}</p>
          <p className="mt-0.5 text-text-muted">Пересечение с ж/д — учитываем как риск задержки в маршруте.</p>
          {crossing.note.trim() && <p className="mt-1 text-text-secondary">{crossing.note}</p>}
        </div>
      </section>

      {!canEdit ? (
        <ReadonlyLine label="Координаты" value={`${crossing.lat.toFixed(6)}, ${crossing.lng.toFixed(6)}`} />
      ) : (
        <>
          <Field label="Название / привязка">
            <input
              value={crossing.name}
              onChange={(e) => updateCrossing(id, { name: e.target.value })}
              placeholder="напр. Переезд у домны №6"
              className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
            />
          </Field>
          <Field label="Заметка (необязательно)">
            <textarea
              value={crossing.note}
              onChange={(e) => updateCrossing(id, { note: e.target.value })}
              rows={2}
              placeholder="напр. часто закрыт по утрам, объезд через КПП-2"
              className="w-full resize-none rounded border border-border-default bg-bg-surface px-2 py-1 text-[12.5px] text-text-primary outline-none focus:border-accent-clay/40"
            />
          </Field>
          <DeleteBtn label="Удалить переезд" onClick={() => { removeCrossing(id); onDeleted(); }} />
        </>
      )}
    </div>
  );
}

// ─── Особенности дороги (какие машины проедут) ───────────────────────────────

function RoadAccessEditor({ id, canEdit, onDeleted }: { id: string; canEdit: boolean; onDeleted: () => void }) {
  const access = useMapStore((s) => s.doc.roadAccess.find((a) => a.id === id));
  const updateRoadAccess = useMapStore((s) => s.updateRoadAccess);
  const removeRoadAccess = useMapStore((s) => s.removeRoadAccess);
  if (!access) return null;

  if (!canEdit) {
    const summary = access.kind === 'closed'
      ? 'Нет проезда'
      : access.vehicles.length === 0
        ? 'Без ограничений'
        : access.vehicles.map(vehicleLabel).join(', ');
    return (
      <div className="space-y-2">
        <ReadonlyLine label="Участок" value={summary} />
        {access.note.trim() && <ReadonlyLine label="Заметка" value={access.note} />}
      </div>
    );
  }

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

function ReadonlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated/40 px-2.5 py-1.5 text-[12px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <p className="mt-0.5 text-text-secondary">{value}</p>
    </div>
  );
}

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
