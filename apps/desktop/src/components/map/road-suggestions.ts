import { mapRoadSuggestionsGet } from '@pyn/core';
import { api } from '@/lib/api';
import { polylineLengthMeters } from './geo';
import type { LatLng, MapRoadSuggestion } from './map-types';

/** Красный черновик дорог грузим через наш E2E API/VPS, не прямым fetch наружу. */
export async function loadNtmkOsmRoadSuggestions(): Promise<MapRoadSuggestion[]> {
  const items = await mapRoadSuggestionsGet(api);
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
