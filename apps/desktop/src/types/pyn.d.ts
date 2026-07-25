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
      /**
       * DEV-ONLY: сетевой маршрут — 'vps' (штатный, через VPS) или 'cloud' (прямой Cloudflare,
       * минуя VPS). Только для разработки на Mac (VPS отпал). В проде смена игнорируется
       * (`allowed=false`), всегда 'vps'.
       */
      devApiMode: {
        get: () => Promise<{ mode: 'vps' | 'cloud'; allowed: boolean }>;
        set: (mode: 'vps' | 'cloud') => Promise<{ mode: 'vps' | 'cloud'; allowed: boolean }>;
      };
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
      /** Снэпшот складов («Цеха»-база) — encrypted → plain JSON string. */
      warehouses: {
        fetchSnapshot: (
          url: string,
          blobKeyB64: string,
          blobNonceB64: string,
        ) => Promise<string>;
      };
      /** Снэпшот базы ПЕРСОН («Контакты») — encrypted → plain JSON string. */
      persons: {
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
      /** Погода карты: радар осадков (RainViewer) + сводка (Open-Meteo) через мост. */
      mapWeather?: (
        lat: number,
        lng: number,
      ) => Promise<{
        ok: boolean;
        frame: number;
        weather: null | {
          tempC: number | null;
          windMs: number | null;
          precipMm: number | null;
          code: number | null;
          currentTime: string | null;
          pressureHpa: number | null;
          isPrecip: boolean;
          hourly: Array<{
            time: string;
            tempC: number | null;
            precipMm: number | null;
            rainMm: number | null;
            snowCm: number | null;
            precipProb: number | null;
            code: number | null;
            windMs: number | null;
            windDir: number | null;
            gustMs: number | null;
          }>;
        };
      }>;
      /** Поле ветра/давления по видимой области карты (Open-Meteo через VPS-мост). */
      mapWeatherField?: (
        bounds: { south: number; west: number; north: number; east: number },
      ) => Promise<{
        ok: boolean;
        points: Array<{
          lat: number;
          lng: number;
          windMs: number | null;
          windDir: number | null;
          gustMs: number | null;
          precipMm: number | null;
          code: number | null;
          pressureHpa: number | null;
        }>;
      }>;
      /** Высота точки над уровнем моря (Open-Meteo) через мост. */
      mapElevation?: (lat: number, lng: number) => Promise<{ ok: boolean; elevation: number | null }>;
      /** ГЛОНАСС-мониторинг транспорта (кнопка «Глонасс» на карте) через VPS-мост. */
      glonass?: {
        vehicles: () => Promise<{
          ok: boolean;
          vehicles: Array<{
            id: number; guid: string; name: string;
            garage: string; gos: string; imei: string; status: number;
          }>;
          error?: string;
        }>;
        positions: (ids: number[]) => Promise<{
          ok: boolean;
          positions: Array<{
            id: number; lat: number; lng: number;
            speed: number | null; course: number | null; ign: boolean | null; time: string | null;
          }>;
          offline?: boolean;
          error?: string | null;
        }>;
        activity: (id: number, from: string, to: string) => Promise<{
          ok: boolean;
          moves: Array<Record<string, unknown>>;
          stops: Array<Record<string, unknown>>;
          error?: string | null;
        }>;
        historyPoints: (id: number, from: string, to: string) => Promise<{
          ok: boolean;
          points: Array<{
            lat: number;
            lng: number;
            speed: number | null;
            time: string;
          }>;
          error?: string | null;
        }>;
        stats: (ids: number[], from: string, to: string) => Promise<{
          ok: boolean;
          items: Array<Record<string, unknown>>;
          error?: string;
        }>;
      };
      /** Google account flow для embedded Sheets. */
      google: {
        openLogin: () => Promise<boolean>;
        checkStatus: () => Promise<{ loggedIn: boolean; email: string | null }>;
        logout: () => Promise<{ loggedIn: boolean; email: string | null }>;
      };
      /**
       * Google-bridge: передать {url,ticket} из get_client_config в main для
       * применения PAC к partition Google-таблиц (если обнаружен корп-прокси).
       */
      bridge: {
        /** Возвращает true если мост реально включён (есть корп-прокси). */
        configure: (url: string, ticket: string) => Promise<boolean>;
      };
      /**
       * SAP-macro VBS runner (Windows only). Возвращает TSV-строку которую
       * нужно отправить серверу через `submitMacroData`.
       */
      macro: {
        runVbs: (
          vbsSource: string,
          opts?: {
            inputFiles?: Array<{
              envName: string;
              filename?: string;
              content: string;
              encoding?: 'utf8' | 'win1251';
            }>;
            outputFormat?: 'tsv' | 'html';
          },
        ) => Promise<{ ok: boolean; tsv?: string; html?: string; error?: string }>;
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
       * Electron webUtils — для drag-drop из OS получаем absolute path.
       */
      webUtils: {
        getPathForFile: (file: File) => string;
      };
      /**
       * SMB-проводник для сетевой папки Экспедиция. Win-only.
       * UNC root: \\fs1\Exchange\00000899 - Экспедиция\
       */
      fs: {
        platform: () => Promise<{
          platform: string;
          supported: boolean;
          root: string;
        }>;
        list: (dirPath: string) => Promise<{
          ok: boolean;
          entries?: Array<{
            name: string;
            isDirectory: boolean;
            size: number;
            mtime: number;
            fullPath: string;
          }>;
          error?: string;
        }>;
        open: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
        reveal: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
        delete: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
        upload: (
          srcPath: string,
          destDir: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        mkdir: (
          parentDir: string,
          name: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        rename: (
          oldPath: string,
          newName: string,
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>;
        copy: (
          srcPath: string,
          destDir: string,
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>;
        move: (
          srcPath: string,
          destDir: string,
        ) => Promise<{ ok: boolean; newPath?: string; error?: string }>;
      };
      /**
       * Print + Save PDF. Используется в графике/Пробе и других печатных
       * разделах. dialog = системный print dialog. savePdf = printToPDF
       * + showSaveDialog. Возврат включает `canceled: true` если юзер
       * закрыл saveDialog без выбора файла.
       */
      print: {
        dialog: (
          defaultName?: string,
          opts?: { landscape?: boolean },
        ) => Promise<{ ok: boolean; error?: string }>;
        savePdf: (
          defaultName?: string,
          opts?: { landscape?: boolean },
        ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
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
      /**
       * §pyn-1.2.41 — native BrowserWindow visibility (minimize/hide/restore/
       * show/blur/focus → 'foreground' | 'background'). Renderer слушает чтобы
       * сразу слать heartbeat в правильном state — точнее чем web `blur`/`focus`.
       */
      onVisibilityChange: (
        handler: (state: 'foreground' | 'background') => void,
      ) => () => void;
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
