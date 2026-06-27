import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Check, CheckCheck, CloudRain, Crosshair, Eraser, Filter, MapPin, MousePointer2, Pentagon, Route, Settings2, TrainTrack, Trash2, Truck } from 'lucide-react';
import { getWarehouseState } from '@pyn/core';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/lib/map-store';
import { initMap } from '@/lib/map-repo';
import {
  AREA_COLORS,
  EMPTY_POINT_EQUIPMENT,
  NTMK_CENTER,
  NTMK_ZOOM,
  POINT_CATEGORY_META,
  ROAD_PAINT_OPTIONS,
  VEHICLE_TYPES,
  categoryFromWarehouseState,
  roadPaintOption,
  vehicleColor,
  type LatLng,
  type MapTool,
  type PointCategory,
  type RoadPaintMode,
  type VehicleType,
} from './map-types';
import { MapCanvas, type MapSelection, type OptimizeOverlay } from './MapCanvas';
import { MapDetailPanel } from './MapDetailPanel';
import { optimize, totalCost, type DemandPoint } from './optimize';
import { computeFastestRoute, type RouteResult } from './route-network';
import { loadNtmkOsmRoadSuggestions } from './road-suggestions';

interface WeatherHour {
  time: string;
  tempC: number | null;
  precipMm: number | null;
  rainMm: number | null;
  snowCm: number | null;
  precipProb: number | null;
  code: number | null;
  windMs: number | null;
  windDir: number | null;
  gustMs: number | null;
}

interface WeatherSummary {
  tempC: number | null;
  windMs: number | null;
  precipMm: number | null;
  code?: number | null;
  pressureHpa?: number | null;
  isPrecip: boolean;
  hourly: WeatherHour[];
}

interface WeatherFieldPoint {
  lat: number;
  lng: number;
  windMs: number | null;
  windDir: number | null;
  gustMs: number | null;
  precipMm: number | null;
  code: number | null;
  pressureHpa: number | null;
}

interface MapScreenProps {
  /** developer — может рисовать/править карту; admin — только смотрит и пользуется. */
  canEdit: boolean;
}

/**
 * Раздел «Карта» — живая спутниковая карта Google через VPS-релей + наши точки
 * складов, области цехов, нарисованные дороги и логистическая оптимизация.
 * Хранится локально (v1). Виден только admin/developer.
 */
export function MapScreen({ canEdit }: MapScreenProps): JSX.Element {
  const { t } = useTranslation();
  const doc = useMapStore((s) => s.doc);
  const loaded = useMapStore((s) => s.loaded);
  const addPoint = useMapStore((s) => s.addPoint);
  const duplicatePoint = useMapStore((s) => s.duplicatePoint);
  const movePoint = useMapStore((s) => s.updatePoint);
  const addArea = useMapStore((s) => s.addArea);
  const addRoad = useMapStore((s) => s.addRoad);
  const eraseRoadTrace = useMapStore((s) => s.eraseRoadTrace);
  const confirmRoadTrace = useMapStore((s) => s.confirmRoadTrace);
  const addRoadAccess = useMapStore((s) => s.addRoadAccess);
  const eraseRoadAccessTrace = useMapStore((s) => s.eraseRoadAccessTrace);
  const addCrossing = useMapStore((s) => s.addCrossing);
  const addRailway = useMapStore((s) => s.addRailway);
  const addRoadSuggestions = useMapStore((s) => s.addRoadSuggestions);
  const clearRoadSuggestions = useMapStore((s) => s.clearRoadSuggestions);
  const focusWarehouseId = useMapStore((s) => s.focusWarehouseId);
  const focusPointId = useMapStore((s) => s.focusPointId);
  const clearFocusWarehouse = useMapStore((s) => s.clearFocusWarehouse);
  const warehouses = useWarehousesStore((s) => s.byId);

  const [tool, setTool] = useState<MapTool>('select');
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [activeWarehouses, setActiveWarehouses] = useState<Set<string> | null>(null); // null = все
  const [activeCategories, setActiveCategories] = useState<Set<PointCategory> | null>(null); // null = все
  const [activeVehicle, setActiveVehicle] = useState<VehicleType | null>(null);
  const [showWeather, setShowWeather] = useState(false);
  const [centerElevation, setCenterElevation] = useState<number | null>(null);
  const [weatherNonce, setWeatherNonce] = useState(0);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [weatherField, setWeatherField] = useState<WeatherFieldPoint[]>([]);
  const [pointScreen, setPointScreen] = useState<{ x: number; y: number } | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [ghost, setGhost] = useState<LatLng | null>(null);
  const [focus, setFocus] = useState<{ latlng: LatLng; nonce: number; zoom?: number } | null>(null);
  const [openedOnDefaultPoint, setOpenedOnDefaultPoint] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showRoadSuggestions, setShowRoadSuggestions] = useState(true);
  const [showRoadAccess, setShowRoadAccess] = useState(true);
  const [roadPaintMode, setRoadPaintMode] = useState<RoadPaintMode>('gazelle');
  const [moveByMapPointId, setMoveByMapPointId] = useState<string | null>(null);
  const [routeSourcePointId, setRouteSourcePointId] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<{ south: number; west: number; north: number; east: number } | null>(null);

  useEffect(() => { void initMap(); }, []);

  // Не-разработчик не может держать инструмент рисования: всегда «Выбор».
  useEffect(() => {
    if (!canEdit && tool !== 'select' && tool !== 'optimize') setTool('select');
  }, [canEdit, tool]);

  // Погода: пока слой включён — тянем свежий кадр радара + сводку (раз в 5 мин).
  useEffect(() => {
    if (!showWeather) return;
    let alive = true;
    const pull = async () => {
      try {
        const res = await window.pyn?.mapWeather?.(NTMK_CENTER.lat, NTMK_CENTER.lng);
        if (!alive || !res) return;
        if (res.weather) setWeather(res.weather);
        if (res.ok) setWeatherNonce((n) => n + 1); // свежий кадр → пересоздать слой
      } catch { /* погода не критична */ }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [showWeather]);

  // Ветер по экрану: редкая сетка Open-Meteo вместо тяжёлой погодной картинки.
  useEffect(() => {
    if (!showWeather || !viewBounds) {
      setWeatherField([]);
      return;
    }
    let alive = true;
    const pull = async () => {
      try {
        const res = await window.pyn?.mapWeatherField?.(viewBounds);
        if (alive && res?.ok) setWeatherField(res.points);
      } catch { /* погодное поле не критично */ }
    };
    const timer = setTimeout(() => { void pull(); }, 450);
    const interval = setInterval(() => { void pull(); }, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [showWeather, viewBounds]);

  // Высота центра карты — всегда в статус-баре (Open-Meteo через мост, дебаунс).
  useEffect(() => {
    if (!viewBounds) return;
    const lat = (viewBounds.south + viewBounds.north) / 2;
    const lng = (viewBounds.west + viewBounds.east) / 2;
    let alive = true;
    const timer = setTimeout(() => {
      window.pyn?.mapElevation?.(lat, lng)
        .then((res) => { if (alive && res?.ok) setCenterElevation(res.elevation); })
        .catch(() => { /* высота не критична */ });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [viewBounds]);

  // Категория точки (отгрузка/выгрузка/вне графика) из статуса склада.
  const categoryOfPoint = useCallback((warehouseId: string | null): PointCategory => {
    const wh = warehouseId ? warehouses.get(warehouseId) : undefined;
    return categoryFromWarehouseState(wh ? getWarehouseState(wh) : undefined);
  }, [warehouses]);

  // Склады, присутствующие на карте (для фильтра по складу).
  const warehousesOnMap = useMemo(() => {
    const set = new Set<string>();
    for (const p of doc.points) if (p.warehouseId) set.add(p.warehouseId);
    return Array.from(set).sort();
  }, [doc.points]);

  // Видимые точки: пересечение фильтров «категория» и «склад» (null = все).
  const visiblePointIds = useMemo(() => {
    if (!activeCategories && !activeWarehouses) return null;
    const ids = new Set<string>();
    for (const p of doc.points) {
      if (activeWarehouses && !(p.warehouseId && activeWarehouses.has(p.warehouseId))) continue;
      if (activeCategories && !activeCategories.has(categoryOfPoint(p.warehouseId))) continue;
      ids.add(p.id);
    }
    return ids;
  }, [activeCategories, activeWarehouses, doc.points, categoryOfPoint]);

  const filterActive = activeCategories !== null || activeWarehouses !== null;

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

  const handleEraseRoadTrace = useCallback((vertices: LatLng[]) => {
    eraseRoadTrace(vertices);
    setTool('select');
    setSelection(null);
  }, [eraseRoadTrace]);

  const handleCreateCrossing = useCallback((latlng: LatLng) => {
    const id = addCrossing(latlng);
    setTool('select');
    setSelection({ type: 'crossing', id });
  }, [addCrossing]);

  const handleCreateRailway = useCallback((vertices: LatLng[]) => {
    const id = addRailway(vertices);
    setTool('select');
    setSelection({ type: 'railway', id });
  }, [addRailway]);

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
      // Грузим дороги по ВИДИМОЙ области экрана (Кушва, Н.Тагил и т.д.), не только НТМК.
      const suggestions = await loadNtmkOsmRoadSuggestions(viewBounds ?? undefined);
      addRoadSuggestions(suggestions);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:map] road suggestions load failed:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [addRoadSuggestions, suggestionsLoading, viewBounds]);

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
    return computeFastestRoute(doc.roads, routeSourcePoint, selectedPoint, {
      roadAccess: doc.roadAccess,
      vehicle: activeVehicle,
    });
  }, [doc.roads, doc.roadAccess, routeSourcePoint, selectedPoint, activeVehicle]);

  useEffect(() => {
    if (routeSourcePointId && !doc.points.some((p) => p.id === routeSourcePointId)) {
      setRouteSourcePointId(null);
    }
  }, [doc.points, routeSourcePointId]);

  // Точку сначала показываем поповером у пина; не-точки — сразу полной карточкой.
  useEffect(() => {
    if (!selection) { setDetailExpanded(false); return; }
    setDetailExpanded(selection.type !== 'point');
  }, [selection?.type, selection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedWarehouse = selectedPoint?.warehouseId ? warehouses.get(selectedPoint.warehouseId) : undefined;
  const showFullCard = tool !== 'optimize' && selection !== null && (selection.type !== 'point' || detailExpanded);
  const showPinPopover = tool !== 'optimize' && selection?.type === 'point' && !detailExpanded && pointScreen !== null && selectedPoint !== null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Тулбар на подложке (h-9), как в других разделах */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_map', 'Карта')}
        </span>
        <div className="no-drag-region ml-auto flex items-center gap-1.5">
          <LayerToggle icon={CheckCheck} label="Особ." on={showRoadAccess} onClick={() => setShowRoadAccess((v) => !v)} title="Особенности дорог (закраска по машинам)" />
          <LayerToggle icon={CloudRain} label="Погода" on={showWeather} onClick={() => setShowWeather((v) => !v)} title="Радар осадков — где идёт дождь/снег" />
          <VehicleFilter active={activeVehicle} onChange={setActiveVehicle} />
          <PointsFilter
            warehouses={warehousesOnMap}
            activeWarehouses={activeWarehouses}
            activeCategories={activeCategories}
            filterActive={filterActive}
            onWarehousesChange={setActiveWarehouses}
            onCategoriesChange={setActiveCategories}
          />
          {canEdit && (
            <ToolMenu
              tool={tool}
              roadSuggestionCount={doc.roadSuggestions.length}
              suggestionsLoading={suggestionsLoading}
              showRoadSuggestions={showRoadSuggestions}
              showRoadAccess={showRoadAccess}
              roadPaintMode={roadPaintMode}
              onToggleRoadSuggestions={() => setShowRoadSuggestions((v) => !v)}
              onToggleRoadAccess={() => setShowRoadAccess((v) => !v)}
              onRoadPaintModeChange={setRoadPaintMode}
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
            />
          )}
        </div>
      </div>

      {/* Карточка контента: карта во всю ширину, карточки — плитками поверх неё */}
      <div className="flex min-h-0 min-w-0 flex-1 px-2 pb-2 pt-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
          {loaded && (
            <MapCanvas
              doc={doc}
              tool={tool}
              canEdit={canEdit}
              visiblePointIds={visiblePointIds}
              selection={selection}
              showRoadSuggestions={showRoadSuggestions}
              showRoadAccess={showRoadAccess}
              routePath={routeResult?.path ?? null}
              routeBlocked={routeResult?.passesBlocked ?? false}
              showWeather={showWeather}
              weatherNonce={weatherNonce}
              weatherField={weatherField}
              centerElevation={centerElevation}
              roadPaintMode={roadPaintMode}
              movingPointId={moveByMapPointId}
              activeVehicle={activeVehicle}
              onSelect={setSelection}
              onSelectedPointScreen={setPointScreen}
              onDuplicatePoint={(id) => {
                const copyId = duplicatePoint(id);
                if (!copyId) return;
                const pt = useMapStore.getState().doc.points.find((p) => p.id === copyId);
                if (pt) setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
                setSelection({ type: 'point', id: copyId });
                setMoveByMapPointId(copyId);
              }}
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
              onEraseRoadTrace={handleEraseRoadTrace}
              onConfirmRoadTrace={handleConfirmRoadTrace}
              onCreateRoadAccess={handleCreateRoadAccess}
              onCreateCrossing={handleCreateCrossing}
              onCreateRailway={handleCreateRailway}
              onCancelTool={handleCancelTool}
              optimizeOverlay={overlay}
              onGhostMove={setGhost}
              onBoundsChange={setViewBounds}
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

          {/* Чип сводки погоды (когда слой включён) */}
          {showWeather && <WeatherChip weather={weather} />}

          {/* Поповер-карточка у пина (краткая) + кнопка «Подробно» */}
          {showPinPopover && selectedPoint && pointScreen && (
            <PinPopover
              x={pointScreen.x}
              y={pointScreen.y}
              title={selectedPoint.warehouseId ? `Склад ${selectedPoint.warehouseId}` : (selectedPoint.label.trim() || 'Точка')}
              subtitle={selectedWarehouse?.shop_name ?? selectedPoint.comment.trim() ?? ''}
              category={categoryOfPoint(selectedPoint.warehouseId)}
              onDetails={() => setDetailExpanded(true)}
              onRouteFrom={() => setRouteSourcePointId(selectedPoint.id)}
              onClose={() => setSelection(null)}
            />
          )}

          {/* Полная карточка-плитка деталей — поверх карты в правом верхнем углу */}
          {showFullCard && selection && (
            <div className="absolute right-3 top-3 z-[460] flex max-h-[calc(100%-1.5rem)] w-[358px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border-default bg-bg-deep/92 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
              <MapDetailPanel
                selection={selection}
                canEdit={canEdit}
                onClose={() => setSelection(null)}
                onSelect={setSelection}
                onFocus={(latlng) => setFocus({ latlng, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) })}
                routeSourcePointId={routeSourcePointId}
                routeResult={selection.type === 'point' ? routeResult : null}
                routeVehicle={activeVehicle}
                onSetRouteFromPoint={setRouteSourcePointId}
                onClearRoute={() => setRouteSourcePointId(null)}
                onMovePointByMap={(id) => {
                  const pt = doc.points.find((p) => p.id === id);
                  if (pt) setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
                  setSelection({ type: 'point', id });
                  setMoveByMapPointId(id);
                }}
                onDuplicatedPoint={(id) => {
                  const pt = useMapStore.getState().doc.points.find((p) => p.id === id);
                  if (pt) setFocus({ latlng: { lat: pt.lat, lng: pt.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
                  setSelection({ type: 'point', id });
                  setMoveByMapPointId(id);
                }}
              />
            </div>
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
  { id: 'point', label: 'Пин', icon: MapPin },
  { id: 'crossing', label: 'Ж/Д', icon: TrainTrack },
  { id: 'area', label: 'Область', icon: Pentagon },
  { id: 'road', label: 'Дорога', icon: Route },
  { id: 'eraseRoad', label: 'Ластик', icon: Eraser },
  { id: 'confirmRoad', label: 'Подтвердить дорогу', icon: CheckCheck },
  { id: 'optimize', label: 'Оптимум', icon: Crosshair },
];

function ToolMenu({
  tool,
  roadSuggestionCount,
  suggestionsLoading,
  showRoadSuggestions,
  showRoadAccess,
  roadPaintMode,
  onChange,
  onToggleRoadSuggestions,
  onToggleRoadAccess,
  onRoadPaintModeChange,
  onLoadRoadSuggestions,
  onClearRoadSuggestions,
}: {
  tool: MapTool;
  roadSuggestionCount: number;
  suggestionsLoading: boolean;
  showRoadSuggestions: boolean;
  showRoadAccess: boolean;
  roadPaintMode: RoadPaintMode;
  onChange: (tool: MapTool) => void;
  onToggleRoadSuggestions: () => void;
  onToggleRoadAccess: () => void;
  onRoadPaintModeChange: (mode: RoadPaintMode) => void;
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
                <span className="truncate">{option.label}</span>
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
          <button
            type="button"
            onClick={onLoadRoadSuggestions}
            disabled={suggestionsLoading}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-wait disabled:opacity-60"
          >
            <Route size={13} strokeWidth={1.75} />
            <span className="flex-1 truncate">{suggestionsLoading ? 'Загружаю дороги...' : 'Возможны дороги'}</span>
          </button>
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

/** Маленький тумблер слоя в шапке (особенности/погода/рельеф). */
function LayerToggle({ icon: Icon, label, on, onClick, title }: {
  icon: typeof MapPin; label: string; on: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
        on ? 'border-accent-clay/55 bg-accent-clay-bg text-accent-clay' : 'border-border-subtle text-text-muted hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      <Icon size={13} strokeWidth={1.75} /> {label}
    </button>
  );
}

/** Фильтр точек: категория (отгрузка/выгрузка/вне графика) + конкретные склады. */
function PointsFilter({ warehouses, activeWarehouses, activeCategories, filterActive, onWarehousesChange, onCategoriesChange }: {
  warehouses: string[];
  activeWarehouses: Set<string> | null;
  activeCategories: Set<PointCategory> | null;
  filterActive: boolean;
  onWarehousesChange: (s: Set<string> | null) => void;
  onCategoriesChange: (s: Set<PointCategory> | null) => void;
}) {
  const [q, setQ] = useState('');
  // Длинный список складов не вываливаем — показываем совпадения ТОЛЬКО при вводе.
  const matches = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc) return [];
    return warehouses.filter((w) => w.toLowerCase().includes(lc)).slice(0, 8);
  }, [q, warehouses]);
  const selected = activeWarehouses ? Array.from(activeWarehouses) : [];
  const toggleWh = (w: string) => {
    const base = activeWarehouses ? new Set(activeWarehouses) : new Set<string>();
    if (base.has(w)) base.delete(w); else base.add(w);
    onWarehousesChange(base.size === 0 ? null : base);
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
            filterActive ? 'border-accent-clay/50 text-accent-clay' : 'border-border-subtle text-text-muted hover:text-text-secondary',
          )}
          title="Фильтр точек: категория и склады"
        >
          <Filter size={13} strokeWidth={1.75} /> {filterActive ? 'Фильтр ✓' : 'Все точки'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end" sideOffset={6}
          className="z-50 max-h-[64vh] w-64 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1.5 shadow-2xl outline-none"
        >
          <button
            type="button"
            onClick={() => { onCategoriesChange(null); onWarehousesChange(null); }}
            className={cn('mb-1 flex w-full items-center rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover', !filterActive && 'text-accent-clay')}
          >Показать все</button>
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Категория</div>
          {POINT_CATEGORY_META.map((c) => {
            const on = !activeCategories || activeCategories.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const base = activeCategories ? new Set(activeCategories) : new Set(POINT_CATEGORY_META.map((m) => m.id));
                  if (base.has(c.id)) base.delete(c.id); else base.add(c.id);
                  onCategoriesChange(base.size === POINT_CATEGORY_META.length ? null : base);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover"
              >
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border', on ? 'border-accent-clay bg-accent-clay text-white' : 'border-border-default')}>{on && '✓'}</span>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate text-text-secondary">{c.label}</span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-border-subtle" />
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Склад (по номеру)</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти склад по номеру…"
            className="mb-1 w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12px] text-text-primary outline-none focus:border-accent-clay/40"
          />
          {q.trim() !== '' && matches.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-muted">Ничего не найдено</p>}
          {matches.map((w) => {
            const on = activeWarehouses?.has(w) ?? false;
            return (
              <button
                key={w}
                type="button"
                onClick={() => toggleWh(w)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover"
              >
                <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border', on ? 'border-accent-clay bg-accent-clay text-white' : 'border-border-default')}>{on && '✓'}</span>
                <span className="truncate font-mono tabular-nums text-text-secondary">{w}</span>
              </button>
            );
          })}
          {selected.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 px-2 pb-0.5">
              {selected.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWh(w)}
                  title="Убрать из фильтра"
                  className="flex items-center gap-1 rounded border border-accent-clay/45 bg-accent-clay-bg px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent-clay outline-none hover:bg-accent-clay/15"
                >{w} ×</button>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function VehicleFilter({ active, onChange }: { active: VehicleType | null; onChange: (v: VehicleType | null) => void }) {
  const current = active ? VEHICLE_TYPES.find((v) => v.id === active) : null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
            active ? 'border-[#22D3EE]/55 text-[#67E8F9]' : 'border-border-subtle text-text-muted hover:text-text-secondary',
          )}
          title="Показать, куда заедет выбранная машина (и строить по ней маршрут)"
        >
          {active
            ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: vehicleColor(active) }} />
            : <Truck size={13} strokeWidth={1.75} />}
          {current ? current.short : 'Машина'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end" sideOffset={6}
          className="z-50 w-56 rounded-lg border border-border-default bg-bg-elevated p-1.5 shadow-2xl outline-none"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Проходимость машины</p>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn('flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[12px] outline-none hover:bg-bg-hover', !active && 'text-[#67E8F9]')}
          >
            <Truck size={13} strokeWidth={1.75} />
            <span className="flex-1">Все машины</span>
            {!active && <Check size={13} strokeWidth={1.75} />}
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          {VEHICLE_TYPES.map((v) => {
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onChange(on ? null : v.id)}
                className={cn('flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[12px] outline-none hover:bg-bg-hover', on && 'text-text-strong')}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: vehicleColor(v.id) }} />
                <span className="flex-1 truncate">{v.label}</span>
                {on && <Check size={13} strokeWidth={1.75} />}
              </button>
            );
          })}
          <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] leading-relaxed text-text-muted">
            Точки, куда машина не заедет, гаснут. Маршрут обходит запрещённые участки.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Чип сводки погоды по площадке: клик открывает ближайшие часы. */
function WeatherChip({ weather }: { weather: WeatherSummary | null }) {
  const rows = weather?.hourly.slice(0, 12) ?? [];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="absolute left-3 top-3 z-[450] flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-[#080b11]/86 px-2.5 text-[11.5px] text-white/85 shadow-lg outline-none backdrop-blur transition-colors hover:border-accent-clay/35 hover:bg-[#101520]/92"
          title="Погода по часам"
        >
          <CloudRain size={14} strokeWidth={1.75} className={weather?.isPrecip ? 'text-sky-300' : 'text-white/55'} />
          {weather ? (
            <span className="flex items-center gap-2 font-mono tabular-nums">
              {weather.tempC != null && <span>{weather.tempC > 0 ? '+' : ''}{Math.round(weather.tempC)}°</span>}
              {weather.windMs != null && <span className="text-white/65">{Math.round(weather.windMs)} м/с</span>}
              <span className={weather.isPrecip ? 'text-sky-300' : 'text-white/55'}>
                {weather.isPrecip ? `осадки ${(weather.precipMm ?? 0).toFixed(1)} мм` : 'без осадков'}
              </span>
            </span>
          ) : (
            <span className="text-white/55">погода…</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-[700] w-[360px] overflow-hidden rounded-xl border border-border-default bg-bg-deep/95 shadow-[0_12px_42px_rgba(0,0,0,0.55)] outline-none backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-border-subtle/70 px-3 py-2">
            <div>
              <p className="text-[12.5px] font-semibold text-text-strong">Погода по часам</p>
              <p className="text-[11px] text-text-muted">{weatherText(weather?.code ?? null, weather?.precipMm ?? null, null)}</p>
            </div>
            <div className="font-mono text-[12px] tabular-nums text-text-secondary">
              {weather?.pressureHpa != null ? `${Math.round(weather.pressureHpa)} гПа` : weather?.tempC != null ? `${weather.tempC > 0 ? '+' : ''}${Math.round(weather.tempC)}°` : '—'}
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {rows.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-text-muted">Почасовой прогноз загружается…</p>
            ) : rows.map((row) => (
              <div key={row.time} className="grid grid-cols-[44px_1fr_58px_58px] items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-bg-hover/70">
                <span className="font-mono tabular-nums text-text-strong">{formatWeatherHour(row.time)}</span>
                <div className="min-w-0">
                  <p className="truncate text-text-secondary">{weatherText(row.code, row.precipMm, row.snowCm)}</p>
                  <p className="font-mono text-[10.5px] tabular-nums text-text-muted">
                    {formatPrecip(row)}
                    {row.precipProb != null && <span className="ml-1">· {Math.round(row.precipProb)}%</span>}
                  </p>
                </div>
                <span className="text-right font-mono tabular-nums text-text-secondary">
                  {row.tempC != null ? `${row.tempC > 0 ? '+' : ''}${Math.round(row.tempC)}°` : '—'}
                </span>
                <span className="text-right font-mono tabular-nums text-text-muted" title={row.windDir != null ? `Направление ${Math.round(row.windDir)}°` : undefined}>
                  {row.windMs != null ? `${Math.round(row.windMs)} м/с` : '—'}
                </span>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatWeatherHour(value: string): string {
  const m = /T(\d{2}):/.exec(value);
  return m ? `${m[1]}:00` : value.slice(-5);
}

function formatPrecip(row: WeatherHour): string {
  const parts: string[] = [];
  if ((row.rainMm ?? 0) > 0) parts.push(`дождь ${row.rainMm!.toFixed(1)} мм`);
  else if ((row.precipMm ?? 0) > 0) parts.push(`осадки ${row.precipMm!.toFixed(1)} мм`);
  if ((row.snowCm ?? 0) > 0) parts.push(`снег ${row.snowCm!.toFixed(1)} см`);
  if (row.gustMs != null && row.windMs != null && row.gustMs > row.windMs + 2) parts.push(`порывы ${Math.round(row.gustMs)} м/с`);
  return parts.length > 0 ? parts.join(' · ') : 'без осадков';
}

function weatherText(code: number | null | undefined, precipMm: number | null, snowCm: number | null): string {
  if ((snowCm ?? 0) > 0) return 'снег';
  if ((precipMm ?? 0) > 0) return 'осадки';
  if (code == null) return 'прогноз';
  if (code === 0) return 'ясно';
  if (code === 1 || code === 2 || code === 3) return 'облачно';
  if (code === 45 || code === 48) return 'туман';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'дождь';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'снег';
  if (code >= 95) return 'гроза';
  return 'прогноз';
}

/** Краткий поповер у пина точки: название, цех, категория + «Подробно». */
function PinPopover({ x, y, title, subtitle, category, onDetails, onRouteFrom, onClose }: {
  x: number; y: number; title: string; subtitle: string; category: PointCategory;
  onDetails: () => void; onRouteFrom: () => void; onClose: () => void;
}) {
  const cat = POINT_CATEGORY_META.find((c) => c.id === category) ?? POINT_CATEGORY_META[2]!;
  return (
    <div
      className="absolute z-[455] w-56 -translate-x-1/2 -translate-y-full rounded-xl border border-border-default bg-bg-deep/94 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
      style={{ left: x, top: y - 52 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-text-strong">{title}</p>
          {subtitle && <p className="truncate text-[11.5px] text-text-muted">{subtitle}</p>}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${cat.color}22`, color: cat.color }}>{cat.label}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDetails}
          className="h-7 flex-1 rounded border border-accent-clay/45 bg-accent-clay-bg px-2 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/15"
        >Подробно →</button>
        <button
          type="button"
          onClick={onRouteFrom}
          title="Маршрут отсюда"
          className="flex h-7 items-center justify-center rounded border border-sky-400/35 px-2 text-[12px] text-sky-200 outline-none transition-colors hover:bg-sky-400/10"
        ><Route size={13} strokeWidth={1.75} /></button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded border border-border-subtle text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
        >×</button>
      </div>
      <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-border-default bg-bg-deep/94" />
    </div>
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
