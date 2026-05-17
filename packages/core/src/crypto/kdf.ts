import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * KDF primitives — HKDF-SHA256 для derive session keys, PBKDF2-SHA256 для
 * derive master key из пароля.
 *
 * 🔴 CRITICAL: PBKDF2 iterations ≤ 100_000. Превышение триггерит Kaspersky AV
 * hooks (Add-Type/EncodedCommand pattern → CF Worker timeout раньше, чем
 * cap'нем — но всё равно cap'аем строго). См. MAP.md «запретный список».
 */

export const PBKDF2_HARD_CAP = 100_000;

/** Дефолтное число итераций PBKDF2 — ровно у cap'а. */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * Фиксированный salt для derive master key — `"OTLD-AppSalt-v1!"` (16 байт ASCII).
 * Совпадает с byte sequence в Kotlin E2ECrypto.kt.
 */
export const APP_SALT: Uint8Array = new TextEncoder().encode('OTLD-AppSalt-v1!');

/**
 * HKDF-SHA256: extract+expand. Salt по умолчанию empty (RFC 5869 — заменится
 * на 32-byte zeros). Info — ASCII строка (`otl-e2e-v1` для REST,
 * `otl-ws-v1` для WS).
 */
export function deriveHkdf(
  ikm: Uint8Array,
  info: string,
  length: number,
  salt: Uint8Array = new Uint8Array(0),
): Uint8Array {
  return hkdf(sha256, ikm, salt, new TextEncoder().encode(info), length);
}

/**
 * PBKDF2-HMAC-SHA256. Cap'ается на 100k итераций — превышение throws.
 *
 *   password: string или bytes (UTF-8 encoded если string)
 *   salt:     bytes
 *   iters:    ≤ 100_000
 *   dkLen:    output bytes (32 для AES-256 key)
 */
export function derivePbkdf2(
  password: string | Uint8Array,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
  dkLen = 32,
): Uint8Array {
  if (iterations > PBKDF2_HARD_CAP) {
    throw new Error(
      `PBKDF2 iterations ${iterations} > hard cap ${PBKDF2_HARD_CAP} ` +
        `(Kaspersky AV / CF Worker timeout risk)`,
    );
  }
  return pbkdf2(sha256, password, salt, { c: iterations, dkLen });
}

/**
 * Master key для шифрования session.bin на диске.
 *   password = `"<login>:<device_id>"`  (точная concat-строка из Kotlin)
 *   salt     = APP_SALT
 *   iters    = 100_000
 *   output   = 32 bytes (AES-256 key)
 */
export function deriveAppKey(login: string, deviceId: string): Uint8Array {
  return derivePbkdf2(`${login}:${deviceId}`, APP_SALT);
}

/**
 * Device-only fallback — для шифрования метадаты сессии, переживающей login.
 *   password = `"device:<device_id>"`
 *   остальное как у deriveAppKey
 */
export function deriveDeviceOnlyKey(deviceId: string): Uint8Array {
  return derivePbkdf2(`device:${deviceId}`, APP_SALT);
}
