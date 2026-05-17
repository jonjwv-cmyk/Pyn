/**
 * Domain types для раздела Чаты. Будут портированы из OTLHelper2 ChatRepository
 * по мере подключения API. Сейчас — структура для mock-данных.
 */

import type { PresenceState } from './presence';

export type ChatPartnerType = 'user' | 'client';

export interface ChatPartner {
  id: string;
  type: ChatPartnerType;
  name: string;
  /** 1-2 буквы для аватара (например "АС" для "Анна Соколова"). */
  initials: string;
  /** URL зашифрованного аватара (нужен blobKey для расшифровки). */
  avatarUrl?: string;
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
  lastMessage: string;
  /** Локализованное время последнего сообщения ("5 мая, 2:34 PM"). */
  lastMessageTime: string;
  /**
   * Локализованное время последнего онлайна — для header'а "был в сети ...".
   * Берётся из server-side `last_seen_at`, НЕ из времени последнего сообщения.
   * Пустая строка / undefined если сервер не вернул значение.
   */
  lastSeenAtLabel?: string;
  unreadCount?: number;
  /** Состояние присутствия — всегда отображается точкой на аватаре. */
  presence: PresenceState;
}

export interface ChatMessageItem {
  id: string;
  /** Числовой server id (если есть — для API вызовов add_reaction etc). */
  numericId?: number;
  authorId: string;
  text: string;
  /** "12:34" — локальное время отправки. */
  time: string;
  /** true — сообщение текущего пользователя (справа), false — собеседника (слева). */
  isOwn: boolean;
  /** Файлы/изображения/видео, decrypt'ятся клиентом через blob_key+nonce. */
  attachments?: import('@pyn/core').Attachment[];
  /** Агрегат реакций: emoji → count. */
  reactions?: Record<string, number>;
  /** Emoji, поставленные текущим пользователем. */
  myReactions?: string[];
}

/**
 * Тип прикрепления, выбираемого в ChatAttachmentMenu. Скриншот разбит на
 * три sub-варианта (экран / окно / область), потому что capture-логика
 * различается на уровне OS API.
 */
export type AttachmentKind =
  | 'file'
  | 'media'
  | 'photo'
  | 'screenshot-screen'
  | 'screenshot-window'
  | 'screenshot-area';

/**
 * Прикрепление, добавленное в composer и ещё не отправленное. Хранится
 * в локальном state ChatComposer; на send уходит вместе с текстом.
 * category — для отрисовки чипа (image vs file иконка).
 *
 * При real upload (file picker) поля `dataUrl`/`mimeType`/`size` заполнены —
 * composer передаёт их в send_message/send_news body (server сам encrypt'ит
 * в R2, см. handlers/db.js::persistAttachmentIfNeeded).
 */
export interface PendingAttachment {
  id: string;
  kind: AttachmentKind;
  /** Отображаемое имя файла. */
  name: string;
  category: 'image' | 'file';
  /** `data:MIME;base64,…` URL — отправляется в attachments[].file_url. */
  dataUrl?: string;
  mimeType?: string;
  size?: number;
}

/** Server cap на attachment size — 20 MB (см. OTLHelper2 AttachmentComponents.kt). */
export const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024;
