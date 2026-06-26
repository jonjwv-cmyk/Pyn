import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Check, CheckCheck, Crosshair, Filter, MapPin, MousePointer2, Pentagon, Route, Settings2, Trash2, Truck } from 'lucide-react';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/lib/map-store';
import { initMap } from '@/lib/map-repo';
import {
  AREA_COLORS,
  EMPTY_POINT_EQUIPMENT,
  NTMK_ZOOM,
  ROAD_PAINT_OPTIONS,
  roadPaintOption,
  type LatLng,
  type MapRoad,
  type MapTool,
  type RoadPaintMode,
} from './map-types';
import { MapCanvas, type MapSelection, type OptimizeOverlay } from './MapCanvas';
import { MapDetailPanel } from './MapDetailPanel';
import { optimize, totalCost, type DemandPoint } from './optimize';
import { computeFastestRoute, type RouteResult } from './route-network';
import { loadNtmkOsmRoadSuggestions } from './road-suggestions';

/**
 * Раздел «Карта» — живая спутниковая карта Google через VPS-релей + наши точки
 * складов, области цехов, нарисованные дороги и логистическая оптимизация.
 * Хранится локально (v1). Виден только admin/developer.
 */
export function MapScreen(): JSX.Element {
  const { t } = useTranslation();
  const doc = useMapStore((s) => s.doc);
  const loaded = useMapStore((s) => s.loaded);
  const addPoint = useMapStore((s) => s.addPoint);
  const movePoint = useMapStore((s) => s.updatePoint);
  const addArea = useMapStore((s) => s.addArea);
  const addRoad = useMapStore((s) => s.addRoad);
  const confirmRoadTrace = useMapStore((s) => s.confirmRoadTrace);
  const addRoadAccess = useMapStore((s) => s.addRoadAccess);
  const eraseRoadAccessTrace = useMapStore((s) => s.eraseRoadAccessTrace);
  const removeRoad = useMapStore((s) => s.removeRoad);
  const stitchRoads = useMapStore((s) => s.stitchRoads);
  const addRoadSuggestions = useMapStore((s) => s.addRoadSuggestions);
  const clearRoadSuggestions = useMapStore((s) => s.clearRoadSuggestions);
  const focusWarehouseId = useMapStore((s) => s.focusWarehouseId);
  const focusPointId = useMapStore((s) => s.focusPointId);
  const clearFocusWarehouse = useMapStore((s) => s.clearFocusWarehouse);
  const warehouses = useWarehousesStore((s) => s.byId);

  const [tool, setTool] = useState<MapTool>('select');
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [activeShops, setActiveShops] = useState<Set<string> | null>(null); // null = все
  const [ghost, setGhost] = useState<LatLng | null>(null);
  const [focus, setFocus] = useState<{ latlng: LatLng; nonce: number; zoom?: number } | null>(null);
  const [openedOnDefaultPoint, setOpenedOnDefaultPoint] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showRoadSuggestions, setShowRoadSuggestions] = useState(true);
  const [showRoadAccess, setShowRoadAccess] = useState(true);
  const [roadPaintMode, setRoadPaintMode] = useState<RoadPaintMode>('gazelle');
  const [moveByMapPointId, setMoveByMapPointId] = useState<string | null>(null);
  const [routeSourcePointId, setRouteSourcePointId] = useState<string | null>(null);

  useEffect(() => { void initMap(); }, []);

  // Цеха, присутствующие на карте (по точкам) — для фильтра.
  const shopsOnMap = useMemo(() => {
    const set = new Set<string>();
    for (const p of doc.points) {
      const wh = p.warehouseId ? warehouses.get(p.warehouseId) : undefined;
      if (wh?.shop_name) set.add(wh.shop_name);
    }
    return Array.from(set).sort();
  }, [doc.points, warehouses]);

  const shopOfPoint = useCallback((warehouseId: string | null): string | null => {
    if (!warehouseId) return null;
    return warehouses.get(warehouseId)?.shop_name ?? null;
  }, [warehouses]);

  // Видимые точки по фильтру цехов (null = все).
  const visiblePointIds = useMemo(() => {
    if (!activeShops) return null;
    const ids = new Set<string>();
    for (const p of doc.points) {
      const shop = shopOfPoint(p.warehouseId);
      if (shop && activeShops.has(shop)) ids.add(p.id);
    }
    return ids;
  }, [activeShops, doc.points, shopOfPoint]);

  // ── Фокус из карточки склада в «Цеха» ──
  useEffect(() => {
    if (focusPointId) {
      const pt = doc.points.find((p) => p.id === focusPointId);
      if (pt) {
        setTool('select');
        setSelection({ type: 'point', id: pt.id });
        setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: NTMK_ZOOM });
      }
      clearFocusWarehouse();
      return;
    }
    if (!focusWarehouseId) return;
    const pt = doc.points.find((p) => p.warehouseId === focusWarehouseId);
    if (pt) {
      setTool('select');
      setSelection({ type: 'point', id: pt.id });
      setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: NTMK_ZOOM });
    }
    clearFocusWarehouse();
  }, [focusPointId, focusWarehouseId, doc.points, clearFocusWarehouse]);

  useEffect(() => {
    if (!loaded || openedOnDefaultPoint || selection || doc.points.length === 0) return;
    const point0616 = doc.points.find((p) => isPoint0616(p.label) || isPoint0616(p.warehouseId) || isPoint0616(p.comment));
    if (!point0616) return;
    setOpenedOnDefaultPoint(true);
    setTool('select');
    setSelection({ type: 'point', id: point0616.id });
    setFocus({ latlng: { lat: point0616.lat, lng: point0616.lng }, nonce: Date.now(), zoom: NTMK_ZOOM });
  }, [doc.points, loaded, openedOnDefaultPoint, selection]);

  // ── Создание объектов ──
  const handleCreatePoint = useCallback((latlng: LatLng) => {
    const id = addPoint({
      ...latlng,
      warehouseId: null,
      label: '',
      comment: '',
      weight: 1,
      equipment: { ...EMPTY_POINT_EQUIPMENT },
      rearUnload: false,
      allowedVehicles: [],
    });
    setTool('select');
    setSelection({ type: 'point', id });
  }, [addPoint]);

  const handleCreateArea = useCallback((vertices: LatLng[]) => {
    const color = AREA_COLORS[Math.floor(Math.random() * AREA_COLORS.length)] ?? AREA_COLORS[0]!;
    const id = addArea({ name: '', color, vertices, shopName: null });
    setTool('select');
    setSelection({ type: 'area', id });
  }, [addArea]);

  const handleCreateRoad = useCallback((vertices: LatLng[]) => {
    addRoad({ name: '', vertices });
    setTool('select');
    setSelection(null);
  }, [addRoad]);

  const handleConfirmRoadTrace = useCallback((vertices: LatLng[]) => {
    confirmRoadTrace(vertices);
    setTool('select');
    setSelection(null);
  }, [confirmRoadTrace]);

  const handleCreateRoadAccess = useCallback((vertices: LatLng[]) => {
    if (roadPaintMode === 'erase') {
      eraseRoadAccessTrace(vertices);
      setTool('select');
      setSelection(null);
      return;
    }
    const id = addRoadAccess(vertices, roadPaintMode);
    setTool('select');
    setSelection({ type: 'roadAccess', id });
  }, [addRoadAccess, eraseRoadAccessTrace, roadPaintMode]);

  // Esc в режиме инструмента → вернуться в «Выбор» (курсор перестаёт «носить» инструмент).
  const handleCancelTool = useCallback(() => {
    setTool('select');
    setSelection(null);
  }, []);

  const handleLoadRoadSuggestions = useCallback(async () => {
    if (suggestionsLoading) return;
    setSuggestionsLoading(true);
    try {
      const suggestions = await loadNtmkOsmRoadSuggestions();
      addRoadSuggestions(suggestions);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:map] road suggestions load failed:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [addRoadSuggestions, suggestionsLoading]);

  // ── Оптимизация ──
  // Источник = выбранная точка (в режиме «Оптимум»). Спрос = все прочие точки с весом.
  const sourcePoint = tool === 'optimize' && selection?.type === 'point'
    ? doc.points.find((p) => p.id === selection.id) ?? null
    : null;

  const demand: DemandPoint[] = useMemo(() => {
    if (!sourcePoint) return [];
    return doc.points
      .filter((p) => p.id !== sourcePoint.id && (p.weight || 0) > 0)
      .filter((p) => !visiblePointIds || visiblePointIds.has(p.id))
      .map((p) => ({ lat: p.lat, lng: p.lng, weight: p.weight }));
  }, [sourcePoint, doc.points, visiblePointIds]);

  const optResult = useMemo(() => {
    if (!sourcePoint || demand.length === 0) return null;
    return optimize({ source: { lat: sourcePoint.lat, lng: sourcePoint.lng }, demand, roads: doc.roads });
  }, [sourcePoint, demand, doc.roads]);

  // Призрак стартует из источника при выборе склада.
  useEffect(() => {
    if (sourcePoint) setGhost({ lat: sourcePoint.lat, lng: sourcePoint.lng });
    else setGhost(null);
  }, [sourcePoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlay: OptimizeOverlay | null = sourcePoint
    ? { source: { lat: sourcePoint.lat, lng: sourcePoint.lng }, demand, result: optResult, ghost }
    : null;

  const selectedPoint = selection?.type === 'point'
    ? doc.points.find((p) => p.id === selection.id) ?? null
    : null;
  const routeSourcePoint = routeSourcePointId
    ? doc.points.find((p) => p.id === routeSourcePointId) ?? null
    : null;
  const routeResult: RouteResult | null = useMemo(() => {
    if (!routeSourcePoint || !selectedPoint || routeSourcePoint.id === selectedPoint.id) return null;
    return computeFastestRoute(doc.roads, routeSourcePoint, selectedPoint);
  }, [doc.roads, routeSourcePoint, selectedPoint]);

  useEffect(() => {
    if (routeSourcePointId && !doc.points.some((p) => p.id === routeSourcePointId)) {
      setRouteSourcePointId(null);
    }
  }, [doc.points, routeSourcePointId]);

  const showDetail = tool !== 'optimize' && selection !== null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Тулбар на подложке (h-9), как в других разделах */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_map', 'Карта')}
        </span>
        <div className="no-drag-region ml-auto flex items-center gap-1.5">
          <ToolMenu
            tool={tool}
            roads={doc.roads}
            roadSuggestionCount={doc.roadSuggestions.length}
            suggestionsLoading={suggestionsLoading}
            showRoadSuggestions={showRoadSuggestions}
            showRoadAccess={showRoadAccess}
            roadPaintMode={roadPaintMode}
            onToggleRoadSuggestions={() => setShowRoadSuggestions((v) => !v)}
            onToggleRoadAccess={() => setShowRoadAccess((v) => !v)}
            onRoadPaintModeChange={setRoadPaintMode}
            onStitchRoads={stitchRoads}
            onLoadRoadSuggestions={handleLoadRoadSuggestions}
            onClearRoadSuggestions={() => {
              clearRoadSuggestions();
              if (selection?.type === 'roadSuggestion') setSelection(null);
            }}
            onChange={(next) => {
              // Повторный клик по активному инструменту → выходим в «Выбор».
              setTool((cur) => (cur === next ? 'select' : next));
              if (next !== 'select') setSelection(null);
            }}
            onDeleteRoad={(id) => {
              removeRoad(id);
              if (selection?.type === 'road' && selection.id === id) setSelection(null);
            }}
          />
          <ShopFilter shops={shopsOnMap} active={activeShops} onChange={setActiveShops} />
        </div>
      </div>

      {/* Карточка контента: карта + правая панель */}
      <div className="flex min-h-0 min-w-0 flex-1 px-2 pb-2 pt-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
          <div className="relative min-h-0 min-w-0 flex-1">
            {loaded && (
              <MapCanvas
                doc={doc}
                tool={tool}
                visiblePointIds={visiblePointIds}
                selection={selection}
                showRoadSuggestions={showRoadSuggestions}
                showRoadAccess={showRoadAccess}
                routePath={routeResult?.path ?? null}
                roadPaintMode={roadPaintMode}
                movingPointId={moveByMapPointId}
                onSelect={setSelection}
                onCreatePoint={handleCreatePoint}
                onMovePoint={(id, latlng) => movePoint(id, latlng)}
                onStartMovePointByMap={(id) => {
                  const pt = doc.points.find((p) => p.id === id);
                  if (pt) setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
                  setTool('select');
                  setSelection({ type: 'point', id });
                  setMoveByMapPointId(id);
                }}
                onFinishMovePointByMap={(id, latlng) => {
                  movePoint(id, latlng);
                  setMoveByMapPointId(null);
                  setSelection({ type: 'point', id });
                }}
                onCancelMovePointByMap={() => setMoveByMapPointId(null)}
                onCreateArea={handleCreateArea}
                onCreateRoad={handleCreateRoad}
                onConfirmRoadTrace={handleConfirmRoadTrace}
                onCreateRoadAccess={handleCreateRoadAccess}
                onCancelTool={handleCancelTool}
                optimizeOverlay={overlay}
                onGhostMove={setGhost}
                focusLatLng={focus?.latlng ?? null}
                focusZoom={focus?.zoom}
                focusNonce={focus?.nonce ?? 0}
              />
            )}

            {/* Панель оптимизации поверх карты */}
            {tool === 'optimize' && (
              <OptimizePanel
                sourcePoint={sourcePoint}
                demandCount={demand.length}
                result={optResult}
                ghost={ghost}
                ghostCost={ghost ? totalCost(ghost, demand) : null}
                hasRoads={doc.roads.length > 0}
              />
            )}
          </div>

          {/* Правая панель деталей */}
          {showDetail && selection && (
            <MapDetailPanel
              selection={selection}
              onClose={() => setSelection(null)}
              onSelect={setSelection}
              onFocus={(latlng) => setFocus({ latlng, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) })}
              routeSourcePointId={routeSourcePointId}
              routeResult={selection.type === 'point' ? routeResult : null}
              onSetRouteFromPoint={setRouteSourcePointId}
              onClearRoute={() => setRouteSourcePointId(null)}
              onMovePointByMap={(id) => {
                const pt = doc.points.find((p) => p.id === id);
                if (pt) setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
                setSelection({ type: 'point', id });
                setMoveByMapPointId(id);
              }}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function isPoint0616(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
  return normalized === '0616' || normalized === '616' || normalized.includes('0616');
}

// ─── Меню карты ──────────────────────────────────────────────────────────────

const TOOL_OPTIONS: Array<{ id: MapTool; label: string; icon: typeof MapPin }> = [
  { id: 'select', label: 'Выбор', icon: MousePointer2 },
  { id: 'point', label: 'Точка склада', icon: MapPin },
  { id: 'area', label: 'Область', icon: Pentagon },
  { id: 'road', label: 'Дорога (своя)', icon: Route },
  { id: 'confirmRoad', label: 'Подтвердить (красную)', icon: CheckCheck },
  { id: 'vehicles', label: 'Особенности (машины)', icon: Truck },
  { id: 'optimize', label: 'Оптимум', icon: Crosshair },
];

function ToolMenu({
  tool,
  roads,
  roadSuggestionCount,
  suggestionsLoading,
  showRoadSuggestions,
  showRoadAccess,
  roadPaintMode,
  onChange,
  onToggleRoadSuggestions,
  onToggleRoadAccess,
  onRoadPaintModeChange,
  onDeleteRoad,
  onStitchRoads,
  onLoadRoadSuggestions,
  onClearRoadSuggestions,
}: {
  tool: MapTool;
  roads: MapRoad[];
  roadSuggestionCount: number;
  suggestionsLoading: boolean;
  showRoadSuggestions: boolean;
  showRoadAccess: boolean;
  roadPaintMode: RoadPaintMode;
  onChange: (tool: MapTool) => void;
  onToggleRoadSuggestions: () => void;
  onToggleRoadAccess: () => void;
  onRoadPaintModeChange: (mode: RoadPaintMode) => void;
  onDeleteRoad: (id: string) => void;
  onStitchRoads: () => void;
  onLoadRoadSuggestions: () => void;
  onClearRoadSuggestions: () => void;
}) {
  const active = TOOL_OPTIONS.find((item) => item.id === tool) ?? TOOL_OPTIONS[0]!;
  const paint = roadPaintOption(roadPaintMode);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-md border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
          title="Инструменты карты"
        >
          <Settings2 size={13} strokeWidth={1.75} />
          {active.label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1.5 shadow-2xl outline-none"
        >
          {TOOL_OPTIONS.map((item) => (
            <ToolMenuItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={item.id === tool}
              onClick={() => onChange(item.id)}
            />
          ))}
          <div className="my-1.5 h-px bg-border-subtle" />
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Закраска дороги
          </div>
          <div className="mb-1 grid grid-cols-2 gap-1 px-1">
            {ROAD_PAINT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onRoadPaintModeChange(option.id);
                  if (tool !== 'vehicles') onChange('vehicles');
                }}
                className={cn(
                  'flex min-h-7 items-center gap-1.5 rounded-md border px-1.5 text-left text-[11px] outline-none transition-colors',
                  roadPaintMode === option.id
                    ? 'border-white/30 bg-white/10 text-text-strong'
                    : 'border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                )}
                title={option.label}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
                <span className="truncate">{option.short}</span>
              </button>
            ))}
          </div>
          <p className="px-2 pb-1 text-[11px] text-text-muted">
            Активно: <span className="font-semibold text-text-secondary">{paint.label}</span>
          </p>
          <button
            type="button"
            onClick={onToggleRoadAccess}
            className="mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <span className={cn('h-2.5 w-2.5 rounded-full', showRoadAccess ? 'bg-[#22D3EE]' : 'bg-text-muted')} />
            <span className="flex-1 truncate">{showRoadAccess ? 'Скрыть закраску дорог' : 'Показать закраску дорог'}</span>
          </button>
          <div className="my-1.5 h-px bg-border-subtle" />
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            <span>Дорожная сеть</span>
            {roads.length > 0 && <span className="font-mono tracking-normal">{roads.length}</span>}
          </div>
          {roads.length > 0 && (
            <button
              type="button"
              onClick={onStitchRoads}
              className="mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
            >
              <Route size={13} strokeWidth={1.75} />
              <span className="flex-1 truncate">Выровнять и сшить сеть</span>
            </button>
          )}
          {roads.length === 0 ? (
            <p className="px-2 pb-1 pt-0.5 text-[11.5px] text-text-muted">Пока нет нарисованных дорог</p>
          ) : (
            <div className="space-y-1">
              {roads.map((road, index) => (
                <RoadMenuItem
                  key={road.id}
                  road={road}
                  index={index}
                  onDelete={() => onDeleteRoad(road.id)}
                />
              ))}
            </div>
          )}
          <div className="my-1.5 h-px bg-border-subtle" />
          <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            <span>Красный черновик</span>
            {roadSuggestionCount > 0 && <span className="font-mono tracking-normal">{roadSuggestionCount}</span>}
          </div>
          {roadSuggestionCount > 0 && (
            <button
              type="button"
              onClick={onToggleRoadSuggestions}
              className="mb-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', showRoadSuggestions ? 'bg-red-400' : 'bg-text-muted')} />
              <span className="flex-1 truncate">{showRoadSuggestions ? 'Скрыть красные линии' : 'Показать красные линии'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onLoadRoadSuggestions}
            disabled={suggestionsLoading}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-wait disabled:opacity-60"
          >
            <Route size={13} strokeWidth={1.75} />
            <span className="flex-1 truncate">{suggestionsLoading ? 'Загружаю дороги...' : 'Загрузить черновик дорог'}</span>
          </button>
          {roadSuggestionCount > 0 && (
            <button
              type="button"
              onClick={onClearRoadSuggestions}
              className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-red-300"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              <span className="flex-1 truncate">Очистить красные линии</span>
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ToolMenuItem({ icon: Icon, label, active, onClick }: {
  icon: typeof MapPin; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] outline-none transition-colors',
        active
          ? 'bg-accent-clay-bg text-accent-clay'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      <Icon size={13} strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
      {active && <Check size={13} strokeWidth={1.75} />}
    </button>
  );
}

function RoadMenuItem({ road, index, onDelete }: { road: MapRoad; index: number; onDelete: () => void }) {
  const name = road.name.trim() || `Дорога ${index + 1}`;
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover">
      <Route size={13} strokeWidth={1.75} className="shrink-0 text-[#F4D58D]" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{name}</div>
        <div className="text-[10.5px] text-text-muted">точек: {road.vertices.length}</div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:bg-bg-active hover:text-red-300"
        title="Удалить дорогу"
        aria-label="Удалить дорогу"
      >
        <Trash2 size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ShopFilter({ shops, active, onChange }: {
  shops: string[]; active: Set<string> | null; onChange: (s: Set<string> | null) => void;
}) {
  const allOn = active === null;
  const count = active ? active.size : shops.length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
            allOn ? 'border-border-subtle text-text-muted hover:text-text-secondary'
              : 'border-accent-clay/50 text-accent-clay',
          )}
          title="Фильтр точек по цеху"
        >
          <Filter size={13} strokeWidth={1.75} /> {allOn ? 'Все цеха' : `Цеха: ${count}`}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end" sideOffset={6}
          className="z-50 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1.5 shadow-2xl outline-none"
        >
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn('flex w-full items-center rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover', allOn && 'text-accent-clay')}
          >Показать все</button>
          <div className="my-1 h-px bg-border-subtle" />
          {shops.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-muted">Нет точек с цехами</p>}
          {shops.map((s) => {
            const on = allOn || (active?.has(s) ?? false);
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const base = active ? new Set(active) : new Set(shops);
                  if (base.has(s)) base.delete(s); else base.add(s);
                  onChange(base.size === shops.length ? null : base);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover"
              >
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border', on ? 'border-accent-clay bg-accent-clay text-white' : 'border-border-default')}>
                  {on && '✓'}
                </span>
                <span className="truncate text-text-secondary">{s}</span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Панель оптимизации ───────────────────────────────────────────────────────

function OptimizePanel({ sourcePoint, demandCount, result, ghost, ghostCost, hasRoads }: {
  sourcePoint: { id: string; label: string; warehouseId: string | null } | null;
  demandCount: number;
  result: ReturnType<typeof optimize>;
  ghost: LatLng | null;
  ghostCost: number | null;
  hasRoads: boolean;
}) {
  return (
    <div className="absolute left-3 top-3 z-[450] w-[280px] rounded-lg border border-border-default bg-bg-deep/92 p-3 text-[12px] shadow-2xl backdrop-blur">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-text-strong">
        <Crosshair size={14} strokeWidth={1.75} className="text-emerald-400" /> Оптимум склада отгрузки
      </p>
      {!sourcePoint ? (
        <p className="text-text-muted">Кликните по точке склада отгрузки — посчитаю оптимальное место по объёмам отгрузок.</p>
      ) : demandCount === 0 ? (
        <p className="text-text-muted">У точек спроса не задан объём (вес). Откройте точки и проставьте объём отгрузок.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-text-secondary">
            Склад <b className="text-text-strong">{sourcePoint.label || sourcePoint.warehouseId || '—'}</b> · точек спроса: {demandCount}
          </p>
          {result && (
            <>
              <Stat label="Экономия в оптимуме" value={`${result.improvementPct >= 0 ? '−' : '+'}${Math.abs(result.improvementPct).toFixed(1)}% пробега`} tone="green" />
              {result.snapped
                ? <Stat label="С привязкой к дороге" value={`${(result.snappedImprovementPct ?? 0) >= 0 ? '−' : '+'}${Math.abs(result.snappedImprovementPct ?? 0).toFixed(1)}%`} tone="blue" />
                : <p className="text-[11px] text-text-muted">{hasRoads ? 'Дорог рядом с оптимумом нет' : 'Нарисуйте дороги — привяжу оптимум к удобному месту'}</p>}
              {ghost && ghostCost != null && result.currentCost > 0 && (
                <Stat
                  label="Если поставить сюда (жёлтый)"
                  value={`${((result.currentCost - ghostCost) / result.currentCost * 100) >= 0 ? '−' : '+'}${Math.abs((result.currentCost - ghostCost) / result.currentCost * 100).toFixed(1)}% · ${ghostCost > 0 ? (result.optimalCost / ghostCost * 100).toFixed(0) : 0}% от идеала`}
                  tone="amber"
                />
              )}
            </>
          )}
          <p className="pt-1 text-[10.5px] leading-relaxed text-text-muted">
            <span className="text-emerald-400">✛</span> математический оптимум ·
            <span className="text-blue-400"> ✛</span> у дороги ·
            <span className="text-amber-400"> ●</span> двигайте жёлтый — что-если
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'amber' }) {
  const c = tone === 'green' ? 'text-emerald-400' : tone === 'blue' ? 'text-blue-400' : 'text-amber-400';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className={cn('font-mono font-semibold tabular-nums', c)}>{value}</span>
    </div>
  );
}
