// Pure CommonJS preload — пишется руками, минуя vite-plugin-electron
// (он упорно бандлит ESM-обёртку даже с format:'cjs', что ломает Electron sandbox).
// Файл копируется vite-плагином в dist-electron/preload.cjs при старте.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pyn', {
  platform: process.platform,
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
});
