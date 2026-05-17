/**
 * Device ID — стабильный UUID для текущей установки Pyn. Используется в:
 *   • Login flow — для derive master key (`${login}:${device_id}`)
 *   • Device label для `password_login_pc` ("Pyn-mac-<short>")
 *   • Track multiple desktop sessions от того же юзера (server-side)
 *
 * **Phase D**: персистится в encrypted cache через `window.pyn.cache` (safeStorage
 * на Mac Keychain / Win DPAPI). Раньше был в localStorage (plaintext) — мы
 * мигрируем при первом запуске после upgrade.
 *
 * API:
 *   • `initDeviceId()` — async загрузка/миграция; вызывать на mount App.tsx
 *   • `getDeviceId()` — sync; если ещё не загружено — fallback на generate +
 *     async save в encrypted store
 *   • `getDeviceLabel()` — sync; возвращает human-readable label
 */

const LEGACY_STORAGE_KEY = 'pyn:device_id';
const CACHE_NAME = 'device_id';

let cachedDeviceId: string | null = null;

/**
 * Initialize device_id (async). Вызывается из App.tsx hydrate flow.
 *   1. Если уже в memory — no-op
 *   2. Иначе пробуем `window.pyn.cache.load('device_id')` (encrypted)
 *   3. Если в encrypted нет — migration: смотрим localStorage
 *   4. Если ни там, ни там — generate uuid, сохраняем в encrypted (и удаляем
 *      legacy если был)
 */
export async function initDeviceId(): Promise<void> {
  if (cachedDeviceId) return;

  const fromCache = (await window.pyn?.cache?.load(CACHE_NAME).catch(() => null)) ?? null;
  if (fromCache && fromCache.length > 0) {
    cachedDeviceId = fromCache;
    // Чистим legacy plain-text storage если был.
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  // Migration: возможно старый localStorage device_id (до Phase D).
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (legacy && legacy.length > 0) {
    cachedDeviceId = legacy;
    await window.pyn?.cache?.save(CACHE_NAME, legacy).catch(() => {});
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  // First-ever launch: новый uuid.
  const generated = crypto.randomUUID();
  cachedDeviceId = generated;
  await window.pyn?.cache?.save(CACHE_NAME, generated).catch(() => {});
}

/**
 * Sync getter. Если initDeviceId ещё не отработал (race condition) — генерит
 * новый id и пишет async (fallback, обычно не должен случаться).
 */
export function getDeviceId(): string {
  if (cachedDeviceId !== null && cachedDeviceId.length > 0) return cachedDeviceId;
  // Crisis fallback — generate inline + async save.
  const generated = crypto.randomUUID();
  cachedDeviceId = generated;
  void window.pyn?.cache?.save(CACHE_NAME, generated).catch(() => {});
  // eslint-disable-next-line no-console
  console.warn('[pyn:device] getDeviceId called before initDeviceId — generated fallback');
  return generated;
}

/**
 * Человекочитаемый label устройства для `password_login_pc` (max 40 chars).
 * Виден админу в `list_pc_sessions`. Формат: "Pyn-{os}-{shortId}".
 */
export function getDeviceLabel(): string {
  const platform = window.pyn?.platform;
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'desktop';
  const shortId = getDeviceId().slice(0, 8);
  return `Pyn-${os}-${shortId}`;
}
