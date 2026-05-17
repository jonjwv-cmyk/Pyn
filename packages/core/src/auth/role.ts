/**
 * Роли пользователя — 1:1 порт из OTLHelper2 `shared/auth/Role.kt`.
 *
 *   user      — базовая, читает feed, голосует в опросах, реагирует на сообщения
 *   client    — внешний клиент, ограниченный доступ
 *   admin     — управление контентом (создание/закрепление новостей, опросов)
 *   developer — полные права (управление пользователями, urgent posts, audit log)
 *
 * Default при отсутствии role в response — 'user'.
 */
export type Role = 'user' | 'client' | 'admin' | 'developer';

/**
 * Парсер wire-формата с backward-compat для старых имён ролей.
 * Сервер до сих пор может прислать `superadmin` (= developer) или
 * `administrator` (= admin) — поддерживаем оба написания.
 */
export function parseRole(wire: string | null | undefined): Role {
  if (!wire) return 'user';
  const lower = wire.toLowerCase().trim();
  if (lower === 'superadmin') return 'developer';
  if (lower === 'administrator') return 'admin';
  if (lower === 'user' || lower === 'client' || lower === 'admin' || lower === 'developer') {
    return lower;
  }
  return 'user';
}

/**
 * Permission codes — string literal union из всех гейтированных действий.
 * Источник — `shared/auth/Permissions.kt` + точки ветвлений в Kotlin UI.
 *
 * При добавлении новой фичи под gate:
 *   1. Добавь код сюда в union.
 *   2. Добавь строку в PERMISSION_MATRIX с массивом ролей.
 *   3. В UI используй `can(role, '<code>')` или хук useCan.
 */
export type Permission =
  // News
  | 'news.post'
  | 'news.view'
  | 'news.pin'
  | 'news.delete-others'
  | 'news.schedule'
  | 'news.send-urgent'
  // Polls
  | 'poll.create'
  | 'poll.see-vote-counts'
  | 'poll.see-full-stats'
  // UI gating
  | 'ui.open-card-menu'
  | 'ui.see-news-search'
  | 'ui.see-contacts-list'
  | 'ui.see-reaction-voters'
  // Chat
  | 'chat.react'
  // System
  | 'system.manage-users'
  | 'system.control'
  | 'system.see-app-stats'
  | 'system.wipe-device'
  | 'system.see-audit-log';

/**
 * Единая матрица прав — UI и API checks ходят сюда.
 * "Скрыть фичу X у admin" = удалить 'admin' из массива одной строки.
 */
export const PERMISSION_MATRIX: Record<Permission, readonly Role[]> = {
  // News
  'news.post':              ['admin', 'developer'],
  'news.view':              ['user', 'admin', 'developer'],
  'news.pin':               ['admin', 'developer'],
  'news.delete-others':     ['admin', 'developer'],
  'news.schedule':          ['admin', 'developer'],
  'news.send-urgent':       ['developer'],
  // Polls
  'poll.create':            ['admin', 'developer'],
  'poll.see-vote-counts':   ['admin', 'developer'],
  'poll.see-full-stats':    ['admin', 'developer'],
  // UI gating
  'ui.open-card-menu':      ['admin', 'developer'],
  'ui.see-news-search':     ['admin', 'developer'],
  'ui.see-contacts-list':   ['admin', 'developer'],
  'ui.see-reaction-voters': ['developer'],
  // Chat
  'chat.react':             ['user', 'client', 'admin', 'developer'],
  // System
  'system.manage-users':    ['developer'],
  'system.control':         ['developer'],
  'system.see-app-stats':   ['developer'],
  'system.wipe-device':     ['developer'],
  'system.see-audit-log':   ['developer'],
};

/** Может ли role выполнить perm. Single source of truth. */
export function can(role: Role, perm: Permission): boolean {
  return PERMISSION_MATRIX[perm].includes(role);
}

/** Удобные derived-предикаты для частых проверок. */
export const isAdminLike = (role: Role): boolean => role === 'admin' || role === 'developer';
export const isDeveloper = (role: Role): boolean => role === 'developer';
