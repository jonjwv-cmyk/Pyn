import { ipcMain } from 'electron';
import { setRainFrame, tileSessionFetch } from '../network/map-tiles';

type HourlyWeather = {
  time: string;
  tempC: number | null;
  precipMm: number | null;
  rainMm: number | null;
  snowCm: number | null;
  precipProb: number | null;
  code: number | null;
  windMs: number | null;
  windDir: number | null;
  gustMs: number | null;
};

type WeatherFieldPoint = {
  lat: number;
  lng: number;
  windMs: number | null;
  windDir: number | null;
  gustMs: number | null;
  precipMm: number | null;
  code: number | null;
  pressureHpa: number | null;
};

/**
 * Погода для раздела «Карта» — всё через тайл-сессию (тот же мост к VPS, что и
 * спутник; корп-прокси прямой выход режет). Источники бесплатные, без ключа:
 *   • RainViewer — кадр радара осадков (host+path) → ставим в map-tiles, рендер
 *     тянет тайлы `pyn-tile://rain/...`; возвращаем `frame` (метка времени, в URL
 *     слоя → форсит перезагрузку при обновлении кадра).
 *   • Open-Meteo — текущая/почасовая сводка для чипа и лёгкое поле ветра по
 *     видимой области карты.
 *
 *   pyn:map-weather(lat, lng) → { ok, frame, weather }
 *   pyn:map-weather-field(bounds) → { ok, points }
 */
export function setupMapWeatherBridge(): void {
  ipcMain.handle('pyn:map-weather', async (_evt, lat: unknown, lng: unknown) => {
    const la = Number(lat);
    const ln = Number(lng);
    const out: {
      ok: boolean;
      frame: number;
      weather: null | {
        tempC: number | null;
        windMs: number | null;
        precipMm: number | null;
        code: number | null;
        pressureHpa: number | null;
        isPrecip: boolean;
        hourly: HourlyWeather[];
      };
    } = { ok: false, frame: 0, weather: null };

    // 1) Радар осадков RainViewer.
    try {
      const resp = await tileSessionFetch('https://api.rainviewer.com/public/weather-maps.json');
      if (resp.ok) {
        const data = (await resp.json()) as {
          host?: string;
          radar?: { past?: Array<{ time?: number; path?: string }>; nowcast?: Array<{ time?: number; path?: string }> };
        };
        const host = typeof data.host === 'string' ? data.host : '';
        const frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
        const last = frames[frames.length - 1];
        if (host && last && typeof last.path === 'string') {
          setRainFrame(host, last.path);
          out.frame = Number(last.time) || Date.now();
          out.ok = true;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:map-weather] rainviewer fail', err);
    }

    // 2) Текущая сводка Open-Meteo (если координаты валидны).
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(4)}&longitude=${ln.toFixed(4)}`
          + '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,pressure_msl'
          + '&hourly=temperature_2m,precipitation,precipitation_probability,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
          + '&forecast_days=2&timezone=auto&wind_speed_unit=ms';
        const resp = await tileSessionFetch(url);
        if (resp.ok) {
          const data = (await resp.json()) as {
            current?: Record<string, number | string>;
            hourly?: Record<string, Array<number | string>>;
          };
          const c = data.current ?? {};
          const precip = typeof c.precipitation === 'number' ? c.precipitation : null;
          const hourly = normalizeHourly(data.hourly, typeof c.time === 'string' ? c.time : null);
          out.weather = {
            tempC: typeof c.temperature_2m === 'number' ? c.temperature_2m : null,
            windMs: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : null,
            precipMm: precip,
            code: typeof c.weather_code === 'number' ? c.weather_code : null,
            pressureHpa: typeof c.pressure_msl === 'number' ? c.pressure_msl : null,
            isPrecip: (precip ?? 0) > 0,
            hourly,
          };
          out.ok = true;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:map-weather] open-meteo fail', err);
      }
    }

    return out;
  });

  // Лёгкое поле ветра/давления по видимой области карты. Это не тайловый слой:
  // берём сетку точек Open-Meteo и в renderer рисуем стрелки, чтобы не закрывать
  // спутник плотной погодной подложкой.
  ipcMain.handle('pyn:map-weather-field', async (_evt, bounds: unknown) => {
    const samples = buildFieldSamples(bounds);
    if (samples.length === 0) return { ok: false, points: [] };

    try {
      const lat = samples.map((p) => p.lat.toFixed(4)).join(',');
      const lng = samples.map((p) => p.lng.toFixed(4)).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
        + '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code,pressure_msl'
        + '&forecast_days=1&timezone=auto&wind_speed_unit=ms';
      const resp = await tileSessionFetch(url);
      if (!resp.ok) return { ok: false, points: [] };
      const data = await resp.json();
      const list = Array.isArray(data) ? data : [data];
      const points = list.map((entry: unknown, index: number): WeatherFieldPoint | null => {
        const current = isRecord(entry) && isRecord(entry.current) ? entry.current : null;
        const sample = samples[index];
        if (!sample || !current) return null;
        return {
          lat: sample.lat,
          lng: sample.lng,
          windMs: readNumber(current.wind_speed_10m),
          windDir: readNumber(current.wind_direction_10m),
          gustMs: readNumber(current.wind_gusts_10m),
          precipMm: readNumber(current.precipitation),
          code: readNumber(current.weather_code),
          pressureHpa: readNumber(current.pressure_msl),
        };
      }).filter((p): p is WeatherFieldPoint => p !== null);
      return { ok: points.length > 0, points };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:map-weather-field] fail', err);
      return { ok: false, points: [] };
    }
  });

  // Высота точки над уровнем моря (Open-Meteo Elevation, keyless) — через мост.
  ipcMain.handle('pyn:map-elevation', async (_evt, lat: unknown, lng: unknown) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return { ok: false, elevation: null };
    try {
      const resp = await tileSessionFetch(
        `https://api.open-meteo.com/v1/elevation?latitude=${la.toFixed(4)}&longitude=${ln.toFixed(4)}`,
      );
      if (resp.ok) {
        const data = (await resp.json()) as { elevation?: number[] };
        const e = Array.isArray(data.elevation) ? data.elevation[0] : null;
        if (typeof e === 'number' && Number.isFinite(e)) return { ok: true, elevation: e };
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:map-elevation] fail', err);
    }
    return { ok: false, elevation: null };
  });
}

function buildFieldSamples(bounds: unknown): Array<{ lat: number; lng: number }> {
  if (!isRecord(bounds)) return [];
  const south = clamp(readNumber(bounds.south), -89, 89);
  const west = clamp(readNumber(bounds.west), -180, 180);
  const north = clamp(readNumber(bounds.north), -89, 89);
  const east = clamp(readNumber(bounds.east), -180, 180);
  if (south == null || west == null || north == null || east == null) return [];

  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);
  const minLng = Math.min(west, east);
  const maxLng = Math.max(west, east);
  if (maxLat - minLat <= 0 || maxLng - minLng <= 0) return [];

  const rows = 3;
  const cols = 5;
  const out: Array<{ lat: number; lng: number }> = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({
        lat: minLat + ((r + 0.5) / rows) * (maxLat - minLat),
        lng: minLng + ((c + 0.5) / cols) * (maxLng - minLng),
      });
    }
  }
  return out;
}

function normalizeHourly(hourly: Record<string, Array<number | string>> | undefined, currentTime: string | null): HourlyWeather[] {
  const times = Array.isArray(hourly?.time) ? hourly.time.map(String) : [];
  if (times.length === 0) return [];

  const currentHour = currentTime ? currentTime.slice(0, 13) : '';
  let start = currentHour ? times.findIndex((t) => t.slice(0, 13) >= currentHour) : -1;
  if (start < 0) start = 0;

  const num = (key: string, index: number): number | null => {
    const value = hourly?.[key]?.[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  return times.slice(start, start + 24).map((time, offset) => {
    const index = start + offset;
    const rain = num('rain', index);
    const showers = num('showers', index);
    return {
      time,
      tempC: num('temperature_2m', index),
      precipMm: num('precipitation', index),
      rainMm: rain != null || showers != null ? (rain ?? 0) + (showers ?? 0) : null,
      snowCm: num('snowfall', index),
      precipProb: num('precipitation_probability', index),
      code: num('weather_code', index),
      windMs: num('wind_speed_10m', index),
      windDir: num('wind_direction_10m', index),
      gustMs: num('wind_gusts_10m', index),
    };
  });
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number | null, min: number, max: number): number | null {
  if (value == null) return null;
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
