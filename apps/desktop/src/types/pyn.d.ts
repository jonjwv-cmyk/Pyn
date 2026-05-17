import type { Session, WsServerEvent } from '@pyn/core';

/**
 * Тип `window.pyn` — bridge из Electron preload.ts.
 * Доступен в renderer'е после `contextBridge.exposeInMainWorld('pyn', ...)`.
 */
declare global {
  interface Window {
    pyn: {
      platform: NodeJS.Platform;
      versions: {
        electron: string;
        chrome: string;
        node: string;
      };
      /**
       * POST бинарный E2E envelope на /api через main process.
       * Returns response bytes (тоже зашифрованный envelope).
       */
      api: (
        body: Uint8Array,
        headers: Record<string, string>,
        opts?: { timeoutMs?: number },
      ) => Promise<Uint8Array>;
      /** Renderer console.log → main stdout (для диагностики). */
      debugLog: (tag: string, message: string) => void;
      /** Persistent session storage через safeStorage в main process. */
      tokenStore: {
        load: () => Promise<Session | null>;
        save: (session: Session) => Promise<void>;
        clear: () => Promise<void>;
      };
      /** WS client (real-time events). Connection в main process. */
      ws: {
        start: (login: string, token: string) => Promise<void>;
        stop: () => Promise<void>;
        /** Подписка. Возвращает unsubscribe callback. */
        onEvent: (handler: (event: WsServerEvent) => void) => () => void;
      };
      /** Fetch encrypted blob через main process (обходит CORS). */
      blobFetch: (url: string) => Promise<Uint8Array>;
      /** Encrypted cache (Zustand persist storage). */
      cache: {
        load: (name: string) => Promise<string | null>;
        save: (name: string, value: string) => Promise<void>;
        clear: (name: string) => Promise<void>;
        clearAll: () => Promise<void>;
      };
    };
  }
}

export {};
