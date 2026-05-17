import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Sidebar } from '@/components/sidebar';
import { ChatConversation, ChatList } from '@/components/chats';
import { MolScreen } from '@/components/mol';
import { NewsFeed } from '@/components/news';
import { TablesScreen } from '@/components/tables';
import { UpdatePromptDialog } from '@/components/system/UpdatePromptDialog';
import { clearTablesRegistry } from '@/lib/use-tables-registry';
import { SettingsScreen } from '@/components/settings';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { SessionExpiryWatch } from '@/components/auth/SessionExpiryWatch';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { startWs, stopWs, useWsEvent } from '@/lib/ws';
import { useChatsStore, useMolStore, useNewsStore, useOutboxStore, useSessionInfoStore, useStatsStore, useUiStateStore, useUsersStore } from '@/lib/stores';
import { clearAvatarCache } from '@/lib/avatar';
import { clearAllCache } from '@/lib/cache-storage';
import { initDeviceId } from '@/lib/device';
import { computeInitials } from '@/lib/initials';
import { wireToChatMessage, wireToChatPartnerFromMessage } from '@/lib/repositories/chats-repo';
import type { ChatPartner } from '@/types/chat';
import type { NavSectionId } from '@/types/nav';
import {
  ApiError,
  addReaction,
  appStatus,
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
  useSheetsLockStore,
  type AppStatusResponse,
  type NewMessageEvent,
  type Session,
  type SheetLockAcquiredEvent,
  type SheetLockReleasedEvent,
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
  const [updateInfo, setUpdateInfo] = useState<AppStatusResponse | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // activeSection + activeChatId — persistent UI-state: при перезапуске
  // Pyn'a продолжаем с того же раздела и чата (Telegram-style continuation).
  const activeSection = useUiStateStore((s) => s.activeSection as NavSectionId);
  const setActiveSection = useUiStateStore((s) => s.setActiveSection);
  const activeChatId = useUiStateStore((s) => s.activeChatId);
  const setActiveChatId = useUiStateStore((s) => s.setActiveChatId);
  // Settings — overlay поверх основной зоны (открывается из попап-меню юзера,
  // не из Sidebar). Back-кнопка просто снимает overlay, основная nav-секция
  // не меняется — юзер вернётся точно туда же где был.
  const [showSettings, setShowSettings] = useState(false);

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
  const clearSessionInfoStore = useSessionInfoStore((s) => s.clear);
  const clearMolStore = useMolStore((s) => s.clear);
  const clearUiState = useUiStateStore((s) => s.clear);
  const clearOutbox = useOutboxStore((s) => s.clear);
  const clearStatsStore = useStatsStore((s) => s.clear);
  const outboxPending = useOutboxStore((s) => s.pending);
  const enqueueOutgoing = useOutboxStore((s) => s.enqueue);
  const dequeueOutgoing = useOutboxStore((s) => s.dequeue);

  // Динамические unread-badges для Sidebar (chats + news).
  const sidebarBadges = useMemo(() => {
    const chatsUnread = partners.reduce((sum, p) => sum + (p.unreadCount ?? 0), 0);
    const newsUnread = newsItems.filter((n) => !n.isRead).length;
    return { chats: chatsUnread, news: newsUnread };
  }, [partners, newsItems]);

  // Глобальный handler auth-failure'ов: любой API-call, который возвращает
  // `unauthorized` / `session_expired_window` / `token_*` / etc → ApiClient
  // вызывает этот callback. Wipe всё + перевод на LoginScreen. Не нужно ловить
  // эти коды в каждом catch'е компонентов.
  useEffect(() => {
    api.setOnAuthFailure((code) => {
      window.pyn?.debugLog?.('auth-failure', `code=${code} — wiping session`);
      void (async () => {
        await wipeUserData();
        setSession(null);
        setActiveChatId(null);
      })();
    });
    return () => {
      api.setOnAuthFailure(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Обогащение session avatar blob params'ами вынесено в отдельный
      // effect ниже (срабатывает и для restore, и для свежего login).
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

  // Обогащение session.user avatar blob params'ами через me().
  // Server возвращает avatar_blob_key_b64/nonce_b64 только в `me()` response,
  // а login (`password_login_pc` / `redeem_qr_token`) — нет. Поэтому на
  // первом mount после login (или restore без blob params) подтягиваем blob
  // и persist'им — sidebar avatar отображается с расшифрованной картинкой,
  // и при следующем рестарте Pyn'a уже doesn't blink (грузится из cache).
  // Не зависит от auth-failure: api.setOnAuthFailure глобально обработает.
  useEffect(() => {
    if (!session) return;
    if (session.user.avatarBlobKey && session.user.avatarBlobNonce) return;
    let cancelled = false;
    void (async () => {
      try {
        const meRes = await me(api);
        if (cancelled) return;
        if (!meRes.avatarBlobKey && !meRes.avatarUrl) return;
        const enriched: Session = {
          ...session,
          user: {
            ...session.user,
            fullName: meRes.fullName || session.user.fullName,
            avatarUrl: meRes.avatarUrl || session.user.avatarUrl,
            avatarBlobKey: meRes.avatarBlobKey || session.user.avatarBlobKey,
            avatarBlobNonce: meRes.avatarBlobNonce || session.user.avatarBlobNonce,
          },
        };
        setSession(enriched);
        sessionStore.save(enriched).catch(() => {
          /* ignore: persist неудача не блокирует UI */
        });
      } catch {
        /* auth-failure обработает global handler через api.setOnAuthFailure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.token]);

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

  // Auto-update: при наличии session опрашиваем `app_status` на старте и
  // раз в 30 мин. Если на сервере есть свежая версия — показываем диалог.
  // Server-side scope: `desktop-win` для Windows, `desktop-mac` для Mac.
  useEffect(() => {
    if (!session) return;
    const platform = window.pyn?.platform;
    const scope: 'desktop-win' | 'desktop-mac' =
      platform === 'win32' ? 'desktop-win' : 'desktop-mac';
    const appVersion = window.pyn?.appVersion ?? '0.0.0';
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const res = await appStatus(api, { appScope: scope, appVersion });
        if (cancelled) return;
        if (
          res.updateUrl &&
          compareSemver(res.currentVersion, appVersion) > 0
        ) {
          setUpdateInfo(res);
        }
      } catch {
        /* offline / network — silent, попробуем на следующем тике */
      }
    };
    void check();
    const id = setInterval(() => void check(), 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session]);

  // Sheets lock — server-authoritative. Initiator делает локальный
  // optimistic acquire перед сетевым вызовом, остальные клиенты узнают
  // через WS broadcast.
  useWsEvent<SheetLockAcquiredEvent>('sheet_lock_acquired', (event) => {
    useSheetsLockStore.getState().setFromWs({
      actionId: event.action_id,
      actionLabel: event.action_label,
      userName: event.user_name,
      tabName: event.tab_name,
      lockedTabRawNames: Array.isArray(event.locked_tabs) ? event.locked_tabs : [],
    });
  });
  useWsEvent<SheetLockReleasedEvent>('sheet_lock_released', (event) => {
    const cur = useSheetsLockStore.getState().activeLock;
    if (cur && cur.actionId === event.action_id) {
      useSheetsLockStore.getState().setFromWs(null);
    }
  });

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
    replyToId?: number,
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

    // Offline path — если нет сети, кладём в outbox. Optimistic bubble
    // показывается без numericId → pending-status (анимированная ✓) и
    // auto-send когда сеть вернётся.
    if (!navigator.onLine) {
      const id = enqueueOutgoing({
        peerLogin: activeChat.id,
        text: text.trim(),
        attachments: wireAttachments,
        replyToId,
      });
      appendMessageForPeer(activeChat.id, {
        id,
        authorId: 'me',
        text: text.trim(),
        time: 'в очереди',
        isOwn: true,
      });
      return;
    }

    try {
      const sent = await sendMessage(api, {
        receiverLogin: activeChat.id,
        text: text.trim(),
        attachments: wireAttachments.length > 0 ? wireAttachments : undefined,
        replyToId,
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
      // Network error → fallback в outbox, чтобы юзер не потерял текст.
      enqueueOutgoing({
        peerLogin: activeChat.id,
        text: text.trim(),
        attachments: wireAttachments,
        replyToId,
      });
    }
  };

  // Outbox drainer — пытается отправить pending-сообщения когда есть сеть.
  // Срабатывает на `online` event и при изменении outbox (новые pending'и).
  useEffect(() => {
    if (!session) return;
    if (outboxPending.length === 0) return;
    let cancelled = false;
    const drain = async (): Promise<void> => {
      if (!navigator.onLine) return;
      for (const item of outboxPending) {
        if (cancelled) return;
        try {
          await sendMessage(api, {
            receiverLogin: item.peerLogin,
            text: item.text,
            attachments: item.attachments.length > 0 ? item.attachments : undefined,
            replyToId: item.replyToId,
          });
          dequeueOutgoing(item.id);
          // WS new_message подтянет настоящую запись и заменит pending'a.
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[pyn:outbox] resend failed, will retry on next online:', err);
          // Останавливаемся на первой ошибке — следующий online event
          // снова дернёт drain.
          return;
        }
      }
    };
    void drain();
    const handler = () => {
      void drain();
    };
    window.addEventListener('online', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('online', handler);
    };
  }, [session, outboxPending, dequeueOutgoing]);

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
      <SessionExpiryWatch />
      <div className="flex h-full w-full bg-bg-surface">
        {showSettings ? (
          // Settings — full-screen «свой раздел»: основной Sidebar скрыт,
          // навигация только через внутренний SettingsSidebar + back-кнопку
          // сверху. Открывается из попап-меню юзера.
          <SettingsScreen
            myRole={session.role}
            myLogin={session.user.login}
            onBack={() => setShowSettings(false)}
          />
        ) : (
          <>
            <Sidebar
              collapsed={collapsed}
              activeSection={activeSection}
              username={session.user.fullName || session.user.login}
              initials={initials}
              userLogin={session.user.login}
              userRole={session.role}
              userAvatarUrl={session.user.avatarUrl}
              userAvatarBlobKey={session.user.avatarBlobKey}
              userAvatarBlobNonce={session.user.avatarBlobNonce}
              badges={sidebarBadges}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
              onSearchClick={() => {
                /* TODO: search overlay */
              }}
              onSectionClick={setActiveSection}
              onOpenSettings={() => setShowSettings(true)}
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
                  onSend={(text, atts, replyToId) => {
                    void handleSendMessage(text, atts, replyToId);
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
            ) : activeSection === 'mol' ? (
              <MolScreen />
            ) : activeSection.startsWith('sheet:') ? (
              <TablesScreen
                currentUserName={session.user.fullName || session.user.login}
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
          </>
        )}
        {updateInfo && (
          <UpdatePromptDialog
            open={!updateDismissed}
            currentVersion={window.pyn?.appVersion ?? '0.0.0'}
            newVersion={updateInfo.currentVersion}
            updateUrl={updateInfo.updateUrl ?? ''}
            forceUpdate={updateInfo.forceUpdate}
            onDismiss={() => setUpdateDismissed(true)}
          />
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
    clearSessionInfoStore();
    clearMolStore();
    clearUiState();
    clearOutbox();
    clearStatsStore();
    clearTablesRegistry();
    useSheetsLockStore.getState().reset();
    // In-memory blob URLs (avatars / attachments) — освобождаем чтобы при
    // следующем login (особенно того же юзера) не использовать stale URL.
    clearAvatarCache();
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

/**
 * Сравнение semver-like версий `MAJOR.MINOR.PATCH`. Возвращает 1 если a>b,
 * -1 если a<b, 0 если равны. Pre-release / build-metadata игнорируются
 * (сервер их не использует).
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}
