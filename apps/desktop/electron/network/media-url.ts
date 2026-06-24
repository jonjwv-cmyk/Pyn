import type { ProxyConfig } from './proxy';
import { getApiMode } from './api-mode';

/** DEV cloud-режим: хост api/cdn → прямой CF Worker (минуя VPS). */
const CLOUD_HOST = 'otl-api.jond-horizon.workers.dev';

/**
 * Переписывание media-URL (аватары / attachments / МОЛ snapshot / update-exe).
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
 * `cdn.otlhelper.com` подменяем всегда: nginx на VPS отдает R2-файлы через
 * стабильный маршрут `/r2/<key>`.
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
 * `api.otlhelper.com` переписываем в proxy-mode. В direct mode оставляем
 * оригинальный API URL: Chromium host-resolver ведет его на VPS, а SPKI pin
 * проверяет сертификат.
 */
const SSLIP_HOST = '45-12-239-5.sslip.io';

export function resolveMediaUrl(rawUrl: string, proxy: ProxyConfig | null): string {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) return rawUrl;
  try {
    const u = new URL(rawUrl);
    // DEV cloud-режим (юзер 2026-06-22): и api, и cdn идут прямо в CF Worker, минуя мёртвый VPS.
    // Обычный CF-cert (без пина). База-снимки (cdn/base/*) воркером не раздаются → клиент возьмёт
    // из локального кэша; здесь хотя бы не виснем на недоступном VPS.
    if (getApiMode() === 'cloud' && (u.hostname === 'api.otlhelper.com' || u.hostname === 'cdn.otlhelper.com')) {
      u.hostname = CLOUD_HOST;
      u.port = '';
      return u.toString();
    }
    if (u.hostname === 'cdn.otlhelper.com') {
      // CDN-blob → префикс /r2/. Path начинается со слеша: '/<key>' → '/r2/<key>'.
      u.hostname = SSLIP_HOST;
      u.port = '';
      if (!u.pathname.startsWith('/r2/')) {
        u.pathname = '/r2' + u.pathname;
      }
      return u.toString();
    }
    if (proxy && u.hostname === 'api.otlhelper.com') {
      u.hostname = SSLIP_HOST;
      u.port = '';
      return u.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}
