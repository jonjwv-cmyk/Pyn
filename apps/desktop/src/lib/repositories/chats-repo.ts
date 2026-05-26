import type { ChatMessageWire } from '@pyn/core';
import type { ChatMessageItem, ChatPartner, ChatPartnerType } from '@/types/chat';
import { computeInitials } from '@/lib/initials';
import { formatTimeYek } from '@/lib/format-time';
import { normalizePresence } from '@/types/presence';

/**
 * `get_admin_messages` возвращает последнее сообщение для каждого peer'a (а
 * не aggregated conversation). Этот helper берёт одно сообщение и формирует
 * ChatPartner-row для левого списка.
 *
 * Peer определяется по перспективе текущего пользователя:
 *   • Если мы прислали (sender == myLogin) → peer = receiver
 *   • Иначе peer = sender (тот кто нам написал)
 *
 * Категория (user vs client) выводится из `sender_role` (или `receiver_role`,
 * если у нас он есть). `client` = внешний клиент → блок «Клиенты»,
 * остальные → «Экспедиторы».
 */
export function wireToChatPartnerFromMessage(wire: ChatMessageWire, myLogin: string): ChatPartner {
  const isOwn = wire.sender_login === myLogin;
  const peerLogin = isOwn ? (wire.receiver_login ?? '') : wire.sender_login;
  const peerName = isOwn
    ? peerLogin
    : (wire.sender_name ?? wire.sender_login);
  const peerRole = isOwn ? undefined : wire.sender_role;
  const peerPresence = isOwn
    ? wire.receiver_presence_status
    : wire.sender_presence_status;
  // Аватар берём с той же стороны, что и presence: если peer — receiver,
  // то receiver_avatar_*; иначе sender_avatar_*.
  const peerAvatarUrl = isOwn ? wire.receiver_avatar_url : wire.sender_avatar_url;
  const peerAvatarBlobKey = isOwn
    ? wire.receiver_avatar_blob_key_b64
    : wire.sender_avatar_blob_key_b64;
  const peerAvatarBlobNonce = isOwn
    ? wire.receiver_avatar_blob_nonce_b64
    : wire.sender_avatar_blob_nonce_b64;
  const peerLastSeenAt = isOwn ? wire.receiver_last_seen_at : wire.sender_last_seen_at;

  return {
    id: peerLogin,
    type: roleToPartnerType(peerRole),
    name: peerName,
    initials: computeInitials(peerName),
    avatarUrl: peerAvatarUrl || undefined,
    avatarBlobKey: peerAvatarBlobKey || undefined,
    avatarBlobNonce: peerAvatarBlobNonce || undefined,
    lastMessage: wire.text,
    // §pyn-1.2.27 — raw timestamps. Format делает useFormatYek в render
    // (reactive к смене языка).
    lastMessageAt: wire.created_at ?? '',
    lastSeenAt: peerLastSeenAt || undefined,
    unreadCount: wire.unread_count ?? 0,
    // §pyn-1.2.37 — normalize: server шлёт 'paused' для background, маппим
    // в 'away'. Без этого жёлтая точка прозрачная (class не сматчился).
    presence: normalizePresence(peerPresence),
  };
}

/** Один message из `get_admin_chat` → ChatMessageItem для bubble-ленты. */
export function wireToChatMessage(wire: ChatMessageWire, myLogin: string): ChatMessageItem {
  const isOwn = wire.sender_login === myLogin;
  return {
    id: String(wire.id),
    numericId: wire.id,
    authorId: isOwn ? 'me' : wire.sender_login,
    text: wire.text,
    // §2026-05-19 — Только время (без даты). Дата отображается отдельно
    // через DateDivider между группами + sticky day pill при скролле
    // (Telegram-style). Раньше formatFullYek давал "17 апреля, 9:49 PM"
    // и эта длинная плашка перекрывала media / прерывала text-bubble.
    time: wire.created_at ? formatTimeYek(wire.created_at) : '',
    createdAt: wire.created_at,
    // ⚠️ Сервер шлёт `is_read` как viewer-flag (своё всегда = 1; чужое = 1
    // если viewer уже прочитал). Это НЕ read-receipt получателя.
    // Реальный сигнал "получатель открыл моё сообщение" — `status === 'read'`
    // (см. `handlers-chat.js`: статус меняется через `mark_message_read`).
    // Только это поле даёт Telegram-style ✓✓ корректно.
    isRead: wire.status === 'read',
    replyPreview: wire.reply_preview
      ? {
          id: wire.reply_preview.id,
          senderName: wire.reply_preview.sender_name ?? '',
          text: wire.reply_preview.text,
        }
      : undefined,
    isOwn,
    attachments: (wire.attachments ?? []).map((a) => ({
      id: a.file_url,
      filename: a.file_name,
      size: a.file_size,
      mimeType: a.file_type,
      url: a.file_url,
      blobKey: a.blob_key_b64,
      blobNonce: a.blob_nonce_b64,
    })),
    reactions: wire.reactions && typeof wire.reactions === 'object' ? wire.reactions : {},
    myReactions: wire.my_reactions ?? [],
  };
}

function roleToPartnerType(role: string | undefined): ChatPartnerType {
  return role === 'client' ? 'client' : 'user';
}
