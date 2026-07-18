import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Ban, Building2, Check, CheckCheck, ChevronLeft, ChevronRight, CloudRain, Crosshair, Eraser, Eye, EyeOff, Filter, Footprints, Globe, List, MapPin, MousePointer2, Network, Pause, Pencil, Pentagon, Play, Redo2, Route, Ruler, Satellite, Scissors, SlidersHorizontal, TrainTrack, Trash2, Truck, Undo2, Warehouse, X } from 'lucide-react';
import { getWarehouseState } from '@pyn/core';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { cn } from '@/lib/cn';
import { useMapStore, type RoadOverlapMergeSummary } from '@/lib/map-store';
import { initMap } from '@/lib/map-repo';
import {
  EMPTY_POINT_EQUIPMENT,
  NTMK_CENTER,
  NTMK_ZOOM,
  POINT_CATEGORY_META,
  POINT_VEHICLE_TYPES,
  ROAD_ACCESS_KIND_META,
  VEHICLE_TYPES,
  WORK_AREA_COLOR,
  allVehiclesByPurpose,
  categoryFromWarehouseState,
  vehicleColor,
  type BuildingOutline,
  type CrossingCandidate,
  type ExternalRailway,
  type FootwayLine,
  type LatLng,
  type MapRoad,
  type MapTool,
  type PointCategory,
  type RoadAccess,
  type RoadAccessKind,
  type VehicleType,
} from './map-types';
import { MapCanvas, type MapSelection, type OptimizeOverlay } from './MapCanvas';
import { buildRoadSnapIndex, snapGlonassHistorySegments, snapGlonassPosition, snapGlonassReplayPoints, snapGlonassTrackSegments, snapToRoadIndex, type RoadSnapIndex } from './glonass-snap';
import { materializeConvergenceWelds, mergeOverlappingRoads, normalizeRoadTopology, polylineIntersections, type RoadMergeReport, type RoadNormalizationReport } from './road-network';
import { inspectRoadNetwork, roadNetworkIssues, type RoadNetworkQuality } from './road-quality';
import { distanceMeters } from './geo';
import { MapDetailPanel } from './MapDetailPanel';
import { MapWarehouseOverlay } from './MapWarehouseOverlay';
import { VehiclePurposeAccessGrid } from './VehiclePurposeAccessGrid';
import { GlonassPanel } from './GlonassPanel';
import {
  PLAYBACK_SPEEDS,
  STATUS_COLOR,
  flattenHistoryLayer,
  formatGlonassSpeed,
  useGlonassStore,
  vehicleStatus,
  GLONASS_PRO_COLOR,
  GLONASS_RAW_COLOR,
  type GlonassHistoryPoint,
  type GlonassHistoryLayer,
  type GlonassMarker,
  type GlonassPosition,
  type GlonassReplayMarker,
} from './glonass-store';
import { optimize, totalCost, type DemandPoint } from './optimize';
import { computeFastestRoute, type RouteResult } from './route-network';
import { loadNtmkOsmRoadSuggestions } from './road-suggestions';
import { initRefLayers, subscribeRefLayers, type MapRefLayers } from './map-ref-layers';

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
  currentTime?: string | null;
  pressureHpa?: number | null;
  isPrecip: boolean;
  hourly: WeatherHour[];
}

interface WeatherDisplay {
  currentKey: string;
  row: WeatherHour | null;
  condition: string;
  tempC: number | null;
  windMs: number | null;
  precipText: string;
  chance: number | null;
  isPrecip: boolean;
  pressureHpa: number | null;
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

/** Убранные вручную места ж/д-кандидатов (localStorage) — чтобы не возвращались. */
const DISMISSED_CROSSINGS_KEY = 'pyn:map:dismissed-crossings:v1';
const GLONASS_LIVE_DELAY_MS = 30_000;
/** ⚠ «Нет сигнала» — только после 30 с реального стояния координат при статусе «в работе». */
const GLONASS_BAD_SIGNAL_AFTER_MS = 30_000;

function loadDismissedCrossingSpots(): LatLng[] {
  try {
    const raw = window.localStorage?.getItem(DISMISSED_CROSSINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is LatLng => !!p && typeof (p as LatLng).lat === 'number' && typeof (p as LatLng).lng === 'number')
      .slice(-500);
  } catch {
    return [];
  }
}

function saveDismissedCrossingSpots(spots: LatLng[]): void {
  try {
    window.localStorage?.setItem(DISMISSED_CROSSINGS_KEY, JSON.stringify(spots.slice(-500)));
  } catch { /* localStorage best-effort */ }
}

/** Хвост трека последних `meters` метров (след за машиной ~100 м), порядок сохранён. */
function trimTrackToMeters<T extends { lat: number; lng: number }>(track: T[], meters: number): T[] {
  if (track.length <= 2) return track;
  const out: T[] = [];
  let acc = 0;
  for (let i = track.length - 1; i >= 0; i -= 1) {
    out.push(track[i]!);
    if (i < track.length - 1) acc += distanceMeters(track[i]!, track[i + 1]!);
    if (acc >= meters) break;
  }
  return out.reverse();
}

/** Трек пригоден для отложенного «живого» пути: ≥2 точек и свежий (<3 мин). */
function liveTrackUsable(track: GlonassPosition[]): boolean {
  if (track.length < 2) return false;
  const last = track[track.length - 1]!;
  const ms = last.time ? Date.parse(last.time) : NaN;
  return Number.isFinite(ms) && Date.now() - ms < 3 * 60_000;
}

function delayedLiveRoadTrack(
  track: GlonassPosition[],
  index: RoadSnapIndex,
  roads: MapRoad[],
  delayMs: number,
): { point: GlonassHistoryPoint; path: LatLng[]; timed: GlonassHistoryPoint[] } | null {
  const timed = track
    .filter((p) => p.time && Number.isFinite(Date.parse(p.time)))
    .map((p): GlonassHistoryPoint => ({ lat: p.lat, lng: p.lng, speed: p.speed, time: p.time! }));
  if (timed.length < 2) return null;

  const firstMs = Date.parse(timed[0]!.time);
  const lastMs = Date.parse(timed[timed.length - 1]!.time);
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs) || lastMs - firstMs < Math.min(12_000, delayMs * 0.4)) return null;

  const snapped = snapGlonassReplayPoints(timed, index, roads).map((p) => {
    // Live is intentionally stricter than historical analysis: while a road is
    // within the capture radius, both the marker and its green tail must sit on
    // the visible yellow geometry. Raw GLONASS points remain untouched.
    const road = snapToRoadIndex(index, p);
    return road ? { ...p, lat: road.point.lat, lng: road.point.lng } : p;
  });
  if (snapped.length < 2) return null;

  const targetMs = Math.min(lastMs, Math.max(firstMs, Date.now() - delayMs));
  const interpolated = interpolateTimedPoint(snapped, targetMs);
  if (!interpolated) return null;
  const pointRoad = snapToRoadIndex(index, interpolated);
  const point = pointRoad
    ? { ...interpolated, lat: pointRoad.point.lat, lng: pointRoad.point.lng }
    : interpolated;

  // След — только хвост ПОСЛЕ последнего разрыва (где пути по дороге нет):
  // иначе линия соединила бы берега разрыва диагональю.
  const visible = [...snapped.filter((p) => Date.parse(p.time) <= targetMs), point];
  let tailFrom = 0;
  for (let i = 1; i < visible.length; i += 1) {
    if (visible[i]!.gapBefore) tailFrom = i;
  }
  const path = trimTrackToMeters(visible.slice(tailFrom), 115)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
  return { point, path: path.length >= 2 ? path : [{ lat: point.lat, lng: point.lng }], timed: snapped };
}

function roadRouteForPaint(trace: LatLng[], roads: MapRoad[]): LatLng[] {
  if (trace.length < 2 || roads.length === 0) return trace;
  const out: LatLng[] = [trace[0]!];
  for (let i = 0; i < trace.length - 1; i += 1) {
    const a = trace[i]!;
    const b = trace[i + 1]!;
    const direct = distanceMeters(a, b);
    const route = direct >= 1 ? computeFastestRoute(roads, a, b) : null;
    const path = route && route.path.length >= 2 && route.distanceMeters <= Math.max(24, direct * 2.35 + 18)
      ? route.path
      : [a, b];
    for (const p of path.slice(1)) {
      const prev = out[out.length - 1]!;
      if (distanceMeters(prev, p) > 0.35) out.push(p);
    }
  }
  return out.length >= 2 ? out : trace;
}

function interpolateTimedPoint(points: GlonassHistoryPoint[], targetMs: number): GlonassHistoryPoint | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const firstMs = Date.parse(first.time);
  const lastMs = Date.parse(last.time);
  if (!Number.isFinite(targetMs)) return last;
  if (!Number.isFinite(firstMs) || targetMs <= firstMs) return first;
  if (!Number.isFinite(lastMs) || targetMs >= lastMs) return last;

  const idx = Math.min(points.length - 1, Math.max(1, findHistoryIndexAt(points, targetMs) + 1));
  const a = points[idx - 1]!;
  const b = points[idx]!;
  const aMs = Date.parse(a.time);
  const bMs = Date.parse(b.time);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs) || bMs <= aMs) return a;
  // Через разрыв не интерполируем: машина стоит на берегу до момента следующей
  // точки, затем телепорт — а не «полёт» по диагонали, где дороги нет.
  if (b.gapBefore) return { ...a, time: new Date(targetMs).toISOString() };
  const t = Math.min(1, Math.max(0, (targetMs - aMs) / (bMs - aMs)));
  return {
    ...b,
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    speed: a.speed != null && b.speed != null ? a.speed + (b.speed - a.speed) * t : (t < 0.5 ? a.speed : b.speed),
    time: new Date(targetMs).toISOString(),
  };
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
  const addRoadRestriction = useMapStore((s) => s.addRoadRestriction);
  const eraseRoadAccessTrace = useMapStore((s) => s.eraseRoadAccessTrace);
  const eraseSuggestionTrace = useMapStore((s) => s.eraseSuggestionTrace);
  const beginBrushEdit = useMapStore((s) => s.beginBrushEdit);
  const commitBrushEdit = useMapStore((s) => s.commitBrushEdit);
  const undoBrushEdit = useMapStore((s) => s.undoBrushEdit);
  const redoBrushEdit = useMapStore((s) => s.redoBrushEdit);
  const canUndoBrush = useMapStore((s) => s.canUndoBrush);
  const canRedoBrush = useMapStore((s) => s.canRedoBrush);
  const addCrossing = useMapStore((s) => s.addCrossing);
  const addClearance = useMapStore((s) => s.addClearance);
  const addRailway = useMapStore((s) => s.addRailway);
  const addRoadSuggestions = useMapStore((s) => s.addRoadSuggestions);
  const clearRoadSuggestions = useMapStore((s) => s.clearRoadSuggestions);
  const normalizeRoads = useMapStore((s) => s.normalizeRoads);
  const mergeRoadOverlaps = useMapStore((s) => s.mergeRoadOverlaps);
  const focusWarehouseId = useMapStore((s) => s.focusWarehouseId);
  const focusPointId = useMapStore((s) => s.focusPointId);
  const clearFocusWarehouse = useMapStore((s) => s.clearFocusWarehouse);
  const warehouses = useWarehousesStore((s) => s.byId);

  const [tool, setTool] = useState<MapTool>('select');
  const [roadQualityOpen, setRoadQualityOpen] = useState(false);
  const [lastNormalization, setLastNormalization] = useState<RoadNormalizationReport | null>(null);
  const [lastMerge, setLastMerge] = useState<RoadOverlapMergeSummary | null>(null);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [activeWarehouses, setActiveWarehouses] = useState<Set<string> | null>(null); // null = все
  const [activeCategories, setActiveCategories] = useState<Set<PointCategory> | null>(null); // null = все
  const [activeVehicle, setActiveVehicle] = useState<VehicleType | null>(null);
  const [showWeather, setShowWeather] = useState(true);
  const [weatherNonce, setWeatherNonce] = useState(0);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [weatherField, setWeatherField] = useState<WeatherFieldPoint[]>([]);
  const [pointScreen, setPointScreen] = useState<{ x: number; y: number } | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  // Оверлей «карточка склада + МОЛы» поверх карты (кнопка на точке).
  const [warehouseCardId, setWarehouseCardId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<LatLng | null>(null);
  const [focus, setFocus] = useState<{ latlng: LatLng; nonce: number; zoom?: number } | null>(null);

  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [editorToolsOpen, setEditorToolsOpen] = useState(false);
  const [showRoadSuggestions, setShowRoadSuggestions] = useState(false);
  const [showRoadAccess, setShowRoadAccess] = useState(true);
  // «Высота проезда» — по умолчанию СКРЫТО (ТЗ 2026-07-11), включается в «Виде».
  const [showClearances, setShowClearances] = useState(false);
  // Гугл-слой (подписи/дороги/ориентиры) — включаемый справочный оверлей.
  const [showGoogleLabels, setShowGoogleLabels] = useState(false);
  // Справочные слои (ж/д / здания / пешеходки) — грузятся СРАЗУ из кэша,
  // фоновое обновление раз в 12 часов (map-ref-layers). Тумблеры — показ/скрытие.
  const [refLayers, setRefLayers] = useState<MapRefLayers>({ at: 0, railways: [], buildings: [], footways: [] });
  const [showBuildings, setShowBuildings] = useState(true);
  const [showExtRails, setShowExtRails] = useState(false);
  const [showFootways, setShowFootways] = useState(false);
  // Показ НАШИХ ручных областей/площадок (полигоны) — своя кнопка, как у зданий.
  const [showAreas, setShowAreas] = useState(false);
  // Убранные вручную кандидаты переездов — храним ПО МЕСТУ (не по id, он плавает
  // от округления/смены id внешней ж/д) и в localStorage, чтобы после удаления
  // они НЕ возвращались при перезагрузке/смене вида.
  const [dismissedSpots, setDismissedSpots] = useState<LatLng[]>(() => loadDismissedCrossingSpots());
  // «Ограничение дороги»: выделенный участок ждёт настройки в компактном окне.
  const [restrictDraft, setRestrictDraft] = useState<LatLng[][] | null>(null);
  const [moveByMapPointId, setMoveByMapPointId] = useState<string | null>(null);
  const [routeSourcePointId, setRouteSourcePointId] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
  const weatherPoint = useMemo(() => viewBounds
    ? { lat: (viewBounds.south + viewBounds.north) / 2, lng: (viewBounds.west + viewBounds.east) / 2 }
    : NTMK_CENTER, [viewBounds]);

  useEffect(() => { void initMap(); }, []);

  // Справочные слои: кэш мгновенно, устарели (12ч) → обновление фоном.
  useEffect(() => {
    void initRefLayers();
    return subscribeRefLayers(setRefLayers);
  }, []);

  // Не-разработчик не может держать инструмент рисования: всегда «Выбор».
  useEffect(() => {
    if (!canEdit && tool !== 'select' && tool !== 'optimize') setTool('select');
  }, [canEdit, tool]);

  // Погода: пока слой включён — тянем радар + сводку по центру активного экрана
  // карты. Время остаётся екатеринбургским, место — текущий участок карты.
  useEffect(() => {
    if (!showWeather) return;
    let alive = true;
    const pull = async () => {
      try {
        const res = await window.pyn?.mapWeather?.(weatherPoint.lat, weatherPoint.lng);
        if (!alive || !res) return;
        if (res.weather) setWeather(res.weather);
        if (res.ok) setWeatherNonce((n) => n + 1); // свежий кадр → пересоздать слой
      } catch { /* погода не критична */ }
    };
    const first = setTimeout(() => { void pull(); }, 350);
    const timer = setInterval(() => { void pull(); }, 5 * 60 * 1000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [showWeather, weatherPoint.lat, weatherPoint.lng]);

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
      // Назначение — ЯВНЫЙ признак (ТЗ 2026-07-09): новая точка = «Иное»,
      // «Технология»/«Экспедиция» проставляются в редакторе осознанно.
      purposes: ['other'],
      vehiclesByPurpose: {},
      rearByPurpose: {},
    });
    setTool('select');
    setSelection({ type: 'point', id });
  }, [addPoint]);

  const handleCreateArea = useCallback((vertices: LatLng[]) => {
    // Свои области — светло-жёлтые рабочие площадки (погрузка/выгрузка/иное);
    // тип и цвет правятся в карточке (области цехов остаются как были).
    const id = addArea({ name: '', color: WORK_AREA_COLOR, vertices, shopName: null, kind: 'work', comment: '' });
    setTool('select');
    setSelection({ type: 'area', id });
  }, [addArea]);

  const handleCreateRoad = useCallback((vertices: LatLng[]) => {
    addRoad({ name: '', vertices });
    setTool('select');
    setSelection(null);
  }, [addRoad]);

  // Кисти-ластики работают ЖИВЬЁМ по сегментам зажатой ЛКМ — из инструмента не
  // выходим (можно стирать несколько штрихов подряд, выход — Esc/повторный клик).
  const handleEraseRoadTrace = useCallback((vertices: LatLng[], radiusMeters: number) => {
    eraseRoadTrace(vertices, radiusMeters);
  }, [eraseRoadTrace]);

  const handleEraseSuggestionTrace = useCallback((vertices: LatLng[], radiusMeters: number) => {
    eraseSuggestionTrace(vertices, radiusMeters);
  }, [eraseSuggestionTrace]);

  const handleEraseRoadAccessTrace = useCallback((vertices: LatLng[], radiusMeters: number) => {
    eraseRoadAccessTrace(vertices, radiusMeters);
  }, [eraseRoadAccessTrace]);

  // «Ограничение дороги»: Enter по выделению → компактное окно настройки участка.
  const handleCreateRestriction = useCallback((parts: LatLng[][]) => {
    const routed = parts
      .map((vertices) => roadRouteForPaint(vertices, doc.roads))
      .filter((vertices) => vertices.length >= 2);
    if (routed.length > 0) setRestrictDraft(routed);
  }, [doc.roads]);

  const saveRestriction = useCallback((fields: Partial<RoadAccess>) => {
    if (!restrictDraft || restrictDraft.length === 0) return;
    let id: string | null = null;
    for (const vertices of restrictDraft) id = addRoadRestriction(vertices, fields);
    setRestrictDraft(null);
    setTool('select');
    if (id) setSelection({ type: 'roadAccess', id });
  }, [restrictDraft, addRoadRestriction]);

  const cancelRestriction = useCallback(() => {
    setRestrictDraft(null);
    setTool('select');
    setSelection(null);
  }, []);

  const handleCreateCrossing = useCallback((latlng: LatLng) => {
    const id = addCrossing(latlng);
    setTool('select');
    setSelection({ type: 'crossing', id });
  }, [addCrossing]);

  const handleCreateClearance = useCallback((latlng: LatLng) => {
    const id = addClearance(latlng);
    // Поставил отметку — слой включается, чтобы её было видно и можно править.
    setShowClearances(true);
    setTool('select');
    setSelection({ type: 'clearance', id });
  }, [addClearance]);

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

  // Esc в режиме инструмента → вернуться в «Выбор» (курсор перестаёт «носить»
  // инструмент); заодно закрывает окно настройки участка, если оно открыто.
  const handleCancelTool = useCallback(() => {
    setTool('select');
    setSelection(null);
    setRestrictDraft(null);
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    const onUndoKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redoBrushEdit();
      else undoBrushEdit();
    };
    window.addEventListener('keydown', onUndoKey);
    return () => window.removeEventListener('keydown', onUndoKey);
  }, [canEdit, redoBrushEdit, undoBrushEdit]);

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

  // Видимые справочные слои (данные всегда в кэше, тумблеры — только показ).
  const buildings = useMemo<BuildingOutline[]>(
    () => (showBuildings ? refLayers.buildings : []),
    [showBuildings, refLayers.buildings],
  );
  const extRailways = useMemo<ExternalRailway[]>(
    () => (showExtRails ? refLayers.railways : []),
    [showExtRails, refLayers.railways],
  );
  const footways = useMemo<FootwayLine[]>(
    () => (showFootways ? refLayers.footways : []),
    [showFootways, refLayers.footways],
  );

  // Кандидаты на ж/д переезд: геометрические пересечения внешних ж/д с нашими
  // дорогами. НЕ каждый крест = реальный переезд: рядом с существующим переездом
  // (≤30 м) не предлагаем, убранные вручную не возвращаем, дубли схлопываем.
  const crossingCandidates = useMemo<CrossingCandidate[]>(() => {
    if (extRailways.length === 0 || doc.roads.length === 0) return [];
    const out: CrossingCandidate[] = [];
    const existing = doc.crossings ?? [];
    for (const rail of extRailways) {
      for (const road of doc.roads) {
        for (const hit of polylineIntersections(rail.vertices, road.vertices)) {
          const id = `${rail.id}|${road.id}|${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`;
          if (dismissedSpots.some((s) => distanceMeters(s, hit) <= 22)) continue;
          if (existing.some((c) => distanceMeters(c, hit) <= 30)) continue;
          if (out.some((c) => distanceMeters(c, hit) <= 25)) continue;
          out.push({ id, roadId: road.id, railwayId: rail.id, lat: hit.lat, lng: hit.lng });
        }
      }
    }
    return out.slice(0, 200);
  }, [extRailways, doc.roads, doc.crossings, dismissedSpots]);

  const handleConfirmCandidate = useCallback((candidate: CrossingCandidate) => {
    addCrossing({ lat: candidate.lat, lng: candidate.lng });
    // Кандидат исчезнет сам: рядом теперь есть настоящий переезд (фильтр ≤30 м).
  }, [addCrossing]);

  const handleDismissCandidate = useCallback((candidate: CrossingCandidate) => {
    setDismissedSpots((prev) => {
      const next = [...prev, { lat: candidate.lat, lng: candidate.lng }];
      saveDismissedCrossingSpots(next);
      return next;
    });
  }, []);

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
      purpose: selectedPoint.purposes?.[0] ?? null,
    });
  }, [doc.roads, doc.roadAccess, routeSourcePoint, selectedPoint, activeVehicle]);

  useEffect(() => {
    if (routeSourcePointId && !doc.points.some((p) => p.id === routeSourcePointId)) {
      setRouteSourcePointId(null);
    }
  }, [doc.points, routeSourcePointId]);

  // Точку сначала показываем поповером у пина; не-точки — сразу полной карточкой.
  // При переключении точка→точка режим (поповер / полная карточка) сохраняем.
  const prevSelectionTypeRef = useRef<MapSelection['type'] | null>(null);
  useEffect(() => {
    if (!selection) {
      setDetailExpanded(false);
      prevSelectionTypeRef.current = null;
      return;
    }
    const prevType = prevSelectionTypeRef.current;
    prevSelectionTypeRef.current = selection.type;
    if (selection.type !== 'point') {
      setDetailExpanded(true);
    } else if (prevType !== 'point') {
      setDetailExpanded(false);
    }
  }, [selection]);

  const selectedWarehouse = selectedPoint?.warehouseId ? warehouses.get(selectedPoint.warehouseId) : undefined;
  const showFullCard = tool !== 'optimize' && selection !== null && (selection.type !== 'point' || detailExpanded);
  const showPinPopover = tool !== 'optimize' && selection?.type === 'point' && !detailExpanded && pointScreen !== null && selectedPoint !== null;

  // ── Глонасс (мониторинг транспорта) ────────────────────────────────────────
  const glonassOpen = useGlonassStore((s) => s.open);
  const setGlonassOpen = useGlonassStore((s) => s.setOpen);
  const glonassFleet = useGlonassStore((s) => s.fleet);
  const glonassSelected = useGlonassStore((s) => s.selected);
  const glonassPositions = useGlonassStore((s) => s.positions);
  const glonassTracks = useGlonassStore((s) => s.tracks);
  const glonassStale = useGlonassStore((s) => s.staleSince);
  const glonassFollowIds = useGlonassStore((s) => s.followIds);
  const glonassHistoryLayers = useGlonassStore((s) => s.historyLayers);
  const activeHistoryLayerId = useGlonassStore((s) => s.activeHistoryLayerId);
  const playbackIndex = useGlonassStore((s) => s.playbackIndex);
  const playbackSpeed = useGlonassStore((s) => s.playbackSpeed);
  const showGlonassPro = useGlonassStore((s) => s.showPro);
  const showGlonassRaw = useGlonassStore((s) => s.showRaw);
  const refreshGlonass = useGlonassStore((s) => s.refreshPositions);

  // ГЛОНАСС-фиксы кривые (проходят «сквозь здания») → прикрепляем выравниванием:
  // позиция липнет к точке-пину (стоит у точки) или к дороге; треки — к дорогам.
  // Выравнивание только на отображении, сырые данные не трогаем (ТЗ 2026-07-09).
  const roadSnapIndex = useMemo(() => buildRoadSnapIndex(doc.roads), [doc.roads]);
  const roadQuality = useMemo(() => inspectRoadNetwork(doc.roads, doc.points), [doc.roads, doc.points]);
  const roadNormalizationPreview = useMemo(() => (
    roadQualityOpen ? normalizeRoadTopology(doc.roads).report : null
  ), [doc.roads, roadQualityOpen]);
  const roadIssues = useMemo(() => (
    roadQualityOpen ? roadNetworkIssues(doc.roads) : []
  ), [doc.roads, roadQualityOpen]);

  const handleNormalizeRoadNetwork = useCallback(() => {
    beginBrushEdit();
    const report = normalizeRoads();
    commitBrushEdit();
    setLastNormalization(report);
  }, [beginBrushEdit, commitBrushEdit, normalizeRoads]);

  // Слияние «палка-на-палку»: dry-run для предпросмотра (только при открытой панели).
  const roadMergePreview = useMemo(() => {
    if (!roadQualityOpen) return null;
    const merged = mergeOverlappingRoads(doc.roads);
    const welded = materializeConvergenceWelds(merged.roads);
    return { merge: merged.report, welds: welded.welds };
  }, [doc.roads, roadQualityOpen]);

  const handleMergeRoadOverlaps = useCallback(() => {
    beginBrushEdit();
    const summary = mergeRoadOverlaps();
    commitBrushEdit();
    setLastMerge(summary);
  }, [beginBrushEdit, commitBrushEdit, mergeRoadOverlaps]);

  // Точки отмеченных машин — каждая независимо сажается на жёлтую сеть.
  const glonassMarkers = useMemo<GlonassMarker[]>(() => {
    const byId = new Map(glonassFleet.map((v) => [v.id, v]));
    const out: GlonassMarker[] = [];
    for (const id of glonassSelected) {
      const pos = glonassPositions.get(id);
      if (!pos) continue;
      const v = byId.get(id);
      const status = vehicleStatus(pos);
      const track = glonassTracks.get(id) ?? [];
      // Каждая машина — свой трек/матчинг. Не шарим состояние между id.
      const delayed = liveTrackUsable(track)
        ? delayedLiveRoadTrack(track, roadSnapIndex, doc.roads, GLONASS_LIVE_DELAY_MS)
        : null;
      const matchedSegments = !delayed && liveTrackUsable(track)
        ? snapGlonassTrackSegments(track, roadSnapIndex, doc.roads)
        : [];
      const matched = lastTrackPoint(matchedSegments);
      const rawPosition = { lat: pos.lat, lng: pos.lng };
      // Всегда дорога, если в радиусе; pin-standoff не используем для live-флота.
      const forceRoad = (p: LatLng): LatLng => {
        const hit = snapToRoadIndex(roadSnapIndex, p);
        return hit ? hit.point : p; // без pin — иначе «вторая рядом с дорогой»
      };
      // Приоритет: delayed → matched → raw, но КАЖДЫЙ вариант прогоняем forceRoad.
      // Не доверяем delayed/matched «как есть» — у 2-й машины матчинг иногда
      // отдаёт точку вне видимой жёлтой сети, пока у 1-й уже стабильный путь.
      const candidate = delayed?.point ?? matched ?? rawPosition;
      const snapped = forceRoad(candidate);
      // Если delayed далеко от сырого GPS (>80 м) — GPS/сайт прыгнул: сажаем raw на дорогу.
      const rawOnRoad = forceRoad(rawPosition);
      const useDelayed = delayed != null
        && distanceMeters(snapped, rawOnRoad) <= 80;
      const finalPos = useDelayed ? snapped : rawOnRoad;
      const stale = glonassStale.get(id) ?? null;
      const timedPath = useDelayed && delayed && delayed.timed.length >= 2
        ? delayed.timed.map((p) => {
            const road = forceRoad(p);
            return { ...p, lat: road.lat, lng: road.lng };
          })
        : undefined;
      out.push({
        id, garage: v?.garage ?? '', gos: v?.gos ?? '',
        lat: finalPos.lat, lng: finalPos.lng, course: pos.course, speed: pos.speed,
        path: useDelayed ? (delayed?.path ?? lastTrackSegment(matchedSegments) ?? undefined) : undefined,
        timedPath,
        delayMs: GLONASS_LIVE_DELAY_MS,
        time: pos.time,
        status,
        badSince: status === 'moving' && stale != null && Date.now() - stale >= GLONASS_BAD_SIGNAL_AFTER_MS ? stale : null,
      });
    }
    return out;
  }, [glonassFleet, glonassSelected, glonassPositions, glonassTracks, glonassStale, roadSnapIndex, doc.points, doc.roads]);

  // Слежение (мульти): статичные цели для машин без timedPath (rAF ведёт живые).
  const glonassFollowTargets = useMemo<LatLng[]>(() => {
    if (glonassFollowIds.size === 0) return [];
    const pts: LatLng[] = [];
    for (const m of glonassMarkers) {
      if (!glonassFollowIds.has(m.id)) continue;
      if ((m.timedPath?.length ?? 0) >= 2) continue; // камеру ведёт rAF
      pts.push({ lat: m.lat, lng: m.lng });
    }
    return pts;
  }, [glonassFollowIds, glonassMarkers]);

  const glonassTrackLines = useMemo(() => {
    const out: Array<{ id: string; color: string; segments: LatLng[][]; mode: 'pro' | 'raw' }> = [];
    for (const id of glonassSelected) {
      const track = glonassTracks.get(id);
      if (!track || track.length < 2) continue;
      const pos = glonassPositions.get(id) ?? track[track.length - 1];
      // Живой след (timedPath) рисует MapCanvas строго ЗА едущим маркером —
      // здесь только статичный фоллбэк, когда живого пути ещё нет.
      // След за машиной — ХВОСТ ~100 м (не весь путь за сессию): «откуда едет».
      const tail = trimTrackToMeters(track, 100);
      if (tail.length < 2) continue;
      if (showGlonassRaw) {
        out.push({ id: `${id}:raw`, color: GLONASS_RAW_COLOR, segments: [tail], mode: 'raw' });
      }
      const delayed = liveTrackUsable(track)
        ? delayedLiveRoadTrack(track, roadSnapIndex, doc.roads, GLONASS_LIVE_DELAY_MS)
        : null;
      if (showGlonassPro && !(delayed && delayed.timed.length >= 2)) {
        out.push({
          id: `${id}:pro`,
          color: STATUS_COLOR[vehicleStatus(pos)],
          segments: snapGlonassTrackSegments(tail, roadSnapIndex, doc.roads),
          mode: 'pro',
        });
      }
    }
    return out;
  }, [glonassSelected, glonassTracks, glonassPositions, roadSnapIndex, doc.roads, showGlonassPro, showGlonassRaw]);

  const activeHistoryLayer = useMemo(() => (
    glonassHistoryLayers.find((layer) => layer.id === activeHistoryLayerId) ?? null
  ), [glonassHistoryLayers, activeHistoryLayerId]);

  const glonassHistoryLines = useMemo(() => {
    const out: Array<{ id: string; color: string; segments: LatLng[][]; opacity: number; mode: 'pro' | 'raw' }> = [];
    for (const layer of glonassHistoryLayers) {
      if (!layer.visible) continue;
      const opacity = layer.kind === 'yearRoads' ? 0.62 : 0.86;
      for (const segment of layer.segments) {
        if (segment.points.length < 2) continue;
        if (layer.kind === 'yearRoads') {
          out.push({ id: segment.id, color: layer.color, opacity, segments: [segment.points], mode: 'raw' });
          continue;
        }
        if (showGlonassRaw) {
          out.push({ id: `${segment.id}:raw`, color: GLONASS_RAW_COLOR, opacity: 0.72, segments: [segment.points], mode: 'raw' });
        }
        if (showGlonassPro) {
          out.push({
            id: `${segment.id}:pro`,
            color: GLONASS_PRO_COLOR,
            opacity,
            // Линия истории и replay-маркер используют один timed-конвейер.
            segments: snapGlonassHistorySegments(segment.points, roadSnapIndex, doc.roads),
            mode: 'pro',
          });
        }
      }
    }
    return out;
  }, [glonassHistoryLayers, roadSnapIndex, doc.roads, showGlonassPro, showGlonassRaw]);

  const activeReplayPoints = useMemo(() => {
    if (!activeHistoryLayer || activeHistoryLayer.kind !== 'replay') return [];
    return snapGlonassReplayPoints(flattenHistoryLayer(activeHistoryLayer), roadSnapIndex, doc.roads);
  }, [activeHistoryLayer, roadSnapIndex, doc.roads]);

  const glonassReplayMarker = useMemo<GlonassReplayMarker | null>(() => {
    if (!activeHistoryLayer?.visible || activeHistoryLayer.kind !== 'replay' || activeReplayPoints.length === 0) return null;
    const pointIndex = Math.min(Math.max(0, playbackIndex), activeReplayPoints.length - 1);
    const point = activeReplayPoints[pointIndex];
    if (!point) return null;
    const prevPoint = activeReplayPoints[Math.max(0, pointIndex - 1)] ?? null;
    const gapMs = prevPoint ? Math.abs(Date.parse(point.time) - Date.parse(prevPoint.time)) : 0;
    const vehicle = activeHistoryLayer.vehicleId != null ? glonassFleet.find((v) => v.id === activeHistoryLayer.vehicleId) : undefined;
    return {
      id: `${activeHistoryLayer.id}-replay`,
      garage: vehicle?.garage ?? activeHistoryLayer.vehicleLabel.split(' · ')[0] ?? '',
      gos: vehicle?.gos ?? activeHistoryLayer.vehicleLabel,
      lat: point.lat,
      lng: point.lng,
      course: courseAt(activeReplayPoints, pointIndex),
      speed: point.speed,
      color: activeHistoryLayer.color,
      time: point.time,
      animationMs: replayAnimationMs(gapMs, playbackSpeed),
    };
  }, [activeHistoryLayer, activeReplayPoints, playbackIndex, playbackSpeed, glonassFleet]);

  const handleFocusGlonassVehicle = useCallback((pos: GlonassPosition) => {
    // Наводимся на ОТОБРАЖАЕМУЮ позицию (задержанный маркер на карте), а не на
    // сырую «прямо сейчас» с сайта — иначе камера уезжает туда, где машины ещё нет.
    const marker = glonassMarkers.find((m) => m.id === pos.id);
    const snapped = marker
      ? { lat: marker.lat, lng: marker.lng }
      : snapGlonassPosition({ lat: pos.lat, lng: pos.lng }, roadSnapIndex, doc.points);
    setFocus({
      latlng: snapped,
      nonce: Date.now(),
      zoom: Math.max(NTMK_ZOOM, 18),
    });
  }, [glonassMarkers, roadSnapIndex, doc.points]);

  const handleFocusHistoryPoint = useCallback((point: GlonassHistoryPoint) => {
    const snapped = snapGlonassPosition({ lat: point.lat, lng: point.lng }, roadSnapIndex, doc.points);
    setFocus({
      latlng: snapped,
      nonce: Date.now(),
      zoom: Math.max(NTMK_ZOOM, 18),
    });
  }, [roadSnapIndex, doc.points]);

  useEffect(() => {
    if (!activeHistoryLayer) return;
    const first = flattenHistoryLayer(activeHistoryLayer)[0];
    if (!first) return;
    setFocus({
      latlng: { lat: first.lat, lng: first.lng },
      nonce: Date.now(),
      zoom: Math.max(NTMK_ZOOM, 17.2),
    });
  }, [activeHistoryLayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Пока панель открыта — опрашиваем позиции парка (каждые 5 с): на карту
  // попадут только отмеченные галочками, но список видит цветные статусы всех.
  useEffect(() => {
    if (!glonassOpen) return;
    void refreshGlonass();
    const iv = setInterval(() => void refreshGlonass(), 5000);
    return () => clearInterval(iv);
  }, [glonassOpen, glonassFleet.length, refreshGlonass]);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Тулбар на подложке (h-9), как в других разделах */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_map', 'Карта')}
        </span>
        <div className="no-drag-region ml-auto flex items-center gap-1.5">
          <ViewMenu
            items={[
              { icon: Ban, label: 'Участки', on: showRoadAccess, onClick: () => setShowRoadAccess((v) => !v), title: 'Ограничения участков дорог' },
              { icon: Route, label: 'Возможные дороги', on: showRoadSuggestions, onClick: () => setShowRoadSuggestions((v) => !v), title: 'Красный пунктир — возможные дороги (помощник)' },
              { icon: Globe, label: 'Гугл-слой', on: showGoogleLabels, onClick: () => setShowGoogleLabels((v) => !v), title: 'Подписи, дороги и ориентиры поверх снимка' },
              { icon: Building2, label: 'Здания', on: showBuildings, onClick: () => setShowBuildings((v) => !v), title: 'Контуры зданий и сооружений' },
              { icon: TrainTrack, label: 'Ж/д пути', on: showExtRails, onClick: () => setShowExtRails((v) => !v), title: 'Ж/д пути и кандидаты на переезды' },
              { icon: Ruler, label: 'Высота проезда', on: showClearances, onClick: () => setShowClearances((v) => !v), title: 'Отметки ограничения высоты (тоннели, трубы над дорогой)' },
              { icon: Footprints, label: 'Пешеходки', on: showFootways, onClick: () => setShowFootways((v) => !v), title: 'Пешеходные дорожки и переходы' },
              { icon: Pentagon, label: 'Области', on: showAreas, onClick: () => setShowAreas((v) => !v), title: 'Наши области и площадки' },
              { icon: CloudRain, label: 'Погода', on: showWeather, onClick: () => setShowWeather((v) => !v), title: 'Радар осадков' },
            ]}
          />
          <LayerToggle icon={Satellite} label="Глонасс" on={glonassOpen} onClick={() => setGlonassOpen(!glonassOpen)} title="Спутниковый мониторинг транспорта — поиск/слежение машин" />
          <VehicleFilter active={activeVehicle} onChange={setActiveVehicle} />
          <LegendMenu />
          <PointsFilter
            warehouses={warehousesOnMap}
            activeWarehouses={activeWarehouses}
            activeCategories={activeCategories}
            filterActive={filterActive}
            onWarehousesChange={setActiveWarehouses}
            onCategoriesChange={setActiveCategories}
            crossings={doc.crossings ?? []}
            onPickCrossing={(id) => {
              const c = (doc.crossings ?? []).find((x) => x.id === id);
              if (!c) return;
              setTool('select');
              setSelection({ type: 'crossing', id });
              setFocus({ latlng: { lat: c.lat, lng: c.lng }, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) });
            }}
          />
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
              roadIssues={roadIssues}
              showAreas={showAreas}
              routePath={routeResult?.path ?? null}
              routeBlocked={routeResult?.passesBlocked ?? false}
              showWeather={showWeather}
              weatherNonce={weatherNonce}
              weatherField={weatherField}
              weatherNow={weather}
              movingPointId={moveByMapPointId}
              activeVehicle={activeVehicle}
              showGoogleLabels={showGoogleLabels}
              buildings={buildings}
              extRailways={extRailways}
              footways={footways}
              crossingCandidates={crossingCandidates}
              onConfirmCandidate={handleConfirmCandidate}
              onDismissCandidate={handleDismissCandidate}
              onCreateRestriction={handleCreateRestriction}
              onEraseSuggestionTrace={handleEraseSuggestionTrace}
              onEraseRoadAccessTrace={handleEraseRoadAccessTrace}
              onBeginBrushEdit={beginBrushEdit}
              onCommitBrushEdit={commitBrushEdit}
              glonassMarkers={glonassMarkers}
              glonassRoadSnapIndex={roadSnapIndex}
              glonassFollowTargets={glonassFollowTargets}
              glonassFollowIds={glonassFollowIds}
              glonassTracks={glonassTrackLines}
              glonassHistoryTracks={glonassHistoryLines}

              showGlonassPro={showGlonassPro}
              glonassReplayMarker={glonassReplayMarker}
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
              onCreateCrossing={handleCreateCrossing}
              onCreateClearance={handleCreateClearance}
              showClearances={showClearances}
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

          {/* Редактор: полупрозрачный как зум/поворот; при раскрытии — полный opacity. */}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                const next = !editorToolsOpen;
                setEditorToolsOpen(next);
                if (!next) setTool('select');
              }}
              title="Редактор карты"
              className={cn(
                'absolute right-3 top-3 z-[453] flex h-9 w-9 items-center justify-center rounded-xl border shadow-[0_10px_28px_rgba(0,0,0,0.42)] outline-none transition-all duration-200',
                editorToolsOpen
                  ? 'border-accent-clay/60 bg-accent-clay/15 text-accent-clay opacity-100'
                  : 'border-border-default bg-bg-elevated text-text-muted opacity-[0.72] hover:border-accent-clay/50 hover:bg-bg-hover hover:text-text-strong hover:opacity-100',
              )}
            >
              <Pencil size={16} strokeWidth={1.8} />
            </button>
          )}
          {canEdit && editorToolsOpen && (
            <MapToolStrip
              tool={tool}
              suggestionsLoading={suggestionsLoading}
              roadSuggestionCount={doc.roadSuggestions.length}
              canUndo={canUndoBrush}
              canRedo={canRedoBrush}
              onUndo={undoBrushEdit}
              onRedo={redoBrushEdit}
              onOpenRoadQuality={() => setRoadQualityOpen(true)}
              onClose={() => {
                setEditorToolsOpen(false);
                setTool('select');
              }}
              onLoadRoadSuggestions={() => void handleLoadRoadSuggestions()}
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

          {canEdit && roadQualityOpen && (
            <RoadQualityPanel
              quality={roadQuality}
              preview={roadNormalizationPreview}
              mergePreview={roadMergePreview}
              lastNormalization={lastNormalization}
              lastMerge={lastMerge}
              onNormalize={handleNormalizeRoadNetwork}
              onMergeOverlaps={handleMergeRoadOverlaps}
              onClose={() => setRoadQualityOpen(false)}
            />
          )}

          {/* Компактное окно настройки участка «Ограничение дороги» */}
          {restrictDraft && (
            <RestrictionDialog onSave={saveRestriction} onCancel={cancelRestriction} />
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

          {/* Чип сводки погоды (когда слой включён). При открытом Глонассе
              уезжает вправо на weatherLeftPx (динамическая ширина панели). */}
          {showWeather && <WeatherChip weather={weather} shifted={glonassOpen} />}

          {/* Панель «Глонасс» (поиск/выбор машин) */}
          <GlonassPanel onFocusVehicle={handleFocusGlonassVehicle} />

          <GlonassHistoryChips shiftLeft={showFullCard ? 370 : 0} />
          <GlonassHistoryPlayer onFocus={handleFocusHistoryPoint} pointsOverride={activeReplayPoints} />

          {/* Поповер-карточка у пина (краткая) + кнопка «Подробно» */}
          {showPinPopover && selectedPoint && pointScreen && (
            <PinPopover
              x={pointScreen.x}
              y={pointScreen.y}
              title={selectedPoint.warehouseId ? `Склад ${selectedPoint.warehouseId}` : (selectedPoint.label.trim() || 'Точка')}
              subtitle={selectedWarehouse?.shop_name ?? selectedPoint.comment.trim() ?? ''}
              category={categoryOfPoint(selectedPoint.warehouseId)}
              onDetails={() => setDetailExpanded(true)}
              onWarehouseCard={selectedPoint.warehouseId
                ? () => setWarehouseCardId(selectedPoint.warehouseId)
                : null}
              onClose={() => setSelection(null)}
            />
          )}

          {/* Полная карточка-плитка деталей — поверх карты в правом верхнем углу */}
          {showFullCard && selection && (
            <div className="absolute right-3 top-3 z-[460] flex max-h-[calc(100%-1.5rem)] w-[358px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border-default bg-bg-deep shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
              <MapDetailPanel
                selection={selection}
                canEdit={canEdit}
                onClose={() => setSelection(null)}
                onSelect={setSelection}
                onFocus={(latlng) => setFocus({ latlng, nonce: Date.now(), zoom: Math.max(NTMK_ZOOM, 17.4) })}
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
                onShowWarehouseCard={setWarehouseCardId}
              />
            </div>
          )}

          {/* Данные склада (карточка + МОЛы) поверх карты, с прокруткой */}
          {warehouseCardId && (
            <MapWarehouseOverlay
              warehouseId={warehouseCardId}
              onClose={() => setWarehouseCardId(null)}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/** Карандаш: right-3 (12px) + w-9 (36px) + зазор 6px. */
const MAP_PENCIL_RIGHT_INSET = 12;
const MAP_PENCIL_WIDTH = 36;
const MAP_PENCIL_GAP = 6;

function GlonassHistoryChips({ shiftLeft = 0 }: { shiftLeft?: number }) {
  const layers = useGlonassStore((s) => s.historyLayers);
  const activeId = useGlonassStore((s) => s.activeHistoryLayerId);
  const setActive = useGlonassStore((s) => s.setActiveHistoryLayer);
  const toggleVisible = useGlonassStore((s) => s.toggleHistoryVisibility);
  const removeLayer = useGlonassStore((s) => s.removeHistoryLayer);

  if (layers.length === 0) return null;

  const chipsRight = shiftLeft + MAP_PENCIL_RIGHT_INSET + MAP_PENCIL_WIDTH + MAP_PENCIL_GAP;

  return (
    <div
      className="pointer-events-none absolute top-3 z-[454] flex max-h-[min(420px,calc(100%-5rem))] flex-col items-end gap-1 overflow-y-auto"
      style={{ right: `${chipsRight}px` }}
    >
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={cn(
            'pointer-events-auto flex h-9 max-w-[220px] items-center gap-0.5 overflow-hidden rounded-lg border bg-bg-surface/95 pl-1.5 pr-0.5 text-[10.5px] text-text-secondary shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm',
            activeId === layer.id ? 'border-accent-clay/50 text-text-strong' : 'border-border-subtle/80',
          )}
        >
          <button
            type="button"
            onClick={() => setActive(layer.id)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left outline-none transition-colors hover:bg-bg-hover"
            title={layer.subtitle || layer.title}
          >
            <span className="h-2 w-4 shrink-0 rounded-full" style={{ backgroundColor: layer.color }} />
            <span className="min-w-0 truncate font-medium tabular-nums">{layer.title}</span>
          </button>
          <button
            type="button"
            title={layer.visible ? 'Скрыть' : 'Показать'}
            onClick={() => toggleVisible(layer.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          <button
            type="button"
            title="Удалить"
            onClick={() => removeLayer(layer.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-rose-500/18 hover:text-rose-200"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function GlonassHistoryPlayer({
  onFocus,
  pointsOverride,
}: {
  onFocus: (point: GlonassHistoryPoint) => void;
  pointsOverride?: GlonassHistoryPoint[];
}) {
  const layers = useGlonassStore((s) => s.historyLayers);
  const activeId = useGlonassStore((s) => s.activeHistoryLayerId);
  const playbackIndex = useGlonassStore((s) => s.playbackIndex);
  const playbackPlaying = useGlonassStore((s) => s.playbackPlaying);
  const playbackSpeed = useGlonassStore((s) => s.playbackSpeed);
  const setPlaybackIndex = useGlonassStore((s) => s.setPlaybackIndex);
  const setPlaybackPlaying = useGlonassStore((s) => s.setPlaybackPlaying);
  const setPlaybackSpeed = useGlonassStore((s) => s.setPlaybackSpeed);
  const [followPlayback, setFollowPlayback] = useState(false);
  const [playbackDirection, setPlaybackDirection] = useState<1 | -1>(1);

  const layer = useMemo(() => (
    layers.find((item) => item.id === activeId && item.kind === 'replay') ?? null
  ), [layers, activeId]);
  const points = useMemo(() => pointsOverride ?? flattenHistoryLayer(layer), [layer, pointsOverride]);
  const maxIndex = Math.max(0, points.length - 1);
  const index = Math.min(Math.max(0, playbackIndex), maxIndex);
  const point = points[index] ?? null;
  const window = useMemo(() => historyTimelineWindow(layer, points), [layer, points]);
  const virtualTimeRef = useRef<number>(point ? Date.parse(point.time) : NaN);
  useEffect(() => {
    if (!playbackPlaying) virtualTimeRef.current = point ? Date.parse(point.time) : NaN;
  }, [point?.time, playbackPlaying, layer?.id]);

  useEffect(() => {
    setFollowPlayback(false);
  }, [layer?.id]);

  useEffect(() => {
    if (!PLAYBACK_SPEEDS.some((speed) => speed === playbackSpeed)) setPlaybackSpeed(1);
  }, [playbackSpeed, setPlaybackSpeed]);

  useEffect(() => {
    if (followPlayback && point) onFocus(point);
  }, [followPlayback, point?.lat, point?.lng, point?.time, onFocus]);

  useEffect(() => {
    if (!playbackPlaying || points.length < 2) return;
    let lastTick = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - lastTick);
      lastTick = now;
      const current = Number.isFinite(virtualTimeRef.current)
        ? virtualTimeRef.current
        : Date.parse(points[Math.min(index, points.length - 1)]?.time ?? '');
      const nextTime = current + elapsed * playbackSpeed * playbackDirection;
      virtualTimeRef.current = nextTime;
      const nextIndex = findHistoryIndexAt(points, nextTime);
      setPlaybackIndex(nextIndex);
      if ((playbackDirection > 0 && nextIndex >= points.length - 1) || (playbackDirection < 0 && nextTime <= window.startMs)) {
        setPlaybackPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playbackPlaying, playbackSpeed, playbackDirection, points, index, window.startMs, setPlaybackIndex, setPlaybackPlaying]);

  useEffect(() => {
    if (playbackIndex !== index) setPlaybackIndex(index);
  }, [index, playbackIndex, setPlaybackIndex]);

  const [speedOpen, setSpeedOpen] = useState(false);

  if (!layer || points.length < 2 || !point) return null;

  const pointMoving = historyPointMoving(point.speed);

  const dateParts = formatHistoryPointDateParts(point.time);

  return (
    <div className="absolute bottom-3 left-[188px] right-3 z-[450] rounded-xl border border-border-subtle/90 bg-bg-surface/95 px-3 py-2 text-text-primary shadow-[0_10px_32px_rgba(0,0,0,0.38)] backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-max min-w-[108px] shrink-0 flex-col justify-between border-r border-border-subtle/45 pr-3">
          <div className="leading-tight">
            <p className="whitespace-nowrap text-[10.5px] font-medium tracking-[-0.01em] text-text-muted">
              {dateParts.dayMonth}
            </p>
            {dateParts.year ? (
              <p className="whitespace-nowrap text-[9.5px] font-medium tabular-nums tracking-[-0.01em] text-text-muted/70">
                {dateParts.year}
              </p>
            ) : null}
          </div>
          <div className="leading-none">
            <p className="font-mono text-[13px] font-semibold tabular-nums tracking-[-0.02em] text-text-strong">
              {formatHistoryPointClock(point.time)}
            </p>
            <p className={cn('mt-0.5 whitespace-nowrap text-[9px] font-medium tabular-nums', pointMoving ? 'text-emerald-300' : 'text-rose-300')}>
              {formatGlonassSpeed(point.speed)}
            </p>
          </div>
        </div>

        <DayTimeline
          className="min-w-0 flex-1"
          points={points}
          index={index}
          startMs={window.startMs}
          endMs={window.endMs}
          onPick={(targetMs) => {
            setPlaybackPlaying(false);
            virtualTimeRef.current = targetMs;
            setPlaybackIndex(findHistoryIndexAt(points, targetMs));
          }}
        />

        <HistoryPlaybackControls
          className="shrink-0"
          playbackPlaying={playbackPlaying}
          followPlayback={followPlayback}
          playbackSpeed={playbackSpeed}
          speedOpen={speedOpen}
          onSpeedOpenChange={setSpeedOpen}
          onRewind={() => { setPlaybackDirection(-1); setPlaybackPlaying(true); }}
          onTogglePlay={() => {
            if (!playbackPlaying) setPlaybackDirection(1);
            setPlaybackPlaying(!playbackPlaying);
          }}
          onForward={() => { setPlaybackDirection(1); setPlaybackPlaying(true); }}
          onToggleFollow={() => {
            const next = !followPlayback;
            setFollowPlayback(next);
            if (next) onFocus(point);
          }}
          onPickSpeed={setPlaybackSpeed}
        />
      </div>
    </div>
  );
}

const historyBarBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong';

function HistoryPlaybackControls({
  className,
  playbackPlaying,
  followPlayback,
  playbackSpeed,
  speedOpen,
  onSpeedOpenChange,
  onRewind,
  onTogglePlay,
  onForward,
  onToggleFollow,
  onPickSpeed,
}: {
  className?: string;
  playbackPlaying: boolean;
  followPlayback: boolean;
  playbackSpeed: number;
  speedOpen: boolean;
  onSpeedOpenChange: (open: boolean) => void;
  onRewind: () => void;
  onTogglePlay: () => void;
  onForward: () => void;
  onToggleFollow: () => void;
  onPickSpeed: (speed: number) => void;
}) {
  return (
    <div className={cn('flex h-8 items-stretch overflow-hidden rounded-[10px] border border-border-subtle/90 bg-bg-elevated', className)}>
      <button type="button" title="Назад" onClick={onRewind} className={historyBarBtn}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        title={playbackPlaying ? 'Пауза' : 'Воспроизвести'}
        onClick={onTogglePlay}
        className={cn(historyBarBtn, 'w-9 border-x border-border-subtle/70 bg-sky-500/12 text-sky-200 hover:bg-sky-500/20 hover:text-sky-100')}
      >
        {playbackPlaying ? <Pause className="h-3.5 w-3.5" strokeWidth={2} /> : <Play className="h-3.5 w-3.5 translate-x-px" strokeWidth={2} />}
      </button>
      <button type="button" title="Вперёд" onClick={onForward} className={historyBarBtn}>
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <span className="w-px shrink-0 self-stretch bg-border-subtle/80" />
      <button
        type="button"
        title={followPlayback ? 'Слежение вкл.' : 'Следить за машиной'}
        onClick={onToggleFollow}
        className={cn(
          historyBarBtn,
          followPlayback && 'bg-accent-clay-bg text-accent-clay hover:bg-accent-clay-bg hover:text-accent-clay',
        )}
      >
        <Crosshair className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <span className="w-px shrink-0 self-stretch bg-border-subtle/80" />
      <Popover.Root open={speedOpen} onOpenChange={onSpeedOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            title="Скорость воспроизведения"
            className={cn(
              'flex h-8 w-9 shrink-0 items-center justify-center font-mono text-[10.5px] font-semibold tabular-nums outline-none transition-colors',
              speedOpen ? 'bg-bg-hover text-text-strong' : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
            )}
          >
            {playbackSpeed === 1 ? '1×' : `${playbackSpeed}×`}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={6}
            className="z-[700] max-h-52 w-[72px] overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1 shadow-[0_10px_32px_rgba(0,0,0,0.45)] outline-none"
          >
            {PLAYBACK_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => {
                  onPickSpeed(speed);
                  onSpeedOpenChange(false);
                }}
                className={cn(
                  'flex h-7 w-full items-center justify-center rounded-md font-mono text-[11px] font-semibold tabular-nums outline-none transition-colors',
                  speed === playbackSpeed
                    ? 'bg-sky-500/16 text-sky-200'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                {speed === 1 ? '1×' : `${speed}×`}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const HISTORY_CHART_MOVING = '#34D399';
const HISTORY_CHART_STOPPED = '#F87171';
const HISTORY_CHART_Y_MIN = 3;
const HISTORY_CHART_Y_MAX = 21;
const HISTORY_CHART_VIEW_H = 24;

/** > 3 км/ч — движение (как в glonass-store); иначе стоянка / ровный участок. */
function historyPointMoving(speed: number | null | undefined): boolean {
  return (speed ?? 0) > 3;
}

function DayTimeline({
  className,
  points,
  index,
  startMs,
  endMs,
  onPick,
}: {
  className?: string;
  points: GlonassHistoryPoint[];
  index: number;
  startMs: number;
  endMs: number;
  onPick: (timeMs: number) => void;
}) {
  const chart = useMemo(() => buildSpeedChart(points, index, startMs, endMs), [points, index, startMs, endMs]);
  const pick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const rawMs = startMs + ratio * (endMs - startMs);
    onPick(Math.min(endMs, Math.max(startMs, rawMs)));
  };
  if (!chart) return null;
  const cursorStroke = chart.cursorMoving ? HISTORY_CHART_MOVING : HISTORY_CHART_STOPPED;
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Шкала движения"
        aria-valuetext={formatTimeOfDay(startMs + (chart.cursorX / 100) * (endMs - startMs))}
        onClick={pick}
        className="relative h-10 cursor-crosshair overflow-hidden rounded-[10px] border border-border-subtle/70 bg-bg-elevated/80 outline-none transition-colors hover:border-sky-300/35"
      >
        <svg
          viewBox={`0 0 100 ${HISTORY_CHART_VIEW_H}`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-0 h-7 w-full"
        >
          {chart.segments.map((segment, i) => (
            <polyline
              key={i}
              points={segment.points}
              fill="none"
              stroke={segment.moving ? HISTORY_CHART_MOVING : HISTORY_CHART_STOPPED}
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={chart.cursorX}
            x2={chart.cursorX}
            y1={HISTORY_CHART_Y_MIN}
            y2={HISTORY_CHART_Y_MAX}
            stroke="rgba(255,255,255,.78)"
            strokeWidth="0.6"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={chart.cursorX}
            cy={chart.cursorY}
            r="1.45"
            fill={cursorStroke}
            stroke="rgba(255,255,255,.92)"
            strokeWidth="0.45"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <DayTimelineTicks startMs={startMs} endMs={endMs} />
      </div>
    </div>
  );
}

function DayTimelineTicks({ startMs, endMs }: { startMs: number; endMs: number }) {
  const labels = useMemo(() => {
    const span = Math.max(1, endMs - startMs);
    const steps = span <= 20 * 60_000 ? 4 : span <= 2 * 3_600_000 ? 5 : 6;
    return Array.from({ length: steps }, (_, i) => {
      const ratio = i / (steps - 1);
      const ms = startMs + ratio * span;
      return { ratio, text: formatTimeOfDay(ms), edge: i === 0 ? 'start' as const : i === steps - 1 ? 'end' as const : 'mid' as const };
    });
  }, [startMs, endMs]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[15px]">
      <div className="absolute inset-0 bg-gradient-to-t from-bg-elevated/98 via-bg-elevated/72 to-transparent" />
      <div className="relative h-full px-2">
        {labels.map((label) => (
          <span
            key={label.ratio}
            className={cn(
              'absolute bottom-1 font-mono text-[7.5px] tabular-nums leading-none text-text-muted/75',
              label.edge === 'start' && 'left-2 translate-x-0',
              label.edge === 'end' && 'right-2 translate-x-0',
              label.edge === 'mid' && '-translate-x-1/2',
            )}
            style={label.edge === 'mid' ? { left: `${label.ratio * 100}%` } : undefined}
          >
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function findHistoryIndexAt(points: GlonassHistoryPoint[], timeMs: number): number {
  if (points.length === 0) return 0;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const t = Date.parse(points[mid]?.time ?? '');
    if (Number.isFinite(t) && t <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, Math.min(points.length - 1, lo));
}

function buildSpeedChart(
  points: GlonassHistoryPoint[],
  index: number,
  startMs: number,
  endMs: number,
): { segments: Array<{ points: string; moving: boolean }>; cursorX: number; cursorY: number; cursorMoving: boolean } | null {
  if (points.length < 2) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const maxSpeed = Math.max(1, ...points.map((p) => p.speed ?? 0));
  const sample = sampleHistoryPoints(points, 120);
  const chartSpan = HISTORY_CHART_Y_MAX - HISTORY_CHART_Y_MIN;
  const xy = (p: GlonassHistoryPoint) => {
    const t = Date.parse(p.time);
    const x = Math.min(100, Math.max(0, ((t - startMs) / (endMs - startMs)) * 100));
    const norm = Math.min(1, Math.max(0, (p.speed ?? 0) / maxSpeed));
    const y = HISTORY_CHART_Y_MAX - norm * chartSpan;
    return { x, y };
  };
  const format = (p: GlonassHistoryPoint) => {
    const { x, y } = xy(p);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };

  const segments: Array<{ points: string; moving: boolean }> = [];
  let segMoving = historyPointMoving(sample[0]?.speed);
  let coords = [format(sample[0]!)];
  for (let i = 1; i < sample.length; i += 1) {
    const p = sample[i]!;
    const moving = historyPointMoving(p.speed);
    const coord = format(p);
    if (moving !== segMoving) {
      coords.push(coord);
      if (coords.length >= 2) segments.push({ points: coords.join(' '), moving: segMoving });
      segMoving = moving;
      coords = [coord];
    } else {
      coords.push(coord);
    }
  }
  if (coords.length >= 2) segments.push({ points: coords.join(' '), moving: segMoving });

  const currentPoint = points[Math.min(Math.max(0, index), points.length - 1)]!;
  const current = xy(currentPoint);
  return {
    segments,
    cursorX: current.x,
    cursorY: current.y,
    cursorMoving: historyPointMoving(currentPoint.speed),
  };
}

function sampleHistoryPoints(points: GlonassHistoryPoint[], max: number): GlonassHistoryPoint[] {
  if (points.length <= max) return points;
  const out: GlonassHistoryPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    out.push(points[Math.round(i * step)]!);
  }
  return out;
}

function formatHistoryPointDateParts(value: string): { dayMonth: string; year: string | null } {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { dayMonth: '—', year: null };
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  const year = date.getFullYear() !== new Date().getFullYear() ? String(date.getFullYear()) : null;
  return { dayMonth, year };
}

function formatHistoryPointClock(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatTimeOfDay(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function historyTimelineWindow(_layer: GlonassHistoryLayer | null, points: GlonassHistoryPoint[]): { startMs: number; endMs: number } {
  if (points.length >= 2) {
    const firstMs = Date.parse(points[0]!.time);
    const lastMs = Date.parse(points[points.length - 1]!.time);
    if (Number.isFinite(firstMs) && Number.isFinite(lastMs) && lastMs > firstMs) {
      const span = lastMs - firstMs;
      const pad = Math.max(30_000, Math.round(span * 0.015));
      return { startMs: firstMs - pad, endMs: lastMs + pad };
    }
  }
  const firstMs = Date.parse(points[0]?.time ?? '');
  if (Number.isFinite(firstMs)) return { startMs: firstMs - 60_000, endMs: firstMs + 60_000 };
  const now = Date.now();
  return { startMs: now - 60_000, endMs: now + 60_000 };
}

function courseAt(points: GlonassHistoryPoint[], index: number): number | null {
  const current = points[index];
  if (!current) return null;
  const next = points[index + 1];
  if (next && distanceBetweenHistoryPoints(current, next) > 1) return bearingBetween(current, next);
  const prev = points[index - 1];
  if (prev && distanceBetweenHistoryPoints(prev, current) > 1) return bearingBetween(prev, current);
  return null;
}

function bearingBetween(a: GlonassHistoryPoint, b: GlonassHistoryPoint): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distanceBetweenHistoryPoints(a: GlonassHistoryPoint, b: GlonassHistoryPoint): number {
  const r = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function replayAnimationMs(pointGapMs: number, speed: number): number {
  if (!Number.isFinite(pointGapMs) || pointGapMs <= 0 || !Number.isFinite(speed) || speed <= 0) return 1400;
  return Math.max(180, Math.min(15_000, pointGapMs / speed));
}

function lastTrackPoint(segments: LatLng[][]): LatLng | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    const point = segment[segment.length - 1];
    if (point) return point;
  }
  return null;
}

function lastTrackSegment(segments: LatLng[][]): LatLng[] | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (segment.length >= 2) return segment;
  }
  return null;
}

// ─── Панель инструментов карты ────────────────────────────────────────────────

const TOOL_OPTIONS: Array<{ id: MapTool; label: string; icon: typeof MapPin }> = [
  { id: 'select', label: 'Выбор', icon: MousePointer2 },
  { id: 'point', label: 'Точка (пин)', icon: MapPin },
  { id: 'area', label: 'Площадка / область (полигон)', icon: Pentagon },
  { id: 'road', label: 'Дорога (рисовать)', icon: Route },
  { id: 'eraseRoad', label: 'Ластик дорог — зажмите ЛКМ и ведите', icon: Eraser },
  { id: 'confirmRoad', label: 'Подтвердить красную дорогу', icon: CheckCheck },
  { id: 'eraseSuggestion', label: 'Ластик красных — зажмите ЛКМ и ведите', icon: Scissors },
  { id: 'restrict', label: 'Ограничение дороги — проведите по дороге, затем Enter', icon: Ban },
  { id: 'eraseAccess', label: 'Ластик ограничений — зажмите ЛКМ и ведите', icon: Eraser },
  { id: 'crossing', label: 'Ж/д переезд (поставить вручную)', icon: TrainTrack },
  { id: 'clearance', label: 'Высота проезда — клик по дороге (тоннель/труба)', icon: Ruler },
  { id: 'optimize', label: 'Оптимум', icon: Crosshair },
];

function RoadQualityPanel({
  quality,
  preview,
  mergePreview,
  lastNormalization,
  lastMerge,
  onNormalize,
  onMergeOverlaps,
  onClose,
}: {
  quality: RoadNetworkQuality;
  preview: RoadNormalizationReport | null;
  mergePreview: { merge: RoadMergeReport; welds: number } | null;
  lastNormalization: RoadNormalizationReport | null;
  lastMerge: RoadOverlapMergeSummary | null;
  onNormalize: () => void;
  onMergeOverlaps: () => void;
  onClose: () => void;
}) {
  const mergeWork = mergePreview
    ? mergePreview.merge.roadsAbsorbed + mergePreview.merge.roadsTrimmed + mergePreview.welds
    : 0;
  const virtualEdges = quality.virtualTouchEdges + quality.virtualOverlapEdges + quality.virtualWeldEdges;
  return (
    <div className="absolute right-16 top-14 z-[454] w-[320px] rounded-xl border border-border-default bg-bg-elevated p-3 shadow-[0_18px_54px_rgba(0,0,0,0.52)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-text-strong">Дорожная сеть</div>
          <div className="mt-0.5 text-[10.5px] text-text-muted">Проверка перед маршрутизацией</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-secondary" title="Закрыть">
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <QualityRow label="Жёлтых линий" value={String(quality.roads)} />
        <QualityRow label="Длина" value={`${quality.totalLengthKm.toFixed(1)} км`} />
        <QualityRow label="Строгих частей" value={String(quality.strictComponents)} warn={quality.strictComponents > 1} />
        <QualityRow label="Скрытых мостов" value={String(virtualEdges)} warn={virtualEdges > 0} />
        <QualityRow label="Огрызков < 3 м" value={String(quality.shortRoadsUnder3m)} warn={quality.shortRoadsUnder3m > 0} />
        <QualityRow label="Точек > 30 м" value={String(quality.pointsOver30m)} warn={quality.pointsOver30m > 0} />
      </div>

      <div className={cn(
        'mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-[16px]',
        quality.routingReady
          ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-200'
          : 'border-amber-400/25 bg-amber-400/8 text-amber-100',
      )}>
        {quality.routingReady
          ? `Все ${quality.points} рабочих точек лежат в одной строгой части сети.`
          : `Рабочие точки используют ${quality.operationalComponents} несвязанные части сети.`}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-rose-400" /> близкий стык</span>
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-purple-400" /> параллельное место</span>
        <span>Это подсказки, не дороги.</span>
      </div>

      {preview && (
        <div className="mt-3 rounded-lg border border-border-subtle bg-bg-surface px-2.5 py-2 text-[10.5px] leading-[16px] text-text-secondary">
          Безопасный прогон: добавить {preview.addedConnectorRoads} явных соединения, изменить форму старых линий на 0 м,
          частей станет {preview.strictComponentsAfter}. Неоднозначные параллельные места останутся на ручную проверку.
        </div>
      )}

      {lastNormalization && (
        <div className="mt-2 text-[10.5px] text-emerald-300">
          Выполнено. Можно отменить кнопкой ↶ в редакторе.
        </div>
      )}

      <button
        type="button"
        onClick={onNormalize}
        disabled={!preview || (preview.addedConnectorRoads === 0 && preview.changedRoads === 0)}
        className="mt-3 flex h-8 w-full items-center justify-center rounded-lg border border-accent-clay/45 bg-accent-clay/12 text-[11px] font-medium text-accent-clay transition-colors hover:bg-accent-clay/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Нормализовать безопасно
      </button>

      {mergePreview && (
        <div className="mt-3 rounded-lg border border-border-subtle bg-bg-surface px-2.5 py-2 text-[10.5px] leading-[16px] text-text-secondary">
          Палка-на-палку: поглотить {mergePreview.merge.roadsAbsorbed} двойников, пришить {mergePreview.merge.roadsTrimmed} хвостов
          (−{Math.round(mergePreview.merge.metersRemoved)} м наложений), впаять {mergePreview.welds} швов-развилок.
        </div>
      )}

      {lastMerge && (
        <div className="mt-2 text-[10.5px] text-emerald-300">
          Слито. Частей сети: {lastMerge.norm.strictComponentsAfter}. Отмена — кнопкой ↶ в редакторе.
        </div>
      )}

      <button
        type="button"
        onClick={onMergeOverlaps}
        disabled={mergeWork === 0}
        className="mt-2 flex h-8 w-full items-center justify-center rounded-lg border border-purple-400/45 bg-purple-400/12 text-[11px] font-medium text-purple-300 transition-colors hover:bg-purple-400/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Слить наложения (палка-на-палку)
      </button>
    </div>
  );
}

function QualityRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="contents">
      <span className="text-text-muted">{label}</span>
      <span className={cn('text-right font-medium', warn ? 'text-amber-300' : 'text-text-secondary')}>{value}</span>
    </div>
  );
}

/**
 * Вертикальная панель инструментов поверх карты: активная кнопка ПОДСВЕЧЕНА
 * (ТЗ 2026-07-09). Внизу — загрузка красного пунктира по видимой области и
 * его полная очистка («подгрузил, отрисовал и убрал как помощника»).
 */
function MapToolStrip({
  tool,
  suggestionsLoading,
  roadSuggestionCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenRoadQuality,
  onChange,
  onClose,
  onLoadRoadSuggestions,
  onClearRoadSuggestions,
}: {
  tool: MapTool;
  suggestionsLoading: boolean;
  roadSuggestionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenRoadQuality: () => void;
  onChange: (tool: MapTool) => void;
  onClose: () => void;
  onLoadRoadSuggestions: () => void;
  onClearRoadSuggestions: () => void;
}) {
  return (
    <div className="absolute right-3 top-14 z-[452] flex flex-col items-center gap-0.5 rounded-xl border border-border-default bg-bg-elevated p-1 shadow-[0_16px_44px_rgba(0,0,0,0.44)]">
      {TOOL_OPTIONS.map((item) => {
        const active = item.id === tool;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            title={item.label}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg outline-none transition-colors',
              active
                ? 'bg-accent-clay text-white shadow-[0_0_0_1px_rgba(232,131,107,0.55),0_0_12px_rgba(232,131,107,0.35)]'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary',
            )}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
        );
      })}
      <div className="my-0.5 h-px w-full bg-border-subtle" />
      <button
        type="button"
        onClick={onOpenRoadQuality}
        title="Проверить качество дорожной сети"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-amber-300/90 outline-none transition-colors hover:bg-amber-400/10 hover:text-amber-200"
      >
        <Network size={15} strokeWidth={1.8} />
      </button>
      <div className="my-0.5 h-px w-full bg-border-subtle" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Отменить последнее изменение карты"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Undo2 size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Повторить последний штрих ластика"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Redo2 size={15} strokeWidth={1.8} />
      </button>
      <div className="my-0.5 h-px w-full bg-border-subtle" />
      <button
        type="button"
        onClick={onLoadRoadSuggestions}
        disabled={suggestionsLoading}
        title="Загрузить возможные дороги (красный пунктир) по видимой области"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg text-red-300/80 outline-none transition-colors hover:bg-red-400/10 hover:text-red-300',
          suggestionsLoading && 'animate-pulse cursor-wait',
        )}
      >
        <Route size={15} strokeWidth={1.8} />
      </button>
      {roadSuggestionCount > 0 && (
        <button
          type="button"
          onClick={onClearRoadSuggestions}
          title={`Убрать весь красный пунктир (${roadSuggestionCount})`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-red-400/10 hover:text-red-300"
        >
          <Trash2 size={15} strokeWidth={1.8} />
        </button>
      )}
      <div className="my-0.5 h-px w-full bg-border-subtle" />
      <button
        type="button"
        onClick={onClose}
        title="Скрыть редактор"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <X size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/** Легенда — справочник обозначений (кнопка в шапке, поповер как «Вид»). */
function LegendMenu() {
  const items: Array<{ key: string; label: string; swatch: ReactNode }> = [
    {
      key: 'roads',
      label: 'Машины (наши дороги)',
      swatch: <span className="inline-block h-[3px] w-6 shrink-0 rounded-full bg-[#FFC83D]" />,
    },
    {
      key: 'buildings',
      label: 'Здания (справочно)',
      swatch: <span className="inline-block h-2.5 w-6 shrink-0 rounded-sm border border-[#C4B5FD]/60 bg-[#A78BFA]/25" />,
    },
    ...ROAD_ACCESS_KIND_META.map((meta) => ({
      key: meta.id,
      label: meta.label,
      swatch: <span className="inline-block h-[3px] w-6 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />,
    })),
    {
      key: 'rails',
      label: 'Ж/д путь',
      swatch: <span className="inline-block h-[3px] w-6 shrink-0 rounded-full" style={{ background: 'repeating-linear-gradient(90deg,#111827 0 3px,#D1D5DB 3px 6px)' }} />,
    },
    {
      key: 'footway',
      label: 'Пешеходная дорожка',
      swatch: <span className="inline-block h-[2px] w-6 shrink-0 rounded-full bg-[#38BDF8]" />,
    },
    {
      key: 'crosswalk',
      label: 'Пешеходный переход',
      swatch: <span className="inline-block h-[4px] w-6 shrink-0 rounded-sm" style={{ background: 'repeating-linear-gradient(90deg,#38BDF8 0 3px,transparent 3px 5px)' }} />,
    },
    {
      key: 'suggestions',
      label: 'Возможные дороги',
      swatch: <span className="inline-block h-[3px] w-6 shrink-0 rounded-full" style={{ background: 'repeating-linear-gradient(90deg,#EF4444 0 4px,transparent 4px 7px)' }} />,
    },
  ];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Легенда карты — что каким цветом нарисовано"
          className="flex h-6 items-center gap-1 rounded-md border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary data-[state=open]:border-accent-clay/55 data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay"
        >
          <List size={13} strokeWidth={1.75} />
          Легенда
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-[700] w-60 rounded-lg border border-border-default bg-bg-elevated p-2 shadow-[0_16px_44px_rgba(0,0,0,0.44)] outline-none"
        >
          <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Обозначения на карте
          </p>
          <div className="space-y-0.5">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] leading-snug text-text-secondary"
              >
                {item.swatch}
                <span className="min-w-0 flex-1">{item.label}</span>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Компактное окно настройки участка «Ограничение дороги»: свободна / ограничена
 * (типы ТС разрешены или запрещены) / закрыта / временно закрыта (+даты).
 * Одна дорожная линия хранит правила участка — отдельные дороги не рисуются.
 */
function RestrictionDialog({ onSave, onCancel }: {
  onSave: (fields: Partial<RoadAccess>) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RoadAccessKind>('limited');
  const [vehiclesByPurpose, setVehiclesByPurpose] = useState(allVehiclesByPurpose);
  const [closedFrom, setClosedFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [closedTo, setClosedTo] = useState('');
  const [note, setNote] = useState('');

  const save = () => {
    onSave({
      kind,
      vehicles: [],
      vehiclesMode: 'allow',
      vehiclesByPurpose: kind === 'limited' ? vehiclesByPurpose : {},
      note,
      closedFrom: kind === 'closed' || kind === 'temp_closed' ? closedFrom : '',
      closedTo: kind === 'temp_closed' ? closedTo : '',
    });
  };

  return (
    <div className="absolute inset-0 z-[478] flex items-center justify-center bg-black/25" onClick={onCancel}>
      <div
        className="w-[340px] max-w-[calc(100%-2rem)] rounded-xl border border-border-default bg-bg-deep/97 p-3 shadow-[0_12px_44px_rgba(0,0,0,0.6)] backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-text-strong">Участок дороги</p>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted outline-none hover:bg-bg-hover hover:text-text-strong"
          ><X size={14} strokeWidth={1.75} /></button>
        </div>

        <div className="space-y-1">
          {ROAD_ACCESS_KIND_META.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setKind(m.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors',
                kind === m.id ? 'border-white/30 bg-white/10 text-text-strong' : 'border-border-subtle text-text-secondary hover:bg-bg-hover',
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="flex-1">{m.label}</span>
              {kind === m.id && <Check size={13} strokeWidth={2} />}
            </button>
          ))}
        </div>

        {kind === 'limited' && (
          <div className="mt-2">
            <p className="mb-1 text-[10.5px] leading-snug text-text-muted">
              Галочка разрешает типу ТС этот участок для выбранного назначения. Заголовок столбца включает или снимает все типы.
            </p>
            <div className="max-h-52 overflow-y-auto pr-0.5">
              <VehiclePurposeAccessGrid value={vehiclesByPurpose} onChange={setVehiclesByPurpose} />
            </div>
          </div>
        )}

        {(kind === 'closed' || kind === 'temp_closed') && (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-text-muted">Закрыто с</span>
              <input
                type="date"
                value={closedFrom}
                onChange={(e) => setClosedFrom(e.target.value)}
                className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12px] text-text-primary outline-none focus:border-accent-clay/40"
              />
            </label>
            {kind === 'temp_closed' && (
              <label className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-text-muted">По (открытие)</span>
                <input
                  type="date"
                  value={closedTo}
                  onChange={(e) => setClosedTo(e.target.value)}
                  className="w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12px] text-text-primary outline-none focus:border-accent-clay/40"
                />
              </label>
            )}
          </div>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Заметка: особенности проезда (необязательно)"
          className="mt-2 w-full resize-none rounded border border-border-default bg-bg-surface px-2 py-1 text-[12px] text-text-primary outline-none focus:border-accent-clay/40"
        />

        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded border border-border-subtle px-3 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
          >Отмена</button>
          <button
            type="button"
            onClick={save}
            className="h-7 rounded border border-accent-clay/60 bg-accent-clay-bg px-3 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/15"
          >Сохранить участок</button>
        </div>
      </div>
    </div>
  );
}

/** Меню «Вид»: все справочные/визуальные слои в одном компактном месте. */
function ViewMenu({ items }: {
  items: Array<{ icon: typeof MapPin; label: string; on: boolean; onClick: () => void; title: string }>;
}) {
  const activeCount = items.filter((item) => item.on).length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Слои карты"
          className="flex h-6 items-center gap-1 rounded-md border border-border-subtle px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-secondary data-[state=open]:border-accent-clay/55 data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay"
        >
          <SlidersHorizontal size={13} strokeWidth={1.75} />
          Вид
          <span className="ml-0.5 rounded bg-bg-hover px-1 text-[10px] tabular-nums text-text-muted">{activeCount}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-[700] w-56 rounded-lg border border-border-default bg-bg-elevated p-1.5 shadow-[0_16px_44px_rgba(0,0,0,0.44)] outline-none"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                title={item.title}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md border px-2 text-left text-[12px] outline-none transition-colors',
                  item.on
                    ? 'border-accent-clay/45 bg-accent-clay-bg text-accent-clay'
                    : 'border-transparent text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                )}
              >
                <Icon size={13} strokeWidth={1.75} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.on ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Маленький тумблер слоя в шапке (Глонасс оставляем быстрым действием). */
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

/** Фильтр точек: категория + склады + отдельный поиск по № ж/д пути (переезды). */
function PointsFilter({ warehouses, activeWarehouses, activeCategories, filterActive, onWarehousesChange, onCategoriesChange, crossings, onPickCrossing }: {
  warehouses: string[];
  activeWarehouses: Set<string> | null;
  activeCategories: Set<PointCategory> | null;
  filterActive: boolean;
  onWarehousesChange: (s: Set<string> | null) => void;
  onCategoriesChange: (s: Set<PointCategory> | null) => void;
  crossings: Array<{ id: string; name: string }>;
  onPickCrossing: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [qRail, setQRail] = useState('');
  // Длинный список складов не вываливаем — показываем совпадения ТОЛЬКО при вводе.
  const matches = useMemo(() => {
    const lc = q.trim().toLowerCase();
    if (!lc) return [];
    return warehouses.filter((w) => w.toLowerCase().includes(lc)).slice(0, 8);
  }, [q, warehouses]);
  // Переезды по № ж/д пути — отдельная строка поиска, со складами не мешается.
  const railMatches = useMemo(() => {
    const lc = qRail.trim().toLowerCase();
    if (!lc) return [];
    return crossings
      .filter((c) => c.name.trim() && c.name.trim().toLowerCase().includes(lc))
      .slice(0, 8);
  }, [qRail, crossings]);
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
          <div className="my-1 h-px bg-border-subtle" />
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Ж/д путь (№)</div>
          <input
            value={qRail}
            onChange={(e) => setQRail(e.target.value)}
            placeholder="Найти переезд по № пути…"
            className="mb-1 w-full rounded border border-border-default bg-bg-surface px-2 py-1 text-[12px] text-text-primary outline-none focus:border-accent-clay/40"
          />
          {qRail.trim() !== '' && railMatches.length === 0 && <p className="px-2 py-1 text-[11.5px] text-text-muted">Переезд с таким № пути не найден</p>}
          {railMatches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPickCrossing(c.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-bg-hover"
            >
              <TrainTrack size={12} strokeWidth={1.75} className="shrink-0 text-amber-300" />
              <span className="truncate font-mono tabular-nums text-text-secondary">{c.name}</span>
            </button>
          ))}
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

/** Чип погоды: opacity как у зума/поворота; при открытом попапе — 100% до закрытия. */
function WeatherChip({ weather, shifted = false }: { weather: WeatherSummary | null; shifted?: boolean }) {
  const rows = weather?.hourly.slice(0, 16) ?? [];
  const display = buildWeatherDisplay(weather, rows);
  const weatherLeftPx = useGlonassStore((s) => s.weatherLeftPx);
  const [open, setOpen] = useState(false);
  const grid = 'grid grid-cols-[56px_minmax(74px,1fr)_64px_58px_54px_60px] items-center gap-1.5';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'absolute top-3 z-[450] flex min-h-10 min-w-[238px] max-w-[320px] items-center gap-2 rounded-xl border border-accent-clay/30 bg-bg-elevated px-3 py-2 text-left text-[11.5px] text-text-secondary shadow-[0_10px_34px_rgba(0,0,0,0.58)] outline-none transition-all duration-200 hover:border-accent-clay/50 hover:bg-bg-hover hover:text-text-strong',
            !shifted && 'left-3',
            open ? 'opacity-100' : 'opacity-[0.72] hover:opacity-100',
          )}
          style={shifted ? { left: weatherLeftPx } : undefined}
          title="Погода по часам"
        >
          <CloudRain size={16} strokeWidth={1.8} className={display.isPrecip ? 'shrink-0 text-sky-300' : 'shrink-0 text-text-muted'} />
          {weather ? (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 tabular-nums">
                <span className="font-mono text-[13px] font-semibold text-text-strong">{display.tempC != null ? `${display.tempC > 0 ? '+' : ''}${Math.round(display.tempC)}°` : '—'}</span>
                <span className="min-w-0 max-w-[96px] truncate font-medium text-text-secondary">{display.condition}</span>
                <span className={cn('ml-auto rounded-md px-1.5 py-0.5 font-mono text-[11px]', display.isPrecip ? 'bg-sky-400/12 text-sky-300' : 'bg-bg-surface text-text-muted')}>
                  {display.chance != null ? `${Math.round(display.chance)}%` : '0%'}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] text-text-muted">
                активный участок · {display.precipText} · {display.windMs != null ? `${Math.round(display.windMs)} м/с` : 'ветер —'}
              </span>
            </span>
          ) : (
            <span className="text-text-muted">погода…</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-[700] w-[462px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border-default bg-bg-elevated shadow-[0_12px_42px_rgba(0,0,0,0.58)] outline-none transition-all duration-150"
        >
          <div className="flex items-center justify-between border-b border-border-subtle/70 px-3 py-2">
            <div>
              <p className="text-[12.5px] font-semibold text-text-strong">Погода · активный участок</p>
              <p className="text-[11px] text-text-muted">Время: Екатеринбург · 3 часа назад, сейчас и дальше</p>
            </div>
            <div className="rounded-md border border-border-subtle bg-bg-surface px-2.5 py-1 text-right">
              <p className="font-mono text-[12px] tabular-nums text-text-strong">{display.tempC != null ? `${display.tempC > 0 ? '+' : ''}${Math.round(display.tempC)}°` : '—'}</p>
              <p className="text-[10px] text-text-muted">{display.pressureHpa != null ? `${Math.round(display.pressureHpa)} гПа` : display.condition}</p>
            </div>
          </div>
          <div className={cn(grid, 'border-b border-border-subtle/60 px-3 py-1.5 text-[10px] uppercase text-text-muted')}>
            <span>Время</span>
            <span>Тип</span>
            <span>Осадок</span>
            <span className="text-right">Ветер</span>
            <span className="text-right">Темп.</span>
            <span className="text-right">Шанс</span>
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {rows.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-text-muted">Почасовой прогноз загружается…</p>
            ) : rows.map((row) => {
              const current = row.time.slice(0, 13) === display.currentKey;
              const past = display.currentKey ? row.time.slice(0, 13) < display.currentKey : false;
              return (
                <div
                  key={row.time}
                  className={cn(
                    grid,
                    'box-border w-full rounded-lg px-2 py-1.5 text-[12px] transition-colors hover:bg-bg-hover/70',
                    current && 'bg-sky-400/12 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.34)]',
                    past && !current && 'text-text-muted',
                  )}
                >
                  <WeatherTimeLabel time={row.time} current={current} />
                  <span className="min-w-0 truncate text-text-secondary">{weatherText(row.code, row.precipMm, row.snowCm)}</span>
                  <span className="whitespace-nowrap font-mono tabular-nums text-text-muted">{formatPrecipShort(row)}</span>
                  <span className="whitespace-nowrap text-right font-mono tabular-nums text-text-muted" title={row.windDir != null ? `Направление ${Math.round(row.windDir)}°` : undefined}>
                    {row.windMs != null ? `${Math.round(row.windMs)} м/с` : '—'}
                  </span>
                  <span className="whitespace-nowrap text-right font-mono tabular-nums text-text-secondary">
                    {row.tempC != null ? `${row.tempC > 0 ? '+' : ''}${Math.round(row.tempC)}°` : '—'}
                  </span>
                  <span className="whitespace-nowrap text-right font-mono tabular-nums text-text-muted">{row.precipProb != null ? `${Math.round(row.precipProb)}%` : '—'}</span>
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function buildWeatherDisplay(weather: WeatherSummary | null, rows: WeatherHour[]): WeatherDisplay {
  const currentKey = weather?.currentTime?.slice(0, 13) ?? rows.find((row) => isSameEkaterinburgHour(row.time))?.time.slice(0, 13) ?? '';
  const row = rows.find((item) => item.time.slice(0, 13) === currentKey) ?? rows[0] ?? null;
  const precipMm = row?.precipMm ?? weather?.precipMm ?? null;
  const condition = weatherText(row?.code ?? weather?.code ?? null, precipMm, row?.snowCm ?? null);
  const precipText = formatPrecipShort(row, weather?.precipMm ?? null);
  const chance = row?.precipProb ?? null;
  return {
    currentKey,
    row,
    condition,
    tempC: row?.tempC ?? weather?.tempC ?? null,
    windMs: row?.windMs ?? weather?.windMs ?? null,
    precipText,
    chance,
    isPrecip: (precipMm ?? 0) > 0 || (row?.snowCm ?? 0) > 0 || Boolean(weather?.isPrecip),
    pressureHpa: weather?.pressureHpa ?? null,
  };
}

function WeatherTimeLabel({ time, current }: { time: string; current: boolean }) {
  if (current) return <span className="font-semibold text-sky-200">Сейчас</span>;
  const { hour, period } = splitWeatherHour(time);
  return (
    <span className="whitespace-nowrap font-mono tabular-nums text-text-strong">
      {hour}
      <span className="ml-0.5 align-[1px] text-[9px] font-semibold text-text-muted">{period}</span>
    </span>
  );
}

function splitWeatherHour(value: string): { hour: string; period: string } {
  const m = /T(\d{2}):/.exec(value);
  if (!m) return { hour: value.slice(-5), period: '' };
  const hour = Number(m[1]);
  if (!Number.isFinite(hour)) return { hour: value.slice(-5), period: '' };
  const h12 = hour % 12 || 12;
  return { hour: String(h12), period: hour < 12 ? 'AM' : 'PM' };
}

function formatPrecipShort(row: WeatherHour | null, fallbackMm: number | null = null): string {
  if (row) {
    if ((row.snowCm ?? 0) > 0) return `${row.snowCm!.toFixed(1)} см`;
    if ((row.rainMm ?? 0) > 0) return `${row.rainMm!.toFixed(1)} мм`;
    if ((row.precipMm ?? 0) > 0) return `${row.precipMm!.toFixed(1)} мм`;
  }
  if ((fallbackMm ?? 0) > 0) return `${fallbackMm!.toFixed(1)} мм`;
  return '0';
}

function isSameEkaterinburgHour(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(value);
  if (!m) return false;
  const ekb = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part = (type: string) => ekb.find((p) => p.type === type)?.value ?? '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}` === `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
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

/** Краткий поповер у пина: склад, цех, «Подробнее», карточка склада. */
function PinPopover({ x, y, title, subtitle, category, onDetails, onWarehouseCard, onClose }: {
  x: number; y: number; title: string; subtitle: string; category: PointCategory;
  onDetails: () => void;
  /** null — у точки нет склада, кнопку не показываем. */
  onWarehouseCard: (() => void) | null;
  onClose: () => void;
}) {
  const cat = POINT_CATEGORY_META.find((c) => c.id === category) ?? POINT_CATEGORY_META[2]!;
  return (
    <div
      className="absolute z-[455] w-[232px] -translate-x-1/2 -translate-y-full rounded-xl border border-border-default bg-bg-deep/95 px-3 py-2.5 shadow-[0_10px_32px_rgba(0,0,0,0.48)] backdrop-blur-md"
      style={{ left: x, top: y - 48 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-text-strong">{title}</p>
          {subtitle && <p className="mt-0.5 truncate text-[11px] text-text-muted">{subtitle}</p>}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium" style={{ backgroundColor: `${cat.color}22`, color: cat.color }}>{cat.label}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDetails}
          className="h-7 flex-1 rounded-lg border border-accent-clay/40 bg-accent-clay-bg/80 px-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/15"
        >Подробнее</button>
        {onWarehouseCard && (
          <button
            type="button"
            onClick={onWarehouseCard}
            title="Карточка склада и МОЛы"
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-emerald-400/30 px-2 text-[11px] text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
          >
            <Warehouse size={12} strokeWidth={1.75} />
            <span>Склад</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-border-default bg-bg-deep/95" />
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
