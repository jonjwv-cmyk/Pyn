import { useCallback, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, Copy, CornerUpLeft } from 'lucide-react';
import { ALLOWED_REACTIONS } from '@pyn/core';
import { cn } from '@/lib/cn';

interface MessageActionsPopupProps {
  children: React.ReactNode;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  /**
   * Если задан — popup при клике на "Копировать" САМ вызовет этот callback
   * (текст уже в clipboard'е), затем подсветит "Скопировано" внутри popup'а
   * и через 1.5с закроет popover. Callback должен делать `navigator.clipboard.writeText`.
   */
  onCopy?: () => void;
  myReactions?: string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

const COPIED_DURATION_MS = 1800;

/**
 * Универсальный popup actions: реакции + Reply + Copy. Telegram-style:
 *   • Компактный — высота 32px на emoji-row, кнопки actions узкие.
 *   • Любое действие закрывает popup. Click на «Копировать» сначала
 *     меняет содержимое popup'а на "Скопировано" (с галочкой) и через
 *     1.5с закрывает.
 *   • Управляемый — родитель не контролирует open state; все взаимодействия
 *     инкапсулированы.
 *
 * Чтобы `Popover.Close asChild`-обёртка корректно проксировала onClick на
 * наши button-row'ы, мы НЕ используем `Popover.Close` напрямую (он требует
 * forwardRef-children, что усложняет API). Вместо этого — controlled open
 * state и явный `setOpen(false)` после каждого действия.
 */
export function MessageActionsPopup({
  children,
  onReact,
  onReply,
  onCopy,
  myReactions = [],
  side = 'top',
  align = 'end',
}: MessageActionsPopupProps) {
  const [open, setOpen] = useState(false);
  const [copiedShown, setCopiedShown] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // Закрытие сбрасывает «Скопировано» — следующий open запустит чистый popup.
  useEffect(() => {
    if (!open && copiedShown) {
      // Маленькая задержка чтобы fade-out animation popover'a успел отыграть.
      const t = setTimeout(() => setCopiedShown(false), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, copiedShown]);

  const handleReact = useCallback(
    (emoji: string) => {
      onReact(emoji);
      setOpen(false);
    },
    [onReact],
  );

  const handleReply = useCallback(() => {
    if (!onReply) return;
    onReply();
    setOpen(false);
  }, [onReply]);

  const handleCopy = useCallback(() => {
    if (!onCopy) return;
    onCopy();
    setCopiedShown(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      setOpen(false);
      copiedTimerRef.current = null;
    }, COPIED_DURATION_MS);
  }, [onCopy]);

  const hasActions = Boolean(onReply || onCopy);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex flex-col rounded-xl border border-border-default bg-bg-elevated p-1 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {copiedShown ? (
            <div
              role="status"
              className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-text-strong"
            >
              <Check
                className="h-3.5 w-3.5 shrink-0 text-presence-online"
                strokeWidth={2.5}
              />
              <span>Скопировано</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-0.5">
                {ALLOWED_REACTIONS.map((emoji) => {
                  const mine = myReactions.includes(emoji);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleReact(emoji)}
                      aria-label={`Реакция ${emoji}`}
                      className={cn(
                        'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md outline-none transition-colors',
                        'text-[15px] leading-none',
                        mine ? 'bg-accent-clay-bg' : 'hover:bg-bg-hover',
                      )}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>

              {hasActions && (
                <>
                  <div className="my-1 h-px shrink-0 bg-border-subtle" />
                  <div className="flex flex-col">
                    {onReply && (
                      <ActionRow icon={CornerUpLeft} label="Ответить" onSelect={handleReply} />
                    )}
                    {onCopy && (
                      <ActionRow icon={Copy} label="Копировать" onSelect={handleCopy} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface ActionRowProps {
  icon: typeof Copy;
  label: string;
  onSelect: () => void;
}

function ActionRow({ icon: Icon, label, onSelect }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 outline-none transition-colors',
        'text-[12.5px] text-text-primary hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="flex-1 truncate text-left">{label}</span>
    </button>
  );
}
