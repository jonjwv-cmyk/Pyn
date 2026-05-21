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
  /**
   * Kill switch / app lock state changed. Шлётся при activate/deactivate
   * developer'ом и при auto-trigger wipe (когда wipe_at истёк). Клиент
   * показывает overlay (paused) или стирает данные (wiping).
   */
  APP_CONTROL_STATE_CHANGED: 'app_control_state_changed',
  /**
   * Новая версия приложения опубликована (set_app_version / broadcast_app_version).
   * Сервер шлёт всем подключённым клиентам — desktop клиент re-checks appStatus
   * и сразу показывает «Доступно обновление» pill без 30-мин polling-окна.
   */
  APP_VERSION_CHANGED: 'app_version_changed',
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

/**
 * Kill switch state changed (2026-05-20). Возможные значения `state`:
 *   • 'normal'  — блокировка снята (developer cancel'нул)
 *   • 'paused'  — активна блокировка, до wipe_at countdown идёт
 *   • 'wiping'  — wipe_at истёк, сервер триггерит стирание данных
 *   • 'wiped'   — клиенты подтвердили wipe (terminal на сервере)
 *
 * `wipe_at` — ISO datetime когда сервер триггернёт wiping. Null если state=normal.
 * `scope` — обычно 'global'; legacy scope'ы (main, desktop-win, …) присылают
 * тот же event type для back-compat Android maintenance pause.
 */
export interface AppControlStateChangedEvent extends WsServerEvent {
  type: 'app_control_state_changed';
  scope: string;
  state: 'normal' | 'paused' | 'wiping' | 'wiped' | string;
  title: string;
  message: string;
  wipe_at?: string | null;
  initiated_by?: string;
}

/**
 * Опубликована новая версия приложения. `scope` — какая платформа задета
 * (`main` для Android, `desktop-mac` / `desktop-win` для desktop).
 * Клиент должен пере-вызвать `appStatus` (а не доверять данным из event'a),
 * чтобы получить полный response с update_url + binary_sha.
 */
export interface AppVersionChangedEvent extends WsServerEvent {
  type: 'app_version_changed';
  scope: string;
  current_version: string;
  min_version?: string;
  force_update?: number;
}
