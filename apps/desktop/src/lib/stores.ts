import {
  createChatsStore,
  createNewsStore,
  createUsersStore,
  type ChatsState,
  type NewsState,
  type UsersState,
} from '@pyn/core';
import type { ChatMessageItem, ChatPartner } from '@/types/chat';
import { createCacheStorage } from './cache-storage';

/**
 * Singleton stores для desktop'a. Persistence — через safeStorage IPC.
 *
 * Использование в компонентах:
 *
 *   const items = useNewsStore((s) => s.items);
 *   const setItems = useNewsStore((s) => s.setItems);
 *
 * На logout — вызвать `useNewsStore.getState().clear()` + `clearAllCache()`.
 */

export const useNewsStore = createNewsStore(createCacheStorage<NewsState>());
export const useChatsStore = createChatsStore<ChatPartner, ChatMessageItem>(
  createCacheStorage<ChatsState<ChatPartner, ChatMessageItem>>(),
);
export const useUsersStore = createUsersStore(createCacheStorage<UsersState>());
