import {
  confirmWipe,
  useAppLockStore,
  useSheetsLockStore,
} from '@pyn/core';
import { api } from '@/lib/api';
import { clearAvatarCache } from '@/lib/avatar';
import { clearAllCache } from '@/lib/cache-storage';
import { getDeviceId } from '@/lib/device';
import {
  useChatsStore,
  useMolStore,
  useNewsStore,
  useOutboxStore,
  usePresenceStore,
  useSessionInfoStore,
  useStatsStore,
  useUiStateStore,
  useUsersStore,
} from '@/lib/stores';
import { usePersonsStore } from '@/lib/persons-store';
import { usePersonEditStore } from '@/lib/person-edit-store';
import { sessionStore } from '@/lib/token-store';
import { clearTablesRegistry } from '@/lib/use-tables-registry';
import { stopWs } from '@/lib/ws';

/**
 * Полная очистка user data: session, news cache, chats cache, encrypted
 * cache на диске, ApiClient token. Вызывается на token expiry / desktop_kicked.
 */
export async function wipeUserData(): Promise<void> {
  await sessionStore.clear().catch(() => {});
  api.setToken(null);
  useNewsStore.getState().clear();
  useChatsStore.getState().clear();
  useUsersStore.getState().clear();
  useSessionInfoStore.getState().clear();
  useMolStore.getState().clear();
  usePersonsStore.getState().clear();
  usePersonEditStore.getState().close();
  useUiStateStore.getState().clear();
  useOutboxStore.getState().clear();
  useStatsStore.getState().clear();
  usePresenceStore.getState().clear();
  clearTablesRegistry();
  useSheetsLockStore.getState().reset();
  // In-memory blob URLs (avatars / attachments) — освобождаем чтобы при
  // следующем login (особенно того же юзера) не использовать stale URL.
  clearAvatarCache();
  await clearAllCache();
}

/**
 * Kill switch wipe — server triggered 'wiping' через WS. В отличие от
 * wipeUserData выше (только soft-clear stores + cache), этот стирает
 * ВЕСЬ userData (включая device.bin = device_id и session.bin) через
 * main process IPC и relaunch'ит app. После relaunch выглядит как fresh
 * install: новый device_id, no session → попытка login вернёт 423
 * пока developer не cancel'нёт state на сервере.
 */
export async function triggerAppLockWipe(): Promise<void> {
  useAppLockStore.getState().markCurrentWiping('desktop');
  // Best-effort confirm на сервер — server и так сам пометил device wiped
  // через checkAndTriggerWipe(), но audit row добавится.
  try {
    const did = getDeviceId();
    if (did) await confirmWipe(api, did);
  } catch (err) {
    console.warn('[pyn:app-lock] confirmWipe failed:', err);
  }
  // Stop WS перед wipe — иначе reconnect попробует пройти после relaunch.
  try {
    await stopWs();
  } catch {
    /* ignore */
  }
  // IPC wipe — main process стирает userData и relaunch'ит. После
  // вызова renderer process получает SIGTERM, дальше не выполняется.
  try {
    await window.pyn?.appLock?.wipe();
  } catch (err) {
    console.error('[pyn:app-lock] wipe IPC failed:', err);
  }
}
