import * as Dialog from '@radix-ui/react-dialog';
import { PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/**
 * Confirm-prompt для скриптов без пароля: «Запустить скрипт "X"?» + Да/Нет.
 * Pyn-стиль (как SheetsPasswordPrompt), но без поля ввода.
 */
export function SheetsConfirmPrompt({
  open,
  actionLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm',
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
          }}
        >
          <div className="mb-4 flex items-start gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                'border border-accent-clay/30 bg-accent-clay-bg text-accent-clay',
              )}
            >
              <PlayCircle className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="flex min-w-0 flex-1 items-center">
              <Dialog.Title className="text-[14px] font-semibold text-text-strong">
                {t('tables.script_confirm_title', { label: actionLabel })}
              </Dialog.Title>
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'text-text-secondary outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              {t('tables.script_confirm_no')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              autoFocus
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'outline-none transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {t('tables.script_confirm_yes')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
