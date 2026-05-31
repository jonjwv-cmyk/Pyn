import { ipcMain, session as electronSession } from 'electron';
import { resolveMediaUrl } from '../network/media-url';
import { getProxyState } from './api-bridge';

/**
 * Fetch зашифрованных blob'ов (аватары, attachments) через main process.
 *
 * Зачем main process, а не renderer fetch:
 *   • Renderer'ский fetch падает с CORS error (server `45-12-239-5.sslip.io`
 *     не отдаёт `Access-Control-Allow-Origin: *` для `/a/<id>` и `/media/<id>`).
 *   • Через `electronSession.fetch` идём с net-stack'а main process'а — там
 *     же конфигурируется proxy / TLS / pinning, и CORS-policy не применяется.
 *
 * В proxy-mode переписываем URL `api.otlhelper.com` → `45-12-239-5.sslip.io`
 * чтобы корп-прокси не упёрся в наш custom-DNS-routing. 1:1 c Kotlin
 * `MediaUrlResolver`.
 *
 * Возвращает bytes; renderer decrypt'ит сам (`@pyn/core/decryptBlob`) с key+nonce
 * из admin-response.
 */
export function setupBlobBridge(): void {
  ipcMain.handle('pyn:blob:fetch', async (_evt, url: string): Promise<Uint8Array> => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('invalid_blob_url');
    }
    const finalUrl = resolveMediaUrl(url, getProxyState());
    // §pyn-1.2.61 — `cache:'no-store'` + retry. На холодном старте (особенно
    // Win) Chromium HTTP-кэш может быть не готов/залочен (после нечистого
    // выхода/self-update) → `net::ERR_CACHE_READ_FAILURE`, из-за чего аватарки
    // и картинки чата не грузились до полного рестарта. Блобы content-addressed
    // и кэшируются в renderer'е per-session — HTTP-кэш тут не нужен. Retry
    // добивает любые транзиентные сбои первых запросов через корп-прокси.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await electronSession.defaultSession.fetch(finalUrl, { cache: 'no-store' });
        if (!resp.ok) {
          // HTTP-статус (4xx/5xx) — не транзиент, не ретраим.
          throw new Error(`blob_fetch_${resp.status}`);
        }
        const buffer = await resp.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && err.message.startsWith('blob_fetch_')) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('blob_fetch_failed');
  });
}
