import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { DateDivider } from '@/components/ui/DateDivider';
import { DayLabelPill } from '@/components/ui/DayLabelPill';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayDividerLabel, formatFullYek, yekDayKeyFor } from '@/lib/format-time';
import { useFileDrop } from '@/lib/use-file-drop';
import { useScrollDayPill } from '@/lib/use-scroll-day-pill';
import { useUiStateStore, useUsersStore } from '@/lib/stores';
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
}

/**
 * Главная зона раздела Чаты: компактный header → лента сообщений → composer.
 * Header сам является drag-region'ом (нет отдельного пустого блока сверху).
 *
 * Drafts: per-peer scope `chat:<peerLogin>`. Загружаем при смене partner.id,
 * передаём в ChatComposer как initialText. `key={partner.id}` форсит remount
 * Composer'а — иначе текст из предыдущего чата не сбросится при переключении.
 */
export function ChatConversation({ partner, messages, onSend, onReact }: ChatConversationProps) {
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
    // chat-pattern-bg раскинут на всю main-зону независимо от того, выбран
    // чат или нет. При выборе чата сообщения «приземляются» поверх того же
    // фона, без визуального flicker'a. Header переопределяет фон solid'ом.
    <main
      className="relative flex flex-1 flex-col chat-pattern-bg"
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
          {/* relative wrapper для absolute-композера: messages list внутри
              + composer как floating overlay снизу с backdrop-blur. */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <MessageList
              messages={messages}
              partnerId={partner.id}
              onReact={onReact}
              onReply={setReplyTo}
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
          <div className="drag-region h-11 shrink-0" />
          <EmptyState />
        </>
      )}
    </main>
  );
}

interface ChatHeaderProps {
  partner: ChatPartner;
}

/**
 * Компактный заголовок: drag-region + avatar (с presence-dot) + имя + статус.
 * Высота 48dp (h-12). Линия-разделитель — отдельный div h-px после strip'a
 * (а не border-b внутри h-12 box), чтобы её Y совпадал с inset-divider'ом
 * ChatList и NewsFeed. Унифицированная «линия заголовка» на y=48–49.
 */
function ChatHeader({ partner }: ChatHeaderProps) {
  const { t } = useTranslation();
  // last_seen_at иногда отсутствует в `get_admin_messages` (когда LAST
  // message отправили мы — server возвращает receiver_last_seen_at="").
  // Fallback: `usersStore` (admin-only get_users) — там реальный last_seen
  // на момент префетча. Берём более свежее из двух.
  const userLastSeen = useUsersStore((s) => s.users.find((u) => u.login === partner.id)?.lastSeenAt);
  const fromStoreLabel = userLastSeen ? formatFullYek(userLastSeen) : '';
  const lastSeenLabel = partner.lastSeenAtLabel || fromStoreLabel;

  return (
    <>
      {/* Header — solid bg, перекрывает chat-pattern-bg main'а; иначе узор
          просвечивал бы под аватаркой и именем контакта. */}
      <div
        className={cn(
          'drag-region flex h-12 shrink-0 items-center gap-2.5 bg-bg-primary px-4',
        )}
      >
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
            state={partner.presence}
            size={9}
            ringClass="ring-bg-primary"
            className="absolute -bottom-0.5 -right-0.5"
          />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-semibold tracking-[-0.005em] text-text-strong">
            {partner.name}
          </span>
          <span className="truncate text-[11px] text-text-muted">
            {presenceText(partner.presence, lastSeenLabel, t)}
          </span>
        </span>
      </div>
      <div className="h-px shrink-0 bg-border-subtle" />
    </>
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
}

function MessageList({ messages, partnerId, onReact, onReply }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const dayPill = useScrollDayPill(scrollRef);
  // Persist scroll-position per peer — при reopen Pyn'a возвращаемся ровно
  // туда же в конкретном чате. Persist через safeStorage IPC async —
  // ждём `hasHydrated` прежде чем что-то восстанавливать.
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
  }, [messages]);

  // EFFECT 1: Restore scroll один раз для нового peer'a — когда (1) UI
  // hydrated, (2) есть messages для рендера. Не triggers повторно при
  // scroll'е юзера (persistedScrollForPeer обновится через handleScroll,
  // но guard refs блокирует повторный restore).
  useEffect(() => {
    if (!uiHydrated) return;
    if (scrollRestoredForPeerRef.current === partnerId) return;
    if (messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const saved = persistedScrollForPeer;
    // rAF — bubbles должны отрисоваться, scrollHeight стабильный.
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      if (saved > 0) {
        node.scrollTop = saved;
      } else {
        node.scrollTop = node.scrollHeight;
      }
      lastSavedScrollRef.current = node.scrollTop;
      scrollRestoredForPeerRef.current = partnerId;
      prevMessagesLengthRef.current = messages.length;
      setShowScrollDown(false);
    });
    // persistedScrollForPeer НЕ в deps — мы используем его как initial value,
    // дальнейшие изменения от собственного save игнорируем (иначе loop).
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
    // Throttled save — пишем persist через 250ms после паузы в скролле, и
    // только если значение реально изменилось (избегаем спама IPC writes).
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
    // chat-pattern-bg уже на main'е — здесь просто прозрачная scroll-зона.
    // pb-[80px] — компактный отступ под композер; последние bubbles мягко
    // уходят под glass-fade, не остаются висеть в пустоте.
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 flex flex-col gap-1.5 overflow-y-auto px-4 pt-4 pb-[72px]"
      >
        {groups.map((g) => (
          // §2026-05-19 — per-group wrapper для sticky DateDivider.
          // Sticky scope = эта группа: divider прилипает к верху пока
          // его группа в viewport, при подходе следующей группы её
          // divider "встаёт сверху", а текущий уезжает с группой вниз.
          // Telegram-style smooth swap (видео-референс юзера).
          <div key={g.dayKey} className="flex flex-col gap-1.5">
            {g.label && <DateDivider label={g.label} />}
            {g.items.map((m) => (
              <ChatMessage key={m.id} message={m} onReact={onReact} onReply={onReply} />
            ))}
          </div>
        ))}
      </div>
      {/* Fade-в-фон сверху для плавного «затемнения» при scroll'е вверх. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-bg-primary to-transparent" />
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
