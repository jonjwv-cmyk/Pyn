/**
 * Опции одного вызова ApiClient.call().
 */
export interface ApiCallOptions {
  /** Override таймаута call'a в мс (по умолчанию решает transport). */
  timeoutMs?: number;
  /** Abort signal — отменить запрос извне. */
  signal?: AbortSignal;
}

/**
 * Raw bytes-в-bytes транспорт. ApiClient pre-encrypt'ит request body и post-
 * decrypt'ит response — transport только шлёт байты по HTTP с правильными
 * headers (которые тоже формирует ApiClient).
 *
 *   • Desktop (Electron): IPC через `window.pyn.api(bytes, headers, opts)` →
 *     main process → session.fetch с proxy + Chrome UA + TLS pin.
 *   • Mobile (RN, потом): прямой fetch из RN runtime'a.
 *
 * Transport инжектится в ApiClient через DI — `@pyn/core` не знает о window /
 * Electron / RN, работает в любом окружении.
 */
export type ApiTransport = (
  body: Uint8Array,
  headers: Record<string, string>,
  opts?: ApiCallOptions,
) => Promise<Uint8Array>;

/**
 * Plaintext JSON envelope ответа сервера (после расшифровки).
 *   ok=false → есть `error` (string code).
 *   ok=true  → есть `data` (тип зависит от action).
 */
export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}
