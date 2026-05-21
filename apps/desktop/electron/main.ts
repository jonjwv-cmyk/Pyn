import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupMainLog } from './log';
import { setupApiBridge } from './ipc/api-bridge';
import { setupAppLockBridge } from './ipc/app-lock-bridge';
import { setupBlobBridge } from './ipc/blob-bridge';
import { setupCacheBridge } from './ipc/cache-bridge';
import { setupGoogleBridge } from './ipc/google-bridge';
import { setupMacroBridge } from './ipc/macro-bridge';
import { setupMolBridge } from './ipc/mol-bridge';
import { setupTokenBridge } from './ipc/token-bridge';
import { setupTrayBridge } from './ipc/tray-bridge';
import { setupUpdateBridge } from './ipc/update-bridge';
import { setupWsBridge } from './ipc/ws-bridge';
import { startVpsPing, stopVpsPing } from './network/vps-ping';

// §v1.2.8 — main-process logs в файл (%APPDATA%\Pyn\logs\main-*.log на Win,
// ~/Library/Application Support/Pyn/logs/main-*.log на Mac). Раньше main
// stdout/stderr в production exe закрыты — диагностика любых проблем main
// процесса (network, IPC, webview events) невозможна без этого. Должно
// быть ДО любого `console.log` ниже, чтобы захватить.
setupMainLog();

// Stage 11: DNS override для Chromium net stack. `api.otlhelper.com` → IP VPS.
// Должно быть ДО `app.whenReady()` — Chromium init читает switch'и однократно.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP api.otlhelper.com 45.12.239.5');

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

// Module-level state: main и tray menu окна, флаг quit и сам Tray.
// Pyn закрывается ТОЛЬКО через tray menu → quit; close X на main окне
// = hide в tray (см. mainWindow.on('close')).
let mainWindow: BrowserWindow | null = null;
let trayMenuWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

  mainWindow.once('ready-to-show', () => mainWindow?.show());

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
    width: 240,
    height: 168,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
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
  trayMenuWindow.on('blur', () => {
    trayMenuWindow?.hide();
  });
}

function showTrayMenuAtCursor(): void {
  if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
  // Positioning: используем bounds tray icon (если есть) или дефолтные
  // координаты внизу справа для Win (где tray traybar).
  const trayBounds = tray?.getBounds();
  const menuWidth = 240;
  const menuHeight = 168;
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
  // Win: icon.ico содержит все размеры (включая 16x16 для tray).
  // Mac: icon.icns тоже работает, хотя оптимально template PNG (monochrome).
  const iconPath = isMac
    ? path.join(__dirname, '../build/icon.icns')
    : path.join(__dirname, '../build/icon.ico');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.setToolTip('Pyn');

  // Single-click — показать main window (Win/Mac default behaviour).
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  // Right-click → custom React menu (rounded, accent hover).
  tray.on('right-click', () => {
    showTrayMenuAtCursor();
  });
}

app.whenReady().then(async () => {
  // Убираем дефолтное Electron-меню (File/Edit/View/Window/Help) — у Pyn
  // свой UI, native menu только засоряет окно. Стандартные shortcut'ы
  // (Ctrl+C / V / X / Z / A / W / Q) работают через `Edit`/`Window`-роли
  // даже без видимого меню — Chromium всегда обрабатывает их.
  Menu.setApplicationMenu(null);

  // Network: detect proxy → configure session → register IPC handler.
  // Делаем до createWindow чтобы первый renderer fetch уже видел готовый bridge.
  await setupApiBridge();
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
  // МОЛ snapshot download: fetch encrypted R2 blob → AES decrypt → gunzip →
  // отдать renderer'у plain JSON. Save/load базы — через pyn:cache:* (имя
  // 'mol-base').
  setupMolBridge();
  setupGoogleBridge();
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

  // Tray bridge — actions из React tray menu (show/settings/quit/close).
  setupTrayBridge({
    showMainWindow: () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    },
    openSettings: () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      // Renderer слушает событие через window.pyn.tray.onOpenSettings → открывает Settings overlay.
      mainWindow.webContents.send('pyn:tray:open-settings');
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

  createMainWindow();
  createTrayMenuWindow();
  setupTray();

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
