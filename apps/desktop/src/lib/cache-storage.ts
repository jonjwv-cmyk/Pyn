import { createJSONStorage, type PersistStorage, type StateStorage } from '@pyn/core';

/**
 * Adapter Zustand persist → `window.pyn.cache` (IPC к main process'у).
 *
 * Zustand persist хранит весь state как JSON-string. Main process encrypt'ит
 * через safeStorage (Mac Keychain / Win DPAPI) — никаких plaintext-секретов
 * на диске.
 *
 * Если preload bridge не загружен (HMR edge-case) — все методы no-op,
 * рантайм не падает.
 */

const ipcCacheStorage: StateStorage = {
  async getItem(name: string): Promise<string | null> {
    if (typeof window === 'undefined' || !window.pyn?.cache) return null;
    try {
      return await window.pyn.cache.load(name);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:cache] load failed:', err);
      return null;
    }
  },
  async setItem(name: string, value: string): Promise<void> {
    if (typeof window === 'undefined' || !window.pyn?.cache) return;
    try {
      await window.pyn.cache.save(name, value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:cache] save failed:', err);
    }
  },
  async removeItem(name: string): Promise<void> {
    if (typeof window === 'undefined' || !window.pyn?.cache) return;
    try {
      await window.pyn.cache.clear(name);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:cache] clear failed:', err);
    }
  },
};

/**
 * Factory типизированного persist-storage. createJSONStorage сам по себе
 * возвращает `PersistStorage<unknown>` — каст здесь даёт каждому store его
 * собственный тип без дублирования createJSONStorage-вызовов.
 */
export function createCacheStorage<T>(): PersistStorage<T> {
  return createJSONStorage(() => ipcCacheStorage) as PersistStorage<T>;
}

/** Сбросить весь cache (на logout / desktop_kicked / wipe). */
export async function clearAllCache(): Promise<void> {
  if (typeof window === 'undefined' || !window.pyn?.cache) return;
  try {
    await window.pyn.cache.clearAll();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:cache] clearAll failed:', err);
  }
}
