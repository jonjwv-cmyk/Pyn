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
  /**
   * Текст варианта. Сервер шлёт `option_text` (см. `server-modular/db.js`
   * `attachPolls`); более новые версии могут слать `text`. Kotlin-клиент
   * читает оба варианта (`option_text || text`), мы делаем то же.
   */
  text?: string;
  option_text?: string;
  votes_count: number;
  /** `true` если viewer проголосовал за эту опцию. Авторитативный источник для my-vote highlight. */
  is_selected?: boolean;
}

/**
 * Server (`db.js::attachPolls`) шлёт:
 *   • `title` (не `question`)
 *   • `is_active`: int 0/1
 *   • `total_votes` + `total_selections` (не `total_voters`)
 *   • `has_voted` + `selected_option_ids[]` (новый формат)
 *   • На опциях — `is_selected: boolean`
 *
 * Старые wire-поля (`question`, `my_vote_option_id`, `total_voters`,
 * `is_active: boolean`) держим в типе как optional — на случай если где-то
 * остался legacy-формат. `wireToPoll` нормализует к одной camelCase-модели.
 */
export interface PollWire {
  id: number;
  poll_id?: number;
  title?: string;
  question?: string;
  description?: string;
  options: PollOptionWire[];
  /** Single-choice: первый из массива. Multi-choice: пока не используется. */
  selected_option_ids?: number[];
  my_vote_option_id?: number | null;
  has_voted?: boolean;
  total_votes?: number;
  total_voters?: number;
  total_selections?: number;
  is_active?: boolean | number;
  selection_mode?: string;
  can_vote?: boolean;
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

// ── CREATE_NEWS_POLL ───────────────────────────────────────────────────────

export interface CreateNewsPollRequest {
  /** Текст вопроса. В Kotlin отдаётся одновременно как title и description. */
  question: string;
  /** Варианты ответа. Будут trim'нуты и отфильтрованы (≥2 непустых). */
  options: string[];
}

export interface CreateNewsPollResponse {
  messageId: number;
  pollId: number;
}

/**
 * Создать опрос (новость с poll). Минимум 2 непустых варианта — иначе сервер
 * вернёт `poll_payload_invalid`. Permission: admin/developer (как `send_news`).
 *
 * После создания сервер broadcastит `news_update` — feed автоматически
 * подтянется через WS-listener.
 */
export async function createNewsPoll(
  client: ApiClient,
  req: CreateNewsPollRequest,
): Promise<CreateNewsPollResponse> {
  const cleanOptions = req.options.map((o) => o.trim()).filter((o) => o.length > 0);
  if (cleanOptions.length < 2) {
    throw new Error('poll_options_min_2');
  }
  if (!req.question.trim()) {
    throw new Error('poll_question_empty');
  }
  const wire = await client.call<{
    data?: { message_id?: number; poll_id?: number };
  }>('create_news_poll', {
    title: req.question.trim(),
    description: req.question.trim(),
    options: cleanOptions,
  });
  if (!wire.data || typeof wire.data.message_id !== 'number') {
    throw new Error('create_news_poll: empty data');
  }
  return {
    messageId: wire.data.message_id,
    pollId: Number(wire.data.poll_id ?? 0),
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
  /** §pyn-1.2.40 — presence для PresenceDot в NewsStatsDialog. */
  presence_status?: 'online' | 'away' | 'offline';
  last_seen_at?: string;
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
  role?: string;
  /**
   * IDs выбранных опций. Server `handleGetPollStats` сейчас отдаёт массив
   * (для multi-choice опросов в будущем); single-choice — длина 1.
   * Legacy `option_id` поддерживается на случай старой версии сервера.
   */
  selected_option_ids?: number[];
  /** Готовые тексты выбранных опций — JOIN на server'е, lookup не нужен. */
  selected_option_texts?: string[];
  option_id?: number;
  voted_at?: string;
  /** §pyn-1.2.40 — presence для PresenceDot в NewsStatsDialog. */
  presence_status?: 'online' | 'away' | 'offline';
  last_seen_at?: string;
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
