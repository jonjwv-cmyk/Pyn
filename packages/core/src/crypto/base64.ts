/**
 * Base64 encode/decode utils. Доступны и в browser (renderer), и в Node
 * (Electron main, RN) через `atob`/`btoa` — глобальные в Node 16+.
 *
 * Используются и в crypto/envelope, и в ws-envelope, и в blob-decrypt —
 * вынесены отдельно, чтобы не дублировать.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binStr += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binStr);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}
