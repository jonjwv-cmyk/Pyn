import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { UserSummary } from '../endpoints/admin';

/**
 * Кеш списка users — для lookup аватаров в местах, где server возвращает
 * только login (NewsStatsDialog, mention overlay, etc).
 *
 * Только админам доступно (`get_users` admin-only), для не-админов store
 * остаётся пустым.
 */

export const USERS_STALE_MS = 10 * 60 * 1000;

export interface UsersState {
  users: UserSummary[];
  lastFetchedAt: number | null;
  setUsers: (users: UserSummary[]) => void;
  clear: () => void;
}

const initializer: StateCreator<UsersState> = (set) => ({
  users: [],
  lastFetchedAt: null,
  setUsers: (users) => set({ users, lastFetchedAt: Date.now() }),
  clear: () => set({ users: [], lastFetchedAt: null }),
});

export function createUsersStore(
  storage?: PersistStorage<UsersState>,
): UseBoundStore<StoreApi<UsersState>> {
  if (!storage) return create<UsersState>()(initializer);
  return create<UsersState>()(
    persist(initializer, {
      name: 'pyn-users-cache',
      storage,
      version: 1,
    }),
  );
}

export function isUsersStale(lastFetchedAt: number | null, ttlMs = USERS_STALE_MS): boolean {
  return lastFetchedAt === null || Date.now() - lastFetchedAt > ttlMs;
}
