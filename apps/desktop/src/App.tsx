import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Sidebar } from '@/components/sidebar';
import { ChatConversation, ChatList } from '@/components/chats';
import { NewsFeed } from '@/components/news';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { startWs, stopWs, useWsEvent } from '@/lib/ws';
import { useChatsStore, useNewsStore, useUsersStore } from '@/lib/stores';
import { clearAllCache } from '@/lib/cache-storage';
import { initDeviceId } from '@/lib/device';
import { computeInitials } from '@/lib/initials';
import { wireToChatMessage, wireToChatPartnerFromMessage } from '@/lib/repositories/chats-repo';
import type { ChatPartner } from '@/types/chat';
import type { NavSectionId } from '@/types/nav';
import {
  ApiError,
  addReaction,
  CHATS_STALE_MS,
  getAdminChat,
  getAdminMessages,
  getUsers,
  isAdminLike,
  isChatsStale,
  isUsersStale,
  markMessageRead,
  me,
  removeReaction,
  sendMessage,
  type NewMessageEvent,
  type Session,
} from '@pyn/core';

/**
 * Корневой layout Pyn.
 *
 * Phases:
 *   • Hydrating  → пустой dark splash пока проверяем persisted session
 *   • Не залогинены → LoginScreen
 *   • Залогинены → Sidebar + content (chats/news/...)
 *
 * Кэш-слой (Phase C):
 *   • `useNewsStore` + `useChatsStore` — Zustand stores с persist через
 *     safeStorage в main process. Stale-while-revalidate с TTL 5 min.
 *   • На mount session — рендерим из кэша, в фоне refetch если stale.
 *   • WS new_message → refetch conversations + active chat (через store actions).
 *   • desktop_kicked / token expired → wipe stores + cache + session.
 */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<NavSectionId>('news');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Stores (selectors реактивно обновляют UI при изменении state'a)
  const partners = useChatsStore((s) => s.partners);
  const partnersLastFetchedAt = useChatsStore((s) => s.partnersLastFetchedAt);
  const messagesByPeer = useChatsStore((s) => s.messagesByPeer);
  const setPartners = useChatsStore((s) => s.setPartners);
  const setMessagesForPeer = useChatsStore((s) => s.setMessagesForPeer);
  const appendMessageForPeer = useChatsStore((s) => s.appendMessageForPeer);
  const clearChatsStore = useChatsStore((s) => s.clear);
  const newsItems = useNewsStore((s) => s.items);
  const clearNewsStore = useNewsStore((s) => s.clear);
  const setUsers = useUsersStore((s) => s.setUsers);
  const usersLastFetchedAt = useUsersStore((s) => s.lastFetchedAt);
  const clearUsersStore = useUsersStore((s) => s.clear);

  // Динамические unread-badges для Sidebar (chats + news).
  const sidebarBadges = useMemo(() => {
    const chatsUnread = partners.reduce((sum, p) => sum + (p.unreadCount ?? 0), 0);
    const newsUnread = newsItems.filter((n) => !n.isRead).length;
    return { chats: chatsUnread, news: newsUnread };
  }, [partners, newsItems]);

  // Restore persisted session на mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const debug = (msg: string) => window.pyn?.debugLog?.('hydrate', msg);
      // Phase D: device_id из encrypted cache (миграция из localStorage если был).
      // Делаем до session restore — login flow вызывает getDeviceLabel() sync.
      await initDeviceId().catch((err) => {
        debug(`initDeviceId failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      let restored: Session | null = null;
      try {
        restored = await sessionStore.load();
      } catch (err) {
        debug(`load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (cancelled) return;
      if (!restored) {
        debug('no persisted session, showing LoginScreen');
        setHydrating(false);
        return;
      }
      debug(`restored session for ${restored.user.login} (role=${restored.role})`);
      api.setToken(restored.token);
      setSession(restored);
      setHydrating(false);

      // Фоновая me() validation. Auth-failure → wipe всё.
      try {
        await me(api);
        debug('me() ok — session valid');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && isAuthFailure(err.code)) {
          debug(`token invalid (${err.code}), clearing store + cache`);
          await wipeUserData();
          setSession(null);
          setActiveChatId(null);
        } else {
          debug(`me() failed but keeping cached session: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WS lifecycle: connect при наличии session, disconnect при logout.
  useEffect(() => {
    if (!session) {
      void stopWs();
      return;
    }
    void startWs(session.user.login, session.token);
  }, [session]);

  // Refetch conversations + invalidation actions
  const refreshConversations = useCallback(async (): Promise<void> => {
    if (!session) return;
    const myLogin = session.user.login;
    try {
      const wire = await getAdminMessages(api, { limit: 100 });
      const byPeer = new Map<string, ChatPartner>();
      for (const msg of wire) {
        const partner = wireToChatPartnerFromMessage(msg, myLogin);
        if (!partner.id) continue;
        if (!byPeer.has(partner.id)) byPeer.set(partner.id, partner);
      }
      setPartners([...byPeer.values()]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('getAdminMessages failed:', err);
    }
  }, [session, setPartners]);

  // На session change: serve cached, refetch если stale.
  useEffect(() => {
    if (!session) return;
    if (isChatsStale(partnersLastFetchedAt, CHATS_STALE_MS)) {
      void refreshConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // На session change для admin/developer — подтянуть список users c аватарами
  // (для NewsStatsDialog readers/voters: server возвращает только login).
  useEffect(() => {
    if (!session) return;
    if (!isAdminLike(session.role)) return;
    if (!isUsersStale(usersLastFetchedAt)) return;
    getUsers(api)
      .then((users) => setUsers(users))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('getUsers failed:', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // desktop_kicked → wipe всё.
  useWsEvent('desktop_kicked', () => {
    void (async () => {
      // eslint-disable-next-line no-console
      console.log('[pyn:ws] desktop_kicked received, wiping session + cache');
      await wipeUserData();
      setSession(null);
      setActiveChatId(null);
    })();
  });

  // new_message → refresh conversations + если открыт чат с этим peer'ом,
  // перезагрузить переписку (или append, если это собственный outgoing).
  useWsEvent<NewMessageEvent>('new_message', (event) => {
    if (!session) return;
    const myLogin = session.user.login;
    void refreshConversations();
    const relevantPeer =
      event.sender_login === myLogin ? event.receiver_login : event.sender_login;
    if (activeChatId && relevantPeer === activeChatId) {
      getAdminChat(api, { userLogin: activeChatId, limit: 200 })
        .then((wire) => {
          setMessagesForPeer(activeChatId, wire.map((m) => wireToChatMessage(m, myLogin)));
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('getAdminChat refresh failed:', err);
        });
    }
  });

  // Загрузка сообщений при смене активного чата + mark_read.
  useEffect(() => {
    if (!session || !activeChatId) return;
    let cancelled = false;
    const myLogin = session.user.login;
    const peer = activeChatId;
    getAdminChat(api, { userLogin: peer, limit: 200 })
      .then((wire) => {
        if (cancelled) return;
        setMessagesForPeer(peer, wire.map((m) => wireToChatMessage(m, myLogin)));
        // Mark последнего unread от peer'a → server пометит весь thread до этого id.
        const lastUnreadFromPeer = wire
          .filter((m) => m.sender_login !== myLogin && (m.is_read ?? 0) === 0)
          .reduce((max, m) => (m.id > max ? m.id : max), 0);
        if (lastUnreadFromPeer > 0) {
          void markMessageRead(api, lastUnreadFromPeer).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('markMessageRead failed:', err);
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('getAdminChat failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [session, activeChatId, setMessagesForPeer]);

  const activeChat = useMemo(
    () => partners.find((c) => c.id === activeChatId) ?? null,
    [partners, activeChatId],
  );

  const messages = useMemo(
    () => (activeChatId ? messagesByPeer[activeChatId] ?? [] : []),
    [activeChatId, messagesByPeer],
  );

  const handleChatReact = (messageId: number, emoji: string): void => {
    if (!session || !activeChatId) return;
    // Optimistic — обновляем messagesByPeer для активного chat.
    const current = messagesByPeer[activeChatId] ?? [];
    const next = current.map((m) => {
      if (m.numericId !== messageId) return m;
      const wasMine = (m.myReactions ?? []).includes(emoji);
      const currentCount = (m.reactions ?? {})[emoji] ?? 0;
      const nextCount = wasMine ? currentCount - 1 : currentCount + 1;
      const nextReactions = { ...(m.reactions ?? {}) };
      if (nextCount <= 0) delete nextReactions[emoji];
      else nextReactions[emoji] = nextCount;
      return {
        ...m,
        myReactions: wasMine
          ? (m.myReactions ?? []).filter((e) => e !== emoji)
          : [...(m.myReactions ?? []), emoji],
        reactions: nextReactions,
      };
    });
    setMessagesForPeer(activeChatId, next);
    const wasMineOnTarget = current.find((m) => m.numericId === messageId)?.myReactions?.includes(emoji) ?? false;
    const action = wasMineOnTarget ? removeReaction : addReaction;
    action(api, { messageId, emoji }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('chat reaction failed:', err);
      // WS broadcast new_message обновит state из сервера в течение ~500ms.
    });
  };

  const handleSendMessage = async (
    text: string,
    atts: import('@/types/chat').PendingAttachment[],
  ): Promise<void> => {
    if (!activeChat) return;
    if (!text.trim() && atts.length === 0) return;
    const wireAttachments = atts
      .filter((a) => typeof a.dataUrl === 'string' && a.dataUrl.length > 0)
      .map((a) => ({
        url: a.dataUrl as string,
        filename: a.name,
        mimeType: a.mimeType ?? 'application/octet-stream',
        size: a.size ?? 0,
      }));
    try {
      const sent = await sendMessage(api, {
        receiverLogin: activeChat.id,
        text: text.trim(),
        attachments: wireAttachments.length > 0 ? wireAttachments : undefined,
      });
      // Time будет в правильном формате после WS new_message refresh; для
      // optimistic-bubble оставляем краткое "сейчас", через секунду WS
      // подтянет реальное created_at и переформатирует.
      appendMessageForPeer(activeChat.id, {
        id: String(sent.id),
        numericId: sent.id,
        authorId: 'me',
        text: text.trim(),
        time: 'сейчас',
        isOwn: true,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('sendMessage failed:', err);
    }
  };

  if (hydrating) {
    return <div className="h-full w-full bg-bg-surface" />;
  }

  if (!session) {
    return (
      <Tooltip.Provider delayDuration={200} skipDelayDuration={1500} disableHoverableContent>
        <LoginScreen onSuccess={setSession} />
      </Tooltip.Provider>
    );
  }

  const initials = computeInitials(session.user.fullName || session.user.login);

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={1500} disableHoverableContent>
      <div className="flex h-full w-full bg-bg-surface">
        <Sidebar
          collapsed={collapsed}
          activeSection={activeSection}
          username={session.user.fullName || session.user.login}
          initials={initials}
          badges={sidebarBadges}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          onSearchClick={() => {
            /* TODO: search overlay */
          }}
          onSectionClick={setActiveSection}
          onLogout={() => {
            void (async () => {
              await wipeUserData();
              setSession(null);
              setActiveChatId(null);
            })();
          }}
        />

        {activeSection === 'chats' ? (
          <>
            <ChatList
              conversations={partners}
              activeId={activeChatId}
              onSelect={setActiveChatId}
            />
            <ChatConversation
              partner={activeChat}
              messages={messages}
              onSend={(text, atts) => {
                void handleSendMessage(text, atts);
              }}
              onReact={handleChatReact}
            />
          </>
        ) : activeSection === 'news' ? (
          <NewsFeed
            currentUserInitials={initials}
            currentUserName={session.user.fullName || session.user.login}
            currentUserLogin={session.user.login}
            currentUserRole={session.role}
          />
        ) : (
          <main className="flex flex-1 flex-col">
            <div className="drag-region h-8 shrink-0" />
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-text-muted">
                Раздел: <span className="text-text-strong">{activeSection}</span>
              </p>
            </div>
          </main>
        )}
      </div>
    </Tooltip.Provider>
  );

  /**
   * Полная очистка user data: session, news cache, chats cache, encrypted
   * cache на диске, ApiClient token. Вызывается на token expiry / desktop_kicked.
   */
  async function wipeUserData(): Promise<void> {
    await sessionStore.clear().catch(() => {});
    api.setToken(null);
    clearNewsStore();
    clearChatsStore();
    clearUsersStore();
    await clearAllCache();
  }
}

/**
 * Server-side error codes, означающие что сохранённый токен больше не
 * принимается → надо чистить store и просить relogin. Прочие коды (network,
 * replay_detected, invalid_envelope, etc) — transient, сессию не трогаем.
 */
const AUTH_FAILURE_CODES = new Set<string>([
  'unauthorized',
  'token_revoked',
  'token_expired',
  'session_not_found',
  'session_expired_window',
  'desktop_kicked',
  'user_inactive',
  'user_suspended',
]);

function isAuthFailure(code: string): boolean {
  return AUTH_FAILURE_CODES.has(code);
}
