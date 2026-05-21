import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Upload } from 'lucide-react';
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
  can,
  getNews,
  isNewsStale,
  loadDraft,
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
import { PinnedPill } from './PinnedPill';
import { ScheduledListDialog } from './ScheduledListDialog';

const NEWS_DRAFT_SCOPE = 'news';
const SCHEDULED_TOAST_MS = 4000;

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
  const { t } = useTranslation();
  // Permission: только admin/developer могут публиковать новости.
  const canPost = can(currentUserRole, 'news.post');
  const items = useNewsStore((s) => s.items);
  const lastFetchedAt = useNewsStore((s) => s.lastFetchedAt);
  const setItems = useNewsStore((s) => s.setItems);
  const updateItem = useNewsStore((s) => s.updateItem);
  const removeItem = useNewsStore((s) => s.removeItem);

  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<NewsComposerHandle>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
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

  // Initial mount: serve cached, refetch если stale. Сам `items` cached'ятся
  // через Zustand persist — при первом mount после реонстарта Pyn'a там уже
  // что-то есть (если был login раньше). lastFetchedAt не в deps useEffect'a
  // намеренно — refetch только on mount, не каждый раз когда меняется.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isNewsStale(lastFetchedAt)) {
      void refreshNews();
    }
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

  const pinned = useMemo(() => items.filter((i) => i.isPinned), [items]);

  // Группировка news-карточек по yek-дню для date-разделителей. Pinned
  // дублируются — они И сверху как pill, И в общем потоке (Telegram-style).
  // Это позволяет click'у на pinned-pill `scrollIntoView` к real-row в ленте.
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
  }, [items]);

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
    if (target <= 0) {
      scrollRestoredRef.current = true;
      lastSavedScrollRef.current = 0;
      return;
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
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  const handleTogglePin = (newsId: number) => {
    const current = items.find((i) => i.id === newsId);
    if (!current) return;
    const willPin = !current.isPinned;
    updateItem(newsId, { isPinned: willPin });
    const action = willPin ? pinMessage : unpinMessage;
    action(api, newsId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('pin toggle failed:', err);
      void refreshNews();
    });
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
      className="relative flex flex-1 flex-col bg-bg-primary"
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
      <div className="drag-region flex h-12 shrink-0 items-center justify-end gap-1.5 px-3">
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
      <div className="mx-3 h-px shrink-0 bg-border-subtle" />

      {pinned.length > 0 && (
        <div className="shrink-0">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-6 pb-2 pt-3">
            {pinned.map((item) => (
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
            ))}
          </div>
        </div>
      )}

      <div className="news-pattern-bg relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="absolute inset-0 overflow-y-auto"
        >
          {/* pb-[60px] — компактный отступ; последние новости почти впритык
              к pill'у, но не теряются под ним. */}
          <div className="mx-auto flex max-w-[720px] flex-col gap-2.5 px-6 pt-2 pb-[60px]">
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
              <div key={`g-${g.dayKey}`} className="flex flex-col">
                {g.label && <DateDivider label={g.label} />}
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
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Fade-в-фон сверху для плавного «затемнения» при scroll'е вверх. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-bg-primary to-transparent" />

        {/* §2026-05-19 — DayLabelPill убран: DateDivider теперь sticky сам. */}
        <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />

        {/* Composer «приклеен» к низу как пилюля. Двухслойный glass:
            нижний — backdrop-blur с gradient mask (плавный переход
            blur→clear вверху), верхний — pill сам. */}
        {canPost && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
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
            <div className="relative pointer-events-auto mx-auto max-w-[720px]">
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
        'text-[12.5px] font-medium text-text-secondary outline-none transition-colors',
        'hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      {label}
    </button>
  );
}
