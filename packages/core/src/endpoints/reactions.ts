import type { ApiClient } from '../api/client';

/**
 * Reactions API. Доступно всем юзерам (включая `client`-role) — реакция
 * это самое простое social interaction. Сервер whitelist'ит emoji:
 * `👍 ❤️ 😂 🎉 ✅` (см. `handlers-reactions.js`).
 *
 * Server broadcastит по WS:
 *   • Для news     → `{type:"news_update", id, kind:"reaction"}`
 *   • Для chat msg → `{type:"new_message", ...}`
 *
 * Подход в UI: optimistic update в state + API call. WS-refresh потом
 * перепишет state с server-truth.
 */

export interface ReactionRequest {
  /** ID сообщения/новости (поле `message_id` в wire). */
  messageId: number;
  emoji: string;
}

export async function addReaction(client: ApiClient, req: ReactionRequest): Promise<void> {
  await client.call('add_reaction', {
    message_id: req.messageId,
    emoji: req.emoji,
  });
}

export async function removeReaction(client: ApiClient, req: ReactionRequest): Promise<void> {
  await client.call('remove_reaction', {
    message_id: req.messageId,
    emoji: req.emoji,
  });
}

// ── GET_REACTIONS (aggregate + voters) ────────────────────────────────────

export interface ReactionVoter {
  userLogin: string;
  fullName?: string;
  createdAt?: string;
}

export interface ReactionsDetails {
  /** emoji → total count. */
  aggregate: Record<string, number>;
  /** emoji → array of voters. */
  voters: Record<string, ReactionVoter[]>;
}

interface ReactionsDetailsWire {
  data?: {
    aggregate?: Record<string, number>;
    voters?: Record<string, Array<{ user_login: string; full_name?: string; created_at?: string }>>;
  };
}

/** Развёрнутый список реакций (кто что поставил). Для popup details. */
export async function getReactions(
  client: ApiClient,
  messageId: number,
): Promise<ReactionsDetails> {
  const wire = await client.call<ReactionsDetailsWire>('get_reactions', {
    message_id: messageId,
  });
  const aggregate = wire.data?.aggregate ?? {};
  const wireVoters = wire.data?.voters ?? {};
  const voters: Record<string, ReactionVoter[]> = {};
  for (const [emoji, list] of Object.entries(wireVoters)) {
    voters[emoji] = list.map((v) => ({
      userLogin: v.user_login,
      fullName: v.full_name,
      createdAt: v.created_at,
    }));
  }
  return { aggregate, voters };
}
