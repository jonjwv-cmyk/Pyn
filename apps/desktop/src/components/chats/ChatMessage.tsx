import { Check, CheckCheck, CornerUpLeft, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AttachmentGroup } from '@/components/ui/AttachmentGroup';
import { MessageActionsPopup } from '@/components/ui/MessageActionsPopup';
import { cn } from '@/lib/cn';
import type { ChatMessageItem } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageItem;
  onReact?: (messageId: number, emoji: string) => void;
  /** Если задан — popup показывает кнопку «Ответить»; caller подымает state в композер. */
  onReply?: (message: ChatMessageItem) => void;
}

/**
 * Один пузырь сообщения. Telegram-style:
 *   • Bubble fit-content по ширине (max-w-68% как safety-cap).
 *   • Время + checkmarks плавают справа в последней строке текста (float).
 *     Если последняя строка длинная и не помещает их — `pad`-spacer в конце
 *     текста переносит footer на новую строку.
 *   • Plus-кнопка реакций — СНАРУЖИ bubble (рядом, hover-only). Это
 *     убирает «раздутость» bubble под пустой реакционный chip.
 *   • Reply preview и attachment'ы — внутри bubble, над текстом.
 */
export function ChatMessage({ message, onReact, onReply }: ChatMessageProps) {
  const { t } = useTranslation();
  const own = message.isOwn;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  const reactions = message.reactions ?? {};
  const myReactions = message.myReactions ?? [];
  const reactionEntries = Object.entries(reactions).filter(([, c]) => c > 0);
  const hasReactions = reactionEntries.length > 0;
  const canAct = typeof message.numericId === 'number';

  const handleEmojiSelect = (emoji: string) => {
    if (typeof message.numericId === 'number') {
      onReact?.(message.numericId, emoji);
    }
  };

  const handleCopy = (): void => {
    if (!message.text) return;
    void navigator.clipboard.writeText(message.text).catch(() => {
      /* clipboard reject — silent; popup всё равно покажет «Скопировано» */
    });
  };

  const handleReply = (): void => {
    if (onReply) onReply(message);
  };

  const plusButton =
    onReact && canAct ? (
      <MessageActionsPopup
        onReact={handleEmojiSelect}
        onReply={onReply ? handleReply : undefined}
        onCopy={message.text ? handleCopy : undefined}
        myReactions={myReactions}
        side="top"
        align={own ? 'end' : 'start'}
      >
        <button
          type="button"
          aria-label={t('chat_message.reactions_aria')}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            'border border-border-subtle bg-bg-elevated text-text-muted shadow-sm',
            'opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100',
            'hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
        </button>
      </MessageActionsPopup>
    ) : null;

  return (
    <div
      className={cn(
        'group flex w-full items-end gap-1.5',
        own ? 'justify-end' : 'justify-start',
      )}
    >
      {own && plusButton}
      <div
        className={cn(
          // `inline-flex` + `w-fit` + `max-w-[360px]` — Telegram bubble:
          // shrink-wrap под самый широкий child (media или text-line) с
          // жёстким cap. Это убирает «пустоту справа от video» когда text
          // короткий, и тянет текст к фактической ширине media. flex-col
          // только меняет axis при stacking'е inside.
          'relative flex min-w-0 w-fit flex-col gap-1.5 rounded-2xl px-3 py-1.5',
          'max-w-[360px]',
          own ? 'bg-accent-clay-bg text-text-strong' : 'bg-bg-elevated text-text-primary',
        )}
      >
        {message.replyPreview && (
          <ReplyQuote
            senderName={message.replyPreview.senderName}
            text={message.replyPreview.text}
            ownBubble={own}
          />
        )}
        {/*
          §2026-05-19 — Layout footer'a (время + checkmark), 1:1 Telegram:
            • Только media (без текста) → overlay-pill в правом-нижнем
              углу attachment'а (с тёмной полупрозрачной подложкой).
            • Media + text → дата inline в конце text-блока. На media
              ничего не накладываем (текст и так "подписывает" media).
            • Только text → дата inline в конце текста.
          Так дата никогда не закрывает контент: либо она НА media (когда
          текста нет), либо после текста (когда media с подписью).
        */}
        {hasAttachments && message.attachments && (
          <div className="relative">
            <AttachmentGroup attachments={message.attachments} context="chat" />
            {!message.text && (
              <MetaFooter
                own={own}
                time={message.time}
                isRead={message.isRead === true}
                pending={!canAct}
                variant="overlay"
              />
            )}
          </div>
        )}

        {message.text && (
          <p
            className={cn(
              'min-w-0 whitespace-pre-wrap break-words text-[13px] leading-snug',
              '[overflow-wrap:anywhere]',
            )}
          >
            {message.text}
            <MetaFooter
              own={own}
              time={message.time}
              isRead={message.isRead === true}
              pending={!canAct}
              variant="inline"
            />
          </p>
        )}

        {hasReactions && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
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
          </div>
        )}
      </div>
      {!own && plusButton}
    </div>
  );
}

interface ReplyQuoteProps {
  senderName: string;
  text: string;
  ownBubble: boolean;
}

function ReplyQuote({ senderName, text, ownBubble }: ReplyQuoteProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex max-w-full items-start gap-2 rounded-md border-l-2 border-accent-clay px-2 py-1',
        ownBubble ? 'bg-text-strong/5' : 'bg-bg-primary/40',
      )}
    >
      <CornerUpLeft
        className="mt-0.5 h-3 w-3 shrink-0 text-accent-clay"
        strokeWidth={2}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[11px] font-medium text-accent-clay">
          {senderName || t('chat_message.sender_fallback')}
        </span>
        <span className="line-clamp-1 text-[11.5px] text-text-secondary">
          {text || t('chat_message.attachment_quote')}
        </span>
      </span>
    </div>
  );
}

interface MetaFooterProps {
  own: boolean;
  time: string;
  isRead: boolean;
  pending: boolean;
  /**
   * `inline` — внутри `<p>`, плавает в right end последней строки text-bubble.
   * `overlay` — absolute поверх media (правый нижний угол) с тёмной подложкой.
   */
  variant: 'inline' | 'overlay';
}

/**
 * Время + read-checkmark в нижнем правом углу bubble. Telegram-style:
 *   • Inline: float right, vertical-align baseline с текстом. Если строка
 *     длинная — footer переезжает вниз благодаря ` `-spacer перед ним.
 *   • Overlay: тёмная pill поверх media в правом нижнем углу.
 */
function MetaFooter({ own, time, isRead, pending, variant }: MetaFooterProps) {
  if (variant === 'overlay') {
    return (
      <span
        className={cn(
          'pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1',
          'rounded-full bg-bg-deep/65 px-1.5 py-0.5 text-[10px] tabular-nums text-white',
          'backdrop-blur-[2px]',
        )}
      >
        <span>{time}</span>
        {own && <ReadReceipt isRead={isRead} pending={pending} tinted />}
      </span>
    );
  }
  // Inline-flow: время + ✓ идут сразу за last char текста, без float-right.
  // Bubble shrink'ается естественно по содержимому, без правой «пустоты».
  return (
    <>
      <span aria-hidden>{'  '}</span>
      <span
        className={cn(
          'float-right ml-2 inline-flex translate-y-[3px] items-center gap-1 text-[10px] tabular-nums',
          own ? 'text-text-strong/55' : 'text-text-muted',
        )}
      >
        <span>{time}</span>
        {own && <ReadReceipt isRead={isRead} pending={pending} />}
      </span>
    </>
  );
}

interface ReadReceiptProps {
  isRead: boolean;
  pending: boolean;
  /** `true` для overlay-варианта поверх media — белая галочка вместо tint'a. */
  tinted?: boolean;
}

function ReadReceipt({ isRead, pending, tinted }: ReadReceiptProps) {
  const { t } = useTranslation();
  if (pending) {
    return (
      <Check
        className={cn(
          'h-3 w-3 shrink-0 animate-pulse opacity-60',
          tinted && 'text-white',
        )}
        strokeWidth={2.25}
        aria-label={t('chat_message.sending_aria')}
      />
    );
  }
  if (isRead) {
    return (
      <CheckCheck
        className={cn(
          'h-3 w-3 shrink-0',
          tinted ? 'text-presence-online' : 'text-presence-online',
        )}
        strokeWidth={2.25}
        aria-label={t('chat_message.read_aria')}
      />
    );
  }
  return (
    <Check
      className={cn('h-3 w-3 shrink-0', tinted && 'text-white')}
      strokeWidth={2.25}
      aria-label={t('chat_message.sent_aria')}
    />
  );
}
