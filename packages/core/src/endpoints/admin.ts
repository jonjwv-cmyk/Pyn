import type { ApiClient } from '../api/client';
import { parseRole, type Role } from '../auth/role';

/**
 * Admin-only endpoints. `get_users` — список всех пользователей с avatar+
 * presence. Используется на desktop'e чтобы:
 *   • Подтянуть аватары в NewsStatsDialog (server gets_news_readers возвращает
 *     только login+full_name, без аватаров).
 *   • Search / mention overlay (future).
 */

export interface UserSummary {
  login: string;
  fullName: string;
  role: Role;
  initials: string;
  /** URL зашифрованного аватара (если есть). */
  avatarUrl?: string;
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
  presenceStatus?: 'online' | 'away' | 'offline';
  lastSeenAt?: string;
  isActive: boolean;
}

interface UserWire {
  login?: string;
  full_name?: string;
  role?: string;
  is_active?: number;
  avatar_url?: string;
  avatar_blob_key_b64?: string;
  avatar_blob_nonce_b64?: string;
  presence_status?: string;
  last_seen_at?: string;
}

/** Список всех пользователей. Admin/developer only (server enforce'ит). */
export async function getUsers(client: ApiClient): Promise<UserSummary[]> {
  const wire = await client.call<{ data?: UserWire[]; count?: number }>('get_users', {});
  return (wire.data ?? []).map(wireToUserSummary);
}

function wireToUserSummary(wire: UserWire): UserSummary {
  const login = wire.login ?? '';
  const fullName = wire.full_name ?? login;
  return {
    login,
    fullName,
    role: parseRole(wire.role),
    initials: computeInitials(fullName),
    avatarUrl: wire.avatar_url || undefined,
    avatarBlobKey: wire.avatar_blob_key_b64 || undefined,
    avatarBlobNonce: wire.avatar_blob_nonce_b64 || undefined,
    presenceStatus: parsePresence(wire.presence_status),
    lastSeenAt: wire.last_seen_at,
    isActive: Number(wire.is_active ?? 1) === 1,
  };
}

function parsePresence(v: string | undefined): 'online' | 'away' | 'offline' | undefined {
  if (v === 'online' || v === 'away' || v === 'offline') return v;
  return undefined;
}

/** Inline-копия `computeInitials` чтобы не тянуть его из @pyn/desktop. */
function computeInitials(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '·';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) {
    const word = parts[0] ?? '';
    return (word.slice(0, 2) || '·').toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second || '·').toUpperCase();
}
