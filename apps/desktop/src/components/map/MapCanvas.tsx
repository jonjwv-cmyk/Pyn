import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getWarehouseState, type Warehouse } from '@pyn/core';
import { useWarehousesStore } from '@/lib/warehouses-store';
import {
  NTMK_CENTER,
  NTMK_ZOOM,
  ROAD_PAINT_OPTIONS,
  roadPaintOption,
  vehicleShort,
  type LatLng,
  type MapArea,
  type MapDoc,
  type MapPoint,
  type MapRoad,
  type MapRoadSuggestion,
  type MapTool,
  type RoadAccess,
  type RoadPaintMode,
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

export interface MapSelection {
  type: 'point' | 'area' | 'road' | 'roadSuggestion' | 'roadAccess';
  id: string;
}

interface MapCanvasProps {
  doc: MapDoc;
  tool: MapTool;
  /** null = все точки видимы; иначе — только эти id. */
  visiblePointIds: Set<string> | null;
  selection: MapSelection | null;
  showRoadSuggestions: boolean;
  showRoadAccess: boolean;
  routePath: LatLng[] | null;
  roadPaintMode: RoadPaintMode;
  movingPointId: string | null;
  onSelect: (sel: MapSelection | null) => void;
  onCreatePoint: (latlng: LatLng) => void;
  onMovePoint: (id: string, latlng: LatLng) => void;
  onCreateArea: (vertices: LatLng[]) => void;
  onCreateRoad: (vertices: LatLng[]) => void;
  onConfirmRoadTrace: (vertices: LatLng[]) => void;
  onCreateRoadAccess: (vertices: LatLng[]) => void;
  onStartMovePointByMap: (id: string) => void;
  onFinishMovePointByMap: (id: string, latlng: LatLng) => void;
  onCancelMovePointByMap: () => void;
  /** Esc в режиме инструмента — выйти в «Выбор» (курсор перестаёт «носить» инструмент). */
  onCancelTool: () => void;
  optimizeOverlay: OptimizeOverlay | null;
  onGhostMove: (latlng: LatLng) => void;
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
const ROAD_ACCESS_COLOR = '#22D3EE'; // бирюзовый — слой «особенности машин»

export function MapCanvas({
  doc,
  tool,
  visiblePointIds,
  selection,
  showRoadSuggestions,
  showRoadAccess,
  routePath,
  roadPaintMode,
  movingPointId,
  onSelect,
  onCreatePoint,
  onMovePoint,
  onCreateArea,
  onCreateRoad,
  onConfirmRoadTrace,
  onCreateRoadAccess,
  onStartMovePointByMap,
  onFinishMovePointByMap,
  onCancelMovePointByMap,
  onCancelTool,
  optimizeOverlay,
  onGhostMove,
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
  const confirmDrawingRef = useRef(false);
  const vehicleDrawingRef = useRef(false);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [viewMetrics, setViewMetrics] = useState<ViewMetrics | null>(null);
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
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 120,
      refreshExpiredTiles: false,
      maxTileCacheSize: 1200,
      maxTileCacheZoomLevels: 5,
      cancelPendingTileRequestsWhileZooming: false,
      localIdeographFontFamily: 'Inter, Arial, sans-serif',
    });

    map.touchZoomRotate.disableRotation();
    map.keyboard.enable();
    tuneScrollZoom(map);

    mapRef.current = map;
    const onLoad = () => {
      ensureOverlayLayers(map);
      setStyleReady(true);
      setViewMetrics(readViewMetrics(map));
      map.resize();
    };
    map.once('load', onLoad);
    const onViewChange = () => setViewMetrics(readViewMetrics(map));
    map.on('move', onViewChange);
    map.on('zoom', onViewChange);
    map.on('resize', onViewChange);

    return () => {
      clearMarkers(markerRefs.current);
      markerRefs.current = [];
      setStyleReady(false);
      map.off('move', onViewChange);
      map.off('zoom', onViewChange);
      map.off('resize', onViewChange);
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
    if (mode === 'confirmRoad' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onConfirmRoadTrace(vertices);
    }
    if (mode === 'vehicles' && vertices.length >= 2) {
      skipAutoCommitRef.current = true;
      onCreateRoadAccess(vertices);
    }
    roadDrawingRef.current = false;
    confirmDrawingRef.current = false;
    vehicleDrawingRef.current = false;
    mapRef.current?.dragPan.enable();
    setDraft([]);
  }, [tool, onCreateArea, onCreateRoad, onConfirmRoadTrace, onCreateRoadAccess]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const p = toLatLng(e.lngLat);
      if (tool === 'point') {
        onCreatePoint(p);
      } else if (tool === 'area') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        setDraft((d) => [...d, p]);
      } else if (tool === 'road') {
        if ((e.originalEvent as MouseEvent).detail > 1) return;
        roadDrawingRef.current = true;
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
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ['map-road-access-hit', 'map-road-suggestions-hit', 'map-roads-hit', 'map-areas-fill'],
        })[0];
        const id = hit?.properties?.id;
        const kind = hit?.properties?.kind;
        if (kind === 'roadAccess' && typeof id === 'string') {
          onSelect({ type: 'roadAccess', id });
        } else if (kind === 'roadSuggestion' && typeof id === 'string') {
          onSelect({ type: 'roadSuggestion', id });
        } else if (kind === 'road' && typeof id === 'string') {
          onSelect({ type: 'road', id });
        } else if (kind === 'area' && typeof id === 'string') {
          onSelect({ type: 'area', id });
        } else {
          onSelect(null);
        }
      }
    };
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      if (tool !== 'area' && tool !== 'road' && tool !== 'confirmRoad' && tool !== 'vehicles') return;
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
      if (tool === 'road' && roadDrawingRef.current) appendFreehandRoadPoint(raw);
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
      confirmDrawingRef.current = false;
      vehicleDrawingRef.current = false;
      map.dragPan.enable();
    };
  }, [tool, doc.roadSuggestions, doc.roads, showRoadSuggestions, appendConfirmTracePoint, appendFreehandRoadPoint, appendVehicleTracePoint, finishDraft, onCreatePoint, onGhostMove, onSelect]);

  useEffect(() => {
    const previousTool = prevToolRef.current;
    if (previousTool === tool) return;
    const vertices = draftRef.current;
    const skip = skipAutoCommitRef.current;
    skipAutoCommitRef.current = false;

    if (!skip) {
      if (previousTool === 'road' && vertices.length >= 2) onCreateRoad(vertices);
      if (previousTool === 'area' && vertices.length >= 3) onCreateArea(vertices);
      if (previousTool === 'confirmRoad' && vertices.length >= 2) onConfirmRoadTrace(vertices);
      if (previousTool === 'vehicles' && vertices.length >= 2) onCreateRoadAccess(vertices);
    }

    setDraft([]);
    draftRef.current = [];
    roadDrawingRef.current = false;
    confirmDrawingRef.current = false;
    vehicleDrawingRef.current = false;
    mapRef.current?.dragPan.enable();
    prevToolRef.current = tool;
  }, [tool, onCreateArea, onCreateRoad, onConfirmRoadTrace, onCreateRoadAccess]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === 'area' || tool === 'road' || tool === 'confirmRoad' || tool === 'vehicles') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        roadDrawingRef.current = false;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    setSourceData(map, 'map-areas', buildAreasData(doc.areas, selection));
    setSourceData(map, 'map-roads', buildRoadsData(doc.roads, selection));
    setSourceData(map, 'map-road-suggestions', showRoadSuggestions ? buildRoadSuggestionsData(doc.roadSuggestions, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-road-access', showRoadAccess ? buildRoadAccessData(doc.roadAccess, selection) : EMPTY_FEATURES);
    setSourceData(map, 'map-route', buildRouteData(routePath));
    setSourceData(map, 'map-opt-rays', buildOptimizeRaysData(optimizeOverlay));
    setSourceData(map, 'map-draft', buildDraftData(tool, draft, cursor, roadPaintMode));

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

    for (const point of visiblePoints) {
      const warehouse = point.warehouseId ? warehouses.get(point.warehouseId) : undefined;
      const selected = selection?.type === 'point' && selection.id === point.id;
      const marker = createPointMarker({
        map,
        point,
        warehouse,
        selected,
        draggable: tool === 'select' && movingPointId !== point.id,
        hidden: movingPointId === point.id,
        onSelect,
        onMovePoint,
        onStartMovePointByMap,
      });
      markerRefs.current.push(marker);
    }
  }, [
    doc.areas,
    doc.roads,
    doc.roadSuggestions,
    doc.roadAccess,
    showRoadSuggestions,
    showRoadAccess,
    routePath,
    visiblePoints,
    warehouses,
    selection,
    tool,
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

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={elRef} className="h-full w-full bg-[#101419] [&_.maplibregl-canvas]:outline-none" />
      <MapZoomButtons onZoomIn={zoomIn} onZoomOut={zoomOut} />
      <MapStatusBar metrics={viewMetrics} cursor={cursor} />
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
      {(tool === 'area' || tool === 'road' || tool === 'confirmRoad' || tool === 'vehicles') && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[3] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-bg-deep/88 px-3 py-1 text-[11.5px] text-text-secondary shadow">
            <span>
              {tool === 'area'
                ? 'Своя область: кликами обводим контур'
                : tool === 'road'
                  ? 'Своя дорога: кликните старт и ведите мышью'
                  : tool === 'confirmRoad'
                    ? 'Подтверждение: ведите курсором по красной линии (новая не рисуется)'
                    : roadPaintMode === 'erase'
                      ? 'Ластик: проведите по окрашенному участку дороги'
                      : `Закраска: ${roadPaintOption(roadPaintMode).label}`} · Enter — сохранить · Esc — отмена
            </span>
            {((tool === 'road' && draft.length >= 2) || (tool === 'confirmRoad' && draft.length >= 2) || (tool === 'vehicles' && draft.length >= 2) || (tool === 'area' && draft.length >= 3)) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  finishDraft();
                }}
                className="h-6 rounded border border-border-subtle px-2 text-[11px] font-medium text-text-strong outline-none transition-colors hover:bg-bg-hover"
              >
                {tool === 'area' ? 'Сохранить область' : tool === 'road' ? 'Сохранить дорогу' : tool === 'confirmRoad' ? 'Сохранить подтверждение' : 'Задать машины'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MapZoomButtons({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  return (
    <div className="absolute bottom-2 left-2 z-[4] overflow-hidden rounded-lg border border-border-default bg-bg-elevated/92 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={onZoomIn}
        title="Приблизить"
        aria-label="Приблизить"
        className="flex h-8 w-8 items-center justify-center border-b border-border-subtle text-[20px] font-semibold leading-none text-text-strong outline-none transition-colors hover:bg-bg-hover active:bg-bg-active"
      >
        +
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        title="Отдалить"
        aria-label="Отдалить"
        className="flex h-8 w-8 items-center justify-center text-[24px] font-semibold leading-none text-text-strong outline-none transition-colors hover:bg-bg-hover active:bg-bg-active"
      >
        -
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
  const loc = cursor ?? metrics?.center ?? null;
  return (
    <div className="pointer-events-none absolute bottom-2 left-12 right-2 z-[3] flex items-center justify-between gap-2">
      <div className="min-w-0 rounded-md border border-white/10 bg-[#080b11]/80 px-2.5 py-1 text-[11px] text-white/80 shadow-lg backdrop-blur">
        {loc ? (
          <span className="font-mono tabular-nums">
            {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
          </span>
        ) : (
          <span className="font-mono tabular-nums">—, —</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-[#080b11]/80 px-2.5 py-1 text-[11px] text-white/80 shadow-lg backdrop-blur">
        <span className="font-mono tabular-nums">z {metrics ? metrics.zoom.toFixed(1) : '—'}</span>
        <span className="text-white/35">•</span>
        <span className="font-mono tabular-nums">{metrics ? `${metrics.metersPerPixel.toFixed(metrics.metersPerPixel < 10 ? 1 : 0)} м/px` : '— м/px'}</span>
        <span className="text-white/35">•</span>
        <span title="Высота требует отдельного источника рельефа: Google Elevation API или DEM-модель.">высота н/д</span>
      </div>
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
  };
}

function ensureOverlayLayers(map: MapLibreMap): void {
  addGeoJsonSource(map, 'map-areas');
  addGeoJsonSource(map, 'map-roads');
  addGeoJsonSource(map, 'map-road-suggestions');
  addGeoJsonSource(map, 'map-road-access');
  addGeoJsonSource(map, 'map-route');
  addGeoJsonSource(map, 'map-opt-rays');
  addGeoJsonSource(map, 'map-draft');

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
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['case', ['boolean', ['get', 'selected'], false], 4, 3],
        16, ['case', ['boolean', ['get', 'selected'], false], 6, 4.5],
        20, ['case', ['boolean', ['get', 'selected'], false], 9, 7],
      ],
      'line-opacity': ['case', ['==', ['get', 'kind'], 'closed'], 0.82, 0.72],
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
      'line-color': '#38BDF8',
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
        ['==', ['get', 'kind'], 'road'], '#F4D58D',
        '#E8836B',
      ],
      'line-width': [
        'case',
        ['==', ['get', 'kind'], 'confirmRoad'], 2.6,
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

function buildRoadAccessData(items: RoadAccess[], selection: MapSelection | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items
      .filter((access) => access.vertices.length >= 2)
      .map((access) => ({
        type: 'Feature',
        properties: {
          id: access.id,
          kind: 'roadAccess',
          accessKind: access.kind,
          color: roadAccessColor(access),
          label: roadAccessLabel(access),
          selected: selection?.type === 'roadAccess' && selection.id === access.id,
        },
        geometry: {
          type: 'LineString',
          coordinates: access.vertices.map(toCoord),
        },
      })),
  };
}

function buildRouteData(routePath: LatLng[] | null): FeatureCollection {
  if (!routePath || routePath.length < 2) return EMPTY_FEATURES;
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'active-route', kind: 'route' },
      geometry: {
        type: 'LineString',
        coordinates: routePath.map(toCoord),
      },
    }],
  };
}

function roadAccessColor(access: RoadAccess): string {
  if (access.kind === 'closed') return roadPaintOption('closed').color;
  if (access.vehicles.length === 1) return roadPaintOption(access.vehicles[0]!).color;
  return ROAD_ACCESS_COLOR;
}

function roadAccessLabel(access: RoadAccess): string {
  if (access.kind === 'closed') return 'НЕТ ПРОЕЗДА';
  if (access.vehicles.length === 0) return '';
  return access.vehicles.map(vehicleShort).join(' · ');
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

function buildDraftData(tool: MapTool, draft: LatLng[], cursor: LatLng | null, roadPaintMode: RoadPaintMode): FeatureCollection {
  if (tool !== 'area' && tool !== 'road' && tool !== 'confirmRoad' && tool !== 'vehicles') return EMPTY_FEATURES;
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
    const kind = tool === 'confirmRoad' ? 'confirmRoad' : tool === 'vehicles' ? 'vehicles' : 'road';
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
  draggable,
  hidden,
  onSelect,
  onMovePoint,
  onStartMovePointByMap,
}: {
  map: MapLibreMap;
  point: MapPoint;
  warehouse: Warehouse | undefined;
  selected: boolean;
  draggable: boolean;
  hidden: boolean;
  onSelect: (sel: MapSelection | null) => void;
  onMovePoint: (id: string, latlng: LatLng) => void;
  onStartMovePointByMap: (id: string) => void;
}): Marker {
  const color = warehouse
    ? ({ removed: '#D96666', shipping: '#C99BE0', scheduled: '#6FBF8E', idle: '#5BA3D0' }[getWarehouseState(warehouse)])
    : '#9AA4B2';
  const label = point.label || warehouse?.id || '';
  const el = createPinElement(color, label, selected);
  if (hidden) el.style.display = 'none';
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    onSelect({ type: 'point', id: point.id });
  });
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onStartMovePointByMap(point.id);
  });
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable })
    .setLngLat(toCoord(point))
    .addTo(map);
  marker.on('dragend', () => onMovePoint(point.id, toLatLng(marker.getLngLat())));
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

function createPinElement(color: string, label: string, selected: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '52px';
  el.style.height = '54px';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <div style="position:relative;width:52px;height:54px;pointer-events:auto;">
      ${label ? `<div style="position:absolute;left:50%;top:0;transform:translateX(-50%);max-width:74px;padding:1px 5px;border-radius:4px;background:rgba(8,11,17,.72);color:white;font:700 11px/15px Inter,Arial,sans-serif;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.75);">${esc(label)}</div>` : ''}
      ${selected ? `<div style="position:absolute;left:17px;top:23px;width:18px;height:18px;border-radius:999px;background:${color};opacity:.20;box-shadow:0 0 0 8px ${color}33;"></div>` : ''}
      <svg width="30" height="42" viewBox="-15 -42 30 42" style="position:absolute;left:11px;top:13px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55));">
        <path d="M0 0 C -9 -14 -13 -20 -13 -28 a 13 13 0 1 1 26 0 C 13 -20 9 -14 0 0 Z" fill="${color}" stroke="#0c0f14" stroke-width="${selected ? 2.5 : 1.5}"/>
        <circle cx="0" cy="-28" r="4.8" fill="#0c0f14" fill-opacity=".86"/>
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
