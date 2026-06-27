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

/** Сохранить общий документ карты (admin). `doc` — JSON-строка. */
export async function mapSet(client: ApiClient, doc: string): Promise<MapDocResult> {
  const wire = await client.call<MapWire>('map_set', { doc });
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
