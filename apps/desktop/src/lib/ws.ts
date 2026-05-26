import { useEffect, useRef } from 'react';
import type { WsServerEvent } from '@pyn/core';

/**
 * Renderer-side WS manager.
 *
 *   • start(login, token) / stop() — управление подключением в main process через IPC.
 *   • subscribeWs(handler) — pub/sub поверх `window.pyn.ws.onEvent`.
 *   • useWsEvent(type, handler) — React-hook для удобства в компонентах.
 *
 * Между renderer'ом и main крутится одна IPC-подписка — все local listeners
 * мультиплексируются на неё, чтобы не плодить IPC-каналы.
 */

type Listener = (event: WsServerEvent) => void;

const listeners = new Set<Listener>();
let bridgeUnsubscribe: (() => void) | null = null;

function ensureBridgeSubscribed(): void {
  if (bridgeUnsubscribe) return;
  if (typeof window === 'undefined') return;

  // §pyn-1.2.33 — два транспорта одновременно: WS через main-process IPC и
  // SSE через CustomEvent в renderer. Оба пишут в один listeners-set.
  // Если оба активны → события дублируются (idempotent handlers OK; для не-
  // идемпотентных можно добавить dedup по event.id позже).
  const wsUnsub = window.pyn?.ws?.onEvent((event) => {
    for (const l of listeners) {
      try { l(event); } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:ws] listener threw:', err);
      }
    }
  });

  const sseHandler = (e: Event) => {
    const event = (e as CustomEvent).detail as WsServerEvent | undefined;
    if (!event) return;
    for (const l of listeners) {
      try { l(event); } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:sse] listener threw:', err);
      }
    }
  };
  window.addEventListener('pyn:server-event', sseHandler);

  bridgeUnsubscribe = () => {
    wsUnsub?.();
    window.removeEventListener('pyn:server-event', sseHandler);
  };
}

/** Подписка на все WS события. Возвращает unsubscribe. */
export function subscribeWs(handler: Listener): () => void {
  ensureBridgeSubscribed();
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export async function startWs(login: string, token: string): Promise<void> {
  if (typeof window === 'undefined' || !window.pyn?.ws) return;
  await window.pyn.ws.start(login, token);
}

export async function stopWs(): Promise<void> {
  if (typeof window === 'undefined' || !window.pyn?.ws) return;
  await window.pyn.ws.stop();
}

/**
 * React-hook: подписаться на конкретный event type. Handler читается из ref,
 * поэтому новый handler на каждый render НЕ триггерит resubscribe — IPC
 * подписка остаётся стабильной за всё время mount'а компонента.
 */
export function useWsEvent<T extends WsServerEvent = WsServerEvent>(
  type: T['type'],
  handler: (event: T) => void,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    return subscribeWs((event) => {
      if (event.type === type) handlerRef.current(event as T);
    });
  }, [type]);
}
