import { mapRoadSuggestionsGet, type MapBBox } from '@pyn/core';
import { api } from '@/lib/api';
import { polylineLengthMeters } from './geo';
import type { LatLng, MapRoadSuggestion } from './map-types';

/**
 * Красный черновик дорог грузим через наш E2E API/VPS, не прямым fetch наружу.
 * `bbox` — текущая видимая область карты: грузим дороги по экрану (Кушва, Н.Тагил
 * и т.д.), а не только площадку НТМК. Без bbox сервер возьмёт НТМК по умолчанию.
 */
export async function loadNtmkOsmRoadSuggestions(bbox?: MapBBox): Promise<MapRoadSuggestion[]> {
  const items = await mapRoadSuggestionsGet(api, bbox);
  return items.flatMap((item) => {
    const vertices: LatLng[] = Array.isArray(item.vertices)
      ? item.vertices.flatMap((p) => (
        typeof p.lat === 'number' && typeof p.lng === 'number'
          ? [{ lat: p.lat, lng: p.lng }]
          : []
      ))
      : [];
    if (vertices.length < 2 || polylineLengthMeters(vertices) < 18) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: typeof item.name === 'string' ? item.name : '',
      source: item.source === 'ai' ? 'ai' : 'osm',
      vertices,
    }];
  });
}
