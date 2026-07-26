import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { createPetWindow, setupPetBridge, sendPetActivity } from './pet-window';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupMainLog } from './log';
import { setupApiBridge } from './ipc/api-bridge';
import { setupAppLockBridge } from './ipc/app-lock-bridge';
import { setupBlobBridge } from './ipc/blob-bridge';
import { setupCacheBridge } from './ipc/cache-bridge';
import { setupMapWeatherBridge } from './ipc/map-weather-bridge';
import { setupGlonassBridge } from './ipc/glonass-bridge';
import { setupFsBridge } from './ipc/fs-bridge';
import { setupPrintBridge } from './ipc/print-bridge';
import { setupGoogleBridge } from './ipc/google-bridge';
import { setupBridgeBridge } from './ipc/bridge-bridge';
import { setupMacroBridge } from './ipc/macro-bridge';
import { setupMolBridge } from './ipc/mol-bridge';
import { setupWarehousesBridge } from './ipc/warehouses-bridge';
import { setupPersonsBridge } from './ipc/persons-bridge';
import { setupTokenBridge } from './ipc/token-bridge';
import { setupTrayBridge } from './ipc/tray-bridge';
import { setupUpdateBridge } from './ipc/update-bridge';
import { setupWsBridge } from './ipc/ws-bridge';
import { startVpsPing, stopVpsPing } from './network/vps-ping';
import { registerMapTileScheme, setupMapTiles } from './network/map-tiles';
import { selfInstallIfNeeded } from './self-install';
import { unlinkSync } from 'node:fs';

// §v1.2.8 — main-process logs в файл (%APPDATA%\Pyn\logs\main-*.log на Win,
// ~/Library/Application Support/Pyn/logs/main-*.log на Mac). Раньше main
// stdout/stderr в production exe закрыты — диагностика любых проблем main
// процесса (network, IPC, webview events) невозможна без этого. Должно
// быть ДО любого `console.log` ниже, чтобы захватить.
setupMainLog();

// Stage 11: DNS override для Chromium net stack. ВСЕ хосты бэкенда → IP VPS (слепой релей),
// чтобы клиент НИКОГДА не ходил на Cloudflare напрямую (принцип юзера 2026-06-17 «всё через VPS»).
// `api` = action/ws/E2E; `cdn` = R2-блобы (раньше в direct-режиме уходил на CF — единственная утечка).
// Должно быть ДО `app.whenReady()` — Chromium init читает switch'и однократно. Пин обоих — tls.ts.
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP api.otlhelper.com 45.12.239.5,MAP cdn.otlhelper.com 45.12.239.5',
);

// Карта: схема `pyn-tile://` для спутника Google (тянется через VPS-релей в
// main, см. network/map-tiles.ts). Привилегированная регистрация — строго ДО
// app.whenReady() (Chromium читает реестр схем однократно при инициализации).
registerMapTileScheme();

// §fix-gray-gpu — раньше dev на macOS принудительно переводился в SwiftShader.
// На Electron 33 это может дать обратный эффект: renderer/React живые, но окно
// красит только backgroundColor BrowserWindow (пустой серый экран). Поэтому
// software-GPU оставлен как ручной fallback, а по умолчанию используем штатный
// compositor. Если старый GPU-crash вернётся, запустить можно с
// PYN_ELECTRON_SOFTWARE_GPU=1.
if (
  (process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'development')
  && process.env.PYN_ELECTRON_SOFTWARE_GPU === '1'
) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
}

// §revert v1.2.4 → v1.2.3 — `disable-features: UserAgentClientHint` оказался
// анти-pattern'ом. Реальный Chrome ВСЕГДА отправляет `Sec-CH-UA-*` headers;
// их полное отсутствие — для Google security ML маркер «UA подменён, hints
// глушены = не настоящий Chrome» → блок. До v1.2.4 (когда client hints
// доходили до Google как есть, с "Chromium" / "Not.A/Brand" brand'ами)
// embedded login и Sheets webview на Mac работали. Возвращаем дефолтное
// поведение Electron: hints отправляются, partition-level UA spoof остаётся
// в google-bridge.ts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server URL (когда running `pnpm dev`).
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';

/**
 * §pyn-1.2.54 — после успешного auto-update новый exe стартует с CLI-арг
 * `--remove-prev=<path>` (см. update-bridge.ts install). Здесь чистим
 * этот старый файл. Делаем с задержкой 5s, чтобы прежний процесс точно
 * успел отпустить лок и Касперский завершил scan'.
 */
function removePreviousExeIfRequested(): void {
  const arg = process.argv.find((a) => a.startsWith('--remove-prev='));
  if (!arg) return;
  const prevPath = arg.slice('--remove-prev='.length).replace(/^"|"$/g, '');
  if (!prevPath) return;
  // Same exe — никогда не удалять себя.
  if (
    path.normalize(prevPath).toLowerCase()
    === path.normalize(process.execPath).toLowerCase()
  ) {
    return;
  }
  setTimeout(() => {
    try {
      unlinkSync(prevPath);
      // eslint-disable-next-line no-console
      console.log(`[update] removed previous exe: ${prevPath}`);
    } catch (e) {
      // Локирован/уже удалён — не критично.
      // eslint-disable-next-line no-console
      console.warn('[update] failed to remove previous exe:', e);
    }
  }, 5000);
}

// Module-level state: main и tray menu окна, флаг quit и сам Tray.
// Pyn закрывается ТОЛЬКО через tray menu → quit; close X на main окне
// = hide в tray (см. mainWindow.on('close')).
let mainWindow: BrowserWindow | null = null;
let trayMenuWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/** Показать и поднять main-окно (запуск / second-instance / tray «Показать»). */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (isMac && app.dock) {
    try {
      app.dock.show();
    } catch {
      /* ignore */
    }
  }
}

// ── Single instance: второй клик по EXE → фокус уже запущенного ──────────
// До whenReady: иначе два процесса успеют подняться.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (!gotSingleInstanceLock) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
});

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    // Mac: hidden inset с traffic-lights смещёнными внутрь.
    // Win: title-bar overlay — нативные кнопки min/max/close в нашей тёмной
    // палитре, без файлового меню сверху. Электрон рисует только кнопки;
    // место под "drag region" поверх отдаём React'у.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac
      ? undefined
      : {
          color: '#1F1E1B',      // bg-surface (см. tailwind.config)
          symbolColor: '#E5E5E2', // text-primary
          height: 32,
        },
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    backgroundColor: '#1F1E1B',
    // show:false + ready-to-show — без flash; страховка did-finish-load.
    show: false,
    webPreferences: {
      // .cjs — preload собран как CommonJS (см. vite.config.ts).
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox остаётся включённым (default) — CJS preload работает в любом
      // sandbox state, в отличие от ESM, который требует sandbox:false.
      // additionalArguments — преcomputed-значения, доступные preload'у через
      // process.argv. Альтернатива IPC round-trip'у для статических данных
      // (sandbox blocks process.env / fs).
      additionalArguments: [`--pyn-app-version=${app.getVersion()}`],
      // Включаем <webview> tag для embedded Google Sheets (раздел «Таблицы»).
      // Изолированный partition + masking inject в renderer'е.
      webviewTag: true,
    },
  });

  // Запуск с рабочего стола → окно сразу, не только tray.
  mainWindow.once('ready-to-show', () => showMainWindow());
  mainWindow.webContents.once('did-finish-load', () => {
    // Если ready-to-show уже прошёл / не сработал — всё равно показать.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showMainWindow();
    }
  });

  // Питомец: клавиши из main + webview → pet overlay mood/фразы.
  const forwardKeyActivity = (contents: Electron.WebContents) => {
    contents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Meta' || input.key === 'Control' || input.key === 'Alt' || input.key === 'Shift') {
        return;
      }
      const payload = { kind: 'key' as const };
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('pyn:user-activity', payload);
        } catch {
          /* */
        }
      }
      sendPetActivity(payload);
    });
  };
  forwardKeyActivity(mainWindow.webContents);
  mainWindow.webContents.on('did-attach-webview', (_e, guest) => {
    forwardKeyActivity(guest);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // eslint-disable-next-line no-console
    console.log(`[render:console:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    // eslint-disable-next-line no-console
    console.warn(`[render:did-fail-load] ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // eslint-disable-next-line no-console
    console.error(`[render:process-gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.on('unresponsive', () => {
    // eslint-disable-next-line no-console
    console.warn('[main-window] unresponsive');
  });

  // §pyn-1.2.15 — close (X на title-bar) минимизирует в tray, не quit.
  // Полностью закрыть Pyn можно только через tray menu → «Выйти». Это
  // мешает случайному закрытию когда юзер ожидает что приложение работает
  // в фоне (WS connection, push notifications, kill switch listener).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // §pyn-1.2.41 — native visibility events. window.blur/focus в renderer
  // не всегда срабатывает при minimize в taskbar (Win-Chromium quirk),
  // плюс при hide-в-tray webContents не получает blur (окно «уничтожено»
  // визуально, но фоновый процесс жив). Слушаем native BrowserWindow events
  // и эмитим IPC `pyn:visibility` { state: 'foreground' | 'background' }
  // → renderer триггерит heartbeat сразу + presence_change на сервере
  // broadcast'ится ≤200ms.
  const emitVisibility = (state: 'foreground' | 'background') => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('pyn:visibility', state);
  };
  mainWindow.on('minimize', () => emitVisibility('background'));
  mainWindow.on('hide', () => emitVisibility('background'));
  // §pyn-1.2.71 — источник правды «Pyn фронтмост» = app-level активация ОС,
  // НЕ фокус окна. Когда юзер кликает во встроенный <webview> (Google-лист в
  // «Таблицах»), фокус уходит в отдельный процесс webview-гостя: BrowserWindow
  // ловит 'blur', mainWindow.isFocused()===false, focusedWin===null, гость не
  // focused, activeElement===WEBVIEW — РОВНО как при реальном уходе из Pyn.
  // Ни один из этих сигналов их не различает (проверено логом). Различает только
  // активация приложения: did-resign-active НЕ срабатывает при клике в webview,
  // но срабатывает при alt-tab в другое приложение. Фикс 1.2.67 закрыл лишь
  // renderer-путь (window blur), а этот main-путь сбрасывал presence в жёлтый.
  // На Win/Linux did-*-active не эмитятся → appActive остаётся true → main-blur
  // не трогает presence (уход в фон там ловят renderer window-blur + minimize/hide).
  if (isMac) {
    // macOS: app-level активация — чистый признак «Pyn фронтмост», иммунный к
    // фокусу webview. Клик в Google-лист её НЕ снимает, alt-tab в другое
    // приложение — снимает.
    app.on('did-become-active', () => emitVisibility('foreground'));
    app.on('did-resign-active', () => emitVisibility('background'));
  } else {
    // Win/Linux: did-*-active не эмитятся → судим по фокусу окна. Клик в
    // webview окно ОС не теряет (isFocused===true → не уход в фон), реальный
    // уход (alt-tab) теряет (isFocused===false). minimize/hide ловятся ниже.
    mainWindow.on('blur', () => {
      if (mainWindow?.isFocused()) return;
      emitVisibility('background');
    });
  }
  mainWindow.on('restore', () => emitVisibility('foreground'));
  mainWindow.on('show', () => emitVisibility('foreground'));
  mainWindow.on('focus', () => emitVisibility('foreground'));

  // Гарантированно ставим platform-attr на documentElement до того как
  // React начнёт рендерить — это позволяет CSS-правилам c селектором
  // `html[data-pyn-platform="win32"]` зарезервировать место под Win-controls.
  // preload-вариант ненадёжен: на некоторых билдах document уже не пустой.
  mainWindow.webContents.on('dom-ready', () => {
    void mainWindow?.webContents.executeJavaScript(
      `document.documentElement.dataset.pynPlatform = ${JSON.stringify(process.platform)};`,
    );
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // Auto-open devtools только в dev режиме.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function createTrayMenuWindow(): void {
  trayMenuWindow = new BrowserWindow({
    // §pyn-1.2.30 — высоту уменьшил с 124 до 118 (юзер заметил больше воздуха
    // снизу чем сверху). 3 items × h-8 = 96 + gap-0.5 × 2 = 4 + p-1 × 2 = 8 →
    // 108px content; 118 окно даёт по 5px сверху/снизу, симметрично.
    width: 220,
    height: 118,
    show: false,
    frame: false,
    transparent: true,
    // §pyn-1.2.34 — backgroundMaterial убран окончательно. На Win 11 он
    // рисовал системный acrylic-фон в square области ВСЕГО окна → виден
    // square под нашим rounded блоком. Без него + transparent: true + CSS
    // rounded-2xl на корневом div дают чистую rounded форму (как ChatGPT).
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    // §pyn-1.2.34 — hasShadow: false. native Win shadow рисует rectangular
    // shadow вокруг square окна → визуально проявляется «системная подложка
    // под нашим rounded блоком» (юзер сравнил с ChatGPT — там shadow только
    // вокруг скруглённой формы). Чистый transparent + CSS shadow на rounded
    // div даёт корректный визуал.
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--pyn-app-version=${app.getVersion()}`],
    },
  });

  // Hash `#tray` — main.tsx распознаёт и рендерит TrayMenu вместо App.
  if (VITE_DEV_SERVER_URL) {
    trayMenuWindow.loadURL(`${VITE_DEV_SERVER_URL}#tray`);
  } else {
    trayMenuWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'tray' });
  }

  // Закрываем menu при потере фокуса (click вне окна).
  // lastBlurAt тайм-стэмп — toggleTrayMenu ниже фильтрует случай когда blur
  // случился из-за click'а по самой tray icon (иначе menu re-open'илась бы).
  trayMenuWindow.on('blur', () => {
    lastBlurAt = Date.now();
    trayMenuWindow?.hide();
  });
}

let lastBlurAt = 0;

function toggleTrayMenu(): void {
  if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
  // Если blur случился <150ms назад — значит юзер кликнул по tray icon с
  // открытым menu, и blur уже спрятал window. Click handler fires второй —
  // НЕ показываем заново (это нормальный toggle off).
  if (Date.now() - lastBlurAt < 150) {
    lastBlurAt = 0;
    return;
  }
  if (trayMenuWindow.isVisible()) {
    trayMenuWindow.hide();
  } else {
    showTrayMenuAtCursor();
  }
}

function showTrayMenuAtCursor(): void {
  if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
  // Positioning: используем bounds tray icon (если есть) или дефолтные
  // координаты внизу справа для Win (где tray traybar).
  const trayBounds = tray?.getBounds();
  const menuWidth = 220;
  const menuHeight = 118;
  let x = 100;
  let y = 100;
  if (trayBounds && trayBounds.width > 0) {
    // Tray icon позиция (правый нижний угол на Win, top на Mac).
    // Меню над/слева от иконки.
    if (isMac) {
      x = Math.round(trayBounds.x + trayBounds.width / 2 - menuWidth / 2);
      y = Math.round(trayBounds.y + trayBounds.height + 4);
    } else {
      x = Math.round(trayBounds.x + trayBounds.width / 2 - menuWidth / 2);
      y = Math.round(trayBounds.y - menuHeight - 4);
    }
  }
  trayMenuWindow.setBounds({ x: Math.max(0, x), y: Math.max(0, y), width: menuWidth, height: menuHeight });
  trayMenuWindow.show();
  trayMenuWindow.focus();
}

function setupTray(): void {
  // Tray icon: используем icon-source.png (1024x1024) и resize'им до menubar
  // размера. Electron автоматически использует @2x для Retina. icon.icns/.ico
  // генерируются ImageMagick'ом при build (см. scripts/build-icons.mjs) но не
  // коммитятся; для dev / fallback берём source PNG напрямую.
  const sourceIconPath = path.join(__dirname, '../build/icon-source.png');
  const fullImage = nativeImage.createFromPath(sourceIconPath);
  // Mac menubar height = 22pt → 22x22 logical (44x44 @2x).
  // Win tray = 16x16 logical (32x32 @2x на high-DPI).
  const traySize = isMac ? 22 : 16;
  const trayImage = fullImage.resize({ width: traySize, height: traySize });
  tray = new Tray(trayImage);
  tray.setToolTip('Pyn');

  // §pyn-1.2.15 — left и right click оба toggle'ят menu.
  // Click когда menu visible → menu прячется (через blur'ом → hide).
  // Без timer-guard повторный click заново показал бы menu (race: blur fires,
  // потом click handler → show). Lastblur timestamp фильтрует это.
  tray.on('click', toggleTrayMenu);
  tray.on('right-click', toggleTrayMenu);
}

app.whenReady().then(async () => {
  // Второй экземпляр уже ушёл в quit — не поднимаем окна.
  if (!gotSingleInstanceLock) return;

  // Убираем дефолтное Electron-меню (File/Edit/View/Window/Help) — у Pyn
  // свой UI, native menu только засоряет окно. Стандартные shortcut'ы
  // (Ctrl+C / V / X / Z / A / W / Q) работают через `Edit`/`Window`-роли
  // даже без видимого меню — Chromium всегда обрабатывает их.
  Menu.setApplicationMenu(null);

  // §pyn-1.2.43 — Mac dock icon. В production electron-builder embed'ит
  // .icns в bundle и dock берёт оттуда автоматически. В dev (`pnpm dev`)
  // Electron показывает дефолтный icon — переопределяем вручную чтобы
  // юзер видел Pyn-brand даже при разработке.
  if (process.platform === 'darwin' && app.dock) {
    try {
      const iconPath = path.join(__dirname, '..', 'build', 'icon-source.png');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock.setIcon(img);
    } catch (err) {
      console.warn('[pyn:dock] setIcon failed:', err);
    }
  }

  // Network: detect proxy → configure session → register IPC handler.
  // Делаем до createWindow чтобы первый renderer fetch уже видел готовый bridge.
  await setupApiBridge();
  // Карта: обработчик схемы `pyn-tile://` + тайл-сессия (после detectProxy —
  // прокси уже известен; мост перенастроит сессию позже через configureBridge).
  setupMapTiles();
  // Persistent session storage через safeStorage. После whenReady — safeStorage
  // готов (требует app ready event).
  setupTokenBridge();
  // WS клиент для real-time events (new_message, new_news, presence_change, ...).
  // Renderer триггерит start/stop через IPC после login/logout.
  setupWsBridge();
  // Fetch зашифрованных blob'ов (аватары + attachments) через main process —
  // обходим CORS, который блочит renderer fetch к `sslip.io`.
  setupBlobBridge();
  // Stale-while-revalidate cache в `userData/cache/<name>.bin` (safeStorage).
  // Zustand persist в renderer'е использует pyn:cache:* IPC handlers.
  setupCacheBridge();
  // Погода для карты (радар RainViewer + сводка Open-Meteo) через тайл-сессию.
  setupMapWeatherBridge();
  // ГЛОНАСС-мониторинг транспорта (кнопка «Глонасс» на карте) через тот же мост.
  setupGlonassBridge();
  // МОЛ snapshot download: fetch encrypted R2 blob → AES decrypt → gunzip →
  // отдать renderer'у plain JSON. Save/load базы — через pyn:cache:* (имя
  // 'mol-base').
  setupMolBridge();
  // Снэпшот складов («Цеха»-база) — тот же механизм что МОЛ (R2 + AES + gunzip).
  setupWarehousesBridge();
  // Снэпшот базы ПЕРСОН («Контакты») — тот же механизм (R2 + AES + gunzip).
  setupPersonsBridge();
  setupGoogleBridge();
  // Google-bridge: PAC + локальный туннель webview Google-таблиц через VPS-релей
  // (применяется только при обнаруженном корп-прокси, по config.bridge из CF).
  setupBridgeBridge();
  // SAP-макросы: renderer получает VBS source через get_macro_bundle,
  // main process пишет на диск + spawn'ит cscript /B (Windows-only).
  setupMacroBridge();
  // Auto-update IPC: renderer определяет need-update через app_status endpoint,
  // main качает .exe / .dmg в %LOCALAPPDATA%\Pyn\updates\ и запускает install.
  setupUpdateBridge();
  // Kill switch / app lock: device-id store (UUID v4, persist через safeStorage) +
  // full userData wipe + relaunch. Триггерится сервером через WS event
  // `app_control_state_changed` со state='wiping'.
  setupAppLockBridge();

  // §pyn-1.2.16 — SMB-проводник для сетевой папки Экспедиция (Win-only).
  setupFsBridge();

  // Print + Save PDF — в Пробе/Графике юзер вызывает popover «Печать ▸»
  // с двумя действиями: системный print dialog или сохранить как PDF.
  setupPrintBridge();

  // Tray bridge — actions из React tray menu (show/settings/quit/close).
  setupTrayBridge({
    showMainWindow: () => {
      showMainWindow();
    },
    openSettings: () => {
      showMainWindow();
      // Renderer слушает событие через window.pyn.tray.onOpenSettings → открывает Settings overlay.
      mainWindow?.webContents.send('pyn:tray:open-settings');
    },
    quit: () => {
      isQuitting = true;
      trayMenuWindow?.destroy();
      mainWindow?.close();
      app.quit();
    },
    hideMenu: () => {
      trayMenuWindow?.hide();
    },
  });

  setupPetBridge();
  createMainWindow();
  createTrayMenuWindow();
  // Pet overlay создаём заранее (скрытый) — show по логину / toggle сайдбара.
  createPetWindow();
  setupTray();

  // §pyn-1.2.54 — если запущены с CLI-арг --remove-prev=<path> (новый
  // build стартует с этим арг'ом из update-bridge install), удаляем старый
  // exe. Задержка 5 сек чтобы прежний процесс успел release file-lock'и.
  removePreviousExeIfRequested();

  // Self-install: первый запуск с Downloads → copy exe в %APPDATA%\@pyn\desktop\app
  // + создать desktop shortcut. Если уже installed — no-op. Win-only.
  selfInstallIfNeeded();

  // Periodic VPS-ping (RTT для индикатора связи). Идёт в nginx-only endpoint
  // `/__ping`, не задевает Cloudflare Worker — ноль расхода CF дневного лимита.
  // После createMainWindow — чтобы installVisibilityHooks подцепил уже-созданное окно.
  startVpsPing();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.show();
  });
});

// §pyn-1.2.15 — не quit'аем когда все окна закрыты. Pyn живёт в tray
// (WS, push, kill switch listener). Quit только через tray → «Выйти».
app.on('window-all-closed', () => {
  // На Mac стандарт — приложение остаётся в dock. На Win с tray — то же самое.
  // Никаких stopVpsPing — мы продолжаем работать в background.
});

app.on('before-quit', () => {
  isQuitting = true;
  stopVpsPing();
});
