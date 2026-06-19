import { session as electronSession } from 'electron';

/**
 * Fetch R2/media-байтов (аватары, attachments, snapshot-базы: МОЛ/персоны/склады)
 * через Electron net-стек.
 *
 * Почему вообще нужен ретрай — и почему это НЕ костыль:
 * на ХОЛОДНОМ старте первые media-запросы рвутся на ТРАНСПОРТНОМ уровне, а не на HTTP-статусе:
 *   • Chromium HTTP-кэш после самообновления / нечистого выхода → `net::ERR_CACHE_READ_FAILURE`
 *     (основной фикс — `cache:'no-store'` ниже; блобы content-addressed, HTTP-кэш не нужен);
 *   • первый DNS-резолв `sslip.io` / поднятие CONNECT-туннеля через корп-прокси / прогрев TLS
 *     (Kaspersky-MITM) — первая попытка обрывается, вторая идёт по уже тёплому пути.
 *
 * Маршрутизация (детект прокси + TLS-pin) к этому моменту УЖЕ готова (`setupApiBridge`
 * ждётся ДО создания окна), а `cdn.otlhelper.com` всегда идёт через VPS `/r2` — поэтому
 * 403/421 от Cloudflare тут не бывает (проверено: в логах VPS их ноль). Значит ретраим
 * ТОЛЬКО реальные транзиенты:
 *   • исключение `fetch` (нет HTTP-ответа: кэш/DNS/туннель/TLS) — главный кейс;
 *   • временные edge/gateway-статусы (408/429/502/503/504).
 * Семантические ответы (403/404/421/…) НЕ ретраим: это не транзиент, бить их повторами =
 * прятать настоящий баг и тормозить старт.
 */

/** Только реально временные статусы. 403/404/421/425/500 — семантика, не ретраим. */
const RETRYABLE_MEDIA_STATUSES = new Set([408, 429, 502, 503, 504]);
const MEDIA_FETCH_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaFetchError(kind: 'blob' | 'snapshot', status: number): Error {
  return new Error(`${kind}_fetch_${status}`);
}

export async function fetchMediaBytes(
  finalUrl: string,
  kind: 'blob' | 'snapshot',
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MEDIA_FETCH_ATTEMPTS; attempt++) {
    const isLast = attempt === MEDIA_FETCH_ATTEMPTS - 1;
    try {
      const resp = await electronSession.defaultSession.fetch(finalUrl, { cache: 'no-store' });
      if (resp.ok) {
        return new Uint8Array(await resp.arrayBuffer());
      }
      // HTTP-ответ есть: временный edge-статус — ретраим, остальное (семантика) — сразу падаем.
      const err = mediaFetchError(kind, resp.status);
      if (isLast || !RETRYABLE_MEDIA_STATUSES.has(resp.status)) throw err;
      lastErr = err;
      // eslint-disable-next-line no-console
      console.warn(`[pyn:media] ${kind} ${resp.status}, retry ${attempt + 2}/${MEDIA_FETCH_ATTEMPTS}`);
    } catch (err) {
      // Наш статус-throw (семантика / последняя попытка) — пробрасываем как есть.
      if (err instanceof Error && err.message.startsWith(`${kind}_fetch_`)) throw err;
      // Транспортное исключение (кэш/DNS/туннель/TLS) — главный кейс ретрая холодного старта.
      if (isLast) throw err;
      lastErr = err;
      // eslint-disable-next-line no-console
      console.warn(`[pyn:media] ${kind} transport error, retry ${attempt + 2}/${MEDIA_FETCH_ATTEMPTS}`, err);
    }
    await delay(300 * (attempt + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${kind}_fetch_failed`);
}
