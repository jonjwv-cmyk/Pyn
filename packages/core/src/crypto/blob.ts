import { aesGcmDecrypt, TAG_LEN } from './aes-gcm';
import { base64ToBytes } from './base64';

/**
 * Зашифрованные blob'ы (аватары, attachments) — AES-256-GCM с key+nonce из
 * D1 admin response. Каждый blob эфемерно зашифрован своим ключом, нет
 * shared-key между разными blob'ами.
 *
 * Wire format (R2 storage):
 *
 *   [0]       version (0x01)
 *   [1..13)   nonce (12 bytes) — равен `blob_nonce_b64` из админ-response
 *   [13..end) AES-256-GCM ciphertext || 16-byte tag
 *
 * AAD — пустой (`new Uint8Array(0)`). Отличается от REST/WS envelope.
 *
 * Ключи приходят в `_blob_key_b64` (base64-кодированный 32-byte AES key) и
 * `_blob_nonce_b64` (base64 12-byte nonce) — server-side в D1 рядом с blob_id.
 *
 * Использование:
 *   const encrypted = await fetch(avatarUrl).then(r => r.arrayBuffer());
 *   const plain = decryptBlob(new Uint8Array(encrypted), keyB64, nonceB64);
 *   const blobUrl = URL.createObjectURL(new Blob([plain]));  // → <img src>
 */

export const BLOB_VERSION = 0x01;
export const BLOB_NONCE_OFFSET = 1;
export const BLOB_CIPHERTEXT_OFFSET = 13;
export const MIN_BLOB_LEN = BLOB_CIPHERTEXT_OFFSET + TAG_LEN;

export interface DecryptBlobParams {
  /** Зашифрованные байты целиком (response.arrayBuffer() → Uint8Array). */
  encrypted: Uint8Array;
  /** Base64-encoded AES-256 key (32 bytes). */
  keyB64: string;
  /** Base64-encoded 12-byte nonce (опционально — для sanity-check vs envelope nonce). */
  nonceB64?: string;
}

export function decryptBlob(params: DecryptBlobParams): Uint8Array {
  const { encrypted, keyB64, nonceB64 } = params;

  if (encrypted.length < MIN_BLOB_LEN) {
    throw new Error(`blob too short: ${encrypted.length}`);
  }
  if (encrypted[0] !== BLOB_VERSION) {
    throw new Error(`unsupported blob version: 0x${encrypted[0]?.toString(16) ?? '?'}`);
  }

  const key = base64ToBytes(keyB64);
  if (key.length !== 32) {
    throw new Error(`blob key wrong length: ${key.length}`);
  }

  // Nonce из envelope (bytes 1..13). Если caller передал nonceB64 — sanity-
  // check, на всякий случай (key/nonce могли разъехаться между D1 и R2).
  const nonceFromEnvelope = encrypted.slice(BLOB_NONCE_OFFSET, BLOB_CIPHERTEXT_OFFSET);
  if (nonceB64) {
    const expected = base64ToBytes(nonceB64);
    if (!bytesEqual(nonceFromEnvelope, expected)) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:blob] nonce mismatch: envelope vs D1 — using envelope');
    }
  }

  const ciphertextAndTag = encrypted.slice(BLOB_CIPHERTEXT_OFFSET);
  // AAD empty — это отличие от REST/WS envelope, где AAD привязан к
  // ephPub/version. Blob'ы используют только key+nonce.
  return aesGcmDecrypt(key, nonceFromEnvelope, ciphertextAndTag, new Uint8Array(0));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
