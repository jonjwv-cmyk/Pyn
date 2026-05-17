import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger-вариант — красная primary-кнопка (для удаления и т.п.). */
  variant?: 'default' | 'danger';
  onConfirm: () => void;
}

/**
 * Универсальный confirm-модал. Используется для подтверждения действий,
 * случайное срабатывание которых может стоить пользователю усилий —
 * голосование в опросе, удаление новости и т.п.
 *
 *   ┌─ ConfirmDialog ──────────────────┐
 *   │ Заголовок                         │
 *   │ Опциональное описание...          │
 *   │                                   │
 *   │              [Нет]  [Да]          │
 *   └───────────────────────────────────┘
 *
 * Esc / клик вне card — отмена. Подтверждение вызывает onConfirm + закрывает.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Да',
  cancelLabel = 'Нет',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <Dialog.Title className="text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              {description}
            </Dialog.Description>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium outline-none transition-colors',
                variant === 'danger'
                  ? 'bg-danger text-white hover:bg-danger/85'
                  : 'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
