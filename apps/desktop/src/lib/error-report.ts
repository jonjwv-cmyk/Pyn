// error-report.ts — отправка клиентских ошибок на сервер (мониторинг).
// window.onerror + unhandledrejection + явные репорты из flow-операций → client_error_log
// (D1 client_errors: версия+платформа+время+стек+контекст). Fire-and-forget, с дедупом,
// чтобы не заспамить при повторах. Сбой отправки сам по себе не репортим (не зацикливаемся).
import { clientErrorLog } from '@pyn/core';
import { api } from './api';

type PynWin = { pyn?: { appVersion?: string; platform?: string } };
const pyn = (): PynWin['pyn'] => (window as unknown as PynWin).pyn;
const appVersion = (): string => pyn()?.appVersion ?? '';
const platform = (): string => pyn()?.platform ?? 'web';

let installed = false;
const recent = new Map<string, number>(); // ключ→время последней отправки (дедуп 30с)

/** Отправить одну ошибку (не бросает дальше; дедуп одинаковых раз в 30с). */
export function reportClientError(
  kind: string,
  message: string,
  opts?: { stack?: string; context?: string },
): void {
  const msg = String(message ?? '').slice(0, 2000);
  if (!msg) return;
  const key = `${kind}|${msg}`;
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < 30000) return;
  recent.set(key, now);
  void clientErrorLog(api, {
    version: appVersion(),
    platform: platform(),
    kind,
    message: msg,
    stack: opts?.stack ? opts.stack.slice(0, 8000) : undefined,
    context: opts?.context ? opts.context.slice(0, 2000) : undefined,
  }).catch(() => undefined);
}

/** Повесить глобальные перехватчики (один раз, на старте рендерера). */
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    reportClientError('window.onerror', e.message || String(err ?? 'error'), {
      stack: err?.stack,
      context: `${e.filename}:${e.lineno}:${e.colno}`,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportClientError('unhandledrejection', r instanceof Error ? r.message : String(r), {
      stack: r instanceof Error ? r.stack : undefined,
    });
  });
}
