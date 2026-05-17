import { ipcMain, session as electronSession } from 'electron';

/**
 * Fetch зашифрованных blob'ов (аватары, attachments) через main process.
 *
 * Зачем main process, а не renderer fetch:
 *   • Renderer'ский fetch падает с CORS error (server `45-12-239-5.sslip.io`
 *     не отдаёт `Access-Control-Allow-Origin: *` для `/a/<id>` и `/media/<id>`).
 *   • Через `electronSession.fetch` идём с net-stack'а main process'а — там
 *     же конфигурируется proxy / TLS / pinning, и CORS-policy не применяется.
 *
 * Возвращает bytes; renderer decrypt'ит сам (`@pyn/core/decryptBlob`) с key+nonce
 * из admin-response.
 */
export function setupBlobBridge(): void {
  ipcMain.handle('pyn:blob:fetch', async (_evt, url: string): Promise<Uint8Array> => {
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('invalid_blob_url');
    }
    const resp = await electronSession.defaultSession.fetch(url);
    if (!resp.ok) {
      throw new Error(`blob_fetch_${resp.status}`);
    }
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  });
}
