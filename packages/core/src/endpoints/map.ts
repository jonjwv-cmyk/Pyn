import type { ApiClient } from '../api/client';

/**
 * Раздел «Карта» — общий документ (точки складов / области цехов / дороги /
 * «особенности» машин), синхронный всем реалтайм. Сервер хранит весь документ
 * как непрозрачную JSON-строку + монотонный `version`; клиент сам сериализует
 * и разбирает. Любая запись (admin) → WS `map_changed { version }`.
 */
export interface MapDocResult {
  /** Непрозрачная JSON-строка документа карты ('' если сервер пуст). */
  doc: string;
  version: number;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface MapRoadSuggestionWire {
  id?: string;
  name?: string;
  source?: 'osm' | 'ai';
  vertices?: Array<{ lat?: number; lng?: number }>;
}

interface MapWire {
  ok?: boolean;
  doc?: string;
  version?: number;
  updated_by?: string;
  updated_by_name?: string;
  updated_at?: string;
}

interface MapSuggestionsWire {
  ok?: boolean;
  items?: MapRoadSuggestionWire[];
}

function wireToResult(w: MapWire): MapDocResult {
  return {
    doc: typeof w.doc === 'string' ? w.doc : '',
    version: Number(w.version) || 0,
    updatedBy: w.updated_by || '',
    updatedByName: w.updated_by_name || '',
    updatedAt: w.updated_at || '',
  };
}

/** Прочитать общий документ карты с сервера. */
export async function mapGet(client: ApiClient): Promise<MapDocResult> {
  const wire = await client.call<MapWire>('map_get', {});
  return wireToResult(wire);
}

/**
 * Сохранить общий документ карты (admin/developer). `doc` — JSON-строка.
 * `clientVersion` — semver сборки (сервер пишет карту только с ≥ 1.3.11).
 */
export async function mapSet(
  client: ApiClient,
  doc: string,
  clientVersion?: string,
): Promise<MapDocResult> {
  const payload: Record<string, unknown> = { doc };
  if (clientVersion) {
    payload.client_version = clientVersion;
    payload.app_version = clientVersion;
  }
  const wire = await client.call<MapWire>('map_set', payload);
  return wireToResult(wire);
}

/** Прямоугольник видимой области карты (для подгрузки дорог «по экрану»). */
export interface MapBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Загрузить красный черновик дорог через наш API/VPS, без прямого выхода клиента
 * наружу. `bbox` — текущая видимая область; сервер ограничивает её по размеру.
 * Без bbox сервер берёт площадку НТМК по умолчанию (обратная совместимость).
 */
export async function mapRoadSuggestionsGet(client: ApiClient, bbox?: MapBBox): Promise<MapRoadSuggestionWire[]> {
  const params = bbox
    ? { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east }
    : {};
  const wire = await client.call<MapSuggestionsWire>('map_road_suggestions_get', params, { timeoutMs: 90_000 });
  return Array.isArray(wire.items) ? wire.items : [];
}

export interface MapRailwayWire {
  id?: string;
  name?: string;
  vertices?: Array<{ lat?: number; lng?: number }>;
}

export interface MapBuildingWire {
  id?: string;
  vertices?: Array<{ lat?: number; lng?: number }>;
}

/**
 * Внешние ж/д пути (OSM) по видимой области — справочный слой для отметки
 * переездов-кандидатов. Тем же путём, что красный черновик дорог (E2E, не наружу).
 */
export async function mapRailwaysGet(client: ApiClient, bbox?: MapBBox): Promise<MapRailwayWire[]> {
  const params = bbox
    ? { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east }
    : {};
  const wire = await client.call<{ ok?: boolean; items?: MapRailwayWire[] }>('map_railways_get', params, { timeoutMs: 90_000 });
  return Array.isArray(wire.items) ? wire.items : [];
}

/**
 * Обезличенные контуры зданий/сооружений (OSM) по видимой области — лёгкий
 * фиолетовый слой для читаемости тёмных участков снимка.
 */
export async function mapBuildingsGet(client: ApiClient, bbox?: MapBBox): Promise<MapBuildingWire[]> {
  const params = bbox
    ? { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east }
    : {};
  const wire = await client.call<{ ok?: boolean; items?: MapBuildingWire[] }>('map_buildings_get', params, { timeoutMs: 90_000 });
  return Array.isArray(wire.items) ? wire.items : [];
}

/** Пешеходные дорожки (OSM) — справочный слой «зеброй». */
export async function mapFootwaysGet(client: ApiClient, bbox?: MapBBox): Promise<MapBuildingWire[]> {
  const params = bbox
    ? { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east }
    : {};
  const wire = await client.call<{ ok?: boolean; items?: MapBuildingWire[] }>('map_footways_get', params, { timeoutMs: 90_000 });
  return Array.isArray(wire.items) ? wire.items : [];
}

export interface MapFootwayWire {
  id?: string;
  crossing?: number;
  vertices?: Array<{ lat?: number; lng?: number }>;
}

export interface MapRefWire {
  railways: MapRailwayWire[];
  buildings: MapBuildingWire[];
  footways: MapFootwayWire[];
  updatedAt: string;
}

/**
 * Справочные слои зоны ЕВРАЗ НТМК (ж/д, здания, пешеходки) из СЕРВЕРНОГО кэша
 * (D1, обновление раз в 12 мес). Один быстрый запрос — Overpass клиент не ждёт.
 */
export async function mapRefGet(client: ApiClient): Promise<MapRefWire> {
  const wire = await client.call<{
    ok?: boolean;
    railways?: MapRailwayWire[];
    buildings?: MapBuildingWire[];
    footways?: MapFootwayWire[];
    updated_at?: string;
  }>('map_ref_get', {}, { timeoutMs: 150_000 });
  return {
    railways: Array.isArray(wire.railways) ? wire.railways : [],
    buildings: Array.isArray(wire.buildings) ? wire.buildings : [],
    footways: Array.isArray(wire.footways) ? wire.footways : [],
    updatedAt: wire.updated_at || '',
  };
}
