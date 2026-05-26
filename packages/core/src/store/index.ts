/**
 * @pyn/core/store — Zustand-based stale-while-revalidate cache для UI.
 *
 * Store-factories принимают опциональный `PersistStorage` adapter — на
 * desktop'е оборачиваем IPC + safeStorage, на mobile'е будет expo-secure-store.
 * Без adapter'а stores in-memory only (тесты, fallback).
 *
 * Re-exports zustand middleware так, чтобы apps не дублировали dependency.
 */
export {
  createNewsStore,
  isNewsStale,
  NEWS_STALE_MS,
  type NewsState,
} from './news-store';

export {
  createChatsStore,
  isChatsStale,
  CHATS_STALE_MS,
  CHAT_MESSAGES_STALE_MS,
  type ChatsState,
} from './chats-store';

export {
  createUsersStore,
  isUsersStale,
  USERS_STALE_MS,
  type UsersState,
} from './users-store';

export {
  createSessionInfoStore,
  type SessionInfoState,
} from './session-info-store';

export {
  createMolStore,
  type MolState,
  type MolLoadStatus,
  type MolRefreshOutcome,
} from './mol-store';

export {
  createUiStateStore,
  type UiState,
} from './ui-state-store';

export {
  createOutboxStore,
  type OutboxState,
  type PendingOutgoing,
  type PendingAttachmentLite,
} from './outbox-store';

export {
  createStatsStore,
  type StatsState,
} from './stats-store';

export {
  createPresenceStore,
  type PresenceState,
  type PresenceInfo,
  type PresenceEntry,
  type PresenceStatus,
} from './presence-store';

export {
  useSheetsLockStore,
  type SheetLock,
  type SheetsLockState,
} from './sheets-lock-store';

export {
  useAppLockStore,
  type AppLockScopeData,
  type AppLockStoreState,
} from './app-lock-store';

export { useStorageStore } from './storage-store';
// AppLockState и AppLockScope экспортируются через endpoints/app-lock —
// тут не реэкспортируем чтобы не было дубликатов в re-export цепочке index.ts.

export { createJSONStorage, type StateStorage, type PersistStorage } from 'zustand/middleware';

// Re-export raw zustand для downstream-пакетов (desktop / mobile) которые
// делают свои inline-store'ы (например `useWarehousesStore` в desktop) и
// не хотят добавлять зависимость на пакет zustand напрямую — берут через
// @pyn/core. Так workspace остаётся single-source для версии zustand.
export { create as createZustandStore } from 'zustand';
