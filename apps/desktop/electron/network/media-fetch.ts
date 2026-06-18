import { session as electronSession } from 'electron';

const RETRYABLE_MEDIA_STATUSES = new Set([403, 408, 421, 425, 429, 500, 502, 503, 504]);
const MEDIA_FETCH_ATTEMPTS = 5;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaFetchError(kind: 'blob' | 'snapshot', status: number): Error {
  return new Error(`${kind}_fetch_${status}`);
}

/**
 * Fetch R2/media bytes through Electron net stack.
 *
 * VPS/CF cold routes can transiently answer 403/421 before the same immutable
 * object returns 200. Snapshot bases should not fail on that first edge answer.
 */
export async function fetchMediaBytes(
  finalUrl: string,
  kind: 'blob' | 'snapshot',
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MEDIA_FETCH_ATTEMPTS; attempt++) {
    try {
      const resp = await electronSession.defaultSession.fetch(finalUrl, { cache: 'no-store' });
      if (!resp.ok) {
        const err = mediaFetchError(kind, resp.status);
        lastErr = err;
        if (!RETRYABLE_MEDIA_STATUSES.has(resp.status) || attempt === MEDIA_FETCH_ATTEMPTS - 1) {
          throw err;
        }
        // eslint-disable-next-line no-console
        console.warn(`[pyn:media] ${kind} ${resp.status}, retry ${attempt + 2}/${MEDIA_FETCH_ATTEMPTS}`);
      } else {
        return new Uint8Array(await resp.arrayBuffer());
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message.startsWith(`${kind}_fetch_`)) {
        throw err;
      }
      if (attempt === MEDIA_FETCH_ATTEMPTS - 1) {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(`[pyn:media] ${kind} exception, retry ${attempt + 2}/${MEDIA_FETCH_ATTEMPTS}`, err);
    }
    await delay(300 * (attempt + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${kind}_fetch_failed`);
}
