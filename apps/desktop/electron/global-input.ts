/**
 * Глобальные хуки клавиатуры/мыши (весь macOS/Win, не только окно Pyn).
 * Используется питомцем: mood typing/working + комплименты продуктивности.
 *
 * Mac: нужны права «Универсальный доступ» (System Settings → Privacy → Accessibility)
 * для Electron / Terminal (в dev) / Pyn.app (в prod). Без прав start() падает —
 * молча no-op, pet остаётся на in-app listeners.
 *
 * Native: uiohook-napi — external (vite), staged в dist-electron/vendor/,
 * asarUnpack (OS не грузит .node из asar).
 */
import { systemPreferences, shell } from 'electron';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ActivityHandler = (ev: { kind: 'key' | 'mouse'; x?: number; y?: number }) => void;

type UiohookMod = {
  uIOhook: {
    on: (ev: string, cb: (...args: never[]) => void) => void;
    start: () => void;
    stop: () => void;
  };
  UiohookKey: Record<string, number>;
};

let started = false;
let handler: ActivityHandler | null = null;
/** throttle mouse move → не засыпаем IPC */
let lastMouseEmit = 0;
const MOUSE_THROTTLE_MS = 80;
/** cached module after first successful load */
let loaded: UiohookMod | null = null;

export function setGlobalInputHandler(h: ActivityHandler | null): void {
  handler = h;
}

export function isGlobalInputRunning(): boolean {
  return started;
}

export function getGlobalInputState(): {
  running: boolean;
  permitted: boolean;
  platform: string;
} {
  return {
    running: started,
    permitted: hasInputPermission(),
    platform: process.platform,
  };
}

/** macOS: есть ли Accessibility у текущего процесса. */
export function hasInputPermission(): boolean {
  if (process.platform !== 'darwin') return true;
  try {
    return systemPreferences.isTrustedAccessibilityClient(false);
  } catch {
    return false;
  }
}

/** Открыть настройки Accessibility (Mac). */
export function openInputPermissionSettings(): void {
  if (process.platform === 'darwin') {
    try {
      // Prompt + open settings
      systemPreferences.isTrustedAccessibilityClient(true);
      void shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
    } catch {
      /* */
    }
  }
}

/** Каталог main (dist-electron) — и в dev, и в packaged. */
function mainDir(): string {
  try {
    // CJS bundle от vite-plugin-electron обычно даёт __dirname
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = typeof __dirname !== 'undefined' ? __dirname : '';
    if (d) return d;
  } catch {
    /* */
  }
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * .node нельзя require из app.asar — electron-builder asarUnpack кладёт
 * копию в app.asar.unpacked/.
 */
function asarUnpacked(p: string): string {
  // OS cannot dlopen .node from inside app.asar
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

function vendorUiohookPath(): string {
  return asarUnpacked(join(mainDir(), 'vendor', 'uiohook-napi'));
}

function loadUiohook(): UiohookMod {
  if (loaded) return loaded;

  const vendor = vendorUiohookPath();
  if (existsSync(join(vendor, 'package.json'))) {
    const req = createRequire(join(vendor, 'package.json'));
    loaded = req(vendor) as UiohookMod;
    console.log('[pyn:global-input] loaded vendor uiohook-napi from', vendor);
    return loaded;
  }

  // Dev / unpackaged: resolve from node_modules (pnpm symlink ok here)
  const req = createRequire(join(mainDir(), 'package.json'));
  try {
    loaded = req('uiohook-napi') as UiohookMod;
    console.log('[pyn:global-input] loaded uiohook-napi from node_modules');
    return loaded;
  } catch {
    // last resort: dynamic import (may work in some packagers)
  }
  throw new Error(`uiohook-napi not found (vendor=${vendor})`);
}

export async function startGlobalInput(): Promise<{ ok: boolean; reason?: string }> {
  if (started) return { ok: true };
  // Win: global hooks need elevation / AV blocks → только in-app listeners (юзер 2026-07-26).
  if (process.platform === 'win32') {
    return { ok: false, reason: 'in_app_only' };
  }
  if (process.platform === 'darwin' && !hasInputPermission()) {
    console.warn('[pyn:global-input] no Accessibility permission');
    return { ok: false, reason: 'accessibility' };
  }

  try {
    const mod = loadUiohook();
    const { uIOhook, UiohookKey } = mod;

    uIOhook.on('keydown', ((e: { keycode: number }) => {
      const k = e.keycode;
      if (
        k === UiohookKey.Ctrl ||
        k === UiohookKey.CtrlRight ||
        k === UiohookKey.Alt ||
        k === UiohookKey.AltRight ||
        k === UiohookKey.Shift ||
        k === UiohookKey.ShiftRight ||
        k === UiohookKey.Meta ||
        k === UiohookKey.MetaRight
      ) {
        return;
      }
      handler?.({ kind: 'key' });
    }) as (...args: never[]) => void);

    uIOhook.on('mousemove', ((e: { x: number; y: number }) => {
      const now = Date.now();
      if (now - lastMouseEmit < MOUSE_THROTTLE_MS) return;
      lastMouseEmit = now;
      handler?.({ kind: 'mouse', x: e.x, y: e.y });
    }) as (...args: never[]) => void);

    uIOhook.on('mousedown', (() => {
      handler?.({ kind: 'mouse' });
    }) as (...args: never[]) => void);

    uIOhook.start();
    started = true;
    console.log('[pyn:global-input] started (system-wide)');
    return { ok: true };
  } catch (err) {
    console.warn('[pyn:global-input] start failed:', err);
    return { ok: false, reason: String(err).slice(0, 160) };
  }
}

export function stopGlobalInput(): void {
  if (!started) return;
  try {
    if (loaded) {
      loaded.uIOhook.stop();
    }
  } catch {
    /* */
  }
  started = false;
  console.log('[pyn:global-input] stopped');
}
