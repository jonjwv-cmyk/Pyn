import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from '@pyn/core';

/**
 * Main-process persistent session storage через Electron `safeStorage`.
 *
 * Бэкенды:
 *   • macOS    — Keychain Services (encrypted с user'ской login-keychain).
 *   • Windows  — DPAPI (per-user, per-machine).
 *   • Linux    — libsecret/kwallet/basic_text (последний — небезопасный
 *                fallback, мы его блокируем через isEncryptionAvailable check).
 *
 * Файл лежит в `userData/session.bin` (бинарь — encrypted JSON).
 * Renderer не имеет прямого доступа: load/save/clear ходят через IPC
 * (`pyn:token:*`), чтобы token не светился в renderer-side IndexedDB/localStorage
 * и не утекал через XSS если когда-то у нас будет внешний content.
 */

const SESSION_FILE = (): string => path.join(app.getPath('userData'), 'session.bin');

/**
 * @returns persistеd session или null если файла нет / ключ недоступен /
 * не удалось расшифровать (например, юзер сменил OS-аккаунт).
 */
export async function loadSession(): Promise<Session | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:token] safeStorage encryption not available; cannot restore session');
    return null;
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(SESSION_FILE());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // eslint-disable-next-line no-console
    console.warn('[pyn:token] read failed:', err);
    return null;
  }
  let json: string;
  try {
    json = safeStorage.decryptString(buf);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:token] decrypt failed (corrupt / different user?):', err);
    return null;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isValidSession(parsed)) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:token] persisted session shape invalid; discarding');
      return null;
    }
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:token] JSON parse failed:', err);
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('encryption_unavailable');
  }
  const buf = safeStorage.encryptString(JSON.stringify(session));
  // mode 0o600 — только owner может читать/писать (паранойя на shared-машинах).
  await fs.writeFile(SESSION_FILE(), buf, { mode: 0o600 });
}

export async function clearSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_FILE());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[pyn:token] clear failed:', err);
    }
  }
}

/** Runtime-проверка shape'a — на случай если файл от старой версии или порченый. */
function isValidSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.token !== 'string' || s.token.length === 0) return false;
  if (typeof s.role !== 'string') return false;
  if (typeof s.loggedInAt !== 'string') return false;
  if (typeof s.user !== 'object' || s.user === null) return false;
  const u = s.user as Record<string, unknown>;
  if (typeof u.login !== 'string' || typeof u.fullName !== 'string') return false;
  return true;
}
