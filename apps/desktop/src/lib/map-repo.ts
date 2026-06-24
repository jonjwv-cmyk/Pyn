/**
 * map-repo — локальная персистентность карты (v1, без сервера). Точки/области/
 * дороги живут в зашифрованном кэше `flow-map` (safeStorage, как базы).
 *
 *   • initMap()  — на старте грузит кэш в store + включает авто-сохранение.
 *   • авто-сохранение — подписка на useMapStore: любое изменение `doc` → debounce
 *     400мс → cache.save.
 */

import { legacyNormToLatLng } from '@/components/map/geo';
import { EMPTY_MAP_DOC, VEHICLE_TYPES, type LatLng, type MapDoc, type VehicleType } from '@/components/map/map-types';
import { stitchRoadSegments } from '@/components/map/road-network';
import { useMapStore } from './map-store';

const CACHE_NAME = 'flow-map';
const BACKUP_NAME = 'pyn:flow-map:plain-backup:v1';
const SAVE_DEBOUNCE_MS = 120;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;
let lastSavedDoc: MapDoc | null = null;

function toLatLng(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.lat === 'number' && typeof r.lng === 'number') {
    return { lat: r.lat, lng: r.lng };
  }
  // Миграция старого локального формата: x/y в долях статичного снимка.
  if (typeof r.x === 'number' && typeof r.y === 'number') {
    return legacyNormToLatLng(r.x, r.y);
  }
  return null;
}

function normalizeDoc(raw: Partial<MapDoc> & Record<string, unknown>): MapDoc {
  const points = Array.isArray(raw.points)
    ? raw.points.flatMap((p) => {
      const ll = toLatLng(p);
      if (!ll || !p || typeof p !== 'object') return [];
      const r = p as unknown as Record<string, unknown>;
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        ...ll,
        warehouseId: typeof r.warehouseId === 'string' ? r.warehouseId : null,
        label: typeof r.label === 'string' ? r.label : '',
        comment: typeof r.comment === 'string' ? r.comment : '',
        weight: typeof r.weight === 'number' ? r.weight : 1,
      }];
    })
    : [];
  const areas = Array.isArray(raw.areas)
    ? raw.areas.flatMap((a) => {
      if (!a || typeof a !== 'object') return [];
      const r = a as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 3) return [];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        color: typeof r.color === 'string' ? r.color : '#E8836B',
        vertices: verts,
        shopName: typeof r.shopName === 'string' ? r.shopName : null,
      }];
    })
    : [];
  const roads = Array.isArray(raw.roads)
    ? raw.roads.flatMap((road) => {
      if (!road || typeof road !== 'object') return [];
      const r = road as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        vertices: verts,
        sourceId: typeof r.sourceId === 'string' ? r.sourceId : undefined,
      }];
    })
    : [];
  const roadSuggestions = Array.isArray(raw.roadSuggestions)
    ? raw.roadSuggestions.flatMap((road) => {
      if (!road || typeof road !== 'object') return [];
      const r = road as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      const source: 'osm' | 'ai' = r.source === 'ai' ? 'ai' : 'osm';
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        vertices: verts,
        source,
      }];
    })
    : [];
  const validVehicles = new Set<string>(VEHICLE_TYPES.map((v) => v.id));
  const roadAccess = Array.isArray(raw.roadAccess)
    ? raw.roadAccess.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      const vehicles = Array.isArray(r.vehicles)
        ? (r.vehicles.filter((v): v is VehicleType => typeof v === 'string' && validVehicles.has(v)))
        : [];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        vertices: verts,
        vehicles,
        note: typeof r.note === 'string' ? r.note : '',
      }];
    })
    : [];

  return {
    version: EMPTY_MAP_DOC.version,
    points,
    areas,
    roads: stitchRoadSegments(roads),
    roadSuggestions,
    roadAccess,
  };
}

async function flush(doc: MapDoc): Promise<void> {
  writePlainBackup(doc);
  try {
    await window.pyn?.cache?.save(CACHE_NAME, JSON.stringify(doc));
    lastSavedDoc = doc;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] cache save failed:', err);
  }
}

function scheduleSave(doc: MapDoc): void {
  writePlainBackup(doc);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flush(doc);
  }, SAVE_DEBOUNCE_MS);
}

function writePlainBackup(doc: MapDoc): void {
  try {
    window.localStorage?.setItem(BACKUP_NAME, JSON.stringify(doc));
  } catch { /* localStorage backup is best-effort */ }
}

function loadPlainBackup(): MapDoc | null {
  try {
    const raw = window.localStorage?.getItem(BACKUP_NAME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>;
    return normalizeDoc(parsed);
  } catch {
    return null;
  }
}

function scoreDoc(doc: MapDoc | null): number {
  if (!doc) return -1;
  return doc.points.length * 10 + doc.areas.length * 10 + doc.roads.length * 100 + doc.roadSuggestions.length + doc.roadAccess.length * 5;
}

/** Загрузка карты из кэша (encrypted). true если найдена. */
export async function loadMapFromCache(): Promise<boolean> {
  let encryptedDoc: MapDoc | null = null;
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>;
      encryptedDoc = normalizeDoc(parsed);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] cache load failed:', err);
  }

  const backupDoc = loadPlainBackup();
  const doc = scoreDoc(backupDoc) > scoreDoc(encryptedDoc) ? backupDoc : encryptedDoc;
  if (!doc) return false;
  useMapStore.getState().setDoc(doc);
  lastSavedDoc = doc;
  if (doc === backupDoc) void flush(doc);
  return true;
}

/** Грузит кэш + включает авто-сохранение (идемпотентно). */
export async function initMap(): Promise<void> {
  await loadMapFromCache();
  useMapStore.getState().setLoaded(true);

  if (!subscribed) {
    subscribed = true;
    useMapStore.subscribe((state) => {
      if (state.doc !== lastSavedDoc) scheduleSave(state.doc);
    });
    window.addEventListener('beforeunload', () => {
      const doc = useMapStore.getState().doc;
      writePlainBackup(doc);
      void flush(doc);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      void flushMapNow();
    });
  }
}

/** Принудительный сброс на диск (например, перед logout/wipe). */
export async function flushMapNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await flush(useMapStore.getState().doc);
}
