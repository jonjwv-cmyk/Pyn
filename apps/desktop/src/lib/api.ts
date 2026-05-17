import { ApiClient, type ApiTransport } from '@pyn/core';

/**
 * Singleton ApiClient для desktop'a.
 *
 * Transport — bridge через `window.pyn.api(...)`. IPC отвечает Uint8Array
 * (или ArrayBuffer / Buffer в зависимости от Electron version'a) — нормализуем
 * в Uint8Array перед отдачей в ApiClient.
 */
const transport: ApiTransport = async (body, headers, opts) => {
  if (!window.pyn || typeof window.pyn.api !== 'function') {
    throw new Error(
      'window.pyn.api недоступен — preload bridge не загружен. ' +
        'Перезапустите Electron (Cmd+Q затем pnpm dev:desktop).',
    );
  }
  // eslint-disable-next-line no-console
  console.log(`[pyn:api] → body=${body.length}B`, headers);
  try {
    const result = await window.pyn.api(
      body,
      headers,
      opts ? { timeoutMs: opts.timeoutMs } : undefined,
    );
    const bytes =
      result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBufferLike);
    // eslint-disable-next-line no-console
    console.log(`[pyn:api] ← ${bytes.length}B`);
    return bytes;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[pyn:api] failed:`, err);
    throw err;
  }
};

export const api = new ApiClient(transport);
