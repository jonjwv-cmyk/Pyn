// Pure CommonJS preload — пишется руками, минуя vite-plugin-electron
// (он упорно бандлит ESM-обёртку даже с format:'cjs', что ломает Electron sandbox).
// Файл копируется vite-плагином в dist-electron/preload.cjs при старте.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
   * DEV-ONLY: сетевой маршрут VPS ↔ прямой Cloudflare. Только для разработки на Mac
   * (VPS отпал). В упакованном проде смена игнорируется (allowed=false), всегда VPS.
   */
  devApiMode: {
    get: function pynDevApiModeGet() {
      return ipcRenderer.invoke('pyn:dev:get-api-mode');
    },
    set: function pynDevApiModeSet(mode) {
      return ipcRenderer.invoke('pyn:dev:set-api-mode', mode);
    },
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
  /** Снэпшот складов («Цеха»-база) — тот же путь что mol.fetchSnapshot. */
  warehouses: {
    fetchSnapshot: function pynWarehousesFetchSnapshot(url, blobKeyB64, blobNonceB64) {
      return ipcRenderer.invoke('pyn:warehouses:fetch-snapshot', url, blobKeyB64, blobNonceB64);
    },
  },
  /** Снэпшот базы ПЕРСОН («Контакты») — тот же путь что warehouses.fetchSnapshot. */
  persons: {
    fetchSnapshot: function pynPersonsFetchSnapshot(url, blobKeyB64, blobNonceB64) {
      return ipcRenderer.invoke('pyn:persons:fetch-snapshot', url, blobKeyB64, blobNonceB64);
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
   * Погода для раздела «Карта»: радар осадков (RainViewer) + сводка (Open-Meteo),
   * всё через тайл-сессию/мост. Возвращает { ok, frame, weather }.
   */
  mapWeather: function pynMapWeather(lat, lng) {
    return ipcRenderer.invoke('pyn:map-weather', lat, lng);
  },
  mapWeatherField: function pynMapWeatherField(bounds) {
    return ipcRenderer.invoke('pyn:map-weather-field', bounds);
  },
  mapElevation: function pynMapElevation(lat, lng) {
    return ipcRenderer.invoke('pyn:map-elevation', lat, lng);
  },
  /**
   * ГЛОНАСС-мониторинг (кнопка «Глонасс» на карте). Главный процесс держит токен
   * и ходит к hosting.glonasssoft.ru через VPS-мост; renderer кредов не видит.
   */
  glonass: {
    vehicles: function pynGlonassVehicles() {
      return ipcRenderer.invoke('pyn:glonass-vehicles');
    },
    positions: function pynGlonassPositions(ids) {
      return ipcRenderer.invoke('pyn:glonass-positions', ids);
    },
    activity: function pynGlonassActivity(id, from, to) {
      return ipcRenderer.invoke('pyn:glonass-activity', id, from, to);
    },
    historyPoints: function pynGlonassHistoryPoints(id, from, to) {
      return ipcRenderer.invoke('pyn:glonass-history-points', id, from, to);
    },
    stats: function pynGlonassStats(ids, from, to) {
      return ipcRenderer.invoke('pyn:glonass-stats', ids, from, to);
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
    /**
     * §wave — main закрыл popup-окно Google Sign-In (открытое вместо
     * сломанного window.open() в webview, см. main.ts did-attach-webview).
     * Renderer (WaveScreen) перезагружает свой webview.
     */
    onPopupDone: function pynGoogleOnPopupDone(handler) {
      const wrapped = () => handler();
      ipcRenderer.on('pyn:google-popup-done', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:google-popup-done', wrapped);
      };
    },
    /** §wave — открыть OAuth URL в окне на persist:google-sheets. */
    openWaveAuth: function pynGoogleOpenWaveAuth(url) {
      return ipcRenderer.invoke('pyn:wave:open-auth', String(url || ''));
    },
  },
  /**
   * §wave — host (WaveScreen) ловит console-message из webview и зовёт
   * google.openWaveAuth. Здесь только alias для ясности.
   */
  wave: {
    openAuth: function pynWaveOpenAuth(url) {
      return ipcRenderer.invoke('pyn:wave:open-auth', String(url || ''));
    },
    /** BrowserWindow soundcloud.com на google-sheets partition (как Settings Google). */
    openLogin: function pynWaveOpenLogin() {
      return ipcRenderer.invoke('pyn:wave:open-login');
    },
    getGuestPreloadPath: function pynWaveGuestPreloadPath() {
      return ipcRenderer.invoke('pyn:wave:guest-preload-path');
    },
    /**
     * OAuth callback URL (id_token в hash) из main после Google Allow.
     * WaveScreen грузит его в <webview> (не main.loadURL — ломает guest).
     */
    onAuthCallback: function pynWaveOnAuthCallback(handler) {
      const wrapped = (_e, url) => {
        try {
          handler(String(url || ''));
        } catch {
          /* */
        }
      };
      ipcRenderer.on('pyn:wave-auth-callback', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:wave-auth-callback', wrapped);
      };
    },
  },
  /**
   * Google-bridge: renderer после get_client_config отдаёт {url,ticket} в main,
   * тот применяет PAC к partition Google-таблиц (если есть корп-прокси).
   */
  bridge: {
    configure: function pynBridgeConfigure(url, ticket) {
      return ipcRenderer.invoke('pyn:bridge:configure', String(url || ''), String(ticket || ''));
    },
  },
  /**
   * SAP-макрос: пишем VBS на диск (без BOM), spawn'им cscript /B,
   * читаем TSV-output, удаляем VBS и TSV. Windows-only — на Mac возвращает
   * `{ ok: false, error: 'platform_not_supported' }`.
   */
  macro: {
    runVbs: function pynMacroRunVbs(vbsSource, opts) {
      return ipcRenderer.invoke('pyn:macro:run-vbs', String(vbsSource || ''), opts || {});
    },
  },
  /**
   * Auto-update: скачать новый билд по URL и запустить установку.
   * Renderer уже определил что нужен update (через app_status endpoint в
   * @pyn/core) — main скачивает exe, прячет в %LOCALAPPDATA% и spawn'ит
   * установщик, после чего наш process exit'ит.
   */
  update: {
    /** Проверка кэша: вернёт {exists, localPath} если файл уже скачан. */
    checkCached: function pynUpdateCheckCached(url, version) {
      return ipcRenderer.invoke('pyn:update:check-cached', url, version);
    },
    /**
     * Скачать билд с прогрессом + SHA-256 verify (если expectedSha передан).
     * Возвращает {ok, localPath, sha, error}.
     */
    download: function pynUpdateDownload(url, version, expectedSha) {
      return ipcRenderer.invoke('pyn:update:download', url, version, expectedSha);
    },
    /** Запустить ранее скачанный installer. */
    install: function pynUpdateInstall(localPath) {
      return ipcRenderer.invoke('pyn:update:install', localPath);
    },
    onProgress: function pynUpdateOnProgress(handler) {
      const wrapped = (_evt, progress) => handler(progress);
      ipcRenderer.on('pyn:update:progress', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:update:progress', wrapped);
      };
    },
  },
  /**
   * Kill switch / app lock — wipe команда. Стирает userData (включая
   * cache/device_id.bin, session.bin) и relaunch'ит app как fresh install.
   * Триггерится сервером через WS event `app_control_state_changed` со state='wiping'.
   */
  appLock: {
    wipe: function pynAppLockWipe() {
      return ipcRenderer.invoke('pyn:app-lock:wipe');
    },
  },
  /**
   * webUtils.getPathForFile — Electron 33 заменил File.path. Используется в
   * Storage drag-drop: renderer берёт File из dataTransfer и достаёт
   * абсолютный fs path через эту функцию для последующего fs.upload.
   */
  webUtils: {
    getPathForFile: function pynWebUtilsGetPath(file) {
      return webUtils.getPathForFile(file);
    },
  },
  /**
   * Print + Save PDF. Используется в графике/Пробе: юзер кликает кнопку
   * Печать → popover с двумя действиями. dialog = системный print dialog,
   * savePdf = printToPDF + showSaveDialog с suggested filename.
   */
  print: {
    /**
     * «Печать» — генерит PDF и открывает в дефолтном системном вьюере,
     * чтобы юзер нажал Cmd+P внутри. Tmp-файл удаляется через 2 минуты.
     * @param defaultName — basename для tmp-файла (для удобства в titlebar
     *                     viewer'а). Без .pdf — добавляется автоматом.
     */
    dialog: function pynPrintDialog(defaultName, opts) {
      return ipcRenderer.invoke(
        'pyn:print:dialog',
        String(defaultName || 'document'),
        opts && typeof opts === 'object' ? opts : undefined,
      );
    },
    savePdf: function pynPrintSavePdf(defaultName, opts) {
      return ipcRenderer.invoke(
        'pyn:print:save-pdf',
        String(defaultName || 'document'),
        opts && typeof opts === 'object' ? opts : undefined,
      );
    },
  },
  /**
   * SMB-проводник для сетевой папки Экспедиция. Win-only (на Mac возвращает
   * platform_not_supported). Все операции под whitelist root'ом.
   */
  fs: {
    platform: function pynFsPlatform() {
      return ipcRenderer.invoke('pyn:fs:platform');
    },
    list: function pynFsList(dirPath) {
      return ipcRenderer.invoke('pyn:fs:list', dirPath);
    },
    open: function pynFsOpen(filePath) {
      return ipcRenderer.invoke('pyn:fs:open', filePath);
    },
    reveal: function pynFsReveal(filePath) {
      return ipcRenderer.invoke('pyn:fs:reveal', filePath);
    },
    delete: function pynFsDelete(targetPath) {
      return ipcRenderer.invoke('pyn:fs:delete', targetPath);
    },
    upload: function pynFsUpload(srcPath, destDir) {
      return ipcRenderer.invoke('pyn:fs:upload', srcPath, destDir);
    },
    mkdir: function pynFsMkdir(parentDir, name) {
      return ipcRenderer.invoke('pyn:fs:mkdir', parentDir, name);
    },
    rename: function pynFsRename(oldPath, newName) {
      return ipcRenderer.invoke('pyn:fs:rename', oldPath, newName);
    },
    copy: function pynFsCopy(srcPath, destDir) {
      return ipcRenderer.invoke('pyn:fs:copy', srcPath, destDir);
    },
    move: function pynFsMove(srcPath, destDir) {
      return ipcRenderer.invoke('pyn:fs:move', srcPath, destDir);
    },
  },
  /**
   * Tray menu actions. Custom React menu (rendered в отдельном tray
   * BrowserWindow) вызывает эти actions; main процесс отрабатывает поведение
   * над main окном / жизненным циклом приложения.
   */
  tray: {
    show: function pynTrayShow() {
      return ipcRenderer.invoke('pyn:tray:show');
    },
    openSettings: function pynTrayOpenSettings() {
      return ipcRenderer.invoke('pyn:tray:settings');
    },
    quit: function pynTrayQuit() {
      return ipcRenderer.invoke('pyn:tray:quit');
    },
    closeMenu: function pynTrayCloseMenu() {
      return ipcRenderer.invoke('pyn:tray:close-menu');
    },
    /** Подписка на событие 'open-settings' от tray bridge. */
    onOpenSettings: function pynTrayOnOpenSettings(handler) {
      const wrapped = () => handler();
      ipcRenderer.on('pyn:tray:open-settings', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:tray:open-settings', wrapped);
      };
    },
  },
  /**
   * §pyn-1.2.41 — native window visibility (minimize/hide/restore/show/blur/focus).
   * Renderer слушает чтобы сразу слать heartbeat при смене состояния — точнее
   * чем window.blur/focus, который не всегда срабатывает при minimize в taskbar.
   */
  onVisibilityChange: function pynOnVisibilityChange(handler) {
    const wrapped = (_evt, state) => handler(state);
    ipcRenderer.on('pyn:visibility', wrapped);
    return function unsubscribe() {
      ipcRenderer.removeListener('pyn:visibility', wrapped);
    };
  },
  /**
   * Активность пользователя: клавиши из main webContents (в т.ч. webview /
   * таблицы). Renderer слушает и двигает mood/фразы питомца.
   * { kind: 'key' | 'mouse', x?, y? }
   */
  onUserActivity: function pynOnUserActivity(handler) {
    const wrapped = (_evt, payload) => {
      try {
        handler(payload || {});
      } catch (_) {
        /* */
      }
    };
    ipcRenderer.on('pyn:user-activity', wrapped);
    return function unsubscribe() {
      ipcRenderer.removeListener('pyn:user-activity', wrapped);
    };
  },
  /** Always-on-top pet overlay (поверх всех приложений). */
  pet: {
    toggle: function pynPetToggle() {
      return ipcRenderer.invoke('pyn:pet:toggle');
    },
    show: function pynPetShow() {
      return ipcRenderer.invoke('pyn:pet:show');
    },
    hide: function pynPetHide() {
      return ipcRenderer.invoke('pyn:pet:hide');
    },
    isVisible: function pynPetIsVisible() {
      return ipcRenderer.invoke('pyn:pet:is-visible');
    },
    onVisible: function pynPetOnVisible(handler) {
      const wrapped = (_e, v) => handler(!!v);
      ipcRenderer.on('pyn:pet:visible', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:pet:visible', wrapped);
      };
    },
    /**
     * Проброс in-app активности (мышь) из окна Pyn в оверлей питомца.
     * Клавиши уже пробрасывает main через before-input-event. Fire-and-forget.
     */
    reportActivity: function pynPetReportActivity(payload) {
      ipcRenderer.send('pyn:pet:report-activity', payload && typeof payload === 'object' ? payload : {});
    },
    getBounds: function pynPetGetBounds() {
      return ipcRenderer.invoke('pyn:pet:get-bounds');
    },
    setBounds: function pynPetSetBounds(bounds) {
      return ipcRenderer.invoke('pyn:pet:set-bounds', bounds);
    },
    moveBy: function pynPetMoveBy(dx, dy) {
      return ipcRenderer.invoke('pyn:pet:move-by', dx, dy);
    },
    /** true = прозрачные зоны click-through (не блокируют скролл под окном). */
    setIgnoreMouse: function pynPetSetIgnoreMouse(ignore) {
      return ipcRenderer.invoke('pyn:pet:set-ignore-mouse', !!ignore);
    },
    /** idle | strip | full — размер окна под контент (якорь bottom-right). */
    setLayout: function pynPetSetLayout(mode) {
      return ipcRenderer.invoke('pyn:pet:set-layout', mode);
    },
    /** Разослать выбранный species в другие окна (settings → pet overlay). */
    broadcastSpecies: function pynPetBroadcastSpecies(species) {
      return ipcRenderer.invoke('pyn:pet:broadcast-species', species);
    },
    onSpecies: function pynPetOnSpecies(handler) {
      const wrapped = (_e, species) => handler(species);
      ipcRenderer.on('pyn:pet:species', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:pet:species', wrapped);
      };
    },
  },
  /** Music: engine в pet overlay; main Hi-Fi шлёт cmd / принимает state. */
  music: {
    cmd: function pynMusicCmd(cmd) {
      return ipcRenderer.invoke('pyn:music:cmd', cmd);
    },
    broadcastState: function pynMusicBroadcastState(state) {
      return ipcRenderer.invoke('pyn:music:state', state);
    },
    onCmd: function pynMusicOnCmd(handler) {
      const wrapped = (_e, cmd) => handler(cmd);
      ipcRenderer.on('pyn:music:cmd', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:music:cmd', wrapped);
      };
    },
    onState: function pynMusicOnState(handler) {
      const wrapped = (_e, state) => handler(state);
      ipcRenderer.on('pyn:music:state', wrapped);
      return function unsubscribe() {
        ipcRenderer.removeListener('pyn:music:state', wrapped);
      };
    },
  },
});
