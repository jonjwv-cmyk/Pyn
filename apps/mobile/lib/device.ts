import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

/**
 * Device ID — stable UUID v4 для kill switch trust-store (device_marks).
 * Persistится в Android Keystore через `expo-secure-store`.
 *
 * Lifecycle:
 *   • Первый запуск — генерируется UUID, кладётся в SecureStore.
 *   • Login — клиент шлёт device_id, сервер регистрирует как active.
 *   • Wipe — Secure Store очищается, при следующем запуске будет новый
 *     UUID (server увидит новый device = active, если не залочено).
 */

const KEY = 'pyn.device_id';

let cached: string | null = null;

/** Sync getter (cached). Перед вызовом нужно один раз `await initDeviceId()`. */
export function getDeviceId(): string {
  if (cached) return cached;
  throw new Error('initDeviceId() not called yet');
}

export async function initDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored && stored.length > 0) {
      cached = stored;
      return stored;
    }
  } catch (err) {
    console.warn('[pyn:device] read failed:', err);
  }
  const fresh = randomUUID();
  try {
    await SecureStore.setItemAsync(KEY, fresh);
  } catch (err) {
    console.warn('[pyn:device] save failed:', err);
  }
  cached = fresh;
  return fresh;
}

/** Clear (вызывается на wipe). */
export async function clearDeviceId(): Promise<void> {
  cached = null;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch (err) {
    console.warn('[pyn:device] clear failed:', err);
  }
}
