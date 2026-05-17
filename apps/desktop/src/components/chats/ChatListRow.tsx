import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import type { ChatPartner } from '@/types/chat';

interface ChatListRowProps {
  partner: ChatPartner;
  active: boolean;
  onClick: () => void;
}

/**
 * Одна строка списка чатов: аватар (всегда с presence-точкой) + имя + последнее
 * сообщение + время + (опц.) счётчик непрочитанных. Active state — клай-tint.
 *
 * Layout:
 *   [Avatar 32 + dot]  Имя ............... 12:34
 *                      Превью сообщения      [3]
 */
export function ChatListRow({ partner, active, onClick }: ChatListRowProps) {
  const unread = partner.unreadCount ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5',
        'text-left transition-colors',
        active
          ? 'bg-bg-selected text-text-strong'
          : 'text-text-primary hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          initials={partner.initials}
          size={32}
          avatarUrl={partner.avatarUrl}
          avatarBlobKey={partner.avatarBlobKey}
          avatarBlobNonce={partner.avatarBlobNonce}
        />
        <PresenceDot
          state={partner.presence}
          size={10}
          ringClass="ring-bg-surface"
          className="absolute -bottom-0.5 -right-0.5"
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium tracking-[-0.005em]">
            {partner.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-muted">
            {partner.lastMessageTime}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate text-[12px] text-text-muted">
            {partner.lastMessage}
          </span>
          {unread > 0 && (
            <span
              className={cn(
                'ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-pill',
                'bg-accent-clay px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white',
              )}
            >
              {unread > 999 ? '999+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
