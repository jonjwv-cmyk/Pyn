import { gcm } from '@noble/ciphers/aes.js';

/**
 * AES-256-GCM primitives.
 *
 *   • Key = 32 байта (AES-256)
 *   • Nonce = 12 байт (96-bit, рекомендация NIST для GCM)
 *   • Tag = 16 байт (128-bit, конкатенируется к ciphertext'у)
 *
 * Возвращаемый encrypt() результат — `[ciphertext || tag]` без разделителей,
 * как ожидает Kotlin E2ECrypto.kt. decrypt() принимает тот же формат.
 */

export const AES_KEY_LEN = 32;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;

export function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).encrypt(plaintext);
}

export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextAndTag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ciphertextAndTag);
}

/** Генерация случайного nonce через CSPRNG (browser/Node/RN globalThis.crypto). */
export function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_LEN);
  globalThis.crypto.getRandomValues(nonce);
  return nonce;
}
