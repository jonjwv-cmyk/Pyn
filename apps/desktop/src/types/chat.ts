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
  /**
   * §pyn-1.2.27 — raw server timestamp последнего сообщения. Раньше тут
   * лежал pre-formatted label («5 мая, 2:34 PM») что ломалось при смене
   * языка (store не пересчитывался). Теперь формат делает useFormatYek
   * в render time, reactive к i18n.language.
   */
  lastMessageAt: string;
  /**
   * Raw server timestamp последнего онлайна (для presence-label в header'е
   * чата). Пусто если сервер не вернул значение.
   */
  lastSeenAt?: string;
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
  /**
   * Сырая server-метка `YYYY-MM-DD HH:MM:SS` (Yek-локаль). Нужна для группировки
   * сообщений по дням (date-разделители «Сегодня» / «Вчера» / «5 мая»).
   * `time` уже отформатированная строка — для разделителей не годится.
   */
  createdAt?: string;
  /**
   * Прочитано ли сообщение получателем. Используется для Telegram-style
   * read-receipts на own-bubbles: одна галочка = доставлено, две = прочитано.
   * Заполняется только для own-сообщений (для чужих read-receipt не имеет
   * смысла — мы и так их прочитали).
   */
  isRead?: boolean;
  /**
   * Если сообщение — reply на другое, здесь preview (автор + первые 120 chars
   * текста). Server (`attachReplyPreview`) сам приgrab'ает из БД.
   */
  replyPreview?: {
    id: number;
    senderName: string;
    text: string;
  };
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
 * Тип прикрепления. Скриншот разбит на три sub-варианта (экран / окно /
 * область), потому что capture-логика различается на уровне OS API.
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

/** Лимит вложения — 100 MB (клиент + сервер). */
export const ATTACHMENT_MAX_SIZE = 100 * 1024 * 1024;
