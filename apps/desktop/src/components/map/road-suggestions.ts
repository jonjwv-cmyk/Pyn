import { mapBuildingsGet, mapFootwaysGet, mapRailwaysGet, mapRoadSuggestionsGet, type MapBBox } from '@pyn/core';
import { api } from '@/lib/api';
import { polylineLengthMeters } from './geo';
import type { BuildingOutline, ExternalRailway, LatLng, MapRoadSuggestion } from './map-types';

function wireVertices(raw: unknown): LatLng[] {
  return Array.isArray(raw)
    ? (raw as Array<{ lat?: number; lng?: number }>).flatMap((p) => (
      typeof p.lat === 'number' && typeof p.lng === 'number'
        ? [{ lat: p.lat, lng: p.lng }]
        : []
    ))
    : [];
}

/**
 * Красный черновик дорог грузим через наш E2E API/VPS, не прямым fetch наружу.
 * `bbox` — текущая видимая область карты: грузим дороги по экрану (Кушва, Н.Тагил
 * и т.д.), а не только площадку НТМК. Без bbox сервер возьмёт НТМК по умолчанию.
 */
export async function loadNtmkOsmRoadSuggestions(bbox?: MapBBox): Promise<MapRoadSuggestion[]> {
  const items = await mapRoadSuggestionsGet(api, bbox);
  return items.flatMap((item) => {
    const vertices = wireVertices(item.vertices);
    if (vertices.length < 2 || polylineLengthMeters(vertices) < 18) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: typeof item.name === 'string' ? item.name : '',
      source: item.source === 'ai' ? 'ai' as const : 'osm' as const,
      vertices,
    }];
  });
}

/** Внешние ж/д пути (OSM) по видимой области — для кандидатов на переезд. */
export async function loadOsmRailways(bbox?: MapBBox): Promise<ExternalRailway[]> {
  const items = await mapRailwaysGet(api, bbox);
  return items.flatMap((item) => {
    const vertices = wireVertices(item.vertices);
    if (vertices.length < 2) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: typeof item.name === 'string' ? item.name : '',
      vertices,
    }];
  });
}

/** Контуры зданий (OSM) по видимой области — лёгкий фиолетовый слой-подложка. */
export async function loadOsmBuildings(bbox?: MapBBox): Promise<BuildingOutline[]> {
  const items = await mapBuildingsGet(api, bbox);
  return items.flatMap((item) => {
    const vertices = wireVertices(item.vertices);
    if (vertices.length < 3) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      vertices,
    }];
  });
}

/** Пешеходные дорожки (OSM) — рисуются «зеброй», справочный слой. */
export async function loadOsmFootways(bbox?: MapBBox): Promise<ExternalRailway[]> {
  const items = await mapFootwaysGet(api, bbox);
  return items.flatMap((item) => {
    const vertices = wireVertices(item.vertices);
    if (vertices.length < 2) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: '',
      vertices,
    }];
  });
}
