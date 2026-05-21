import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/cn';

// Lazy-load — picker тянет ~150KB emoji-data, не нужно при initial render.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

interface EmojiPickerButtonProps {
  /** Callback с выбранным эмодзи (готовая `string`, уже variation-selectors). */
  onPick: (emoji: string) => void;
  /** Доп. CSS для самой кнопки (например размер). */
  className?: string;
  /** Подсказка при hover'е (a11y label тоже). */
  label?: string;
}

/**
 * Кнопка-улыбка → Radix Popover с emoji picker'ом. Используется в новости/
 * чат-composer'е и в Edit/Poll диалогах.
 *
 * Picker — `emoji-picker-react`, lazy-loaded чтобы не тянуть 150KB-data в
 * initial bundle. Theme: 'dark' для совпадения с нашим темным UI.
 *
 * onPick получает уже готовый string (включая variation selectors как
 * `❤️`) — caller просто инсёртит в textarea.value.
 */
export function EmojiPickerButton({
  onPick,
  className,
  label,
}: EmojiPickerButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const resolvedLabel = label ?? t('emoji_picker.open_aria');
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={resolvedLabel}
          title={resolvedLabel}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
            'text-text-muted hover:bg-bg-hover hover:text-text-strong',
            'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
            className,
          )}
        >
          <Smile className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 rounded-xl border border-border-default bg-bg-elevated p-0 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <Suspense fallback={<PickerSkeleton />}>
            <EmojiPicker
              theme={'dark' as never}
              lazyLoadEmojis
              skinTonesDisabled
              searchPlaceholder={t('emoji_picker.search_placeholder')}
              previewConfig={{ showPreview: false }}
              width={320}
              height={400}
              onEmojiClick={(d) => {
                onPick(d.emoji);
                setOpen(false);
              }}
            />
          </Suspense>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickerSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flex h-[400px] w-[320px] items-center justify-center text-[12px] text-text-muted">
      {t('common.loading')}
    </div>
  );
}
