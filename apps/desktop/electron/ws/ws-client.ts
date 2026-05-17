import { lookup as dnsLookupRaw, type LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import type { ConnectionOptions, TLSSocket } from 'node:tls';

import { WebSocket as NodeWebSocket, type ClientOptions, type RawData } from 'ws';
import {
  bytesToBase64,
  decryptWsFrame,
  encryptWsFrame,
  newWsSession,
  type WsServerEvent,
  type WsSession,
} from '@pyn/core';
import {
  computeSpkiSha256Base64,
  isCorporateAvCert,
  PINNED_HOST,
  VPS_SPKI_PIN_SHA256_B64,
} from '../network/tls';

/**
 * WS клиент в main process.
 *
 * Lifecycle:
 *   start(login, token)  → DNS-override (api.otlhelper.com → 45.12.239.5) +
 *                          TLS handshake с rejectUnauthorized:false (cert
 *                          self-signed) → upgrade event: SPKI pin verify
 *                          против VPS_SPKI_PIN_SHA256_B64; mismatch → terminate
 *                          (с AV-fallback аналогично REST)
 *                        → open → crypto_init (TEXT JSON) → ждём crypto_ok
 *                        → hello (TEXT JSON) → server переключается в encrypted
 *                        → binary frames с layout `[ver][nonce12][ct+tag]`
 *                          (counter strict monotonic, AAD = [VERSION])
 *
 * Зачем кастомный lookup + SPKI: Node `ws` package не использует Chromium
 * host-resolver-rules и `setCertificateVerifyProc`. Эти Electron-механизмы
 * работают только для `session.fetch` (REST + blob). Для WS — собственная
 * проверка через TLS options (`lookup`, `servername`, `rejectUnauthorized`)
 * плюс ручной SPKI-verify в upgrade event перед посылкой crypto_init.
 *
 * Reconnect:
 *   • Exponential backoff (500ms · 2^N, max 30s). Reset attempt counter после
 *     successful crypto_ok.
 *   • Special close codes: 4005 ws_auth_failed → stop (token мёртв).
 *
 * Не делает (вне MVP scope):
 *   • encrypt outgoing frames (presence/typing) — UI не использует
 *   • rekey каждый час — сессии короткие
 *
 * 🔴 Singleton — один WS connection per Pyn process. Caller (ws-bridge) гарантирует.
 */

const WS_URL = `wss://${PINNED_HOST}/ws`;
const PINNED_IP = '45.12.239.5';
/**
 * Rekey каждые 60 минут (1:1 с Kotlin `WsClient.kt::WS_MAX_SESSION_MS`).
 * Реализован через `close(1000, "rekey_rotation")` + автоматический reconnect:
 * новый ephemeral keypair → новый ECDH → свежие c2s/s2c keys → counter с 0.
 * Никаких in-band rekey-сообщений — простой close+reconnect, как в Kotlin.
 */
const WS_REKEY_INTERVAL_MS = 60 * 60 * 1000;

type Listener = (event: WsServerEvent) => void;

interface ClientState {
  ws: NodeWebSocket | null;
  session: WsSession | null;
  expectedS2cCounter: number;
  /** Counter для исходящих (c2s) frame'ов. Сбрасывается на 0 при каждом connect. */
  outgoingCounter: number;
  /** `true` после crypto_ok + hello — можно слать encrypted outgoing frames. */
  readyForSend: boolean;
  login: string | null;
  token: string | null;
  stopping: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  pinVerified: boolean;
  /** Таймер scheduled rekey (60 мин). Сбрасывается при close/stopWs. */
  rekeyTimer: NodeJS.Timeout | null;
}

const state: ClientState = {
  ws: null,
  session: null,
  expectedS2cCounter: 0,
  outgoingCounter: 0,
  readyForSend: false,
  login: null,
  token: null,
  stopping: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
  pinVerified: false,
  rekeyTimer: null,
};

const listeners = new Set<Listener>();

/** Запустить (или перезапустить с новыми credentials) WS-подключение. */
export function startWs(login: string, token: string): void {
  // Если уже запущен с теми же кредами — no-op (избежать лишнего reconnect при HMR).
  if (state.ws && state.login === login && state.token === token && !state.stopping) {
    return;
  }
  // Иначе остановить старое подключение и подключиться заново.
  stopWs();
  state.stopping = false;
  state.login = login;
  state.token = token;
  state.reconnectAttempt = 0;
  connect();
}

/** Закрыть подключение и не реконнектить. */
export function stopWs(): void {
  state.stopping = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.rekeyTimer) {
    clearTimeout(state.rekeyTimer);
    state.rekeyTimer = null;
  }
  if (state.ws) {
    try {
      state.ws.removeAllListeners();
      state.ws.close();
    } catch {
      /* ignore */
    }
    state.ws = null;
  }
  state.session = null;
  state.expectedS2cCounter = 0;
  state.outgoingCounter = 0;
  state.readyForSend = false;
  state.pinVerified = false;
}

/**
 * Отправить событие серверу как **encrypted binary frame** (presence, typing,
 * read-receipts и т.п.). Каждый вызов инкрементирует c2s counter (strict
 * monotonic в рамках connection); после rekey'a / reconnect'a counter снова
 * с 0 — это нормально, server открывает новую сессию.
 *
 * No-op если соединение ещё не готово (нет session / pin не verified /
 * не получили crypto_ok). Caller может вызывать смело — мы тихо игнорируем
 * до полного handshake.
 */
export function sendEvent(payload: object): void {
  if (!state.ws || !state.session || !state.readyForSend) return;
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const frame = encryptWsFrame(state.session.c2sKey, state.outgoingCounter, plaintext);
    state.outgoingCounter = state.outgoingCounter + 1;
    state.ws.send(frame);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:ws] sendEvent failed:', err);
  }
}

/** Подписка на server events. Возвращает unsubscribe-функцию. */
export function onWsEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}


/**
 * DNS-override: api.otlhelper.com → 45.12.239.5. Передаётся в TLS options
 * `ws` package'а. Прочие хосты делегируем системному резолверу (на случай
 * если когда-нибудь добавятся вспомогательные соединения).
 */
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  if (hostname === PINNED_HOST) {
    if (options.all) {
      (callback as unknown as (err: null, addrs: LookupAddress[]) => void)(null, [
        { address: PINNED_IP, family: 4 },
      ]);
    } else {
      callback(null, PINNED_IP, 4);
    }
    return;
  }
  dnsLookupRaw(hostname, options, callback);
};

function connect(): void {
  const session = newWsSession();
  state.session = session;
  state.expectedS2cCounter = 0;
  state.outgoingCounter = 0;
  state.readyForSend = false;
  state.pinVerified = false;
  if (state.rekeyTimer) {
    clearTimeout(state.rekeyTimer);
    state.rekeyTimer = null;
  }

  // eslint-disable-next-line no-console
  console.log(`[pyn:ws] connecting to ${WS_URL} (pinned → ${PINNED_IP})`);
  // 🔴 TLS pin: cert self-signed, поэтому rejectUnauthorized:false и проверка
  //   SPKI вручную в upgrade event ниже. До успешного pin'а ничего секретного
  //   на проводе нет — только HTTP upgrade headers (Sec-WebSocket-Key и т.п.),
  //   которые не содержат токенов или эфемерных ключей.
  // `@types/ws` ClientOptions не expose TLS-passthrough поля (servername /
  //   rejectUnauthorized / lookup), хотя `ws` package передаёт их в нижележащий
  //   `tls.connect`. Intersection-cast — единственный безопасный способ
  //   передать SNI + skip-system-verify без `any`.
  const wsOptions = {
    servername: PINNED_HOST,
    rejectUnauthorized: false,
    lookup: pinnedLookup,
  } satisfies ConnectionOptions & { lookup: LookupFunction };
  const ws = new NodeWebSocket(WS_URL, wsOptions as ClientOptions);
  state.ws = ws;

  ws.on('upgrade', (response: IncomingMessage) => {
    const socket = response.socket as TLSSocket;
    if (typeof socket?.getPeerCertificate !== 'function') {
      // eslint-disable-next-line no-console
      console.error('[pyn:ws] upgrade socket is not TLSSocket — terminating');
      ws.terminate();
      return;
    }
    const cert = socket.getPeerCertificate(true);
    if (!cert || !cert.raw) {
      // eslint-disable-next-line no-console
      console.error('[pyn:ws] no peer cert on upgrade — terminating');
      ws.terminate();
      return;
    }
    const spkiHash = computeSpkiSha256Base64(cert.raw);
    // eslint-disable-next-line no-console
    console.log(
      `[pyn:ws] tls verify ${PINNED_HOST} SPKI=${spkiHash} expected=${VPS_SPKI_PIN_SHA256_B64}`,
    );
    if (spkiHash === VPS_SPKI_PIN_SHA256_B64) {
      // eslint-disable-next-line no-console
      console.log(`[pyn:ws] pin verified for ${PINNED_HOST}`);
      state.pinVerified = true;
      return;
    }
    // AV fallback (Kaspersky / корп MITM). В Node `cert.issuer`/`subject` —
    // объекты (CN/O/OU/...), в отличие от Electron-API где это plain strings.
    // Склеиваем поля в одну строку для общей heuristic.
    const issuerStr = certNameToString(cert.issuer);
    const subjectStr = certNameToString(cert.subject);
    if (isCorporateAvCert(issuerStr, subjectStr)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pyn:ws] AV-intercepted cert on ${PINNED_HOST} (issuer=${issuerStr}); WS payload защищён E2E, пропускаем`,
      );
      state.pinVerified = true;
      return;
    }
    // eslint-disable-next-line no-console
    console.error(
      `[pyn:ws] SPKI mismatch on ${PINNED_HOST}: got ${spkiHash}, expected ${VPS_SPKI_PIN_SHA256_B64} — terminating`,
    );
    ws.terminate();
  });

  ws.on('open', () => {
    if (!state.pinVerified) {
      // eslint-disable-next-line no-console
      console.error('[pyn:ws] open without pin verify — terminating');
      ws.terminate();
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[pyn:ws] open — sending crypto_init');
    ws.send(
      JSON.stringify({
        type: 'crypto_init',
        v: 1,
        epk: bytesToBase64(session.ephPublicKey),
      }),
    );
  });

  ws.on('message', (data: RawData, isBinary: boolean) => {
    handleMessage(data, isBinary);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason?.toString() ?? '';
    // eslint-disable-next-line no-console
    console.log(`[pyn:ws] closed code=${code} reason="${reasonStr}"`);
    state.ws = null;
    state.session = null;
    state.pinVerified = false;
    state.readyForSend = false;
    if (state.rekeyTimer) {
      clearTimeout(state.rekeyTimer);
      state.rekeyTimer = null;
    }
    if (code === 4005) {
      // ws_auth_failed — токен мёртв. Эмитим pseudo desktop_kicked, чтобы UI
      // увёл к LoginScreen и почистил persisted session.
      // eslint-disable-next-line no-console
      console.log('[pyn:ws] auth failed, not reconnecting');
      state.stopping = true;
      emit({ type: 'desktop_kicked', reason: 'ws_auth_failed' });
      return;
    }
    // Scheduled rekey — не наказываем reconnectAttempt'ом за намеренный close,
    // чтобы первая попытка переподключения была через 500ms · 2^0 = 500ms.
    if (reasonStr === 'rekey_rotation') {
      state.reconnectAttempt = 0;
    }
    if (!state.stopping) scheduleReconnect();
  });

  ws.on('error', (err: Error) => {
    // 'close' срабатывает следом — здесь только лог.
    // eslint-disable-next-line no-console
    console.warn('[pyn:ws] error:', err.message);
  });
}

function handleMessage(data: RawData, isBinary: boolean): void {
  if (!isBinary) {
    // TEXT frame — может быть:
    //   • handshake (`crypto_ok`) — на него отвечаем hello
    //   • event от `broadcastToRoom` (external HTTP-broadcast пайплайн в
    //     ws-room.js — не использует session.s2cKey шифрование, шлёт plain
    //     JSON всем). Большинство broadcast'ов после send_news/send_message/
    //     add_reaction идут именно этим путём → события *всегда* TEXT.
    const text = bufferToString(data);
    let msg: WsServerEvent;
    try {
      msg = JSON.parse(text) as WsServerEvent;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:ws] failed to parse text frame:', err);
      return;
    }
    if (msg.type === 'crypto_ok') {
      // eslint-disable-next-line no-console
      console.log('[pyn:ws] crypto_ok — sending hello');
      state.ws?.send(
        JSON.stringify({ type: 'hello', login: state.login, token: state.token }),
      );
      state.reconnectAttempt = 0;
      // Готовы шифровать исходящие frame'ы (presence/typing/...). Server
      // принимает encrypted frames сразу после crypto_ok — hello идёт plaintext
      // только потому что server переключается в encrypted-mode после него.
      state.readyForSend = true;
      // Запускаем scheduled rekey: через 60 мин close → reconnect, новые
      // ephemeral keys, counter с 0. 1:1 с Kotlin WsClient (WS_MAX_SESSION_MS).
      scheduleRekey();
      // RTT-замер вынесен в отдельный модуль `network/vps-ping.ts` — он бьёт
      // напрямую в nginx `/__ping` на VPS (без проксирования на CF Worker'a,
      // ноль расхода CF дневного лимита). WS-ping/pong удалён — DO держит
      // соединение, RTT через HTTP делает то же без рисков.
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[pyn:ws] text event ${msg.type}`);
    emit(msg);
    return;
  }

  // Binary — encrypted event.
  if (!state.session) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:ws] binary frame before session ready');
    return;
  }
  const frame = rawDataToUint8(data);
  let plaintext: Uint8Array;
  let counter: number;
  try {
    const result = decryptWsFrame(state.session.s2cKey, frame);
    plaintext = result.plaintext;
    counter = result.counter;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:ws] decrypt failed, reconnecting:', err);
    state.ws?.close();
    return;
  }
  if (counter !== state.expectedS2cCounter) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pyn:ws] counter mismatch: got ${counter}, expected ${state.expectedS2cCounter}; reconnecting`,
    );
    state.ws?.close();
    return;
  }
  state.expectedS2cCounter = counter + 1;

  let event: WsServerEvent;
  try {
    event = JSON.parse(new TextDecoder().decode(plaintext)) as WsServerEvent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:ws] event JSON parse failed:', err);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[pyn:ws] event ${event.type}`);
  emit(event);
}

/**
 * Эмитит pseudo-событие `ws_rtt` извне — используется `vps-ping.ts` после
 * замера VPS roundtrip. Тот же event type что и для WS-pong (UI один и тот же).
 */
export function emitRtt(rttMs: number): void {
  if (!Number.isFinite(rttMs) || rttMs < 0) return;
  emit({ type: 'ws_rtt', rtt_ms: rttMs });
}

function emit(event: WsServerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:ws] listener threw:', err);
    }
  }
}

/**
 * Запускает таймер на rekey rotation. Через `WS_REKEY_INTERVAL_MS` принудительно
 * закрываем WS с reason="rekey_rotation"; close-handler сбросит attempt и
 * scheduleReconnect() переподключится с новой ephemeral парой (counter с 0).
 */
function scheduleRekey(): void {
  if (state.rekeyTimer) clearTimeout(state.rekeyTimer);
  state.rekeyTimer = setTimeout(() => {
    state.rekeyTimer = null;
    if (state.ws && !state.stopping) {
      // eslint-disable-next-line no-console
      console.log('[pyn:ws] rekey rotation — closing WS to refresh ephemeral keys');
      try {
        state.ws.close(1000, 'rekey_rotation');
      } catch {
        /* ignore */
      }
    }
  }, WS_REKEY_INTERVAL_MS);
}

function scheduleReconnect(): void {
  const attempt = state.reconnectAttempt;
  state.reconnectAttempt = attempt + 1;
  const delay = Math.min(500 * Math.pow(2, attempt), 30_000);
  // eslint-disable-next-line no-console
  console.log(`[pyn:ws] reconnect in ${delay}ms (attempt ${attempt + 1})`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!state.stopping) connect();
  }, delay);
}

function bufferToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

function rawDataToUint8(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.length);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Array.isArray(data)) {
    const buf = Buffer.concat(data);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  }
  return new Uint8Array(data as ArrayBufferLike);
}

/**
 * Node `tls.PeerCertificate.issuer` / `.subject` — объекты вида `{CN,O,OU,...}`
 * со string-или-string[]-или-undefined значениями. Сплющиваем в одну строку
 * для re-use общей AV-heuristic, которая ждёт plain string (как в Electron API).
 */
function certNameToString(name: Record<string, unknown> | undefined): string {
  if (!name) return '';
  return Object.values(name)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((s): s is string => typeof s === 'string')
    .join(' ');
}
