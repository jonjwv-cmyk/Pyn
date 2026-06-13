import type { ApiClient } from '../api/client';

/**
 * Клиентский репорт ошибок на сервер (мониторинг). Шлём необработанные ошибки и сбои
 * flow-операций; сервер пишет в D1 `client_errors` с версией клиента/платформой/временем.
 */
export interface ClientErrorReport {
  /** Версия клиента (app.getVersion / window.pyn.appVersion). */
  version: string;
  /** 'win32' | 'darwin' | 'android' | 'ios' | … */
  platform: string;
  /** Короткий разряд: 'window.onerror' | 'unhandledrejection' | 'flow_zmvl' | 'flow_import' | … */
  kind: string;
  message: string;
  stack?: string;
  /** Доп. контекст (url/действие/что делал юзер). */
  context?: string;
}

export interface ClientErrorRow {
  id: number;
  at: string;
  login: string;
  full_name: string;
  version: string;
  platform: string;
  kind: string;
  message: string;
  stack: string;
  context: string;
}

/** Отправить одну ошибку (fire-and-forget на стороне вызова; не бросаем дальше). */
export async function clientErrorLog(client: ApiClient, report: ClientErrorReport): Promise<void> {
  await client.call('client_error_log', { ...report });
}

/** Прочитать последние клиентские ошибки (admin, новые сверху). */
export async function clientErrorsGet(client: ApiClient, limit?: number): Promise<ClientErrorRow[]> {
  const wire = await client.call<{ errors?: ClientErrorRow[] }>(
    'client_errors_get',
    limit ? { limit } : {},
  );
  return Array.isArray(wire.errors) ? wire.errors : [];
}
