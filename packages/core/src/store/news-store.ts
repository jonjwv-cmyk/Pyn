import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { NewsItem } from '../types';

/**
 * Stale-while-revalidate cache для ленты новостей.
 *
 * Сценарий:
 *   • Mount NewsFeed → читаем items из store, рендерим мгновенно
 *   • Параллельно: если `lastFetchedAt` старше TTL → triggered refetch → setItems
 *   • WS `new_news` / `news_update` → triggered refetch (через NewsFeed useWsEvent)
 *
 * Refetch policy и fetch'и живут вне store (в UI / lib) — store не имеет
 * зависимости от ApiClient'a. Это сохраняет @pyn/core shared между platforms.
 */

export const NEWS_STALE_MS = 5 * 60 * 1000;

export interface NewsState {
  items: NewsItem[];
  /** ms timestamp последней успешной выгрузки от сервера; null до первой. */
  lastFetchedAt: number | null;

  setItems: (items: NewsItem[]) => void;
  /** Точечный update одной записи (например после optimistic mutation). */
  updateItem: (id: number, patch: Partial<NewsItem>) => void;
  /** Удалить запись локально (для soft delete). */
  removeItem: (id: number) => void;
  /** Полная очистка — на logout / desktop_kicked. */
  clear: () => void;
}

const initializer: StateCreator<NewsState> = (set) => ({
  items: [],
  lastFetchedAt: null,

  setItems: (items) => set({ items, lastFetchedAt: Date.now() }),

  updateItem: (id, patch) =>
    set((s) => ({
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })),

  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
    })),

  clear: () => set({ items: [], lastFetchedAt: null }),
});

/**
 * Создать store с опциональным persist. Без storage — plain in-memory
 * (для tests / mobile если там другой persist backend).
 */
export function createNewsStore(
  storage?: PersistStorage<NewsState>,
): UseBoundStore<StoreApi<NewsState>> {
  if (!storage) return create<NewsState>()(initializer);
  return create<NewsState>()(
    persist(initializer, {
      name: 'pyn-news-cache',
      storage,
      version: 1,
    }),
  );
}

/** Проверка устаревания cache'a. */
export function isNewsStale(lastFetchedAt: number | null, ttlMs = NEWS_STALE_MS): boolean {
  return lastFetchedAt === null || Date.now() - lastFetchedAt > ttlMs;
}
