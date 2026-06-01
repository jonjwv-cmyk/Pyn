import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Sidebar } from '@/components/sidebar';
import { AiAssistantPanel } from '@/components/ai/AiAssistantPanel';
import { useAiStore } from '@/lib/ai-store';
import { ChatConversation, ChatList } from '@/components/chats';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { MolScreen } from '@/components/mol';
import { initMol, refreshMolFromServer } from '@/lib/mol-repo';
import { initWarehouses, refreshWarehousesFromServer } from '@/lib/warehouses-repo';
import { prefetchScheduleMonthsMeta } from '@/lib/schedule/use-schedule-sync';
import { NewsFeed } from '@/components/news';
import { ProbaScreen } from '@/components/proba';
import { StorageScreen } from '@/components/storage';
import { TablesScreen } from '@/components/tables';
import { UpdateConfirmDialog } from '@/components/system/UpdateConfirmDialog';
import { SettingsScreen } from '@/components/settings';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { SplashScreen } from '@/components/auth/SplashScreen';
import { SessionExpiryWatch } from '@/components/auth/SessionExpiryWatch';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { useWsEvent } from '@/lib/ws';
import { useChatsStore, useMolStore, useNewsStore, useOutboxStore, usePresenceStore, useSessionInfoStore, useStatsStore, useUiStateStore, useUsersStore } from '@/lib/stores';
import { initDeviceId } from '@/lib/device';
import { applyAppFont } from '@/lib/app-font';
import { computeInitials } from '@/lib/initials';
import { wireToChatMessage, wireToChatPartnerFromMessage } from '@/lib/repositories/chats-repo';
import { extractPresenceFromChatWires } from '@/lib/repositories/presence-fill';
import { isAuthFailure } from '@/lib/version';
import { triggerAppLockWipe, wipeUserData } from '@/lib/wipe';
import {
  useAuthFailureHandler,
  useInitI18n,
  useUpdateFlow,
  useWsLifecycle,
} from '@/lib/hooks';
import type { ChatPartner } from '@/types/chat';
import type { NavSectionId } from '@/types/nav';
import {
  ApiError,
  addReaction,
  CHATS_STALE_MS,
  getAdminChat,
  getAdminMessages,
  getAppLockStatus,
  getUsers,
  heartbeat,
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
  type BaseChangedEvent,
  type WarehousesChangedEvent,
  type NewMessageEvent,
  type Session,
  type SheetLockAcquiredEvent,
  type SheetLockReleasedEvent,
} from '@pyn/core';
import { AppLockOverlay } from '@/components/system/AppLockOverlay';

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
  // §pyn-1.2.54 — splash state machine. `splashSession` инкрементируется
  // при replay → useEffect ниже пересоздаёт timers. До этого фикса dep
  // на самом splashStage вызывал cleanup, который убивал свои же timers
  // (splash застревал на 'enter', 'done' никогда не наступал, кнопка
  // replay не показывалась).
  type SplashStage = 'splash' | 'enter' | 'done';
  const [splashStage, setSplashStage] = useState<SplashStage>('splash');
  const [splashSession, setSplashSession] = useState(0);
  // §2026-05-29 — hydrating объявлен ДО splash-эффектов: и замер иконки, и
  // запуск анимации ждут окончания hydration (когда смонтируется LoginScreen
  // с маркой), иначе на ПЕРВОМ запуске марка замеряется поздно и прыгает.
  const [hydrating, setHydrating] = useState(true);

  // §pyn-1.2.54 — runtime measurement реальной позиции PynMarkIcon в DOM.
  // §2026-05-30 — ПОЛЛИНГ всего окна до lift (фикс прыжка на холодном старте).
  // Карточка LoginScreen дорастает уже ПОСЛЕ mount (QR-панель/контент), и
  // иконка уезжает: ранний замер ловил transient (≈200), стабильная позиция
  // ≈186 → splash-mark приземлялась на 200, реальная иконка на 186 → прыжок.
  // НЕ останавливаемся на «двух совпавших» — начальное плато (200) держится
  // дольше интервала, и ранний стоп фиксировал бы transient. Сэмплируем каждые
  // 120ms всё окно до cap'а и обновляем target при каждом ИЗМЕНЕНИИ; последнее
  // изменение (после догрузки карточки) и есть стабильная позиция. Все апдейты
  // происходят ДО lift (mount + 2.3s) — translateY ещё 0 — поэтому невизуальны.
  const [iconCenterY, setIconCenterY] = useState<number | null>(null);
  useLayoutEffect(() => {
    // Пока hydration не завершён, LoginScreen (и марка) ещё не в DOM.
    if (session || hydrating) return;
    let cancelled = false;
    let prev: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const CAP_MS = 1900; // успеть до lift (mount + 2.3s) с запасом
    const sample = (): void => {
      if (cancelled) return;
      const icon = document.querySelector<HTMLElement>('[data-pyn-login-mark]');
      const rect = icon?.getBoundingClientRect();
      const cy =
        rect && rect.height > 0 ? Math.round(rect.top + rect.height / 2) : null;
      const elapsed = Date.now() - startedAt;
      if (cy !== null && cy !== prev) {
        setIconCenterY(cy);
        window.pyn?.debugLog?.('splash:measure', `cy=${cy} t=${elapsed}`);
        prev = cy;
      }
      if (elapsed < CAP_MS) timer = setTimeout(sample, 120);
    };
    sample();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, splashSession, hydrating]);
  const splashTargetY =
    iconCenterY !== null ? iconCenterY - window.innerHeight / 2 : null;

  // §pyn-1.2.54 — dev-кнопка для повтора splash. Инкремент splashSession
  // → useEffect ниже пересоздаст timers с нуля.
  const replaySplash = useCallback(() => {
    setIconCenterY(null);
    setSplashStage('splash');
    setSplashSession((s) => s + 1);
  }, []);
  useEffect(() => {
    // §2026-05-29 — splash-таймеры стартуют только ПОСЛЕ hydration (LoginScreen
    // смонтирован, иконка замерена) — иначе lift пойдёт с fallback и прыгнет.
    if (hydrating) return;
    // §diag — фиксируем каждый запуск таймеров (повторный запуск = причина double-lift).
    window.pyn?.debugLog?.('splash:timers', `run #${splashSession} @${Date.now()}`);
    setSplashStage('splash');
    // §pyn-1.2.54 — тайминги:
    //   0–0.6s         → пустой тёмный экран
    //   0.6–1.45s      → полоски влетают и формируют логотип
    //   1.8–2.3s       → mark shrink
    //   2.3–3.25s      → mark lift к icon position
    //   3.25–3.6s      → hold
    //   3.6s enter     → outline draws по часовой стрелке (1.4s)
    //   5.0–5.5s       → splash-bg dissolves (0.5s), LoginScreen pattern revealed
    //   5.5–6.9s       → card animation вырастает из иконки (1.4s, SEQUENTIAL после bg)
    //   6.9s done      → splash unmount, LoginScreen mark visible
    const enterId = setTimeout(() => setSplashStage('enter'), 3600);
    const doneId = setTimeout(() => setSplashStage('done'), 6900);
    return () => {
      clearTimeout(enterId);
      clearTimeout(doneId);
    };
  }, [splashSession, hydrating]);
  // §diag — лог каждого перехода splashStage: на холодном старте увидим, если
  // 'splash' появляется дважды (повторный lift). Снять после фикса.
  useEffect(() => {
    window.pyn?.debugLog?.('splash:stage', `${splashStage} @${Date.now()}`);
  }, [splashStage]);
  const [collapsed, setCollapsed] = useState(false);
  // Update flow state machine вынесен в useUpdateFlow hook (см. lib/hooks/use-update-flow.ts).
  // Источник правды — sidebar pill (click drives transitions).
  const {
    updateInfo,
    updateStage,
    updateBytes,
    updateTotal,
    updateLocalPath,
    updateConfirmOpen,
    setUpdateConfirmOpen,
    handleUpdatePillClick,
    handleUpdateConfirm,
  } = useUpdateFlow(session);
  // activeSection + activeChatId — persistent UI-state: при перезапуске
  // Pyn'a продолжаем с того же раздела и чата (Telegram-style continuation).
  const activeSection = useUiStateStore((s) => s.activeSection as NavSectionId);
  const setActiveSection = useUiStateStore((s) => s.setActiveSection);
  const activeChatId = useUiStateStore((s) => s.activeChatId);
  const setActiveChatId = useUiStateStore((s) => s.setActiveChatId);

  // §шрифт — применяем выбранный шрифт глобально через CSS-переменную --app-font.
  // appFont персистится в ui-state-store; на старте = persisted (или 'inter'),
  // после hydration селектор обновится → эффект переставит переменную.
  const appFont = useUiStateStore((s) => s.appFont);
  useEffect(() => {
    applyAppFont(appFont);
  }, [appFont]);
  // §pyn-1.2.54 — openedChatIds: per-peer persistent DOM tree (Tables-style).
  // Каждый chat юзер хоть раз кликнул — остаётся mounted с display-toggle до
  // logout / restart. При inter-chat switch DOM tree уже-открытого peer'a
  // preserved → scroll и загруженные images intact → instant без re-mount
  // ChatMessage/AttachmentTile (которые бы дали fresh `<img>` async-load CLS).
  // Не persist между restart'ами — fresh start = пустой Set, первый клик
  // open'ит (один initial-load CLS как обычно).
  const [openedChatIds, setOpenedChatIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!activeChatId) return;
    setOpenedChatIds((prev) => {
      if (prev.has(activeChatId)) return prev;
      const next = new Set(prev);
      next.add(activeChatId);
      return next;
    });
  }, [activeChatId]);
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

  useInitI18n();

  useAuthFailureHandler(
    useCallback(() => {
      void (async () => {
        await wipeUserData();
        setSession(null);
        setActiveChatId(null);
      })();
    }, [setActiveChatId]),
  );

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

  useWsLifecycle(session);

  // Tray menu → «Настройки»: открыть Settings overlay в основном окне.
  // Main process присылает 'pyn:tray:open-settings' через IPC.
  useEffect(() => {
    const unsub = window.pyn?.tray?.onOpenSettings?.(() => {
      setShowSettings(true);
    });
    return () => {
      unsub?.();
    };
  }, []);

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
      // §pyn-1.2.39 — заполняем presenceStore из попутных presence-полей в wire.
      // Тем самым source-of-truth для presence единый (см. presence-store.ts).
      usePresenceStore.getState().setMany(extractPresenceFromChatWires(wire));
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
      .then((users) => {
        setUsers(users);
        // §pyn-1.2.39 — попутно fill presenceStore.
        usePresenceStore.getState().setMany(
          users.map((u) => ({ login: u.login, status: u.presenceStatus, lastSeenAt: u.lastSeenAt })),
        );
      })
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
      userLogin: event.user_login || '',
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
    // Складская база («Цеха») — тот же паттерн: eager preload (кэш + сервер).
    void initWarehouses();
    // Прогреваем мету графика (prev/current/next) — карточки склада показывают
    // дни доставки сразу, без async pop-in при первом открытии Базы.
    prefetchScheduleMonthsMeta();
  }, [session]);
  useWsEvent<BaseChangedEvent>('base_changed', (event) => {
    // §pyn-1.2.21 — server теперь шлёт counts → optimistic update мета
    // (UI MolTopBar мгновенно показывает «было N → сейчас M (±K)»), а
    // снапшот records догружается в фоне для actual поиска.
    if (event.records_count !== undefined || event.previous_records_count !== undefined) {
      useMolStore.getState().setCountsFromWs({
        recordsCount: event.records_count ?? null,
        previousRecordsCount: event.previous_records_count ?? null,
      });
    }
    void refreshMolFromServer({ force: true });
  });
  // Склады: админ/разработчик правит карточку → server broadcast → refetch у всех.
  useWsEvent<WarehousesChangedEvent>('warehouses_changed', () => {
    void refreshWarehousesFromServer({ force: true });
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

  // §pyn-1.2.32 — focus-refetch fallback. В корп окружениях где WS не открывается
  // (HTTP 407 от прокси с NTLM) push-события `new_message` / `app_version_changed`
  // не доходят. При возврате фокуса на Pyn делаем re-fetch через HTTP-канал
  // (он работает прозрачно через NTLM). Это не polling: триггерится естественным
  // действием юзера. Дополнительно dispatch'ает 'pyn:refresh-on-focus' —
  // useUpdateFlow и NewsFeed подписаны и тоже сделают свой re-fetch.
  useEffect(() => {
    if (!session) return;
    const onFocus = () => {
      void refreshConversations();
      window.dispatchEvent(new CustomEvent('pyn:refresh-on-focus'));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session, refreshConversations]);

  // §pyn-1.2.34 — handler `unread_update` (server broadcasts when статус
  // сообщения меняется на 'read'). Раньше handler отсутствовал → counter
  // у других admin/dev клиентов не пересчитывался когда один из них прочитал
  // сообщение от user/client. Теперь shared inbox sync'ируется live.
  useWsEvent('unread_update', () => {
    if (!session) return;
    void refreshConversations();
  });

  // §pyn-1.2.38 → §pyn-1.2.39 — presence_change handler. Server broadcast'ит
  // при изменении app_state любого user'а (через heartbeat в v1.2.39 и при
  // WS hello/close в любой версии). В v1.2.39 источник правды — глобальный
  // `usePresenceStore`; компоненты (UserListRow, ChatList, ChatConversation
  // header, NewsStatsDialog) читают presence оттуда по login. Один WS push →
  // обновляется во всех местах одновременно.
  useWsEvent<{
    type: 'presence_change';
    login: string;
    status: string;
    last_seen_at?: string;
  }>('presence_change', (event) => {
    if (!event.login) return;
    usePresenceStore.getState().setOne(event.login, event.status, event.last_seen_at);
  });

  // §pyn-1.2.39 — message_read handler. Server broadcast'ит при mark_message_read
  // чат-сообщения. Помечаем own message как прочитанное в открытом чате
  // (если он сейчас активен и сообщение там есть) → ✓✓ появляются мгновенно
  // без re-entry в чат. Юзер увидел уведомление о новом сообщении в mobile,
  // открыл его → server marks read → desktop отправитель видит ✓✓ за ~500ms.
  useWsEvent<{
    type: 'message_read';
    message_id: number;
    reader_login: string;
    sender_login: string;
  }>('message_read', (event) => {
    if (!session) return;
    // Меня интересует только когда МОЁ сообщение прочитано. Server шлёт всем
    // в room, но имеет смысл только для отправителя — отображаем ✓✓.
    if (event.sender_login !== session.user.login) return;
    const peer = event.reader_login;
    const messages = useChatsStore.getState().messagesByPeer[peer];
    if (!messages || messages.length === 0) return;
    let mutated = false;
    const next = messages.map((m) => {
      if (m.isOwn && m.numericId === event.message_id && !m.isRead) {
        mutated = true;
        return { ...m, isRead: true };
      }
      return m;
    });
    if (mutated) setMessagesForPeer(peer, next);
  });

  // §pyn-1.2.38 → §pyn-1.2.48 — heartbeat строго event-driven. Source-of-truth
  // для visibility — native Electron events (BrowserWindow on minimize/hide/
  // restore/show) через IPC; window blur/focus + navigator online/offline
  // оставлены как fallback (срабатывают когда юзер переключился на другое
  // приложение или сеть отвалилась).
  //
  // §pyn-1.2.48 — regular 30s interval УБРАН. Сервер актуализирует last_seen
  // на любом authed action (см. server-modular/index.js middleware), а cron
  // sweep (раз в 5 мин, threshold 20 мин) подчищает дохлые сессии. Это даёт
  // ~120 req/час экономии CF на одного клиента без потери presence accuracy.
  //
  // Server использует `app_state` в sessions для aggregation:
  //   • foreground recently → online
  //   • background → paused (через grace window)
  //   • никакой активности > 20 мин → offline (via cron sweep)
  useEffect(() => {
    if (!session) return;
    const myLogin = session.user.login;
    let currentState: 'foreground' | 'background' = document.hasFocus()
      ? 'foreground'
      : 'background';

    // §pyn-1.2.42 — обёртка вокруг heartbeat. Success → setOne authoritative
    // self-status от сервера. Fail (network error) → setOne offline — юзер
    // сам видит у себя offline когда сеть упала, не «лжёт» себе online.
    const sendHeartbeat = (state: 'foreground' | 'background'): void => {
      heartbeat(api, state)
        .then((res) => {
          usePresenceStore.getState().setOne(myLogin, res.presenceStatus, res.lastSeenAt);
        })
        .catch(() => {
          // Network/server failure — мы offline относительно сервера.
          usePresenceStore.getState().setOne(myLogin, 'offline');
        });
    };

    // §pyn-1.2.42 — optimistic при mount: ставим self online сразу, пока
    // первый heartbeat не подтвердил. Без этого UI читает stale persisted
    // status из прошлой сессии (если был paused — жёлтая точка мигает).
    usePresenceStore.getState().setOne(myLogin, 'online');
    sendHeartbeat(currentState);

    const setState = (state: 'foreground' | 'background'): void => {
      if (currentState === state) return;
      currentState = state;
      sendHeartbeat(state);
    };
    const onFocus = () => setState('foreground');
    const onBlur = () => setState('background');
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    // §pyn-1.2.41 — native BrowserWindow events через IPC. Точнее чем
    // window.blur/focus: ловит minimize-в-taskbar и hide-в-tray, которые
    // в Win-Chromium не всегда триггерят web blur.
    const unsubVisibility = window.pyn?.onVisibilityChange?.(setState);
    // §pyn-1.2.42 — navigator online/offline. Когда браузер сам обнаружил
    // сетевую недоступность — instant offline без ожидания heartbeat fail.
    const onOnline = () => sendHeartbeat(currentState);
    const onOffline = () => {
      usePresenceStore.getState().setOne(myLogin, 'offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubVisibility?.();
    };
  }, [session]);

  // new_message → refresh conversations + если открыт чат с этим peer'ом,
  // перезагрузить переписку (или append, если это собственный outgoing).
  useWsEvent<NewMessageEvent>('new_message', (event) => {
    if (!session) return;
    const myLogin = session.user.login;
    void refreshConversations();
    // §fix — в админ-инбоксе переписка ВСЕГДА идентифицируется юзером (не-
    // админом), независимо от того, какой админ отправил:
    //   user→admins (receiver='admins') → peer = отправитель (юзер);
    //   admin→user  (receiver=<user>)   → peer = получатель (юзер).
    // Раньше для чужого ответа (sender = ДРУГОЙ админ) peer вычислялся как
    // sender=админ ≠ activeChatId(юзер) → открытая переписка у второго админа
    // не перезагружалась, его ответ не появлялся в реальном времени.
    const relevantPeer =
      event.receiver_login === 'admins' ? event.sender_login : event.receiver_login;
    if (activeChatId && relevantPeer === activeChatId) {
      getAdminChat(api, { userLogin: activeChatId, limit: 200 })
        .then((wire) => {
          usePresenceStore.getState().setMany(extractPresenceFromChatWires(wire));
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
        usePresenceStore.getState().setMany(extractPresenceFromChatWires(wire));
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

  // §pyn-1.2.54 — partnersById для O(1) lookup при render'е opened-chat-Map.
  const partnersById = useMemo(() => {
    const map = new Map<string, ChatPartner>();
    for (const p of partners) map.set(p.id, p);
    return map;
  }, [partners]);

  // §pyn-1.2.37 — dedup IDs которые уже пометили прочитанными. Без этого
  // intersection observer мог бы повторно слать mark_message_read при
  // ре-mount компонента (новый messages array, тот же id) → лишние HTTP.
  const markedReadRef = useRef<Set<number>>(new Set());
  const handleChatMarkRead = useCallback((messageId: number): void => {
    if (!session) return;
    if (markedReadRef.current.has(messageId)) return;
    markedReadRef.current.add(messageId);
    void markMessageRead(api, messageId).catch((err) => {
      markedReadRef.current.delete(messageId);
      // eslint-disable-next-line no-console
      console.warn('intersection mark_read failed:', err);
    });
  }, [session]);

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
    // §pyn-1.2.54 — `data-splash-stage` attribute на wrapper cascade'ит к
    // потомкам, CSS таргетит `[data-login-card]` (карточка LoginScreen)
    // для animation. Pattern bg LoginScreen остаётся СТАТИЧНЫМ — animation
    // применяется ТОЛЬКО на card, не на wrapper.
    return (
      <Tooltip.Provider delayDuration={200} skipDelayDuration={1500} disableHoverableContent>
        {splashStage !== 'done' && (
          <SplashScreen
            targetY={splashTargetY}
            iconCenterY={iconCenterY}
          />
        )}
        <div className="h-full" data-splash-stage={splashStage}>
          <LoginScreen onSuccess={setSession} />
        </div>
        {import.meta.env.DEV && splashStage === 'done' && (
          <button
            type="button"
            onClick={replaySplash}
            className="fixed bottom-4 right-4 z-[2000] rounded-full border border-border-default bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-secondary shadow-lg transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            ↻ Splash
          </button>
        )}
      </Tooltip.Provider>
    );
  }

  const initials = computeInitials(session.user.fullName || session.user.login);

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={1500} disableHoverableContent>
      <SessionExpiryWatch />
      <div className="relative flex h-full w-full bg-bg-deep">
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
              showAi={isAdminLike(session.role)}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
              onAiClick={() => useAiStore.getState().setOpen(true)}
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

            {/* §design — График вынесен из общей карточки: его тулбар живёт на
                подложке (слой сайдбара), а контент — в собственном WorkspaceCard.
                Пилот нового shell-паттерна (остальные экраны — следом). */}
            {activeSection === 'proba' && <ProbaScreen />}

            {/* §design — МОЛ вынесен на подложку: MolTopBar (h-9 прозрачная) +
                контент в WorkspaceCard. Always-mounted (display-toggle) как
                Новости/Таблицы — тяжёлый лист «Цеха» не пересоздаётся при
                возврате в раздел: мгновенный switch, scroll/состояние в DOM. */}
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ display: activeSection === 'mol' ? 'flex' : 'none' }}
            >
              <MolScreen />
            </div>

            {/* §design — Хранилище вынесено на подложку: h-9 шапка + контент
                (Breadcrumb/Home/FileList) в WorkspaceCard. Conditional render —
                storage-store держит currentPath между mount'ами. */}
            {activeSection === 'vault' && <StorageScreen />}

            {/* §design — Новости always-mounted, вынесены на подложку: шапка на
                подложке + контент в WorkspaceCard (внутри NewsFeed). */}
            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ display: activeSection === 'news' ? 'flex' : 'none' }}
            >
              <NewsFeed
                currentUserInitials={initials}
                currentUserName={session.user.fullName || session.user.login}
                currentUserLogin={session.user.login}
                currentUserRole={session.role}
              />
            </div>

            {/* §design — Таблицы always-mounted (webview pool как фоновые
                browser-tabs), вынесены на подложку: h-9 шапка + webview-pool в
                WorkspaceCard. display-toggle (не unmount) держит webContents
                Chromium живыми — мгновенный switch при возврате. */}
            <div
              className="flex flex-1 flex-col"
              style={{ display: activeSection.startsWith('sheet:') ? 'flex' : 'none' }}
            >
              <TablesScreen
                currentUserName={session.user.fullName || session.user.login}
                currentUserLogin={session.user.login}
              />
            </div>

            {/*
              §pyn-1.2.54 — Chats: always-mounted ChatList + per-peer ChatConversation
              Map (Tables-style). Каждый chat юзер хоть раз открыл — свой
              ChatConversation остаётся mounted в DOM (display: flex/none).
              Inter-chat switch = display toggle, никакого re-mount ChatMessage/
              AttachmentTile, никакого fresh async-image-load CLS, scroll и
              decrypted blob URLs preserved браузером. Empty-state (activeChatId=null
              или peer ещё не в opened-set) показывается отдельным ChatConversation
              с partner=null. Memory: один ChatConversation на каждый посещённый
              в этой сессии chat (типично <30); очищается на logout/wipe.
            */}
            <div
              className="flex flex-1 flex-col"
              style={{
                display: activeSection === 'chats' ? 'flex' : 'none',
              }}
            >
              {/* §design — h-9 шапка на подложке (как у остальных экранов: МОЛ/
                  Новости/...), чтобы WorkspaceCard начинался на той же высоте и
                  подложка была одного размера во всех разделах. */}
              <ChatsScreenHeader />
              {/* §design — список + переписка как ОДНО окно: общий chat-pattern-bg
                  фон на всю карточку, слева прозрачный список, справа переписка.
                  Без разделительной полосы между ними. */}
              <WorkspaceCard>
                {/* p-4 — единое поле 16px по периметру (как на всех листах):
                    список + переписка стоят ровно на этой линии. Фон-паттерн —
                    во всю карточку. */}
                <div className="chat-pattern-bg flex min-h-0 flex-1 p-4">
                  <ChatList
                    conversations={partners}
                    activeId={activeChatId}
                    onSelect={setActiveChatId}
                  />
                  <div className="relative flex min-w-0 flex-1 flex-col">
                    <div
                      className="flex flex-1 flex-col"
                      style={{
                        display: activeChat ? 'none' : 'flex',
                      }}
                    >
                      <ChatConversation
                        partner={null}
                        messages={[]}
                        onSend={(text, atts, replyToId) => {
                          void handleSendMessage(text, atts, replyToId);
                        }}
                        onReact={handleChatReact}
                        onMarkRead={handleChatMarkRead}
                      />
                    </div>
                    {Array.from(openedChatIds).map((peerId) => {
                      const peer = partnersById.get(peerId);
                      if (!peer) return null;
                      const peerMessages = messagesByPeer[peerId] ?? [];
                      const isActive = activeChatId === peerId;
                      return (
                        <div
                          key={peerId}
                          className="flex flex-1 flex-col"
                          style={{ display: isActive ? 'flex' : 'none' }}
                        >
                          <ChatConversation
                            partner={peer}
                            messages={peerMessages}
                            onSend={(text, atts, replyToId) => {
                              void handleSendMessage(text, atts, replyToId);
                            }}
                            onReact={handleChatReact}
                            onMarkRead={handleChatMarkRead}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </WorkspaceCard>
            </div>
        </>

        {/* §v1.2.14 — Settings как overlay поверх main UI. Закрывается
            через onBack из внутреннего SettingsSidebar. Visually full-screen
            (z-50 + inset-0 + bg-bg-surface), но main под ним сохраняет
            mounted state (TablesScreen webview'ы не пересоздаются). */}
        {showSettings && (
          <div className="absolute inset-0 z-50 flex bg-bg-deep">
            <SettingsScreen
              myRole={session.role}
              myLogin={session.user.login}
              onBack={() => setShowSettings(false)}
            />
          </div>
        )}

        {/* ИИ-помощник — общий чат в правом нижнем углу (admin/developer). */}
        {isAdminLike(session.role) && (
          <AiAssistantPanel
            myLogin={session.user.login}
            myName={session.user.fullName || session.user.login}
          />
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

}

/**
 * h-9 шапка раздела Чаты на подложке (drag-region) — зеркало шапок других
 * экранов (МОЛ/Новости/Хранилище). Нужна, чтобы WorkspaceCard начинался на
 * одной высоте во всех разделах и подложка была одного размера.
 */
function ChatsScreenHeader(): JSX.Element {
  const { t } = useTranslation();
  return (
    <header className="drag-region flex h-9 shrink-0 items-center px-4">
      <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
        {t('sidebar.nav_chats')}
      </span>
    </header>
  );
}
