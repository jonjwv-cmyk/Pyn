import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import { AttachmentTile } from '@/components/ui/AttachmentTile';
import { cn } from '@/lib/cn';
import type { ChatMessageItem } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageItem;
  onReact?: (messageId: number, emoji: string) => void;
}

const REACTION_PALETTE = ['👍', '🔥', '🎉', '❤️', '👀', '🙏'];

/**
 * Один пузырь сообщения. Свои — справа с clay-tint, чужие — слева с bg-elevated.
 * Время — мелкий subtle text внизу пузыря.
 *
 * Attachments (если есть) показываются над текстом — image preview, video,
 * file chip. Расшифровка через общий `useDecryptedBlob`.
 *
 * Реакции — chip-row под текстом + hover button "+" для выбора нового emoji.
 */
export function ChatMessage({ message, onReact }: ChatMessageProps) {
  const own = message.isOwn;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const reactions = message.reactions ?? {};
  const myReactions = message.myReactions ?? [];
  const reactionEntries = Object.entries(reactions).filter(([, c]) => c > 0);
  const hasReactions = reactionEntries.length > 0;

  const handleEmojiSelect = (emoji: string) => {
    if (typeof message.numericId === 'number') {
      onReact?.(message.numericId, emoji);
    }
  };

  return (
    <div className={cn('group flex w-full', own ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex max-w-[68%] flex-col gap-1.5 rounded-2xl px-3 py-2',
          own ? 'bg-accent-clay-bg text-text-strong' : 'bg-bg-elevated text-text-primary',
        )}
      >
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5">
            {message.attachments?.map((att) => (
              <AttachmentTile key={att.id} attachment={att} />
            ))}
          </div>
        )}
        {message.text && (
          <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
            {message.text}
          </p>
        )}

        {(hasReactions || onReact) && (
          <div className="flex flex-wrap items-center gap-1">
            {reactionEntries.map(([emoji, count]) => {
              const mine = myReactions.includes(emoji);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleEmojiSelect(emoji)}
                  disabled={typeof message.numericId !== 'number'}
                  className={cn(
                    'inline-flex h-5 items-center gap-0.5 rounded-full px-1.5',
                    'text-[11px] leading-none transition-colors',
                    mine
                      ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
                      : own
                        ? 'bg-text-strong/10 text-text-strong hover:bg-text-strong/15'
                        : 'bg-bg-hover text-text-primary hover:bg-bg-pressed',
                  )}
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{count}</span>
                </button>
              );
            })}
            {onReact && typeof message.numericId === 'number' && (
              <ReactionPicker onPick={handleEmojiSelect} own={own} />
            )}
          </div>
        )}

        <span
          className={cn(
            'block text-[10px] tabular-nums',
            own ? 'text-text-strong/55' : 'text-text-muted',
          )}
        >
          {message.time}
        </span>
      </div>
    </div>
  );
}

interface ReactionPickerProps {
  onPick: (emoji: string) => void;
  own: boolean;
}

function ReactionPicker({ onPick, own }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Добавить реакцию"
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full',
            'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100',
            own
              ? 'text-text-strong/55 hover:bg-text-strong/10'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={4}
          className={cn(
            'z-50 flex gap-0.5 rounded-xl',
            'border border-border-default bg-bg-elevated px-1.5 py-1 shadow-xl',
          )}
        >
          {REACTION_PALETTE.map((emoji) => (
            <DropdownMenu.Item
              key={emoji}
              onSelect={() => onPick(emoji)}
              className={cn(
                'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md',
                'text-[15px] outline-none transition-colors',
                'data-[highlighted]:bg-bg-hover',
              )}
            >
              {emoji}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
