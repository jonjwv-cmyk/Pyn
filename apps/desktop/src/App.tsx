import { useCallback, useEffect, useMemo, useState } from 'react';
import i18next from 'i18next';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Sidebar } from '@/components/sidebar';
import { ChatConversation, ChatList } from '@/components/chats';
import { MolScreen } from '@/components/mol';
import { initMol, refreshMolFromServer } from '@/lib/mol-repo';
import { NewsFeed } from '@/components/news';
import { TablesScreen } from '@/components/tables';
import { UpdateConfirmDialog } from '@/components/system/UpdateConfirmDialog';
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
import { initI18n } from '@/lib/i18n';
import { computeInitials } from '@/lib/initials';
import { wireToChatMessage, wireToChatPartnerFromMessage } from '@/lib/repositories/chats-repo';
import type { ChatPartner } from '@/types/chat';
import type { NavSectionId } from '@/types/nav';
import {
  ApiError,
  addReaction,
  appStatus,
  CHATS_STALE_MS,
  confirmWipe,
  getAdminChat,
  getAdminMessages,
  getAppLockStatus,
  getUsers,
  isAdminLike,
  isChatsStale,
  isDeveloper,
  isUsersStale,
  markMessageRead,
  me,
  removeReaction,
  sendMessage,
  useAppLockStore,
  useSheetsLockStore,
  type AppControlStateChangedEvent,
  type AppStatusResponse,
  type NewMessageEvent,
  type Session,
  type SheetLockAcquiredEvent,
  type SheetLockReleasedEvent,
} from '@pyn/core';
import { AppLockOverlay } from '@/components/system/AppLockOverlay';
import { getDeviceId } from '@/lib/device';

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
  // Update flow state machine. Источник правды — sidebar pill (click drives transitions).
  //   detected   — pill «Доступно обновление»
  //   downloading — pill «Загрузка NN%»
  //   ready      — pill «Обновление готово», + confirm dialog «обновиться?»
  //   installing — pill «Установка…», installer запущен, app сейчас quit'нется
  const [updateStage, setUpdateStage] = useState<'detected' | 'downloading' | 'ready' | 'installing'>('detected');
  const [updateBytes, setUpdateBytes] = useState(0);
  const [updateTotal, setUpdateTotal] = useState(0);
  const [updateLocalPath, setUpdateLocalPath] = useState<string | null>(null);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
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

  // i18n init — один раз на mount. Дожидаемся persist-hydration ui-state-store
  // (он async через safeStorage IPC), чтобы saved language применился сразу
  // на старте. Без этого ожидания первый рендер был бы всегда на ru, и через
  // момент после hydration перепрыгнул бы на сохранённый.
  useEffect(() => {
    if (useUiStateStore.persist.hasHydrated()) {
      initI18n(useUiStateStore.getState().language);
    } else {
      const unsub = useUiStateStore.persist.onFinishHydration(() => {
        initI18n(useUiStateStore.getState().language);
      });
      // Safety net: если hydration уже завершён до подписки (race), вызовем init.
      if (useUiStateStore.persist.hasHydrated()) {
        initI18n(useUiStateStore.getState().language);
      }
      return unsub;
    }
  }, []);

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

  // Developer-only: seed AppControlPanel state (оба scope + device counts).
  // Один запрос на login. Дальше WS push обновляет state, AppControlPanel
  // рендерится из store без loading-spinner'a при каждом заходе.
  useEffect(() => {
    if (!session || !isDeveloper(session.role)) return;
    getAppLockStatus(api)
      .then((s) => {
        useAppLockStore.getState().setAllFromServer({
          desktop: s.desktop,
          android: s.android,
          devicesActive: s.devicesActive,
          devicesWiped: s.devicesWiped,
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('getAppLockStatus seed failed:', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Auto-update + kill switch seed (1 запрос на login + 1 на 30-мин update check).
  // Сидируем оба scope (desktop + android) в useAppLockStore — потом всё
  // обновляется через WS push, без поллинга.
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
        // Сидируем desktop scope из app_status response (desktop клиент).
        // android scope узнаем позже через get_app_lock_status (когда юзер
        // зайдёт в Settings → Управление) или через WS push.
        if (res.appLockState) {
          useAppLockStore.getState().setScopeFromServer('desktop', {
            state: res.appLockState,
            title: res.appLockTitle || '',
            message: res.appLockMessage || '',
            wipeAt: res.appLockWipeAt ?? null,
            initiatedBy: res.appLockInitiatedBy || '',
          });
        }
      } catch { /* offline / network — silent */ }
    };
    void check();
    // Update-check раз в 30 мин — там и lock state будет освежаться.
    const id = setInterval(() => void check(), 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session]);

  // ── Update flow: cache check + progress subscription ────────────────
  // Когда `appStatus` обнаружил новую версию (`updateInfo` set) — сразу
  // проверяем кэш через IPC. Если файл уже скачан раньше — ставим
  // stage='ready'. Юзер кликает на pill → confirm dialog без download.
  useEffect(() => {
    if (!updateInfo || !updateInfo.updateUrl) return;
    let cancelled = false;
    void window.pyn?.update?.checkCached?.(updateInfo.updateUrl, updateInfo.currentVersion)
      .then((res) => {
        if (cancelled) return;
        if (res?.exists) {
          setUpdateLocalPath(res.localPath);
          setUpdateStage('ready');
        }
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [updateInfo]);

  // Подписка на download progress (приходит из main process).
  useEffect(() => {
    const unsub = window.pyn?.update?.onProgress?.((p) => {
      setUpdateBytes(p.bytes);
      setUpdateTotal(p.total);
    });
    return () => { unsub?.(); };
  }, []);

  // Handler: click на UpdateAvailablePill в sidebar. State machine:
  //   detected   → start download, stage='downloading'
  //   downloading → noop (idempotent)
  //   ready      → open confirm dialog
  //   installing → noop
  const handleUpdatePillClick = useCallback(async (): Promise<void> => {
    if (!updateInfo || !updateInfo.updateUrl) return;
    if (updateStage === 'ready') {
      setUpdateConfirmOpen(true);
      return;
    }
    if (updateStage !== 'detected') return;
    setUpdateStage('downloading');
    setUpdateBytes(0);
    setUpdateTotal(0);
    try {
      const res = await window.pyn?.update?.download?.(
        updateInfo.updateUrl,
        updateInfo.currentVersion,
        // Server возвращает SHA-256 свежего бинаря в `app_status.binary_sha`.
        // main process после скачивания сравнит — mismatch = подмена exe в пути,
        // download rejected, error.
        updateInfo.binarySha || undefined,
      );
      if (res?.ok && res.localPath) {
        setUpdateLocalPath(res.localPath);
        setUpdateStage('ready');
        setUpdateConfirmOpen(true);
      } else {
        // Откат на detected — юзер может попробовать снова кликом на pill.
        setUpdateStage('detected');
        // eslint-disable-next-line no-console
        console.warn('[pyn:update] download failed:', res?.error);
      }
    } catch (err) {
      setUpdateStage('detected');
      // eslint-disable-next-line no-console
      console.warn('[pyn:update] download error:', err);
    }
  }, [updateInfo, updateStage]);

  // Handler: «Да, обновить» в confirm dialog → install + quit.
  const handleUpdateConfirm = useCallback(async (): Promise<void> => {
    if (!updateLocalPath) return;
    setUpdateConfirmOpen(false);
    setUpdateStage('installing');
    try {
      await window.pyn?.update?.install?.(updateLocalPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:update] install failed:', err);
      setUpdateStage('ready');
    }
  }, [updateLocalPath]);

  // WS event: kill switch state changed. Главный канал обновления — push.
  // Guard: пока у developer'a идёт own toggle для scope — игнорируем echo events
  // от своего же действия (иначе race с optimistic update делает «прыжки»).
  // WS push: новая версия приложения опубликована — мгновенный re-check
  // appStatus вместо ждать следующего 30-мин polling cycle.
  useWsEvent<{ type: string; scope?: string; current_version?: string }>(
    'app_version_changed',
    (event) => {
      const platform = window.pyn?.platform;
      const scope: 'desktop-win' | 'desktop-mac' =
        platform === 'win32' ? 'desktop-win' : 'desktop-mac';
      // Фильтр: реагируем только если событие касается нашего scope.
      if (event.scope && event.scope !== scope) return;
      const appVersion = window.pyn?.appVersion ?? '0.0.0';
      void appStatus(api, { appScope: scope, appVersion }).then((res) => {
        if (res.updateUrl && compareSemver(res.currentVersion, appVersion) > 0) {
          setUpdateInfo(res);
          setUpdateStage('detected');
        }
      }).catch(() => { /* silent */ });
    },
  );

  useWsEvent<AppControlStateChangedEvent>('app_control_state_changed', (event) => {
    if (event.scope !== 'desktop' && event.scope !== 'android') return;
    const state = useAppLockStore.getState();
    if (state.pendingScopes.includes(event.scope)) return;
    state.setScopeFromServer(event.scope, {
      state: event.state as 'normal' | 'paused' | 'wiping' | 'wiped',
      title: event.title || '',
      message: event.message || '',
      wipeAt: event.wipe_at ?? null,
      initiatedBy: event.initiated_by || '',
    });
    // Auto-trigger wipe только если ЭТОТ клиент (desktop) затронут.
    if (event.scope === 'desktop' && event.state === 'wiping'
        && session && !isDeveloper(session.role)) {
      void triggerAppLockWipe();
    }
  });

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

  // §v1.2.14 — МОЛ-база eager preload + always-on WS push.
  //
  // Раньше initMol() и useWsEvent('base_changed') жили внутри MolScreen,
  // поэтому загрузка случалась только при первом открытии раздела МОЛы,
  // а WS push обновления игнорировались если юзер сидел в Чатах/Таблицах.
  // Юзер ожидает: после login база скачивается сразу + любые server-broadcast
  // обновления применяются автоматически независимо от текущего раздела.
  useEffect(() => {
    if (!session) return;
    void initMol();
  }, [session]);
  useWsEvent('base_changed', () => {
    void refreshMolFromServer({ force: true });
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
        time: i18next.t('common.queued'),
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
        time: i18next.t('common.now'),
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

  // ── Kill switch overlay selectors (Rules of Hooks: до early returns!) ──
  // Desktop client отслеживает только desktop scope для своего overlay'a.
  // (android scope developer видит в Settings → Управление, но overlay
  // для android-блока тут не показываем — это второй платформа).
  const desktopLock = useAppLockStore((s) => s.desktop);

  if (hydrating) {
    return <div className="h-full w-full bg-bg-surface" />;
  }

  // Overlay поверх всего (включая LoginScreen и Settings). Developer'у НЕ
  // показывается — он управляет состоянием через Settings → Управление.
  const shouldShowAppLock =
    desktopLock.state !== 'normal' && (!session || !isDeveloper(session.role));
  if (shouldShowAppLock) {
    return <AppLockOverlay state={desktopLock.state} title={desktopLock.title} />;
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
      <div className="relative flex h-full w-full bg-bg-surface">
        {/* §v1.2.14 — Main UI всегда mounted. Settings рендерится
            overlay'ем (см. ниже) — раньше Settings заменял main через
            conditional render, что unmount'ило TablesScreen и Chromium
            webview'ы Google Sheets перезагружались при возврате. */}
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
              updatePill={updateInfo ? {
                stage: updateStage,
                bytes: updateBytes,
                total: updateTotal,
                onClick: () => void handleUpdatePillClick(),
              } : undefined}
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
            ) : activeSection === 'news' ? null /* ← рендерится ниже always-mounted */ : activeSection === 'mol' ? (
              <MolScreen />
            ) : activeSection.startsWith('sheet:') ? null /* ← рендерится ниже always-mounted */ : (
              <main className="flex flex-1 flex-col">
                <div className="drag-region h-8 shrink-0" />
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-text-muted">
                    Раздел: <span className="text-text-strong">{activeSection}</span>
                  </p>
                </div>
              </main>
            )}

            {/*
              §v1.2.14 — TablesScreen ВСЕГДА mounted чтобы Chromium webview'ы
              открытых таблиц жили как фоновые browser-tabs. Когда юзер уходит
              в Чаты/Новости/МОЛы и возвращается — таблицы уже загружены,
              мгновенный switch. Скрываем через `display: none` (CSS-уровень,
              webContents Chromium остаётся жив, cookies/scroll/state не
              теряются). До v1.2.14 был conditional render → unmount при
              уходе → reload при возврате.
            */}
            <div
              className="flex flex-1 flex-col"
              style={{
                display: activeSection.startsWith('sheet:') ? 'flex' : 'none',
              }}
            >
              <TablesScreen
                currentUserName={session.user.fullName || session.user.login}
              />
            </div>

            {/*
              §2026-05-19 — NewsFeed always-mounted (тот же приём что у
              TablesScreen). При возврате с другого раздела не было «прыжка»
              скролла: компонент не unmount'ится, scroll-position сохраняется
              в DOM Chromium'ом независимо от display:none. Restore-effect
              через ResizeObserver больше не нужен (он и так уже отработал
              при первом mount).
            */}
            <div
              className="flex flex-1 flex-col"
              style={{
                display: activeSection === 'news' ? 'flex' : 'none',
              }}
            >
              <NewsFeed
                currentUserInitials={initials}
                currentUserName={session.user.fullName || session.user.login}
                currentUserLogin={session.user.login}
                currentUserRole={session.role}
              />
            </div>
        </>

        {/* §v1.2.14 — Settings как overlay поверх main UI. Закрывается
            через onBack из внутреннего SettingsSidebar. Visually full-screen
            (z-50 + inset-0 + bg-bg-surface), но main под ним сохраняет
            mounted state (TablesScreen webview'ы не пересоздаются). */}
        {showSettings && (
          <div className="absolute inset-0 z-50 flex bg-bg-surface">
            <SettingsScreen
              myRole={session.role}
              myLogin={session.user.login}
              onBack={() => setShowSettings(false)}
            />
          </div>
        )}

        {updateInfo && (
          <UpdateConfirmDialog
            open={updateConfirmOpen}
            newVersion={updateInfo.currentVersion}
            onConfirm={() => void handleUpdateConfirm()}
            onCancel={() => setUpdateConfirmOpen(false)}
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

  /**
   * Kill switch wipe — server triggered 'wiping' через WS. В отличие от
   * wipeUserData выше (только soft-clear stores + cache), этот стирает
   * ВЕСЬ userData (включая device.bin = device_id и session.bin) через
   * main process IPC и relaunch'ит app. После relaunch выглядит как fresh
   * install: новый device_id, no session → попытка login вернёт 423
   * пока developer не cancel'нёт state на сервере.
   */
  async function triggerAppLockWipe(): Promise<void> {
    useAppLockStore.getState().markCurrentWiping('desktop');
    // Best-effort confirm на сервер — server и так сам пометил device wiped
    // через checkAndTriggerWipe(), но audit row добавится.
    try {
      const did = getDeviceId();
      if (did) await confirmWipe(api, did);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:app-lock] confirmWipe failed:', err);
    }
    // Stop WS перед wipe — иначе reconnect попробует пройти после relaunch.
    try { await stopWs(); } catch { /* ignore */ }
    // IPC wipe — main process стирает userData и relaunch'ит. После
    // вызова renderer process получает SIGTERM, дальше не выполняется.
    try {
      await window.pyn?.appLock?.wipe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pyn:app-lock] wipe IPC failed:', err);
    }
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
