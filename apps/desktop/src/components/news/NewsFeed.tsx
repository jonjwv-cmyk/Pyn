import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { api } from '@/lib/api';
import { useNewsStore } from '@/lib/stores';
import { useWsEvent } from '@/lib/ws';
import { wireToNewsItem } from '@/lib/repositories/news-repo';
import {
  addReaction,
  can,
  getNews,
  isNewsStale,
  pinMessage,
  removeReaction,
  sendNews,
  softDeleteMessage,
  unpinMessage,
  voteNewsPoll,
  type NewsItem,
  type Role,
} from '@pyn/core';
import { NewsCard } from './NewsCard';
import { NewsComposer } from './NewsComposer';
import { PinnedPill } from './PinnedPill';

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
  // Permission: только admin/developer могут публиковать новости.
  const canPost = can(currentUserRole, 'news.post');
  const items = useNewsStore((s) => s.items);
  const lastFetchedAt = useNewsStore((s) => s.lastFetchedAt);
  const setItems = useNewsStore((s) => s.setItems);
  const updateItem = useNewsStore((s) => s.updateItem);
  const removeItem = useNewsStore((s) => s.removeItem);

  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const refreshNews = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const wire = await getNews(api, { limit: 50 });
      // Сервер шлёт newest-first; UI хочет chat-style (newest внизу) — переворачиваем.
      const mapped = wire.map((w) => wireToNewsItem(w, currentUserLogin));
      mapped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setItems(mapped);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить ленту');
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
  useWsEvent('new_news', () => {
    void refreshNews();
  });
  useWsEvent('news_update', () => {
    void refreshNews();
  });

  const pinned = useMemo(() => items.filter((i) => i.isPinned), [items]);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);
  };

  useEffect(() => {
    checkScroll();
  }, [items]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

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
    _scheduledAt: Date | null,
  ) => {
    if (!text.trim() && atts.length === 0) return;
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
        createdAtLabel: 'только что',
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
    <main className="flex flex-1 flex-col bg-bg-primary">
      <div className="drag-region h-12 shrink-0" />
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
              />
            ))}
          </div>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="absolute inset-0 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-[720px] flex-col gap-2.5 px-6 pb-6 pt-2">
            {showInitialLoading && (
              <p className="py-8 text-center text-[12.5px] text-text-muted">
                Загрузка ленты…
              </p>
            )}
            {loadError !== null && items.length === 0 && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[12.5px] text-danger">
                {loadError}
              </div>
            )}
            {!showInitialLoading && !loadError && items.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-text-muted">
                Лента пуста.
              </p>
            )}
            {items.map((item) => (
              <NewsCard
                key={item.id}
                news={item}
                currentUserRole={currentUserRole}
                onReact={handleReact}
                onVote={handleVote}
                onTogglePin={handleTogglePin}
                onDelete={handleDelete}
                onEdited={(id, newText) => updateItem(id, { text: newText })}
              />
            ))}
          </div>
        </div>

        {/* Fade-в-фон сверху для плавного «затемнения» при scroll'е вверх. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-bg-primary to-transparent" />

        <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
      </div>

      {canPost && (
        <div className="shrink-0 border-t border-border-subtle">
          <div className="mx-auto max-w-[720px]">
            <NewsComposer onPublish={handlePublish} />
          </div>
        </div>
      )}
    </main>
  );
}
