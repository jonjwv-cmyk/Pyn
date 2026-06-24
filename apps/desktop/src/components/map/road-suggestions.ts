import { polylineLengthMeters } from './geo';
import type { LatLng, MapRoadSuggestion } from './map-types';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const NTMK_BBOX = {
  south: 57.909,
  west: 59.999,
  north: 57.936,
  east: 60.061,
};

type OverpassWay = {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

type OverpassResponse = {
  elements?: OverpassWay[];
};

export async function loadNtmkOsmRoadSuggestions(): Promise<MapRoadSuggestion[]> {
  const data = `
    [out:json][timeout:25];
    (
      way["highway"~"^(primary|primary_link|secondary|secondary_link|tertiary|unclassified|service|track)$"]
        (${NTMK_BBOX.south},${NTMK_BBOX.west},${NTMK_BBOX.north},${NTMK_BBOX.east});
    );
    out geom;
  `;

  let lastError: unknown = null;
  for (const url of OVERPASS_URLS) {
    try {
      const resp = await fetch(`${url}?data=${encodeURIComponent(data)}`);
      if (!resp.ok) throw new Error(`Overpass ${resp.status}`);
      return parseOverpassSuggestions(await resp.json() as OverpassResponse);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Не удалось загрузить дорожный черновик');
}

function parseOverpassSuggestions(raw: OverpassResponse): MapRoadSuggestion[] {
  const ways = Array.isArray(raw.elements) ? raw.elements : [];
  return ways.flatMap((way) => {
    if (way.type !== 'way' || !Array.isArray(way.geometry)) return [];
    const vertices: LatLng[] = way.geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => ({ lat: p.lat, lng: p.lon }));
    if (vertices.length < 2 || polylineLengthMeters(vertices) < 18) return [];
    const tags = way.tags ?? {};
    const name = tags.name || tags.highway || `OSM ${way.id}`;
    return [{
      id: `osm:${way.id}`,
      name,
      vertices,
      source: 'osm' as const,
    }];
  });
}
