/**
 * §pyn-1.2.53 — endpoint'ы «История Хранилища»:
 *   • `logStorageOpen(path)` — fire-and-forget; server UPSERT'ит запись
 *     (path → last user + ts). Один row на каждый уникальный SMB-путь.
 *   • `getStorageOpeners(paths)` — bulk lookup; возвращает map
 *     path → { login, full_name, avatar_url, opened_at, presence_status }.
 *     Используется в StorageHome HistoryPanel для рендера аватарок
 *     последних открывших.
 */

import type { ApiClient } from '../api';
import type { PresenceStatus } from '../store/presence-store';

export interface StorageOpenerInfo {
  login: string;
  fullName: string;
  avatarUrl: string;
  avatarBlobKey: string;
  avatarBlobNonce: string;
  openedAt: string;
  presenceStatus: PresenceStatus;
  lastSeenAt: string;
}

interface StorageOpenerWire {
  login?: string;
  full_name?: string;
  avatar_url?: string;
  avatar_blob_key?: string;
  avatar_blob_nonce?: string;
  opened_at?: string;
  presence_status?: string;
  last_seen_at?: string;
}

function normalizePresence(s: string | undefined): PresenceStatus {
  if (s === 'online') return 'online';
  if (s === 'paused' || s === 'away') return 'away';
  return 'offline';
}

export async function logStorageOpen(
  client: ApiClient,
  path: string,
): Promise<void> {
  if (!path) return;
  try {
    await client.call('log_storage_open', { path });
  } catch {
    /* fire-and-forget — не валим UX если сервер недоступен */
  }
}

export async function getStorageOpeners(
  client: ApiClient,
  paths: string[],
): Promise<Map<string, StorageOpenerInfo>> {
  const map = new Map<string, StorageOpenerInfo>();
  if (paths.length === 0) return map;
  try {
    const wire = await client.call<{ openers?: Record<string, StorageOpenerWire> }>(
      'get_storage_openers',
      { paths: paths.slice(0, 50) },
    );
    const openers = wire.openers ?? {};
    for (const [path, info] of Object.entries(openers)) {
      map.set(path, {
        login:             info.login ?? '',
        fullName:          info.full_name ?? '',
        avatarUrl:         info.avatar_url ?? '',
        avatarBlobKey:     info.avatar_blob_key ?? '',
        avatarBlobNonce:   info.avatar_blob_nonce ?? '',
        openedAt:          info.opened_at ?? '',
        presenceStatus:    normalizePresence(info.presence_status),
        lastSeenAt:        info.last_seen_at ?? '',
      });
    }
  } catch {
    /* swallow — empty map fallback */
  }
  return map;
}
