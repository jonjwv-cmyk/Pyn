import { ipcMain } from 'electron';
import { gunzipSync } from 'node:zlib';
import { decryptBlob } from '@pyn/core';
import { resolveMediaUrl } from '../network/media-url';
import { getProxyState } from './api-bridge';
import { fetchMediaBytes } from '../network/media-fetch';

/**
 * Скачивание слепка базы ПЕРСОН (вкладка «Контакты») — один-в-один с
 * warehouses-bridge / mol-bridge: fetch R2 → AES-256-GCM decrypt → gunzip →
 * plain JSON string. Renderer парсит через @pyn/core::parsePersonsSnapshotJson
 * и кладёт в encrypted cache (pyn:cache).
 */
export function setupPersonsBridge(): void {
  ipcMain.handle(
    'pyn:persons:fetch-snapshot',
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
      const encrypted = await fetchMediaBytes(finalUrl, 'snapshot');

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
