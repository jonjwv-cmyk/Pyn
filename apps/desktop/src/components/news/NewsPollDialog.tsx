import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { insertAtCursor } from '@/lib/insert-at-cursor';
import { createNewsPoll } from '@pyn/core';

interface NewsPollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Опционально — callback при успешной публикации (для toast / cache invalidate). */
  onPublished?: (messageId: number) => void;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

/**
 * Композер опроса. UX зеркалит Kotlin `PollBuilderSheet.kt`:
 *
 *   • Поле «Вопрос» (textarea, 2-4 строки auto-grow)
 *   • Список вариантов (input'ы); минимум 2, максимум 10
 *   • Кнопка удаления варианта появляется только если их > 2
 *   • Кнопка «Добавить вариант» доступна пока < MAX_OPTIONS
 *   • Submit disabled пока вопрос пустой ИЛИ непустых вариантов < 2
 *
 * Server `create_news_poll` принимает title + description (Kotlin шлёт оба
 * одинаковыми) и options[]. После публикации server broadcastит news_update;
 * NewsFeed подхватит автоматически через WS-listener.
 */
export function NewsPollDialog({ open, onOpenChange, onPublished }: NewsPollDialogProps) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  const handleEmojiPickToQuestion = (emoji: string): void => {
    const el = questionRef.current;
    if (!el) {
      setQuestion((prev) => prev + emoji);
      return;
    }
    setQuestion(insertAtCursor(el, emoji));
  };

  // Сброс state при открытии (свежий опрос каждый раз).
  useEffect(() => {
    if (open) {
      setQuestion('');
      setOptions(['', '']);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const validOptionsCount = options.filter((o) => o.trim().length > 0).length;
  const canSubmit = question.trim().length > 0 && validOptionsCount >= MIN_OPTIONS;

  const handleAddOption = (): void => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, '']);
    // Фокус на новом input'е после render'a — pleasant UX.
    queueMicrotask(() => lastInputRef.current?.focus());
  };

  const handleRemoveOption = (idx: number): void => {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleChangeOption = (idx: number, value: string): void => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createNewsPoll(api, {
        question: question.trim(),
        options,
      });
      onPublished?.(res.messageId);
      onOpenChange(false);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(t(serverErrorToKey(code)));
    } finally {
      setSubmitting(false);
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
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
            {t('news_poll_dialog.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12px] text-text-muted">
            {t('news_poll_dialog.subtitle')}
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {t('news_poll_dialog.question_label')}
              </label>
              <div className="relative">
                <textarea
                  ref={questionRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                  placeholder={t('news_poll_dialog.question_placeholder')}
                  className={cn(
                    'w-full resize-none rounded-lg border border-border-subtle bg-bg-primary/40 px-3 py-2 pr-10',
                    'text-[13px] leading-snug text-text-primary placeholder:text-text-muted',
                    'outline-none transition-colors focus:border-border-strong',
                  )}
                />
                <div className="absolute right-1.5 top-1.5">
                  <EmojiPickerButton onPick={handleEmojiPickToQuestion} />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {t('news_poll_dialog.options_label', { count: validOptionsCount, min: MIN_OPTIONS })}
              </label>
              <div className="flex flex-col gap-1.5">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      ref={idx === options.length - 1 ? lastInputRef : undefined}
                      type="text"
                      value={opt}
                      onChange={(e) => handleChangeOption(idx, e.target.value)}
                      placeholder={t('news_poll_dialog.option_placeholder', { n: idx + 1 })}
                      className={cn(
                        'flex-1 rounded-lg border border-border-subtle bg-bg-primary/40 px-3 py-1.5',
                        'text-[13px] text-text-primary placeholder:text-text-muted',
                        'outline-none transition-colors focus:border-border-strong',
                      )}
                    />
                    {options.length > MIN_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => handleRemoveOption(idx)}
                        aria-label={t('news_poll_dialog.option_remove_aria')}
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          'text-text-muted outline-none transition-colors',
                          'hover:bg-bg-hover hover:text-danger',
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                ))}
                {options.length < MAX_OPTIONS && (
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className={cn(
                      'mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1',
                      'text-[12px] text-text-muted outline-none transition-colors',
                      'hover:bg-bg-hover hover:text-text-strong',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t('news_poll_dialog.add_option')}
                  </button>
                )}
              </div>
            </div>

            {error !== null && (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                {t('news_poll_dialog.cancel')}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSubmit || submitting}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {submitting ? t('news_poll_dialog.submitting') : t('news_poll_dialog.submit')}
            </button>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Маппинг известных серверных error code'ов в translation key. */
function serverErrorToKey(code: string): string {
  switch (code) {
    case 'poll_payload_invalid':
      return 'news_poll_dialog.error_invalid_options';
    case 'poll_question_empty':
    case 'poll_options_min_2':
      return 'news_poll_dialog.error_min_options';
    case 'role_forbidden':
      return 'news_poll_dialog.error_forbidden';
    default:
      return 'news_poll_dialog.error_fallback';
  }
}
