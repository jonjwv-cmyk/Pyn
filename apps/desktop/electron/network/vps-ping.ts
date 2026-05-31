import { BrowserWindow, session } from 'electron';
import { emitRtt } from '../ws/ws-client';
import { resolveMediaUrl } from './media-url';
import { getProxyState } from '../ipc/api-bridge';

/**
 * Periodic RTT-замер до VPS. Бьёт в nginx-only endpoint `/__ping` (см.
 * nginx конфиг на 45.12.239.5) — он отдаёт 200 OK напрямую, БЕЗ проксирования
 * на Cloudflare Worker. Это значит ноль расхода CF дневного лимита.
 *
 * Маршрут запроса идёт через тот же `session.defaultSession.fetch` что и
 * остальной REST-трафик:
 *   • Дома (Mac/Win-home): host-resolver-rules → 45.12.239.5 напрямую, SPKI pin.
 *   • На работе (Win-corp): proxy detected в `setupApiBridge` → session
 *     настроена на CONNECT через корп-прокси → proxy → VPS → nginx.
 *
 * В обоих случаях измеряемый RTT отражает РЕАЛЬНЫЙ путь данных
 * приложения, что полезно для юзера. Через nginx ничего не логируется
 * (`access_log off`).
 *
 * Защита от перегрузок:
 *   • Pause когда окно свёрнуто/в фоне (BrowserWindow blur/restore).
 *   • Skip когда navigator.onLine == false (через app.online proxy, no-op
 *     на main-process: проверка делается через fetch fail → backoff).
 *   • Backoff при N подряд ошибках: интервал растёт до 60с, потом возврат
 *     к нормальному после первого успеха.
 */

const VPS_PING_URL = 'https://api.otlhelper.com/__ping';
const PING_INTERVAL_NORMAL_MS = 10_000;
const PING_INTERVAL_BACKOFF_MS = 60_000;
const PING_TIMEOUT_MS = 5_000;
const FAIL_THRESHOLD = 3;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let failureStreak = 0;
let paused = false;
let visibilityHooksInstalled = false;

async function tick(): Promise<void> {
  if (inFlight || paused) return;
  inFlight = true;
  const ctrl = new AbortController();
  const abortId = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    // §pyn-1.2.62 — proxy-aware: на корп-сети api.otlhelper.com резолвится корп-
    // DNS'ом на Cloudflare (не наш VPS) и /__ping там нет → стабильный fail
    // индикатора. resolveMediaUrl переписывает на sslip.io в proxy-режиме (там
    // nginx сам отдаёт /__ping). Дома — без изменений (host-resolver → VPS).
    const pingUrl = resolveMediaUrl(VPS_PING_URL, getProxyState());
    const res = await session.defaultSession.fetch(pingUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (!res.ok) {
      bumpFailure();
      return;
    }
    // Дочитываем body чтобы closure был чистый (TCP keep-alive).
    await res.arrayBuffer();
    const rttMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[pyn:vps-ping] rtt=${rttMs}ms`);
    emitRtt(rttMs);
    if (failureStreak > 0) {
      // Восстановились → возвращаем нормальный интервал.
      failureStreak = 0;
      reschedule(PING_INTERVAL_NORMAL_MS);
    }
  } catch {
    bumpFailure();
  } finally {
    clearTimeout(abortId);
    inFlight = false;
  }
}

function bumpFailure(): void {
  failureStreak += 1;
  if (failureStreak === FAIL_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.log(`[pyn:vps-ping] ${FAIL_THRESHOLD} failures, backoff to ${PING_INTERVAL_BACKOFF_MS}ms`);
    reschedule(PING_INTERVAL_BACKOFF_MS);
  }
}

function reschedule(intervalMs: number): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), intervalMs);
}

/**
 * Pause при minimize / restore при show. Окно в фоне — нет смысла обновлять
 * UI-индикатор, который юзер не видит. Экономит трафик / CPU на батарее.
 */
function installVisibilityHooks(): void {
  if (visibilityHooksInstalled) return;
  visibilityHooksInstalled = true;
  const apply = (win: BrowserWindow): void => {
    const checkVisibility = (): void => {
      const wasPaused = paused;
      paused = win.isMinimized() || !win.isVisible();
      if (wasPaused && !paused) {
        // Только что снова стало видимо — немедленный tick для свежего RTT.
        void tick();
      }
    };
    win.on('minimize', checkVisibility);
    win.on('restore', checkVisibility);
    win.on('show', checkVisibility);
    win.on('hide', checkVisibility);
    checkVisibility();
  };
  for (const win of BrowserWindow.getAllWindows()) apply(win);
  // Новые окна (если будут создаваться позже) — тоже подхватываем.
  // app.on('browser-window-created') — но в этом проекте окно одно,
  // и оно создаётся ДО startVpsPing(). Так что hook-ом на существующие хватает.
}

/** Запускает periodic ping. Идемпотентно — повторный вызов no-op. */
export function startVpsPing(): void {
  if (timer) return;
  // eslint-disable-next-line no-console
  console.log(`[pyn:vps-ping] starting (interval=${PING_INTERVAL_NORMAL_MS}ms)`);
  installVisibilityHooks();
  // Первый ping — немедленно, чтобы индикатор не ждал 10 сек на старте.
  void tick();
  timer = setInterval(() => void tick(), PING_INTERVAL_NORMAL_MS);
}

/** Останавливает periodic ping. Вызывается на app quit / logout. */
export function stopVpsPing(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
