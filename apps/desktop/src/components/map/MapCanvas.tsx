import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Copy, LocateFixed } from 'lucide-react';
import { getWarehouseState, type Warehouse } from '@pyn/core';
import { cn } from '@/lib/cn';
import { useWarehousesStore } from '@/lib/warehouses-store';
import {
  NTMK_CENTER,
  NTMK_ZOOM,
  ROAD_ACCESS_FALLBACK_COLOR,
  formatClearanceMeters,
  roadAccessKindMeta,
  roadAccessSummary,
  vehicleColor,
  type BuildingOutline,
  type CrossingCandidate,
  type ExternalRailway,
  type FootwayLine,
  type LatLng,
  type MapArea,
  type MapClearance,
  type MapCrossing,
  type MapDoc,
  type MapPoint,
  type MapRailway,
  type MapRoad,
  type MapRoadSuggestion,
  type MapTool,
  type RoadAccess,
  type VehicleType,
} from './map-types';
import type { OptimizeResult } from './optimize';
import { STATUS_COLOR, STATUS_LABEL, formatGlonassSpeed, type GlonassMarker, type GlonassReplayMarker, type GlonassTimedPathPoint } from './glonass-store';
import { computeFastestRoute, isAccessBlocking } from './route-network';
import { distanceMeters, nearestPointOnPolyline } from './geo';
import type { RoadNetworkIssue } from './road-quality';
import { snapToRoadIndex, type RoadSnapIndex } from './glonass-snap';

/** Текущее положение оптимума + «призрак» (что-если), что рисуем поверх карты. */
export interface OptimizeOverlay {
  /** Склад, который оптимизируем (его текущая точка). */
  source: LatLng;
  /** Точки спроса (куда возим) — рисуем лучи. */
  demand: LatLng[];
  result: OptimizeResult | null;
  /** Перетаскиваемый «призрак» — пользователь сам двигает, видит %. */
  ghost: LatLng | null;
}

export interface WeatherFieldPoint {
  lat: number;
  lng: number;
  windMs: number | null;
  windDir: number | null;
  gustMs: number | null;
  precipMm: number | null;
  code: number | null;
  pressureHpa: number | null;
}

export interface WeatherNow {
  windMs: number | null;
  precipMm: number | null;
  code?: number | null;
  isPrecip?: boolean;
}

export interface MapSelection {
  type: 'point' | 'area' | 'road' | 'roadSuggestion' | 'roadAccess' | 'crossing' | 'railway' | 'clearance';
  id: string;
}

interface MapCanvasProps {
  doc: MapDoc;
  tool: MapTool;
  /** Можно ли редактировать карту (developer). Иначе — только просмотр. */
  canEdit: boolean;
  /** null = все точки видимы; иначе — только эти id. */
  visiblePointIds: Set<string> | null;
  selection: MapSelection | null;
  showRoadSuggestions: boolean;
  showRoadAccess: boolean;
  /** Кандидаты скрытых связей — видимы только при открытой проверке сети. */
  roadIssues: RoadNetworkIssue[];
  /** Показ НАШИХ областей/площадок (полигоны + подписи). */
  showAreas: boolean;
  routePath: LatLng[] | null;
  /** Маршрут задевает запрещённый для машины участок — рисуем его тревожно. */
  routeBlocked: boolean;
  /** Показывать радар осадков (RainViewer). */
  showWeather: boolean;
  /** Нонс кадра радара — меняется → пересоздаём слой осадков (свежий кадр). */
  weatherNonce: number;
  /** Лёгкая сетка ветра/давления по видимой области. */
  weatherField: WeatherFieldPoint[];
  /** Текущая сводка по центру/площадке — для мягкой погодной вуали. */
  weatherNow: WeatherNow | null;
  movingPointId: string | null;
  /** Выбранная машина «куда проедет» — подсвечиваем доступные точки, гасим прочие. */
  activeVehicle: VehicleType | null;
  /** Гугл-слой (подписи/дороги/ориентиры lyrs=h) — справочный, тумблером. */
  showGoogleLabels: boolean;
  /** Контуры зданий (OSM) — лёгкий фиолетовый слой, эфемерный (не в документе). */
  buildings: BuildingOutline[];
  /** Внешние ж/д пути (OSM) — справочный слой для кандидатов на переезд. */
  extRailways: ExternalRailway[];
  /** Пешеходные дорожки и переходы (OSM) — справочный слой. */
  footways: FootwayLine[];
  /** Кандидаты на ж/д переезд (пересечения внешних ж/д с нашими дорогами). */
  crossingCandidates: CrossingCandidate[];
  onConfirmCandidate: (candidate: CrossingCandidate) => void;
  onDismissCandidate: (candidate: CrossingCandidate) => void;
  /** «Ограничение дороги»: Enter по выделенному участку → окно правил (в MapScreen). */
  onCreateRestriction: (parts: LatLng[][]) => void;
  /** Ластик красного пунктира: сегмент кисти → срезать возможные дороги. */
  onEraseSuggestionTrace: (vertices: LatLng[], radiusMeters: number) => void;
  /** Ластик окрашенных ограничений/особенностей участка. */
  onEraseRoadAccessTrace: (vertices: LatLng[], radiusMeters: number) => void;
  onBeginBrushEdit: () => void;
  onCommitBrushEdit: () => void;
  /** Машины ГЛОНАСС (выбранные для слежения) с позицией — рисуем поверх карты. */
  glonassMarkers: GlonassMarker[];
  /** Общий неизменяемый индекс жёлтой сети для финальной live-проекции. */
  glonassRoadSnapIndex: RoadSnapIndex;
  /** id машин под слежением (несколько сразу). */
  glonassFollowIds?: ReadonlySet<number>;
  /** Статичные цели слежения (без timedPath); живые ведёт rAF. */
  glonassFollowTargets: LatLng[];
  /** Live-следы выбранных машин, накопленные из realtime-опроса. */
  glonassTracks: Array<{ id: string; color: string; points?: LatLng[]; segments?: LatLng[][]; mode: 'pro' | 'raw' }>;
  /** Исторические маршруты/годовые следы ГЛОНАСС. */
  glonassHistoryTracks: Array<{ id: string; color: string; points?: LatLng[]; segments?: LatLng[][]; opacity: number; mode: 'pro' | 'raw' }>;
  /** Управляет только линией PRO; маркер всегда продолжает движение по PRO-пути. */
  showGlonassPro: boolean;
  /** Текущая машина исторического проигрывателя. */
  glonassReplayMarker: GlonassReplayMarker | null;
  onSelect: (sel: MapSelection | null) => void;
  onCreatePoint: (latlng: LatLng) => void;
  onMovePoint: (id: string, latlng: LatLng) => void;
  onCreateArea: (vertices: LatLng[]) => void;
  onCreateRoad: (vertices: LatLng[]) => void;
  onEraseRoadTrace: (vertices: LatLng[], radiusMeters: number) => void;
  onConfirmRoadTrace: (vertices: LatLng[]) => void;
  onCreateCrossing: (latlng: LatLng) => void;
  /** «Высота проезда»: клик по дороге (точка прилипает к линии) → карточка. */
  onCreateClearance: (latlng: LatLng) => void;
  /** Показ отметок «Высота проезда» (слой в «Виде», по умолчанию скрыт). */
  showClearances: boolean;
  onCreateRailway: (vertices: LatLng[]) => void;
  onStartMovePointByMap: (id: string) => void;
  onFinishMovePointByMap: (id: string, latlng: LatLng) => void;
  onCancelMovePointByMap: () => void;
  /** Копировать точку (из контекст-меню правой кнопки). */
  onDuplicatePoint: (id: string) => void;
  /** Esc в режиме инструмента — выйти в «Выбор» (курсор перестаёт «носить» инструмент). */
  onCancelTool: () => void;
  optimizeOverlay: OptimizeOverlay | null;
  onGhostMove: (latlng: LatLng) => void;
  /** Текущая видимая область карты (для подгрузки дорог «по экрану»). */
  onBoundsChange?: (bbox: { south: number; west: number; north: number; east: number }) => void;
  /** Экранная позиция выбранной точки (для поповера-карточки у пина). null — нет. */
  onSelectedPointScreen?: (pos: { x: number; y: number } | null) => void;
  /** Точка, на которую навестись (из «Цеха»); меняется → центрируем. */
  focusLatLng: LatLng | null;
  focusZoom?: number;
  focusNonce: number;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: unknown };
  }>;
};

interface ViewMetrics {
  center: LatLng;
  zoom: number;
  metersPerPixel: number;
  /** Поворот карты в градусах (0 = север вверху). */
  bearing: number;
}

const GOOGLE_TILE_URL = 'pyn-tile://google/{z}/{x}/{y}';
const ESRI_TILE_URL = 'pyn-tile://esri/{z}/{x}/{y}';
const DEFAULT_CENTER: [number, number] = [NTMK_CENTER.lng, NTMK_CENTER.lat];
const DEFAULT_ZOOM = NTMK_ZOOM;
const EMPTY_FEATURES: FeatureCollection = { type: 'FeatureCollection', features: [] };
const CONFIRM_TRACE_SNAP_METERS = 12;
const CONFIRM_TRACE_MIN_GAP_METERS = 2.4;
const FREEHAND_ROAD_MIN_GAP_METERS = 2.2;
const ROAD_DRAW_SNAP_METERS = 6;
const VEHICLE_TRACE_SNAP_METERS = 24; // кисть «указание дороги» — прощаем неточность, липнем к дороге
const VEHICLE_TRACE_MIN_GAP_METERS = 1.8;
const VEHICLE_TRACE_ROUTE_FACTOR = 2.1;
const VEHICLE_TRACE_ROUTE_EXTRA_METERS = 12;
/** Далёкий несвязный штрих ограничения — начинаем НОВОЕ выделение (без диагонали). */
const VEHICLE_TRACE_RESTART_METERS = 30;
/** Ховер-подсветка «Ограничения»: полдлины отрезка дороги под курсором. */
const RESTRICT_HOVER_HALF_METERS = 9;
const ROAD_RENDER_CORNER_RADIUS_METERS = 0;
const ROUTE_RENDER_CORNER_RADIUS_METERS = 6;
const ACCESS_RENDER_CORNER_RADIUS_METERS = 6;
const TRACK_RENDER_CORNER_RADIUS_METERS = 0;
const WEATHER_PARTICLES = Array.from({ length: 46 }, (_, index) => ({
  id: index,
  left: (index * 19 + 7) % 101,
  top: -18 - ((index * 11) % 44),
  delay: -((index * 0.37) % 6.4),
  duration: 4.2 + ((index * 0.23) % 3.8),
  scale: 0.72 + ((index * 13) % 31) / 100,
}));

type WeatherFlowKind = 'clear' | 'rain' | 'snow' | 'hail' | 'wind';

interface WeatherFlowState {
  kind: WeatherFlowKind;
  intensity: number;
  windMs: number;
  windToDeg: number;
}

type GlonassMarkerEntry = {
  marker: Marker;
  frame: number | null;
  targetAt: number | null;
};

type GlonassReplayMarkerEntry = GlonassMarkerEntry & { id: string };

const GLONASS_MARKER_ANIMATION_MS = 12_000;
const GLONASS_MARKER_JUMP_METERS = 900;

export function MapCanvas({
  doc,
  tool,
  canEdit,
  visiblePointIds,
  selection,
  showRoadSuggestions,
  showRoadAccess,
  roadIssues,
  showAreas,
  routePath,
  routeBlocked,
  showWeather,
  weatherNonce,
  weatherField,
  weatherNow,
  movingPointId,
  activeVehicle,
  showGoogleLabels,
  buildings,
  extRailways,
  footways,
  crossingCandidates,
  onConfirmCandidate,
  onDismissCandidate,
  onCreateRestriction,
  onEraseSuggestionTrace,
  onEraseRoadAccessTrace,
  onBeginBrushEdit,
  onCommitBrushEdit,
  glonassMarkers,
  glonassRoadSnapIndex,
  glonassFollowIds,
  glonassFollowTargets,
  glonassTracks,
  glonassHistoryTracks,
  showGlonassPro,
  glonassReplayMarker,
  onSelect,
  onCreatePoint,
  onMovePoint,
  onCreateArea,
  onCreateRoad,
  onEraseRoadTrace,
  onConfirmRoadTrace,
  onCreateCrossing,
  onCreateClearance,
  showClearances,
  onCreateRailway,
  onStartMovePointByMap,
  onFinishMovePointByMap,
  onCancelMovePointByMap,
  onDuplicatePoint,
  onCancelTool,
  optimizeOverlay,
  onGhostMove,
  onBoundsChange,
  onSelectedPointScreen,
  focusLatLng,
  focusZoom,
  focusNonce,
}: MapCanvasProps) {
  const warehouses = useWarehousesStore((s) => s.byId);
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<Marker[]>([]);
  const glonassMarkerRefs = useRef<Map<number, GlonassMarkerEntry>>(new Map());
  const glonassReplayRef = useRef<GlonassReplayMarkerEntry | null>(null);
  const draftRef = useRef<LatLng[]>([]);
  const restrictPartsRef = useRef<LatLng[][]>([]);
  const roadsRef = useRef(doc.roads);
  const roadSuggestionsRef = useRef(doc.roadSuggestions);
  const showRoadSuggestionsRef = useRef(showRoadSuggestions);
  const prevToolRef = useRef<MapTool>(tool);
  const skipAutoCommitRef = useRef(false);
  const roadDrawingRef = useRef(false);
  const eraseDrawingRef = useRef(false);
  const accessEraseDrawingRef = useRef(false);
  const suggestionEraseDrawingRef = useRef(false);
  const restrictDrawingRef = useRef(false);
  const railwayDrawingRef = useRef(false);
  const shiftRef = useRef(false); // зажат Shift — линия идёт ПРЯМО к курсору
  const confirmDrawingRef = useRef(false);
  /** Предыдущая точка кисти ластика — стираем ЖИВЬЁМ по сегментам, пока ведём. */
  const erasePrevRef = useRef<LatLng | null>(null);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [restrictParts, setRestrictParts] = useState<LatLng[][]>([]);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  /** Ховер по участку-ограничению: подсветка вдоль линии + краткая подсказка. */
  const [hoverAccess, setHoverAccess] = useState<{ id: string; x: number; y: number } | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [viewMetrics, setViewMetrics] = useState<ViewMetrics | null>(null);
  const [pointMenu, setPointMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;
  const movingPoint = movingPointId ? doc.points.find((p) => p.id === movingPointId) ?? null : null;
  roadsRef.current = doc.roads;
  roadSuggestionsRef.current = doc.roadSuggestions;
  showRoadSuggestionsRef.current = showRoadSuggestions;

  useEffect(() => {
    const el = elRef.current;
    if (!el || mapRef.current) return;

    const map = new maplibregl.Map({
      container: el,
      style: googleRasterStyle() as maplibregl.StyleSpecification,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 3,
      maxZoom: 20,
      attributionControl: false,
      // Карта вращается (как в Google): тащим правой кнопкой / Ctrl+ЛКМ / двумя
      // пальцами. Наклон (pitch) оставляем выключенным — для логистики плоский
      // вид удобнее, спутник не размазывается у горизонта.
      dragRotate: true,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 120,
      refreshExpiredTiles: false,
      maxTileCacheSize: 1200,
      maxTileCacheZoomLevels: 5,
      cancelPendingTileRequestsWhileZooming: false,
      localIdeographFontFamily: 'Inter, Arial, sans-serif',
    });

    map.dragRotate.enable();
    map.touchZoomRotate.enable();
    map.keyboard.enable();
    tuneScrollZoom(map);

    mapRef.current = map;
    const reportBounds = () => {
      const b = map.getBounds();
      onBoundsChangeRef.current?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    };
    const onLoad = () => {
      ensureOverlayLayers(map);
      setStyleReady(true);
      setViewMetrics(readViewMetrics(map));
      reportBounds();
      map.resize();
    };
    map.once('load', onLoad);
    const onViewChange = () => setViewMetrics(readViewMetrics(map));
    map.on('move', onViewChange);
    map.on('zoom', onViewChange);
    map.on('rotate', onViewChange);
    map.on('resize', onViewChange);
    map.on('moveend', reportBounds);
    map.on('zoomend', reportBounds);

    return () => {
      clearGlonassReplayEntry(glonassReplayRef);
      clearGlonassMarkerEntries(glonassMarkerRefs.current);
      clearMarkers(markerRefs.current);
      markerRefs.current = [];
      setStyleReady(false);
      map.off('move', onViewChange);
      map.off('zoom', onViewChange);
      map.off('rotate', onViewChange);
      map.off('resize', onViewChange);
      map.off('moveend', reportBounds);
      map.off('zoomend', reportBounds);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    restrictPartsRef.current = restrictParts;
  }, [restrictParts]);

  const appendConfirmTracePoint = useCallback((raw: LatLng) => {
    // Режим подтверждения: НИЧЕГО нового не рисуем — берём только точки, лежащие
    // на красной линии. Курсор вне красной — пропускаем (отдельно от «своей дороги»).
    const snapped = snapToRoadSuggestions(raw, showRoadSuggestionsRef.current ? roadSuggestionsRef.current : [], CONFIRM_TRACE_SNAP_METERS);
    if (!snapped) return;
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (prev && distanceMeters(prev, snapped) < CONFIRM_TRACE_MIN_GAP_METERS) return points;
      return [...points, snapped];
    });
  }, []);

  const appendFreehandRoadPoint = useCallback((p: LatLng) => {
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (prev && distanceMeters(prev, p) < FREEHAND_ROAD_MIN_GAP_METERS) return points;
      return [...points, p];
    });
  }, []);

  const appendVehicleTracePoint = useCallback((raw: LatLng) => {
    // «Особенности»/«Ограничение» обводят кусок СУЩЕСТВУЮЩЕЙ дороги — берём
    // только точки на дороге (выделение идёт именно вдоль линии).
    const roads = roadsRef.current;
    const snapped = snapToRoads(raw, roads, VEHICLE_TRACE_SNAP_METERS);
    if (!snapped) return;
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (!prev) return [snapped];
      const direct = distanceMeters(prev, snapped);
      if (direct < VEHICLE_TRACE_MIN_GAP_METERS) return points;
      const route = computeFastestRoute(roads, prev, snapped);
      const routeOk = route
        && route.path.length >= 2
        && route.distanceMeters <= Math.max(
          VEHICLE_TRACE_ROUTE_EXTRA_METERS + 8,
          direct * VEHICLE_TRACE_ROUTE_FACTOR + VEHICLE_TRACE_ROUTE_EXTRA_METERS,
        );
      // Штрихи копятся до Enter; но далёкий несвязный тычок — это НОВОЕ выделение,
      // а не диагональ через полкарты к прежнему.
      if (!routeOk && direct > VEHICLE_TRACE_RESTART_METERS) return [snapped];
      const segment = routeOk ? route.path.slice(1) : [snapped];
      const next = [...points];
      for (const p of segment) {
        const last = next[next.length - 1]!;
        if (distanceMeters(last, p) > 0.35) next.push(p);
      }
      return next;
    });
  }, []);

  /** Живой ластик: пока ведём с зажатой ЛКМ — стираем сегмент за сегментом.
   *  Радиус реза = видимый кружок кисти на ТЕКУЩЕМ зуме («что видишь — то и
   *  стираешь», как в Paint): приблизился — режешь тоньше и точнее. */
  const eraseLive = useCallback((raw: LatLng, mode: 'road' | 'access' | 'suggestion') => {
    const map = mapRef.current;
    const radius = map ? eraseBrushRadiusMeters(map) : 6;
    const prev = erasePrevRef.current;
    erasePrevRef.current = raw;
    const segment = prev ? [prev, raw] : [raw];
    if (mode === 'road') onEraseRoadTrace(segment, radius);
    else if (mode === 'access') onEraseRoadAccessTrace(segment, radius);
    else onEraseSuggestionTrace(segment, radius);
    // Короткий хвост-след для наглядности кисти (не копим всю трассу).
    setDraft((points) => [...points.slice(-7), raw]);
  }, [onEraseRoadTrace, onEraseRoadAccessTrace, onEraseSuggestionTrace]);

  const finishDraft = useCallback((mode: MapTool = tool, vertices: LatLng[] = draftRef.current) => {
    if (mode === 'area' && vertices.length >= 3) {
      skipAutoCommitRef.current = true;
      onCreateArea(vertices);
    }
    if (mode === 'road' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRoad(vertices);
    }
    if (mode === 'railway' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRailway(vertices);
    }
    if (mode === 'confirmRoad' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onConfirmRoadTrace(vertices);
    }
    if (mode === 'restrict') {
      const parts = [...restrictPartsRef.current];
      if (vertices.length >= 2) parts.push(vertices);
      if (parts.length === 0) return;
      // Enter по выделенному участку → окно правил. Выделение НЕ сбрасываем —
      // оно остаётся подсвеченным, пока настраивается участок (ТЗ 2026-07-09).
      skipAutoCommitRef.current = true;
      restrictDrawingRef.current = false;
      mapRef.current?.dragPan.enable();
      onCreateRestriction(parts);
      return;
    }
    // Ластики стирают живьём по ходу кисти — тут только чистим след.
    roadDrawingRef.current = false;
    eraseDrawingRef.current = false;
    accessEraseDrawingRef.current = false;
    suggestionEraseDrawingRef.current = false;
    restrictDrawingRef.current = false;
    railwayDrawingRef.current = false;
    confirmDrawingRef.current = false;
    erasePrevRef.current = null;
    mapRef.current?.dragPan.enable();
    setDraft([]);
  }, [tool, onCreateArea, onCreateRoad, onCreateRailway, onConfirmRoadTrace, onCreateRestriction]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const p = toLatLng(e.lngLat);
      if (tool === 'point') {
        onCreatePoint(p);
      } else if (tool === 'crossing') {
        onCreateCrossing(p);
      } else if (tool === 'clearance') {
        // Отметка высоты живёт НА дороге: клик рядом прилипает к её линии.
        onCreateClearance(snapToRoads(p, roadsRef.current, 15) ?? p);
      } else if (tool === 'area') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        setDraft((d) => [...d, p]);
      } else if (tool === 'road') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        roadDrawingRef.current = true;
        map.dragPan.disable();
        appendFreehandRoadPoint(snapToRoads(p, roadsRef.current, ROAD_DRAW_SNAP_METERS) ?? p);
      } else if (tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion' || tool === 'restrict') {
        // Кисти на зажатой ЛКМ — вся работа в mousedown/mousemove/mouseup.
        return;
      } else if (tool === 'railway') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        railwayDrawingRef.current = true;
        map.dragPan.disable();
        appendFreehandRoadPoint(p);
      } else if (tool === 'confirmRoad') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        confirmDrawingRef.current = true;
        map.dragPan.disable();
        appendConfirmTracePoint(p);
      } else if (tool === 'optimize') {
        onGhostMove(p);
      } else {
        // Безопасность: по нарисованной дороге клик НЕ выбирает её (нельзя случайно
        // удалить) — дороги правятся только через меню «Управление». Кликом
        // выбираем точки/области/особенности/черновик/переезды.
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ['map-road-access-hit', 'map-railways-hit', 'map-road-suggestions-hit'],
        })[0];
        const id = hit?.properties?.id;
        const kind = hit?.properties?.kind;
        if (kind === 'roadAccess' && typeof id === 'string') {
          onSelect({ type: 'roadAccess', id });
        } else if (kind === 'railway' && typeof id === 'string') {
          onSelect({ type: 'railway', id });
        } else if (kind === 'roadSuggestion' && typeof id === 'string') {
          onSelect({ type: 'roadSuggestion', id });
        } else {
          // Область левым кликом НЕ выбирается — клик проходит «сквозь» неё к
          // точкам/участкам под ней. Область правится ПРАВОЙ кнопкой (contextmenu).
          onSelect(null);
        }
      }
    };
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      if (tool !== 'area' && tool !== 'road' && tool !== 'railway' && tool !== 'confirmRoad' && tool !== 'restrict') return;
      e.preventDefault();
      finishDraft();
    };
    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent as MouseEvent).button !== 0) return;
      if (tool === 'confirmRoad') {
        e.preventDefault();
        map.dragPan.disable();
        return;
      }
      // Кисти на зажатой ЛКМ: ластик дорог / ластик ограничений / ластик красных / ограничение дороги.
      if (tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion') {
        e.preventDefault();
        map.dragPan.disable();
        onBeginBrushEdit();
        const raw = toLatLng(e.lngLat);
        erasePrevRef.current = null;
        if (tool === 'eraseRoad') {
          eraseDrawingRef.current = true;
          eraseLive(raw, 'road');
        } else if (tool === 'eraseAccess') {
          accessEraseDrawingRef.current = true;
          eraseLive(raw, 'access');
        } else {
          suggestionEraseDrawingRef.current = true;
          eraseLive(raw, 'suggestion');
        }
        return;
      }
      if (tool === 'restrict') {
        e.preventDefault();
        map.dragPan.disable();
        // Штрихи НАКАПЛИВАЮТСЯ до Enter (ТЗ 2026-07-11): нажал — закрасился
        // подсвеченный отрезок, ведёшь — красится дальше, Enter — окно правил.
        // Сброс — Esc или далёкий несвязный тычок (внутри appendVehicleTracePoint).
        restrictDrawingRef.current = true;
        const at = toLatLng(e.lngLat);
        const stretch = roadStretchNear(at, roadsRef.current, RESTRICT_HOVER_HALF_METERS);
        if (stretch && draftRef.current.length === 0) {
          for (const p of stretch) appendVehicleTracePoint(p);
        } else {
          appendVehicleTracePoint(at);
        }
      }
    };
    const onMouseUp = () => {
      if (tool === 'confirmRoad' && !confirmDrawingRef.current) map.dragPan.enable();
      // Кисти: отпустили ЛКМ → штрих завершён, остаёмся в инструменте.
      if (tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion') {
        eraseDrawingRef.current = false;
        accessEraseDrawingRef.current = false;
        suggestionEraseDrawingRef.current = false;
        erasePrevRef.current = null;
        setDraft([]);
        onCommitBrushEdit();
        map.dragPan.enable();
      }
      if (tool === 'restrict' && restrictDrawingRef.current) {
        const stroke = draftRef.current;
        if (stroke.length >= 2) {
          const next = [...restrictPartsRef.current, stroke];
          restrictPartsRef.current = next;
          setRestrictParts(next);
        }
        setDraft([]);
        restrictDrawingRef.current = false;
        map.dragPan.enable();
      }
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const raw = toLatLng(e.lngLat);
      const current = tool === 'confirmRoad'
        ? snapToRoadSuggestions(raw, showRoadSuggestionsRef.current ? roadSuggestionsRef.current : [], CONFIRM_TRACE_SNAP_METERS) ?? raw
        : tool === 'road'
          ? snapToRoads(raw, roadsRef.current, ROAD_DRAW_SNAP_METERS) ?? raw
        : tool === 'restrict'
          ? snapToRoads(raw, roadsRef.current, VEHICLE_TRACE_SNAP_METERS) ?? raw
          : raw;
      setCursor(current);
      // Зажат Shift → НЕ сыпем точки от руки: тянем прямую к курсору (вершину
      // добавит клик). Без Shift — обычная рисовка от руки.
      if (tool === 'road' && roadDrawingRef.current && !shiftRef.current) appendFreehandRoadPoint(raw);
      if (tool === 'eraseRoad' && eraseDrawingRef.current) eraseLive(raw, 'road');
      if (tool === 'eraseAccess' && accessEraseDrawingRef.current) eraseLive(raw, 'access');
      if (tool === 'eraseSuggestion' && suggestionEraseDrawingRef.current) eraseLive(raw, 'suggestion');
      if (tool === 'railway' && railwayDrawingRef.current && !shiftRef.current) appendFreehandRoadPoint(raw);
      if (tool === 'confirmRoad' && confirmDrawingRef.current) appendConfirmTracePoint(raw);
      if (tool === 'restrict' && restrictDrawingRef.current) appendVehicleTracePoint(raw);
      // Ховер участка-ограничения (в «Выборе»): подсветка + краткая подсказка.
      if (tool === 'select' && map.getLayer('map-road-access-hit')) {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['map-road-access-hit'] })[0];
        const id = hit?.properties?.id;
        if (typeof id === 'string') {
          setHoverAccess({ id, x: e.point.x, y: e.point.y });
        } else {
          setHoverAccess((cur) => (cur ? null : cur));
        }
      } else {
        setHoverAccess((cur) => (cur ? null : cur));
      }
    };
    const onMouseOut = () => {
      setCursor(null);
      setHoverAccess(null);
    };
    // Область правится ТОЛЬКО правой кнопкой (левый клик проходит сквозь неё).
    // Области обычно скрыты — показываются по выбору слоя, тогда и редактируются.
    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      if (tool !== 'select' || !map.getLayer('map-areas-fill')) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ['map-areas-fill'] })[0];
      const id = hit?.properties?.id;
      if (hit?.properties?.kind === 'area' && typeof id === 'string') {
        e.preventDefault();
        onSelect({ type: 'area', id });
      }
    };
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousedown', onMouseDown);
    map.on('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);
    map.on('mousemove', onMove);
    map.on('mouseout', onMouseOut);
    map.on('contextmenu', onContextMenu);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousedown', onMouseDown);
      map.off('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);
      map.off('mousemove', onMove);
      map.off('mouseout', onMouseOut);
      map.off('contextmenu', onContextMenu);
      const brushActive = eraseDrawingRef.current || accessEraseDrawingRef.current || suggestionEraseDrawingRef.current;
      if (brushActive) onCommitBrushEdit();
      roadDrawingRef.current = false;
      eraseDrawingRef.current = false;
      accessEraseDrawingRef.current = false;
      suggestionEraseDrawingRef.current = false;
      restrictDrawingRef.current = false;
      railwayDrawingRef.current = false;
      confirmDrawingRef.current = false;
      erasePrevRef.current = null;
      map.dragPan.enable();
    };
  }, [tool, appendConfirmTracePoint, appendFreehandRoadPoint, appendVehicleTracePoint, eraseLive, finishDraft, onBeginBrushEdit, onCommitBrushEdit, onCreatePoint, onCreateCrossing, onCreateClearance, onGhostMove, onSelect]);

  useEffect(() => {
    const previousTool = prevToolRef.current;
    if (previousTool === tool) return;
    const vertices = draftRef.current;
    const skip = skipAutoCommitRef.current;
    skipAutoCommitRef.current = false;

    if (!skip) {
      if (previousTool === 'road' && vertices.length >= 2) onCreateRoad(vertices);
      if (previousTool === 'railway' && vertices.length >= 2) onCreateRailway(vertices);
      if (previousTool === 'area' && vertices.length >= 3) onCreateArea(vertices);
      if (previousTool === 'confirmRoad' && vertices.length >= 2) onConfirmRoadTrace(vertices);
      // Ластики стирают живьём; restrict коммитится только через Enter+окно.
    }

    setDraft([]);
    draftRef.current = [];
    setRestrictParts([]);
    restrictPartsRef.current = [];
    roadDrawingRef.current = false;
    eraseDrawingRef.current = false;
    accessEraseDrawingRef.current = false;
    suggestionEraseDrawingRef.current = false;
    restrictDrawingRef.current = false;
    railwayDrawingRef.current = false;
    confirmDrawingRef.current = false;
    erasePrevRef.current = null;
    mapRef.current?.dragPan.enable();
    prevToolRef.current = tool;
  }, [tool, onCreateArea, onCreateRoad, onCreateRailway, onConfirmRoadTrace]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === 'area' || tool === 'road' || tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion' || tool === 'restrict' || tool === 'railway' || tool === 'confirmRoad') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [tool]);

  useEffect(() => {
    const onShift = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey; };
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    return () => {
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const brushActive = eraseDrawingRef.current || accessEraseDrawingRef.current || suggestionEraseDrawingRef.current;
        roadDrawingRef.current = false;
        eraseDrawingRef.current = false;
        accessEraseDrawingRef.current = false;
        suggestionEraseDrawingRef.current = false;
        restrictDrawingRef.current = false;
        railwayDrawingRef.current = false;
        confirmDrawingRef.current = false;
        skipAutoCommitRef.current = true; // не коммитить недорисованное при выходе
        mapRef.current?.dragPan.enable();
        setDraft([]);
        setRestrictParts([]);
        restrictPartsRef.current = [];
        if (brushActive) onCommitBrushEdit();
        onCancelMovePointByMap();
        onCancelTool();
      }
      if (e.key === 'Enter' && movingPointId && mapRef.current) {
        e.preventDefault();
        onFinishMovePointByMap(movingPointId, toLatLng(mapRef.current.getCenter()));
        return;
      }
      if (e.key === 'Enter') finishDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finishDraft, movingPointId, onCancelMovePointByMap, onCancelTool, onCommitBrushEdit, onFinishMovePointByMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusLatLng) return;
    map.flyTo({
      center: toCoord(focusLatLng),
      zoom: focusZoom ?? Math.max(map.getZoom(), 17),
      duration: 450,
      essential: true,
    });
  }, [focusLatLng, focusNonce, focusZoom]);

  const visiblePoints = useMemo(() => {
    return doc.points.filter((p) => !visiblePointIds || visiblePointIds.has(p.id));
  }, [doc.points, visiblePointIds]);

  const zoomIn = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: Math.min(map.getMaxZoom(), map.getZoom() + 1), duration: 180, essential: true });
  }, []);

  const zoomOut = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: Math.max(map.getMinZoom(), map.getZoom() - 1), duration: 180, essential: true });
  }, []);

  const resetNorth = useCallback(() => {
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 280, essential: true });
  }, []);

  // Мгновенный зум (ползунок следует за пальцем) и поворот (драг компаса).
  const zoomTo = useCallback((z: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z)));
  }, []);

  const rotateBy = useCallback((deg: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ bearing: map.getBearing() + deg, duration: 200, essential: true });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    setSourceData(map, 'map-areas', showAreas ? buildAreasData(doc.areas, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-railways', buildRailwaysData(doc.railways ?? [], selection));
    setSourceData(map, 'map-roads', buildRoadsData(doc.roads, selection));
    setSourceData(map, 'map-road-issues', buildRoadIssuesData(roadIssues));
    setSourceData(map, 'map-road-suggestions', showRoadSuggestions ? buildRoadSuggestionsData(doc.roadSuggestions, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-road-access', showRoadAccess ? buildRoadAccessData(doc.roadAccess, selection, hoverAccess?.id ?? null, activeVehicle) : EMPTY_FEATURES);
    setSourceData(map, 'map-route', buildRouteData(routePath, routeBlocked));
    setSourceData(map, 'map-opt-rays', buildOptimizeRaysData(optimizeOverlay));

    clearMarkers(markerRefs.current);
    markerRefs.current = [];

    // ⚠-треугольник на закрытых/временно закрытых участках (клик → карточка).
    if (showRoadAccess) {
      for (const access of doc.roadAccess) {
        if (access.kind !== 'closed' && access.kind !== 'temp_closed') continue;
        if (access.vertices.length < 2) continue;
        const el = createAccessWarnElement(access);
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          onSelect({ type: 'roadAccess', id: access.id });
        });
        markerRefs.current.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(toCoord(midpointOfPolyline(access.vertices)))
            .addTo(map),
        );
      }
    }

    // Кандидаты на ж/д переезд (пересечение внешней ж/д с нашей дорогой):
    // видны на карте, подтверждаются ✓ или убираются × вручную.
    for (const candidate of crossingCandidates) {
      const el = createCandidateElement(canEdit);
      if (canEdit) {
        el.querySelector('[data-act="ok"]')?.addEventListener('click', (event) => {
          event.stopPropagation();
          onConfirmCandidate(candidate);
        });
        el.querySelector('[data-act="no"]')?.addEventListener('click', (event) => {
          event.stopPropagation();
          onDismissCandidate(candidate);
        });
      }
      markerRefs.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(toCoord(candidate))
          .addTo(map),
      );
    }

    if (showAreas) {
      for (const area of doc.areas) {
        if (!area.name || area.vertices.length === 0) continue;
        const label = createLabelElement(area.name, area.color);
        markerRefs.current.push(
          new maplibregl.Marker({ element: label, anchor: 'center' })
            .setLngLat(toCoord(centroid(area.vertices)))
            .addTo(map),
        );
      }
    }

    addOptimizeMarkers(map, markerRefs.current, optimizeOverlay, onGhostMove);

    for (const crossing of doc.crossings ?? []) {
      const selected = selection?.type === 'crossing' && selection.id === crossing.id;
      const el = createCrossingElement(crossing, selected);
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect({ type: 'crossing', id: crossing.id });
      });
      markerRefs.current.push(
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(toCoord(crossing)).addTo(map),
      );
    }

    // «Высота проезда» — кружки-знаки с высотой в метрах. Слой по умолчанию
    // скрыт; при активном инструменте или выбранной отметке виден всегда.
    if (showClearances || tool === 'clearance' || selection?.type === 'clearance') {
      for (const clearance of doc.clearances ?? []) {
        const selected = selection?.type === 'clearance' && selection.id === clearance.id;
        const el = createClearanceElement(clearance, selected);
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          onSelect({ type: 'clearance', id: clearance.id });
        });
        markerRefs.current.push(
          new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(toCoord(clearance)).addTo(map),
        );
      }
    }

    for (const point of visiblePoints) {
      const warehouse = point.warehouseId ? warehouses.get(point.warehouseId) : undefined;
      const selected = selection?.type === 'point' && selection.id === point.id;
      const blockedForVehicle = activeVehicle != null
        && point.allowedVehicles.length > 0
        && !point.allowedVehicles.includes(activeVehicle);
      const marker = createPointMarker({
        map,
        point,
        warehouse,
        selected,
        dimmed: blockedForVehicle,
        // Случайный drag НЕ двигает точку: перенос только через «Переместить» /
        // координаты в режиме правки (ТЗ 2026-07-09).
        draggable: false,
        canEdit,
        hidden: movingPointId === point.id,
        onSelect,
        onMovePoint,
        onContextMenu: (id, clientX, clientY) => {
          const rect = elRef.current?.getBoundingClientRect();
          setPointMenu({ id, x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
        },
      });
      markerRefs.current.push(marker);
    }
  }, [
    doc.areas,
    doc.railways,
    doc.roads,
    roadIssues,
    doc.roadSuggestions,
    doc.roadAccess,
    doc.crossings,
    doc.clearances,
    showRoadSuggestions,
    showRoadAccess,
    showClearances,
    showAreas,
    showWeather,
    weatherField,
    routePath,
    routeBlocked,
    visiblePoints,
    warehouses,
    selection,
    tool,
    canEdit,
    activeVehicle,
    movingPointId,
    hoverAccess?.id,
    crossingCandidates,
    optimizeOverlay,
    onSelect,
    onMovePoint,
    onStartMovePointByMap,
    onConfirmCandidate,
    onDismissCandidate,
    onGhostMove,
    styleReady,
  ]);

  // «Ограничение дороги»: навёл — отрезок дороги под курсором сразу ПОДСВЕТИЛСЯ
  // (видно, что именно закрасит клик), нажал — закрасился, Enter — окно правил.
  const restrictHover = useMemo(() => {
    if (tool !== 'restrict' || !cursor) return null;
    return roadStretchNear(cursor, doc.roads, RESTRICT_HOVER_HALF_METERS);
  }, [tool, cursor, doc.roads]);

  // Черновик кисти/рисования (следует за курсором) — ОТДЕЛЬНЫЙ слой-эффект, чтобы
  // движение мыши НЕ пересоздавало все маркеры (иначе ✓/× на кандидатах и клики
  // по точкам «промахивались» — элемент пересоздавался прямо во время клика).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-draft', buildDraftData(tool, draft, cursor, restrictHover, restrictParts));
  }, [tool, draft, cursor, restrictHover, restrictParts, styleReady]);

  // Тикаем таймеры «плохого сигнала» раз в секунду прямо в DOM маркеров, чтобы
  // не пересчитывать весь слой машин каждую секунду.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      elRef.current?.querySelectorAll<HTMLElement>('[data-bad-since]').forEach((node) => {
        const since = Number(node.getAttribute('data-bad-since'));
        if (Number.isFinite(since)) {
          node.textContent = formatBadTimer(Math.max(0, Math.round((now - since) / 1000)));
        }
      });
    };
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, []);

  // Гугл-слой (подписи/дороги/ориентиры) — включаемый справочный оверлей ПОД
  // нашими рабочими слоями. Наши дороги/точки/ограничения он не трогает.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (map.getLayer('google-labels')) map.removeLayer('google-labels');
    if (map.getSource('google-labels')) map.removeSource('google-labels');
    if (showGoogleLabels) {
      map.addSource('google-labels', {
        type: 'raster',
        tiles: ['pyn-tile://glabels/{z}/{x}/{y}'],
        tileSize: 256,
        maxzoom: 20,
      } as never);
      const beforeId = map.getLayer('map-buildings-fill') ? 'map-buildings-fill' : (map.getLayer('map-railways-bed') ? 'map-railways-bed' : undefined);
      map.addLayer({
        id: 'google-labels',
        type: 'raster',
        source: 'google-labels',
        paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 150 },
      } as never, beforeId);
    }
  }, [showGoogleLabels, styleReady]);

  // Контуры зданий (OSM) — лёгкий фиолетовый слой. Эфемерный: живёт только в
  // текущей сессии, в общий документ карты не пишется.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-buildings', buildBuildingsData(buildings));
  }, [buildings, styleReady]);

  // Внешние ж/д пути (OSM) — справочный слой для кандидатов на переезд.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-ext-railways', buildExtRailwaysData(extRailways));
  }, [extRailways, styleReady]);

  // Пешеходные дорожки (тонкая белая линия) и переходы (зебра) — справочно.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-footways', buildFootwaysData(footways));
  }, [footways, styleReady]);

  // Машины ГЛОНАСС — отдельный слой маркеров (не мигает при правках карты,
  // обновляется только при изменении позиций/выбора).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const live = glonassMarkerRefs.current;
    const ids = new Set(glonassMarkers.map((m) => m.id));
    for (const [id, entry] of live) {
      if (ids.has(id)) continue;
      if (entry.frame != null) cancelAnimationFrame(entry.frame);
      entry.marker.remove();
      live.delete(id);
    }
    for (const m of glonassMarkers) {
      const target = { lat: m.lat, lng: m.lng };
      const entry = live.get(m.id);
      if (!entry) {
        const el = createGlonassMarkerElement(m);
        el.style.zIndex = '900';
        live.set(m.id, {
          // subpixelPositioning — маркер трекает карту субпиксельно (без округления
          // до целых px), иначе «прыгает» на ~1px относительно плавно зумящейся карты.
          marker: new maplibregl.Marker({ element: el, anchor: 'bottom', subpixelPositioning: true })
            .setLngLat([m.lng, m.lat])
            .addTo(map),
          frame: null,
          targetAt: parseMarkerTimeMs(m.time),
        });
        continue;
      }
      updateGlonassMarkerElement(entry.marker.getElement() as HTMLDivElement, m);
      // Живое движение (timedPath) ведёт rAF-цикл ниже — прыжковую анимацию не
      // запускаем, иначе маркер режет углы мимо дороги и дёргается между опросами.
      if ((m.timedPath?.length ?? 0) >= 2) {
        if (entry.frame != null) {
          cancelAnimationFrame(entry.frame);
          entry.frame = null;
        }
        continue;
      }
      // Before a timed road path exists there is nothing trustworthy to
      // interpolate. Set the already-snapped target directly; otherwise every
      // poll restarts an animation from the previous raw position and the
      // second selected vehicle appears beside the road. Once timedPath exists,
      // the single rAF loop below owns movement for every selected vehicle.
      if (entry.frame != null) cancelAnimationFrame(entry.frame);
      entry.frame = null;
      entry.targetAt = parseMarkerTimeMs(m.time);
      entry.marker.setLngLat([target.lng, target.lat]);
    }
  }, [glonassMarkers, styleReady]);

  // rAF: читаем markers из ref (свежие lat/raw при каждом poll), не из closure.
  // Иначе 2-я без timedPath «застывает» на старых coords, пока 1-я едет по path.
  const glonassMarkersLiveRef = useRef(glonassMarkers);
  glonassMarkersLiveRef.current = glonassMarkers;
  const glonassFollowIdsLiveRef = useRef(glonassFollowIds);
  glonassFollowIdsLiveRef.current = glonassFollowIds;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (glonassMarkers.length === 0) {
      setSourceData(map, 'map-glonass-live-trail', EMPTY_FEATURES);
      return;
    }
    let frame = 0;
    let lastTrailAt = 0;
    let lastFollowAt = 0;
    const tick = (now: number) => {
      const markers = glonassMarkersLiveRef.current;
      const followSet = glonassFollowIdsLiveRef.current ?? new Set<number>();
      const entries = glonassMarkerRefs.current;
      const wantTrail = now - lastTrailAt > 220;
      const features: FeatureCollection['features'] = [];
      const followPts: { lng: number; lat: number }[] = [];
      for (const m of markers) {
        const entry = entries.get(m.id);
        if (!entry) continue;
        let pos: { lat: number; lng: number };
        const timedPath = m.timedPath;
        if (timedPath && timedPath.length >= 2) {
          const targetMs = Date.now() - (m.delayMs ?? 0);
          const interpolated = pointAtTimedPath(timedPath, targetMs);
          pos = snapToRoadIndex(glonassRoadSnapIndex, interpolated)?.point ?? interpolated;
          // Не уезжаем далеко от текущего GPS (сырого) — иначе 2-я «улетает».
          const raw = {
            lat: m.rawLat ?? m.lat,
            lng: m.rawLng ?? m.lng,
          };
          const rawRoad = snapToRoadIndex(glonassRoadSnapIndex, raw)?.point ?? raw;
          const dx = distanceMeters(pos, rawRoad);
          if (dx > 55) pos = rawRoad;
          if (wantTrail && showGlonassPro && dx <= 55) {
            const trail = liveTrailBehind(timedPath, targetMs, pos, 100);
            if (trail.length >= 2) {
              features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: trail.map((p) => [p.lng, p.lat]) },
                properties: { color: STATUS_COLOR[m.status] },
              });
            }
          }
        } else {
          // Нет timedPath / disabled: всегда raw → дорога (свежий m из ref).
          const raw = {
            lat: m.rawLat ?? m.lat,
            lng: m.rawLng ?? m.lng,
          };
          pos = snapToRoadIndex(glonassRoadSnapIndex, raw)?.point ?? raw;
        }
        entry.marker.setLngLat([pos.lng, pos.lat]);
        if (followSet.has(m.id)) followPts.push({ lng: pos.lng, lat: pos.lat });
      }
      // Мульти-слежение: 1 машина — center; несколько — fitBounds.
      if (followPts.length > 0 && now - lastFollowAt > 1200) {
        lastFollowAt = now;
        if (followPts.length === 1) {
          map.easeTo({ center: [followPts[0]!.lng, followPts[0]!.lat], duration: 1180, essential: true });
        } else {
          let minLng = followPts[0]!.lng;
          let maxLng = followPts[0]!.lng;
          let minLat = followPts[0]!.lat;
          let maxLat = followPts[0]!.lat;
          for (const p of followPts) {
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
          }
          map.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 80, duration: 1180, maxZoom: Math.max(map.getZoom(), 15), essential: true },
          );
        }
      }
      if (wantTrail) {
        lastTrailAt = now;
        setSourceData(map, 'map-glonass-live-trail', { type: 'FeatureCollection', features });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // markers/follow — через ref; рестарт только при появлении/исчезновении маркеров или индексе
  }, [glonassMarkers.length, glonassRoadSnapIndex, showGlonassPro, styleReady]);

  // Слежение: статичные цели (без timedPath) — центр / fitBounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || glonassFollowTargets.length === 0) return;
    if (glonassFollowTargets.length === 1) {
      map.easeTo({ center: toCoord(glonassFollowTargets[0]!), duration: 900, essential: true });
      return;
    }
    let minLng = glonassFollowTargets[0]!.lng;
    let maxLng = glonassFollowTargets[0]!.lng;
    let minLat = glonassFollowTargets[0]!.lat;
    let maxLat = glonassFollowTargets[0]!.lat;
    for (const p of glonassFollowTargets) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 80, duration: 900, maxZoom: Math.max(map.getZoom(), 15), essential: true },
    );
  }, [
    glonassFollowTargets.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|'),
    styleReady,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-glonass-tracks', buildGlonassTracksData(glonassTracks));
  }, [glonassTracks, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    setSourceData(map, 'map-glonass-history', buildGlonassHistoryData(glonassHistoryTracks));
  }, [glonassHistoryTracks, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const current = glonassReplayRef.current;
    if (!glonassReplayMarker) {
      clearGlonassReplayEntry(glonassReplayRef);
      return;
    }
    const target = { lat: glonassReplayMarker.lat, lng: glonassReplayMarker.lng };
    if (!current || current.id !== glonassReplayMarker.id) {
      clearGlonassReplayEntry(glonassReplayRef);
      const el = createGlonassReplayMarkerElement(glonassReplayMarker);
      el.style.zIndex = '910';
      glonassReplayRef.current = {
        id: glonassReplayMarker.id,
        marker: new maplibregl.Marker({ element: el, anchor: 'bottom', subpixelPositioning: true })
          .setLngLat([glonassReplayMarker.lng, glonassReplayMarker.lat])
          .addTo(map),
        frame: null,
        targetAt: parseMarkerTimeMs(glonassReplayMarker.time),
      };
      return;
    }
    updateGlonassReplayMarkerElement(current.marker.getElement() as HTMLDivElement, glonassReplayMarker);
    current.targetAt = parseMarkerTimeMs(glonassReplayMarker.time);
    animateGlonassMarker(current, target, glonassReplayMarker.animationMs ?? 1400, glonassReplayMarker.path);
  }, [glonassReplayMarker, styleReady]);

  // Экранная позиция выбранной точки → поповер-карточка у пина (следит за картой).
  const selectedPoint = selection?.type === 'point' ? doc.points.find((p) => p.id === selection.id) ?? null : null;
  const reportScreenRef = useRef(onSelectedPointScreen);
  reportScreenRef.current = onSelectedPointScreen;
  useEffect(() => {
    const map = mapRef.current;
    const report = reportScreenRef.current;
    if (!map || !styleReady || !report) return;
    if (!selectedPoint || movingPointId === selectedPoint.id) {
      report(null);
      return;
    }
    const update = () => {
      const p = map.project(toCoord(selectedPoint));
      report({ x: p.x, y: p.y });
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
      report(null);
    };
  }, [selectedPoint, movingPointId, styleReady]);

  // Радар осадков — растровый слой ПОД нашими дорогами/точками. (Визуальный рельеф
  // не рисуем: на плоской площадке hillshade даёт серую дымку и не несёт пользы;
  // высоту показываем числом в статус-баре, см. centerElevation.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const beforeId = map.getLayer('map-railways-bed') ? 'map-railways-bed' : undefined;

    // Радар осадков — пересоздаём при смене кадра (weatherNonce в URL).
    if (map.getLayer('weather-rain')) map.removeLayer('weather-rain');
    if (map.getSource('weather-rain')) map.removeSource('weather-rain');
    if (showWeather) {
      // RainViewer рисует только зоны осадков. Берём цветовую схему без серой
      // подложки и держим слой полупрозрачным, чтобы спутник оставался читаемым.
      map.addSource('weather-rain', {
        type: 'raster',
        tiles: [`pyn-tile://rain/{z}/{x}/{y}?v=${weatherNonce}&c=2`],
        tileSize: 512,
        // Радар RainViewer не отдаёт тайлы на близком зуме → берём z≤10 и
        // растягиваем (осадки над площадкой видны; рисунок региона — отдалив).
        maxzoom: 10,
      } as never);
      map.addLayer({
        id: 'weather-rain',
        type: 'raster',
        source: 'weather-rain',
        paint: { 'raster-opacity': 0.34, 'raster-fade-duration': 200 },
      } as never, beforeId);
    }
  }, [showWeather, weatherNonce, styleReady]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={elRef} className="h-full w-full bg-[#101419] [&_.maplibregl-canvas]:outline-none" />
      <WeatherFlowOverlay show={showWeather} now={weatherNow} field={weatherField} />
      <MapControls
        zoom={viewMetrics?.zoom ?? DEFAULT_ZOOM}
        bearing={viewMetrics?.bearing ?? 0}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomTo={zoomTo}
        onResetNorth={resetNorth}
        onRotate={rotateBy}
      />
      <MapStatusBar metrics={viewMetrics} cursor={cursor} />
      {/* Ховер участка-ограничения: краткая подсказка с особенностями проезда */}
      {hoverAccess && (() => {
        const access = doc.roadAccess.find((a) => a.id === hoverAccess.id);
        if (!access) return null;
        const meta = roadAccessKindMeta(access.kind);
        return (
          <div
            className="pointer-events-none absolute z-[465] max-w-[260px] -translate-x-1/2 rounded-lg border border-border-default bg-bg-deep/94 px-2.5 py-1.5 text-[11.5px] shadow-[0_6px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm"
            style={{ left: hoverAccess.x, top: hoverAccess.y - 44 }}
          >
            <p className="flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>
              {(access.kind === 'closed' || access.kind === 'temp_closed') && <span className="text-[12px] leading-none">⚠</span>}
              {meta.label}
            </p>
            <p className="mt-0.5 text-text-secondary">{roadAccessSummary(access)}</p>
            {access.note.trim() && <p className="mt-0.5 text-text-muted">{access.note}</p>}
          </div>
        );
      })()}
      {pointMenu && (
        <>
          <div className="absolute inset-0 z-[470]" onClick={() => setPointMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPointMenu(null); }} />
          <div
            className="absolute z-[471] w-40 overflow-hidden rounded-lg border border-border-default bg-bg-elevated/95 py-1 shadow-2xl backdrop-blur"
            style={{ left: Math.min(pointMenu.x, (elRef.current?.clientWidth ?? 9999) - 168), top: pointMenu.y }}
          >
            <button
              type="button"
              onClick={() => { onDuplicatePoint(pointMenu.id); setPointMenu(null); }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
            >
              <Copy size={14} strokeWidth={1.75} /> Копировать
            </button>
            <button
              type="button"
              onClick={() => { onStartMovePointByMap(pointMenu.id); setPointMenu(null); }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
            >
              <LocateFixed size={14} strokeWidth={1.75} /> Переместить
            </button>
          </div>
        </>
      )}
      {movingPoint && (
        <MovePointOverlay
          point={movingPoint}
          onCancel={onCancelMovePointByMap}
          onSave={() => {
            const map = mapRef.current;
            if (!map) return;
            onFinishMovePointByMap(movingPoint.id, toLatLng(map.getCenter()));
          }}
        />
      )}
      {(tool === 'area' || tool === 'road' || tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'railway' || tool === 'confirmRoad') && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[3] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-bg-deep/88 px-3 py-1 text-[11.5px] text-text-secondary shadow">
            <span>
              {tool === 'area'
                ? 'Своя область: кликами обводим контур'
                : tool === 'road'
                  ? 'Своя дорога: кликните старт и ведите мышью'
                  : tool === 'eraseRoad'
                    ? 'Ластик дороги: проведите по куску дороги — он сотрётся (остальная сеть цела)'
                    : tool === 'eraseAccess'
                      ? 'Ластик ограничений: проведите по окрашенному участку — правило срежется'
                      : tool === 'railway'
                        ? 'Ж/д путь: кликните старт и ведите мышью'
                        : 'Подтверждение: ведите курсором по красной линии (новая не рисуется)'} · Enter — сохранить · Esc — отмена
            </span>
            {((tool === 'road' && draft.length >= 2) || (tool === 'eraseRoad' && draft.length >= 1) || (tool === 'eraseAccess' && draft.length >= 1) || (tool === 'railway' && draft.length >= 2) || (tool === 'confirmRoad' && draft.length >= 2) || (tool === 'area' && draft.length >= 3)) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  finishDraft();
                }}
                className="h-6 rounded border border-border-subtle px-2 text-[11px] font-medium text-text-strong outline-none transition-colors hover:bg-bg-hover"
              >
                {tool === 'area' ? 'Сохранить область' : tool === 'road' ? 'Сохранить дорогу' : tool === 'eraseRoad' ? 'Стереть кусок' : tool === 'eraseAccess' ? 'Готово' : tool === 'railway' ? 'Сохранить путь' : 'Сохранить подтверждение'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ZOOM_MIN = 3;
const ZOOM_MAX = 20;

/**
 * Управление картой в левом нижнем углу (как в Google), в стиле приложения:
 * зум «+ / ползунок / −» и компас со стрелками поворота. Слегка приглушено в
 * покое, полностью активно и с мягким свечением при наведении.
 */
/** Сторона света на русском по азимуту (8 румбов). */
function cardinalRu(bearing: number): string {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return dirs[i]!;
}

function WeatherFlowOverlay({ show, now, field }: { show: boolean; now: WeatherNow | null; field: WeatherFieldPoint[] }) {
  const state = useMemo(() => summarizeWeatherFlow(now, field), [now, field]);
  if (!show || state.kind === 'clear') return null;

  const count = state.kind === 'wind'
    ? Math.round(12 + state.intensity * 12)
    : Math.round(18 + state.intensity * 28);
  const particles = WEATHER_PARTICLES.slice(0, count);
  const drift = Math.round(Math.sin((state.windToDeg * Math.PI) / 180) * (24 + state.windMs * 6));
  const slant = Math.max(-24, Math.min(24, drift * 0.35));
  const palette = weatherFlowPalette(state.kind);
  const overlayStyle = {
    '--wx-drift': `${drift}px`,
    '--wx-slant': `${slant}deg`,
    '--wx-wind-deg': `${state.windToDeg - 90}deg`,
  } as CSSProperties;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
      style={{ ...overlayStyle, opacity: 0.46 + state.intensity * 0.2, mixBlendMode: 'screen' }}
      aria-hidden="true"
    >
      <style>{WEATHER_FLOW_CSS}</style>
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.22 + state.intensity * 0.12,
          background: palette.wash,
        }}
      />
      {particles.map((p) => (
        <span
          key={p.id}
          className={`pyn-weather-flow pyn-weather-${state.kind}`}
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${(state.kind === 'snow' ? p.duration + 3 : state.kind === 'hail' ? p.duration * 0.55 : p.duration).toFixed(2)}s`,
            transform: `scale(${p.scale})`,
            background: palette.particle,
            boxShadow: palette.shadow,
          }}
        />
      ))}
    </div>
  );
}

const WEATHER_FLOW_CSS = `
@keyframes pynWeatherFall {
  from { transform: translate3d(0, -16vh, 0) rotate(var(--wx-slant)); }
  to { transform: translate3d(var(--wx-drift), 124vh, 0) rotate(var(--wx-slant)); }
}
@keyframes pynWeatherWind {
  from { transform: translate3d(-12vw, 0, 0) rotate(var(--wx-wind-deg)); opacity: 0; }
  20% { opacity: .62; }
  80% { opacity: .52; }
  to { transform: translate3d(112vw, -6vh, 0) rotate(var(--wx-wind-deg)); opacity: 0; }
}
.pyn-weather-flow {
  position: absolute;
  display: block;
  border-radius: 999px;
  will-change: transform, opacity;
}
.pyn-weather-rain {
  width: 1.2px;
  height: 46px;
  animation: pynWeatherFall linear infinite;
}
.pyn-weather-snow {
  width: 4.5px;
  height: 4.5px;
  animation: pynWeatherFall linear infinite;
}
.pyn-weather-hail {
  width: 3.8px;
  height: 3.8px;
  animation: pynWeatherFall linear infinite;
}
.pyn-weather-wind {
  width: 84px;
  height: 1.4px;
  animation: pynWeatherWind linear infinite;
}
`;

function summarizeWeatherFlow(now: WeatherNow | null, field: WeatherFieldPoint[]): WeatherFlowState {
  const precip = Math.max(now?.precipMm ?? 0, ...field.map((p) => p.precipMm ?? 0), 0);
  const windMs = Math.max(now?.windMs ?? 0, ...field.map((p) => p.windMs ?? 0), 0);
  const windToDeg = averageWindToDeg(field) ?? 105;
  const codes = [now?.code ?? null, ...field.map((p) => p.code)].filter((code): code is number => typeof code === 'number');
  const codeKind = codes.some(isHailCode) ? 'hail'
    : codes.some(isSnowCode) ? 'snow'
      : codes.some(isRainCode) ? 'rain'
        : null;

  if (codeKind === 'hail') return { kind: 'hail', intensity: clamp01(0.46 + precip / 4), windMs, windToDeg };
  if (codeKind === 'snow') return { kind: 'snow', intensity: clamp01(0.36 + precip / 5), windMs, windToDeg };
  if (codeKind === 'rain' || (now?.isPrecip ?? false) || precip > 0.05) {
    return { kind: 'rain', intensity: clamp01(0.34 + precip / 5), windMs, windToDeg };
  }
  if (windMs >= 3) return { kind: 'wind', intensity: clamp01((windMs - 2) / 9), windMs, windToDeg };
  return { kind: 'clear', intensity: 0, windMs, windToDeg };
}

function weatherFlowPalette(kind: WeatherFlowKind): { particle: string; shadow: string; wash: string } {
  if (kind === 'snow') {
    return {
      particle: 'rgba(232, 246, 255, 0.84)',
      shadow: '0 0 8px rgba(180, 220, 255, 0.34)',
      wash: 'radial-gradient(circle at 20% 18%, rgba(180,220,255,.16), transparent 34%), radial-gradient(circle at 80% 58%, rgba(255,255,255,.10), transparent 38%)',
    };
  }
  if (kind === 'hail') {
    return {
      particle: 'rgba(235, 242, 255, 0.9)',
      shadow: '0 0 9px rgba(147, 197, 253, 0.46)',
      wash: 'radial-gradient(circle at 22% 22%, rgba(147,197,253,.17), transparent 30%), radial-gradient(circle at 74% 58%, rgba(165,180,252,.12), transparent 36%)',
    };
  }
  if (kind === 'wind') {
    return {
      particle: 'linear-gradient(90deg, transparent, rgba(182,227,255,.68), transparent)',
      shadow: '0 0 8px rgba(125, 211, 252, 0.24)',
      wash: 'radial-gradient(circle at 18% 30%, rgba(125,211,252,.10), transparent 34%), radial-gradient(circle at 82% 46%, rgba(148,163,184,.07), transparent 42%)',
    };
  }
  return {
    particle: 'linear-gradient(180deg, transparent, rgba(125, 211, 252, 0.8), transparent)',
    shadow: '0 0 9px rgba(56, 189, 248, 0.34)',
    wash: 'radial-gradient(circle at 18% 24%, rgba(56,189,248,.17), transparent 34%), radial-gradient(circle at 78% 54%, rgba(34,211,238,.10), transparent 38%)',
  };
}

function averageWindToDeg(field: WeatherFieldPoint[]): number | null {
  let sx = 0;
  let sy = 0;
  let weight = 0;
  for (const p of field) {
    if (p.windDir == null) continue;
    const speed = Math.max(0.8, p.windMs ?? 1);
    const to = ((p.windDir + 180) % 360) * Math.PI / 180;
    sx += Math.sin(to) * speed;
    sy += Math.cos(to) * speed;
    weight += speed;
  }
  if (weight <= 0) return null;
  return (Math.atan2(sx / weight, sy / weight) * 180 / Math.PI + 360) % 360;
}

function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code === 95;
}

function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function isHailCode(code: number): boolean {
  return code === 96 || code === 99;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function MapControls({ zoom, bearing, onZoomIn, onZoomOut, onZoomTo, onResetNorth, onRotate }: {
  zoom: number;
  bearing: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (z: number) => void;
  onResetNorth: () => void;
  onRotate: (deg: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = Math.max(0, Math.min(1, (zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)));

  const zoomFromPointer = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (r.bottom - clientY) / r.height));
    onZoomTo(ZOOM_MIN + t * (ZOOM_MAX - ZOOM_MIN));
  };

  const surface = 'border border-border-default bg-bg-elevated shadow-lg ring-0 ring-accent-clay/0 transition-all group-hover:ring-1 group-hover:ring-accent-clay/15';

  return (
    <div className="group absolute bottom-3 left-3 z-[4] flex flex-col items-center gap-2.5 opacity-[0.72] transition-opacity duration-200 hover:opacity-100">
      {/* Зум: + · ползунок · − */}
      <div className={cn('flex flex-col items-center gap-1 rounded-2xl px-1.5 py-2', surface)}>
        <button
          type="button"
          onClick={onZoomIn}
          title="Приблизить"
          aria-label="Приблизить"
          className="flex h-7 w-7 items-center justify-center rounded-xl text-[20px] font-medium leading-none text-text-strong outline-none transition-colors hover:bg-bg-hover active:bg-bg-active"
        >+</button>
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            zoomFromPointer(e.clientY);
          }}
          onPointerMove={(e) => { if (e.buttons === 1) zoomFromPointer(e.clientY); }}
          className="relative my-1 h-24 w-5 cursor-pointer"
          title="Масштаб — тяните бегунок"
        >
          <div className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 rounded-full bg-border-default" />
          <div className="absolute left-1/2 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-accent-clay/70" style={{ height: `${pct * 100}%` }} />
          <div
            className="absolute left-1/2 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-accent-clay bg-bg-elevated shadow-md"
            style={{ bottom: `${pct * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onZoomOut}
          title="Отдалить"
          aria-label="Отдалить"
          className="flex h-7 w-7 items-center justify-center rounded-xl text-[24px] font-medium leading-none text-text-strong outline-none transition-colors hover:bg-bg-hover active:bg-bg-active"
        >−</button>
      </div>

      {/* Одна кнопка — повернуть карту (по 30° за клик). */}
      <button
        type="button"
        onClick={() => onRotate(30)}
        title="Повернуть карту"
        aria-label="Повернуть карту"
        className={cn('flex h-9 w-9 items-center justify-center rounded-full text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-strong', surface)}
      >
        <svg width="19" height="19" viewBox="0 0 16 16" fill="none"><path d="M11 3.5A5 5 0 1 0 13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M13.6 3.2 10.9 3.6 11.4 6.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>

      {/* Компас — только ориентир (С/В/Ю/З), крутится с картой, клик — север вверх. */}
      <button
        type="button"
        onClick={onResetNorth}
        title={`Ориентир: ${cardinalRu(bearing)} вверху · клик — север вверх`}
        aria-label="Север вверх"
        className={cn('flex h-12 w-12 items-center justify-center rounded-full outline-none transition-colors hover:bg-bg-hover', surface)}
      >
        <svg width="38" height="38" viewBox="0 0 38 38" style={{ transform: `rotate(${-bearing}deg)` }}>
          <circle cx="19" cy="19" r="16" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
          <path d="M19 4 L23 19 L19 15.5 L15 19 Z" fill="#EF4444" />
          <path d="M19 34 L15 19 L19 22.5 L23 19 Z" fill="#9aa4b2" />
          <text x="19" y="11" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#fff">С</text>
          <text x="19" y="34.5" textAnchor="middle" fontSize="5.6" fontWeight="600" fill="#cbd5e1">Ю</text>
          <text x="32.8" y="21" textAnchor="middle" fontSize="5.6" fontWeight="600" fill="#cbd5e1">В</text>
          <text x="5.2" y="21" textAnchor="middle" fontSize="5.6" fontWeight="600" fill="#cbd5e1">З</text>
        </svg>
      </button>
    </div>
  );
}

function MovePointOverlay({
  point,
  onSave,
  onCancel,
}: {
  point: MapPoint;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        {createFixedPointPreview(point)}
      </div>
      <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md bg-bg-deep/90 px-3 py-1.5 text-[11.5px] text-text-secondary shadow-xl backdrop-blur">
        <span>Точка стоит на экране. Двигайте карту под ней · Enter — сохранить · Esc — отмена</span>
        <button
          type="button"
          onClick={onSave}
          className="h-6 rounded border border-emerald-400/40 px-2 text-[11px] font-semibold text-emerald-300 outline-none transition-colors hover:bg-emerald-400/10"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-6 rounded border border-border-subtle px-2 text-[11px] text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

function MapStatusBar({ metrics, cursor }: { metrics: ViewMetrics | null; cursor: LatLng | null }) {
  // Координаты, зум и масштаб — блоком ПО ЦЕНТРУ внизу: справа их перекрывала
  // легенда/копирайт, слева стоит блок управления. Центр — чисто и видно.
  const loc = cursor ?? metrics?.center ?? null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-[3] flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-white/10 bg-[#080b11]/88 px-2.5 py-1 text-[11px] text-white/85 shadow-lg backdrop-blur">
      <span className="font-mono tabular-nums">
        {loc ? `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}` : '—, —'}
      </span>
      <span className="text-white/35">•</span>
      <span className="font-mono tabular-nums">z {metrics ? metrics.zoom.toFixed(1) : '—'}</span>
      <span className="text-white/35">•</span>
      <span className="font-mono tabular-nums">{metrics ? `${metrics.metersPerPixel.toFixed(metrics.metersPerPixel < 10 ? 1 : 0)} м/px` : '— м/px'}</span>
    </div>
  );
}

function googleRasterStyle(): unknown {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      esri: {
        type: 'raster',
        tiles: [ESRI_TILE_URL],
        tileSize: 256,
        minzoom: 3,
        maxzoom: 19,
      },
      google: {
        type: 'raster',
        tiles: [GOOGLE_TILE_URL],
        tileSize: 256,
        minzoom: 3,
        maxzoom: 20,
      },
    },
    layers: [
      {
        id: 'esri-satellite',
        type: 'raster',
        source: 'esri',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 180 },
      },
      {
        id: 'google-satellite',
        type: 'raster',
        source: 'google',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 120 },
      },
    ],
  };
}

function tuneScrollZoom(map: MapLibreMap): void {
  const scrollZoom = map.scrollZoom as unknown as {
    setWheelZoomRate?: (rate: number) => void;
    setZoomRate?: (rate: number) => void;
  };
  // Чем меньше «rate», тем мельче шаг на одно деление колеса/жест трекпада →
  // тем плавнее и мягче наезд/отъезд (меньше рывков). Подобрано на ощупь;
  // если покажется вялым — увеличить дробь (напр. 1/560 колесо).
  scrollZoom.setWheelZoomRate?.(1 / 720);
  scrollZoom.setZoomRate?.(1 / 180);
}

function readViewMetrics(map: MapLibreMap): ViewMetrics {
  const center = toLatLng(map.getCenter());
  const p = map.project(toCoord(center));
  const p2 = new maplibregl.Point(p.x + 100, p.y);
  const cssMetersPerPixel = distanceMeters(center, toLatLng(map.unproject(p2))) / 100;
  const metersPerPixel = cssMetersPerPixel / Math.max(1, window.devicePixelRatio || 1);
  return {
    center,
    zoom: map.getZoom(),
    metersPerPixel,
    bearing: map.getBearing(),
  };
}

// Кисть-ластик на экране ~7 px радиуса: рез в метрах следует за зумом (крупный
// план — тонкий точный рез, мелкий — широкий), с клампами от крайностей.
const ERASE_BRUSH_PX = 7;

function eraseBrushRadiusMeters(map: MapLibreMap): number {
  const center = toLatLng(map.getCenter());
  const p = map.project(toCoord(center));
  const p2 = new maplibregl.Point(p.x + 40, p.y);
  const cssMetersPerPixel = distanceMeters(center, toLatLng(map.unproject(p2))) / 40;
  return Math.min(9, Math.max(1.2, cssMetersPerPixel * ERASE_BRUSH_PX));
}

function ensureOverlayLayers(map: MapLibreMap): void {
  addGeoJsonSource(map, 'map-areas');
  addGeoJsonSource(map, 'map-railways');
  addGeoJsonSource(map, 'map-roads');
  addGeoJsonSource(map, 'map-road-issues');
  addGeoJsonSource(map, 'map-road-suggestions');
  addGeoJsonSource(map, 'map-road-access');
  addGeoJsonSource(map, 'map-route');
  addGeoJsonSource(map, 'map-glonass-history');
  addGeoJsonSource(map, 'map-glonass-tracks');
  addGeoJsonSource(map, 'map-glonass-live-trail');
  addGeoJsonSource(map, 'map-opt-rays');
  addGeoJsonSource(map, 'map-draft');
  addGeoJsonSource(map, 'map-buildings');
  addGeoJsonSource(map, 'map-ext-railways');
  addGeoJsonSource(map, 'map-footways');

  // Контуры зданий (OSM) — контур ЖИРНЕЕ, заливка ЛЕГЧЕ (юзер 2026-07-09):
  // читаемая геометрия на тёмном снимке, не мешает рабочим слоям.
  addLayer(map, {
    id: 'map-buildings-fill',
    type: 'fill',
    source: 'map-buildings',
    paint: {
      'fill-color': '#A78BFA',
      'fill-opacity': 0.06,
    },
  });
  addLayer(map, {
    id: 'map-buildings-line',
    type: 'line',
    source: 'map-buildings',
    paint: {
      'line-color': '#C4B5FD',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 16, 1.7, 20, 2.6],
      'line-opacity': 0.72,
    },
  });

  // Пешеходные ДОРОЖКИ (OSM, справочно) — тонкая белая линия (не зебра, чтобы
  // не сливаться с ж/д). НЕ кликабельны, лежат под ж/д и дорогами.
  addLayer(map, {
    id: 'map-footways-path',
    type: 'line',
    source: 'map-footways',
    filter: ['!=', ['get', 'crossing'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#38BDF8',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 16, 1.6, 20, 2.6],
      'line-opacity': 0.7,
    },
  });
  // Пешеходный ПЕРЕХОД через дорогу — полосатая «зебра», как на Яндексе.
  addLayer(map, {
    id: 'map-footways-crossing-bed',
    type: 'line',
    source: 'map-footways',
    filter: ['==', ['get', 'crossing'], true],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#111827',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.6, 16, 4.2, 20, 6.5],
      'line-opacity': 0.55,
    },
  });
  addLayer(map, {
    id: 'map-footways-crossing-zebra',
    type: 'line',
    source: 'map-footways',
    filter: ['==', ['get', 'crossing'], true],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#38BDF8',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 3.6, 20, 5.6],
      'line-opacity': 0.95,
      'line-dasharray': [0.7, 0.7],
    },
  });

  // Внешние ж/д пути (OSM, справочно) — приглушённые «шпалы», НЕ кликабельны.
  addLayer(map, {
    id: 'map-ext-railways-bed',
    type: 'line',
    source: 'map-ext-railways',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#111827',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 2.6, 20, 4.2],
      'line-opacity': 0.62,
    },
  });
  addLayer(map, {
    id: 'map-ext-railways-ties',
    type: 'line',
    source: 'map-ext-railways',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#D1D5DB',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.6, 16, 2.6, 20, 4.2],
      'line-opacity': 0.55,
      'line-dasharray': [0.4, 1.6],
    },
  });

  // Ж/д путь — тёмная линия + белые «шпалы» (частый пунктир поверх). Под дорогами.
  addLayer(map, {
    id: 'map-railways-bed',
    type: 'line',
    source: 'map-railways',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#1F2937',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 16, 4, 20, 6.5],
      'line-opacity': 0.95,
    },
  });
  addLayer(map, {
    id: 'map-railways-ties',
    type: 'line',
    source: 'map-railways',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#FFFFFF', '#E5E7EB'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 16, 4, 20, 6.5],
      'line-opacity': 0.95,
      'line-dasharray': [0.4, 1.4],
    },
  });
  addLayer(map, {
    id: 'map-railways-hit',
    type: 'line',
    source: 'map-railways',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.01 },
  });

  addLayer(map, {
    id: 'map-areas-fill',
    type: 'fill',
    source: 'map-areas',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.28, 0.16],
    },
  });
  addLayer(map, {
    id: 'map-areas-line',
    type: 'line',
    source: 'map-areas',
    paint: {
      'line-color': ['get', 'color'],
      'line-opacity': 0.95,
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 3, 2],
    },
  });
  // Лучи оптимума (бледно-зелёные) — у самого низа оверлея.
  addLayer(map, {
    id: 'map-opt-rays-line',
    type: 'line',
    source: 'map-opt-rays',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#6FBF8E', 'line-width': 1.2, 'line-opacity': 0.45 },
  });
  // Красный черновик (OSM/ИИ) — ПОД подтверждёнными дорогами, чтобы своя/
  // подтверждённая дорога рисовалась ПОВЕРХ красной и была видна.
  addLayer(map, {
    id: 'map-road-suggestions-line',
    type: 'line',
    source: 'map-road-suggestions',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#EF4444',
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 3.2, 2.2],
      'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.95, 0.7],
      'line-dasharray': [2, 3],
    },
  });
  addLayer(map, {
    id: 'map-road-suggestions-hit',
    type: 'line',
    source: 'map-road-suggestions',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.01 },
  });
  // Реальные следы ГЛОНАСС — под нашими жёлтыми дорогами. Так видно, где
  // розовые фактические проезды плотно совпадают с дорогой, а где её надо править.
  addLayer(map, {
    id: 'map-glonass-history-casing',
    type: 'line',
    source: 'map-glonass-history',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#080B11',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.2, 16, 5.4, 20, 8.4],
      'line-opacity': ['*', ['coalesce', ['get', 'opacity'], 0.7], 0.28],
    },
  });
  addLayer(map, {
    id: 'map-glonass-history-line',
    type: 'line',
    source: 'map-glonass-history',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 16, 2.8, 20, 4.8],
      'line-opacity': ['coalesce', ['get', 'opacity'], 0.7],
    },
  });
  // Дороги (свои + подтверждённые) — тёмная обводка + яркая линия, чтобы
  // чётко читались на спутнике. ПОВЕРХ красного черновика. Линия ТОНЬШЕ
  // прежней (юзер 2026-07-09) — жёлтые дороги сохранены, просто аккуратнее.
  addLayer(map, {
    id: 'map-roads-casing',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0A0D12',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 16, 4, 20, 6.2],
      'line-opacity': 0.88,
    },
  });
  addLayer(map, {
    id: 'map-roads-line',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#FFFFFF', '#FFC83D'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 2.3, 20, 3.8],
      'line-opacity': 1,
    },
  });
  // Проверка сети: показывает то, что раньше было НЕВИДИМЫМ допуском графа.
  // Красный = близкие концы/примыкания, фиолетовый = параллельное наложение.
  // Эти линии диагностические и в маршрутах не участвуют.
  addLayer(map, {
    id: 'map-road-issues-line',
    type: 'line',
    source: 'map-road-issues',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'kind'], 'overlap'], '#C084FC', '#FB7185'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 3.4, 20, 5.5],
      'line-opacity': 0.95,
      'line-dasharray': [1, 1.4],
    },
  });
  // Дорога — ЕДИНАЯ непрерывная «паутина», рисуем только линиями. Жёлтые точки-
  // узлы (sharedRoadNodes) убраны: они дробили сеть визуально («отлипшие куски»).
  addLayer(map, {
    id: 'map-roads-hit',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.01 },
  });
  // Ограничения участков дорог — линия вдоль дороги, в обычном режиме
  // приглушённая (не перегружает карту), при ховере/выборе подсвечивается
  // целиком. Наложения различаются смещением лент (offset в данных).
  addLayer(map, {
    id: 'map-road-access-line',
    type: 'line',
    source: 'map-road-access',
    filter: ['==', '$type', 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-offset': ['coalesce', ['get', 'offset'], 0],
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['case', ['any', ['boolean', ['get', 'selected'], false], ['boolean', ['get', 'hovered'], false]], 4.5, 2.6],
        16, ['case', ['any', ['boolean', ['get', 'selected'], false], ['boolean', ['get', 'hovered'], false]], 6.5, 3.8],
        20, ['case', ['any', ['boolean', ['get', 'selected'], false], ['boolean', ['get', 'hovered'], false]], 9.5, 5.8],
      ],
      // Обычный режим — линия почти прозрачна (остаются точки по краям);
      // закрытые заметнее; ховер/выбор/совпадение с фильтром «Машина» — полная.
      'line-opacity': [
        'case',
        ['any', ['boolean', ['get', 'selected'], false], ['boolean', ['get', 'hovered'], false]], 0.96,
        ['any', ['==', ['get', 'accessKind'], 'closed'], ['==', ['get', 'accessKind'], 'temp_closed']], 0.78,
        0.14,
      ],
    },
  });
  // Круглые маркеры начала/конца участка — небольшие, всегда видны.
  addLayer(map, {
    id: 'map-road-access-ends',
    type: 'circle',
    source: 'map-road-access',
    filter: ['==', 'kind', 'accessEnd'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.6, 16, 3.6, 20, 5],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.92,
      'circle-stroke-color': '#0A0D12',
      'circle-stroke-width': 1.1,
    },
  });
  addLayer(map, {
    id: 'map-road-access-hit',
    type: 'line',
    source: 'map-road-access',
    filter: ['==', '$type', 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 18, 'line-opacity': 0.01 },
  });
  addLayer(map, {
    id: 'map-route-casing',
    type: 'line',
    source: 'map-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#07111C',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5.5, 16, 8, 20, 12],
      'line-opacity': 0.88,
    },
  });
  addLayer(map, {
    id: 'map-route-line',
    type: 'line',
    source: 'map-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      // Запрещённый для выбранной машины маршрут — оранжево-красный (предупреждение).
      'line-color': ['case', ['boolean', ['get', 'blocked'], false], '#FB923C', '#38BDF8'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 16, 4.5, 20, 7],
      'line-opacity': 0.96,
      'line-dasharray': [1, 1.35],
    },
  });
  addLayer(map, {
    id: 'map-glonass-tracks-casing',
    type: 'line',
    source: 'map-glonass-tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#05070B',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4.2, 16, 6.4, 20, 9],
      'line-opacity': 0.72,
    },
  });
  addLayer(map, {
    id: 'map-glonass-tracks-line',
    type: 'line',
    source: 'map-glonass-tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 3.5, 20, 5.8],
      'line-opacity': 0.86,
    },
  });
  // Живой след ЗА едущим маркером — обновляется анимационным циклом (rAF),
  // поэтому отдельный источник: не трогаем реактовский 'map-glonass-tracks'.
  addLayer(map, {
    id: 'map-glonass-live-trail-casing',
    type: 'line',
    source: 'map-glonass-live-trail',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#05070B',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4.2, 16, 6.4, 20, 9],
      'line-opacity': 0.72,
    },
  });
  addLayer(map, {
    id: 'map-glonass-live-trail-line',
    type: 'line',
    source: 'map-glonass-live-trail',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 3.5, 20, 5.8],
      'line-opacity': 0.86,
    },
  });
  // История/живой след должны читаться поверх нашей дороги: линия уже посажена на
  // дорожный граф, поэтому её не прячем под жёлтую линию.
  moveLayerToTop(map, 'map-glonass-history-casing');
  moveLayerToTop(map, 'map-glonass-history-line');
  moveLayerToTop(map, 'map-glonass-tracks-casing');
  moveLayerToTop(map, 'map-glonass-tracks-line');
  moveLayerToTop(map, 'map-glonass-live-trail-casing');
  moveLayerToTop(map, 'map-glonass-live-trail-line');
  addLayer(map, {
    id: 'map-draft-fill',
    type: 'fill',
    source: 'map-draft',
    filter: ['==', '$type', 'Polygon'],
    paint: {
      'fill-color': '#E8836B',
      'fill-opacity': 0.12,
      'fill-outline-color': '#E8836B',
    },
  });
  // Кисти «указание дороги» / ластик — красим СПЛОШНОЙ толстой линией прямо по
  // дороге (принцип Paint: водишь мышью — участок красится сам, без точек-вершин).
  addLayer(map, {
    id: 'map-draft-brush',
    type: 'line',
    source: 'map-draft',
    filter: ['all', ['==', '$type', 'LineString'], ['in', 'kind', 'restrict', 'restrictHover', 'eraseRoad', 'eraseAccess', 'eraseSuggestion']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], ['restrict', 'restrictHover'], '#22D3EE', '#F87171'],
      // След ластика = диаметр его кружка (2×ERASE_BRUSH_PX) — след честно
      // показывает, что именно стёрто; кисть ограничений — прежняя.
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['match', ['get', 'kind'], ['restrict', 'restrictHover'], 5, ERASE_BRUSH_PX * 2],
        16, ['match', ['get', 'kind'], ['restrict', 'restrictHover'], 10, ERASE_BRUSH_PX * 2],
        20, ['match', ['get', 'kind'], ['restrict', 'restrictHover'], 16, ERASE_BRUSH_PX * 2],
      ],
      // Ховер-подсветка «что закрасит клик» — заметно бледнее самой закраски.
      'line-opacity': ['match', ['get', 'kind'], 'restrictHover', 0.3, 0.5],
      'line-blur': 0.6,
    },
  });
  addLayer(map, {
    id: 'map-draft-line',
    type: 'line',
    source: 'map-draft',
    filter: ['all', ['==', '$type', 'LineString'], ['!in', 'kind', 'restrict', 'eraseRoad', 'eraseAccess', 'eraseSuggestion']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], '#6FBF8E',
        ['==', ['get', 'kind'], 'vehicles'], ['coalesce', ['get', 'color'], '#22D3EE'],
        ['==', ['get', 'kind'], 'restrict'], '#22D3EE',
        ['==', ['get', 'kind'], 'eraseRoad'], '#F87171',
        ['==', ['get', 'kind'], 'eraseAccess'], '#F87171',
        ['==', ['get', 'kind'], 'eraseSuggestion'], '#F87171',
        ['==', ['get', 'kind'], 'railway'], '#E5E7EB',
        ['==', ['get', 'kind'], 'road'], '#F4D58D',
        '#E8836B',
      ],
      'line-width': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], 2.6,
        ['==', ['get', 'kind'], 'restrict'], 3.4,
        ['==', ['get', 'kind'], 'eraseRoad'], 3.2,
        ['==', ['get', 'kind'], 'eraseAccess'], 3.2,
        ['==', ['get', 'kind'], 'eraseSuggestion'], 3.2,
        ['==', ['get', 'kind'], 'road'], 2.4,
        2,
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], 0.9,
        ['==', ['get', 'kind'], 'road'], 0.82,
        0.95,
      ],
      'line-dasharray': [3, 4],
    },
  });
  addLayer(map, {
    id: 'map-draft-paint-cursor',
    type: 'circle',
    source: 'map-draft',
    filter: ['==', 'kind', 'paintCursor'],
    paint: {
      // Ластик — маленький чёткий кружок РОВНО с зону реза (ERASE_BRUSH_PX);
      // «Ограничение» — прежняя мягкая рабочая область.
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        12, ['case', ['==', ['get', 'brush'], 'erase'], ERASE_BRUSH_PX, 11],
        16, ['case', ['==', ['get', 'brush'], 'erase'], ERASE_BRUSH_PX, 18],
        20, ['case', ['==', ['get', 'brush'], 'erase'], ERASE_BRUSH_PX, 28],
      ],
      'circle-color': ['coalesce', ['get', 'color'], '#22D3EE'],
      'circle-opacity': ['case', ['==', ['get', 'brush'], 'erase'], 0.4, 0.22],
      'circle-blur': ['case', ['==', ['get', 'brush'], 'erase'], 0.15, 0.45],
      'circle-stroke-color': ['coalesce', ['get', 'color'], '#22D3EE'],
      'circle-stroke-opacity': ['case', ['==', ['get', 'brush'], 'erase'], 0.9, 0.45],
      'circle-stroke-width': 1.2,
    },
  });
  addLayer(map, {
    id: 'map-draft-points',
    type: 'circle',
    source: 'map-draft',
    // Точки-вершины НЕ показываем для кистей (restrict/ластик) — там красим
    // сплошным штрихом, а не «точками».
    filter: ['all', ['==', '$type', 'Point'], ['!=', 'kind', 'paintCursor'], ['!in', 'kind', 'restrict', 'eraseRoad', 'eraseAccess', 'eraseSuggestion']],
    paint: {
      'circle-radius': 4,
      'circle-color': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], '#6FBF8E',
        ['==', ['get', 'kind'], 'vehicles'], ['coalesce', ['get', 'color'], '#22D3EE'],
        ['==', ['get', 'kind'], 'restrict'], '#22D3EE',
        '#E8836B',
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  });
}

function addGeoJsonSource(map: MapLibreMap, id: string): void {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'geojson', data: EMPTY_FEATURES as never });
}

function addLayer(map: MapLibreMap, layer: maplibregl.LayerSpecification): void {
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer);
}

function moveLayerToTop(map: MapLibreMap, id: string): void {
  if (!map.getLayer(id)) return;
  try { map.moveLayer(id); } catch { /* MapLibre может отказать во время смены style. */ }
}

function setSourceData(map: MapLibreMap, id: string, data: FeatureCollection): void {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data as never);
}

function buildAreasData(areas: MapArea[], selection: MapSelection | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas
      .filter((area) => area.vertices.length >= 3)
      .map((area) => ({
        type: 'Feature',
        properties: {
          id: area.id,
          kind: 'area',
          color: area.color,
          selected: selection?.type === 'area' && selection.id === area.id,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[...area.vertices, area.vertices[0]!].map(toCoord)],
        },
      })),
  };
}

function smoothRenderPolyline(vertices: LatLng[], radiusMeters: number): LatLng[] {
  if (vertices.length < 3 || radiusMeters <= 0) return vertices;
  const out: LatLng[] = [vertices[0]!];

  for (let i = 1; i < vertices.length - 1; i += 1) {
    const prev = vertices[i - 1]!;
    const vertex = vertices[i]!;
    const next = vertices[i + 1]!;
    const prevLen = distanceMeters(prev, vertex);
    const nextLen = distanceMeters(vertex, next);
    const angle = cornerAngleDegrees(prev, vertex, next);
    const offset = Math.min(radiusMeters, prevLen * 0.42, nextLen * 0.42);

    if (offset < 1.2 || angle > 168 || angle < 22) {
      pushRenderPoint(out, vertex);
      continue;
    }

    const before = pointToward(vertex, prev, offset);
    const after = pointToward(vertex, next, offset);
    pushRenderPoint(out, before);
    for (let step = 1; step <= 4; step += 1) {
      pushRenderPoint(out, quadraticPoint(before, vertex, after, step / 5));
    }
    pushRenderPoint(out, after);
  }

  pushRenderPoint(out, vertices[vertices.length - 1]!);
  return out;
}

function cornerAngleDegrees(prev: LatLng, vertex: LatLng, next: LatLng): number {
  const latRad = vertex.lat * Math.PI / 180;
  const ax = (prev.lng - vertex.lng) * Math.cos(latRad);
  const ay = prev.lat - vertex.lat;
  const bx = (next.lng - vertex.lng) * Math.cos(latRad);
  const by = next.lat - vertex.lat;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la <= 1e-12 || lb <= 1e-12) return 180;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return Math.acos(dot) * 180 / Math.PI;
}

function pointToward(from: LatLng, to: LatLng, meters: number): LatLng {
  const total = distanceMeters(from, to);
  if (total <= 0) return from;
  const t = Math.min(1, Math.max(0, meters / total));
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}

function quadraticPoint(a: LatLng, b: LatLng, c: LatLng, t: number): LatLng {
  const u = 1 - t;
  return {
    lat: u * u * a.lat + 2 * u * t * b.lat + t * t * c.lat,
    lng: u * u * a.lng + 2 * u * t * b.lng + t * t * c.lng,
  };
}

function pushRenderPoint(points: LatLng[], point: LatLng): void {
  const prev = points[points.length - 1];
  if (!prev || distanceMeters(prev, point) >= 0.35) points.push(point);
}

function buildRoadsData(roads: MapRoad[], selection: MapSelection | null): FeatureCollection {
  const roadLines = roads
    .filter((road) => road.vertices.length >= 2)
    .map((road) => ({
      type: 'Feature' as const,
      properties: {
        id: road.id,
        kind: 'road',
        selected: selection?.type === 'road' && selection.id === road.id,
      },
      geometry: {
        type: 'LineString',
        coordinates: smoothRenderPolyline(road.vertices, ROAD_RENDER_CORNER_RADIUS_METERS).map(toCoord),
      },
    }));
  return {
    type: 'FeatureCollection',
    features: roadLines,
  };
}

const ACCESS_RIBBON_STEP = 5; // px между параллельными лентами наложившихся участков

function buildRailwaysData(railways: MapRailway[], selection: MapSelection | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: railways
      .filter((rail) => rail.vertices.length >= 2)
      .map((rail) => ({
        type: 'Feature',
        properties: {
          id: rail.id,
          kind: 'railway',
          selected: selection?.type === 'railway' && selection.id === rail.id,
        },
        geometry: { type: 'LineString', coordinates: rail.vertices.map(toCoord) },
      })),
  };
}

/**
 * Ограничения участков: в ОБЫЧНОМ режиме карту не перегружают — видны только
 * круглые точки по краям (и красные закрытые с ⚠); сама линия почти прозрачна.
 * При наведении/выборе участок светится целиком. При выбранном типе ТС в
 * фильтре «Машина» светятся участки, где этому типу проезда НЕТ — цветом машины
 * (так участки с правилами по типу и ищутся). Наложения разводим offset-лентами.
 */
function buildRoadAccessData(
  items: RoadAccess[],
  selection: MapSelection | null,
  hoveredId: string | null,
  activeVehicle: VehicleType | null,
): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  const valid = items.filter((a) => a.vertices.length >= 2);
  // Полоса (lane) участка = сколько предыдущих участков пересекается с ним по bbox
  // (с запасом ~12 м) — простое и стабильное разведение наложений.
  const lanes = new Map<string, number>();
  const boxes = valid.map((a) => ({ id: a.id, box: bboxOf(a.vertices, 0.00016) }));
  for (let i = 0; i < boxes.length; i++) {
    let lane = 0;
    for (let j = 0; j < i; j++) {
      if (bboxIntersect(boxes[i]!.box, boxes[j]!.box)) lane += 1;
    }
    lanes.set(boxes[i]!.id, Math.min(lane, 3));
  }
  for (const access of valid) {
    const selected = selection?.type === 'roadAccess' && selection.id === access.id;
    const hovered = hoveredId === access.id;
    const lane = lanes.get(access.id) ?? 0;
    // Фильтр «Машина»: участок, где выбранный тип НЕ проедет, светится его цветом.
    const vehicleHit = activeVehicle != null && isAccessBlocking(access, activeVehicle);
    const color = vehicleHit ? vehicleColor(activeVehicle!) : accessColor(access);
    features.push({
      type: 'Feature',
      properties: {
        id: access.id,
        kind: 'roadAccess',
        accessKind: access.kind,
        color,
        offset: lane * ACCESS_RIBBON_STEP,
        selected,
        hovered: hovered || vehicleHit,
      },
      geometry: { type: 'LineString', coordinates: smoothRenderPolyline(access.vertices, ACCESS_RENDER_CORNER_RADIUS_METERS).map(toCoord) },
    });
    // Круглые маркеры начала и конца участка (наложения — смещаем перпендикулярно).
    const endShift = lane * 2.5; // метры
    for (const end of [access.vertices[0]!, access.vertices[access.vertices.length - 1]!]) {
      const shifted = endShift > 0 ? shiftPerpendicular(end, access.vertices, endShift) : end;
      features.push({
        type: 'Feature',
        properties: { id: access.id, kind: 'accessEnd', color },
        geometry: { type: 'Point', coordinates: toCoord(shifted) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Цвет участка: по виду ограничения; «ограничено» одним типом — цвет машины. */
function accessColor(access: RoadAccess): string {
  if (access.kind === 'limited') {
    if (access.vehiclesMode === 'allow' && access.vehicles.length === 1) return vehicleColor(access.vehicles[0]!);
    return ROAD_ACCESS_FALLBACK_COLOR;
  }
  return roadAccessKindMeta(access.kind).color;
}

function bboxOf(vertices: LatLng[], pad: number): [number, number, number, number] {
  let s = Infinity; let w = Infinity; let n = -Infinity; let e = -Infinity;
  for (const v of vertices) {
    if (v.lat < s) s = v.lat;
    if (v.lat > n) n = v.lat;
    if (v.lng < w) w = v.lng;
    if (v.lng > e) e = v.lng;
  }
  return [s - pad, w - pad, n + pad, e + pad];
}

function bboxIntersect(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Сдвиг точки перпендикулярно направлению ломаной в этом месте (метры). */
function shiftPerpendicular(p: LatLng, vertices: LatLng[], meters: number): LatLng {
  const a = vertices[0]!;
  const b = vertices[vertices.length - 1]!;
  const latRad = (p.lat * Math.PI) / 180;
  const dx = (b.lng - a.lng) * Math.cos(latRad);
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  // Перпендикуляр (−dy, dx), метры → градусы.
  const mLat = meters / 111_320;
  const mLng = meters / (111_320 * Math.cos(latRad));
  return {
    lat: p.lat + (dx / len) * mLat,
    lng: p.lng - (dy / len) * mLng,
  };
}

function buildRouteData(routePath: LatLng[] | null, blocked = false): FeatureCollection {
  if (!routePath || routePath.length < 2) return EMPTY_FEATURES;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'active-route', kind: 'route', blocked },
      geometry: {
        type: 'LineString',
        coordinates: smoothRenderPolyline(routePath, ROUTE_RENDER_CORNER_RADIUS_METERS).map(toCoord),
      },
    }],
  };
}

function buildGlonassTracksData(tracks: Array<{ id: string; color: string; points?: LatLng[]; segments?: LatLng[][]; mode: 'pro' | 'raw' }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((track) => trackSegments(track).length > 0)
      .map((track) => ({
        type: 'Feature',
        properties: { id: track.id, kind: 'glonassTrack', color: track.color, mode: track.mode },
        geometry: {
          type: 'MultiLineString',
          coordinates: trackSegments(track).map((segment) => smoothRenderPolyline(segment, TRACK_RENDER_CORNER_RADIUS_METERS).map(toCoord)),
        },
      })),
  };
}

function buildGlonassHistoryData(tracks: Array<{ id: string; color: string; points?: LatLng[]; segments?: LatLng[][]; opacity: number; mode: 'pro' | 'raw' }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks
      .filter((track) => trackSegments(track).length > 0)
      .map((track) => ({
        type: 'Feature',
        properties: { id: track.id, kind: 'glonassHistory', color: track.color, opacity: track.opacity, mode: track.mode },
        geometry: {
          type: 'MultiLineString',
          coordinates: trackSegments(track).map((segment) => smoothRenderPolyline(segment, TRACK_RENDER_CORNER_RADIUS_METERS).map(toCoord)),
        },
      })),
  };
}

function trackSegments(track: { points?: LatLng[]; segments?: LatLng[][] }): LatLng[][] {
  const segments = track.segments ?? (track.points ? [track.points] : []);
  return segments.filter((segment) => segment.length >= 2);
}

function buildRoadIssuesData(issues: RoadNetworkIssue[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: issues.map((issue) => ({
      type: 'Feature',
      properties: {
        id: issue.id,
        kind: issue.kind,
        meters: issue.meters,
      },
      geometry: {
        type: 'LineString',
        coordinates: [toCoord(issue.from), toCoord(issue.to)],
      },
    })),
  };
}

function buildRoadSuggestionsData(suggestions: MapRoadSuggestion[], selection: MapSelection | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: suggestions
      .filter((road) => road.vertices.length >= 2)
      .map((road) => ({
        type: 'Feature',
        properties: {
          id: road.id,
          kind: 'roadSuggestion',
          selected: selection?.type === 'roadSuggestion' && selection.id === road.id,
        },
        geometry: {
          type: 'LineString',
          coordinates: road.vertices.map(toCoord),
        },
      })),
  };
}

function buildBuildingsData(buildings: BuildingOutline[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings
      .filter((b) => b.vertices.length >= 3)
      .map((b) => ({
        type: 'Feature',
        properties: { id: b.id, kind: 'building' },
        geometry: {
          type: 'Polygon',
          coordinates: [[...b.vertices, b.vertices[0]!].map(toCoord)],
        },
      })),
  };
}

function buildExtRailwaysData(railways: ExternalRailway[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: railways
      .filter((r) => r.vertices.length >= 2)
      .map((r) => ({
        type: 'Feature',
        properties: { id: r.id, kind: 'extRailway' },
        geometry: { type: 'LineString', coordinates: r.vertices.map(toCoord) },
      })),
  };
}

function buildFootwaysData(footways: FootwayLine[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: footways
      .filter((f) => f.vertices.length >= 2)
      .map((f) => ({
        type: 'Feature',
        properties: { id: f.id, kind: 'footway', crossing: f.crossing },
        geometry: { type: 'LineString', coordinates: f.vertices.map(toCoord) },
      })),
  };
}

/** ⚠-треугольник закрытого/временно закрытого участка. */
function createAccessWarnElement(access: RoadAccess): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55));line-height:0;';
  const color = access.kind === 'temp_closed' ? '#F59E0B' : '#EF4444';
  el.innerHTML = `
    <svg width="22" height="20" viewBox="0 0 22 20">
      <path d="M11 1.5 L21 18.5 L1 18.5 Z" fill="${color}" stroke="#0A0D12" stroke-width="1.4" stroke-linejoin="round"/>
      <text x="11" y="16" text-anchor="middle" font-size="11" font-weight="800" fill="#0A0D12">!</text>
    </svg>`;
  el.title = 'Участок закрыт';
  return el;
}

/** Кандидат на ж/д переезд: заметная пилюля «Ж/Д?» + ✓/× (для редактора). */
function createCandidateElement(canEdit: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(8,11,17,.92);border:1px solid rgba(245,158,11,.65);border-radius:9px;padding:2px 6px;box-shadow:0 3px 10px rgba(0,0,0,.5);cursor:default;';
  const actions = canEdit
    ? `<button data-act="ok" title="Подтвердить переезд" style="all:unset;cursor:pointer;color:#6FBF8E;font-weight:800;font-size:12px;padding:0 3px;">✓</button>
       <button data-act="no" title="Убрать кандидата" style="all:unset;cursor:pointer;color:#F87171;font-weight:800;font-size:12px;padding:0 3px;">×</button>`
    : '';
  el.innerHTML = `<span style="color:#FBBF24;font-size:10.5px;font-weight:700;letter-spacing:.02em;">Ж/Д?</span>${actions}`;
  return el;
}

function buildOptimizeRaysData(ov: OptimizeOverlay | null): FeatureCollection {
  if (!ov?.result) return EMPTY_FEATURES;
  return {
    type: 'FeatureCollection',
    features: ov.demand.map((d, index) => ({
      type: 'Feature',
      properties: { id: `ray-${index}` },
      geometry: {
        type: 'LineString',
        coordinates: [toCoord(ov.result!.optimal), toCoord(d)],
      },
    })),
  };
}

function buildDraftData(
  tool: MapTool,
  draft: LatLng[],
  cursor: LatLng | null,
  restrictHover: LatLng[] | null = null,
  restrictParts: LatLng[][] = [],
): FeatureCollection {
  if (tool !== 'area' && tool !== 'road' && tool !== 'eraseRoad' && tool !== 'eraseAccess' && tool !== 'eraseSuggestion' && tool !== 'restrict' && tool !== 'railway' && tool !== 'confirmRoad') return EMPTY_FEATURES;
  const pts = [...draft, ...(cursor ? [cursor] : [])];
  const features: FeatureCollection['features'] = [];
  // Мягкая рабочая область вокруг курсора: кисти-ластики (красная) и
  // «Ограничение дороги» (бирюзовая) — видно, чем и где работаешь.
  const brushColor = tool === 'restrict'
    ? '#22D3EE'
    : tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion'
      ? '#F87171'
      : null;
  if (brushColor && cursor) {
    features.push({
      type: 'Feature',
      properties: { id: 'paint-cursor', kind: 'paintCursor', color: brushColor, brush: tool === 'restrict' ? 'restrict' : 'erase' },
      geometry: { type: 'Point', coordinates: toCoord(cursor) },
    });
  }
  // Подсветка отрезка дороги под курсором («что закрасит клик») — до нажатия.
  if (tool === 'restrict' && restrictHover && restrictHover.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { id: 'restrict-hover', kind: 'restrictHover' },
      geometry: { type: 'LineString', coordinates: restrictHover.map(toCoord) },
    });
  }
  if (tool === 'restrict') {
    restrictParts.forEach((part, index) => {
      if (part.length < 2) return;
      features.push({
        type: 'Feature',
        properties: { id: `restrict-part-${index}`, kind: 'restrict' },
        geometry: { type: 'LineString', coordinates: part.map(toCoord) },
      });
    });
  }
  draft.forEach((p, index) => {
    features.push({
      type: 'Feature',
      properties: { id: `draft-point-${index}`, kind: tool },
      geometry: { type: 'Point', coordinates: toCoord(p) },
    });
  });
  if (draft.length === 0) return { type: 'FeatureCollection', features };
  if (tool === 'area') {
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { id: 'draft-area', kind: 'area' },
        geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]!].map(toCoord)] },
      });
    } else if (pts.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { id: 'draft-area-line', kind: 'area' },
        geometry: { type: 'LineString', coordinates: pts.map(toCoord) },
      });
    }
  } else if (pts.length >= 2) {
    // Кисти-ластики: линию тянем только по СЛЕДУ кисти (draft), без хвоста к
    // курсору — стирание уже применено живьём, хвост бы врал.
    const lineCoords = tool === 'eraseRoad' || tool === 'eraseAccess' || tool === 'eraseSuggestion' || tool === 'restrict' ? draft : pts;
    if (lineCoords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { id: 'draft-road', kind: tool },
        geometry: { type: 'LineString', coordinates: smoothRenderPolyline(lineCoords, tool === 'restrict' ? ACCESS_RENDER_CORNER_RADIUS_METERS : TRACK_RENDER_CORNER_RADIUS_METERS).map(toCoord) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function snapToRoadSuggestions(raw: LatLng, suggestions: MapRoadSuggestion[], maxDistanceMeters: number): LatLng | null {
  let best: { point: LatLng; distance: number } | null = null;
  for (const suggestion of suggestions) {
    const hit = nearestPointOnPolyline(raw, suggestion.vertices);
    if (!hit || hit.distance > maxDistanceMeters) continue;
    if (!best || hit.distance < best.distance) best = { point: hit.point, distance: hit.distance };
  }
  return best?.point ?? null;
}

/** Прилипание к УЖЕ нарисованным дорогам (для трассы «Особенности» — кусок лежит на дороге). */
function snapToRoads(raw: LatLng, roads: MapRoad[], maxDistanceMeters: number): LatLng | null {
  let best: { point: LatLng; distance: number } | null = null;
  for (const road of roads) {
    const hit = nearestPointOnPolyline(raw, road.vertices);
    if (!hit || hit.distance > maxDistanceMeters) continue;
    if (!best || hit.distance < best.distance) best = { point: hit.point, distance: hit.distance };
  }
  return best?.point ?? null;
}

/**
 * Отрезок ближайшей дороги вокруг курсора (± halfMeters по её линии) — ховер-
 * подсветка и «клик красит ровно подсвеченное» в инструменте «Ограничение».
 */
function roadStretchNear(raw: LatLng, roads: MapRoad[], halfMeters: number): LatLng[] | null {
  let best: { road: MapRoad; point: LatLng; distance: number; segmentIndex: number } | null = null;
  for (const road of roads) {
    const hit = nearestPointOnPolyline(raw, road.vertices);
    if (!hit || hit.distance > VEHICLE_TRACE_SNAP_METERS) continue;
    if (!best || hit.distance < best.distance) {
      best = { road, point: hit.point, distance: hit.distance, segmentIndex: hit.segmentIndex };
    }
  }
  if (!best) return null;
  const v = best.road.vertices;
  const walk = (dir: -1 | 1): LatLng[] => {
    const out: LatLng[] = [];
    let acc = 0;
    let cur = best!.point;
    let i = dir === -1 ? best!.segmentIndex : best!.segmentIndex + 1;
    while (i >= 0 && i < v.length && acc < halfMeters) {
      const target = v[i]!;
      const d = distanceMeters(cur, target);
      if (d > 0.01) {
        if (acc + d >= halfMeters) {
          const t = (halfMeters - acc) / d;
          out.push({ lat: cur.lat + (target.lat - cur.lat) * t, lng: cur.lng + (target.lng - cur.lng) * t });
          break;
        }
        out.push(target);
        acc += d;
        cur = target;
      }
      i += dir;
    }
    return out;
  };
  const back = walk(-1).reverse();
  const forward = walk(1);
  const stretch = [...back, best.point, ...forward];
  return stretch.length >= 2 ? stretch : null;
}

/** Точка примерно на середине ломаной (по длине) — для подписи участка. */
function midpointOfPolyline(vertices: LatLng[]): LatLng {
  if (vertices.length === 0) return { lat: 0, lng: 0 };
  if (vertices.length === 1) return vertices[0]!;
  let total = 0;
  for (let i = 0; i < vertices.length - 1; i++) total += distanceMeters(vertices[i]!, vertices[i + 1]!);
  let half = total / 2;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]!;
    const b = vertices[i + 1]!;
    const seg = distanceMeters(a, b);
    if (seg >= half) {
      const t = seg > 0 ? half / seg : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    half -= seg;
  }
  return vertices[Math.floor(vertices.length / 2)]!;
}

function createPointMarker({
  map,
  point,
  warehouse,
  selected,
  dimmed,
  draggable,
  canEdit,
  hidden,
  onSelect,
  onMovePoint,
  onContextMenu,
}: {
  map: MapLibreMap;
  point: MapPoint;
  warehouse: Warehouse | undefined;
  selected: boolean;
  dimmed: boolean;
  draggable: boolean;
  canEdit: boolean;
  hidden: boolean;
  onSelect: (sel: MapSelection | null) => void;
  onMovePoint: (id: string, latlng: LatLng) => void;
  onContextMenu: (id: string, clientX: number, clientY: number) => void;
}): Marker {
  const color = warehouse
    ? ({ removed: '#D96666', shipping: '#C99BE0', scheduled: '#6FBF8E', idle: '#5BA3D0' }[getWarehouseState(warehouse)])
    : '#9AA4B2';
  // Компактная подпись (карта не мусорится): без наведения — ТОЛЬКО номер склада;
  // при наведении — полное название («погрузка», «отделение ОНРС»…) (юзер 2026-07-09).
  const fullLabel = [warehouse?.id, point.label.trim() || point.comment.trim()]
    .filter(Boolean).join(' · ') || 'Точка';
  const shortLabel = warehouse?.id
    || (point.label.trim().length > 12 ? `${point.label.trim().slice(0, 11)}…` : point.label.trim());
  const el = createPinElement(color, shortLabel, selected, dimmed);
  const labelEl = el.querySelector<HTMLDivElement>('[data-pin-label]');
  if (labelEl && fullLabel !== shortLabel) {
    el.addEventListener('mouseenter', () => { labelEl.textContent = fullLabel; });
    el.addEventListener('mouseleave', () => { labelEl.textContent = shortLabel; });
  }
  if (hidden) el.style.display = 'none';
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    onSelect({ type: 'point', id: point.id });
  });
  if (canEdit) {
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(point.id, event.clientX, event.clientY);
    });
  }
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable, subpixelPositioning: true })
    .setLngLat(toCoord(point))
    .addTo(map);
  if (draggable) marker.on('dragend', () => onMovePoint(point.id, toLatLng(marker.getLngLat())));
  return marker;
}

function addOptimizeMarkers(
  map: MapLibreMap,
  markers: Marker[],
  ov: OptimizeOverlay | null,
  onGhostMove: (latlng: LatLng) => void,
): void {
  if (!ov) return;
  markers.push(
    new maplibregl.Marker({ element: createSourceRingElement(), anchor: 'center' })
      .setLngLat(toCoord(ov.source))
      .addTo(map),
  );
  if (ov.result) {
    markers.push(
      new maplibregl.Marker({ element: createOptElement('#6FBF8E'), anchor: 'center' })
        .setLngLat(toCoord(ov.result.optimal))
        .addTo(map),
    );
    if (ov.result.snapped) {
      markers.push(
        new maplibregl.Marker({ element: createOptElement('#5BA3D0', true), anchor: 'center' })
          .setLngLat(toCoord(ov.result.snapped))
          .addTo(map),
      );
    }
  }
  if (ov.ghost) {
    const marker = new maplibregl.Marker({ element: createGhostElement(), anchor: 'center', draggable: true })
      .setLngLat(toCoord(ov.ghost))
      .addTo(map);
    marker.getElement().addEventListener('click', (event) => event.stopPropagation());
    marker.on('drag', () => onGhostMove(toLatLng(marker.getLngLat())));
    marker.on('dragend', () => onGhostMove(toLatLng(marker.getLngLat())));
    markers.push(marker);
  }
}

function clearMarkers(markers: Marker[]): void {
  for (const marker of markers) marker.remove();
}

function clearGlonassMarkerEntries(entries: Map<number, GlonassMarkerEntry>): void {
  for (const entry of entries.values()) {
    clearGlonassEntry(entry);
  }
  entries.clear();
}

function clearGlonassReplayEntry(ref: MutableRefObject<GlonassReplayMarkerEntry | null>): void {
  if (!ref.current) return;
  clearGlonassEntry(ref.current);
  ref.current = null;
}

function clearGlonassEntry(entry: GlonassMarkerEntry): void {
  if (entry.frame != null) cancelAnimationFrame(entry.frame);
  entry.marker.remove();
  entry.frame = null;
}

function updateGlonassMarkerElement(el: HTMLDivElement, m: GlonassMarker): void {
  const next = createGlonassMarkerElement(m);
  // ВАЖНО: только меняем содержимое. cssText НЕ трогаем — там лежит transform
  // от MapLibre (позиция маркера). Перезапись cssText стирала transform до
  // следующего кадра → маркер мелькал в левом верхнем углу и «прыгал».
  el.replaceChildren(...Array.from(next.childNodes));
  el.title = next.title;
}

function updateGlonassReplayMarkerElement(el: HTMLDivElement, m: GlonassReplayMarker): void {
  const next = createGlonassReplayMarkerElement(m);
  el.replaceChildren(...Array.from(next.childNodes));
  el.title = next.title;
}

function animateGlonassMarker(entry: GlonassMarkerEntry, target: LatLng, durationMs: number, roadPath?: LatLng[]): void {
  if (entry.frame != null) cancelAnimationFrame(entry.frame);
  const current = entry.marker.getLngLat();
  const start = { lat: current.lat, lng: current.lng };
  const meters = distanceMeters(start, target);
  if (!Number.isFinite(meters) || meters < 0.3 || meters > GLONASS_MARKER_JUMP_METERS) {
    entry.marker.setLngLat([target.lng, target.lat]);
    entry.frame = null;
    return;
  }
  const startedAt = performance.now();
  const duration = meters < 6 ? Math.min(1600, durationMs) : Math.max(180, durationMs);
  const motionPath = buildGlonassMotionPath(start, target, roadPath);
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - startedAt) / duration));
    const eased = easeInOutCubic(t);
    const point = motionPath ? pointAlongPolyline(motionPath, eased) : {
      lat: start.lat + (target.lat - start.lat) * eased,
      lng: start.lng + (target.lng - start.lng) * eased,
    };
    entry.marker.setLngLat([point.lng, point.lat]);
    if (t < 1) {
      entry.frame = requestAnimationFrame(step);
    } else {
      entry.marker.setLngLat([target.lng, target.lat]);
      entry.frame = null;
    }
  };
  entry.frame = requestAnimationFrame(step);
}

function buildGlonassMotionPath(start: LatLng, target: LatLng, roadPath: LatLng[] | undefined): LatLng[] | null {
  if (!roadPath || roadPath.length < 2) return null;
  const clean = cleanMotionPath(roadPath);
  if (clean.length < 2) return null;
  const end = clean[clean.length - 1]!;
  if (distanceMeters(end, target) > 18) clean.push(target);

  const hit = nearestPointOnPolyline(start, clean);
  if (!hit || hit.distance > 65) return [start, ...clean.slice(-Math.min(clean.length, 8))];
  const sliced = slicePolylineFromHit(clean, hit.segmentIndex, hit.t);
  if (sliced.length < 2) return null;
  return hit.distance > 1 ? [start, ...sliced] : sliced;
}

function cleanMotionPath(path: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const point of path) {
    const prev = out[out.length - 1];
    if (!prev || distanceMeters(prev, point) >= 0.6) out.push(point);
  }
  return out;
}

function slicePolylineFromHit(path: LatLng[], segmentIndex: number, t: number): LatLng[] {
  const a = path[Math.max(0, Math.min(segmentIndex, path.length - 1))]!;
  const b = path[Math.max(0, Math.min(segmentIndex + 1, path.length - 1))] ?? a;
  const start = {
    lat: a.lat + (b.lat - a.lat) * Math.max(0, Math.min(1, t)),
    lng: a.lng + (b.lng - a.lng) * Math.max(0, Math.min(1, t)),
  };
  return [start, ...path.slice(segmentIndex + 1)];
}

function pointAlongPolyline(path: LatLng[], ratio: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1) return path[0]!;
  const target = polylineLength(path) * Math.max(0, Math.min(1, ratio));
  let walked = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = distanceMeters(a, b);
    if (walked + len >= target) {
      const t = len > 0 ? (target - walked) / len : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      };
    }
    walked += len;
  }
  return path[path.length - 1]!;
}

function polylineLength(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) total += distanceMeters(path[i]!, path[i + 1]!);
  return total;
}

/** Позиция на timed-пути в момент ms: lerp между соседними по времени точками. */
function pointAtTimedPath(path: GlonassTimedPathPoint[], ms: number): LatLng {
  const first = path[0]!;
  const last = path[path.length - 1]!;
  const firstMs = Date.parse(first.time);
  const lastMs = Date.parse(last.time);
  if (!Number.isFinite(ms) || !Number.isFinite(firstMs) || ms <= firstMs) return first;
  if (!Number.isFinite(lastMs) || ms >= lastMs) return last;
  // Бинарный поиск последней точки со временем <= ms.
  let lo = 0;
  let hi = path.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const t = Date.parse(path[mid]!.time);
    if (Number.isFinite(t) && t <= ms) lo = mid;
    else hi = mid - 1;
  }
  const a = path[lo]!;
  const b = path[Math.min(lo + 1, path.length - 1)]!;
  const aMs = Date.parse(a.time);
  const bMs = Date.parse(b.time);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs) || bMs <= aMs) return a;
  // Разрыв пути (нет дороги между точками): машина стоит на берегу и потом
  // телепортируется, а не летит по диагонали через здания.
  if (b.gapBefore) return { lat: a.lat, lng: a.lng };
  const t = Math.min(1, Math.max(0, (ms - aMs) / (bMs - aMs)));
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Хвост живого следа: точки пути до момента ms + текущая позиция, не длиннее meters. */
function liveTrailBehind(path: GlonassTimedPathPoint[], ms: number, pos: LatLng, meters: number): LatLng[] {
  const pts: LatLng[] = [];
  for (const p of path) {
    const t = Date.parse(p.time);
    if (Number.isFinite(t) && t > ms) break;
    // Разрыв пути: след начинается заново ПОСЛЕ разрыва — без диагонали.
    if (p.gapBefore) pts.length = 0;
    pts.push({ lat: p.lat, lng: p.lng });
  }
  pts.push(pos);
  // Обрезаем с хвоста до ~meters (след — «откуда едет», не весь путь).
  let acc = 0;
  let from = pts.length - 1;
  while (from > 0) {
    acc += distanceMeters(pts[from - 1]!, pts[from]!);
    if (acc >= meters) break;
    from -= 1;
  }
  return pts.slice(from);
}

function liveMarkerAnimationMs(entry: GlonassMarkerEntry, time: string | null): number {
  const next = parseMarkerTimeMs(time);
  const prev = entry.targetAt;
  entry.targetAt = next;
  if (prev != null && next != null && next > prev) {
    return Math.max(2600, Math.min(15_000, (next - prev) * 0.88));
  }
  return GLONASS_MARKER_ANIMATION_MS;
}

function parseMarkerTimeMs(time: string | null | undefined): number | null {
  if (!time) return null;
  const ms = Date.parse(time);
  return Number.isFinite(ms) ? ms : null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Маркер машины ГЛОНАСС: компактный fleet-бейдж + гаражный № + курс. */
function createGlonassMarkerElement(m: GlonassMarker): HTMLDivElement {
  const color = STATUS_COLOR[m.status];
  const wrap = document.createElement('div');
  // Важно: MapLibre якорит НИЗ этого контейнера. Маленькая точка внизу — это
  // точная GPS-координата; бейдж машины стоит над ней и не «плавает» при зуме.
  wrap.style.cssText = 'position:relative;width:122px;height:54px;overflow:visible;pointer-events:none;';
  wrap.title = `${m.garage ? m.garage + '  ' : ''}${m.gos} — ${STATUS_LABEL[m.status]} · ${formatGlonassSpeed(m.speed)}`.trim();

  const marker = document.createElement('div');
  marker.style.cssText =
    'position:absolute;left:61px;bottom:10px;z-index:2;display:flex;align-items:center;gap:5px;min-width:54px;max-width:108px;height:30px;'
    + 'transform:translateX(-50%);pointer-events:auto;'
    + `padding:3px 8px 3px 3px;border-radius:9px;background:linear-gradient(90deg,${hexToRgba(color, 0.2)},rgba(8,11,17,0.94) 54%);`
    + `border:1.5px solid ${color};color:#fff;`
    + 'box-shadow:0 10px 24px rgba(0,0,0,0.38),0 2px 7px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.12);'
    + 'backdrop-filter:blur(8px);';

  const icon = document.createElement('span');
  icon.style.cssText =
    `position:relative;display:flex;align-items:center;justify-content:center;width:27px;height:24px;`
    + `border-radius:7px;background:${color};color:#fff;flex:0 0 auto;`
    + 'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.32),0 0 0 1px rgba(8,11,17,0.72);';
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>'
    + '<path d="M15 18H9"/>'
    + '<path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.22-.62L18.3 8.4A1 1 0 0 0 17.5 8H14"/>'
    + '<circle cx="17" cy="18" r="2"/>'
    + '<circle cx="7" cy="18" r="2"/>'
    + '</svg>';

  // Курс приходит из живого фида сайта. Показываем его отдельным маленьким
  // шевроном СНАРУЖИ перед машиной, не вращая сам бейдж и номер.
  if (m.course != null && m.status === 'moving') {
    wrap.appendChild(createCourseArrow(color, m.course, true));
  }

  const label = document.createElement('span');
  label.style.cssText =
    'display:flex;min-width:28px;max-width:66px;flex-direction:column;gap:1px;overflow:hidden;white-space:nowrap;';
  const garage = document.createElement('span');
  garage.style.cssText =
    'display:block;overflow:hidden;text-overflow:ellipsis;'
    + 'font:850 11.5px/1 Inter,Arial,sans-serif;letter-spacing:0;color:#fff;'
    + 'text-shadow:0 1px 2px rgba(0,0,0,0.75);';
  garage.textContent = m.garage || m.gos || '?';
  const speed = document.createElement('span');
  speed.style.cssText =
    'display:block;overflow:hidden;text-overflow:ellipsis;'
    + 'font:700 8.5px/1 Inter,Arial,sans-serif;letter-spacing:0;color:rgba(255,255,255,0.82);'
    + 'text-shadow:0 1px 2px rgba(0,0,0,0.75);';
  speed.textContent = formatGlonassSpeed(m.speed);
  label.append(garage, speed);

  marker.append(icon, label);
  wrap.append(createGlonassAnchor(color), marker);

  // «Плохой сигнал»: статус «движется», но машина стоит на месте. Жёлтый ⚠ с
  // таймером НАД машиной (таймер тикает отдельным интервалом по data-bad-since).
  if (m.badSince != null) {
    const warn = document.createElement('div');
    warn.style.cssText =
      'position:absolute;left:61px;bottom:44px;transform:translateX(-50%);z-index:6;'
      + 'display:flex;align-items:center;gap:4px;white-space:nowrap;pointer-events:none;'
      + 'padding:2px 7px;border-radius:8px;background:rgba(146,64,14,0.96);border:1.5px solid #F59E0B;'
      + 'color:#FEF3C7;font:800 10px/1 Inter,Arial,sans-serif;box-shadow:0 5px 14px rgba(0,0,0,0.5);';
    const secs = Math.max(0, Math.round((Date.now() - m.badSince) / 1000));
    warn.innerHTML = `⚠ Нет сигнала <span data-bad-since="${m.badSince}" style="font-variant-numeric:tabular-nums;">${formatBadTimer(secs)}</span>`;
    wrap.appendChild(warn);
  }
  return wrap;
}

/** Таймер «плохого сигнала» м:сс с начала. */
function formatBadTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Маркер исторического проигрывателя: та же логика машины, но без live-статуса. */
function createGlonassReplayMarkerElement(m: GlonassReplayMarker): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:122px;height:54px;overflow:visible;pointer-events:none;';
  wrap.title = `${m.garage ? m.garage + '  ' : ''}${m.gos} — история · ${formatGlonassSpeed(m.speed)} · ${formatMarkerTime(m.time)}`.trim();

  const marker = document.createElement('div');
  marker.style.cssText =
    'position:absolute;left:61px;bottom:10px;z-index:2;display:flex;align-items:center;gap:5px;min-width:58px;max-width:108px;height:30px;'
    + 'transform:translateX(-50%);pointer-events:auto;'
    + `padding:3px 8px 3px 3px;border-radius:9px;background:linear-gradient(90deg,${hexToRgba(m.color, 0.24)},rgba(8,11,17,0.94) 54%);`
    + `border:1.5px solid ${m.color};color:#fff;`
    + 'box-shadow:0 10px 24px rgba(0,0,0,0.38),0 2px 7px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.12);'
    + 'backdrop-filter:blur(8px);';

  const icon = document.createElement('span');
  icon.style.cssText =
    `display:flex;align-items:center;justify-content:center;width:27px;height:24px;border-radius:7px;background:${m.color};color:#fff;flex:0 0 auto;`
    + 'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.32),0 0 0 1px rgba(8,11,17,0.72);';
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>'
    + '<path d="M15 18H9"/>'
    + '<path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.22-.62L18.3 8.4A1 1 0 0 0 17.5 8H14"/>'
    + '<circle cx="17" cy="18" r="2"/>'
    + '<circle cx="7" cy="18" r="2"/>'
    + '</svg>';

  if (m.course != null && (m.speed ?? 0) > 3) {
    wrap.appendChild(createCourseArrow(m.color, m.course, false));
  }

  const label = document.createElement('span');
  label.style.cssText = 'display:flex;min-width:30px;max-width:70px;flex-direction:column;gap:1px;overflow:hidden;white-space:nowrap;';
  const garage = document.createElement('span');
  garage.style.cssText =
    'display:block;overflow:hidden;text-overflow:ellipsis;font:850 11.5px/1 Inter,Arial,sans-serif;letter-spacing:0;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.75);';
  garage.textContent = m.garage || m.gos || '?';
  const speed = document.createElement('span');
  speed.style.cssText =
    'display:block;overflow:hidden;text-overflow:ellipsis;font:700 8.5px/1 Inter,Arial,sans-serif;letter-spacing:0;color:rgba(255,255,255,0.82);text-shadow:0 1px 2px rgba(0,0,0,0.75);';
  speed.textContent = formatGlonassSpeed(m.speed);
  label.append(garage, speed);

  marker.append(icon, label);
  wrap.append(createGlonassAnchor(m.color), marker);
  return wrap;
}

function createGlonassAnchor(color: string): HTMLDivElement {
  const anchor = document.createElement('div');
  anchor.style.cssText =
    'position:absolute;left:61px;bottom:-3px;z-index:3;width:7px;height:7px;margin-left:-3.5px;border-radius:999px;'
    + `background:${color};border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.75),0 0 0 2px rgba(8,11,17,0.72);`
    + 'pointer-events:none;';

  const stem = document.createElement('div');
  stem.style.cssText =
    'position:absolute;left:61px;bottom:4px;z-index:1;width:2px;height:8px;margin-left:-1px;border-radius:999px;'
    + `background:linear-gradient(180deg,${hexToRgba(color, 0.85)},${hexToRgba(color, 0.22)});`
    + 'box-shadow:0 1px 3px rgba(0,0,0,0.55);pointer-events:none;';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  wrap.append(stem, anchor);
  return wrap;
}

function createCourseArrow(color: string, course: number, withInnerLine: boolean): HTMLDivElement {
  const arrowPos = courseOffset(course, 34);
  const arrow = document.createElement('div');
  arrow.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">'
    + `<path d="M12 2.4 19.2 21.1 12 16.8 4.8 21.1 12 2.4Z" fill="${color}" stroke="white" stroke-width="1.9" stroke-linejoin="round"/>`
    + (withInnerLine ? '<path d="M12 7.4v7.2" stroke="rgba(8,11,17,0.5)" stroke-width="1.5" stroke-linecap="round"/>' : '')
    + '</svg>';
  arrow.style.cssText =
    `position:absolute;left:${61 + arrowPos.x}px;top:${29 + arrowPos.y}px;margin:-12px 0 0 -12px;width:24px;height:24px;z-index:1;`
    + `transform:rotate(${normalizeCourse(course)}deg);transform-origin:50% 50%;`
    + 'opacity:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.82));pointer-events:none;';
  return arrow;
}

function formatMarkerTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return `rgba(255,255,255,${alpha})`;
  const n = Number.parseInt(raw, 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function normalizeCourse(course: number): number {
  return ((course % 360) + 360) % 360;
}

function courseOffset(course: number, distancePx: number): { x: number; y: number } {
  const rad = normalizeCourse(course) * Math.PI / 180;
  return {
    x: Math.sin(rad) * distancePx,
    y: -Math.cos(rad) * distancePx,
  };
}

function toLatLng(p: maplibregl.LngLat | LatLng): LatLng {
  if ('lng' in p && 'lat' in p) return { lat: p.lat, lng: p.lng };
  return p;
}

function toCoord(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

function centroid(verts: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const v of verts) {
    lat += v.lat;
    lng += v.lng;
  }
  return { lat: lat / verts.length, lng: lng / verts.length };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] ?? ch));
}

/**
 * Пин точки — аккуратная «капля» с белой обводкой и кольцом выделения. Никаких
 * данных на карте, кроме подписи (чтобы не было шума). Идеальная симметричная
 * форма, лёгкая тень, центральная точка.
 */
function createPinElement(
  color: string,
  label: string,
  selected: boolean,
  dimmed = false,
): HTMLDivElement {
  // Пин КОМПАКТНЫЙ (карта не мусорится): капля 22×29, подпись 10px. Полное
  // название подставляется по наведению (createPointMarker меняет текст).
  const el = document.createElement('div');
  el.style.width = '36px';
  el.style.height = '42px';
  el.style.cursor = 'pointer';
  // Точка, куда выбранная машина НЕ заедет — гасим и помечаем «стоп».
  el.style.opacity = dimmed ? '0.4' : '1';
  el.innerHTML = `
    <div style="position:relative;width:36px;height:42px;pointer-events:auto;">
      ${label ? `<div data-pin-label style="position:absolute;left:50%;top:0;transform:translateX(-50%);max-width:150px;padding:1px 6px;border-radius:5px;background:rgba(8,11,17,.78);color:#fff;font:600 10px/13px Inter,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.75);">${esc(label)}</div>` : ''}
      ${selected ? `<div style="position:absolute;left:50%;top:33px;width:12px;height:5px;margin-left:-6px;border-radius:999px;background:rgba(0,0,0,.32);filter:blur(2px);"></div><div style="position:absolute;left:50%;top:17px;width:20px;height:20px;margin-left:-10px;border-radius:999px;background:${color};opacity:.16;box-shadow:0 0 0 6px ${color}24;"></div>` : ''}
      <svg width="22" height="29" viewBox="-15 -40 30 40" style="position:absolute;left:7px;top:12px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));">
        <path d="M0 0 C -8.5 -13 -12.5 -19 -12.5 -27 a 12.5 12.5 0 1 1 25 0 C 12.5 -19 8.5 -13 0 0 Z" fill="${color}" stroke="#ffffff" stroke-width="${selected ? 2.5 : 2}" stroke-opacity="${selected ? '1' : '.9'}"/>
        <circle cx="0" cy="-27" r="4.2" fill="#fff" fill-opacity=".95" stroke="#0c0f14" stroke-width="1.1"/>
      </svg>
      ${dimmed ? `<svg width="13" height="13" viewBox="0 0 16 16" style="position:absolute;left:20px;top:9px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7));"><circle cx="8" cy="8" r="7" fill="#EF4444" stroke="#fff" stroke-width="1.4"/><rect x="3.6" y="6.8" width="8.8" height="2.4" rx="1.2" fill="#fff"/></svg>` : ''}
    </div>`;
  return el;
}

/**
 * Значок ж/д переезда — красно-белый шлагбаум-«палка» с крестом-знаком. Просто
 * факт пересечения с ж/д (риск задержки), без данных про шлагбаум/светофор.
 */
function createCrossingElement(crossing: MapCrossing, selected: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '44px';
  el.style.height = '40px';
  el.style.cursor = 'pointer';
  const glow = selected ? 'filter:drop-shadow(0 0 4px #fff);' : 'filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));';
  // Подпись = № ж/д пути («271») — показывается ТОЛЬКО при наведении (карта не
  // мусорится); ищется через поиск по № пути (юзер 2026-07-09).
  const labelText = crossing.name.trim() ? `Ж/д ${esc(crossing.name.trim())}` : '';
  if (labelText) {
    el.addEventListener('mouseenter', () => {
      const lbl = el.querySelector<HTMLDivElement>('[data-crossing-label]');
      if (lbl) lbl.style.display = 'block';
    });
    el.addEventListener('mouseleave', () => {
      const lbl = el.querySelector<HTMLDivElement>('[data-crossing-label]');
      if (lbl) lbl.style.display = 'none';
    });
  }
  el.innerHTML = `
    <div style="position:relative;width:44px;height:40px;pointer-events:auto;">
      ${labelText ? `<div data-crossing-label style="display:none;position:absolute;left:50%;top:-12px;transform:translateX(-50%);max-width:110px;padding:1px 5px;border-radius:4px;background:rgba(8,11,17,.72);color:#FCD34D;font:700 10.5px/14px Inter,Arial,sans-serif;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);">${labelText}</div>` : ''}
      <svg width="44" height="40" viewBox="0 0 44 40" style="position:absolute;left:0;top:0;${glow}">
        <g transform="translate(33 6)"><path d="M0 0 L8 8 M8 0 L0 8" stroke="#FBBF24" stroke-width="2.4" stroke-linecap="round"/></g>
        <g transform="rotate(-18 22 22)">
          <rect x="4" y="19" width="36" height="6" rx="2" fill="#fff" stroke="#0c0f14" stroke-width="1"/>
          <rect x="4" y="19" width="9" height="6" fill="#EF4444"/>
          <rect x="22" y="19" width="9" height="6" fill="#EF4444"/>
          <circle cx="6" cy="22" r="3.4" fill="#1F2937" stroke="#fff" stroke-width="1"/>
        </g>
      </svg>
    </div>`;
  return el;
}

/**
 * Кружок «Высота проезда» — как дорожный знак ограничения высоты: белый круг с
 * красной каймой, внутри метры («5,3»). Точные мм/см — в карточке по клику.
 */
function createClearanceElement(clearance: MapClearance, selected: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '40px';
  el.style.height = '40px';
  el.style.cursor = 'pointer';
  const glow = selected
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.85),0 2px 6px rgba(0,0,0,.6);'
    : 'box-shadow:0 0 0 1px rgba(10,13,18,.85),0 2px 5px rgba(0,0,0,.55);';
  el.innerHTML = `
    <div style="position:relative;width:40px;height:40px;pointer-events:auto;">
      <div style="position:absolute;inset:1px;border-radius:999px;background:#FFFFFF;border:2.5px solid #EF4444;${glow}display:flex;align-items:center;justify-content:center;">
        <span style="font:800 11.5px/1 Inter,Arial,sans-serif;color:#111827;letter-spacing:-0.15px;">${esc(formatClearanceMeters(clearance.heightMm))}</span>
      </div>
    </div>`;
  return el;
}

function createFixedPointPreview(point: MapPoint): JSX.Element {
  const label = point.label || point.warehouseId || 'Точка';
  return (
    <div className="flex flex-col items-center drop-shadow-[0_3px_8px_rgba(0,0,0,.75)]">
      <div className="mb-0.5 max-w-[110px] truncate rounded bg-[#080b11]/85 px-1.5 py-0.5 text-[11px] font-bold text-white">
        {label}
      </div>
      <div className="relative h-[42px] w-[30px]">
        <div className="absolute left-[6px] top-[8px] h-5 w-5 rounded-full bg-emerald-400/25 ring-8 ring-emerald-400/15" />
        <svg width="30" height="42" viewBox="-15 -42 30 42" className="absolute left-0 top-0">
          <path d="M0 0 C -9 -14 -13 -20 -13 -28 a 13 13 0 1 1 26 0 C 13 -20 9 -14 0 0 Z" fill="#34D399" stroke="#0c0f14" strokeWidth="2.2" />
          <circle cx="0" cy="-28" r="4.8" fill="#0c0f14" fillOpacity=".86" />
        </svg>
      </div>
    </div>
  );
}

function createLabelElement(text: string, color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '180px';
  el.style.textAlign = 'center';
  el.style.color = color;
  el.style.font = '700 13px/20px Inter,Arial,sans-serif';
  el.style.textShadow = '0 1px 3px rgba(0,0,0,.85),0 0 4px rgba(0,0,0,.9)';
  el.style.pointerEvents = 'none';
  el.textContent = text;
  return el;
}

function createOptElement(color: string, ring = false): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '30px';
  el.style.height = '30px';
  el.style.pointerEvents = 'none';
  el.innerHTML = `
    <div style="position:relative;width:30px;height:30px;">
      ${ring ? `<div style="position:absolute;inset:2px;border:1.5px dashed ${color};border-radius:999px;"></div>` : ''}
      <div style="position:absolute;left:8px;top:8px;width:14px;height:14px;border-radius:999px;background:${color}44;border:2px solid ${color};"></div>
      <div style="position:absolute;left:5px;top:14px;width:20px;height:2px;background:${color};"></div>
      <div style="position:absolute;left:14px;top:5px;width:2px;height:20px;background:${color};"></div>
    </div>`;
  return el;
}

function createGhostElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '28px';
  el.style.height = '28px';
  el.style.cursor = 'grab';
  el.innerHTML = `
    <div style="width:28px;height:28px;border-radius:999px;background:#E0B84D44;border:2px solid #E0B84D;box-shadow:0 0 0 5px rgba(224,184,77,.16);">
      <div style="width:6px;height:6px;margin:9px;border-radius:999px;background:#E0B84D;"></div>
    </div>`;
  return el;
}

function createSourceRingElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '20px';
  el.style.height = '20px';
  el.style.borderRadius = '999px';
  el.style.border = '2px solid #C99BE0';
  el.style.boxSizing = 'border-box';
  el.style.pointerEvents = 'none';
  return el;
}
