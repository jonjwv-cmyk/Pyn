import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ROAD_PAINT_OPTIONS,
  roadPaintOption,
  vehicleColor,
  type LatLng,
  type MapArea,
  type MapCrossing,
  type MapDoc,
  type MapPoint,
  type MapRailway,
  type MapRoad,
  type MapRoadSuggestion,
  type MapTool,
  type RoadAccess,
  type RoadPaintMode,
  type VehicleType,
} from './map-types';
import type { OptimizeResult } from './optimize';
import { distanceMeters, nearestPointOnPolyline } from './geo';

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

export interface MapSelection {
  type: 'point' | 'area' | 'road' | 'roadSuggestion' | 'roadAccess' | 'crossing' | 'railway';
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
  routePath: LatLng[] | null;
  /** Маршрут задевает запрещённый для машины участок — рисуем его тревожно. */
  routeBlocked: boolean;
  /** Показывать радар осадков (RainViewer). */
  showWeather: boolean;
  /** Нонс кадра радара — меняется → пересоздаём слой осадков (свежий кадр). */
  weatherNonce: number;
  /** Лёгкая сетка ветра/давления по видимой области. */
  weatherField: WeatherFieldPoint[];
  /** Высота центра карты (м н.у.м.) — показываем в статус-баре всегда. null — нет. */
  centerElevation: number | null;
  roadPaintMode: RoadPaintMode;
  movingPointId: string | null;
  /** Выбранная машина «куда проедет» — подсвечиваем доступные точки, гасим прочие. */
  activeVehicle: VehicleType | null;
  onSelect: (sel: MapSelection | null) => void;
  onCreatePoint: (latlng: LatLng) => void;
  onMovePoint: (id: string, latlng: LatLng) => void;
  onCreateArea: (vertices: LatLng[]) => void;
  onCreateRoad: (vertices: LatLng[]) => void;
  onEraseRoadTrace: (vertices: LatLng[]) => void;
  onConfirmRoadTrace: (vertices: LatLng[]) => void;
  onCreateRoadAccess: (vertices: LatLng[]) => void;
  onCreateCrossing: (latlng: LatLng) => void;
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
const VEHICLE_TRACE_SNAP_METERS = 16; // обводим «особенности» — липнем к нарисованным дорогам
const VEHICLE_TRACE_MIN_GAP_METERS = 2.4;

export function MapCanvas({
  doc,
  tool,
  canEdit,
  visiblePointIds,
  selection,
  showRoadSuggestions,
  showRoadAccess,
  routePath,
  routeBlocked,
  showWeather,
  weatherNonce,
  weatherField,
  centerElevation,
  roadPaintMode,
  movingPointId,
  activeVehicle,
  onSelect,
  onCreatePoint,
  onMovePoint,
  onCreateArea,
  onCreateRoad,
  onEraseRoadTrace,
  onConfirmRoadTrace,
  onCreateRoadAccess,
  onCreateCrossing,
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
  const draftRef = useRef<LatLng[]>([]);
  const prevToolRef = useRef<MapTool>(tool);
  const skipAutoCommitRef = useRef(false);
  const roadDrawingRef = useRef(false);
  const eraseDrawingRef = useRef(false);
  const railwayDrawingRef = useRef(false);
  const shiftRef = useRef(false); // зажат Shift — линия идёт ПРЯМО к курсору
  const confirmDrawingRef = useRef(false);
  const vehicleDrawingRef = useRef(false);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [viewMetrics, setViewMetrics] = useState<ViewMetrics | null>(null);
  const [pointMenu, setPointMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;
  const movingPoint = movingPointId ? doc.points.find((p) => p.id === movingPointId) ?? null : null;

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

  const appendConfirmTracePoint = useCallback((raw: LatLng) => {
    // Режим подтверждения: НИЧЕГО нового не рисуем — берём только точки, лежащие
    // на красной линии. Курсор вне красной — пропускаем (отдельно от «своей дороги»).
    const snapped = snapToRoadSuggestions(raw, showRoadSuggestions ? doc.roadSuggestions : [], CONFIRM_TRACE_SNAP_METERS);
    if (!snapped) return;
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (prev && distanceMeters(prev, snapped) < CONFIRM_TRACE_MIN_GAP_METERS) return points;
      return [...points, snapped];
    });
  }, [doc.roadSuggestions, showRoadSuggestions]);

  const appendFreehandRoadPoint = useCallback((p: LatLng) => {
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (prev && distanceMeters(prev, p) < FREEHAND_ROAD_MIN_GAP_METERS) return points;
      return [...points, p];
    });
  }, []);

  const appendVehicleTracePoint = useCallback((raw: LatLng) => {
    // «Особенности» обводят кусок СУЩЕСТВУЮЩЕЙ дороги — берём только точки на дороге.
    const snapped = snapToRoads(raw, doc.roads, VEHICLE_TRACE_SNAP_METERS);
    if (!snapped) return;
    setDraft((points) => {
      const prev = points[points.length - 1];
      if (prev && distanceMeters(prev, snapped) < VEHICLE_TRACE_MIN_GAP_METERS) return points;
      return [...points, snapped];
    });
  }, [doc.roads]);

  const finishDraft = useCallback((mode: MapTool = tool, vertices: LatLng[] = draftRef.current) => {
    if (mode === 'area' && vertices.length >= 3) {
      skipAutoCommitRef.current = true;
      onCreateArea(vertices);
    }
    if (mode === 'road' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRoad(vertices);
    }
    if (mode === 'eraseRoad' && vertices.length >= 1) {
      skipAutoCommitRef.current = true;
      onEraseRoadTrace(vertices);
    }
    if (mode === 'railway' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRailway(vertices);
    }
    if (mode === 'confirmRoad' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onConfirmRoadTrace(vertices);
    }
    if (mode === 'vehicles' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRoadAccess(vertices);
    }
    roadDrawingRef.current = false;
    eraseDrawingRef.current = false;
    railwayDrawingRef.current = false;
    confirmDrawingRef.current = false;
    vehicleDrawingRef.current = false;
    mapRef.current?.dragPan.enable();
    setDraft([]);
  }, [tool, onCreateArea, onCreateRoad, onEraseRoadTrace, onCreateRailway, onConfirmRoadTrace, onCreateRoadAccess]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const p = toLatLng(e.lngLat);
      if (tool === 'point') {
        onCreatePoint(p);
      } else if (tool === 'crossing') {
        onCreateCrossing(p);
      } else if (tool === 'area') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        setDraft((d) => [...d, p]);
      } else if (tool === 'road') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        roadDrawingRef.current = true;
        map.dragPan.disable();
        appendFreehandRoadPoint(p);
      } else if (tool === 'eraseRoad') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        eraseDrawingRef.current = true;
        map.dragPan.disable();
        appendFreehandRoadPoint(p);
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
      } else if (tool === 'vehicles') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        vehicleDrawingRef.current = true;
        map.dragPan.disable();
        appendVehicleTracePoint(p);
      } else if (tool === 'optimize') {
        onGhostMove(p);
      } else {
        // Безопасность: по нарисованной дороге клик НЕ выбирает её (нельзя случайно
        // удалить) — дороги правятся только через меню «Управление». Кликом
        // выбираем точки/области/особенности/черновик/переезды.
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ['map-road-access-hit', 'map-railways-hit', 'map-road-suggestions-hit', 'map-areas-fill'],
        })[0];
        const id = hit?.properties?.id;
        const kind = hit?.properties?.kind;
        if (kind === 'roadAccess' && typeof id === 'string') {
          onSelect({ type: 'roadAccess', id });
        } else if (kind === 'railway' && typeof id === 'string') {
          onSelect({ type: 'railway', id });
        } else if (kind === 'roadSuggestion' && typeof id === 'string') {
          onSelect({ type: 'roadSuggestion', id });
        } else if (kind === 'area' && typeof id === 'string') {
          onSelect({ type: 'area', id });
        } else {
          onSelect(null);
        }
      }
    };
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      if (tool !== 'area' && tool !== 'road' && tool !== 'eraseRoad' && tool !== 'railway' && tool !== 'confirmRoad' && tool !== 'vehicles') return;
      e.preventDefault();
      finishDraft();
    };
    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if ((tool !== 'confirmRoad' && tool !== 'vehicles') || (e.originalEvent as MouseEvent).button !== 0) return;
      e.preventDefault();
      map.dragPan.disable();
    };
    const onMouseUp = () => {
      if (tool === 'confirmRoad' && !confirmDrawingRef.current) map.dragPan.enable();
      if (tool === 'vehicles' && !vehicleDrawingRef.current) map.dragPan.enable();
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const raw = toLatLng(e.lngLat);
      const current = tool === 'confirmRoad'
        ? snapToRoadSuggestions(raw, showRoadSuggestions ? doc.roadSuggestions : [], CONFIRM_TRACE_SNAP_METERS) ?? raw
        : tool === 'vehicles'
          ? snapToRoads(raw, doc.roads, VEHICLE_TRACE_SNAP_METERS) ?? raw
          : raw;
      setCursor(current);
      // Зажат Shift → НЕ сыпем точки от руки: тянем прямую к курсору (вершину
      // добавит клик). Без Shift — обычная рисовка от руки.
      if (tool === 'road' && roadDrawingRef.current && !shiftRef.current) appendFreehandRoadPoint(raw);
      if (tool === 'eraseRoad' && eraseDrawingRef.current) appendFreehandRoadPoint(raw);
      if (tool === 'railway' && railwayDrawingRef.current && !shiftRef.current) appendFreehandRoadPoint(raw);
      if (tool === 'confirmRoad' && confirmDrawingRef.current) appendConfirmTracePoint(raw);
      if (tool === 'vehicles' && vehicleDrawingRef.current) appendVehicleTracePoint(raw);
    };
    const onMouseOut = () => {
      setCursor(null);
    };
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousedown', onMouseDown);
    map.on('mouseup', onMouseUp);
    map.on('mousemove', onMove);
    map.on('mouseout', onMouseOut);
    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousedown', onMouseDown);
      map.off('mouseup', onMouseUp);
      map.off('mousemove', onMove);
      map.off('mouseout', onMouseOut);
      roadDrawingRef.current = false;
      eraseDrawingRef.current = false;
      railwayDrawingRef.current = false;
      confirmDrawingRef.current = false;
      vehicleDrawingRef.current = false;
      map.dragPan.enable();
    };
  }, [tool, doc.roadSuggestions, doc.roads, showRoadSuggestions, appendConfirmTracePoint, appendFreehandRoadPoint, appendVehicleTracePoint, finishDraft, onCreatePoint, onCreateCrossing, onGhostMove, onSelect]);

  useEffect(() => {
    const previousTool = prevToolRef.current;
    if (previousTool === tool) return;
    const vertices = draftRef.current;
    const skip = skipAutoCommitRef.current;
    skipAutoCommitRef.current = false;

    if (!skip) {
      if (previousTool === 'road' && vertices.length >= 2) onCreateRoad(vertices);
      if (previousTool === 'eraseRoad' && vertices.length >= 1) onEraseRoadTrace(vertices);
      if (previousTool === 'railway' && vertices.length >= 2) onCreateRailway(vertices);
      if (previousTool === 'area' && vertices.length >= 3) onCreateArea(vertices);
      if (previousTool === 'confirmRoad' && vertices.length >= 2) onConfirmRoadTrace(vertices);
      if (previousTool === 'vehicles' && vertices.length >= 2) onCreateRoadAccess(vertices);
    }

    setDraft([]);
    draftRef.current = [];
    roadDrawingRef.current = false;
    eraseDrawingRef.current = false;
    railwayDrawingRef.current = false;
    confirmDrawingRef.current = false;
    vehicleDrawingRef.current = false;
    mapRef.current?.dragPan.enable();
    prevToolRef.current = tool;
  }, [tool, onCreateArea, onCreateRoad, onEraseRoadTrace, onCreateRailway, onConfirmRoadTrace, onCreateRoadAccess]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === 'area' || tool === 'road' || tool === 'eraseRoad' || tool === 'railway' || tool === 'confirmRoad' || tool === 'vehicles') map.doubleClickZoom.disable();
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
        roadDrawingRef.current = false;
        eraseDrawingRef.current = false;
        railwayDrawingRef.current = false;
        confirmDrawingRef.current = false;
        vehicleDrawingRef.current = false;
        skipAutoCommitRef.current = true; // не коммитить недорисованное при выходе
        mapRef.current?.dragPan.enable();
        setDraft([]);
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
  }, [finishDraft, movingPointId, onCancelMovePointByMap, onCancelTool, onFinishMovePointByMap]);

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

    setSourceData(map, 'map-areas', buildAreasData(doc.areas, selection));
    setSourceData(map, 'map-railways', buildRailwaysData(doc.railways ?? [], selection));
    setSourceData(map, 'map-roads', buildRoadsData(doc.roads, selection));
    setSourceData(map, 'map-road-suggestions', showRoadSuggestions ? buildRoadSuggestionsData(doc.roadSuggestions, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-road-access', showRoadAccess ? buildRoadAccessData(doc.roadAccess, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-route', buildRouteData(routePath, routeBlocked));
    setSourceData(map, 'map-opt-rays', buildOptimizeRaysData(optimizeOverlay));
    setSourceData(map, 'map-draft', buildDraftData(tool, draft, cursor, roadPaintMode));
    setSourceData(map, 'weather-wind', showWeather ? buildWeatherWindData(weatherField) : EMPTY_FEATURES);

    clearMarkers(markerRefs.current);
    markerRefs.current = [];

    for (const area of doc.areas) {
      if (!area.name || area.vertices.length === 0) continue;
      const label = createLabelElement(area.name, area.color);
      markerRefs.current.push(
        new maplibregl.Marker({ element: label, anchor: 'center' })
          .setLngLat(toCoord(centroid(area.vertices)))
          .addTo(map),
      );
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
        draggable: canEdit && tool === 'select' && movingPointId !== point.id,
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
    doc.roadSuggestions,
    doc.roadAccess,
    doc.crossings,
    showRoadSuggestions,
    showRoadAccess,
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
    roadPaintMode,
    movingPointId,
    draft,
    cursor,
    optimizeOverlay,
    onSelect,
    onMovePoint,
    onStartMovePointByMap,
    onGhostMove,
    styleReady,
  ]);

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
        paint: { 'raster-opacity': 0.48, 'raster-fade-duration': 200 },
      } as never, beforeId);
    }
  }, [showWeather, weatherNonce, styleReady]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={elRef} className="h-full w-full bg-[#101419] [&_.maplibregl-canvas]:outline-none" />
      <MapControls
        zoom={viewMetrics?.zoom ?? DEFAULT_ZOOM}
        bearing={viewMetrics?.bearing ?? 0}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomTo={zoomTo}
        onResetNorth={resetNorth}
        onRotate={rotateBy}
      />
      <MapStatusBar metrics={viewMetrics} cursor={cursor} elevation={centerElevation} />
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
      <RoadLegend visible={showRoadAccess} items={doc.roadAccess} />
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
      {(tool === 'area' || tool === 'road' || tool === 'eraseRoad' || tool === 'railway' || tool === 'confirmRoad' || tool === 'vehicles') && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[3] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-bg-deep/88 px-3 py-1 text-[11.5px] text-text-secondary shadow">
            <span>
              {tool === 'area'
                ? 'Своя область: кликами обводим контур'
                : tool === 'road'
                  ? 'Своя дорога: кликните старт и ведите мышью'
                  : tool === 'eraseRoad'
                    ? 'Ластик дороги: проведите по куску дороги — он сотрётся (остальная сеть цела)'
                    : tool === 'railway'
                      ? 'Ж/д путь: кликните старт и ведите мышью'
                      : tool === 'confirmRoad'
                        ? 'Подтверждение: ведите курсором по красной линии (новая не рисуется)'
                        : roadPaintMode === 'erase'
                          ? 'Ластик: проведите по окрашенному участку дороги'
                          : `Закраска: ${roadPaintOption(roadPaintMode).label}`} · Enter — сохранить · Esc — отмена
            </span>
            {((tool === 'road' && draft.length >= 2) || (tool === 'eraseRoad' && draft.length >= 1) || (tool === 'railway' && draft.length >= 2) || (tool === 'confirmRoad' && draft.length >= 2) || (tool === 'vehicles' && draft.length >= 2) || (tool === 'area' && draft.length >= 3)) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  finishDraft();
                }}
                className="h-6 rounded border border-border-subtle px-2 text-[11px] font-medium text-text-strong outline-none transition-colors hover:bg-bg-hover"
              >
                {tool === 'area' ? 'Сохранить область' : tool === 'road' ? 'Сохранить дорогу' : tool === 'eraseRoad' ? 'Стереть кусок' : tool === 'railway' ? 'Сохранить путь' : tool === 'confirmRoad' ? 'Сохранить подтверждение' : 'Задать машины'}
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

function MapStatusBar({ metrics, cursor, elevation }: { metrics: ViewMetrics | null; cursor: LatLng | null; elevation: number | null }) {
  // Координаты, зум, масштаб и высота — единым блоком СПРАВА внизу (слева внизу
  // теперь блок управления). Низ-лево не занимаем.
  const loc = cursor ?? metrics?.center ?? null;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-[3] flex items-center gap-1.5 rounded-md border border-white/10 bg-[#080b11]/80 px-2.5 py-1 text-[11px] text-white/80 shadow-lg backdrop-blur">
      <span className="font-mono tabular-nums">
        {loc ? `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}` : '—, —'}
      </span>
      <span className="text-white/35">•</span>
      <span className="font-mono tabular-nums">z {metrics ? metrics.zoom.toFixed(1) : '—'}</span>
      <span className="text-white/35">•</span>
      <span className="font-mono tabular-nums">{metrics ? `${metrics.metersPerPixel.toFixed(metrics.metersPerPixel < 10 ? 1 : 0)} м/px` : '— м/px'}</span>
      <span className="text-white/35">•</span>
      <span className="font-mono tabular-nums" title="Высота центра карты над уровнем моря">
        {elevation != null ? `${Math.round(elevation)} м н.у.м.` : 'выс …'}
      </span>
    </div>
  );
}

function RoadLegend({ visible, items }: { visible: boolean; items: RoadAccess[] }) {
  if (!visible || items.length === 0) return null;
  const active = new Set<string>();
  for (const item of items) {
    if (item.kind === 'closed') active.add('closed');
    for (const vehicle of item.vehicles) active.add(vehicle);
  }
  const rows = ROAD_PAINT_OPTIONS.filter((item) => item.id !== 'erase' && active.has(item.id));
  if (rows.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-11 right-2 z-[3] rounded-lg border border-white/10 bg-[#080b11]/82 px-2.5 py-2 text-[11px] text-white/82 shadow-lg backdrop-blur">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">Легенда дорог</div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: row.color }} />
            <span>{row.label}</span>
          </div>
        ))}
      </div>
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
  scrollZoom.setWheelZoomRate?.(1 / 520);
  scrollZoom.setZoomRate?.(1 / 120);
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

function ensureOverlayLayers(map: MapLibreMap): void {
  addGeoJsonSource(map, 'map-areas');
  addGeoJsonSource(map, 'map-railways');
  addGeoJsonSource(map, 'map-roads');
  addGeoJsonSource(map, 'map-road-suggestions');
  addGeoJsonSource(map, 'map-road-access');
  addGeoJsonSource(map, 'map-route');
  addGeoJsonSource(map, 'map-opt-rays');
  addGeoJsonSource(map, 'map-draft');
  addGeoJsonSource(map, 'weather-wind');

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

  // Ветер — лёгкие стрелки поверх радара осадков, но под дорогами/маршрутом.
  // Не используем плотные погодные тайлы: логистическая карта должна оставаться
  // читаемой, особенно на спутнике.
  addLayer(map, {
    id: 'weather-wind-arrows',
    type: 'symbol',
    source: 'weather-wind',
    minzoom: 8,
    layout: {
      'symbol-placement': 'point',
      'symbol-avoid-edges': true,
      'text-field': '↑',
      'text-size': ['interpolate', ['linear'], ['get', 'windMs'], 0, 11, 8, 15, 16, 19],
      'text-rotate': ['get', 'angle'],
      'text-rotation-alignment': 'map',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#B6E3FF',
      'text-halo-color': 'rgba(7, 13, 20, 0.78)',
      'text-halo-width': 1.3,
      'text-opacity': 0.74,
    },
  } as never);
  addLayer(map, {
    id: 'weather-wind-labels',
    type: 'symbol',
    source: 'weather-wind',
    minzoom: 10,
    layout: {
      'symbol-placement': 'point',
      'text-field': ['get', 'label'],
      'text-size': 9.5,
      'text-offset': [0, 1.2],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#DCE7F3',
      'text-halo-color': 'rgba(7, 13, 20, 0.86)',
      'text-halo-width': 1.2,
      'text-opacity': 0.68,
    },
  } as never);

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
  // Дороги (свои + подтверждённые) — тёмная обводка + яркая линия, чтобы
  // чётко читались на спутнике. ПОВЕРХ красного черновика.
  addLayer(map, {
    id: 'map-roads-casing',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0A0D12',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.4, 16, 5.6, 20, 8.5],
      'line-opacity': 0.9,
    },
  });
  addLayer(map, {
    id: 'map-roads-line',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#FFFFFF', '#FFC83D'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 16, 3.4, 20, 5.4],
      'line-opacity': 1,
    },
  });
  addLayer(map, {
    id: 'map-roads-hit',
    type: 'line',
    source: 'map-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 16, 'line-opacity': 0.01 },
  });
  // «Особенности» дорог — бирюзовый слой проходимости машин (поверх дорог).
  addLayer(map, {
    id: 'map-road-access-line',
    type: 'line',
    source: 'map-road-access',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      // Несколько машин → параллельные ленты (offset задаётся в данных).
      'line-offset': ['coalesce', ['get', 'offset'], 0],
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['case', ['boolean', ['get', 'selected'], false], 4, 3],
        16, ['case', ['boolean', ['get', 'selected'], false], 6, 4.5],
        20, ['case', ['boolean', ['get', 'selected'], false], 9, 7],
      ],
      'line-opacity': ['case', ['==', ['get', 'accessKind'], 'closed'], 0.82, 0.74],
    },
  });
  addLayer(map, {
    id: 'map-road-access-hit',
    type: 'line',
    source: 'map-road-access',
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
  addLayer(map, {
    id: 'map-draft-line',
    type: 'line',
    source: 'map-draft',
    filter: ['==', '$type', 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], '#6FBF8E',
        ['==', ['get', 'kind'], 'vehicles'], ['coalesce', ['get', 'color'], '#22D3EE'],
        ['==', ['get', 'kind'], 'eraseRoad'], '#F87171',
        ['==', ['get', 'kind'], 'railway'], '#E5E7EB',
        ['==', ['get', 'kind'], 'road'], '#F4D58D',
        '#E8836B',
      ],
      'line-width': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], 2.6,
        ['==', ['get', 'kind'], 'eraseRoad'], 3.2,
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
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 18, 20, 28],
      'circle-color': ['coalesce', ['get', 'color'], '#22D3EE'],
      'circle-opacity': 0.22,
      'circle-blur': 0.45,
      'circle-stroke-color': ['coalesce', ['get', 'color'], '#22D3EE'],
      'circle-stroke-opacity': 0.45,
      'circle-stroke-width': 1.2,
    },
  });
  addLayer(map, {
    id: 'map-draft-points',
    type: 'circle',
    source: 'map-draft',
    filter: ['all', ['==', '$type', 'Point'], ['!=', 'kind', 'paintCursor']],
    paint: {
      'circle-radius': 4,
      'circle-color': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], '#6FBF8E',
        ['==', ['get', 'kind'], 'vehicles'], ['coalesce', ['get', 'color'], '#22D3EE'],
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

function buildRoadsData(roads: MapRoad[], selection: MapSelection | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads
      .filter((road) => road.vertices.length >= 2)
      .map((road) => ({
        type: 'Feature',
        properties: {
          id: road.id,
          kind: 'road',
          selected: selection?.type === 'road' && selection.id === road.id,
        },
        geometry: {
          type: 'LineString',
          coordinates: road.vertices.map(toCoord),
        },
      })),
  };
}

const ACCESS_RIBBON_STEP = 5; // px между параллельными «лентами» машин на одном участке

/**
 * Участок «особенности» дороги. Если ограничение по НЕСКОЛЬКИМ машинам — рисуем
 * их НЕ смешанным цветом, а РЯДОМ, параллельными цветными лентами (каждая лента =
 * своя машина своим цветом, со смещением `offset`). Так читается, что проедут
 * именно эти типы, а не «какой-то общий». «Нет проезда» — одна красная лента.
 */
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

function buildRoadAccessData(items: RoadAccess[], selection: MapSelection | null): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const access of items) {
    if (access.vertices.length < 2) continue;
    const selected = selection?.type === 'roadAccess' && selection.id === access.id;
    const coordinates = access.vertices.map(toCoord);
    const ribbons = accessRibbons(access);
    ribbons.forEach((ribbon, index) => {
      features.push({
        type: 'Feature',
        properties: {
          id: access.id,
          kind: 'roadAccess',
          accessKind: access.kind,
          color: ribbon.color,
          offset: (index - (ribbons.length - 1) / 2) * ACCESS_RIBBON_STEP,
          selected,
        },
        geometry: { type: 'LineString', coordinates },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Цвета лент участка: закрытый → красный; ограниченный → по машине; иначе — бирюзовый. */
function accessRibbons(access: RoadAccess): Array<{ color: string }> {
  if (access.kind === 'closed') return [{ color: roadPaintOption('closed').color }];
  if (access.vehicles.length === 0) return [{ color: ROAD_ACCESS_FALLBACK_COLOR }];
  return access.vehicles.map((vehicle) => ({ color: vehicleColor(vehicle) }));
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
        coordinates: routePath.map(toCoord),
      },
    }],
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

function buildWeatherWindData(points: WeatherFieldPoint[]): FeatureCollection {
  if (points.length === 0) return EMPTY_FEATURES;
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => {
        const wind = p.windMs ?? 0;
        const dir = p.windDir ?? 0;
        const gust = p.gustMs ?? null;
        const pressure = p.pressureHpa ?? null;
        return {
          type: 'Feature',
          properties: {
            kind: 'weatherWind',
            windMs: wind,
            angle: (dir + 180) % 360, // Open-Meteo даёт направление, ОТКУДА дует; стрелка показывает КУДА.
            label: [
              `${Math.round(wind)} м/с`,
              gust != null && gust > wind + 2 ? `пор. ${Math.round(gust)}` : null,
              pressure != null ? `${Math.round(pressure)}` : null,
            ].filter(Boolean).join(' · '),
            precip: p.precipMm ?? 0,
            pressure,
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        };
      }),
  };
}

function buildDraftData(tool: MapTool, draft: LatLng[], cursor: LatLng | null, roadPaintMode: RoadPaintMode): FeatureCollection {
  if (tool !== 'area' && tool !== 'road' && tool !== 'eraseRoad' && tool !== 'railway' && tool !== 'confirmRoad' && tool !== 'vehicles') return EMPTY_FEATURES;
  const pts = [...draft, ...(cursor ? [cursor] : [])];
  const draftColor = tool === 'vehicles' ? roadPaintOption(roadPaintMode).color : undefined;
  const features: FeatureCollection['features'] = [];
  if (tool === 'vehicles' && cursor) {
    features.push({
      type: 'Feature',
      properties: { id: 'paint-cursor', kind: 'paintCursor', color: draftColor },
      geometry: { type: 'Point', coordinates: toCoord(cursor) },
    });
  }
  draft.forEach((p, index) => {
    features.push({
      type: 'Feature',
      properties: { id: `draft-point-${index}`, kind: tool, color: draftColor },
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
    const kind = tool === 'confirmRoad'
      ? 'confirmRoad'
      : tool === 'vehicles'
        ? 'vehicles'
        : tool === 'eraseRoad'
          ? 'eraseRoad'
          : tool === 'railway'
            ? 'railway'
            : 'road';
    const paint = roadPaintOption(roadPaintMode);
    features.push({
      type: 'Feature',
      properties: { id: 'draft-road', kind, color: tool === 'vehicles' ? paint.color : undefined },
      geometry: { type: 'LineString', coordinates: pts.map(toCoord) },
    });
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
  const label = point.label || warehouse?.id || '';
  const el = createPinElement(color, label, selected, dimmed);
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
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable })
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
  const el = document.createElement('div');
  el.style.width = '46px';
  el.style.height = '52px';
  el.style.cursor = 'pointer';
  // Точка, куда выбранная машина НЕ заедет — гасим и помечаем «стоп».
  el.style.opacity = dimmed ? '0.4' : '1';
  el.innerHTML = `
    <div style="position:relative;width:46px;height:52px;pointer-events:auto;">
      ${label ? `<div style="position:absolute;left:50%;top:-1px;transform:translateX(-50%);max-width:88px;padding:1px 6px;border-radius:5px;background:rgba(8,11,17,.74);color:#fff;font:700 11px/15px Inter,Arial,sans-serif;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);">${esc(label)}</div>` : ''}
      ${selected ? `<div style="position:absolute;left:50%;top:38px;width:14px;height:6px;margin-left:-7px;border-radius:999px;background:rgba(0,0,0,.35);filter:blur(2px);"></div><div style="position:absolute;left:50%;top:20px;width:22px;height:22px;margin-left:-11px;border-radius:999px;background:${color};opacity:.18;box-shadow:0 0 0 6px ${color}2e;"></div>` : ''}
      <svg width="30" height="40" viewBox="-15 -40 30 40" style="position:absolute;left:8px;top:11px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5));">
        <path d="M0 0 C -8.5 -13 -12.5 -19 -12.5 -27 a 12.5 12.5 0 1 1 25 0 C 12.5 -19 8.5 -13 0 0 Z" fill="${color}" stroke="#ffffff" stroke-width="${selected ? 2.4 : 1.8}" stroke-opacity="${selected ? '1' : '.85'}"/>
        <circle cx="0" cy="-27" r="4.6" fill="#0c0f14" fill-opacity=".9"/>
      </svg>
      ${dimmed ? `<svg width="15" height="15" viewBox="0 0 16 16" style="position:absolute;left:25px;top:8px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7));"><circle cx="8" cy="8" r="7" fill="#EF4444" stroke="#fff" stroke-width="1.4"/><rect x="3.6" y="6.8" width="8.8" height="2.4" rx="1.2" fill="#fff"/></svg>` : ''}
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
  el.innerHTML = `
    <div style="position:relative;width:44px;height:40px;pointer-events:auto;">
      ${crossing.name ? `<div style="position:absolute;left:50%;top:-12px;transform:translateX(-50%);max-width:100px;padding:1px 5px;border-radius:4px;background:rgba(8,11,17,.72);color:#FCD34D;font:700 10.5px/14px Inter,Arial,sans-serif;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);">${esc(crossing.name)}</div>` : ''}
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
