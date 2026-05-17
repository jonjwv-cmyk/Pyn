import type { ApiClient } from '../api/client';
import { parseRole, type Role } from '../auth/role';

/**
 * Admin & developer endpoints — управление пользователями.
 *
 * Permissions enforce'аются server'ом:
 *   • `get_users`, `create_user` — admin+
 *   • `reset_password`, `toggle_user`, `rename_user`, `change_login`,
 *     `change_role`, `delete_user`, `reset_password_login_counter` — developer-only
 *
 * UI должен скрывать действия по `can(role, ...)` (PERMISSION_MATRIX), но
 * server остаётся source-of-truth — даже если UI bug, server отвергнет.
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
  /**
   * Заблокирован администратором (отдельно от `isActive` — может быть active
   * но suspended за нарушение). Андроид показывает разные подписи: «Неактивен»
   * vs «Заблокирован».
   */
  isSuspended: boolean;
}

interface UserWire {
  login?: string;
  full_name?: string;
  role?: string;
  is_active?: number;
  is_suspended?: number;
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
    isSuspended: Number(wire.is_suspended ?? 0) === 1,
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

// ── CRUD ──────────────────────────────────────────────────────────────────

export interface CreateUserRequest {
  /** Логин нового юзера (lower-case alnum + underscore, server валидирует). */
  login: string;
  fullName: string;
  /**
   * Опционально. Если опущен — server сгенерит и вернёт временный пароль в
   * `generated_password` (не реализовано в нашей обёртке, нужно по запросу).
   */
  password?: string;
  role: Role;
  /** При первом входе принудительно потребовать сменить пароль. Default true. */
  mustChangePassword?: boolean;
}

export interface CreateUserResponse {
  login: string;
  fullName: string;
  role: Role;
  isActive: boolean;
}

export async function createUser(
  client: ApiClient,
  req: CreateUserRequest,
): Promise<CreateUserResponse> {
  const wire = await client.call<{
    data?: { login?: string; full_name?: string; role?: string; is_active?: number };
  }>('create_user', {
    new_login: req.login.trim(),
    full_name: req.fullName.trim(),
    password: req.password,
    role: req.role,
    must_change_password: req.mustChangePassword ?? true,
  });
  const d = wire.data ?? {};
  return {
    login: d.login ?? req.login,
    fullName: d.full_name ?? req.fullName,
    role: parseRole(d.role),
    isActive: Number(d.is_active ?? 1) === 1,
  };
}

/**
 * Сброс пароля юзера (developer). Если `newPassword` опущен — server
 * сгенерит временный и вернёт в response (`generated_password` поле).
 * `sessions_revoked` — сколько активных сессий отозвано после сброса.
 */
export async function resetPassword(
  client: ApiClient,
  args: { targetLogin: string; newPassword?: string },
): Promise<{ sessionsRevoked: number; generatedPassword?: string }> {
  const wire = await client.call<{ sessions_revoked?: number; generated_password?: string }>(
    'reset_password',
    {
      target_login: args.targetLogin,
      new_password: args.newPassword,
    },
  );
  return {
    sessionsRevoked: Number(wire.sessions_revoked ?? 0),
    generatedPassword: wire.generated_password,
  };
}

/**
 * Toggle activation. Server сам решает, на что переключать — active↔suspended
 * (или active↔inactive если юзер уже suspended). Возвращает финальное состояние.
 */
export async function toggleUser(
  client: ApiClient,
  targetLogin: string,
): Promise<{ isActive: boolean; isSuspended: boolean }> {
  const wire = await client.call<{ is_active?: number; is_suspended?: number }>('toggle_user', {
    target_login: targetLogin,
  });
  return {
    isActive: Number(wire.is_active ?? 1) === 1,
    isSuspended: Number(wire.is_suspended ?? 0) === 1,
  };
}

export async function renameUser(
  client: ApiClient,
  args: { targetLogin: string; fullName: string },
): Promise<{ login: string; fullName: string }> {
  const wire = await client.call<{ login?: string; full_name?: string }>('rename_user', {
    target_login: args.targetLogin,
    full_name: args.fullName.trim(),
  });
  return {
    login: wire.login ?? args.targetLogin,
    fullName: wire.full_name ?? args.fullName,
  };
}

/**
 * Сменить логин юзера. Server проверяет уникальность; возвращает старый+новый
 * (UI должен обновить кэш users → новый login).
 */
export async function changeLogin(
  client: ApiClient,
  args: { targetLogin: string; newLogin: string },
): Promise<{ oldLogin: string; login: string }> {
  const wire = await client.call<{ old_login?: string; login?: string }>('change_login', {
    target_login: args.targetLogin,
    new_login: args.newLogin.trim(),
  });
  return {
    oldLogin: wire.old_login ?? args.targetLogin,
    login: wire.login ?? args.newLogin,
  };
}

export async function changeRole(
  client: ApiClient,
  args: { targetLogin: string; newRole: Role },
): Promise<{ login: string; role: Role }> {
  const wire = await client.call<{ login?: string; role?: string }>('change_role', {
    target_login: args.targetLogin,
    new_role: args.newRole,
  });
  return {
    login: wire.login ?? args.targetLogin,
    role: parseRole(wire.role),
  };
}

/**
 * Hard-delete юзера. Server сохранит сообщения 24ч (см. tooltip в Android UI),
 * затем cron вычистит. `cannot_delete_self` — server откажет если developer
 * пытается удалить себя.
 */
export async function deleteUser(
  client: ApiClient,
  targetLogin: string,
): Promise<{ login: string }> {
  const wire = await client.call<{ login?: string }>('delete_user', {
    target_login: targetLogin,
  });
  return { login: wire.login ?? targetLogin };
}

/**
 * Сброс недельного лимита парольных входов (rate-limit 3/неделю для
 * `password_login_pc`). Server-side — без параметров, сбрасывает для
 * запрашивающего session.user. Если в будущем понадобится для другого
 * юзера — на сервере появится `target_login`, тогда расширим обёртку.
 */
export async function resetPasswordLoginCounter(client: ApiClient): Promise<void> {
  await client.call<{ success?: boolean }>('reset_password_login_counter', {});
}
