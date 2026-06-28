import { app, protocol, session, type Session } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBridgeProxyEndpoint } from './bridge/state';

/**
 * map-tiles — спутниковые тайлы Google для раздела «Карта», без webview.
 *
 * Renderer (MapLibre) грузит тайлы по схеме:
 *   • `pyn-tile://google/{z}/{x}/{y}` — Google satellite;
 *   • `pyn-tile://esri/{z}/{x}/{y}`   — резервный Esri World Imagery.
 *
 * Main перехватывает их и тянет реальный спутниковый тайл через ВЫДЕЛЕННУЮ
 * тайл-сессию:
 *   • есть корп-прокси → корп-прокси → локальный CONNECT-мост → VPS-реле → Google;
 *   • нет корп-прокси → локальный CONNECT-мост → VPS-реле → Google.
 *
 * Тайлы кэшируются на диск (`userData/map-tiles/...`) — карта работает офлайн
 * после первого просмотра и не дёргает релей повторно (бережём канал/лимиты).
 *
 * Схема должна быть зарегистрирована привилегированной ДО `app.whenReady()`
 * (`registerMapTileScheme`); обработчик ставится после ready (`setupMapTiles`).
 */

const SCHEME = 'pyn-tile';
const TILE_PARTITION = 'pyn-map-tiles';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TRANSPARENT_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const MEMORY_TILE_LIMIT = 1200;

let tileSession: Session | null = null;
const memoryTiles = new Map<string, { body: Buffer; contentType: string }>();
/** Текущий кадр радара осадков RainViewer (обновляется из weather-bridge). */
const rainFrame = { host: '', path: '' };

function getTileSession(): Session {
  if (!tileSession) tileSession = session.fromPartition(`persist:${TILE_PARTITION}`);
  return tileSession;
}

/** Установить актуальный кадр радара осадков (host+path из RainViewer JSON). */
export function setRainFrame(host: string, path: string): void {
  rainFrame.host = host;
  rainFrame.path = path;
}

/**
 * Сетевой запрос для тайлов/погоды — ВСЕГДА через тайл-сессию (тот же VPS-туннель,
 * что и спутник). Напрямую наружу не ходим: трафик идёт шифрованно через VPS
 * (в офисе — корп-прокси → VPS). Для weather-bridge: RainViewer JSON + Open-Meteo.
 */
export async function tileSessionFetch(url: string): Promise<Response> {
  if (!getBridgeProxyEndpoint()) {
    throw new Error('map_bridge_not_ready');
  }
  return getTileSession().fetch(url, { headers: { 'User-Agent': CHROME_UA } });
}

/**
 * Универсальный запрос через тот же VPS-туннель (мост), что и тайлы/погода —
 * но с произвольным методом/телом/заголовками (для POST-API вроде ГЛОНАСС).
 * Наружу напрямую не ходим: всё идёт через VPS (политика «Транспорт — через VPS»).
 */
export async function bridgeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!getBridgeProxyEndpoint()) {
    throw new Error('map_bridge_not_ready');
  }
  const headers = new Headers(init?.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', CHROME_UA);
  return getTileSession().fetch(url, { ...init, headers });
}

/** Регистрация схемы (привилегированная: secure + поддержка fetch/CORS). До ready. */
export function registerMapTileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/** Перенастроить прокси тайл-сессии под текущее состояние моста. Вызывается из
 *  `configureBridge` (мост поднялся) и на старте (`setupMapTiles`). */
export function refreshMapTileProxy(): void {
  const ep = getBridgeProxyEndpoint();
  const ses = getTileSession();
  // До получения bridge-конфига блокируем прямой выход наружу. Слои карты в это
  // время отдадут прозрачный тайл/503, но не пойдут напрямую к Google/RainViewer.
  void ses.setProxy(ep ? { proxyRules: `${ep.host}:${ep.port}` } : { proxyRules: '127.0.0.1:9' });
  // eslint-disable-next-line no-console
  console.log(`[pyn:tiles] proxy → ${ep ? `${ep.host}:${ep.port} (через мост)` : 'blocked until bridge'}`);
}

type Provider = 'google' | 'esri' | 'terrarium' | 'rain';

/** Радар осадков и DEM — PNG; спутник — JPG. Радар на диск не кэшируем (живой). */
function tileExt(provider: Provider): string {
  return provider === 'google' || provider === 'esri' ? 'jpg' : 'png';
}
function diskCacheable(provider: Provider): boolean {
  return provider !== 'rain';
}

function cachePath(provider: Provider, z: string, x: string, y: string): string {
  return join(app.getPath('userData'), 'map-tiles', provider, z, x, `${y}.${tileExt(provider)}`);
}

function cacheKey(provider: Provider, z: string, x: string, y: string): string {
  return `${provider}/${z}/${x}/${y}`;
}

function rememberTile(key: string, body: Buffer, contentType: string): void {
  if (memoryTiles.has(key)) memoryTiles.delete(key);
  memoryTiles.set(key, { body, contentType });
  while (memoryTiles.size > MEMORY_TILE_LIMIT) {
    const oldest = memoryTiles.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryTiles.delete(oldest);
  }
}

function tileResponse(body: Buffer, contentType: string): Response {
  return new Response(bufferBody(body), {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=2592000, immutable',
    },
  });
}

function bufferBody(body: Buffer): BodyInit {
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

function upstreamUrl(provider: Provider, z: string, x: string, y: string, rainColor: string): string | null {
  if (provider === 'esri') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  if (provider === 'terrarium') {
    // Бесплатный keyless DEM (AWS/Nextzen Open Data) для рельефа (hillshade).
    return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  }
  if (provider === 'rain') {
    // Радар осадков RainViewer (keyless). Нет кадра → прозрачный. Цветовую схему
    // (`c`) задаёт renderer: дождь/снег/интенсивность чёткими цветами, не серой
    // пеленой. Опции `1_1` = сглаживание + раскраска снега отдельно. Где осадков
    // нет — тайл прозрачный (не «накрываем» карту).
    if (!rainFrame.host || !rainFrame.path) return null;
    const scheme = /^\d$/.test(rainColor) ? rainColor : '6';
    return `${rainFrame.host}${rainFrame.path}/256/${z}/${x}/${y}/${scheme}/1_1.png`;
  }
  const srv = (Number(x) + Number(y)) % 4;
  return `https://mt${srv}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
}

/** Обработчик схемы — отдаёт тайл (из кэша или с Google через тайл-сессию). */
export function setupMapTiles(): void {
  refreshMapTileProxy();

  protocol.handle(SCHEME, async (request) => {
    const m = /pyn-tile:\/\/(google|esri|sat|terrarium|rain)\/(\d+)\/(\d+)\/(\d+)/.exec(request.url);
    if (!m) return new Response('bad tile request', { status: 400 });
    const [, providerRaw, z, x, y] = m as unknown as [string, Provider | 'sat', string, string, string];
    const provider: Provider = providerRaw === 'sat' ? 'google' : providerRaw;
    // Прозрачным отвечаем для слоёв-наложений (рельеф/радар/спутник) при любой беде.
    const overlay = provider === 'terrarium' || provider === 'rain' || provider === 'google';
    const transparent = () => new Response(TRANSPARENT_TILE, { headers: { 'content-type': 'image/png' } });

    const key = cacheKey(provider, z, x, y);
    // Радар осадков НЕ кэшируем в памяти: ключ z/x/y не учитывает кадр → иначе
    // застрянет на первом снимке.
    if (diskCacheable(provider)) {
      const hot = memoryTiles.get(key);
      if (hot) {
        memoryTiles.delete(key);
        memoryTiles.set(key, hot);
        return tileResponse(hot.body, hot.contentType);
      }
    }

    if (diskCacheable(provider)) {
      const file = cachePath(provider, z, x, y);
      if (existsSync(file)) {
        try {
          const body = readFileSync(file);
          const ct = tileExt(provider) === 'png' ? 'image/png' : 'image/jpeg';
          rememberTile(key, body, ct);
          return tileResponse(body, ct);
        } catch { /* перечитаем с сети */ }
      }
    }

    // Цветовая схема радара осадков задаётся renderer'ом (?c=…) — без рестарта.
    let rainColor = '2';
    try { rainColor = new URL(request.url).searchParams.get('c') || '2'; } catch { /* keep default */ }
    const tileUrl = upstreamUrl(provider, z, x, y, rainColor);
    if (!tileUrl) return transparent(); // напр. радар без активного кадра
    if (!getBridgeProxyEndpoint()) {
      return overlay ? transparent() : new Response('map bridge not ready', { status: 503 });
    }
    try {
      // ВСЕГДА через мост (VPS-туннель). Напрямую наружу не ходим.
      const resp = await getTileSession().fetch(tileUrl, { headers: { 'User-Agent': CHROME_UA } });
      if (!resp.ok) {
        return overlay ? transparent() : new Response('upstream tile error', { status: resp.status });
      }
      const contentType = resp.headers.get('content-type') || (tileExt(provider) === 'png' ? 'image/png' : 'image/jpeg');
      // Радар иногда отвечает текстом («zoom level not supported») со статусом 200
      // — это не картинка, гасим прозрачным, чтобы не ломать слой.
      if (!contentType.startsWith('image') && overlay) return transparent();
      const buf = Buffer.from(await resp.arrayBuffer());
      if (diskCacheable(provider)) {
        try {
          mkdirSync(join(app.getPath('userData'), 'map-tiles', provider, z, x), { recursive: true });
          writeFileSync(cachePath(provider, z, x, y), buf);
        } catch { /* кэш не критичен */ }
        rememberTile(key, buf, contentType);
      }
      return tileResponse(buf, contentType);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:tiles] fetch fail', tileUrl, err);
      return overlay ? transparent() : new Response('tile fetch failed', { status: 502 });
    }
  });

  // eslint-disable-next-line no-console
  console.log('[pyn:tiles] scheme handler ready');
}
