import { ApiClient, type ApiTransport } from '@pyn/core';

/**
 * ApiClient instance для Pyn mobile.
 *
 * Transport — простой fetch к `https://api.otlhelper.com/` (без VPS proxy,
 * Android-клиенты обычно не в корп-сети). Если в будущем нужно proxy-mode
 * (типа корп-телефон) — добавим аналог desktop'a resolveMediaUrl + DNS-override.
 *
 * Все API-вызовы зашифрованы E2E (X25519+AES-GCM), VPS видит только outer TLS.
 */

const API_URL = 'https://api.otlhelper.com/';

const transport: ApiTransport = async (body, headers, opts) => {
  const controller = new AbortController();
  const timeoutId = opts?.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : null;

  // Если caller предоставил свой signal — связываем с локальным.
  if (opts?.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      // RN fetch принимает Uint8Array как body, но DOM-types этого не знают.
      body: body as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 200) {
      // Сервер может вернуть non-200 для encrypted errors (например 423 app_blocked).
      // Body всё равно decrypted ниже через ApiClient, тут просто читаем bytes.
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};

export const api = new ApiClient(transport);
