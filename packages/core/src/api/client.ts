import { computeRequestSig, decryptResponse, encryptRequest } from '../crypto';
import { ApiError, ERROR_CODES } from './errors';
import type { ApiCallOptions, ApiEnvelope, ApiTransport } from './transport';

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
 * Что НЕ делает:
 *   • Routing (direct vs proxy URL) — в transport (Electron main).
 *   • Token persistence — в `@pyn/core/auth/token` (stage 3).
 *   • Permission checks — в UI до вызова.
 */
/**
 * Глобальный hook, вызываемый при любом auth-failure error code'е от сервера
 * (`unauthorized`, `token_expired`, `token_revoked`, `session_expired_window`,
 * `desktop_kicked`, ...). App.tsx устанавливает его при mount → wipe session +
 * setSession(null), чтобы любой component'у не нужно было лично ловить эти
 * codes в каждом catch'е.
 */
export type AuthFailureHandler = (code: string) => void;

export class ApiClient {
  private token: string | null = null;
  private onAuthFailure: AuthFailureHandler | null = null;

  /**
   * §pyn-1.2.49 — appVersion отправляется как HTTP-header `X-Pyn-Version`
   * каждым request'ом. VPS nginx читает этот header в plaintext (он вне
   * E2E-конверта, как Authorization) и блокирует устаревшие клиенты на
   * edge'е до forward'а к CF — это экономит CF request count.
   * Body остаётся encrypted, никакая чувствительная информация не утекает.
   */
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

  /**
   * Устанавливает глобальный handler для auth-failure'ов. Вызывается каждый
   * раз когда сервер вернул код, относящийся к истечению/отзыву session'а.
   * Множественные вызовы — последний выигрывает (singleton-like).
   */
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
    // 1. Plaintext payload (с _auth_token если залогинены и action в body).
    const payload: Record<string, unknown> = { ...body, action };
    if (this.token !== null) {
      payload['_auth_token'] = `Bearer ${this.token}`;
    }
    const plaintext = ENCODER.encode(JSON.stringify(payload));

    // 2. HMAC sig (только если есть token — для публичных endpoints типа
    //    app_status подпись не нужна).
    const ts = Math.floor(Date.now() / 1000);
    const sig =
      this.token !== null ? computeRequestSig(this.token, ts, action, plaintext) : null;

    // 3. E2E encrypt request body.
    const { envelope, session } = encryptRequest(plaintext);

    // 4. Headers.
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-otl-crypto',
      'X-Request-Ts': String(ts),
      'X-OTL-Crypto': 'v1',
    };
    if (sig !== null) headers['X-Request-Sig'] = sig;
    if (this.appVersion) headers['X-Pyn-Version'] = this.appVersion;

    // 5. Transport (bytes → bytes).
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

    // 6. Decrypt response (same session — responseKey deriveнут из shared
    //    secret для этого request'a).
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

    // 7. Parse JSON envelope.
    //    OTL server возвращает FLAT envelope: `{ ok, error?, ...fields }`.
    //    Не `{ ok, data: {...} }` — fields лежат на верхнем уровне рядом с ok.
    //    Поэтому возвращаем весь объект как T, а не env.data.
    let env: { ok: boolean; error?: string; [k: string]: unknown };
    try {
      env = JSON.parse(DECODER.decode(plaintextResponse)) as typeof env;
    } catch (err) {
      throw new ApiError(ERROR_CODES.INVALID_ENVELOPE, 'Response not valid JSON', err);
    }

    // eslint-disable-next-line no-console
    console.log(`[pyn:api] ${action} → keys=${Object.keys(env).join(',')}`, env);
    // Дублируем в main-stdout через debug bridge (если есть).
    try {
      const dbg = (globalThis as { pyn?: { debugLog?: (t: string, m: string) => void } }).pyn;
      if (dbg?.debugLog) {
        const preview = JSON.stringify(env).slice(0, 800);
        dbg.debugLog('api', `${action} keys=[${Object.keys(env).join(',')}] preview=${preview}`);
      }
    } catch {
      /* ignore */
    }

    // 8. envelope.ok check.
    if (env.ok === false) {
      const code = env.error ?? 'unknown_error';
      // Auth-failure'ы пробрасываем в глобальный handler — он wipe'нет
      // session/cache и переведёт UI на LoginScreen. Делаем ДО throw, чтобы
      // ловящие catch'и в компонентах могли продолжать стандартное error UX
      // (тут уже не их забота восстанавливать auth).
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

/**
 * Список error code'ов от сервера, означающих что текущая session больше
 * не валидна — нужно logout + LoginScreen. Дублирует логику клиентского
 * `isAuthFailure` в App.tsx, но живёт в `@pyn/core` чтобы ApiClient мог
 * сам триггерить handler.
 */
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
