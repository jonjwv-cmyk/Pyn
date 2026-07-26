/**
 * Глобальные хуки клавиатуры/мыши (весь macOS/Win, не только окно Pyn).
 * Используется питомцем: mood typing/working + комплименты продуктивности.
 *
 * Mac: нужны права «Универсальный доступ» (System Settings → Privacy → Accessibility)
 * для Electron / Terminal (в dev) / Pyn.app (в prod). Без прав start() падает —
 * молча no-op, pet остаётся на in-app listeners.
 */
import { systemPreferences, shell } from 'electron';

type ActivityHandler = (ev: { kind: 'key' | 'mouse'; x?: number; y?: number }) => void;

let started = false;
let handler: ActivityHandler | null = null;
/** throttle mouse move → не засыпаем IPC */
let lastMouseEmit = 0;
const MOUSE_THROTTLE_MS = 80;

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

export async function startGlobalInput(): Promise<{ ok: boolean; reason?: string }> {
  if (started) return { ok: true };
  if (process.platform === 'darwin' && !hasInputPermission()) {
    console.warn('[pyn:global-input] no Accessibility permission');
    return { ok: false, reason: 'accessibility' };
  }

  try {
    // Dynamic import — native module; external в electron bundle
    const mod = await import('uiohook-napi');
    const { uIOhook, UiohookKey } = mod;

    uIOhook.on('keydown', (e) => {
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
    });

    uIOhook.on('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMouseEmit < MOUSE_THROTTLE_MS) return;
      lastMouseEmit = now;
      handler?.({ kind: 'mouse', x: e.x, y: e.y });
    });

    uIOhook.on('mousedown', () => {
      handler?.({ kind: 'mouse' });
    });

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void import('uiohook-napi').then((mod) => {
      try {
        mod.uIOhook.stop();
      } catch {
        /* */
      }
    });
  } catch {
    /* */
  }
  started = false;
  console.log('[pyn:global-input] stopped');
}
