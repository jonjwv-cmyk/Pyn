import { useEffect, useRef } from 'react';
import {
  bytesToBase64,
  decryptWsFrame,
  encryptWsFrame,
  newWsSession,
  type WsServerEvent,
  type WsSession,
} from '@pyn/core';

/**
 * Mobile WS client (RN built-in WebSocket). Singleton — один connect на app.
 *
 * Flow:
 *   1. connect to `wss://api.otlhelper.com/ws`
 *   2. send TEXT crypto_init {epk: base64} → wait TEXT crypto_ok
 *   3. send TEXT hello {token} → server переключает на encrypted frames
 *   4. receive binary frames → decrypt → JSON event → dispatch listeners
 *
 * Reconnect: exponential backoff (500ms · 2^N, max 30s). close 4006 = app_locked
 * (kill switch) → stop, не reconnect.
 */

const WS_URL = 'wss://api.otlhelper.com/ws';
const MAX_BACKOFF_MS = 30_000;

type Listener = (event: WsServerEvent) => void;

interface State {
  ws: WebSocket | null;
  session: WsSession | null;
  incomingCounter: number;
  outgoingCounter: number;
  login: string | null;
  token: string | null;
  stopping: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
}

const state: State = {
  ws: null,
  session: null,
  incomingCounter: 0,
  outgoingCounter: 0,
  login: null,
  token: null,
  stopping: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
};

const listeners = new Set<Listener>();
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function startWs(login: string, token: string): void {
  if (state.ws && state.login === login && state.token === token) return;
  stopWs();
  state.stopping = false;
  state.login = login;
  state.token = token;
  connect();
}

export function stopWs(): void {
  state.stopping = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.ws) {
    try { state.ws.close(1000, 'client_stop'); } catch { /* ignore */ }
    state.ws = null;
  }
  state.session = null;
  state.incomingCounter = 0;
  state.outgoingCounter = 0;
  state.reconnectAttempt = 0;
}

function connect(): void {
  const ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  state.ws = ws;

  ws.onopen = () => {
    try {
      const session = newWsSession();
      state.session = session;
      state.incomingCounter = 0;
      state.outgoingCounter = 0;
      ws.send(JSON.stringify({
        type: 'crypto_init',
        v: 1,
        epk: bytesToBase64(session.ephPublicKey),
      }));
    } catch (err) {
      console.warn('[pyn:ws] crypto_init failed:', err);
      try { ws.close(); } catch { /* ignore */ }
    }
  };

  ws.onmessage = (event) => {
    try {
      if (typeof event.data === 'string') {
        let msg: { type?: string } = {};
        try { msg = JSON.parse(event.data); } catch { /* ignore */ }
        if (msg.type === 'crypto_ok' && state.token) {
          // plain hello (sent before server switches to encrypted-required mode)
          ws.send(JSON.stringify({ type: 'hello', token: state.token }));
          state.reconnectAttempt = 0;
        }
        return;
      }
      // Binary frame
      if (!state.session) return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const { plaintext, counter } = decryptWsFrame(state.session.s2cKey, bytes);
      if (counter < state.incomingCounter) {
        console.warn('[pyn:ws] non-monotonic counter, dropping');
        return;
      }
      state.incomingCounter = counter + 1;
      const parsed = JSON.parse(textDecoder.decode(plaintext)) as WsServerEvent;
      for (const l of listeners) {
        try { l(parsed); } catch (err) { console.warn('[pyn:ws] listener threw:', err); }
      }
    } catch (err) {
      console.warn('[pyn:ws] frame decrypt failed:', err);
    }
  };

  ws.onerror = (err) => {
    const msg = (err as Event & { message?: string }).message;
    console.warn('[pyn:ws] error:', msg || 'unknown');
  };

  ws.onclose = (event) => {
    state.ws = null;
    state.session = null;
    state.incomingCounter = 0;
    state.outgoingCounter = 0;
    if (state.stopping || event.code === 4005 || event.code === 4006) {
      return;
    }
    const delay = Math.min(500 * Math.pow(2, state.reconnectAttempt), MAX_BACKOFF_MS);
    state.reconnectAttempt += 1;
    state.reconnectTimer = setTimeout(() => {
      if (!state.stopping) connect();
    }, delay);
  };
}

export function subscribeWs(handler: Listener): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

export function useWsEvent<T extends WsServerEvent = WsServerEvent>(
  type: T['type'],
  handler: (event: T) => void,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);
  useEffect(() => {
    return subscribeWs((event) => {
      if (event.type === type) handlerRef.current(event as T);
    });
  }, [type]);
}

/** Encrypt + send outgoing frame (для presence/typing). Опционально. */
export function sendWs(payload: object): void {
  if (!state.ws || !state.session) return;
  try {
    const bytes = encryptWsFrame(
      state.session.c2sKey,
      state.outgoingCounter,
      textEncoder.encode(JSON.stringify(payload)),
    );
    state.outgoingCounter += 1;
    state.ws.send(bytes);
  } catch (err) {
    console.warn('[pyn:ws] send failed:', err);
  }
}
