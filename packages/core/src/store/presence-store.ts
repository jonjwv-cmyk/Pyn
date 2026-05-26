import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

/**
 * §pyn-1.2.39 — Глобальный single source of truth для presence.
 *
 * Проблема которую решает:
 *   • До v1.2.39 presence жил параллельно в `useChatsStore.partners[].presence`
 *     (заполнялся из get_admin_messages) и `useUsersStore.users[].presenceStatus`
 *     (из get_users). Эти источники синхронизировались независимо: в Settings/
 *     Пользователи статус мог показываться offline (старый snapshot из get_users
 *     при login), а в Чатах для того же юзера online (свежий get_admin_messages).
 *   • WS push presence_change обновлял только partners, не users → Settings UI
 *     stale до следующего get_users (10 min TTL).
 *
 * Архитектура:
 *   • `byLogin: Record<login, PresenceInfo>` — единая Map, ключи — user.login.
 *   • Заполняется тремя источниками:
 *     1. `setMany([...])` — bulk fill из get_admin_messages / get_users / get_news_readers
 *     2. `setOne(login, status, lastSeenAt)` — WS push presence_change
 *     3. (server-side hello broadcasts тоже идут через #2 при receive)
 *   • Все UI компоненты (UserListRow, ChatList, ChatConversation, NewsStatsDialog)
 *     читают через `usePresenceStore((s) => s.byLogin[login])`.
 *   • Latest-write-wins по `updatedAt`: если приходит свежий WS push и медленный
 *     bulk fill из API завершился позже — не перетираем свежий push'ем стейл.
 *
 * Persist: да (safeStorage IPC). При cold start показываем последний known
 * статус мгновенно, пока WS не подтянет real-time. Если данные сильно
 * протухли — не страшно: WS hello/presence_change обновит в течение ~500ms.
 */

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceInfo {
  status: PresenceStatus;
  lastSeenAt: string;
  /** Monotonic timestamp (Date.now()) когда мы записали — для latest-write-wins. */
  updatedAt: number;
}

export interface PresenceEntry {
  login: string;
  /** Raw status от сервера ('online' | 'paused' | 'away' | 'offline' | ''). */
  status: string | null | undefined;
  lastSeenAt?: string | null | undefined;
}

export interface PresenceState {
  byLogin: Record<string, PresenceInfo>;
  /** Bulk fill — для после API запросов (get_users, get_admin_messages, get_news_readers). */
  setMany: (entries: PresenceEntry[]) => void;
  /** Точечное обновление — для WS push presence_change. */
  setOne: (login: string, status: string, lastSeenAt?: string) => void;
  /** Лукап с дефолтом offline если login неизвестен. */
  get: (login: string) => PresenceInfo;
  clear: () => void;
}

function normalize(raw: string | null | undefined): PresenceStatus {
  if (raw === 'online') return 'online';
  if (raw === 'paused' || raw === 'away') return 'away';
  return 'offline';
}

const DEFAULT_INFO: PresenceInfo = {
  status: 'offline',
  lastSeenAt: '',
  updatedAt: 0,
};

const initializer: StateCreator<PresenceState> = (set, get) => ({
  byLogin: {},
  setMany: (entries) => set((state) => {
    if (!entries.length) return state;
    const now = Date.now();
    const next = { ...state.byLogin };
    let changed = false;
    for (const entry of entries) {
      if (!entry.login) continue;
      // Latest-write-wins. Bulk fill из API может прийти ПОЗЖЕ свежего WS push'а
      // (race на сети). Не перетираем недавно обновлённое — у API нет своего ts,
      // а у WS push — реальное «только что».
      const existing = next[entry.login];
      if (existing && existing.updatedAt >= now) continue;
      const candidate: PresenceInfo = {
        status: normalize(entry.status),
        lastSeenAt: entry.lastSeenAt || existing?.lastSeenAt || '',
        updatedAt: now,
      };
      if (!existing
          || existing.status !== candidate.status
          || existing.lastSeenAt !== candidate.lastSeenAt) {
        next[entry.login] = candidate;
        changed = true;
      }
    }
    return changed ? { byLogin: next } : state;
  }),
  setOne: (login, status, lastSeenAt) => set((state) => {
    if (!login) return state;
    const candidate: PresenceInfo = {
      status: normalize(status),
      lastSeenAt: lastSeenAt || state.byLogin[login]?.lastSeenAt || '',
      updatedAt: Date.now(),
    };
    const existing = state.byLogin[login];
    if (existing
        && existing.status === candidate.status
        && existing.lastSeenAt === candidate.lastSeenAt) {
      return state;
    }
    return { byLogin: { ...state.byLogin, [login]: candidate } };
  }),
  get: (login) => get().byLogin[login] || DEFAULT_INFO,
  clear: () => set({ byLogin: {} }),
});

export function createPresenceStore(
  storage?: PersistStorage<PresenceState>,
): UseBoundStore<StoreApi<PresenceState>> {
  if (!storage) return create<PresenceState>()(initializer);
  return create<PresenceState>()(
    persist(initializer, {
      name: 'pyn-presence-cache',
      storage,
      version: 1,
      // При rehydrate сбрасываем updatedAt в 0 — старые данные с диска НЕ
      // должны блокировать свежие bulk fills (latest-write-wins).
      partialize: (state) => ({ byLogin: state.byLogin } as PresenceState),
    }),
  );
}
