import type { NewsItemWire, PollWire, NewsItem, Poll } from '@pyn/core';
import { wireToAttachment } from '@/lib/attachment-wire';
import { computeInitials } from '@/lib/initials';
import { formatFullYek } from '@/lib/format-time';
import { normalizePresence } from '@/types/presence';

/**
 * Repository: wire DTO от сервера (`get_news`) → domain модель для UI.
 *
 * Wire — snake_case + int 0/1 для bool полей. Domain — camelCase + boolean.
 */
export function wireToNewsItem(wire: NewsItemWire, myLogin: string): NewsItem {
  const senderName = wire.sender_name ?? wire.sender_login ?? 'Неизвестно';
  return {
    id: wire.id,
    kind: wire.kind,
    senderLogin: wire.sender_login ?? '',
    senderName,
    senderInitials: computeInitials(senderName),
    senderAvatarUrl: wire.sender_avatar_url ?? '',
    senderAvatarBlobKey: wire.sender_avatar_blob_key_b64,
    senderAvatarBlobNonce: wire.sender_avatar_blob_nonce_b64,
    senderPresence: normalizePresence(wire.sender_presence_status),
    text: wire.text,
    createdAt: wire.created_at ?? '',
    createdAtLabel: wire.created_at ? formatFullYek(wire.created_at) : '',
    isRead: (wire.is_read ?? 0) === 1,
    isPinned: (wire.is_pinned ?? 0) === 1,
    reactions: wire.reactions && typeof wire.reactions === 'object' ? wire.reactions : {},
    myReactions: wire.my_reactions ?? [],
    attachments: (wire.attachments ?? []).map(wireToAttachment),
    poll: wire.poll ? wireToPoll(wire.poll) : null,
    isOwn: wire.sender_login === myLogin,
  };
}

function wireToPoll(wire: PollWire): Poll {
  // 🔴 Поля разные между server-версиями (см. PollWire JSDoc):
  //   • title (новое) или question (legacy)
  //   • option_text (новое) или text (legacy) на опциях
  //   • is_selected (boolean per option) или my_vote_option_id (legacy)
  //   • selected_option_ids (массив) — авторитативный источник для multi-choice
  //   • total_votes (новое, count unique voters) или total_voters (legacy)
  //   • is_active может быть int 0/1 или boolean
  // Нормализуем всё к одной camelCase domain-модели.
  const options = wire.options.map((o) => ({
    id: o.id,
    text: o.option_text ?? o.text ?? '',
    votesCount: o.votes_count,
  }));
  // Single-choice: первый is_selected option или первый selected_option_id.
  const selectedFromIds =
    Array.isArray(wire.selected_option_ids) && wire.selected_option_ids.length > 0
      ? wire.selected_option_ids[0] ?? null
      : null;
  const selectedFromOpt = wire.options.find((o) => o.is_selected === true)?.id ?? null;
  const myVoteOptionId =
    selectedFromIds ?? selectedFromOpt ?? wire.my_vote_option_id ?? null;
  // Total voters: уникальные юзеры. Берём приоритетнее всего total_votes,
  // потом total_voters (legacy). Sum votesCount как fallback.
  const totalVoters =
    wire.total_votes ??
    wire.total_voters ??
    options.reduce((s, o) => s + o.votesCount, 0);
  return {
    id: wire.id,
    question: wire.title ?? wire.question ?? '',
    description: wire.description ?? '',
    options,
    myVoteOptionId,
    totalVoters,
    isActive: wire.is_active === 1 || wire.is_active === true,
  };
}

