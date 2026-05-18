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
 * **Архитектурный инвариант**: корп-прокси **не должен** видеть Cloudflare.
 * Все запросы идут через VPS `45-12-239-5.sslip.io` (proxy_pass на CF).
 * Никаких прямых обращений из клиента к `cdn.otlhelper.com` /
 * `api.otlhelper.com` — иначе корп-AV/политика может заблокировать.
 *
 * Маппинг:
 *   • `api.otlhelper.com/<path>` → `45-12-239-5.sslip.io/<path>`
 *     (sslip.io имеет `/api`, `/ws`, `/desktop/*`)
 *   • `cdn.otlhelper.com/<key>` → `45-12-239-5.sslip.io/r2/<key>`
 *     (nginx location `~ ^/r2/(.+)$` proxy_pass'ит на CF с
 *     `Host: cdn.otlhelper.com`)
 *
 * Применяется ВСЕГДА когда proxy detected. В direct mode (домашняя сеть)
 * — оставляем оригинальный URL: там и DNS-override на `api.otlhelper.com`
 * и доверие к cdn работают.
 */
const SSLIP_HOST = '45-12-239-5.sslip.io';

export function resolveMediaUrl(rawUrl: string, proxy: ProxyConfig | null): string {
  if (!proxy) return rawUrl;
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'api.otlhelper.com') {
      u.hostname = SSLIP_HOST;
      u.port = '';
      return u.toString();
    }
    if (u.hostname === 'cdn.otlhelper.com') {
      // CDN-blob → префикс /r2/. Path начинается со слеша: '/<key>' → '/r2/<key>'.
      u.hostname = SSLIP_HOST;
      u.port = '';
      u.pathname = '/r2' + u.pathname;
      return u.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}
