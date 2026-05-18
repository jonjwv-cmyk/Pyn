import { ipcMain, session as electronSession } from 'electron';
import { gunzipSync } from 'node:zlib';
import { decryptBlob } from '@pyn/core';
import { resolveMediaUrl } from '../network/media-url';
import { getProxyState } from './api-bridge';

/**
 * Скачивание snapshot'a справочника МОЛ.
 *
 * Зачем main, а не renderer:
 *   • Snapshot ≈ 100KB–1MB encrypted gzipped bytes. Gunzip в renderer'е
 *     требует таскать lib типа `pako` (~30KB). Node имеет zlib native.
 *   • `electronSession.fetch` обходит CORS и использует наш host-resolver
 *     override (cdn.otlhelper.com → VPS 45.12.239.5).
 *   • Renderer получает plain JSON text — единичный больший payload, парсит
 *     через @pyn/core::parseSnapshotJson и кладёт в encrypted cache через
 *     существующий pyn:cache:* API.
 *
 * Wire of encrypted snapshot (1:1 c handlers-base.js::buildBaseSnapshot):
 *
 *   [0]      version (0x01)
 *   [1..13)  AES-256-GCM nonce (12 bytes)
 *   [13..)   ciphertext || 16-byte tag
 *
 * AAD пустой — тот же формат что у avatars/attachments → используем готовый
 * `decryptBlob` из @pyn/core/crypto.
 */
export function setupMolBridge(): void {
  ipcMain.handle(
    'pyn:mol:fetch-snapshot',
    async (
      _evt,
      url: string,
      blobKeyB64: string,
      blobNonceB64: string,
    ): Promise<string> => {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error('invalid_snapshot_url');
      }
      if (!blobKeyB64) {
        // Legacy unencrypted snapshot (pre-2.3.27 на сервере). Server в
        // нашем prod уже всегда возвращает key/nonce — но защита на будущее.
        throw new Error('snapshot_missing_blob_key');
      }

      const finalUrl = resolveMediaUrl(url, getProxyState());
      const resp = await electronSession.defaultSession.fetch(finalUrl);
      if (!resp.ok) {
        throw new Error(`snapshot_fetch_${resp.status}`);
      }
      const encrypted = new Uint8Array(await resp.arrayBuffer());

      // AES-256-GCM decrypt envelope → gzipped JSON bytes.
      const gzipped = decryptBlob({
        encrypted,
        keyB64: blobKeyB64,
        nonceB64: blobNonceB64,
      });

      // Gunzip → plain JSON string. Node zlib работает с Buffer, обернём.
      const plain = gunzipSync(Buffer.from(gzipped));
      return plain.toString('utf-8');
    },
  );
}
