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
  /**
   * §pyn-1.2.39 — server broadcast при `mark_message_read` чат-сообщения.
   * Идёт В ДОБАВОК к generic `unread_update`. Отличие: содержит конкретный
   * `message_id` + `reader_login` → отправитель моментально проставит ✓✓
   * в открытом чате без re-entry. `unread_update` остаётся для counter sync.
   */
  MESSAGE_READ: 'message_read',
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
  /** Изменилась база складов («Цеха») — правка карточки / импорт. Клиент refetch'ит. */
  WAREHOUSES_CHANGED: 'warehouses_changed',
  /** Изменилась база ПЕРСОН (вкладка «Контакты») — правка/создание контакта. */
  PERSONS_CHANGED: 'persons_changed',
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
  /**
   * §TZ-SERVER-SYNC-COLLAB этап B — server broadcast после successful PUT
   * на /schedule/put. Все клиенты сравнивают payload.version с локальной;
   * если новее → refetch (или sister-инстанс sender'а уже знает новую version
   * из PUT response и skip'ит). Включает (year, month) для адресной фильтрации.
   */
  SCHEDULE_STATE_CHANGED: 'schedule_state_changed',
  /**
   * §TZ-SERVER-SYNC-COLLAB этап C — захвачен collaboration lock на resource.
   * Payload содержит user info для overlay'я (avatar + name) без нужды в
   * отдельном get_user lookup'е. Sender игнорирует через сравнение user_login.
   */
  SCHEDULE_LOCK_ACQUIRED: 'schedule_lock_acquired',
  /**
   * §TZ-SERVER-SYNC-COLLAB этап C — освобождён lock (explicit release или
   * lease expired через cleanup cron). Клиенты с активным overlay для этого
   * resource_id убирают overlay.
   */
  SCHEDULE_LOCK_RELEASED: 'schedule_lock_released',
  /**
   * Раздел «Поток» (Этап 1 Формирование) — строки изменены (правка/реалтайм).
   * Сервер шлёт актуальные строки всем после flow_workflow_edit; клиент применяет
   * по id, если row_version новее (sender'у прилетает своё — идемпотентно, skip).
   */
  FLOW_CHANGED: 'flow_changed',
  /**
   * Раздел «Поток» — сменён ОБЩИЙ месяц формирования (flow_plan_month_set). Шлётся
   * всем: клиенты обновляют выбранный месяц (+ аватар автора) и пересчитывают CLST.
   */
  FLOW_PLAN_MONTH_CHANGED: 'flow_plan_month_changed',
  /**
   * Раздел «Поток» — изменён ОБЩИЙ вид (фильтры/сортировка/масштаб, flow_view_set).
   * Шлётся всем: клиенты в режиме «Общий» применяют вид и обновляют аватар автора.
   * Чисто UI — строки таблицы не трогает.
   */
  FLOW_VIEW_CHANGED: 'flow_view_changed',
  /**
   * База ВГХ (вес/габариты/объём/тех-имя) изменена — правка карточки или перенос
   * из промежуточного листа. Шлёт актуальные строки базы; клиенты обновляют стор
   * (→ пересчёт KG/V и тех-имени в формировании реалтайм).
   */
  VGH_CHANGED: 'vgh_changed',
  /**
   * Промежуточный лист ВГХ изменён — правки грида / перенос / пересбор из
   * формирования. `rows` — изменённые строки; `full:true` — клиенту перечитать лист.
   */
  VGH_STAGING_CHANGED: 'vgh_staging_changed',
  /**
   * Завершён прогон выгрузки заказов (раздел LOG) — `run` с итогами (кто/когда/
   * сколько). Клиенты с открытым LOG добавляют запись сверху реалтайм.
   */
  FLOW_IMPORT_LOGGED: 'flow_import_logged',
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

/**
 * §pyn-1.2.39 — chat-сообщение прочитано получателем. Используется для
 * мгновенной простановки ✓✓ у отправителя в открытом чате (Telegram-style).
 * Шлётся ТОЛЬКО для чат-сообщений; для news/poll использует generic
 * `unread_update` без id.
 */
export interface MessageReadEvent extends WsServerEvent {
  type: 'message_read';
  message_id: number;
  /** Login юзера который прочитал — peer (получатель сообщения). */
  reader_login: string;
  /** Login автора сообщения — нужен клиенту чтобы понять "это моё сообщение?". */
  sender_login: string;
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
  /** §pyn-1.2.21 — counts от сервера, чтобы клиент мгновенно показал diff. */
  records_count?: number | null;
  previous_records_count?: number | null;
  diff_count?: number | null;
}

/** Строки «Потока» изменены — рассылка актуальных строк (по id, с row_version) +
 *  опц. id удалённых строк (мусорные/перенесённые OFF при подгрузке). */
export interface FlowChangedEvent extends WsServerEvent {
  type: 'flow_changed';
  rows: Array<{ id: number; row_version: number; [key: string]: unknown }>;
  deleted?: number[];
}

/** Сменён общий месяц формирования «Потока» — у всех обновить месяц + CLST. */
export interface FlowPlanMonthChangedEvent extends WsServerEvent {
  type: 'flow_plan_month_changed';
  year: number;
  month: number;
  updated_by: string;
  updated_by_name: string;
  updated_at: string;
}

/** Изменён общий «вид» (фильтры/сортировка/масштаб) «Потока» — у всех применить +
 *  обновить аватар автора. `value` — JSON-строка вида (пусто — вид сброшен). Чисто UI. */
export interface FlowViewChangedEvent extends WsServerEvent {
  type: 'flow_view_changed';
  value: string;
  updated_by: string;
  updated_by_name: string;
  updated_at: string;
}

export interface WarehousesChangedEvent extends WsServerEvent {
  type: 'warehouses_changed';
  version?: string;
  updated_by?: string;
  updated_by_name?: string;
}

/** База ВГХ изменена — рассылка актуальных строк базы (по no_num, с row_version). */
export interface VghChangedEvent extends WsServerEvent {
  type: 'vgh_changed';
  rows: Array<{ no_num: string; row_version: number; [key: string]: unknown }>;
}

/** Промежуточный лист ВГХ изменён — изменённые строки (`rows`) или сигнал перечитать (`full`). */
export interface VghStagingChangedEvent extends WsServerEvent {
  type: 'vgh_staging_changed';
  rows?: Array<{ no_num: string; row_version: number; [key: string]: unknown }>;
  full?: boolean;
}

/** Завершён прогон выгрузки заказов — запись журнала (раздел LOG) для live-добавления. */
export interface FlowImportLoggedEvent extends WsServerEvent {
  type: 'flow_import_logged';
  run: {
    id: number;
    login: string;
    full_name: string;
    started_at: string;
    finished_at: string;
    received: number;
    inserted: number;
    updated: number;
    off_marked: number;
    reappeared: number;
    to_changed: number;
    staging_upserted: number;
  };
}

export interface PersonsChangedEvent extends WsServerEvent {
  type: 'persons_changed';
  version?: string;
  updated_by?: string;
  updated_by_name?: string;
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
  /** §pyn-1.2.43 — login для presence/avatar lookup в SheetsLockOverlay. */
  user_login?: string;
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

/**
 * §TZ-SERVER-SYNC-COLLAB этап B (2026-05-27) — изменён snapshot графика за
 * (year, month). Клиенты у которых открыт этот же месяц И version устаревшая
 * выполняют `scheduleGet` чтобы подтянуть свежий state.
 *
 * Sender также получает event (server'у дешевле broadcast всем чем filtering
 * по connection ID). На клиенте дедупликация через сравнение версий:
 * если event.version <= localVersion → skip.
 */
export interface ScheduleStateChangedEvent extends WsServerEvent {
  type: 'schedule_state_changed';
  year: number;
  month: number;
  version: number;
  /** Login юзера, чьим PUT'ом был триггер. Может быть пустым. */
  updated_by?: string;
  /** Имя юзера для UI отображения «{name} обновил график». */
  updated_by_name?: string;
}

/**
 * §TZ-SERVER-SYNC-COLLAB этап C (2026-05-27) — захвачен collaboration lock
 * на конкретный resource_id (e.g. 'schedule:2026-05:exceptions'). Все клиенты
 * у которых открыт этот же resource заблокируют UI с overlay'ем (если они НЕ
 * owner). Sender игнорирует через сравнение `user_login`.
 *
 * Avatar fields копируются из users.avatar_* колонок в момент acquire'а —
 * клиент рендерит overlay сразу, без дополнительного get_users lookup'а.
 */
export interface ScheduleLockAcquiredEvent extends WsServerEvent {
  type: 'schedule_lock_acquired';
  resource_id: string;
  user_login: string;
  full_name: string;
  avatar_url?: string;
  avatar_blob_key?: string;
  avatar_blob_nonce?: string;
}

/**
 * §TZ-SERVER-SYNC-COLLAB этап C — освобождён lock (explicit release owner'ом
 * ИЛИ TTL expired через cleanup cron). Клиенты с активным overlay для этого
 * resource убирают overlay и разрешают редактирование.
 */
export interface ScheduleLockReleasedEvent extends WsServerEvent {
  type: 'schedule_lock_released';
  resource_id: string;
}
