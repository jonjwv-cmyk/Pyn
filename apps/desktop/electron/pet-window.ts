/**
 * Always-on-top pet overlay — поверх всех приложений (не внутри main window).
 * Прозрачное frameless окно, show/hide из сайдбара.
 * Позиция всегда clamp'ится в workArea доступных мониторов (мульти-монитор = одно виртуальное пространство;
 * отвалившийся дисплей → snap на primary).
 */
import { BrowserWindow, ipcMain, screen, app, type Rectangle, type Display } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setGlobalInputHandler,
  startGlobalInput,
  stopGlobalInput,
  hasInputPermission,
  openInputPermissionSettings,
  isGlobalInputRunning,
  getGlobalInputState,
} from './global-input';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let petWindow: BrowserWindow | null = null;
let visible = false;
let displayListenersBound = false;
/** Периодический retry Accessibility → uiohook (пока pet виден). */
let globalInputRetryTimer: ReturnType<typeof setInterval> | null = null;
let accessibilityPrompted = false;

/**
 * Размеры под контент (правый-нижний якорь).
 * Раньше 560×680 всегда → огромная прозрачная зона ловила клики/скролл.
 */
export type PetLayoutMode = 'idle' | 'strip' | 'full';
const PET_SIZES: Record<PetLayoutMode, { width: number; height: number }> = {
  idle: { width: 232, height: 300 },
  strip: { width: 248, height: 360 },
  full: { width: 560, height: 640 },
};
const W = PET_SIZES.idle.width;
const H = PET_SIZES.idle.height;
/** Минимальная видимая «якорь»-доля окна на каком-то мониторе (px). */
const MIN_ON_SCREEN = 48;

function loadPetUrl(win: BrowserWindow): void {
  // Dev: vite server; prod: file index.html
  const isDev = !app.isPackaged;
  if (isDev) {
    void win.loadURL('http://localhost:5173/#pet');
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'pet' });
  }
}

function pointInRect(px: number, py: number, r: Rectangle): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.width && py < r.y + r.height;
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = x2 - x1;
  const h = y2 - y1;
  return w > 0 && h > 0 ? w * h : 0;
}

/** Все workArea мониторов (без menu bar / dock). */
function allWorkAreas(): Rectangle[] {
  return screen.getAllDisplays().map((d) => d.workArea);
}

/**
 * Целевой монитор: тот, где центр окна / максимальное пересечение / primary.
 * Два экрана = одно пространство: drag переносит окно между ними, но не «в пустоту».
 */
function pickDisplayForBounds(bounds: Rectangle): Display {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return screen.getPrimaryDisplay();

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const byPoint = displays.find((d) => pointInRect(cx, cy, d.workArea));
  if (byPoint) return byPoint;

  let best: Display | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const a = intersectionArea(bounds, d.workArea);
    if (a > bestArea) {
      bestArea = a;
      best = d;
    }
  }
  if (best && bestArea >= MIN_ON_SCREEN * MIN_ON_SCREEN) return best;

  // Окно полностью вне всех экранов (дисплей отвалился) → primary
  return screen.getPrimaryDisplay();
}

/** Полностью уместить окно в workArea выбранного монитора. */
function clampToWorkArea(bounds: Rectangle, wa: Rectangle): Rectangle {
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  const maxX = wa.x + wa.width - width;
  const maxY = wa.y + wa.height - height;
  const x = Math.min(Math.max(bounds.x, wa.x), maxX);
  const y = Math.min(Math.max(bounds.y, wa.y), maxY);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function defaultPetBounds(): Rectangle {
  const wa = screen.getPrimaryDisplay().workArea;
  return clampToWorkArea(
    { x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16, width: W, height: H },
    wa,
  );
}

/** Окно всегда целиком на каком-то мониторе. */
function clampPetBounds(bounds: Rectangle): Rectangle {
  const display = pickDisplayForBounds(bounds);
  return clampToWorkArea(bounds, display.workArea);
}

function applyPetBounds(win: BrowserWindow, bounds: Rectangle): void {
  const next = clampPetBounds(bounds);
  const cur = win.getBounds();
  if (
    cur.x === next.x &&
    cur.y === next.y &&
    cur.width === next.width &&
    cur.height === next.height
  ) {
    return;
  }
  win.setBounds(next);
}

/** После display-removed / metrics: если окно «в воздухе» — на primary. */
function ensurePetOnScreen(): void {
  const win = getPetWindow();
  if (!win) return;
  const b = win.getBounds();
  const areas = allWorkAreas();
  const visibleArea = areas.reduce((sum, wa) => sum + intersectionArea(b, wa), 0);
  if (visibleArea < MIN_ON_SCREEN * MIN_ON_SCREEN) {
    applyPetBounds(win, defaultPetBounds());
    return;
  }
  applyPetBounds(win, b);
}

function bindDisplayListeners(): void {
  if (displayListenersBound) return;
  displayListenersBound = true;
  screen.on('display-removed', () => {
    ensurePetOnScreen();
  });
  screen.on('display-metrics-changed', () => {
    ensurePetOnScreen();
  });
  // display-added: clamp не обязателен, но позиция могла стать «краевой» — безопасно
  screen.on('display-added', () => {
    ensurePetOnScreen();
  });
}

export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;

  bindDisplayListeners();
  const pos = defaultPetBounds();

  petWindow = new BrowserWindow({
    width: pos.width,
    height: pos.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    // Над панелями ОС / full-screen (Mac)
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      additionalArguments: [`--pyn-app-version=${app.getVersion()}`, '--pyn-pet-overlay=1'],
    },
  });

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  try {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* win */
  }
  // По умолчанию click-through: прозрачные зоны не блокируют скролл/клики под окном.
  // Renderer включает hit-test только над [data-pet-hit].
  try {
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    /* */
  }

  loadPetUrl(petWindow);

  petWindow.on('closed', () => {
    petWindow = null;
    visible = false;
  });

  // Не гасим при blur — питомец живёт поверх других приложений
  return petWindow;
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null;
}

export function isPetVisible(): boolean {
  return visible && !!getPetWindow()?.isVisible();
}

function notifyGlobalInput(win: BrowserWindow, payload: { ok: boolean; reason?: string; running?: boolean }) {
  try {
    win.webContents.send('pyn:pet:global-input', payload);
  } catch {
    /* */
  }
}

/** Старт/ретрай system-wide input; статус → pet overlay. */
async function ensureGlobalInput(win: BrowserWindow): Promise<void> {
  setGlobalInputHandler((ev) => sendPetActivity(ev));
  if (isGlobalInputRunning()) {
    notifyGlobalInput(win, { ok: true, running: true });
    return;
  }
  // Mac: один раз показать системный prompt Accessibility
  if (process.platform === 'darwin' && !hasInputPermission() && !accessibilityPrompted) {
    accessibilityPrompted = true;
    try {
      openInputPermissionSettings();
    } catch {
      /* */
    }
  }
  const r = await startGlobalInput();
  if (!r.ok) {
    console.warn('[pyn:pet] global input not active:', r.reason);
    notifyGlobalInput(win, {
      ok: false,
      reason: r.reason ?? 'unknown',
      running: false,
    });
    return;
  }
  notifyGlobalInput(win, { ok: true, running: true });
}

function startGlobalInputRetryLoop(win: BrowserWindow): void {
  if (globalInputRetryTimer) return;
  globalInputRetryTimer = setInterval(() => {
    if (!visible) return;
    const w = getPetWindow();
    if (!w || w.isDestroyed()) return;
    if (isGlobalInputRunning()) {
      // уже ок — сообщим UI раз, если вдруг был false
      return;
    }
    void ensureGlobalInput(w);
  }, 12_000);
}

function stopGlobalInputRetryLoop(): void {
  if (globalInputRetryTimer) {
    clearInterval(globalInputRetryTimer);
    globalInputRetryTimer = null;
  }
}

export function showPetWindow(): void {
  const win = createPetWindow();
  ensurePetOnScreen();
  try {
    win.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    /* */
  }
  if (!win.isVisible()) win.showInactive(); // не красть фокус у текущего app
  visible = true;
  broadcastVisible(true);
  // Системные хуки: клава/мышь везде, пока питомец виден
  void ensureGlobalInput(win);
  startGlobalInputRetryLoop(win);
}

export function hidePetWindow(): void {
  const win = getPetWindow();
  if (win) win.hide();
  visible = false;
  broadcastVisible(false);
  stopGlobalInputRetryLoop();
  stopGlobalInput();
  setGlobalInputHandler(null);
}

export function togglePetWindow(): boolean {
  if (isPetVisible()) {
    hidePetWindow();
    return false;
  }
  showPetWindow();
  return true;
}

function broadcastVisible(v: boolean): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.send('pyn:pet:visible', v);
    } catch {
      /* */
    }
  }
}

/** Переслать user-activity в окно питомца (для mood). */
export function sendPetActivity(payload: object): void {
  const win = getPetWindow();
  if (!win) return;
  try {
    win.webContents.send('pyn:user-activity', payload);
  } catch {
    /* */
  }
}

export function setupPetBridge(): void {
  ipcMain.handle('pyn:pet:toggle', () => togglePetWindow());
  ipcMain.handle('pyn:pet:show', () => {
    showPetWindow();
    return true;
  });
  ipcMain.handle('pyn:pet:hide', () => {
    hidePetWindow();
    return false;
  });
  ipcMain.handle('pyn:pet:is-visible', () => isPetVisible());
  ipcMain.handle('pyn:pet:get-bounds', () => {
    const win = getPetWindow();
    return win ? win.getBounds() : null;
  });
  ipcMain.handle('pyn:pet:set-bounds', (_e, bounds: { x?: number; y?: number; width?: number; height?: number }) => {
    const win = getPetWindow();
    if (!win) return;
    const cur = win.getBounds();
    applyPetBounds(win, { ...cur, ...bounds });
  });
  /** Переместить окно на Δscreen (drag питомца) — с clamp по мониторам. */
  ipcMain.handle('pyn:pet:move-by', (_e, dx: number, dy: number) => {
    const win = getPetWindow();
    if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const b = win.getBounds();
    applyPetBounds(win, {
      x: Math.round(b.x + dx),
      y: Math.round(b.y + dy),
      width: b.width,
      height: b.height,
    });
  });
  /**
   * Click-through: ignore=true → события уходят «сквозь» окно (скролл других app).
   * forward:true → mousemove всё равно приходит в renderer для hit-test.
   */
  ipcMain.handle('pyn:pet:set-ignore-mouse', (_e, ignore: unknown) => {
    const win = getPetWindow();
    if (!win) return false;
    try {
      win.setIgnoreMouseEvents(!!ignore, { forward: true });
      return true;
    } catch {
      return false;
    }
  });
  /**
   * Подогнать окно под layout (idle/strip/full), якорь — правый-нижний угол.
   * Уменьшает невидимую «зону-призрак» вокруг питомца.
   */
  ipcMain.handle('pyn:pet:set-layout', (_e, mode: unknown) => {
    const win = getPetWindow();
    if (!win) return false;
    const key: PetLayoutMode =
      mode === 'full' || mode === 'strip' || mode === 'idle' ? mode : 'idle';
    const size = PET_SIZES[key];
    const b = win.getBounds();
    const next = {
      x: b.x + b.width - size.width,
      y: b.y + b.height - size.height,
      width: size.width,
      height: size.height,
    };
    applyPetBounds(win, next);
    return true;
  });
  /**
   * Main window выбрал питомца → разослать во все окна (pet overlay отдельный
   * BrowserWindow, свой zustand — без IPC не обновляется).
   */
  ipcMain.handle('pyn:pet:broadcast-species', (e, species: unknown) => {
    if (typeof species !== 'string' || !species) return false;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (w.webContents.id === e.sender.id) continue;
      try {
        w.webContents.send('pyn:pet:species', species);
      } catch {
        /* */
      }
    }
    return true;
  });
  ipcMain.handle('pyn:pet:global-input-status', () => {
    const st = getGlobalInputState();
    return {
      ok: st.running,
      permitted: st.permitted,
      running: st.running,
      platform: st.platform,
    };
  });
  ipcMain.handle('pyn:pet:open-accessibility', () => {
    openInputPermissionSettings();
    return true;
  });
  /** UI: «включил доступ» → немедленный retry хуков. */
  ipcMain.handle('pyn:pet:retry-global-input', async () => {
    const win = getPetWindow();
    if (!win || !visible) {
      return { ok: false, reason: 'pet_hidden' };
    }
    await ensureGlobalInput(win);
    return getGlobalInputState();
  });

  /**
   * Music bridge: engine живёт в pet overlay (свой zustand).
   * Main Hi-Fi шлёт cmd → pet; pet шлёт state → main UI.
   */
  ipcMain.handle('pyn:music:cmd', (_e, cmd: unknown) => {
    const win = getPetWindow();
    if (!win || win.isDestroyed()) return false;
    const c = String(cmd || '');
    if (!c) return false;
    try {
      win.webContents.send('pyn:music:cmd', c);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('pyn:music:state', (e, state: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (w.webContents.id === e.sender.id) continue;
      try {
        w.webContents.send('pyn:music:state', state);
      } catch {
        /* */
      }
    }
    return true;
  });

  bindDisplayListeners();
  // При quit — снять хуки
  app.on('will-quit', () => {
    stopGlobalInput();
  });
}
