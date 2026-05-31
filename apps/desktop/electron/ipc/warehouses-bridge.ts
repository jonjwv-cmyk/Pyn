import { ipcMain, session as electronSession } from 'electron';
import { gunzipSync } from 'node:zlib';
import { decryptBlob } from '@pyn/core';
import { resolveMediaUrl } from '../network/media-url';
import { getProxyState } from './api-bridge';

/**
 * Скачивание snapshot'а справочника складов («Цеха»-база) — один-в-один с
 * mol-bridge: fetch R2 → AES-256-GCM decrypt → gunzip → plain JSON string.
 * Renderer парсит через @pyn/core::parseWarehousesSnapshotJson и кладёт в
 * encrypted cache (pyn:cache).
 *
 * Envelope (1:1 c handlers-warehouses.js::buildWarehousesSnapshot):
 *   [0] version 0x01 | [1..13) nonce(12) | [13..) ciphertext||tag
 */
export function setupWarehousesBridge(): void {
  ipcMain.handle(
    'pyn:warehouses:fetch-snapshot',
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
        throw new Error('snapshot_missing_blob_key');
      }

      const finalUrl = resolveMediaUrl(url, getProxyState());
      // §pyn-1.2.61 — cache:'no-store': снапшот кэшируется в нашем cache-store,
      // HTTP-кэш Chromium на холодном старте даёт net::ERR_CACHE_READ_FAILURE.
      const resp = await electronSession.defaultSession.fetch(finalUrl, { cache: 'no-store' });
      if (!resp.ok) {
        throw new Error(`snapshot_fetch_${resp.status}`);
      }
      const encrypted = new Uint8Array(await resp.arrayBuffer());

      const gzipped = decryptBlob({
        encrypted,
        keyB64: blobKeyB64,
        nonceB64: blobNonceB64,
      });

      const plain = gunzipSync(Buffer.from(gzipped));
      return plain.toString('utf-8');
    },
  );
}
