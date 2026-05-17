import { aesGcmDecrypt, aesGcmEncrypt, TAG_LEN } from './aes-gcm';
import { bytesToBase64 as bytesToBase64Shared } from './base64';
import { HKDF_INFO_WS, serverPublicKey } from './envelope';
import { deriveHkdf } from './kdf';
import { computeSharedSecret, generateKeyPair } from './x25519';

/**
 * WebSocket E2E envelope (1:1 порт OTLHelper2 `WsCrypto.kt` + сервер
 * `crypto-ws.js`).
 *
 * Отличие от REST envelope: keypair генерируется один раз per-connection,
 * shared secret derive'ится один раз, c2sKey + s2cKey хранятся в session
 * на всё время связи. Каждый frame получает 12-byte nonce из (direction,
 * counter). Counter инкрементируется per direction независимо.
 *
 * Frame layout (binary, и для send, и для receive):
 *
 *   [0]        version (0x01)
 *   [1..13)    nonce (12 bytes):
 *                [1..5)   direction (BE uint32):  1 = c2s, 2 = s2c
 *                [5..13)  counter   (BE uint64):  starts at 0, +1 per frame
 *   [13..end)  AES-256-GCM ciphertext || 16-byte tag
 *
 * AAD = `[VERSION]` (1 byte). Привязка к версии протокола.
 *
 * Handshake (отдельно):
 *   1. Client сразу шлёт TEXT JSON `{type:"crypto_init", v:1, epk:"<base64>"}`
 *   2. Server отвечает TEXT JSON `{type:"crypto_ok", v:1}` (plaintext, не binary)
 *   3. Client шлёт TEXT JSON `{type:"hello", login:"...", token:"..."}` —
 *      шифровано ли это? Из ws-room.js видно что hello идёт plaintext (TEXT)
 *      — это первое сообщение после crypto_ok, до того как server переключит
 *      в encrypted mode. Это документ-вер. в WsClient.
 *
 * После handshake все frames — binary с layout выше.
 */

export const WS_VERSION = 0x01;
export const WS_FRAME_HEADER_LEN = 13; // version(1) + nonce(12)
export const WS_DIRECTION_C2S = 1; // client → server
export const WS_DIRECTION_S2C = 2; // server → client

/**
 * Сессия одного WS-подключения. Keypair эфемерный — на close connection
 * выбрасывается, на reconnect генерируется новый.
 */
export interface WsSession {
  /** Эфемерный X25519 pub (32 bytes) — base64-кодируется и шлётся в crypto_init. */
  ephPublicKey: Uint8Array;
  /** AES-256 ключ для client → server шифрования (нужен при отправке frame'ов). */
  c2sKey: Uint8Array;
  /** AES-256 ключ для расшифровки server → client frame'ов. */
  s2cKey: Uint8Array;
}

/**
 * Создаёт новую WS session: генерит ephemeral keypair, делает ECDH с
 * server static pub, HKDF derive'ит 64 bytes → c2sKey || s2cKey.
 */
export function newWsSession(serverPubKey: Uint8Array = serverPublicKey()): WsSession {
  const eph = generateKeyPair();
  const shared = computeSharedSecret(eph.privateKey, serverPubKey);
  const derived = deriveHkdf(shared, HKDF_INFO_WS, 64);
  return {
    ephPublicKey: eph.publicKey,
    c2sKey: derived.slice(0, 32),
    s2cKey: derived.slice(32, 64),
  };
}

export interface ParsedWsFrame {
  direction: number;
  counter: number;
  /** ciphertext + 16-byte GCM tag (один блок, как ожидает aesGcmDecrypt). */
  ciphertextAndTag: Uint8Array;
}

/**
 * Парсит binary WS frame: проверяет version, извлекает direction/counter
 * из nonce, отдаёт ct+tag отдельно. Decrypt здесь НЕ происходит — это
 * отдельный шаг, чтобы caller мог сначала проверить counter и direction
 * до криптокода.
 */
export function parseWsFrame(frame: Uint8Array): ParsedWsFrame {
  if (frame.length < WS_FRAME_HEADER_LEN + TAG_LEN) {
    throw new Error(`ws frame too short: ${frame.length}`);
  }
  if (frame[0] !== WS_VERSION) {
    throw new Error(`unsupported ws envelope version: 0x${frame[0]?.toString(16) ?? '?'}`);
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
  const direction = view.getUint32(1, false);
  const counterHi = view.getUint32(5, false);
  const counterLo = view.getUint32(9, false);
  // Counter < 2^53 в обозримой Вселенной (1e15 frames @ 1k/s = 30к лет).
  const counter = counterHi * 0x1_0000_0000 + counterLo;
  return {
    direction,
    counter,
    ciphertextAndTag: frame.subarray(WS_FRAME_HEADER_LEN),
  };
}

/**
 * Расшифровывает входящий (s2c) frame. Caller должен предварительно
 * проверить, что parsed.direction === WS_DIRECTION_S2C и counter — strictly
 * monotonic (replay-protection). Если поднял throw — сессию надо
 * пересоздать (decrypt не повторно через тот же ключ).
 */
export function decryptWsFrame(s2cKey: Uint8Array, frame: Uint8Array): {
  plaintext: Uint8Array;
  counter: number;
} {
  const parsed = parseWsFrame(frame);
  if (parsed.direction !== WS_DIRECTION_S2C) {
    throw new Error(`expected s2c direction, got ${parsed.direction}`);
  }
  const nonce = frame.subarray(1, WS_FRAME_HEADER_LEN);
  const aad = new Uint8Array([WS_VERSION]);
  const plaintext = aesGcmDecrypt(s2cKey, nonce, parsed.ciphertextAndTag, aad);
  return { plaintext, counter: parsed.counter };
}

/**
 * Зашифровывает исходящий (c2s) frame. `counter` инкрементируется caller'ом
 * перед каждым вызовом — никаких stateful counter'ов внутри @pyn/core.
 */
export function encryptWsFrame(
  c2sKey: Uint8Array,
  counter: number,
  plaintext: Uint8Array,
): Uint8Array {
  const nonce = buildWsNonce(WS_DIRECTION_C2S, counter);
  const aad = new Uint8Array([WS_VERSION]);
  const ctAndTag = aesGcmEncrypt(c2sKey, nonce, plaintext, aad);
  const frame = new Uint8Array(WS_FRAME_HEADER_LEN + ctAndTag.length);
  frame[0] = WS_VERSION;
  frame.set(nonce, 1);
  frame.set(ctAndTag, WS_FRAME_HEADER_LEN);
  return frame;
}

function buildWsNonce(direction: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, direction, false);
  const hi = Math.floor(counter / 0x1_0000_0000);
  const lo = counter >>> 0;
  view.setUint32(4, hi, false);
  view.setUint32(8, lo, false);
  return nonce;
}

/** Re-export для backward compat — caller'ы импортируют отсюда. */
export const bytesToBase64 = bytesToBase64Shared;
