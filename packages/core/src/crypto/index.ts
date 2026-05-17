/**
 * @pyn/core/crypto — все примитивы для E2E-шифровки.
 *
 *   • X25519 ECDH + ephemeral keypair
 *   • HKDF-SHA256 (split session into req/resp keys)
 *   • PBKDF2-SHA256 с hard cap 100k (master key из пароля)
 *   • AES-256-GCM (encrypt/decrypt с AAD)
 *   • HMAC-SHA256 (request signature)
 *   • E2E envelope: `[ver][ephPub][nonce][ct+tag]`
 *
 * Все примитивы из `@noble/*` — pure JS, audit-friendly, без WASM/native.
 *
 * Использование в ApiClient (stage 4):
 *   1. JSON.stringify(body) → plaintext
 *   2. computeRequestSig(token, ts, action, plaintext) → X-Request-Sig
 *   3. encryptRequest(plaintext) → { envelope, session }
 *   4. POST envelope с headers (ts, sig, X-OTL-Crypto: v1)
 *   5. response bytes → decryptResponse(bytes, session) → plaintext JSON
 *   6. JSON.parse → envelope { ok, error, data }
 */

export type { X25519KeyPair } from './x25519';
export { generateKeyPair, computeSharedSecret } from './x25519';

export { bytesToBase64, base64ToBytes } from './base64';

export {
  BLOB_VERSION,
  decryptBlob,
  type DecryptBlobParams,
} from './blob';

export {
  PBKDF2_HARD_CAP,
  PBKDF2_ITERATIONS,
  APP_SALT,
  deriveHkdf,
  derivePbkdf2,
  deriveAppKey,
  deriveDeviceOnlyKey,
} from './kdf';

export {
  AES_KEY_LEN,
  NONCE_LEN,
  TAG_LEN,
  aesGcmEncrypt,
  aesGcmDecrypt,
  randomNonce,
} from './aes-gcm';

export { bytesToHex, hmacSha256Hex, sha256Hex, computeRequestSig } from './hmac';

export {
  ENVELOPE_VERSION,
  HKDF_INFO_E2E,
  HKDF_INFO_WS,
  SERVER_PUBLIC_KEY_B64,
  serverPublicKey,
  encryptRequest,
  decryptResponse,
  type E2eSession,
  type EncryptResult,
} from './envelope';

export {
  WS_VERSION,
  WS_FRAME_HEADER_LEN,
  WS_DIRECTION_C2S,
  WS_DIRECTION_S2C,
  newWsSession,
  parseWsFrame,
  decryptWsFrame,
  encryptWsFrame,
  type WsSession,
  type ParsedWsFrame,
} from './ws-envelope';
