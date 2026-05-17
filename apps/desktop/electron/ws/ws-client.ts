import { WebSocket as NodeWebSocket, type RawData } from 'ws';
import {
  bytesToBase64,
  decryptWsFrame,
  newWsSession,
  type WsServerEvent,
  type WsSession,
} from '@pyn/core';

/**
 * WS клиент в main process.
 *
 * Lifecycle:
 *   start(login, token)  → connect → crypto_init (TEXT JSON) → ждём crypto_ok
 *                        → hello (TEXT JSON) → server переключается в encrypted
 *                        → binary frames с layout `[ver][nonce12][ct+tag]`
 *
 * Каждый frame:
 *   • parse → достаём direction + counter
 *   • validate direction == s2c (2), counter == expected (strict monotonic)
 *   • decrypt → JSON parse → emit to listeners
 *
 * Reconnect:
 *   • Exponential backoff (500ms · 2^N, max 30s). Reset attempt counter после
 *     successful crypto_ok.
 *   • Special close codes: 4005 ws_auth_failed → stop (token мёртв).
 *
 * Не делает (вне MVP scope):
 *   • encrypt outgoing frames (presence/typing) — UI не использует
 *   • rekey каждый час — сессии короткие
 *   • TLS pinning custom verify — стандартный truststore через Node TLS
 *
 * 🔴 Singleton — один WS connection per Pyn process. Caller (ws-bridge) гарантирует.
 */

const WS_URL = 'wss://45-12-239-5.sslip.io/ws';

type Listener = (event: WsServerEvent) => void;

interface ClientState {
  ws: NodeWebSocket | null;
  session: WsSession | null;
  expectedS2cCounter: number;
  login: string | null;
  token: string | null;
  stopping: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
}

const state: ClientState = {
  ws: null,
  session: null,
  expectedS2cCounter: 0,
  login: null,
  token: null,
  stopping: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
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
}

/** Подписка на server events. Возвращает unsubscribe-функцию. */
export function onWsEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function connect(): void {
  const session = newWsSession();
  state.session = session;
  state.expectedS2cCounter = 0;

  // eslint-disable-next-line no-console
  console.log('[pyn:ws] connecting to', WS_URL);
  const ws = new NodeWebSocket(WS_URL);
  state.ws = ws;

  ws.on('open', () => {
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
    if (code === 4005) {
      // ws_auth_failed — токен мёртв. Эмитим pseudo desktop_kicked, чтобы UI
      // увёл к LoginScreen и почистил persisted session.
      // eslint-disable-next-line no-console
      console.log('[pyn:ws] auth failed, not reconnecting');
      state.stopping = true;
      emit({ type: 'desktop_kicked', reason: 'ws_auth_failed' });
      return;
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
