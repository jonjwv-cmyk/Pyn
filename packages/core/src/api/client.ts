import { computeRequestSig, decryptResponse, encryptRequest } from '../crypto';
import { ApiError, ERROR_CODES } from './errors';
import type { ApiCallOptions, ApiTransport } from './transport';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Главный API entry-point.
 *
 *   const api = new ApiClient(transport);
 *   api.setToken('...');
 *   const result = await api.call<MeResponse>('me', {});
 *
 * Что делает ApiClient:
 *   1. Embed `_auth_token` (если есть) и `action` в JSON body.
 *   2. Compute HMAC sig над плейн body + timestamp (только если есть token).
 *   3. E2E encrypt body в binary envelope через X25519+AES-GCM.
 *   4. Зовёт transport(envelope, headers) — bytes in, bytes out.
 *   5. Decrypt response bytes → JSON envelope.
 *   6. Возвращает data или бросает ApiError.
 *
 * Coalesce + replay:
 *   Sig = hmac(token, ts + action + bodyHash). В одну секунду два одинаковых
 *   `*_get` (План+Транспорт keep-alive, оба зовут flow_deliveries_get) →
 *   server `replay_detected` → «Ошибка загрузки» и пустая таблица.
 *   • in-flight coalesce: параллельные одинаковые GET делят один Promise;
 *   • retry на replay_detected: новый ts → новая sig (до 3 попыток).
 */
export type AuthFailureHandler = (code: string) => void;

/** Чистые чтения: безопасно склеивать параллельные одинаковые вызовы. */
function isCoalesceableAction(action: string): boolean {
  return (
    action.endsWith('_get') ||
    action.endsWith('_list') ||
    action === 'me' ||
    action === 'app_status' ||
    action === 'board_ver' ||
    action === 'optimization_status'
  );
}

/** Стабильный ключ body без auth (токен не участвует — один на сессию). */
function coalesceKey(action: string, body: Record<string, unknown>): string {
  const { _auth_token: _t, action: _a, ...rest } = body as Record<string, unknown> & {
    _auth_token?: unknown;
    action?: unknown;
  };
  // Сортировка ключей — одинаковый payload в разном порядке = один ключ.
  const keys = Object.keys(rest).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = rest[k];
  return `${action}\0${JSON.stringify(norm)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ApiClient {
  private token: string | null = null;
  private onAuthFailure: AuthFailureHandler | null = null;
  /** action+body → in-flight Promise (только coalesceable GET). */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly transport: ApiTransport,
    private readonly appVersion?: string,
  ) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  setOnAuthFailure(handler: AuthFailureHandler | null): void {
    this.onAuthFailure = handler;
  }

  /**
   * Вызов action'a с типизированным результатом.
   * @throws ApiError при envelope.ok=false, transport error, или invalid response.
   */
  async call<T = unknown>(
    action: string,
    body: Record<string, unknown> = {},
    opts?: ApiCallOptions,
  ): Promise<T> {
    const key = isCoalesceableAction(action) ? coalesceKey(action, body) : null;
    if (key) {
      const existing = this.inFlight.get(key);
      if (existing) return existing as Promise<T>;
    }

    const run = (async (): Promise<T> => {
      let lastErr: unknown;
      // 1 + до 3 повторов при replay (новая секунда / jitter → новая sig).
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await this.callOnce<T>(action, body, opts);
        } catch (err) {
          lastErr = err;
          const isReplay =
            err instanceof ApiError &&
            (err.code === 'replay_detected' || err.message === 'replay_detected');
          if (!isReplay || attempt >= 3) throw err;
          // 50–180ms + attempt: не бить сервер пачкой с тем же ts.
          await sleep(50 + attempt * 45 + Math.floor(Math.random() * 40));
        }
      }
      throw lastErr;
    })();

    if (key) {
      this.inFlight.set(key, run);
      void run.finally(() => {
        if (this.inFlight.get(key) === run) this.inFlight.delete(key);
      });
    }
    return run;
  }

  /** Один сетевой round-trip (без coalesce/retry). */
  private async callOnce<T>(
    action: string,
    body: Record<string, unknown>,
    opts?: ApiCallOptions,
  ): Promise<T> {
    const payload: Record<string, unknown> = { ...body, action };
    if (this.token !== null) {
      payload['_auth_token'] = `Bearer ${this.token}`;
    }
    const plaintext = ENCODER.encode(JSON.stringify(payload));

    const ts = Math.floor(Date.now() / 1000);
    const sig =
      this.token !== null ? computeRequestSig(this.token, ts, action, plaintext) : null;

    const { envelope, session } = encryptRequest(plaintext);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-otl-crypto',
      'X-Request-Ts': String(ts),
      'X-OTL-Crypto': 'v1',
    };
    if (sig !== null) headers['X-Request-Sig'] = sig;
    if (this.appVersion) headers['X-Pyn-Version'] = this.appVersion;

    let responseBytes: Uint8Array;
    try {
      responseBytes = await this.transport(envelope, headers, opts);
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.NETWORK,
        err instanceof Error ? err.message : 'Network error',
        err,
      );
    }

    let plaintextResponse: Uint8Array;
    try {
      plaintextResponse = decryptResponse(responseBytes, session);
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.INVALID_ENVELOPE,
        err instanceof Error ? err.message : 'Failed to decrypt response',
        err,
      );
    }

    let env: { ok: boolean; error?: string; [k: string]: unknown };
    try {
      env = JSON.parse(DECODER.decode(plaintextResponse)) as typeof env;
    } catch (err) {
      throw new ApiError(ERROR_CODES.INVALID_ENVELOPE, 'Response not valid JSON', err);
    }

    // eslint-disable-next-line no-console
    console.log(`[pyn:api] ${action} → keys=${Object.keys(env).join(',')}`, env);
    try {
      const dbg = (globalThis as { pyn?: { debugLog?: (t: string, m: string) => void } }).pyn;
      if (dbg?.debugLog) {
        const preview = JSON.stringify(env).slice(0, 800);
        dbg.debugLog('api', `${action} keys=[${Object.keys(env).join(',')}] preview=${preview}`);
      }
    } catch {
      /* ignore */
    }

    if (env.ok === false) {
      const code = env.error ?? 'unknown_error';
      if (this.onAuthFailure !== null && isAuthFailureCode(code)) {
        try {
          this.onAuthFailure(code);
        } catch {
          /* handler не должен ломать API call'еру */
        }
      }
      throw new ApiError(code, code, env);
    }

    return env as unknown as T;
  }
}

const AUTH_FAILURE_CODES = new Set([
  'unauthorized',
  'token_revoked',
  'token_expired',
  'token_invalid',
  'session_expired_window',
  'session_not_found',
  'desktop_kicked',
  'user_inactive',
  'app_blocked',
]);

function isAuthFailureCode(code: string): boolean {
  return AUTH_FAILURE_CODES.has(code);
}
