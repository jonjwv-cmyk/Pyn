import {
  createChatsStore,
  createMolStore,
  createNewsStore,
  createOutboxStore,
  createSessionInfoStore,
  createStatsStore,
  createUiStateStore,
  createUsersStore,
  type ChatsState,
  type NewsState,
  type OutboxState,
  type UiState,
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
/** Без persist — session info актуален только пока сессия живёт. */
export const useSessionInfoStore = createSessionInfoStore();
/**
 * МОЛ-store без persist — большой encoded JSON хранится через `pyn:cache`
 * напрямую (там safeStorage encrypted blob, эффективнее чем JSON через
 * persist middleware). На mount mol-repo загружает кеш в store.
 */
export const useMolStore = createMolStore();
/**
 * UI-state — где юзер был, что искал, scroll-position. Persist через
 * safeStorage чтобы при следующем запуске Pyn'a continuation работал:
 * возвращаемся ровно туда где закрыли (раздел, чат, MOL query, scroll).
 */
export const useUiStateStore = createUiStateStore(createCacheStorage<UiState>());
/**
 * Outbox — отложенная отправка сообщений когда нет сети. Persist'ится
 * чтобы pending'и переживали restart Pyn'a.
 */
export const useOutboxStore = createOutboxStore(createCacheStorage<OutboxState>());
/**
 * Stats / reactions — in-memory cache. При open диалога статистики или попапа
 * реакций UI рендерит cached snapshot мгновенно, fetch идёт silent в фоне.
 * WS news_update event инвалидирует записи по messageId.
 */
export const useStatsStore = createStatsStore();
