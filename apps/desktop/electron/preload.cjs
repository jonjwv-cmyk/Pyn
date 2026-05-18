// Pure CommonJS preload — пишется руками, минуя vite-plugin-electron
// (он упорно бандлит ESM-обёртку даже с format:'cjs', что ломает Electron sandbox).
// Файл копируется vite-плагином в dist-electron/preload.cjs при старте.

const { contextBridge, ipcRenderer } = require('electron');

// app.getVersion() недоступен в sandboxed preload'е (main экспонирует через
// additionalArguments, см. main.ts::createWindow). Парсим из process.argv —
// чисто синхронно, без IPC round-trip.
const APP_VERSION_ARG = '--pyn-app-version=';
const appVersion =
  process.argv.find((a) => a.startsWith(APP_VERSION_ARG))?.slice(APP_VERSION_ARG.length) ||
  '0.0.0';

// Ставим platform-attr на documentElement **до** того как React начнёт
// рендерить — это позволяет CSS использовать `html[data-platform="win32"]`
// для зарезервированного места под нативные Win-controls (titleBarOverlay).
try {
  document.documentElement.dataset.pynPlatform = process.platform;
} catch (_) {
  /* document может быть не готов в редких case'ах — игнорируем */
}

contextBridge.exposeInMainWorld('pyn', {
  platform: process.platform,
  /** Версия desktop-сборки из apps/desktop/package.json (через app.getVersion). */
  appVersion,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /**
   * POST бинарный E2E envelope на /api через main process.
   * Возвращает response bytes.
   */
  api: function pynApi(body, headers, opts) {
    return ipcRenderer.invoke('pyn:api', body, headers, opts);
  },
  /**
   * Debug log — отправить строку в main-process stdout (видна в /tmp/pyn-dev.log).
   * Fire-and-forget, без ответа.
   */
  debugLog: function pynDebugLog(tag, message) {
    ipcRenderer.send('pyn:debug-log', String(tag), String(message));
  },
  /**
   * Persistent session storage через Electron safeStorage (Mac Keychain /
   * Win DPAPI). Renderer общается только через IPC — файл хранится в main.
   */
  tokenStore: {
    load: function pynTokenLoad() {
      return ipcRenderer.invoke('pyn:token:load');
    },
    save: function pynTokenSave(session) {
      return ipcRenderer.invoke('pyn:token:save', session);
    },
    clear: function pynTokenClear() {
      return ipcRenderer.invoke('pyn:token:clear');
    },
  },
  /**
   * WebSocket client (real-time events). Connection живёт в main process.
   * Renderer триггерит start/stop по login/logout и подписывается на push'и.
   */
  ws: {
    start: function pynWsStart(login, token) {
      return ipcRenderer.invoke('pyn:ws:start', login, token);
    },
    stop: function pynWsStop() {
      return ipcRenderer.invoke('pyn:ws:stop');
    },
    send: function pynWsSend(payload) {
      return ipcRenderer.invoke('pyn:ws:send', payload);
    },
    onEvent: function pynWsOnEvent(handler) {
      const wrapped = (_evt, event) => handler(event);
      ipcRenderer.on('pyn:ws:event', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:ws:event', wrapped);
      };
    },
  },
  /**
   * Fetch зашифрованных blob'ов (аватары, attachments) через main process.
   * Обходит CORS-блок renderer fetch'а; возвращает Uint8Array.
   */
  blobFetch: function pynBlobFetch(url) {
    return ipcRenderer.invoke('pyn:blob:fetch', url);
  },
  /**
   * Скачать snapshot МОЛ (encrypted gzipped JSON в R2) → main расшифровывает
   * AES-256-GCM, gunzip'ает, возвращает plain JSON string. Renderer парсит
   * через @pyn/core::parseSnapshotJson и сохраняет в pyn:cache.
   */
  mol: {
    fetchSnapshot: function pynMolFetchSnapshot(url, blobKeyB64, blobNonceB64) {
      return ipcRenderer.invoke('pyn:mol:fetch-snapshot', url, blobKeyB64, blobNonceB64);
    },
  },
  /**
   * Encrypted cache (Zustand persist storage). Renderer пишет JSON-стрингу
   * по имени; main process encrypt'ит через safeStorage и кладёт в userData/cache/.
   */
  cache: {
    load: function pynCacheLoad(name) {
      return ipcRenderer.invoke('pyn:cache:load', name);
    },
    save: function pynCacheSave(name, value) {
      return ipcRenderer.invoke('pyn:cache:save', name, value);
    },
    clear: function pynCacheClear(name) {
      return ipcRenderer.invoke('pyn:cache:clear', name);
    },
    clearAll: function pynCacheClearAll() {
      return ipcRenderer.invoke('pyn:cache:clearAll');
    },
  },
  /**
   * Google account flow для embedded Google Sheets (раздел «Таблицы»).
   * Cookies хранятся в persist:google-sheets partition, общий с webview.
   */
  google: {
    openLogin: function pynGoogleOpenLogin() {
      return ipcRenderer.invoke('pyn:google:open-login');
    },
    checkStatus: function pynGoogleCheckStatus() {
      return ipcRenderer.invoke('pyn:google:check-status');
    },
    logout: function pynGoogleLogout() {
      return ipcRenderer.invoke('pyn:google:logout');
    },
  },
  /**
   * SAP-макрос: пишем VBS на диск (без BOM), spawn'им cscript /B,
   * читаем TSV-output, удаляем VBS и TSV. Windows-only — на Mac возвращает
   * `{ ok: false, error: 'platform_not_supported' }`.
   */
  macro: {
    runVbs: function pynMacroRunVbs(vbsSource) {
      return ipcRenderer.invoke('pyn:macro:run-vbs', String(vbsSource || ''));
    },
  },
  /**
   * Auto-update: скачать новый билд по URL и запустить установку.
   * Renderer уже определил что нужен update (через app_status endpoint в
   * @pyn/core) — main скачивает exe, прячет в %LOCALAPPDATA% и spawn'ит
   * установщик, после чего наш process exit'ит.
   */
  update: {
    downloadInstall: function pynUpdateDownloadInstall(url, version) {
      return ipcRenderer.invoke('pyn:update:download-install', url, version);
    },
    onProgress: function pynUpdateOnProgress(handler) {
      const wrapped = (_evt, progress) => handler(progress);
      ipcRenderer.on('pyn:update:progress', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:update:progress', wrapped);
      };
    },
  },
});
