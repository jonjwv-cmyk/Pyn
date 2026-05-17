/**
 * Типы событий, прилетающих по WebSocket'у от сервера.
 *
 * Wire-формат — plain JSON (snake_case), точно как server отправляет в
 * `ws-room.js`. Caller'у в UI обычно достаточно знать `type` (для роутинга
 * к нужному виджету), плюс пары полей для оптимистичного апдейта.
 *
 * Полный список event'ов из OTLHelper2 ws-room + handlers-*:
 *   • new_message     — новое сообщение в чате admin/peer
 *   • new_news        — новая запись/опрос в ленте
 *   • news_pin        — toggled pin'а на новости
 *   • news_react      — добавлена/снята реакция
 *   • news_vote       — отголосовано в опросе
 *   • unread_update   — пересчёт unread counter'ов (no payload)
 *   • presence_change — login/last_seen изменился у юзера
 *   • typing_start    — пользователь начал печатать в чате
 *   • typing_stop     — закончил
 *   • base_changed    — admin обновил справочник МОЛ
 *   • desktop_kicked  — другая сессия с того же login'a выгнала нас
 */

/** Базовый shape — `type` плюс произвольные snake_case поля payload'a. */
export interface WsServerEvent {
  type: string;
  [k: string]: unknown;
}

/** Имена событий, которые мы знаем и обрабатываем. */
export const WS_EVENT_TYPES = {
  NEW_MESSAGE: 'new_message',
  NEW_NEWS: 'new_news',
  /**
   * Унифицированный update для feed-записей: реакция, голос, pin/unpin,
   * delete/undelete, edit. Точный sub-event — в поле `kind` payload'a.
   * Server использует один event type вместо отдельных news_pin/news_react/etc.
   */
  NEWS_UPDATE: 'news_update',
  UNREAD_UPDATE: 'unread_update',
  PRESENCE_CHANGE: 'presence_change',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
  BASE_CHANGED: 'base_changed',
  DESKTOP_KICKED: 'desktop_kicked',
  /** Запущен скрипт/макрос на листе — блокируем UI для всех клиентов. */
  SHEET_LOCK_ACQUIRED: 'sheet_lock_acquired',
  /** Скрипт/макрос завершился — снимаем блокировку. */
  SHEET_LOCK_RELEASED: 'sheet_lock_released',
} as const;

export type WsEventType = (typeof WS_EVENT_TYPES)[keyof typeof WS_EVENT_TYPES];

/**
 * Узкие типы для отдельных event'ов — полезно в местах роутинга, где
 * каст уже сделан через `event.type === 'new_message'`.
 */

export interface NewMessageEvent extends WsServerEvent {
  type: 'new_message';
  id: number;
  kind?: string;
  sender_login: string;
  receiver_login?: string;
}

export interface NewNewsEvent extends WsServerEvent {
  type: 'new_news';
  id: number;
  sender_login?: string;
}

/**
 * Server унифицирует все feed-mutation'ы в один event type. `kind` —
 * категория действия: `reaction` / `poll_vote` / `pin` / `unpin` /
 * `delete` / `undelete` / `edit`. UI'у обычно достаточно перечитать
 * целиком feed на любой `news_update`.
 */
export interface NewsUpdateEvent extends WsServerEvent {
  type: 'news_update';
  id: number;
  kind: string;
}

export interface UnreadUpdateEvent extends WsServerEvent {
  type: 'unread_update';
}

export interface PresenceChangeEvent extends WsServerEvent {
  type: 'presence_change';
  login: string;
  status: 'online' | 'away' | 'offline' | string;
  last_seen_at?: string;
}

export interface BaseChangedEvent extends WsServerEvent {
  type: 'base_changed';
  base_version: string;
  base_updated_at?: string;
}

export interface DesktopKickedEvent extends WsServerEvent {
  type: 'desktop_kicked';
  reason?: string;
}

/**
 * Сервер запустил скрипт/макрос — другие клиенты должны заблокировать
 * соответствующие листы. Initiator уже сделал optimistic acquire локально.
 */
export interface SheetLockAcquiredEvent extends WsServerEvent {
  type: 'sheet_lock_acquired';
  action_id: string;
  action_label: string;
  user_name: string;
  tab_name: string;
  locked_tabs: string[];
}

/**
 * Скрипт/макрос завершился — release lock на всех клиентах. `error`
 * присутствует если завершилось с ошибкой.
 */
export interface SheetLockReleasedEvent extends WsServerEvent {
  type: 'sheet_lock_released';
  action_id: string;
  error?: string;
}
