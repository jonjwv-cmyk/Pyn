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
 *   • есть корп-прокси → проксируем на локальный CONNECT-мост (тот же
 *     шифр-туннель к VPS-релею, что и Таблицы) → Google;
 *   • нет корп-прокси → напрямую.
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

function getTileSession(): Session {
  if (!tileSession) tileSession = session.fromPartition(`persist:${TILE_PARTITION}`);
  return tileSession;
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
  void ses.setProxy(ep ? { proxyRules: `${ep.host}:${ep.port}` } : { proxyRules: 'direct://' });
  // eslint-disable-next-line no-console
  console.log(`[pyn:tiles] proxy → ${ep ? `${ep.host}:${ep.port} (через мост)` : 'direct'}`);
}

type Provider = 'google' | 'esri';

function cachePath(provider: Provider, z: string, x: string, y: string): string {
  return join(app.getPath('userData'), 'map-tiles', provider, z, x, `${y}.jpg`);
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

function upstreamUrl(provider: Provider, z: string, x: string, y: string): string {
  if (provider === 'esri') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  const srv = (Number(x) + Number(y)) % 4;
  return `https://mt${srv}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
}

/** Обработчик схемы — отдаёт тайл (из кэша или с Google через тайл-сессию). */
export function setupMapTiles(): void {
  refreshMapTileProxy();

  protocol.handle(SCHEME, async (request) => {
    const m = /pyn-tile:\/\/(google|esri|sat)\/(\d+)\/(\d+)\/(\d+)/.exec(request.url);
    if (!m) return new Response('bad tile request', { status: 400 });
    const [, providerRaw, z, x, y] = m as unknown as [string, Provider | 'sat', string, string, string];
    const provider: Provider = providerRaw === 'sat' ? 'google' : providerRaw;

    const key = cacheKey(provider, z, x, y);
    const hot = memoryTiles.get(key);
    if (hot) {
      memoryTiles.delete(key);
      memoryTiles.set(key, hot);
      return tileResponse(hot.body, hot.contentType);
    }

    const file = cachePath(provider, z, x, y);
    if (existsSync(file)) {
      try {
        const body = readFileSync(file);
        rememberTile(key, body, 'image/jpeg');
        return tileResponse(body, 'image/jpeg');
      } catch { /* перечитаем с сети */ }
    }

    const tileUrl = upstreamUrl(provider, z, x, y);
    try {
      const resp = await getTileSession().fetch(tileUrl, {
        headers: { 'User-Agent': CHROME_UA },
      });
      if (!resp.ok) {
        if (provider === 'google') {
          return new Response(TRANSPARENT_TILE, { headers: { 'content-type': 'image/png' } });
        }
        return new Response('upstream tile error', { status: resp.status });
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      try {
        mkdirSync(join(app.getPath('userData'), 'map-tiles', provider, z, x), { recursive: true });
        writeFileSync(file, buf);
      } catch { /* кэш не критичен */ }
      rememberTile(key, buf, contentType);
      return tileResponse(buf, contentType);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:tiles] fetch fail', tileUrl, err);
      if (provider === 'google') {
        return new Response(TRANSPARENT_TILE, { headers: { 'content-type': 'image/png' } });
      }
      return new Response('tile fetch failed', { status: 502 });
    }
  });

  // eslint-disable-next-line no-console
  console.log('[pyn:tiles] scheme handler ready');
}
