import { aesGcmDecrypt, aesGcmEncrypt, NONCE_LEN, randomNonce, TAG_LEN } from './aes-gcm';
import { base64ToBytes } from './base64';
import { deriveHkdf } from './kdf';
import { computeSharedSecret, generateKeyPair } from './x25519';

/**
 * E2E envelope: per-request X25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 * 1:1 порт из `E2EInterceptor.kt` / `E2ECrypto.kt` OTLHelper2.
 *
 * Структура (concat'нуто без length prefixes):
 *
 *   [0]        version (0x01)
 *   [1..33)    ephemeral X25519 pub (32 bytes)
 *   [33..45)   nonce (12 bytes, random per-request)
 *   [45..end)  AES-256-GCM ciphertext || 16-byte tag
 *
 * AAD при шифровке = `version_byte(0x01) || ephPub(32)` (33 bytes).
 *
 * HKDF: salt empty (→ 32-byte zeros в RFC 5869 extract), info "otl-e2e-v1",
 * output 64 bytes → split на requestKey[0:32] || responseKey[32:64].
 */

export const ENVELOPE_VERSION = 0x01;
export const HKDF_INFO_E2E = 'otl-e2e-v1';
export const HKDF_INFO_WS = 'otl-ws-v1';

/**
 * Серверный X25519 public key из OTLHelper2. 32 raw bytes, base64-encoded.
 * 🔴 CRITICAL: при ротации ключа на сервере — обновить эту константу
 * синхронно с server-side rotation (иначе все клиенты порвутся).
 */
export const SERVER_PUBLIC_KEY_B64 = 'xFMr7ZEeCpyPWsBNALdzx16EGZR8GIGa0ttmjwVUL1w=';

/** Request envelope: [version][ephPub32][nonce12][ct+tag]. */
const REQUEST_VERSION_OFFSET = 0;
const REQUEST_EPH_PUB_OFFSET = 1;
const EPH_PUB_LEN = 32;
const REQUEST_NONCE_OFFSET = 33;
const REQUEST_CIPHERTEXT_OFFSET = 45;

/**
 * Response envelope: [version][nonce12][ct+tag] — БЕЗ ephPub.
 * Сервер не возвращает ephPub: клиент уже его сгенерировал и держит в session.
 * AAD при decrypt всё равно `[0x01] || requestEphPub` (тот, что мы отправили).
 */
const RESPONSE_VERSION_OFFSET = 0;
const RESPONSE_NONCE_OFFSET = 1;
const RESPONSE_CIPHERTEXT_OFFSET = 13;
const MIN_RESPONSE_ENVELOPE_LEN = RESPONSE_CIPHERTEXT_OFFSET + TAG_LEN;

/**
 * Серверный pubkey decoded в bytes. Lazy декодируется один раз.
 */
let cachedServerPubKey: Uint8Array | null = null;

export function serverPublicKey(): Uint8Array {
  if (cachedServerPubKey) return cachedServerPubKey;
  cachedServerPubKey = base64ToBytes(SERVER_PUBLIC_KEY_B64);
  if (cachedServerPubKey.length !== EPH_PUB_LEN) {
    throw new Error(`Server pubkey wrong length: ${cachedServerPubKey.length}`);
  }
  return cachedServerPubKey;
}

/**
 * Session-state одной E2E-беседы: хранит responseKey для расшифровки ответа
 * сервера на тот же запрос.
 */
export interface E2eSession {
  responseKey: Uint8Array;
  /** Ephemeral pubkey, отправленный в envelope. Используется для AAD при decrypt. */
  ephPub: Uint8Array;
}

export interface EncryptResult {
  envelope: Uint8Array;
  session: E2eSession;
}

/**
 * Шифрует plaintext payload для POST на /api. Возвращает binary envelope +
 * session для последующей расшифровки ответа.
 */
export function encryptRequest(
  plaintext: Uint8Array,
  serverPubKey: Uint8Array = serverPublicKey(),
): EncryptResult {
  const ephemeral = generateKeyPair();
  const sharedSecret = computeSharedSecret(ephemeral.privateKey, serverPubKey);

  const derived = deriveHkdf(sharedSecret, HKDF_INFO_E2E, 64);
  const requestKey = derived.slice(0, 32);
  const responseKey = derived.slice(32, 64);

  const nonce = randomNonce();
  const aad = buildAad(ephemeral.publicKey);

  const ciphertextAndTag = aesGcmEncrypt(requestKey, nonce, plaintext, aad);

  // Request envelope: [version][ephPub32][nonce12][ct+tag].
  const envelope = new Uint8Array(REQUEST_CIPHERTEXT_OFFSET + ciphertextAndTag.length);
  envelope[REQUEST_VERSION_OFFSET] = ENVELOPE_VERSION;
  envelope.set(ephemeral.publicKey, REQUEST_EPH_PUB_OFFSET);
  envelope.set(nonce, REQUEST_NONCE_OFFSET);
  envelope.set(ciphertextAndTag, REQUEST_CIPHERTEXT_OFFSET);

  return {
    envelope,
    session: { responseKey, ephPub: ephemeral.publicKey },
  };
}

/**
 * Расшифровывает ответ сервера. Layout response'а ОТЛИЧАЕТСЯ от request'а:
 *   • Request:  [version][ephPub32][nonce12][ct+tag]  — 45+N bytes
 *   • Response: [version][nonce12][ct+tag]            — 13+N bytes (БЕЗ ephPub)
 *
 * Сервер не возвращает ephPub потому что клиент уже знает свой (мы его
 * сами сгенерировали и сохранили в session.ephPub). AAD при decrypt
 * собирается из `[0x01] || session.ephPub` — точно как при encrypt'е request'а.
 *
 * Ключ для decrypt'a — `session.responseKey` (вторая половина HKDF output'a).
 */
export function decryptResponse(envelope: Uint8Array, session: E2eSession): Uint8Array {
  if (envelope.length < MIN_RESPONSE_ENVELOPE_LEN) {
    throw new Error(
      `Response envelope too short: ${envelope.length} < ${MIN_RESPONSE_ENVELOPE_LEN}`,
    );
  }
  const version = envelope[RESPONSE_VERSION_OFFSET];
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: 0x${version?.toString(16) ?? '?'}`);
  }

  const nonce = envelope.slice(RESPONSE_NONCE_OFFSET, RESPONSE_NONCE_OFFSET + NONCE_LEN);
  const ciphertextAndTag = envelope.slice(RESPONSE_CIPHERTEXT_OFFSET);

  // AAD identical to request encryption: [version] || requestEphPub.
  const aad = buildAad(session.ephPub);
  return aesGcmDecrypt(session.responseKey, nonce, ciphertextAndTag, aad);
}

function buildAad(ephPub: Uint8Array): Uint8Array {
  const aad = new Uint8Array(1 + EPH_PUB_LEN);
  aad[0] = ENVELOPE_VERSION;
  aad.set(ephPub, 1);
  return aad;
}

