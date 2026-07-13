/**
 * Map store — состояние раздела «Карта» (точки складов / области / дороги).
 * Локальный, без сервера (v1) — персист в зашифрованном кэше через
 * `map-repo.ts` (подписка на изменения → debounce save).
 *
 * `focusWarehouseId` — эфемерный сигнал из карточки склада в «Цеха»: «открой
 * карту и наведись на этот склад». Карта читает и сбрасывает его.
 */

import { createZustandStore as create } from '@pyn/core';
import { polylineLengthMeters } from '@/components/map/geo';
import {
  EMPTY_MAP_DOC,
  allVehiclesByPurpose,
  makeId,
  type LatLng,
  type MapArea,
  type MapClearance,
  type MapCrossing,
  type MapDoc,
  type MapPoint,
  type MapRailway,
  type MapRoad,
  type MapRoadSuggestion,
  type RoadPaintMode,
  type RoadAccess,
} from '@/components/map/map-types';
import {
  attachRoadEndpointsToNetwork,
  confirmTraceToRoad,
  eraseRoadByTrace,
  insertJointVertex,
  materializeConvergenceWelds,
  materializeRoadIntersections,
  mergeOverlappingRoads,
  normalizeRoadTopology,
  smoothPolyline,
  straightenPolyline,
  tidyDrawnRoad,
  type RoadMergeReport,
  type RoadNormalizationReport,
} from '@/components/map/road-network';

export interface RoadOverlapMergeSummary {
  merge: RoadMergeReport;
  welds: number;
  norm: RoadNormalizationReport;
}

const ROAD_ACCESS_ERASE_TOLERANCE_METERS = 10;
const MIN_NEW_ROAD_LENGTH_METERS = 3;
const BRUSH_HISTORY_LIMIT = 40;

type BrushHistoryEntry = { before: MapDoc; after: MapDoc };
let brushBefore: MapDoc | null = null;
let applyingBrushHistory = false;
const brushUndo: BrushHistoryEntry[] = [];
const brushRedo: BrushHistoryEntry[] = [];

/** Единый безопасный конвейер для любого способа добавления жёлтой дороги. */
function appendRoadToNetwork(
  current: MapRoad[],
  road: MapRoad,
  mode: 'freehand' | 'exact',
): MapRoad[] {
  const prepared = mode === 'freehand' ? tidyDrawnRoad(road.vertices) : road.vertices;
  if (prepared.length < 2 || polylineLengthMeters(prepared) < MIN_NEW_ROAD_LENGTH_METERS) return current;

  const { vertices, joints } = attachRoadEndpointsToNetwork(prepared, current);
  if (vertices.length < 2 || polylineLengthMeters(vertices) < MIN_NEW_ROAD_LENGTH_METERS) return current;

  let roads = current;
  if (joints.length > 0) {
    roads = roads.map((existing) => {
      let next = existing;
      for (const joint of joints) {
        if (joint.roadId === existing.id) next = insertJointVertex(next, joint.point);
      }
      return next;
    });
  }

  const added = { ...road, vertices };
  return materializeRoadIntersections([...roads, added], new Set([road.id]));
}

interface MapState {
  doc: MapDoc;
  /** Загружен ли кэш с диска (до этого UI показывает «загрузка»). */
  loaded: boolean;
  /** Склад, на который надо навестись (из карточки «Цеха»). null — нет запроса. */
  focusWarehouseId: string | null;
  /** Конкретная точка карты, на которую надо навестись. */
  focusPointId: string | null;
  canUndoBrush: boolean;
  canRedoBrush: boolean;

  setDoc(doc: MapDoc): void;
  setLoaded(v: boolean): void;
  beginBrushEdit(): void;
  commitBrushEdit(): void;
  undoBrushEdit(): void;
  redoBrushEdit(): void;

  // ── Точки ──
  addPoint(p: Omit<MapPoint, 'id'>): string;
  updatePoint(id: string, fields: Partial<MapPoint>): void;
  removePoint(id: string): void;
  /** Копия точки со всеми данными (смещена, чтобы была видна). Возвращает id копии. */
  duplicatePoint(id: string): string | null;

  // ── Области ──
  addArea(a: Omit<MapArea, 'id'>): string;
  updateArea(id: string, fields: Partial<MapArea>): void;
  removeArea(id: string): void;

  // ── Дороги ──
  addRoad(r: Omit<MapRoad, 'id'>): string;
  updateRoad(id: string, fields: Partial<MapRoad>): void;
  removeRoad(id: string): void;
  /** Стереть дороги, по которым прошлись «ластиком» (трасса + радиус кисти). */
  eraseRoadTrace(vertices: LatLng[], radiusMeters?: number): void;
  /** Выпрямить одну дорогу (убрать дрожание руки), не меняя остальные дороги. */
  straightenRoad(id: string): void;
  stitchRoads(): void;
  /** Безопасно материализовать топологию; перед вызовом UI кладёт doc в undo. */
  normalizeRoads(): RoadNormalizationReport;
  /** «Палка-на-палку»: слить наложенные слоями штрихи + впаять швы схождений. */
  mergeRoadOverlaps(): RoadOverlapMergeSummary;
  addRoadSuggestions(items: MapRoadSuggestion[]): void;
  confirmRoadTrace(vertices: LatLng[]): string;
  acceptRoadSuggestion(id: string): void;
  rejectRoadSuggestion(id: string): void;
  clearRoadSuggestions(): void;

  // ── Ограничения участков дорог (бывш. «особенности») ──
  addRoadAccess(vertices: LatLng[], mode?: RoadPaintMode): string;
  /** Новый инструмент «Ограничение дороги»: участок + правила одним объектом. */
  addRoadRestriction(vertices: LatLng[], fields: Partial<RoadAccess>): string;
  eraseRoadAccessTrace(vertices: LatLng[], radiusMeters?: number): void;
  updateRoadAccess(id: string, fields: Partial<RoadAccess>): void;
  removeRoadAccess(id: string): void;

  /** Ластик красного пунктира: режет возможные дороги под трассой (кистью). */
  eraseSuggestionTrace(vertices: LatLng[], radiusMeters?: number): void;

  // ── Ж/д переезды ──
  addCrossing(p: LatLng): string;
  updateCrossing(id: string, fields: Partial<MapCrossing>): void;
  removeCrossing(id: string): void;

  // ── «Высота проезда» (тоннели/трубы над дорогой) ──
  addClearance(p: LatLng): string;
  updateClearance(id: string, fields: Partial<MapClearance>): void;
  removeClearance(id: string): void;

  // ── Ж/д пути (визуальный слой) ──
  addRailway(vertices: LatLng[]): string;
  updateRailway(id: string, fields: Partial<MapRailway>): void;
  removeRailway(id: string): void;

  // ── Фокус из «Цеха» ──
  requestFocusWarehouse(id: string): void;
  requestFocusPoint(id: string): void;
  clearFocusWarehouse(): void;
}

export const useMapStore = create<MapState>((set, get) => ({
  doc: EMPTY_MAP_DOC,
  loaded: false,
  focusWarehouseId: null,
  focusPointId: null,
  canUndoBrush: false,
  canRedoBrush: false,

  setDoc: (doc) => set({ doc }),
  setLoaded: (loaded) => set({ loaded }),
  beginBrushEdit: () => {
    if (!brushBefore) brushBefore = get().doc;
  },
  commitBrushEdit: () => {
    const before = brushBefore;
    brushBefore = null;
    const after = get().doc;
    if (!before || before === after) return;
    brushUndo.push({ before, after });
    if (brushUndo.length > BRUSH_HISTORY_LIMIT) brushUndo.shift();
    brushRedo.length = 0;
    set({ canUndoBrush: true, canRedoBrush: false });
  },
  undoBrushEdit: () => {
    const entry = brushUndo[brushUndo.length - 1];
    if (!entry || get().doc !== entry.after) {
      clearBrushHistory();
      set({ canUndoBrush: false, canRedoBrush: false });
      return;
    }
    brushUndo.pop();
    brushRedo.push(entry);
    applyingBrushHistory = true;
    set({ doc: entry.before, canUndoBrush: brushUndo.length > 0, canRedoBrush: true });
    applyingBrushHistory = false;
  },
  redoBrushEdit: () => {
    const entry = brushRedo[brushRedo.length - 1];
    if (!entry || get().doc !== entry.before) {
      clearBrushHistory();
      set({ canUndoBrush: false, canRedoBrush: false });
      return;
    }
    brushRedo.pop();
    brushUndo.push(entry);
    applyingBrushHistory = true;
    set({ doc: entry.after, canUndoBrush: true, canRedoBrush: brushRedo.length > 0 });
    applyingBrushHistory = false;
  },

  addPoint: (p) => {
    const id = makeId();
    set((s) => ({ doc: { ...s.doc, points: [...s.doc.points, { ...p, id }] } }));
    return id;
  },
  updatePoint: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        points: s.doc.points.map((p) => (p.id === id ? { ...p, ...fields } : p)),
      },
    })),
  removePoint: (id) =>
    set((s) => ({ doc: { ...s.doc, points: s.doc.points.filter((p) => p.id !== id) } })),
  duplicatePoint: (id) => {
    const src = useMapStore.getState().doc.points.find((p) => p.id === id);
    if (!src) return null;
    const copyId = makeId();
    // Сдвигаем копию на ~25 м к юго-востоку, чтобы она не легла поверх оригинала.
    const copy: MapPoint = {
      ...src,
      id: copyId,
      equipment: { ...src.equipment },
      allowedVehicles: [...src.allowedVehicles],
      vehiclesByPurpose: {
        tech: [...((src.vehiclesByPurpose ?? {}).tech ?? [])],
        exped: [...((src.vehiclesByPurpose ?? {}).exped ?? [])],
        other: [...((src.vehiclesByPurpose ?? {}).other ?? [])],
      },
      rearByPurpose: {
        tech: [...((src.rearByPurpose ?? {}).tech ?? [])],
        exped: [...((src.rearByPurpose ?? {}).exped ?? [])],
        other: [...((src.rearByPurpose ?? {}).other ?? [])],
      },
      lat: src.lat - 0.00022,
      lng: src.lng + 0.00035,
    };
    set((s) => ({ doc: { ...s.doc, points: [...s.doc.points, copy] } }));
    return copyId;
  },

  addArea: (a) => {
    const id = makeId();
    set((s) => ({ doc: { ...s.doc, areas: [...s.doc.areas, { ...a, id }] } }));
    return id;
  },
  updateArea: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        areas: s.doc.areas.map((a) => (a.id === id ? { ...a, ...fields } : a)),
      },
    })),
  removeArea: (id) =>
    set((s) => ({ doc: { ...s.doc, areas: s.doc.areas.filter((a) => a.id !== id) } })),

  addRoad: (r) => {
    const id = makeId();
    set((s) => ({
      doc: {
        ...s.doc,
        roads: appendRoadToNetwork(s.doc.roads, { ...r, id }, r.sourceId ? 'exact' : 'freehand'),
      },
    }));
    return id;
  },
  updateRoad: (id, fields) =>
    set((s) => {
      const current = s.doc.roads.find((road) => road.id === id);
      if (!current) return s;
      if (!fields.vertices) {
        return { doc: { ...s.doc, roads: s.doc.roads.map((road) => (road.id === id ? { ...road, ...fields } : road)) } };
      }
      const updated = { ...current, ...fields };
      if (updated.vertices.length < 2 || polylineLengthMeters(updated.vertices) < MIN_NEW_ROAD_LENGTH_METERS) return s;
      const roads = appendRoadToNetwork(s.doc.roads.filter((road) => road.id !== id), updated, 'exact');
      return { doc: { ...s.doc, roads } };
    }),
  removeRoad: (id) =>
    set((s) => ({ doc: { ...s.doc, roads: s.doc.roads.filter((r) => r.id !== id) } })),
  eraseRoadTrace: (trace, radiusMeters) =>
    set((s) => {
      if (trace.length < 1) return s;
      // Частичный ластик: режем КУСОК под трассой, а не всю дорогу. НЕ пересшиваем
      // (иначе разрыв затянулся бы обратно) — остатки остаются как есть.
      let changed = false;
      const roads = s.doc.roads.flatMap((road) => {
        const pieces = eraseRoadByTrace(road, trace, radiusMeters ?? ROAD_ERASE_TOLERANCE_METERS);
        if (pieces.length !== 1 || pieces[0] !== road) changed = true;
        return pieces;
      });
      if (!changed) return s;
      return { doc: { ...s.doc, roads } };
    }),
  straightenRoad: (id) =>
    set((s) => {
      const road = s.doc.roads.find((r) => r.id === id);
      if (!road) return s;
      const straight = { ...road, vertices: straightenPolyline(road.vertices) };
      const roads = appendRoadToNetwork(s.doc.roads.filter((r) => r.id !== id), straight, 'exact');
      return { doc: { ...s.doc, roads } };
    }),
  stitchRoads: () =>
    set((s) => ({ doc: { ...s.doc, roads: normalizeRoadTopology(s.doc.roads).roads } })),
  normalizeRoads: () => {
    const current = get().doc;
    const result = normalizeRoadTopology(current.roads);
    if (result.roads !== current.roads) {
      // Отдельная точка возврата перед каждой нормализацией, независимо от undo
      // и семи суточных снимков основного репозитория карты.
      void window.pyn?.cache?.save('flow-map-pre-normalize', JSON.stringify(current));
      set({ doc: { ...current, roads: result.roads } });
    }
    return result.report;
  },
  mergeRoadOverlaps: () => {
    const current = get().doc;
    // One bounded canonicalization pass. `mergeOverlappingRoads` already runs
    // its own local fixpoint; repeating the whole O(n²) pipeline in the renderer
    // froze the map while adding no useful V-junctions on the real network.
    const merged = mergeOverlappingRoads(current.roads);
    const welded = materializeConvergenceWelds(merged.roads);
    const normalized = normalizeRoadTopology(welded.roads, { endpointSnapMeters: 6 });
    const summary: RoadOverlapMergeSummary = {
      merge: merged.report,
      welds: welded.welds,
      norm: normalized.report,
    };
    const touched = merged.report.roadsAbsorbed + merged.report.roadsTrimmed + welded.welds + normalized.report.changedRoads;
    if (touched > 0) {
      // Отдельная точка возврата перед слиянием, независимо от undo и снимков.
      void window.pyn?.cache?.save('flow-map-pre-merge', JSON.stringify(current));
      set({ doc: { ...current, roads: normalized.roads } });
    }
    return summary;
  },
  addRoadSuggestions: (items) =>
    set((s) => {
      const known = new Set(s.doc.roadSuggestions.map((item) => item.id));
      for (const road of s.doc.roads) {
        if (road.sourceId) known.add(road.sourceId);
      }
      const next = items.filter((item) => item.vertices.length >= 2 && !known.has(item.id));
      return { doc: { ...s.doc, roadSuggestions: [...s.doc.roadSuggestions, ...next] } };
    }),
  confirmRoadTrace: (trace) => {
    const id = makeId();
    set((s) => {
      // Берём ТОЧНУЮ геометрию красной (а не курсорную трассу) → без разрыва;
      // красная режется ровно на остатки; продолжение стыкуется в той же вершине.
      const { roadVertices, suggestions } = confirmTraceToRoad(s.doc.roadSuggestions, trace);
      const road: MapRoad = { id, name: '', vertices: roadVertices };
      return {
        doc: {
          ...s.doc,
          roads: appendRoadToNetwork(s.doc.roads, road, 'exact'),
          roadSuggestions: suggestions,
        },
      };
    });
    return id;
  },
  acceptRoadSuggestion: (id) =>
    set((s) => {
      const suggestion = s.doc.roadSuggestions.find((item) => item.id === id);
      if (!suggestion) return s;
      const road: MapRoad = {
        id: makeId(),
        name: suggestion.name,
        vertices: suggestion.vertices,
        sourceId: suggestion.id,
      };
      return {
        doc: {
          ...s.doc,
          roads: appendRoadToNetwork(s.doc.roads, road, 'exact'),
          roadSuggestions: s.doc.roadSuggestions.filter((item) => item.id !== id),
        },
      };
    }),
  rejectRoadSuggestion: (id) =>
    set((s) => ({ doc: { ...s.doc, roadSuggestions: s.doc.roadSuggestions.filter((item) => item.id !== id) } })),
  clearRoadSuggestions: () =>
    set((s) => ({ doc: { ...s.doc, roadSuggestions: [] } })),

  addRoadAccess: (vertices, mode = 'gazelle') => {
    const id = makeId();
    const base = { id, vertices, vehiclesMode: 'allow' as const, vehiclesByPurpose: allVehiclesByPurpose(), note: '', closedFrom: '', closedTo: '' };
    const access: RoadAccess = mode === 'closed'
      ? { ...base, kind: 'closed', vehicles: [] }
      : { ...base, kind: 'limited', vehicles: mode === 'erase' ? [] : [mode] };
    set((s) => ({ doc: { ...s.doc, roadAccess: [...s.doc.roadAccess, access] } }));
    return id;
  },
  addRoadRestriction: (vertices, fields) => {
    const id = makeId();
    const access: RoadAccess = {
      id,
      vertices,
      kind: fields.kind ?? 'limited',
      vehicles: fields.vehicles ?? [],
      vehiclesMode: fields.vehiclesMode ?? 'allow',
      vehiclesByPurpose: fields.vehiclesByPurpose ?? allVehiclesByPurpose(),
      note: fields.note ?? '',
      closedFrom: fields.closedFrom ?? '',
      closedTo: fields.closedTo ?? '',
    };
    set((s) => ({ doc: { ...s.doc, roadAccess: [...s.doc.roadAccess, access] } }));
    return id;
  },
  eraseRoadAccessTrace: (vertices, radiusMeters) =>
    set((s) => {
      if (vertices.length < 1) return s;
      let changed = false;
      const roadAccess = s.doc.roadAccess.flatMap((access) => {
        if (access.vertices.length < 2) return [access];
        const pseudoRoad: MapRoad = { id: access.id, name: '', vertices: access.vertices };
        const pieces = eraseRoadByTrace(pseudoRoad, vertices, radiusMeters ?? ROAD_ACCESS_ERASE_TOLERANCE_METERS);
        if (pieces.length !== 1 || pieces[0]!.vertices !== access.vertices) changed = true;
        return pieces.map((piece, index) => ({
          ...access,
          id: index === 0 ? access.id : makeId(),
          vertices: piece.vertices,
        }));
      });
      return changed ? { doc: { ...s.doc, roadAccess } } : s;
    }),
  updateRoadAccess: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        roadAccess: s.doc.roadAccess.map((a) => (a.id === id ? { ...a, ...fields } : a)),
      },
    })),
  removeRoadAccess: (id) =>
    set((s) => ({ doc: { ...s.doc, roadAccess: s.doc.roadAccess.filter((a) => a.id !== id) } })),

  eraseSuggestionTrace: (trace, radiusMeters) =>
    set((s) => {
      if (trace.length < 1) return s;
      // Красные — помощник: кисть режет кусок под трассой (как ластик дорог),
      // остатки остаются красными.
      let changed = false;
      const roadSuggestions = s.doc.roadSuggestions.flatMap((item) => {
        const pieces = eraseRoadByTrace(
          { id: item.id, name: item.name, vertices: item.vertices },
          trace,
          radiusMeters ?? ROAD_ERASE_TOLERANCE_METERS,
        );
        if (pieces.length === 1 && pieces[0]!.vertices === item.vertices) return [item];
        changed = true;
        return pieces.map((p, i) => ({ ...item, id: i === 0 ? item.id : `${item.id}:e:${p.id}`, vertices: p.vertices }));
      });
      if (!changed) return s;
      return { doc: { ...s.doc, roadSuggestions } };
    }),

  addCrossing: (p) => {
    const id = makeId();
    const crossing: MapCrossing = { id, lat: p.lat, lng: p.lng, name: '', note: '' };
    set((s) => ({ doc: { ...s.doc, crossings: [...(s.doc.crossings ?? []), crossing] } }));
    return id;
  },
  updateCrossing: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        crossings: (s.doc.crossings ?? []).map((c) => (c.id === id ? { ...c, ...fields } : c)),
      },
    })),
  removeCrossing: (id) =>
    set((s) => ({ doc: { ...s.doc, crossings: (s.doc.crossings ?? []).filter((c) => c.id !== id) } })),

  addClearance: (p) => {
    const id = makeId();
    // 5000 мм по умолчанию — точное значение сразу правится в карточке.
    const clearance: MapClearance = { id, lat: p.lat, lng: p.lng, heightMm: 5000, note: '' };
    set((s) => ({ doc: { ...s.doc, clearances: [...(s.doc.clearances ?? []), clearance] } }));
    return id;
  },
  updateClearance: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        clearances: (s.doc.clearances ?? []).map((c) => (c.id === id ? { ...c, ...fields } : c)),
      },
    })),
  removeClearance: (id) =>
    set((s) => ({ doc: { ...s.doc, clearances: (s.doc.clearances ?? []).filter((c) => c.id !== id) } })),

  addRailway: (vertices) => {
    const id = makeId();
    const railway: MapRailway = { id, name: '', vertices: smoothPolyline(vertices) };
    set((s) => ({ doc: { ...s.doc, railways: [...(s.doc.railways ?? []), railway] } }));
    return id;
  },
  updateRailway: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        railways: (s.doc.railways ?? []).map((r) => (r.id === id ? { ...r, ...fields } : r)),
      },
    })),
  removeRailway: (id) =>
    set((s) => ({ doc: { ...s.doc, railways: (s.doc.railways ?? []).filter((r) => r.id !== id) } })),

  requestFocusWarehouse: (id) => set({ focusWarehouseId: id }),
  requestFocusPoint: (id) => set({ focusPointId: id }),
  clearFocusWarehouse: () => set({ focusWarehouseId: null, focusPointId: null }),
}));

useMapStore.subscribe((state, previous) => {
  if (state.doc === previous.doc || applyingBrushHistory || brushBefore) return;
  if (brushUndo.length === 0 && brushRedo.length === 0) return;
  clearBrushHistory();
  useMapStore.setState({ canUndoBrush: false, canRedoBrush: false });
});

function clearBrushHistory(): void {
  brushBefore = null;
  brushUndo.length = 0;
  brushRedo.length = 0;
}

const ROAD_ERASE_TOLERANCE_METERS = 9;
