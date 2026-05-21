import * as SecureStore from 'expo-secure-store';
import type { Session } from '@pyn/core';

/**
 * Persistent session storage через expo-secure-store (Android Keystore).
 * Bearer token + user info, encrypted at-rest.
 */

const KEY = 'pyn.session';

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed?.token !== 'string' || parsed.token.length === 0) return null;
    return parsed;
  } catch (err) {
    console.warn('[pyn:session] load failed:', err);
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch (err) {
    console.warn('[pyn:session] clear failed:', err);
  }
}
