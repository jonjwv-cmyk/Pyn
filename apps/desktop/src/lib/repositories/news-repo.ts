import type {
  AttachmentWire,
  NewsItemWire,
  PollWire,
  Attachment,
  NewsItem,
  Poll,
} from '@pyn/core';
import { computeInitials } from '@/lib/initials';
import { formatFullYek } from '@/lib/format-time';

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
    senderPresence: wire.sender_presence_status ?? 'offline',
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

function wireToAttachment(wire: AttachmentWire): Attachment {
  return {
    id: wire.file_url,
    filename: wire.file_name,
    size: wire.file_size,
    mimeType: wire.file_type,
    url: wire.file_url,
    blobKey: wire.blob_key_b64,
    blobNonce: wire.blob_nonce_b64,
  };
}

function wireToPoll(wire: PollWire): Poll {
  return {
    id: wire.id,
    question: wire.question,
    description: wire.description ?? '',
    options: wire.options.map((o) => ({
      id: o.id,
      text: o.text,
      votesCount: o.votes_count,
    })),
    myVoteOptionId: wire.my_vote_option_id ?? null,
    totalVoters: wire.total_voters,
    isActive: wire.is_active,
  };
}

