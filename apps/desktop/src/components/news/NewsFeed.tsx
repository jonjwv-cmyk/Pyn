import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Clock, Upload } from 'lucide-react';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { DateDivider } from '@/components/ui/DateDivider';
import { DayLabelPill } from '@/components/ui/DayLabelPill';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { api } from '@/lib/api';
import { formatDateFullYek, formatDayDividerLabel, yekDayKeyFor } from '@/lib/format-time';
import { useFileDrop } from '@/lib/use-file-drop';
import { useNewsStore, useStatsStore, useUiStateStore } from '@/lib/stores';
import { useScrollDayPill } from '@/lib/use-scroll-day-pill';
import { useWsEvent } from '@/lib/ws';
import { wireToNewsItem } from '@/lib/repositories/news-repo';
import {
  addReaction,
  ApiError,
  can,
  getNews,
  loadDraft,
  markMessageRead,
  pinMessage,
  removeReaction,
  saveDraft,
  scheduleMessage,
  sendNews,
  softDeleteMessage,
  unpinMessage,
  voteNewsPoll,
  type NewsItem,
  type Role,
} from '@pyn/core';
import { cn } from '@/lib/cn';
import { NewsCard } from './NewsCard';
import { NewsComposer, type NewsComposerHandle } from './NewsComposer';
import { NewsPollDialog } from './NewsPollDialog';
import { EmptyPinSlot, PinDropPreview, PinnedPill } from './PinnedPill';
import { ScheduledListDialog } from './ScheduledListDialog';

const NEWS_DRAFT_SCOPE = 'news';
const SCHEDULED_TOAST_MS = 4000;
// Лимит закреплённых (3 «слота» правой колонки). Зеркалит server-side
// enforcement (handlers pin_message → pin_limit_reached) — клиент проверяет
// ПЕРВЫМ, до оптимистичного pin'а, чтобы показать «лимит превышен» сразу.
const MAX_PINNED = 3;

interface NewsFeedProps {
  currentUserInitials: string;
  currentUserName: string;
  currentUserLogin: string;
  /** Role текущего пользователя — для permission gating (post / pin / delete). */
  currentUserRole: Role;
}

/**
 * Главная зона раздела Новости. Stale-while-revalidate из `useNewsStore`:
 *   • Cached items рендерятся мгновенно (Zustand persist через safeStorage)
 *   • Если cache stale (>5 min) или пуст → background refetch на mount
 *   • WS `new_news` / `news_update` → silent refetch
 *   • Optimistic mutations (react/vote/pin/delete) через store actions,
 *     revert через refetch при ошибке API call'a
 */
export function NewsFeed({
  currentUserInitials,
  currentUserName,
  currentUserLogin,
  currentUserRole,
}: NewsFeedProps) {
  const { t, i18n } = useTranslation();
  // Permission: только admin/developer могут публиковать новости.
  const canPost = can(currentUserRole, 'news.post');
  // Закреплять (в т.ч. drag-to-pin из ленты) — тоже admin/developer.
  const canPin = can(currentUserRole, 'news.pin');
  const items = useNewsStore((s) => s.items);
  const lastFetchedAt = useNewsStore((s) => s.lastFetchedAt);
  const setItems = useNewsStore((s) => s.setItems);
  const updateItem = useNewsStore((s) => s.updateItem);
  const removeItem = useNewsStore((s) => s.removeItem);

  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<NewsComposerHandle>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // Drag-to-pin: подсветка правой колонки + id перетаскиваемой новости (для
  // превью в целевом слоте, пока тащат из ленты).
  const [pinDragActive, setPinDragActive] = useState(false);
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [scheduledDialogOpen, setScheduledDialogOpen] = useState(false);
  // Drag-and-drop: бросаем файлы в любую часть feed-area, composer прицепит.
  const { dragging, dropProps } = useFileDrop((files) => {
    composerRef.current?.addFiles(files);
  });
  const dayPill = useScrollDayPill(scrollRef);
  // Draft loaded с сервера. Передаётся в Composer как `initialText`; повторное
  // изменение игнорируется — Composer защищает себя через userTypedRef.
  const [initialDraft, setInitialDraft] = useState<string>('');
  // Banner после scheduleMessage success. `null` — скрыт; строка — текст
  // "Запланировано на 5 мая, 2:34 PM". Авто-скрывается через timer ref ниже.
  const [scheduledToast, setScheduledToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §pyn-1.2.54 — error-dialog для pin/unpin failures (limit reached, network).
  // Центрированный alert-dialog с backdrop + кнопкой «Принято» — заметнее тоста,
  // юзер должен дочитать message и явно подтвердить.
  const [errorDialogMessage, setErrorDialogMessage] = useState<string | null>(null);

  // §pyn-1.2.37 — dedup mark-read для новостей. Intersection-observer в NewsCard
  // emit'ит при первом попадании в viewport, но при scroll back и refresh items
  // мог бы повторно сработать → лишний HTTP. Set хранит уже-отправленные id.
  const markedReadRef = useRef<Set<number>>(new Set());
  const handleNewsMarkRead = useCallback((newsId: number): void => {
    if (markedReadRef.current.has(newsId)) return;
    markedReadRef.current.add(newsId);
    void markMessageRead(api, newsId).catch((err) => {
      markedReadRef.current.delete(newsId);
      // eslint-disable-next-line no-console
      console.warn('news mark_read failed:', err);
    });
  }, []);

  const refreshNews = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const wire = await getNews(api, { limit: 50 });
      // Сервер шлёт newest-first; UI хочет chat-style (newest внизу) — переворачиваем.
      const mapped = wire.map((w) => wireToNewsItem(w, currentUserLogin));
      mapped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setItems(mapped);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('news.load_failed'));
    }
  }, [currentUserLogin, setItems]);

  // §pyn-1.2.54 — Initial mount: ВСЕГДА refreshNews (без isNewsStale check).
  // Persisted store мог иметь stale pinned state (например, 143 застряла с 3 мая,
  // юзер не видел её на client → server считал 3 pinned → 4-я pin fails). Always-
  // refresh гарантирует свежее состояние pinned. Cache показывается мгновенно
  // (stale-while-revalidate), fresh data заменяет через несколько ms.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void refreshNews();
  }, [refreshNews]);

  // §pyn-1.2.32 — focus-refetch fallback (App.tsx dispatch'ает custom event при
  // window focus). В сетях где WS не работает — `new_news` push не доходит,
  // счётчики и новые посты не появляются. При возврате фокуса делаем re-fetch
  // через HTTP-канал.
  useEffect(() => {
    const onRefresh = () => { void refreshNews(); };
    window.addEventListener('pyn:refresh-on-focus', onRefresh);
    return () => window.removeEventListener('pyn:refresh-on-focus', onRefresh);
  }, [refreshNews]);

  // Real-time: `new_news` при публикации, `news_update` при любой мутации.
  // На news_update параллельно инвалидируем cached статистику этого message —
  // следующий open NewsStatsDialog / ReactionVotersPopover ре-fetch'нет.
  useWsEvent('new_news', () => {
    void refreshNews();
  });
  useWsEvent<{ type: 'news_update'; id?: number; kind?: string }>('news_update', (event) => {
    void refreshNews();
    if (typeof event.id === 'number') {
      const target = items.find((it) => it.id === event.id);
      const pollId = target?.poll?.id;
      useStatsStore.getState().invalidateMessage(event.id, pollId);
    }
    // Server cron перебрасывает pending → sent и эмитит kind=scheduled_sent —
    // инвалидируем кеш scheduled-списка, чтобы при следующем open диалога UI
    // увидел свежий статус.
    if (event.kind === 'scheduled_sent') {
      useStatsStore.getState().invalidateScheduled();
    }
  });

  // Загрузить serverный черновик при mount — только для admin/developer
  // (только они видят композер). Тихо игнорируем ошибки: пустой draft = OK.
  useEffect(() => {
    if (!canPost) return;
    let cancelled = false;
    loadDraft(api, NEWS_DRAFT_SCOPE)
      .then((d) => {
        if (!cancelled && d.text) setInitialDraft(d.text);
      })
      .catch(() => {
        /* draft load fail — composer стартует пустым */
      });
    return () => {
      cancelled = true;
    };
  }, [canPost]);

  // Cleanup toast timer'a — иначе при unmount setState на размонтированный.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleDraftSave = useCallback((text: string) => {
    // Server трактует пустой text как DELETE — отдельной ветки не нужно.
    saveDraft(api, { scope: NEWS_DRAFT_SCOPE, text }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[pyn:news] save_draft failed:', err);
    });
  }, []);

  const showScheduledToast = (when: Date) => {
    setScheduledToast(t('news.scheduled_toast', { date: formatDateFullYek(when) }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setScheduledToast(null);
      toastTimerRef.current = null;
    }, SCHEDULED_TOAST_MS);
  };

  const showErrorDialog = (msg: string): void => {
    setErrorDialogMessage(msg);
  };

  const pinned = useMemo(() => items.filter((i) => i.isPinned), [items]);


  // Группировка news-карточек по yek-дню для date-разделителей. Pinned
  // дублируются — они И сверху как pill, И в общем потоке (Telegram-style).
  // Это позволяет click'у на pinned-pill `scrollIntoView` к real-row в ленте.
  // §pyn-1.2.25 — `i18n.language` в deps: иначе при смене языка через Settings
  // useMemo не пересчитывается → labels («16 мая») остаются на старой локали
  // пока компонент не re-mount'нется (лента mounted постоянно, в отличие от
  // ChatConversation который re-mount'ится при смене peer'а).
  const newsGroups = useMemo(() => {
    const out: { dayKey: number; label: string; items: typeof items }[] = [];
    for (const item of items) {
      const dayKey = yekDayKeyFor(item.createdAt);
      if (dayKey === null) {
        const last = out[out.length - 1];
        if (last) last.items.push(item);
        else out.push({ dayKey: 0, label: '', items: [item] });
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.dayKey === dayKey) {
        last.items.push(item);
      } else {
        out.push({
          dayKey,
          label: formatDayDividerLabel(item.createdAt),
          items: [item],
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, i18n.language]);

  // Persist scroll-position. Persist через safeStorage IPC = async,
  // throttled save (250ms после паузы) чтобы не спамить IPC writes.
  const persistedScrollTop = useUiStateStore((s) => s.newsScrollTop);
  const setPersistedScrollTop = useUiStateStore((s) => s.setNewsScrollTop);
  const [uiHydrated, setUiHydrated] = useState(() => useUiStateStore.persist.hasHydrated());
  const scrollRestoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScrollRef = useRef<number>(-1);

  useEffect(() => {
    if (uiHydrated) return;
    const unsub = useUiStateStore.persist.onFinishHydration(() => setUiHydrated(true));
    return unsub;
  }, [uiHydrated]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);
    dayPill.onScroll();
    // Throttled save — только после restore (иначе автоскролл перезатёр бы)
    // и если значение реально изменилось.
    if (!uiHydrated || !scrollRestoredRef.current) return;
    const current = el.scrollTop;
    if (Math.abs(current - lastSavedScrollRef.current) < 8) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedScrollRef.current = current;
      setPersistedScrollTop(current);
    }, 250);
  };

  useEffect(() => {
    checkScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Restore scroll с ResizeObserver — в news cards images/videos подгружаются
  // лениво, DOM растёт после первого render'a. Если бы применили scrollTop
  // только один раз, последующий image-load расширил бы content и видимая
  // позиция съехала бы. Поэтому re-apply при каждом resize (на 3 секунды
  // или до первого user interaction'a — wheel/touch).
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    if (!uiHydrated) return;
    if (items.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = persistedScrollTop;

    // §pyn-1.2.54 — Fresh feed (saved<=0, например после QR login или wipe) →
    // scroll сразу в bottom (последние новости). ResizeObserver re-applies
    // scrollHeight при image/video lazy-load — 3s lock или до user-action.
    // Это зеркало chat fresh-case: «открываем на самых свежих».
    if (target <= 0) {
      el.scrollTop = el.scrollHeight;
      lastSavedScrollRef.current = el.scrollTop;
      const followBottom = new ResizeObserver(() => {
        if (scrollRestoredRef.current) return;
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
      });
      followBottom.observe(el);
      for (const child of Array.from(el.children)) followBottom.observe(child);
      const freshLockTimer = setTimeout(() => {
        scrollRestoredRef.current = true;
        followBottom.disconnect();
      }, 3000);
      const onFreshUserAction = (): void => {
        scrollRestoredRef.current = true;
        followBottom.disconnect();
        clearTimeout(freshLockTimer);
      };
      el.addEventListener('wheel', onFreshUserAction, { passive: true, once: true });
      el.addEventListener('touchstart', onFreshUserAction, { passive: true, once: true });
      el.addEventListener('keydown', onFreshUserAction, { once: true });
      return () => {
        followBottom.disconnect();
        clearTimeout(freshLockTimer);
        el.removeEventListener('wheel', onFreshUserAction);
        el.removeEventListener('touchstart', onFreshUserAction);
        el.removeEventListener('keydown', onFreshUserAction);
      };
    }

    // Immediate apply (target может clamp'нуться браузером если scrollHeight
    // ещё мал — это OK, ResizeObserver исправит когда content вырастет).
    el.scrollTop = target;

    // ResizeObserver на scroll-контейнер + все children — каждое
    // изменение размера (image onload, video metadata, и т.п.) триггерит
    // re-apply scrollTop, чтобы view оставался на сохранённой позиции.
    const reapply = (): void => {
      if (scrollRestoredRef.current) return;
      const node = scrollRef.current;
      if (!node) return;
      if (Math.abs(node.scrollTop - target) > 2) node.scrollTop = target;
    };
    const observer = new ResizeObserver(reapply);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    // Lock-in после 3 сек — content должен стабилизироваться. После этого
    // юзер свободно скроллит без auto-reapply.
    const stableTimer = setTimeout(() => {
      scrollRestoredRef.current = true;
      lastSavedScrollRef.current = el.scrollTop;
      observer.disconnect();
    }, 3000);

    // Любое user-инициированное действие (wheel/touch) → lock-in немедленно.
    const onUserAction = (): void => {
      scrollRestoredRef.current = true;
      lastSavedScrollRef.current = el.scrollTop;
      observer.disconnect();
      clearTimeout(stableTimer);
    };
    el.addEventListener('wheel', onUserAction, { passive: true, once: true });
    el.addEventListener('touchstart', onUserAction, { passive: true, once: true });
    el.addEventListener('keydown', onUserAction, { once: true });

    return () => {
      observer.disconnect();
      clearTimeout(stableTimer);
      el.removeEventListener('wheel', onUserAction);
      el.removeEventListener('touchstart', onUserAction);
      el.removeEventListener('keydown', onUserAction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiHydrated, items.length === 0]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  /**
   * Прокручивает ленту к новости с указанным id (smooth, в центр viewport).
   * Используется при клике на pinned-pill — Telegram-style «прыжок» к
   * закреплённому сообщению в основном feed'е.
   *
   * Подсветка ячейки (3с) — через временный data-attribute, CSS-анимация
   * `pulse` показывает где новость осела после скролла.
   */
  const jumpToNews = useCallback((newsId: number) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-news-id="${newsId}"]`);
    if (!target) return;
    // Скроллим ТОЛЬКО ленту (scrollRef), не через scrollIntoView — иначе браузер
    // прокручивает внешние контейнеры/окно и весь layout (сайдбар) «плывёт».
    const tRect = target.getBoundingClientRect();
    const rRect = root.getBoundingClientRect();
    const top = root.scrollTop + (tRect.top - rRect.top) - (root.clientHeight - tRect.height) / 2;
    root.scrollTo({ top, behavior: 'smooth' });
    target.setAttribute('data-news-flash', '1');
    setTimeout(() => target.removeAttribute('data-news-flash'), 1600);
  }, []);

  /**
   * Все мутации — optimistic update store actions + real API call.
   * При ошибке API: refreshNews() приведёт state к server-truth.
   * При успехе: server broadcastит news_update → useWsEvent выше тоже refetch'нет.
   */

  const handleReact = (newsId: number, emoji: string) => {
    const current = items.find((i) => i.id === newsId);
    if (!current) return;
    const wasMine = current.myReactions.includes(emoji);
    const currentCount = current.reactions[emoji] ?? 0;
    const nextCount = wasMine ? currentCount - 1 : currentCount + 1;
    const nextReactions = { ...current.reactions };
    if (nextCount <= 0) delete nextReactions[emoji];
    else nextReactions[emoji] = nextCount;
    updateItem(newsId, {
      myReactions: wasMine
        ? current.myReactions.filter((e) => e !== emoji)
        : [...current.myReactions, emoji],
      reactions: nextReactions,
    });
    const action = wasMine ? removeReaction : addReaction;
    action(api, { messageId: newsId, emoji }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('reaction failed:', err);
      void refreshNews();
    });
  };

  const handleVote = (newsId: number, optionId: number) => {
    const current = items.find((i) => i.id === newsId);
    if (!current || !current.poll || current.poll.myVoteOptionId !== null) return;
    const pollId = current.poll.id;
    updateItem(newsId, {
      poll: {
        ...current.poll,
        myVoteOptionId: optionId,
        totalVoters: current.poll.totalVoters + 1,
        options: current.poll.options.map((o) =>
          o.id === optionId ? { ...o, votesCount: o.votesCount + 1 } : o,
        ),
      },
    });
    voteNewsPoll(api, { pollId, optionId }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('vote failed:', err);
      void refreshNews();
    });
  };

  const handleTogglePin = async (newsId: number) => {
    const current = items.find((i) => i.id === newsId);
    if (!current) return;
    const willPin = !current.isPinned;
    // §pyn — проверка ПЕРВОЙ, до действия. Если лимит уже исчерпан — показываем
    // диалог сразу, без оптимистичного «закрепил → сбросил → показал ошибку».
    // Server enforce'ит как backstop, но юзер не должен видеть флэш пина.
    if (willPin && items.filter((i) => i.isPinned).length >= MAX_PINNED) {
      showErrorDialog(t('news.pin_limit_reached'));
      return;
    }
    updateItem(newsId, { isPinned: willPin });
    const action = willPin ? pinMessage : unpinMessage;

    // §pyn-1.2.54 — retry с exponential backoff для network/transient failures.
    // Логические ошибки (pin_limit_reached / already_pinned / message_not_found)
    // не retry'им — это окончательное состояние server'а.
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await action(api, newsId);
        return;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 'pin_limit_reached') {
            showErrorDialog(t('news.pin_limit_reached'));
            void refreshNews();
            return;
          }
          if (
            err.code === 'already_pinned' ||
            err.code === 'message_not_found' ||
            err.code === 'admin_only'
          ) {
            // eslint-disable-next-line no-console
            console.warn('pin toggle rejected:', err.code);
            void refreshNews();
            return;
          }
        }
        if (attempt < MAX_RETRIES - 1) {
          // eslint-disable-next-line no-console
          console.warn(`pin toggle attempt ${attempt + 1} failed, retrying:`, err);
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        // Все попытки исчерпаны — показываем toast + refresh.
        // eslint-disable-next-line no-console
        console.error('pin toggle final failure:', err);
        showErrorDialog(willPin ? t('news.pin_failed') : t('news.unpin_failed'));
        void refreshNews();
      }
    }
  };

  // Drag-to-pin: бросили карточку из ленты в правую колонку → закрепляем
  // (если ещё не закреплена). Проверка лимита 3 — внутри handleTogglePin.
  const handlePinDrop = (newsId: number) => {
    const item = items.find((i) => i.id === newsId);
    if (!item || item.isPinned) return;
    void handleTogglePin(newsId);
  };

  const handleDelete = (newsId: number) => {
    removeItem(newsId);
    softDeleteMessage(api, newsId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('delete failed:', err);
      void refreshNews();
    });
  };

  const handlePublish = async (
    text: string,
    atts: import('@/types/chat').PendingAttachment[],
    scheduledAt: Date | null,
  ) => {
    if (!text.trim() && atts.length === 0) return;

    // Ветка scheduled: server cron каждую минуту переносит pending → news.
    // Attachments в scheduled flow не поддерживаются (см. handlers-drafts.js —
    // runScheduledCron не пишет attachments); Composer disable'ит Clock когда
    // есть файлы. Защитный assert если каким-то образом сюда дошли.
    if (scheduledAt !== null) {
      if (atts.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:news] scheduled with attachments — skipping attachments');
      }
      try {
        await scheduleMessage(api, {
          kind: 'news',
          payload: { text },
          sendAt: scheduledAt,
        });
        // Свежий scheduled добавился — инвалидируем кеш, при следующем open
        // диалога юзер увидит свою запись.
        useStatsStore.getState().invalidateScheduled();
        showScheduledToast(scheduledAt);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('scheduleMessage failed:', err);
        setLoadError(
          err instanceof Error ? err.message : t('news.schedule_failed'),
        );
      }
      return;
    }

    try {
      // Server принимает attachments inline как `data:MIME;base64,…`.
      // Pendings без dataUrl (legacy mock) — пропускаем.
      const wireAttachments = atts
        .filter((a): a is import('@/types/chat').PendingAttachment & { dataUrl: string; mimeType: string; size: number } =>
          typeof a.dataUrl === 'string' && a.dataUrl.length > 0,
        )
        .map((a) => ({
          url: a.dataUrl,
          filename: a.name,
          mimeType: a.mimeType,
          size: a.size,
        }));
      const sent = await sendNews(api, { text, attachments: wireAttachments });
      const newItem: NewsItem = {
        id: sent.id,
        kind: 'news',
        senderLogin: 'me',
        senderName: currentUserName,
        senderInitials: currentUserInitials,
        senderAvatarUrl: '',
        senderPresence: 'online',
        text,
        createdAt: sent.createdAt,
        createdAtLabel: t('news.just_now'),
        isRead: true,
        isPinned: false,
        reactions: {},
        myReactions: [],
        attachments: [],
        poll: null,
        isOwn: true,
      };
      // Optimistic prepend — WS new_news всё равно затем refetch'нет и наш
      // item получит правильные timestamps / avatar поля.
      setItems([newItem, ...items]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('sendNews failed:', err);
    }
  };

  const showInitialLoading = items.length === 0 && lastFetchedAt === null && loadError === null;

  return (
    <main
      // §pyn-1.2.54 — news-pattern-bg на ROOT (вместо bg-bg-primary) →
      // pattern continuous от topbar до bottom. Pinned panel и scroll
      // inherit единый фон без визуальных швов.
      className="relative flex min-h-0 flex-1 flex-col"
      {...(canPost ? dropProps : {})}
    >
      {canPost && dragging && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-xl',
            'border-2 border-dashed border-accent-clay/60 bg-bg-primary/90 backdrop-blur-[1px]',
          )}
        >
          <Upload className="h-7 w-7 text-accent-clay" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-text-strong">
            {t('news.drop_attach')}
          </p>
        </div>
      )}
      {/* §pyn-1.2.22 — top-bar bg унифицирован с Tables/MOL/Sidebar
          (bg-bg-surface), чтобы Win min/max/close controls не сливались
          с тёмным фоном feed'а — раньше ribbon под кнопками был bg-bg-primary
          и резко отличался от соседних панелей (Sidebar/ChatList). */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_news')}
        </span>
        <div className="flex-1" />
        {canPost && (
          <>
            <TopBarButton
              label={t('news.btn_poll')}
              onClick={() => setPollDialogOpen(true)}
            />
            <TopBarButton
              label={t('news.btn_scheduled')}
              onClick={() => setScheduledDialogOpen(true)}
            />
          </>
        )}
      </div>

      <WorkspaceCard>
        {/* p-4 — единое поле 16px по периметру (как на всех листах): лента и
            закреплённые стоят ровно на этой линии. Фон-паттерн — во всю карточку. */}
        <div className="news-pattern-bg relative flex min-h-0 flex-1 overflow-hidden p-4">
        {/* ЛЕВО — лента новостей + строка ввода снизу. Внутренний flex-1 in-flow
            контейнер даёт композеру (absolute bottom-0) надёжный якорь по высоте. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          // scrollbar-gutter both-edges: 10px скролл-полоса (index.css) резервируется
          // симметрично с двух сторон → лента центрируется по той же оси, что и
          // плавающий композер (он во всю ширину без скролла) → края совпадают.
          className="absolute inset-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        >
          {/* pb-[60px] — отступ под floating composer; верх задаёт единая рамка
              16px (p-4 родителя), своего pt у ленты нет — стоит ровно на линии. */}
          <div className="mx-auto flex max-w-[720px] flex-col gap-2.5 px-6 pb-[60px]">
            {showInitialLoading && (
              <p className="py-8 text-center text-[12.5px] text-text-muted">
                {t('news.loading_feed')}
              </p>
            )}
            {loadError !== null && items.length === 0 && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] text-danger">
                {loadError}
              </div>
            )}
            {!showInitialLoading && !loadError && items.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-text-muted">
                {t('news.empty_feed')}
              </p>
            )}
            {newsGroups.map((g) => (
              // §2026-05-19 — per-group wrapper для sticky DateDivider
              // (Telegram-style swap при скролле между группами разных дней).
              // §pyn-1.2.51 — gap-2.5 ВНУТРИ группы: новости одного дня
              // больше не слипаются как один блок, между ними visible
              // промежуток 10px (same as between groups).
              <div key={`g-${g.dayKey}`} className="flex flex-col gap-2.5">
                {g.label && (
                  // Sticky date-divider у верха колонки (плавающего overlay больше нет).
                  <DateDivider label={g.label} topOffset={12} />
                )}
                {g.items.map((item) => (
                  <div key={item.id} data-news-id={item.id} className="news-row">
                    <NewsCard
                      news={item}
                      currentUserRole={currentUserRole}
                      onReact={handleReact}
                      onVote={handleVote}
                      onTogglePin={handleTogglePin}
                      onDelete={handleDelete}
                      onEdited={(id, newText) => updateItem(id, { text: newText })}
                      onMarkRead={handleNewsMarkRead}
                      pinDraggable={canPin && !item.isPinned}
                      onPinDragStart={(id) => setDraggingPinId(id)}
                      onPinDragEnd={() => {
                        setDraggingPinId(null);
                        setPinDragActive(false);
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>


        {/* §2026-05-19 — DayLabelPill убран: DateDivider теперь sticky сам. */}
        <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />

        {/* Composer «приклеен» к низу как пилюля. Двухслойный glass:
            нижний — backdrop-blur с gradient mask (плавный переход
            blur→clear вверху), верхний — pill сам. */}
        {canPost && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40">
            {/* Glass-fade с mask «50% → transparent»: blur в нижней
                половине pill'а + ниже, верхняя половина прозрачная. */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[72px] backdrop-blur-xl"
              style={{
                maskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
              }}
            />
            {/* px-2 + собственный px-4 у NewsComposer = 24px инсет, ровно как
                px-6 у ленты и закреплённых пиллов — края совпадают в линию. */}
            <div className="relative pointer-events-auto mx-auto max-w-[720px] px-2">
              {scheduledToast !== null && (
                <div
                  role="status"
                  className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-accent-clay/30 bg-accent-clay-bg/85 px-3 py-2 text-[12px] text-accent-clay"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span>{scheduledToast}</span>
                </div>
              )}
              <NewsComposer
                ref={composerRef}
                onPublish={handlePublish}
                initialText={initialDraft}
                onDraftSave={handleDraftSave}
              />
            </div>
          </div>
        )}
        </div>
        </div>
        {/* ПРАВО — ровно 3 слота фикс-размера (по 1/3 высоты). Занятый слот —
            карточка закреплённой новости (контент вписывается, лишнее обрезается);
            свободный — подсвеченный блок со значком-пином. Без скролла.
            Drag-to-pin: можно перетащить новость из ленты сюда → закрепится. */}
        <aside
          onDragOver={
            canPin
              ? (e) => {
                  if (!e.dataTransfer.types.includes('application/x-pyn-news-id')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!pinDragActive) setPinDragActive(true);
                }
              : undefined
          }
          onDragLeave={
            canPin
              ? (e) => {
                  // Не сбрасываем при переходе на внутренние элементы колонки.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setPinDragActive(false);
                }
              : undefined
          }
          onDrop={
            canPin
              ? (e) => {
                  const raw = e.dataTransfer.getData('application/x-pyn-news-id');
                  e.preventDefault();
                  setPinDragActive(false);
                  if (raw) handlePinDrop(Number(raw));
                }
              : undefined
          }
          className={cn(
            'flex min-h-0 w-[360px] shrink-0 flex-col gap-2.5 rounded-xl pl-3 transition-shadow',
            pinDragActive && 'ring-2 ring-inset ring-accent-clay/45',
          )}
        >
          {Array.from({ length: MAX_PINNED }, (_, i) => {
            const item = pinned[i];
            if (item) {
              return (
                <PinnedPill
                  key={item.id}
                  news={item}
                  currentUserRole={currentUserRole}
                  onReact={handleReact}
                  onVote={handleVote}
                  onTogglePin={handleTogglePin}
                  onDelete={handleDelete}
                  onEdited={(id, newText) => updateItem(id, { text: newText })}
                  onJumpToNews={jumpToNews}
                />
              );
            }
            // Первый свободный слот во время drag-to-pin → превью «упадёт сюда».
            const draggingNews =
              draggingPinId !== null ? items.find((n) => n.id === draggingPinId) : undefined;
            if (pinDragActive && draggingNews && i === pinned.length) {
              return <PinDropPreview key={`preview-${i}`} news={draggingNews} />;
            }
            return <EmptyPinSlot key={`empty-${i}`} />;
          })}
        </aside>
      </div>
      </WorkspaceCard>

      <NewsPollDialog
        open={pollDialogOpen}
        onOpenChange={setPollDialogOpen}
        onPublished={() => {
          // WS news_update обычно прилетает в течение секунды и refresh'нет
          // лента; на случай если broadcast потеряется — fire-and-forget refresh.
          void refreshNews();
        }}
      />
      <ScheduledListDialog
        open={scheduledDialogOpen}
        onOpenChange={setScheduledDialogOpen}
      />

      {/* §pyn-1.2.54 — Alert-dialog по центру с одной строкой + кнопкой
          «Принято». Используется для pin_limit_reached и pin/unpin failures. */}
      <RadixDialog.Root
        open={errorDialogMessage !== null}
        onOpenChange={(o) => !o && setErrorDialogMessage(null)}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay
            className={cn(
              'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            )}
          />
          <RadixDialog.Content
            className={cn(
              // §pyn-1.2.54 — width auto + max-w viewport gap: dialog растягивается
              // под одну строку текста (whitespace-nowrap). Если локаль очень
              // длинная — clamp к viewport - 48px, иначе wrap.
              'fixed left-1/2 top-1/2 z-50 w-auto max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2',
              'rounded-xl border border-border-default bg-bg-elevated px-5 py-4 shadow-2xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
              'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            )}
          >
            <RadixDialog.Title className="whitespace-nowrap text-[13.5px] font-medium text-text-strong">
              {errorDialogMessage}
            </RadixDialog.Title>
            <div className="mt-4 flex items-center justify-end">
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  autoFocus
                  className={cn(
                    'rounded-md bg-accent-clay px-3.5 py-1.5 text-[13px] font-medium text-white outline-none transition-colors',
                    'hover:bg-accent-clay-dim',
                  )}
                >
                  {t('common.acknowledge')}
                </button>
              </RadixDialog.Close>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </main>
  );
}

interface TopBarButtonProps {
  label: string;
  onClick: () => void;
}

/**
 * §v1.2.14 — Текстовая кнопка (без иконки) в шапке ленты. Внутри
 * drag-region, `no-drag-region` чтобы клик не съедался window-drag.
 * На Win глобальный `html[data-pyn-platform=win32] .drag-region
 * { padding-right: 140px }` (см. apps/desktop/src/index.css) даёт
 * место под нативные min/max/close.
 */
function TopBarButton({ label, onClick }: TopBarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'no-drag-region flex h-7 items-center rounded-md px-2.5',
        'text-[12px] font-medium text-text-secondary outline-none transition-colors',
        'hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      {label}
    </button>
  );
}
