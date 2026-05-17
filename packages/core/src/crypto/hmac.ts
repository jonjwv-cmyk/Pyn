import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Request signature primitives — 1:1 с `AuthSigningInterceptor.kt`.
 *
 *   X-Request-Ts:  unix_seconds + clockOffset
 *   X-Request-Sig: hmac_sha256(token, "<ts>\n<action>\n<sha256Hex(body)>")
 *
 * Подпись считается по PLAINTEXT телу (до E2E-шифровки). Сервер сначала
 * расшифрует payload → потом верифицирует sig. clockOffset для self-heal
 * при 401 request_expired — обновляется AuthSigningInterceptor.clockOffset.
 */

const ENCODER = new TextEncoder();

/** Hex-кодировка байт (lowercase). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === undefined) continue;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** HMAC-SHA256, возвращает hex. Строковые входы UTF-8 encoded. */
export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
  const keyBytes = typeof key === 'string' ? ENCODER.encode(key) : key;
  const msgBytes = typeof message === 'string' ? ENCODER.encode(message) : message;
  const sig = hmac(sha256, keyBytes, msgBytes);
  return bytesToHex(sig);
}

/** SHA-256 hex для body — используется в request-signature payload. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/**
 * Считает X-Request-Sig для POST /api запроса.
 *
 * @param token  Bearer-токен сессии (без префикса "Bearer ", сам секрет).
 * @param ts     Unix seconds (+ clockOffset от AuthSigningInterceptor).
 * @param action Имя API action — должно совпадать с полем `action` в body.
 * @param body   Plaintext JSON body bytes (UTF-8 encoded), ДО E2E-шифровки.
 */
export function computeRequestSig(
  token: string,
  ts: number,
  action: string,
  body: Uint8Array,
): string {
  const message = `${ts}\n${action}\n${sha256Hex(body)}`;
  return hmacSha256Hex(ENCODER.encode(token), ENCODER.encode(message));
}
