import { app, BrowserWindow, Menu } from 'electron';
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

function createWindow(): void {
  const win = new BrowserWindow({
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

  win.once('ready-to-show', () => win.show());

  // Гарантированно ставим platform-attr на documentElement до того как
  // React начнёт рендерить — это позволяет CSS-правилам c селектором
  // `html[data-pyn-platform="win32"]` зарезервировать место под Win-controls.
  // preload-вариант ненадёжен: на некоторых билдах document уже не пустой.
  win.webContents.on('dom-ready', () => {
    void win.webContents.executeJavaScript(
      `document.documentElement.dataset.pynPlatform = ${JSON.stringify(process.platform)};`,
    );
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // Auto-open devtools только в dev режиме.
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
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

  createWindow();

  // Periodic VPS-ping (RTT для индикатора связи). Идёт в nginx-only endpoint
  // `/__ping`, не задевает Cloudflare Worker — ноль расхода CF дневного лимита.
  // После createWindow — чтобы installVisibilityHooks подцепил уже-созданное окно.
  startVpsPing();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopVpsPing();
  if (!isMac) app.quit();
});
