/**
 * Стандартные коды ошибок, которые сервер OTLHelper2 возвращает в
 * `envelope.error`. Этот список — для удобной проверки в catch-блоках:
 *
 *   try { ... } catch (e) {
 *     if (e instanceof ApiError && e.code === ERROR_CODES.UNAUTHORIZED) { logout(); }
 *   }
 *
 * Любой неизвестный код тоже бросается через ApiError — поле `code` сохраняется
 * как есть, чтобы UI мог показать raw error.
 */
export const ERROR_CODES = {
  /** 401 / token revoked / not logged in. */
  UNAUTHORIZED: 'unauthorized',
  /** Request signature timestamp вне 30s окна — clock skew. */
  REQUEST_EXPIRED: 'request_expired',
  /** HMAC sig не сходится — wrong token / corrupted body. */
  INVALID_REQUEST_SIGNATURE: 'invalid_request_signature',
  /** E2E encryption обязательна, мы прислали plaintext. */
  CRYPTO_REQUIRED: 'crypto_required',
  /** Транспорт упал до получения envelope'a (offline / DNS / TLS). */
  NETWORK: 'network',
  /** Таймаут на стороне клиента. */
  TIMEOUT: 'timeout',
  /** Server вернул response не в форме envelope'a. */
  INVALID_ENVELOPE: 'invalid_envelope',
  /** Desktop role forbidden / wrong platform / binary tampered. */
  DESKTOP_ROLE_FORBIDDEN: 'desktop_role_forbidden',
  BINARY_TAMPERED: 'binary_tampered',
} as const;

export type ApiErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | string;

/**
 * Кидается из ApiClient.call() при любой не-успешной ситуации:
 *   • envelope.ok === false → code = envelope.error
 *   • transport/network ошибка → code = 'network'
 *   • не-envelope ответ → code = 'invalid_envelope'
 *
 * `details` — оригинальный payload или nested error для debugging.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details: unknown = undefined) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}
