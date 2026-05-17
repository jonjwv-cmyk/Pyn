import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setupApiBridge } from './ipc/api-bridge';
import { setupBlobBridge } from './ipc/blob-bridge';
import { setupCacheBridge } from './ipc/cache-bridge';
import { setupTokenBridge } from './ipc/token-bridge';
import { setupWsBridge } from './ipc/ws-bridge';

// Stage 11: DNS override для Chromium net stack. `api.otlhelper.com` → IP VPS.
// Должно быть ДО `app.whenReady()` — Chromium init читает switch'и однократно.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP api.otlhelper.com 45.12.239.5');

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
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
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
    },
  });

  win.once('ready-to-show', () => win.show());

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // Auto-open devtools только в dev режиме.
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
