import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { KeyRound, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal-prompt пароля для скриптов с `requiresPassword: true`. Pyn-стиль —
 * Linear-вдохновлённый dark popover. Сервер валидирует пароль; клиент
 * никакой проверки не делает.
 */
export function SheetsPasswordPrompt({
  open,
  actionLabel,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  actionLabel: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Очищаем пароль при закрытии и автофокусируем поле при открытии.
  useEffect(() => {
    if (open) {
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const submit = (): void => {
    if (!password) return;
    onSubmit(password);
  };

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
        >
          <div className="mb-4 flex items-start gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                'border border-accent-clay/30 bg-accent-clay-bg text-accent-clay',
              )}
            >
              <KeyRound className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[14px] font-semibold text-text-strong">
                Требуется пароль
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12.5px] text-text-secondary">
                Чтобы запустить «{actionLabel}», введите пароль.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-strong"
                aria-label="Закрыть"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </div>

          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="Пароль"
            className={cn(
              'w-full rounded-md border border-border-default bg-bg-surface px-3 py-2',
              'text-[13px] text-text-strong placeholder:text-text-muted',
              'outline-none transition-colors',
              'focus:border-accent-clay/60 focus:bg-bg-deep',
            )}
            autoComplete="current-password"
          />

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'text-text-secondary outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!password}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'outline-none transition-colors',
                password
                  ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
                  : 'cursor-not-allowed bg-bg-hover text-text-muted',
              )}
            >
              Запустить
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
