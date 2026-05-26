import type { ChatMessageWire, PresenceEntry, UserSummary } from '@pyn/core';

/**
 * §pyn-1.2.39 — helpers для bulk fill `usePresenceStore` из разных API ответов.
 *
 * Презенс приходит «попутно» в нескольких эндпоинтах:
 *   • `get_admin_messages` — sender_presence_status + receiver_presence_status
 *   • `get_admin_chat` — то же per row
 *   • `get_users` — presenceStatus на UserSummary
 *   • `get_news_readers` — presence на каждом reader/voter
 *
 * Эти helpers извлекают эти поля в единый формат PresenceEntry[] для setMany.
 * Latest-write-wins на стороне store защищает от перетирания свежих WS push'ей
 * медленным ответом API.
 */

export function extractPresenceFromChatWires(wires: ChatMessageWire[]): PresenceEntry[] {
  // Используем Map чтобы дедуплицировать login'ы (один юзер может быть и
  // sender, и receiver в разных rows). При дубле берём более «информативную»
  // запись (с непустым lastSeenAt).
  const byLogin = new Map<string, PresenceEntry>();

  const push = (login: string | undefined, status: string | undefined, lastSeenAt: string | undefined): void => {
    if (!login) return;
    const existing = byLogin.get(login);
    // Не перетираем запись с непустым lastSeenAt пустой строкой.
    if (existing && existing.lastSeenAt && !lastSeenAt) return;
    byLogin.set(login, { login, status, lastSeenAt });
  };

  for (const wire of wires) {
    push(wire.sender_login, wire.sender_presence_status, wire.sender_last_seen_at);
    push(wire.receiver_login, wire.receiver_presence_status, wire.receiver_last_seen_at);
  }

  return [...byLogin.values()];
}

export function extractPresenceFromUsers(users: UserSummary[]): PresenceEntry[] {
  const entries: PresenceEntry[] = [];
  for (const user of users) {
    if (!user.login) continue;
    entries.push({
      login: user.login,
      status: user.presenceStatus,
      lastSeenAt: user.lastSeenAt,
    });
  }
  return entries;
}
