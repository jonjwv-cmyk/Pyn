/**
 * @pyn/core/api — HTTP client + transport + errors.
 *
 * Crypto interceptor (E2E X25519 + AES-GCM) добавится в stage 2 как обёртка
 * над transport — ApiClient.call останется тем же.
 */
export { ApiClient } from './client';
export { ApiError, ERROR_CODES, type ApiErrorCode } from './errors';
export type { ApiTransport, ApiCallOptions, ApiEnvelope } from './transport';
export {
  WS_EVENT_TYPES,
  type WsServerEvent,
  type WsEventType,
  type NewMessageEvent,
  type MessageReadEvent,
  type NewNewsEvent,
  type NewsUpdateEvent,
  type UnreadUpdateEvent,
  type PresenceChangeEvent,
  type BaseChangedEvent,
  type DesktopKickedEvent,
  type SheetLockAcquiredEvent,
  type SheetLockReleasedEvent,
  type AppControlStateChangedEvent,
  type AppVersionChangedEvent,
  type ScheduleStateChangedEvent,
  type ScheduleLockAcquiredEvent,
  type ScheduleLockReleasedEvent,
} from './ws-events';
