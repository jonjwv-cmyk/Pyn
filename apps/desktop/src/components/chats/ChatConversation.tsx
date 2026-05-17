import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import { useUsersStore } from '@/lib/stores';
import type { ChatMessageItem, ChatPartner, PendingAttachment } from '@/types/chat';
import type { PresenceState } from '@/types/presence';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';

interface ChatConversationProps {
  partner: ChatPartner | null;
  messages: ChatMessageItem[];
  onSend?: (text: string, attachments: PendingAttachment[]) => void;
  onReact?: (messageId: number, emoji: string) => void;
}

/**
 * Главная зона раздела Чаты: компактный header → лента сообщений → composer.
 * Header сам является drag-region'ом (нет отдельного пустого блока сверху).
 */
export function ChatConversation({ partner, messages, onSend, onReact }: ChatConversationProps) {
  return (
    <main className="flex flex-1 flex-col bg-bg-primary">
      {partner ? (
        <>
          <ChatHeader partner={partner} />
          <MessageList messages={messages} partnerId={partner.id} onReact={onReact} />
          <ChatComposer onSend={onSend} />
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
  // last_seen_at иногда отсутствует в `get_admin_messages` (когда LAST
  // message отправили мы — server возвращает receiver_last_seen_at="").
  // Fallback: `usersStore` (admin-only get_users) — там реальный last_seen
  // на момент префетча. Берём более свежее из двух.
  const userLastSeen = useUsersStore((s) => s.users.find((u) => u.login === partner.id)?.lastSeenAt);
  const fromStoreLabel = userLastSeen ? formatFullYek(userLastSeen) : '';
  const lastSeenLabel = partner.lastSeenAtLabel || fromStoreLabel;

  return (
    <>
      <div
        className={cn(
          'drag-region flex h-12 shrink-0 items-center gap-2.5 px-4',
        )}
      >
        <span className="relative shrink-0">
          <Avatar
            initials={partner.initials}
            size={28}
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
            {presenceText(partner.presence, lastSeenLabel)}
          </span>
        </span>
      </div>
      <div className="h-px shrink-0 bg-border-subtle" />
    </>
  );
}

function presenceText(state: PresenceState, lastSeenLabel: string): string {
  if (state === 'online') return 'в сети';
  if (state === 'away') return 'Пауза';
  // offline — server-side last_seen_at либо из admin_messages, либо из get_users.
  return lastSeenLabel ? `был в сети ${lastSeenLabel}` : 'не в сети';
}

interface MessageListProps {
  messages: ChatMessageItem[];
  /** При смене partner'а ленту прокручиваем вниз заново. */
  partnerId: string;
  onReact?: (messageId: number, emoji: string) => void;
}

function MessageList({ messages, partnerId, onReact }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setShowScrollDown(false);
    }
  }, [partnerId, messages.length]);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="absolute inset-0 flex flex-col gap-1.5 overflow-y-auto px-4 py-4"
      >
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} onReact={onReact} />
        ))}
      </div>
      {/* Fade-в-фон сверху для плавного «затемнения» при scroll'е вверх. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-bg-primary to-transparent" />
      <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-[13px] text-text-muted">Выберите чат, чтобы начать переписку</p>
    </div>
  );
}
