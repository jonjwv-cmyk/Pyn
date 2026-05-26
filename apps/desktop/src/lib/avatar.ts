import { useEffect, useState } from 'react';
import { decryptBlob } from '@pyn/core';

/**
 * Загрузчик зашифрованных аватарок:
 *   1. fetch URL → encrypted bytes (Electron net stack, no E2E envelope)
 *   2. decryptBlob с key/nonce из admin response
 *   3. detect MIME из magic bytes
 *   4. createObjectURL → blob URL для `<img src>`
 *
 * Module-level кэш: один blob URL на пару (url, keyB64). Blob URL не
 * revoke'ается за время жизни приложения (для desktop приемлемо — память
 * вернётся при перезапуске).
 *
 * inflight Map дедуплицирует параллельные запросы того же аватара —
 * например, у news-feed и chat-list одновременный mount.
 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function cacheKey(url: string, keyB64: string): string {
  return `${url}#${keyB64}`;
}

/**
 * §pyn-1.2.54 — Natural dimensions cache для image-attachments. Keyed by URL
 * (без keyB64 — natural dims зависят только от исходного blob'a, не от
 * расшифровки). Используется AttachmentTile'ом для HTML5 `<img width=X
 * height=Y>` атрибутов — браузер резервирует точный placeholder ДО async
 * image-load → scrollHeight стабилен с frame 1 → scroll-restore попадает в
 * реальный bottom/target → нет visible CLS jump'а при inter-chat switch.
 *
 * Two-tier persistence:
 *   • In-memory Map для sync-чтения в render-фазе (lazy useState init).
 *   • IndexedDB для переживания Pyn restart — первый просмотр каждой картинки
 *     per machine = один CLS-кадр, дальше forever clean (включая после restart).
 *
 * preload() запускается lazy при первом import'е модуля; до его finish'a
 * memCache пуст и getDimsSync вернёт null (graceful — будет один CLS).
 */
interface DimsRecord {
  w: number;
  h: number;
}
const dimsCache = new Map<string, DimsRecord>();

const DIMS_DB_NAME = 'pyn-image-dims';
const DIMS_STORE = 'dims';

let dimsDbPromise: Promise<IDBDatabase> | null = null;
function getDimsDB(): Promise<IDBDatabase> {
  if (!dimsDbPromise) {
    dimsDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DIMS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DIMS_STORE)) {
          db.createObjectStore(DIMS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dimsDbPromise;
}

// Lazy preload при первом import'е модуля — fire-and-forget. До finish'a
// getDimsSync вернёт null, что приемлемо (graceful first-paint CLS).
void (async () => {
  try {
    const db = await getDimsDB();
    const tx = db.transaction(DIMS_STORE, 'readonly');
    const store = tx.objectStore(DIMS_STORE);
    const req = store.openCursor();
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        dimsCache.set(cursor.key as string, cursor.value as DimsRecord);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:dims] preload failed:', err);
  }
})();

/** Sync-чтение natural dims по attachment URL. null = ещё не виделось. */
export function getDimsSync(url: string): DimsRecord | null {
  return dimsCache.get(url) ?? null;
}

/** Запись dims после первого `img.onload`. Идемпотентно. */
export function setDimsSync(url: string, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  const prev = dimsCache.get(url);
  if (prev && prev.w === w && prev.h === h) return;
  const dims: DimsRecord = { w, h };
  dimsCache.set(url, dims);
  void (async () => {
    try {
      const db = await getDimsDB();
      const tx = db.transaction(DIMS_STORE, 'readwrite');
      tx.objectStore(DIMS_STORE).put(dims, url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:dims] persist failed:', err);
    }
  })();
}

/**
 * Полная очистка in-memory кэша расшифрованных blob'ов. Вызывается на
 * logout — гарантирует, что blob URLs предыдущего юзера не «протекут» в
 * сессию следующего (даже если URL avatar'а совпадает — например один и
 * тот же юзер логинится после logout).
 *
 * `URL.revokeObjectURL` освобождает память; новые `URL.createObjectURL`
 * после login создадут fresh URLs.
 */
export function clearAvatarCache(): void {
  for (const blobUrl of cache.values()) {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* revoke errors — silent (URL might already be invalid) */
    }
  }
  cache.clear();
  inflight.clear();
  // dims-cache тоже чистим — следующий юзер не должен «угадывать» размеры
  // картинок предыдущего. IDB clear fire-and-forget.
  dimsCache.clear();
  void (async () => {
    try {
      const db = await getDimsDB();
      const tx = db.transaction(DIMS_STORE, 'readwrite');
      tx.objectStore(DIMS_STORE).clear();
    } catch {
      /* clear errors — silent (next session will work из пустого cache) */
    }
  })();
}

/**
 * Stage 11 active: `api.otlhelper.com` резолвится через DNS override на VPS IP
 * + TLS pin в `electron/network/tls.ts`. Host rewrite не нужен — URL'ы от
 * сервера приходят на api.otlhelper.com и работают через main process'овый
 * Chromium net stack.
 */
function rewriteHost(url: string): string {
  return url;
}

const debug = (msg: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[pyn:blob] ${msg}`);
  window.pyn?.debugLog?.('blob', msg);
};

async function loadAvatar(
  url: string,
  keyB64: string,
  nonceB64?: string,
  knownMime?: string,
): Promise<string> {
  const key = cacheKey(url, keyB64);
  const cached = cache.get(key);
  if (cached) return cached;
  const inFlight = inflight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const fetchUrl = rewriteHost(url);
    debug(`fetch ${fetchUrl.slice(0, 80)}`);
    let bytes: Uint8Array;
    try {
      // Через main process — обходит CORS-блок renderer fetch'а.
      bytes = await window.pyn.blobFetch(fetchUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debug(`fetch failed: ${msg}`);
      throw err;
    }
    debug(`fetched ${bytes.length}B, decrypting`);
    let plain: Uint8Array;
    try {
      plain = decryptBlob({
        encrypted: bytes,
        keyB64,
        nonceB64,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debug(`decrypt failed: ${msg}`);
      throw err;
    }
    // Если caller знает MIME (из attachment.file_type) — используем его.
    // Иначе magic-bytes детектор покрывает только images (для аватаров).
    const mime = knownMime && knownMime !== '' ? knownMime : detectImageMime(plain);
    debug(`decrypted ${plain.length}B mime=${mime}`);
    const blob = new Blob([plain as BufferSource], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    cache.set(key, blobUrl);
    inflight.delete(key);
    return blobUrl;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    inflight.delete(key);
    throw err;
  }
}

/** Magic-bytes детектор image MIME — server отдаёт `application/octet-stream`. */
function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length < 4) return 'application/octet-stream';
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  // WebP: 52 49 46 46 [RIFF]
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/**
 * React-hook: возвращает blob URL после decrypt'a или null пока грузится /
 * нет данных. Универсальный для аватаров и attachments — фактическая логика
 * generic, magic-bytes детектор покрывает image MIME'ы, для не-image MIME'a
 * caller'у достаточно blob URL для download.
 */
export function useDecryptedBlob(
  url: string | undefined,
  keyB64: string | undefined,
  nonceB64: string | undefined,
  /** Wire-MIME из admin response (например `video/mp4`, `image/gif`). Если не
   * передан, magic-bytes детектор покроет только images. */
  knownMime?: string,
): string | null {
  // §pyn-1.2.54 — useState lazy init читает module-level cache SYNC. Если URL
  // уже расшифровывался в этой сессии — first render возвращает blob URL,
  // <img src> декодит из browser bitmap-cache на первом paint'e, scrollHeight
  // включает natural-image-высоту с frame'a 1. Без этого useState(null) давал
  // placeholder h-32 на первом paint → useEffect после paint → setBlobUrl →
  // image natural-size на втором paint → CLS, который при scroll-restore
  // вылазит как «прыжок» (target клампится к меньшему scrollHeight, потом
  // ResizeObserver re-applies к финальному target). Inter-chat switch создаёт
  // новые AttachmentTile-инстансы для сообщений нового peer'a — каждый mount
  // проходил через этот null→url цикл, отсюда видимый прыжок.
  const [blobUrl, setBlobUrl] = useState<string | null>(() => {
    if (!url || !keyB64) return null;
    return cache.get(cacheKey(url, keyB64)) ?? null;
  });

  useEffect(() => {
    if (!url || !keyB64) {
      setBlobUrl(null);
      return;
    }
    // Re-check cache на смену url'a в уже-mounted-компоненте: useState init
    // фиксирует cache snapshot только при первом mount'е, последующая смена
    // url-props (редко, но возможно — edit message с replaced attachment) не
    // переинициализирует initial → нужен sync re-check здесь тоже.
    const cached = cache.get(cacheKey(url, keyB64));
    if (cached) {
      setBlobUrl(cached);
      return;
    }
    let cancelled = false;
    loadAvatar(url, keyB64, nonceB64, knownMime)
      .then((u) => {
        if (!cancelled) setBlobUrl(u);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[pyn:avatar] failed:', err);
        if (!cancelled) setBlobUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, keyB64, nonceB64, knownMime]);

  return blobUrl;
}
