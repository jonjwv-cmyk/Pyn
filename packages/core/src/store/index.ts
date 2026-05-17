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

export { createJSONStorage, type StateStorage, type PersistStorage } from 'zustand/middleware';
