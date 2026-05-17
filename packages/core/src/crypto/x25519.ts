import { x25519 } from '@noble/curves/ed25519.js';

/**
 * X25519 ECDH primitives — 1:1 порт `E2ECrypto.kt` из OTLHelper2.
 *
 *   • Ephemeral keypair генерируется per-request (REST) или per-session (WS).
 *   • Shared secret через ECDH → HKDF-SHA256 → split на request/response keys.
 *
 * Для REST: серверный pubkey хардкод (см. envelope.ts SERVER_PUBLIC_KEY_B64).
 * Для WS: тот же серверный pubkey, но HKDF info = "otl-ws-v1" (см. envelope.ts).
 */

export interface X25519KeyPair {
  /** 32 байта — Curve25519 scalar (используется в ECDH). */
  privateKey: Uint8Array;
  /** 32 байта — Curve25519 point (отправляется в envelope для derive на сервере). */
  publicKey: Uint8Array;
}

/** Генерирует свежий ephemeral X25519 keypair. */
export function generateKeyPair(): X25519KeyPair {
  const kp = x25519.keygen();
  return { privateKey: kp.secretKey, publicKey: kp.publicKey };
}

/** ECDH: shared secret = scalar-mult(privateKey, peerPublicKey). Возвращает 32 байта. */
export function computeSharedSecret(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey);
}
