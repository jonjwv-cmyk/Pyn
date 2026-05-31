import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { DateDivider } from '@/components/ui/DateDivider';
import { DayLabelPill } from '@/components/ui/DayLabelPill';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayDividerLabel, yekDayKeyFor } from '@/lib/format-time';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { useFileDrop } from '@/lib/use-file-drop';
import { useScrollDayPill } from '@/lib/use-scroll-day-pill';
import { usePresenceStore, useUiStateStore } from '@/lib/stores';
import { loadDraft, saveDraft } from '@pyn/core';
import type { ChatMessageItem, ChatPartner, PendingAttachment } from '@/types/chat';
import type { PresenceState } from '@/types/presence';
import { ChatMessage } from './ChatMessage';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';

interface ChatConversationProps {
  partner: ChatPartner | null;
  messages: ChatMessageItem[];
  onSend?: (
    text: string,
    attachments: PendingAttachment[],
    replyToId?: number,
  ) => void;
  onReact?: (messageId: number, emoji: string) => void;
  /** §pyn-1.2.37 — callback от intersection-observer: peer-message в viewport. */
  onMarkRead?: (messageId: number) => void;
}

/**
 * Главная зона раздела Чаты: компактный header → лента сообщений → composer.
 * Header сам является drag-region'ом (нет отдельного пустого блока сверху).
 *
 * Drafts: per-peer scope `chat:<peerLogin>`. Загружаем при смене partner.id,
 * передаём в ChatComposer как initialText. `key={partner.id}` форсит remount
 * Composer'а — иначе текст из предыдущего чата не сбросится при переключении.
 */
export function ChatConversation({ partner, messages, onSend, onReact, onMarkRead }: ChatConversationProps) {
  const [initialDraft, setInitialDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessageItem | null>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const { dragging, dropProps } = useFileDrop((files) => {
    composerRef.current?.addFiles(files);
  });

  // Reply сбрасываем при смене peer'а — диалог другой, контекст не переносится.
  useEffect(() => {
    setReplyTo(null);
  }, [partner?.id]);

  const handleSendWithReply = (
    text: string,
    attachments: PendingAttachment[],
  ): void => {
    const replyId =
      replyTo && typeof replyTo.numericId === 'number' ? replyTo.numericId : undefined;
    onSend?.(text, attachments, replyId);
    setReplyTo(null);
  };

  useEffect(() => {
    if (!partner) {
      setInitialDraft('');
      return;
    }
    let cancelled = false;
    // Сбрасываем перед load'ом, иначе на flash старый draft мог бы попасть в
    // Composer для следующего peer'а (между unmount old / mount new).
    setInitialDraft('');
    loadDraft(api, `chat:${partner.id}`)
      .then((d) => {
        if (!cancelled && d.text) setInitialDraft(d.text);
      })
      .catch(() => {
        /* tihо: пустой draft = OK */
      });
    return () => {
      cancelled = true;
    };
  }, [partner?.id]);

  const peerId = partner?.id;
  const handleDraftSave = useCallback(
    (text: string) => {
      if (!peerId) return;
      saveDraft(api, { scope: `chat:${peerId}`, text }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[pyn:chat] save_draft failed:', err);
      });
    },
    [peerId],
  );

  return (
    // chat-pattern-bg на родительской карточке (App.tsx) — раскинут на весь
    // чат-таб (список + переписка как одно окно). main прозрачный; сообщения
    // «приземляются» поверх того же фона, без визуального flicker'a.
    <main
      className="relative flex flex-1 flex-col"
      {...(partner ? dropProps : {})}
    >
      {partner && dragging && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-xl',
            'border-2 border-dashed border-accent-clay/60 bg-bg-primary/90 backdrop-blur-[1px]',
          )}
        >
          <Upload className="h-7 w-7 text-accent-clay" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-text-strong">
            <DropAttachLabel />
          </p>
        </div>
      )}
      {partner ? (
        <>
          <ChatHeader partner={partner} />
          {/* §design — список + переписка в ОДНОЙ карточке (WorkspaceCard +
              общий chat-pattern-bg в App.tsx). Здесь прозрачный контент:
              header выше + лента/композер поверх общего фона. */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <MessageList
              messages={messages}
              partnerId={partner.id}
              onReact={onReact}
              onReply={setReplyTo}
              onMarkRead={onMarkRead}
            />
            <ChatComposer
              ref={composerRef}
              key={partner.id}
              onSend={handleSendWithReply}
              initialText={initialDraft}
              onDraftSave={handleDraftSave}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </div>
        </>
      ) : (
        <>
          {/* §design — пустое состояние: h-9 прозрачная шапка + прозрачная зона
              с подсказкой по центру (фон — общий chat-pattern-bg карточки). */}
          <div className="drag-region h-9 shrink-0" />
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <EmptyState />
          </div>
        </>
      )}
    </main>
  );
}

interface ChatHeaderProps {
  partner: ChatPartner;
}

/**
 * Компактный заголовок диалога: drag-region + avatar (с presence-dot) + имя +
 * статус. §design — h-9 прозрачная шапка на подложке (bg-deep), над
 * WorkspaceCard'ом. Раньше была h-12 solid bg-surface + h-px divider.
 */
function ChatHeader({ partner }: ChatHeaderProps) {
  const { t } = useTranslation();
  // §pyn-1.2.39 — presence + lastSeenAt из глобального usePresenceStore.
  // Store заполняется из get_admin_messages / get_users / get_news_readers
  // (bulk setMany) и обновляется WS push presence_change (setOne).
  // Selector выбирает строго одну запись по login → только этот header
  // re-render'ится при изменении presence этого peer'а.
  const presenceInfo = usePresenceStore((s) => s.byLogin[partner.id]);
  const presence = presenceInfo?.status ?? 'offline';
  const lastSeenLabel = useFormatYek(presenceInfo?.lastSeenAt);

  return (
    <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
      <span className="relative shrink-0">
        <Avatar
          initials={partner.initials}
          size={28}
          login={partner.id}
          avatarUrl={partner.avatarUrl}
          avatarBlobKey={partner.avatarBlobKey}
          avatarBlobNonce={partner.avatarBlobNonce}
        />
        <PresenceDot
          state={presence}
          size={9}
          ringClass="ring-bg-primary"
          className="absolute -bottom-0.5 -right-0.5"
        />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {partner.name}
        </span>
        <span className="truncate text-[11px] text-text-muted">
          {presenceText(presence, lastSeenLabel, t)}
        </span>
      </span>
    </div>
  );
}

function presenceText(
  state: PresenceState,
  lastSeenLabel: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (state === 'online') return t('chat_conversation.presence_online');
  if (state === 'away') return t('chat_conversation.presence_paused');
  return lastSeenLabel
    ? t('chat_conversation.presence_offline_with_label', { label: lastSeenLabel })
    : t('chat_conversation.presence_offline');
}

function DropAttachLabel(): JSX.Element {
  const { t } = useTranslation();
  return <>{t('chat_conversation.drop_attach')}</>;
}

interface MessageListProps {
  messages: ChatMessageItem[];
  /** При смене partner'а ленту прокручиваем вниз заново. */
  partnerId: string;
  onReact?: (messageId: number, emoji: string) => void;
  onReply?: (message: ChatMessageItem) => void;
  onMarkRead?: (messageId: number) => void;
}

function MessageList({ messages, partnerId, onReact, onReply, onMarkRead }: MessageListProps) {
  const { i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const dayPill = useScrollDayPill(scrollRef);
  // Persist scroll-position per peer — при reopen Pyn'a возвращаемся ровно
  // туда же в конкретном чате. §pyn-1.2.54: pattern скопирован с NewsFeed —
  // saved = АБСОЛЮТНЫЙ scrollTop. ResizeObserver в restore-эффекте re-applies
  // target при image/video lazy-load (CLS protection 3s после mount).
  //
  // ВАЖНО: selector только для ТЕКУЩЕГО peer'a, не весь object. Иначе
  // любое сохранение другого peer'a re-trigger'ит наш эффект.
  const persistedScrollForPeer = useUiStateStore(
    (s) => s.chatScrollTopByPeer[partnerId] ?? 0,
  );
  const setChatScrollTop = useUiStateStore((s) => s.setChatScrollTop);
  const [uiHydrated, setUiHydrated] = useState(() => useUiStateStore.persist.hasHydrated());
  const scrollRestoredForPeerRef = useRef<string | null>(null);
  // Throttle scroll save: persist через safeStorage IPC = round-trip каждый
  // pixel — спам. Сохраняем после паузы в скролле 250ms.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScrollRef = useRef<number>(-1);
  const prevMessagesLengthRef = useRef(0);

  useEffect(() => {
    if (uiHydrated) return;
    const unsub = useUiStateStore.persist.onFinishHydration(() => setUiHydrated(true));
    return unsub;
  }, [uiHydrated]);

  // Cleanup save-timer при unmount/peer change.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // При смене peer'a — reset restored-флаг и prev-length чтобы новый peer
  // прошёл через restore-effect свежо.
  useEffect(() => {
    scrollRestoredForPeerRef.current = null;
    prevMessagesLengthRef.current = 0;
    lastSavedScrollRef.current = -1;
  }, [partnerId]);

  // Группируем сообщения по yek-дню. Между разными днями вставляется
  // `DateDivider`. Group by dayKey (uniq integer per Yek calendar day).
  // §pyn-1.2.25 — `i18n.language` в deps: при смене языка labels пере-формируются.
  // Раньше работало «случайно» — re-mount при смене peer'а пересчитывал useMemo.
  const groups = useMemo(() => {
    const out: { dayKey: number; label: string; items: ChatMessageItem[] }[] = [];
    for (const m of messages) {
      const dayKey = yekDayKeyFor(m.createdAt);
      if (dayKey === null) {
        // Без timestamp'a — кладём в текущий group или создаём "Без даты"
        const last = out[out.length - 1];
        if (last) last.items.push(m);
        else out.push({ dayKey: 0, label: '', items: [m] });
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.dayKey === dayKey) {
        last.items.push(m);
      } else {
        out.push({
          dayKey,
          label: formatDayDividerLabel(m.createdAt),
          items: [m],
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, i18n.language]);

  // §pyn-1.2.54 — Scroll-restore: news pattern + useLayoutEffect.
  // ResizeObserver re-apply при image/video lazy-load (3s lock или до первого
  // user-action) — как в news. Per-peer ref (разные чаты restore'ятся
  // независимо). Fresh chat (saved<=0) → scroll to bottom (Telegram-style).
  //
  // useLayoutEffect (вместо useEffect как в news) — нужен для inter-chat
  // switch (A→B→A). В news partnerId-эквивалента нет, useEffect ok; в chat
  // partnerId меняется → re-render с messages чата B → если scroll set'ить
  // AFTER paint (useEffect), first frame B показывает scrollTop чата A
  // (clamp к top после смены контента) → видимый flicker «top→target».
  // useLayoutEffect set'ит scrollTop SYNC между DOM commit и paint → first
  // frame B уже на правильной позиции. Section-switch (display:none↔flex)
  // partnerId не меняет → effect не fires → DOM scroll сохраняется браузером.
  useLayoutEffect(() => {
    if (scrollRestoredForPeerRef.current === partnerId) return;
    if (!uiHydrated) return;
    if (messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = persistedScrollForPeer;

    if (target <= 0) {
      // Fresh chat — scroll to bottom + ResizeObserver re-apply при image-load
      // (CLS protection 3s или до первого user-action).
      el.scrollTop = el.scrollHeight;
      lastSavedScrollRef.current = el.scrollTop;
      const observer = new ResizeObserver(() => {
        if (scrollRestoredForPeerRef.current === partnerId) return;
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
      });
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
      const stableTimer = setTimeout(() => {
        scrollRestoredForPeerRef.current = partnerId;
        prevMessagesLengthRef.current = messages.length;
        observer.disconnect();
      }, 3000);
      const onUserAction = (): void => {
        scrollRestoredForPeerRef.current = partnerId;
        prevMessagesLengthRef.current = messages.length;
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
    }

    // Saved > 0 — exact restore + ResizeObserver re-apply (news pattern 1:1).
    el.scrollTop = target;
    setShowScrollDown(false);

    const reapply = (): void => {
      if (scrollRestoredForPeerRef.current === partnerId) return;
      const node = scrollRef.current;
      if (!node) return;
      if (Math.abs(node.scrollTop - target) > 2) node.scrollTop = target;
    };
    const observer = new ResizeObserver(reapply);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    const stableTimer = setTimeout(() => {
      scrollRestoredForPeerRef.current = partnerId;
      lastSavedScrollRef.current = el.scrollTop;
      prevMessagesLengthRef.current = messages.length;
      observer.disconnect();
    }, 3000);

    const onUserAction = (): void => {
      scrollRestoredForPeerRef.current = partnerId;
      lastSavedScrollRef.current = el.scrollTop;
      prevMessagesLengthRef.current = messages.length;
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
  }, [partnerId, uiHydrated, messages.length === 0]);

  // EFFECT 2: При новом сообщении (messages.length вырос) — если юзер у
  // самого низа, догнать. Не дёргает restore-логику.
  useEffect(() => {
    if (scrollRestoredForPeerRef.current !== partnerId) return;
    const prev = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (messages.length <= prev) return; // не выросло (или удаление)
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 100) {
      el.scrollTop = el.scrollHeight;
      setShowScrollDown(false);
    }
  }, [messages.length, partnerId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);
    dayPill.onScroll();
    // §pyn-1.2.54 — saved = АБСОЛЮТНЫЙ scrollTop (как в NewsFeed pattern).
    // ResizeObserver в restore-эффекте re-applies target при image-load.
    if (!uiHydrated || scrollRestoredForPeerRef.current !== partnerId) return;
    const current = el.scrollTop;
    if (Math.abs(current - lastSavedScrollRef.current) < 8) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedScrollRef.current = current;
      setChatScrollTop(partnerId, current);
    }, 250);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    // chat-pattern-bg на родительской карточке — здесь прозрачная scroll-зона.
    // pb-[80px] — компактный отступ под композер; последние bubbles мягко
    // уходят под glass-fade, не остаются висеть в пустоте.
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        // §pyn-1.2.54 — pb-[60px] matches NewsFeed.
        className="absolute inset-0 flex flex-col items-center gap-1.5 overflow-y-auto px-4 pt-4 pb-[60px]"
      >
        {groups.map((g) => (
          // §2026-05-19 — per-group wrapper для sticky DateDivider.
          // Sticky scope = эта группа: divider прилипает к верху пока
          // его группа в viewport, при подходе следующей группы её
          // divider "встаёт сверху", а текущий уезжает с группой вниз.
          // Telegram-style smooth swap (видео-референс юзера).
          // Отступы per-message (firstInGroup), не gap: подряд от одного
          // отправителя жмутся, смена отправителя даёт больший зазор (Telegram).
          <div key={g.dayKey} className="flex w-full max-w-[600px] flex-col">
            {g.label && <DateDivider label={g.label} />}
            {g.items.map((m, i) => {
              const prev = i > 0 ? g.items[i - 1] : null;
              const firstInGroup = !prev || prev.isOwn !== m.isOwn;
              return (
                <ChatMessage
                  key={m.id}
                  message={m}
                  firstInGroup={firstInGroup}
                  onReact={onReact}
                  onReply={onReply}
                  onMarkRead={onMarkRead}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* §2026-05-19 — DayLabelPill убран: `DateDivider` теперь sticky
          (CSS position: sticky), сам прилипает к верху при скролле и
          выталкивается следующим divider'ом. Дубликат floating-pill'a
          больше не нужен. */}
      <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="rounded-full bg-bg-elevated/60 px-4 py-1.5 text-[13px] text-text-secondary backdrop-blur-[2px]">
        {t('chat_conversation.empty_pick_chat')}
      </p>
    </div>
  );
}
