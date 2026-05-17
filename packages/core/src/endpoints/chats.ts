import type { ApiClient } from '../api/client';
import type { AttachmentWire } from './news';

/**
 * Chat endpoints — wire-формат точно совпадает с server response.
 *
 * `get_admin_messages` возвращает **последнее сообщение от каждого peer'a**
 * (НЕ aggregated conversation). Список диалогов строится клиентом — peer'ом
 * считается `sender_login` (когда писали нам) или `receiver_login` (когда мы
 * писали). Для admin perspective receiver обычно "admins" (virtual mailbox).
 */

export interface ChatMessageWire {
  id: number;
  kind?: string;
  sender_login: string;
  sender_name?: string;
  sender_role?: string;
  sender_avatar_url?: string;
  sender_avatar_blob_key_b64?: string | null;
  sender_avatar_blob_nonce_b64?: string | null;
  sender_presence_status?: 'online' | 'away' | 'offline';
  sender_last_seen_at?: string;
  receiver_login?: string;
  receiver_avatar_url?: string;
  receiver_avatar_blob_key_b64?: string | null;
  receiver_avatar_blob_nonce_b64?: string | null;
  receiver_presence_status?: 'online' | 'away' | 'offline';
  receiver_last_seen_at?: string;
  text: string;
  status?: string;
  is_read?: number;
  reply_to_id?: number | null;
  created_at?: string;
  unread_count?: number;
  reactions?: Record<string, number>;
  my_reactions?: string[];
  attachments?: AttachmentWire[];
}

// ── GET_ADMIN_MESSAGES (последнее сообщение per peer) ──────────────────────

export interface GetAdminMessagesRequest {
  limit?: number;
}

export async function getAdminMessages(
  client: ApiClient,
  req: GetAdminMessagesRequest = {},
): Promise<ChatMessageWire[]> {
  const wire = await client.call<{ data?: ChatMessageWire[]; count?: number }>(
    'get_admin_messages',
    { limit: req.limit ?? 100 },
  );
  return wire.data ?? [];
}

// ── GET_ADMIN_CHAT (полная переписка с одним peer'ом) ─────────────────────

export interface GetAdminChatRequest {
  /** Login собеседника. Wire-поле — `user_login`. */
  userLogin: string;
  limit?: number;
}

export async function getAdminChat(
  client: ApiClient,
  req: GetAdminChatRequest,
): Promise<ChatMessageWire[]> {
  const wire = await client.call<{ data?: ChatMessageWire[]; count?: number }>(
    'get_admin_chat',
    { user_login: req.userLogin, limit: req.limit ?? 200 },
  );
  return wire.data ?? [];
}

// ── SEND_MESSAGE ───────────────────────────────────────────────────────────

export interface SendMessageRequest {
  /** Login получателя (wire-поле: `receiver_login`, НЕ `user_login`). */
  receiverLogin: string;
  text: string;
  replyToId?: number;
  localItemId?: string;
  /**
   * Attachments inline. `url` — это `data:MIME;base64,…` URL. Server сам
   * encrypt'ит и сохранит в R2 (см. `db.js::persistAttachmentIfNeeded`),
   * вернёт finalized URL + blob_key/nonce в response.
   */
  attachments?: Array<{
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

export interface SendMessageResponse {
  id: number;
  createdAt: string;
  localItemId?: string;
}

export async function sendMessage(
  client: ApiClient,
  req: SendMessageRequest,
): Promise<SendMessageResponse> {
  const wire = await client.call<{
    id: number;
    created_at?: string;
    local_item_id?: string;
  }>('send_message', {
    receiver_login: req.receiverLogin,
    text: req.text,
    reply_to_id: req.replyToId,
    local_item_id: req.localItemId,
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
    localItemId: wire.local_item_id,
  };
}

// ── MARK_MESSAGE_READ ──────────────────────────────────────────────────────

/**
 * Server-side wire-поле — `id` (универсально для новостей и chat-сообщений),
 * НЕ `message_id`. Подтверждено в `handlers-chat.js:297-347`.
 */
export async function markMessageRead(client: ApiClient, messageId: number): Promise<void> {
  await client.call('mark_message_read', { id: messageId });
}

// ── Legacy alias (old name expected by chats-repo before refactor) ─────────

/** @deprecated wire shape moved to ChatMessageWire; alias kept for incremental refactor. */
export type ConversationSummaryWire = ChatMessageWire;
