import { ipcMain, session } from 'electron';
import { detectProxy, type ProxyConfig } from '../network/proxy';
import { configureSession, pickApiUrl, postRaw } from '../network/fetch';
import { configureTls } from '../network/tls';
import { devModeAllowed, getApiMode, initApiMode, setApiMode, type ApiMode } from '../network/api-mode';

const CHANNEL = 'pyn:api';

let proxyState: ProxyConfig | null = null;

/**
 * Инициализация сетевого слоя + регистрация IPC handler'a.
 *
 *   • Детектит корпоративный прокси (Windows only).
 *   • Конфигурирует default session: proxy + TLS pinning (stub).
 *   • Регистрирует `pyn:api` IPC handler — принимает (bodyBytes, headers, opts),
 *     POST'ит binary E2E envelope, возвращает response bytes.
 *
 * Вызывается один раз на `app.whenReady()`.
 */
export async function setupApiBridge(): Promise<void> {
  proxyState = await detectProxy();
  // eslint-disable-next-line no-console
  console.log(`[pyn:bridge] proxy=${proxyState ? `${proxyState.host}:${proxyState.port}` : 'direct'}`);
  await configureSession(session.defaultSession, proxyState);
  await configureTls(session.defaultSession, proxyState);
  initApiMode(); // DEV-переключатель VPS/Cloud (в проде всегда VPS)

  // Прокидываем renderer console.log в main stdout — для диагностики.
  ipcMain.on('pyn:debug-log', (_evt, tag: string, message: string) => {
    // eslint-disable-next-line no-console
    console.log(`[render:${tag}] ${message}`);
  });

  // DEV-ONLY: чтение/смена сетевого маршрута (VPS ↔ прямой Cloudflare). В проде смена игнорируется.
  ipcMain.handle('pyn:dev:get-api-mode', () => ({ mode: getApiMode(), allowed: devModeAllowed() }));
  ipcMain.handle('pyn:dev:set-api-mode', (_evt, next: ApiMode) => ({ mode: setApiMode(next), allowed: devModeAllowed() }));

  ipcMain.handle(
    CHANNEL,
    async (
      _event,
      body: Uint8Array | ArrayBuffer,
      headers: Record<string, string>,
      opts?: { timeoutMs?: number },
    ): Promise<Uint8Array> => {
      // eslint-disable-next-line no-console
      console.log(
        `[pyn:ipc] received call: bodyType=${body?.constructor?.name ?? typeof body} ` +
          `bodyLen=${body && 'byteLength' in body ? body.byteLength : (body as Uint8Array)?.length ?? '?'} ` +
          `headers=${Object.keys(headers ?? {}).join(',')}`,
      );

      // IPC может прислать Uint8Array, ArrayBuffer или Buffer (Node) — нормализуем.
      const bytes: Uint8Array =
        body instanceof Uint8Array
          ? body
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(body as ArrayBufferLike);

      try {
        const url = pickApiUrl(proxyState);
        const result = await postRaw(url, bytes, headers, {
          proxy: proxyState,
          timeoutMs: opts?.timeoutMs,
        });
        return result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[pyn:ipc] handler error:`, err);
        throw err;
      }
    },
  );
}

/** Текущее состояние proxy detection — для UI/telemetry. */
export function getProxyState(): ProxyConfig | null {
  return proxyState;
}
