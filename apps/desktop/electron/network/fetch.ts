import { session, type Session } from 'electron';
import type { ProxyConfig } from './proxy';

/**
 * Chrome 120 на Windows — стабильно whitelisted в корп-прокси.
 * Используется один UA на всех платформах: корп-прокси видит «Chrome 120»
 * и пропускает; реальная ОС определяется из других сигналов.
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * api.otlhelper.com — VPS через DNS override + TLS pin на VPS self-signed cert.
 * Без DNS override резолвится на Cloudflare → может не работать в Mac dev'е
 * до тех пор пока мы не реализуем custom DNS resolver в Electron.
 */
export const DIRECT_API_URL = 'https://api.otlhelper.com/api';
/**
 * 45-12-239-5.sslip.io — тот же VPS, но имя DNS-резолвится в IP 45.12.239.5
 * через публичный sslip.io. Системный truststore проверяет cert; pinning
 * не нужен. Работает и без proxy, и через корп-прокси.
 */
export const PROXY_API_URL = 'https://45-12-239-5.sslip.io/api';

/**
 * Stage 11: `api.otlhelper.com` через DNS override (host-resolver-rules в
 * main.ts) + TLS pin (setCertificateVerifyProc в tls.ts). Default route.
 * Если pin сломается / nginx vhost корэшит — fallback на sslip.io можно
 * сделать через флаг.
 */
export function pickApiUrl(_proxy: ProxyConfig | null): string {
  return DIRECT_API_URL;
}

const TIMEOUT_DIRECT_MS = 45_000;
const TIMEOUT_PROXY_MS = 90_000;

/**
 * Настраивает proxy для default session. Вызывается один раз на старте app,
 * после `detectProxy()`. Если proxy = null — direct.
 */
export async function configureSession(
  ses: Session,
  proxy: ProxyConfig | null,
): Promise<void> {
  await ses.setProxy({
    proxyRules: proxy ? `${proxy.host}:${proxy.port}` : 'direct://',
  });
}

export interface PostRawOptions {
  proxy: ProxyConfig | null;
  timeoutMs?: number;
}

/**
 * POST бинарных bytes через Electron `session.fetch`. Используется для E2E-
 * encrypted envelope'ов. Возвращает response body как Uint8Array. Если
 * HTTP status non-2xx — throws Error с текстом ответа (обычно ошибка
 * до того как payload расшифровался: 426 / 401 без crypto / 5xx).
 */
export async function postRaw(
  url: string,
  body: Uint8Array,
  customHeaders: Record<string, string>,
  opts: PostRawOptions,
): Promise<Uint8Array> {
  const defaultTimeout = opts.proxy ? TIMEOUT_PROXY_MS : TIMEOUT_DIRECT_MS;
  const timeoutMs = opts.timeoutMs ?? defaultTimeout;

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

  // eslint-disable-next-line no-console
  console.log(`[pyn:net] POST ${url} body=${body.length}B headers=${JSON.stringify(customHeaders)}`);

  try {
    // Electron 33 session.fetch иногда зависает с raw Uint8Array как body —
    // оборачиваем в Blob (ArrayBuffer view) с правильным Content-Type. Blob
    // даёт native streaming, response приходит сразу как должен.
    const bodyBlob = new Blob([body as BufferSource], {
      type: customHeaders['Content-Type'] ?? 'application/octet-stream',
    });
    const response = await session.defaultSession.fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'application/x-otl-crypto, application/json, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        ...customHeaders,
      },
      body: bodyBlob,
      signal: ctrl.signal,
    });

    // eslint-disable-next-line no-console
    console.log(`[pyn:net] ← ${response.status} ${response.statusText}`);

    // OTL-сервер всегда отвечает E2E-encrypted envelope'ом, даже при error-status
    // (429 / 401 / 403). Внутри envelope лежит `{ ok: false, error: "<code>" }` —
    // настоящий error code (типа `password_login_weekly_limit`). Поэтому НЕ
    // throw'аем на non-2xx — пропускаем bytes в ApiClient.decryptResponse, который
    // распарсит envelope и выдаст ApiError с конкретным кодом.
    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Hex-дамп первых 48 байт — для диагностики envelope layout (version, nonce/ephPub, ct).
    const dumpLen = Math.min(bytes.length, 48);
    let hex = '';
    for (let i = 0; i < dumpLen; i++) {
      hex += (bytes[i] ?? 0).toString(16).padStart(2, '0') + ' ';
    }
    // eslint-disable-next-line no-console
    console.log(
      `[pyn:net] response ${bytes.length}B (status ${response.status}) first ${dumpLen}B: ${hex.trim()}`,
    );
    return bytes;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[pyn:net] exception:`, err);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
