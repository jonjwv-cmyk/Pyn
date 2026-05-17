import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clock, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { isOlderThanHours } from '@/lib/format-time';
import { editMessage } from '@pyn/core';

interface NewsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newsId: number;
  initialText: string;
  /** ISO/server timestamp создания записи — для проверки 24h-окна редактирования. */
  createdAt?: string;
  /** Callback после успешного edit (для optimistic UI update). */
  onEdited: (newText: string) => void;
}

/** Server edit window — 24 часа от createdAt. После — сервер вернёт `edit_window_expired`. */
const EDIT_WINDOW_HOURS = 24;

/**
 * Модалка редактирования текста новости/сообщения. Server enforce'ит edit
 * window (несколько часов после публикации) и permission (автор/admin).
 *
 * Optimistic update: на save сразу зовём onEdited (UI обновляется), параллельно
 * API call'им editMessage. При ошибке — TODO: revert через refetch (caller
 * перерендерит из store при ошибке).
 */
export function NewsEditDialog({
  open,
  onOpenChange,
  newsId,
  initialText,
  createdAt,
  onEdited,
}: NewsEditDialogProps) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сбрасываем state при открытии.
  useEffect(() => {
    if (open) {
      setText(initialText);
      setError(null);
      setSaving(false);
    }
  }, [open, initialText]);

  // Server возвращает `edit_window_expired` если > 24h. Дублируем проверку
  // локально → если просрочено, не показываем форму, а вежливое сообщение.
  // Также если server вернул `edit_window_expired` на save (например, clock
  // drift'нул) — fallback на тот же UI ниже через error code.
  const windowExpired =
    isOlderThanHours(createdAt, EDIT_WINDOW_HOURS) ||
    error === 'edit_window_expired' ||
    error === 'Редактирование невозможно';

  const handleSave = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === initialText.trim()) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editMessage(api, { id: newsId, text: trimmed });
      onEdited(trimmed);
      onOpenChange(false);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'edit_window_expired') {
        setError('edit_window_expired');
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить');
      }
    } finally {
      setSaving(false);
    }
  };

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
            'fixed left-1/2 top-1/2 z-50 flex w-[480px] flex-col',
            '-translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <header className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
              {windowExpired ? 'Редактирование невозможно' : 'Редактировать'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрыть"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  'text-text-muted outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </Dialog.Close>
          </header>

          {windowExpired ? (
            <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
              <Clock className="h-7 w-7 text-text-muted" strokeWidth={1.5} />
              <p className="text-[13px] leading-relaxed text-text-secondary">
                Прошло более суток с момента публикации.
              </p>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={cn(
                    'mt-2 flex h-8 items-center rounded-md px-4 text-[13px]',
                    'bg-bg-hover text-text-strong transition-colors hover:bg-bg-pressed',
                  )}
                >
                  Понятно
                </button>
              </Dialog.Close>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 px-5 py-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Текст сообщения…"
                  rows={6}
                  autoFocus
                  className={cn(
                    'w-full resize-y rounded-md border border-border-default bg-bg-primary px-3 py-2',
                    'text-[13px] leading-relaxed text-text-strong outline-none transition-colors',
                    'placeholder:text-text-muted',
                    'focus:border-border-strong',
                  )}
                />

                {error !== null && error !== 'edit_window_expired' && (
                  <div
                    className={cn(
                      'rounded-md border border-danger/30 bg-danger/10 px-3 py-2',
                      'text-[12px] leading-snug text-danger',
                    )}
                  >
                    {error}
                  </div>
                )}
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-8 items-center rounded-md px-3 text-[13px]',
                      'text-text-secondary transition-colors',
                      'hover:bg-bg-hover hover:text-text-strong',
                    )}
                  >
                    Отмена
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || text.trim().length === 0}
                  className={cn(
                    'flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors',
                    saving || text.trim().length === 0
                      ? 'cursor-not-allowed bg-bg-hover text-text-muted'
                      : 'bg-accent-clay text-white hover:bg-accent-clay-dim',
                  )}
                >
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
