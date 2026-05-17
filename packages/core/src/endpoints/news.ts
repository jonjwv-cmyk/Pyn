import type { ApiClient } from '../api/client';

/**
 * News endpoints — wire-формат точно совпадает с server response от OTLHelper2.
 *
 * Envelope: `{ ok: true, count: N, data: [NewsItemWire, ...] }`.
 * Массив сидит в поле `data` (НЕ `items`).
 */

// ── GET_NEWS ───────────────────────────────────────────────────────────────

export interface GetNewsRequest {
  limit?: number;
}

export interface AttachmentWire {
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  /** Base64 AES key для blob decryption — есть у media attachments. */
  blob_key_b64?: string;
  blob_nonce_b64?: string;
}

export interface PollOptionWire {
  id: number;
  text: string;
  votes_count: number;
}

export interface PollWire {
  id: number;
  question: string;
  description?: string;
  options: PollOptionWire[];
  my_vote_option_id?: number | null;
  total_voters: number;
  is_active: boolean;
}

/**
 * Точная форма ОДНОЙ записи из server response. Имена полей snake_case как в БД.
 * NB: `is_pinned`/`is_read` — `0|1` integer (а не boolean).
 */
export interface NewsItemWire {
  id: number;
  kind: 'news' | 'poll';
  sender_login?: string;
  sender_name?: string;
  sender_role?: string;
  sender_avatar_url?: string;
  sender_avatar_blob_key_b64?: string;
  sender_avatar_blob_nonce_b64?: string;
  sender_presence_status?: 'online' | 'away' | 'offline';
  sender_last_seen_at?: string;
  receiver_login?: string;
  text: string;
  status?: string;
  created_at?: string;
  is_pinned?: number;
  pinned_at?: string;
  pinned_by?: string;
  is_read?: number;
  unread_count?: number;
  reactions?: Record<string, number>;
  my_reactions?: string[];
  attachments?: AttachmentWire[];
  poll?: PollWire | null;
}

export async function getNews(
  client: ApiClient,
  req: GetNewsRequest = {},
): Promise<NewsItemWire[]> {
  const wire = await client.call<{ data?: NewsItemWire[]; count?: number }>('get_news', {
    limit: req.limit ?? 50,
  });
  return wire.data ?? [];
}

// ── SEND_NEWS ──────────────────────────────────────────────────────────────

export interface SendNewsRequest {
  text: string;
  attachments?: Array<{
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

export interface SendNewsResponse {
  id: number;
  createdAt: string;
}

export async function sendNews(
  client: ApiClient,
  req: SendNewsRequest,
): Promise<SendNewsResponse> {
  const wire = await client.call<{ id: number; created_at?: string }>('send_news', {
    text: req.text,
    attachments: req.attachments?.map((a) => ({
      file_url: a.url,
      file_name: a.filename,
      file_type: a.mimeType,
      file_size: a.size,
    })),
  });
  return {
    id: wire.id,
    createdAt: wire.created_at ?? new Date().toISOString(),
  };
}

// ── VOTE_NEWS_POLL ─────────────────────────────────────────────────────────

/**
 * Голос в опросе. Server: один голос на юзера, revoting запрещён
 * (`{error: "already_voted"}` если повторно). Wire-поле — `option_ids` массив,
 * хотя по факту single-choice (server берёт первый). См. `handlers-feed.js:365`.
 *
 * Permission: все кроме `client`-role.
 */
export async function voteNewsPoll(
  client: ApiClient,
  req: { pollId: number; optionId: number },
): Promise<void> {
  await client.call('vote_news_poll', {
    poll_id: req.pollId,
    option_ids: [req.optionId],
  });
}

// ── PIN / UNPIN MESSAGE ────────────────────────────────────────────────────

/**
 * Закрепить новость. Server-side лимит MAX_PINNED=3 (попытка 4-й → error
 * `pin_limit_reached`). Permission: только admin/developer.
 */
export async function pinMessage(client: ApiClient, messageId: number): Promise<void> {
  await client.call('pin_message', { message_id: messageId });
}

export async function unpinMessage(client: ApiClient, messageId: number): Promise<void> {
  await client.call('unpin_message', { message_id: messageId });
}

// ── SOFT DELETE ────────────────────────────────────────────────────────────

/**
 * Soft-delete новости/сообщения (`status='deleted'`). Permission: автор
 * сообщения ИЛИ admin/developer.
 *
 * 🔴 Wire-поле — `id`, НЕ `message_id` (desktop-only quirk, см. ApiClient.kt:281
 * и `handlers-feed.js:591`).
 */
export async function softDeleteMessage(client: ApiClient, messageId: number): Promise<void> {
  await client.call('soft_delete_message', { id: messageId });
}

// ── UNDELETE / EDIT ───────────────────────────────────────────────────────

/** Восстановить soft-deleted сообщение (7-sec undo). Permission: автор ИЛИ admin. */
export async function undeleteMessage(client: ApiClient, messageId: number): Promise<void> {
  await client.call('undelete_message', { id: messageId });
}

/**
 * Редактировать текст. Server enforce'ит edit window (обычно несколько часов).
 * Permission: автор сообщения ИЛИ admin/developer.
 */
export async function editMessage(
  client: ApiClient,
  req: { id: number; text: string },
): Promise<{ id: number; text: string }> {
  const wire = await client.call<{ id: number; text: string }>('edit_message', {
    id: req.id,
    text: req.text,
  });
  return { id: wire.id, text: wire.text };
}

// ── STATS (admin/developer only) ──────────────────────────────────────────

export interface NewsReaderWire {
  user_login: string;
  full_name?: string;
  read_at?: string;
}

export interface NewsReadersResponse {
  news: NewsItemWire;
  count: number;
  readUsers: NewsReaderWire[];
  unreadUsers: NewsReaderWire[];
}

/**
 * Список тех, кто прочитал и не прочитал новость. Admin-only.
 * Используется в NewsStatsDialog → Statistics tab.
 */
export async function getNewsReaders(
  client: ApiClient,
  messageId: number,
): Promise<NewsReadersResponse> {
  const wire = await client.call<{
    data?: {
      news: NewsItemWire;
      count: number;
      read_users: NewsReaderWire[];
      unread_users: NewsReaderWire[];
    };
  }>('get_news_readers', { message_id: messageId });
  const d = wire.data;
  if (!d) throw new Error('get_news_readers: empty data');
  return {
    news: d.news,
    count: d.count,
    readUsers: d.read_users ?? [],
    unreadUsers: d.unread_users ?? [],
  };
}

export interface PollVoterWire {
  user_login: string;
  full_name?: string;
  option_id: number;
  voted_at?: string;
}

export interface PollStatsResponse {
  poll: PollWire;
  totalVoters: number;
  options: PollOptionWire[];
  voters: PollVoterWire[];
  nonVoters: NewsReaderWire[];
}

/** Детальная статистика опроса. Admin-only. */
export async function getPollStats(
  client: ApiClient,
  pollId: number,
): Promise<PollStatsResponse> {
  const wire = await client.call<{
    data?: {
      poll: PollWire;
      total_voters: number;
      options: PollOptionWire[];
      voters: PollVoterWire[];
      non_voters: NewsReaderWire[];
    };
  }>('get_poll_stats', { poll_id: pollId });
  const d = wire.data;
  if (!d) throw new Error('get_poll_stats: empty data');
  return {
    poll: d.poll,
    totalVoters: d.total_voters,
    options: d.options,
    voters: d.voters ?? [],
    nonVoters: d.non_voters ?? [],
  };
}
