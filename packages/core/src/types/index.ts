/**
 * Domain types для раздела Новости. Семантически портированы из
 * OTLHelper2/data/feed/NewsRepository.kt. Используются и в desktop, и в mobile.
 */

export type NewsKind = 'news' | 'poll';

export type SenderPresence = 'online' | 'away' | 'offline';

export interface PollOption {
  id: number;
  text: string;
  votesCount: number;
}

export interface Poll {
  id: number;
  question: string;
  description: string;
  options: PollOption[];
  /** ID опции, за которую голосовал текущий пользователь (null — не голосовал). */
  myVoteOptionId: number | null;
  totalVoters: number;
  /** Открыт ли опрос для голосования. */
  isActive: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  /** Base64 AES-256 key для расшифровки blob'a. */
  blobKey?: string;
  /** Base64 12-byte nonce. */
  blobNonce?: string;
}

export interface NewsItem {
  id: number;
  kind: NewsKind;
  senderLogin: string;
  senderName: string;
  /** 1-2 буквы для рендера Avatar fallback'a (когда нет реального URL). */
  senderInitials: string;
  senderAvatarUrl: string;
  /** Base64 AES-256 key для расшифровки зашифрованного аватара (Pyn server). */
  senderAvatarBlobKey?: string;
  /** Base64 12-byte nonce. */
  senderAvatarBlobNonce?: string;
  senderPresence: SenderPresence;
  text: string;
  /** ISO timestamp от сервера. */
  createdAt: string;
  /** Локализованная метка ("сегодня в 11:00", "вчера", "13.05"). */
  createdAtLabel: string;
  isRead: boolean;
  isPinned: boolean;
  /** Агрегат реакций: emoji → count. */
  reactions: Record<string, number>;
  /** Эмодзи, поставленные текущим пользователем. */
  myReactions: string[];
  attachments: Attachment[];
  /** null для kind='news', объект для kind='poll'. */
  poll: Poll | null;
  isOwn: boolean;
}

/** Минимальная инфа о пользователе — для not-read/not-voted списков. */
export interface NewsViewerSummary {
  userId: string;
  name: string;
  initials: string;
}

/** Пользователь, прочитавший новость. */
export interface NewsReader extends NewsViewerSummary {
  /** "15.05 14:32" — локализованная метка времени прочтения. */
  readAtLabel: string;
}

/** Статистика news (kind='news'). Загружается отдельно при открытии диалога. */
export interface NewsStats {
  readers: NewsReader[];
  notReaders: NewsViewerSummary[];
}

/** Проголосовавший в опросе пользователь. */
export interface PollVoter extends NewsViewerSummary {
  /** ID выбранных опций (multi-vote опросы — будущий case). */
  votedOptionIds: number[];
  votedAtLabel: string;
}

/** Статистика poll (kind='poll'). */
export interface PollStats {
  voters: PollVoter[];
  notVoters: NewsViewerSummary[];
}
