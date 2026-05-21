import type { Session, WsServerEvent } from '@pyn/core';

/**
 * Тип `window.pyn` — bridge из Electron preload.ts.
 * Доступен в renderer'е после `contextBridge.exposeInMainWorld('pyn', ...)`.
 */
declare global {
  interface Window {
    pyn: {
      platform: NodeJS.Platform;
      /** Версия desktop-сборки (apps/desktop/package.json через app.getVersion). */
      appVersion: string;
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
        /**
         * Отправить событие серверу как encrypted binary frame
         * (presence/typing/read-receipts/…). No-op до завершения handshake.
         */
        send: (payload: object) => Promise<void>;
        /** Подписка. Возвращает unsubscribe callback. */
        onEvent: (handler: (event: WsServerEvent) => void) => () => void;
      };
      /** Fetch encrypted blob через main process (обходит CORS). */
      blobFetch: (url: string) => Promise<Uint8Array>;
      /** МОЛ snapshot download — encrypted → plain JSON string. */
      mol: {
        fetchSnapshot: (
          url: string,
          blobKeyB64: string,
          blobNonceB64: string,
        ) => Promise<string>;
      };
      /** Encrypted cache (Zustand persist storage). */
      cache: {
        load: (name: string) => Promise<string | null>;
        save: (name: string, value: string) => Promise<void>;
        clear: (name: string) => Promise<void>;
        clearAll: () => Promise<void>;
      };
      /** Google account flow для embedded Sheets. */
      google: {
        openLogin: () => Promise<boolean>;
        checkStatus: () => Promise<{ loggedIn: boolean; email: string | null }>;
        logout: () => Promise<{ loggedIn: boolean; email: string | null }>;
      };
      /**
       * SAP-macro VBS runner (Windows only). Возвращает TSV-строку которую
       * нужно отправить серверу через `submitMacroData`.
       */
      macro: {
        runVbs: (
          vbsSource: string,
        ) => Promise<{ ok: boolean; tsv?: string; error?: string }>;
      };
      /** Auto-update — download + install с поддержкой SHA verify и кэша. */
      update: {
        /** Файл уже скачан? */
        checkCached: (
          url: string,
          version: string,
        ) => Promise<{ exists: boolean; localPath: string }>;
        /** Streaming download с прогрессом + SHA-256 verify. */
        download: (
          url: string,
          version: string,
          expectedSha?: string,
        ) => Promise<{ ok: boolean; localPath?: string; sha?: string; error?: string }>;
        /** Запустить ранее скачанный installer + quit. */
        install: (
          localPath: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        onProgress: (
          handler: (progress: { bytes: number; total: number }) => void,
        ) => () => void;
      };
      /**
       * Kill switch / app lock — full userData wipe + relaunch (как fresh install).
       * device_id живёт в encrypted cache, при wipe удаляется естественно.
       */
      appLock: {
        wipe: () => Promise<void>;
      };
      /**
       * Tray menu actions (custom React menu in popup BrowserWindow).
       * Закрытие Pyn — только через `quit` отсюда; close-X на main окне
       * минимизирует в tray.
       */
      tray: {
        show: () => Promise<void>;
        openSettings: () => Promise<void>;
        quit: () => Promise<void>;
        closeMenu: () => Promise<void>;
        /** Подписка на 'open-settings' event от tray menu. */
        onOpenSettings: (handler: () => void) => () => void;
      };
    };
  }
  /**
   * Минимальная типизация для Electron `<webview>` tag (используется в
   * TablesScreen для embedded Google Sheets).
   */
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean | 'true';
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
