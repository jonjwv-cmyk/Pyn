import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generic encrypted cache в `userData/cache/`. Используется Zustand persist
 * adapter'ом из renderer'а через IPC `pyn:cache:*`.
 *
 * Каждый name — отдельный файл `<safe-name>.bin` (safeStorage encrypt'нутый
 * UTF-8 string). Sandboxed внутри userData — отдельно от session.bin (другой
 * namespace).
 *
 * Безопасность:
 *   • Encrypt всегда (Mac Keychain / Win DPAPI)
 *   • mode 0o600 — только owner
 *   • Имена sanitize'ются (alphanumeric + dash + underscore) против path
 *     traversal — renderer не должен суметь читать произвольные файлы.
 */

const CACHE_DIR = (): string => path.join(app.getPath('userData'), 'cache');

/** Sanitize name: только [A-Za-z0-9_-], max 64 chars. */
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function cachePath(name: string): string {
  return path.join(CACHE_DIR(), `${sanitizeName(name)}.bin`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR(), { recursive: true });
}

export async function loadCache(name: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  let buf: Buffer;
  try {
    buf = await fs.readFile(cachePath(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // eslint-disable-next-line no-console
    console.warn(`[pyn:cache] read ${name} failed:`, err);
    return null;
  }
  try {
    return safeStorage.decryptString(buf);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pyn:cache] decrypt ${name} failed:`, err);
    return null;
  }
}

export async function saveCache(name: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('encryption_unavailable');
  }
  await ensureDir();
  const buf = safeStorage.encryptString(value);
  await fs.writeFile(cachePath(name), buf, { mode: 0o600 });
}

export async function clearCache(name: string): Promise<void> {
  try {
    await fs.unlink(cachePath(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[pyn:cache] clear ${name} failed:`, err);
    }
  }
}

/** Очистить всё содержимое cache-директории (на logout / wipe). */
export async function clearAllCache(): Promise<void> {
  try {
    await fs.rm(CACHE_DIR(), { recursive: true, force: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:cache] clear all failed:', err);
  }
}
