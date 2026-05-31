import { net, session, type ClientRequest } from 'electron';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import {
  base64ToBytes,
  bytesToBase64,
  computeSharedSecret,
  decryptWsFrame,
  deriveHkdf,
  encryptWsFrame,
  generateKeyPair,
} from '@pyn/core';

/**
 * Один туннель = один TCP-стрим webview'а к Google через VPS-релей.
 *
 * Транспорт ассиметричен (Electron `net.request` буферизует upload, стримит
 * download — проверено спайком):
 *   • DOWN: один долгий GET `/bridge/d?sid=` — стрим-ответ VPS→клиент.
 *   • UP: короткие POST `/bridge/u?sid=` — по одному в полёте (порядок кадров).
 *
 * Кадр на проводе: `[u32 len][ver=1][nonce12][ct+tag]` (AES-256-GCM, формат
 * `@pyn/core` ws-envelope). plaintext = `[type]+payload`: 0=OPEN(JSON
 * {ticket,host,port}), 1=DATA, 2=CLOSE. Per-stream X25519-сессия к статичному
 * ключу релея (HKDF `otl-bridge-v1`) → свои counters, без коллизий nonce.
 *
 * Шифр прячет от Касперского (который MITM'ит наружный TLS к VPS) и таргет, и
 * SNI/контент webview (его TLS к Google едет как непрозрачные байты).
 */

const HKDF_INFO_BRIDGE = 'otl-bridge-v1';
const TYPE_OPEN = 0;
const TYPE_DATA = 1;
const TYPE_CLOSE = 2;

export interface BridgeConfig {
  /** Базовый URL релея, напр. `https://45-12-239-5.sslip.io/bridge`. */
  url: string;
  /** HMAC-ticket из get_client_config (доказывает релею, что юзер залогинен). */
  ticket: string;
  /** Публичный X25519 ключ релея (base64). */
  relayPubKey: Uint8Array;
}

function lenPrefixed(frame: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(4 + frame.length);
  out.writeUInt32BE(frame.length, 0);
  Buffer.from(frame).copy(out, 4);
  return out;
}

/**
 * Заворачивает уже-принятый CONNECT-сокет webview'а в шифр-туннель до релея.
 * Вызывается локальным прокси после ответа `200 Connection Established`.
 */
export function createTunnel(host: string, port: number, clientSocket: Duplex, cfg: BridgeConfig): void {
  const eph = generateKeyPair();
  const shared = computeSharedSecret(eph.privateKey, cfg.relayPubKey);
  const okm = deriveHkdf(shared, HKDF_INFO_BRIDGE, 64);
  const c2sKey = okm.slice(0, 32);
  const s2cKey = okm.slice(32, 64);
  const sid = randomBytes(16).toString('hex');

  let c2sCounter = 0;
  let expectedS2c = 0;
  let ready = false;
  let closed = false;
  let upInFlight = false;
  const upQueue: Buffer[] = []; // plaintext-payloads ([type]+data), ждут отправки
  let downBuf: Buffer = Buffer.alloc(0);
  let downRes: NodeJS.ReadableStream | null = null;

  const dbg = (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[pyn:bridge] ${sid.slice(0, 8)} ${host}:${port} ${msg}`);
  };

  function teardown(why: string): void {
    if (closed) return;
    closed = true;
    dbg(`teardown (${why})`);
    // Best-effort CLOSE релею (освободит google-сокет) — если канал готов.
    if (ready && why !== 'relay-close' && why !== 'down-end') {
      try {
        const frame = encryptWsFrame(c2sKey, c2sCounter++, Buffer.from([TYPE_CLOSE]));
        const ureq = net.request({ method: 'POST', url: `${cfg.url}/u?sid=${sid}`, session: session.defaultSession });
        ureq.on('response', (r) => r.on('data', () => {}));
        ureq.on('error', () => {});
        ureq.write(lenPrefixed(frame));
        ureq.end();
      } catch { /* ignore */ }
    }
    try { clientSocket.destroy(); } catch { /* ignore */ }
  }

  function pump(): void {
    if (!ready || upInFlight || closed || upQueue.length === 0) return;
    const parts: Buffer[] = [];
    while (upQueue.length > 0) {
      const pt = upQueue.shift() as Buffer;
      parts.push(lenPrefixed(encryptWsFrame(c2sKey, c2sCounter++, pt)));
    }
    const body = Buffer.concat(parts);
    upInFlight = true;
    clientSocket.pause(); // throttle webview→up к одному батчу на RTT
    let ureq: ClientRequest;
    try {
      ureq = net.request({ method: 'POST', url: `${cfg.url}/u?sid=${sid}`, session: session.defaultSession });
    } catch (e) {
      teardown('up-create-error');
      return;
    }
    ureq.on('response', (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        upInFlight = false;
        if (!closed) { clientSocket.resume(); pump(); }
      });
    });
    ureq.on('error', () => teardown('up-error'));
    ureq.write(body);
    ureq.end();
  }

  function enqueue(type: number, payload?: Uint8Array): void {
    const head = Buffer.from([type]);
    upQueue.push(payload && payload.length ? Buffer.concat([head, Buffer.from(payload)]) : head);
    pump();
  }

  function processDown(): void {
    while (downBuf.length >= 4) {
      const len = downBuf.readUInt32BE(0);
      if (downBuf.length < 4 + len) break;
      const frame = downBuf.subarray(4, 4 + len);
      downBuf = downBuf.subarray(4 + len);
      let result: { plaintext: Uint8Array; counter: number };
      try {
        result = decryptWsFrame(s2cKey, frame);
      } catch {
        teardown('decrypt');
        return;
      }
      if (result.counter !== expectedS2c) {
        teardown('counter');
        return;
      }
      expectedS2c += 1;
      const type = result.plaintext[0];
      const payload = result.plaintext.subarray(1);
      if (type === TYPE_DATA) {
        const ok = clientSocket.write(Buffer.from(payload));
        if (!ok && downRes) {
          downRes.pause();
          clientSocket.once('drain', () => downRes?.resume());
        }
      } else if (type === TYPE_CLOSE) {
        teardown('relay-close');
        return;
      }
    }
  }

  // clientSocket события — webview-сторона.
  clientSocket.on('data', (d: Buffer) => enqueue(TYPE_DATA, d));
  clientSocket.on('end', () => enqueue(TYPE_CLOSE));
  clientSocket.on('close', () => teardown('client-close'));
  clientSocket.on('error', () => teardown('client-error'));
  clientSocket.pause(); // копим байты webview, пока не готов DOWN

  // DOWN: открываем стрим-ответ, затем шлём OPEN.
  let dreq: ClientRequest;
  try {
    dreq = net.request({ method: 'GET', url: `${cfg.url}/d?sid=${sid}`, session: session.defaultSession });
  } catch {
    teardown('down-create-error');
    return;
  }
  dreq.setHeader('x-epk', bytesToBase64(eph.publicKey));
  dreq.on('response', (res) => {
    if (res.statusCode !== 200) {
      teardown(`down-status-${res.statusCode}`);
      return;
    }
    ready = true;
    downRes = res as unknown as NodeJS.ReadableStream;
    enqueue(TYPE_OPEN, Buffer.from(JSON.stringify({ ticket: cfg.ticket, host, port })));
    clientSocket.resume();
    res.on('data', (chunk: Buffer) => {
      downBuf = downBuf.length ? Buffer.concat([downBuf, chunk]) : chunk;
      processDown();
    });
    res.on('end', () => teardown('down-end'));
    res.on('error', () => teardown('down-stream-error'));
  });
  dreq.on('error', () => teardown('down-error'));
  dreq.end();
}
