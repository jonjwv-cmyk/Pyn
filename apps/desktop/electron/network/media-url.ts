import type { ProxyConfig } from './proxy';

/**
 * Переписывание media-URL (аватары / attachments / МОЛ snapshot / update-exe)
 * в proxy-mode. 1:1 с Kotlin `MediaUrlResolver.resolve()`.
 *
 * Direct: `api.otlhelper.com` ходим через DNS-override + SPKI pin —
 * не трогаем URL, всё на месте.
 *
 * Proxy: корп-прокси резолвит `api.otlhelper.com` через свой DNS → попадает
 * на Cloudflare → cert mismatch / proxy 502. Переписываем на схему
 * `45-12-239-5.sslip.io`, у которой LE-cert и сама схема имени
 * `<ip>.sslip.io` гарантированно резолвится в IP 45.12.239.5 на любом
 * корп-DNS.
 *
 * Также подменяем `cdn.otlhelper.com` (хост R2-cache fronted via Worker) —
 * у него аналогичная проблема под корп-прокси.
 */
/**
 * Переписываем только `api.otlhelper.com` — у sslip.io vhost есть нужные
 * location'ы (`/api`, `/ws`, `/desktop/...`).
 *
 * `cdn.otlhelper.com` (R2 blob fronted via CF Worker) — НЕ переписываем.
 * Это публичный CF endpoint, корп-прокси резолвит его своим DNS на CF IP
 * и proxy-tunnel'ит TLS до CF. sslip.io ему не нужен и сломает path:
 * snapshot/avatar URL'ы вида `cdn.otlhelper.com/<r2_key>` после rewrite
 * стали бы `45-12-239-5.sslip.io/<r2_key>` → 404.
 */
const REWRITE_HOSTS = new Set([
  'api.otlhelper.com',
]);
const SSLIP_HOST = '45-12-239-5.sslip.io';

export function resolveMediaUrl(rawUrl: string, proxy: ProxyConfig | null): string {
  if (!proxy) return rawUrl;
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (!REWRITE_HOSTS.has(u.hostname)) return rawUrl;
    u.hostname = SSLIP_HOST;
    // Port явно убираем — sslip.io vhost слушает 443.
    u.port = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}
