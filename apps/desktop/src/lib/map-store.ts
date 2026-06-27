/**
 * Map store — состояние раздела «Карта» (точки складов / области / дороги).
 * Локальный, без сервера (v1) — персист в зашифрованном кэше через
 * `map-repo.ts` (подписка на изменения → debounce save).
 *
 * `focusWarehouseId` — эфемерный сигнал из карточки склада в «Цеха»: «открой
 * карту и наведись на этот склад». Карта читает и сбрасывает его.
 */

import { createZustandStore as create } from '@pyn/core';
import {
  EMPTY_MAP_DOC,
  makeId,
  type LatLng,
  type MapArea,
  type MapCrossing,
  type MapDoc,
  type MapPoint,
  type MapRailway,
  type MapRoad,
  type MapRoadSuggestion,
  type RoadPaintMode,
  type RoadAccess,
} from '@/components/map/map-types';
import { confirmTraceToRoad, eraseRoadByTrace, smoothPolyline, stitchRoadSegments, straightenPolyline } from '@/components/map/road-network';
import { distancePointToPolylineMeters } from '@/components/map/geo';

const ROAD_ACCESS_ERASE_TOLERANCE_METERS = 10;

interface MapState {
  doc: MapDoc;
  /** Загружен ли кэш с диска (до этого UI показывает «загрузка»). */
  loaded: boolean;
  /** Склад, на который надо навестись (из карточки «Цеха»). null — нет запроса. */
  focusWarehouseId: string | null;
  /** Конкретная точка карты, на которую надо навестись. */
  focusPointId: string | null;

  setDoc(doc: MapDoc): void;
  setLoaded(v: boolean): void;

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
  /** Стереть дороги, по которым прошлись «ластиком» (трасса). */
  eraseRoadTrace(vertices: LatLng[]): void;
  /** Выпрямить одну дорогу (убрать дрожание руки) и пересшить сеть. */
  straightenRoad(id: string): void;
  stitchRoads(): void;
  addRoadSuggestions(items: MapRoadSuggestion[]): void;
  confirmRoadTrace(vertices: LatLng[]): string;
  acceptRoadSuggestion(id: string): void;
  rejectRoadSuggestion(id: string): void;
  clearRoadSuggestions(): void;

  // ── Особенности дорог (какие машины проедут) ──
  addRoadAccess(vertices: LatLng[], mode?: RoadPaintMode): string;
  eraseRoadAccessTrace(vertices: LatLng[]): void;
  updateRoadAccess(id: string, fields: Partial<RoadAccess>): void;
  removeRoadAccess(id: string): void;

  // ── Ж/д переезды ──
  addCrossing(p: LatLng): string;
  updateCrossing(id: string, fields: Partial<MapCrossing>): void;
  removeCrossing(id: string): void;

  // ── Ж/д пути (визуальный слой) ──
  addRailway(vertices: LatLng[]): string;
  updateRailway(id: string, fields: Partial<MapRailway>): void;
  removeRailway(id: string): void;

  // ── Фокус из «Цеха» ──
  requestFocusWarehouse(id: string): void;
  requestFocusPoint(id: string): void;
  clearFocusWarehouse(): void;
}

export const useMapStore = create<MapState>((set) => ({
  doc: EMPTY_MAP_DOC,
  loaded: false,
  focusWarehouseId: null,
  focusPointId: null,

  setDoc: (doc) => set({ doc }),
  setLoaded: (loaded) => set({ loaded }),

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
    // Своя дорога нарисована «от руки» → сглаживаем дрожание (Чайкин), потом сеть
    // сама прорежет и сошьёт. Чужие/подтверждённые сегменты уже чистые.
    const vertices = r.sourceId ? r.vertices : smoothPolyline(r.vertices);
    set((s) => ({
      doc: {
        ...s.doc,
        roads: stitchRoadSegments([...s.doc.roads, { ...r, id, vertices }]),
      },
    }));
    return id;
  },
  updateRoad: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        roads: s.doc.roads.map((r) => (r.id === id ? { ...r, ...fields } : r)),
      },
    })),
  removeRoad: (id) =>
    set((s) => ({ doc: { ...s.doc, roads: s.doc.roads.filter((r) => r.id !== id) } })),
  eraseRoadTrace: (trace) =>
    set((s) => {
      if (trace.length < 1) return s;
      // Частичный ластик: режем КУСОК под трассой, а не всю дорогу. НЕ пересшиваем
      // (иначе разрыв затянулся бы обратно) — остатки остаются как есть.
      let changed = false;
      const roads = s.doc.roads.flatMap((road) => {
        const pieces = eraseRoadByTrace(road, trace, ROAD_ERASE_TOLERANCE_METERS);
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
      const roads = s.doc.roads.map((r) => (r.id === id ? straight : r));
      return { doc: { ...s.doc, roads: stitchRoadSegments(roads) } };
    }),
  stitchRoads: () =>
    set((s) => ({ doc: { ...s.doc, roads: stitchRoadSegments(s.doc.roads) } })),
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
          roads: stitchRoadSegments([...s.doc.roads, road]),
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
          roads: stitchRoadSegments([...s.doc.roads, road]),
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
    const access: RoadAccess = mode === 'closed'
      ? { id, vertices, kind: 'closed', vehicles: [], note: '' }
      : {
        id,
        vertices,
        kind: 'limited',
        vehicles: mode === 'erase' ? [] : [mode],
        note: '',
      };
    set((s) => ({ doc: { ...s.doc, roadAccess: [...s.doc.roadAccess, access] } }));
    return id;
  },
  eraseRoadAccessTrace: (vertices) =>
    set((s) => ({
      doc: {
        ...s.doc,
        roadAccess: s.doc.roadAccess.filter((access) => !roadAccessTouchesTrace(access, vertices)),
      },
    })),
  updateRoadAccess: (id, fields) =>
    set((s) => ({
      doc: {
        ...s.doc,
        roadAccess: s.doc.roadAccess.map((a) => (a.id === id ? { ...a, ...fields } : a)),
      },
    })),
  removeRoadAccess: (id) =>
    set((s) => ({ doc: { ...s.doc, roadAccess: s.doc.roadAccess.filter((a) => a.id !== id) } })),

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

function roadAccessTouchesTrace(access: RoadAccess, trace: LatLng[]): boolean {
  if (trace.length < 2 || access.vertices.length < 2) return false;
  for (const p of access.vertices) {
    if (distancePointToPolylineMeters(p, trace) <= ROAD_ACCESS_ERASE_TOLERANCE_METERS) return true;
  }
  for (const p of trace) {
    if (distancePointToPolylineMeters(p, access.vertices) <= ROAD_ACCESS_ERASE_TOLERANCE_METERS) return true;
  }
  return false;
}

const ROAD_ERASE_TOLERANCE_METERS = 9;
