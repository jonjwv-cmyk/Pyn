/**
 * map-repo — персистентность карты. ОБЩИЙ документ на сервере (D1 `map_state`,
 * endpoints map_get/map_set) + локальный зашифрованный кэш `flow-map` как
 * быстрый старт / офлайн-фоллбэк.
 *
 *   • initMap() — кэш (мгновенно) → дотягивает с сервера; если сервер пуст, а
 *     локально нарисовано — заливает локальное на сервер (миграция).
 *   • любое изменение doc → debounce → cache.save + push на сервер (map_set).
 *   • WS `map_changed` (другой клиент сохранил) → refreshMapFromServer() → у всех
 *     одинаковая карта реалтайм. Эхо своих правок гасим по `version`.
 */

import { mapGet, mapSet } from '@pyn/core';
import { legacyNormToLatLng } from '@/components/map/geo';
import {
  EMPTY_MAP_DOC,
  EMPTY_POINT_EQUIPMENT,
  VEHICLE_TYPES,
  type LatLng,
  type MapDoc,
  type PointEquipment,
  type VehicleType,
} from '@/components/map/map-types';
import { stitchRoadSegments } from '@/components/map/road-network';
import { api } from './api';
import { useMapStore } from './map-store';

const CACHE_NAME = 'flow-map';
const BACKUP_NAME = 'pyn:flow-map:plain-backup:v1';
const SAVE_DEBOUNCE_MS = 120;
const PUSH_DEBOUNCE_MS = 700;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;
let lastSavedDoc: MapDoc | null = null;
/** Последняя известная версия серверного документа (для гашения эха своих правок). */
let serverVersion = 0;
/** true пока применяем входящий серверный документ — не пушим его обратно. */
let applyingRemote = false;

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
  const validVehicles = new Set<string>(VEHICLE_TYPES.map((v) => v.id));
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
        equipment: normalizePointEquipment(r.equipment),
        rearUnload: r.rearUnload === true,
        allowedVehicles: Array.isArray(r.allowedVehicles)
          ? r.allowedVehicles.filter((v): v is VehicleType => typeof v === 'string' && validVehicles.has(v))
          : [],
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
  const roadAccess = Array.isArray(raw.roadAccess)
    ? raw.roadAccess.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      const vehicles = Array.isArray(r.vehicles)
        ? (r.vehicles.filter((v): v is VehicleType => typeof v === 'string' && validVehicles.has(v)))
        : [];
      const kind: 'limited' | 'closed' = r.kind === 'closed' ? 'closed' : 'limited';
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        vertices: verts,
        kind,
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

function normalizePointEquipment(raw: unknown): PointEquipment {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_POINT_EQUIPMENT };
  const r = raw as Record<string, unknown>;
  return {
    crane: r.crane === true,
    forklift: r.forklift === true,
    stacker: r.stacker === true,
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

// ─── Серверная синхронизация (общий документ карты) ──────────────────────────

/** Применить документ с сервера в стор (без обратного пуша). */
function applyServerDoc(raw: string, version: number): void {
  let doc: MapDoc;
  try {
    doc = normalizeDoc(JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>);
  } catch {
    return;
  }
  applyingRemote = true;
  try {
    useMapStore.getState().setDoc(doc);
    lastSavedDoc = doc;   // не триггерим повторный cache-save / push на этот doc
    serverVersion = version;
    void flush(doc);      // в локальный кэш как есть
  } finally {
    applyingRemote = false;
  }
}

/** Отправить текущий документ на сервер (admin). Обновляет serverVersion. */
async function pushNow(doc: MapDoc): Promise<void> {
  try {
    const res = await mapSet(api, JSON.stringify(doc));
    serverVersion = res.version;
    lastSavedDoc = doc;
  } catch (err) {
    // Не admin (403) / нет сети — остаёмся на локальном кэше, попробуем позже.
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] server push failed:', err);
  }
}

function schedulePush(doc: MapDoc): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushNow(doc); }, PUSH_DEBOUNCE_MS);
}

/** Догнать сервер, если там версия новее нашей. Вызывается на WS `map_changed`. */
export async function refreshMapFromServer(): Promise<void> {
  try {
    const res = await mapGet(api);
    if (res.doc && res.version > serverVersion) applyServerDoc(res.doc, res.version);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] server refresh failed:', err);
  }
}

/** Первичная синхронизация: применить серверное ИЛИ залить локальное (миграция). */
async function syncFromServerInitial(): Promise<void> {
  try {
    const res = await mapGet(api);
    if (res.doc && res.version > 0) {
      applyServerDoc(res.doc, res.version);            // сервер = источник правды
    } else {
      serverVersion = res.version;
      const localDoc = useMapStore.getState().doc;
      if (scoreDoc(localDoc) > 0) await pushNow(localDoc); // сервер пуст → заливаем своё
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] initial server sync failed (остаёмся на кэше):', err);
  }
}

/** Грузит кэш + сервер + включает авто-сохранение (локально + на сервер). */
export async function initMap(): Promise<void> {
  await loadMapFromCache();
  useMapStore.getState().setLoaded(true);

  if (!subscribed) {
    subscribed = true;
    useMapStore.subscribe((state) => {
      if (state.doc !== lastSavedDoc) {
        scheduleSave(state.doc);
        if (!applyingRemote) schedulePush(state.doc);
      }
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

  // После локального кэша — синхронизируемся с сервером (общая карта у всех).
  void syncFromServerInitial();
}

/** Принудительный сброс на диск (например, перед logout/wipe). */
export async function flushMapNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await flush(useMapStore.getState().doc);
}
