import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { confirmWipe } from '@pyn/core';
import { api } from './api';
import { getDeviceId } from './device';
import { clearSession } from './session';
import { stopWs } from './ws';

/**
 * Kill switch wipe (Android). Стирает:
 *   • SecureStore (device_id, session)
 *   • AsyncStorage (любые non-sensitive кэши)
 *   • Останавливает WS
 *   • Шлёт confirm_wipe серверу (best-effort)
 *   • Перезагружает app через Updates.reloadAsync (или DevSettings в dev mode)
 *
 * После reload — fresh install state: новый device_id сгенерируется,
 * login невозможен пока developer не cancel'нёт state на сервере.
 */
export async function triggerAppLockWipe(): Promise<void> {
  // 1. Confirm к серверу (best-effort, до wipe пока device_id ещё есть).
  try {
    const did = getDeviceId();
    if (did) await confirmWipe(api, did);
  } catch (err) {
    console.warn('[pyn:wipe] confirmWipe failed:', err);
  }
  // 2. Stop WS — иначе reconnect попробует после reload с старым state.
  try { stopWs(); } catch { /* ignore */ }
  // 3. Clear SecureStore + AsyncStorage
  try { await clearSession(); } catch { /* ignore */ }
  try { await SecureStore.deleteItemAsync('pyn.device_id'); } catch { /* ignore */ }
  try { await AsyncStorage.clear(); } catch { /* ignore */ }
  // 4. Reload app (Expo Go: dev reload; standalone: native restart).
  try {
    if (Updates.isEnabled) {
      await Updates.reloadAsync();
    }
  } catch (err) {
    console.warn('[pyn:wipe] reload failed:', err);
  }
}
