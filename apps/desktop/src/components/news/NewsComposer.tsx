import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowUp, Clock, Paperclip, X } from 'lucide-react';
import { ComposerAttachmentTile } from '@/components/ui/ComposerAttachmentTile';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { cn } from '@/lib/cn';
import { insertAtCursor } from '@/lib/insert-at-cursor';
import { ATTACHMENT_MAX_SIZE, type PendingAttachment } from '@/types/chat';
import { NewsScheduleDialog } from './NewsScheduleDialog';

/**
 * Imperative handle для composer'a — родитель (NewsFeed) вызывает `addFiles`
 * при drag-and-drop в зону ленты, и composer обрабатывает их как через
 * file picker.
 */
export interface NewsComposerHandle {
  addFiles: (files: FileList | File[]) => void;
}

interface NewsComposerProps {
  /**
   * Callback публикации. Если `scheduledAt` не null — публикация отложена.
   * Composer чистит state сам после вызова.
   */
  onPublish?: (
    text: string,
    attachments: PendingAttachment[],
    scheduledAt: Date | null,
  ) => void;
  /**
   * Восстановленный с сервера draft текст. Применяется только если юзер ещё
   * не печатал — чтобы не затирать ввод когда асинхронный load прилетает после
   * первого keystroke'a. Изменение prop'а после публикации (от родителя ←
   * server clear) → состояние не возвращается, потому что text уже пустой.
   */
  initialText?: string;
  /**
   * Debounced (по типу 1.5с) колбэк сохранения черновика на сервер. Также
   * вызывается с `''` при успешной публикации — чтобы серверная запись
   * удалилась (server трактует пустой text как DELETE).
   */
  onDraftSave?: (text: string) => void;
}

const DRAFT_SAVE_DEBOUNCE_MS = 1500;

const MAX_TEXTAREA_HEIGHT = 220;

/**
 * Поле создания новости — полная копия chat-composer'а (ChatComposer) с
 * добавленной кнопкой-таймером для отложенной публикации.
 *
 * Структура:
 *   • Ряд attachments-чипов (если есть)
 *   • Ряд scheduled-индикатора (если запланировано)
 *   • Главный ряд: [📎] [🕐] [textarea] [↑]
 *
 * Меню скрепки и all-around layout идентичны chat-композеру — DRY через
 * ChatAttachmentMenu. Кнопка clock'a выделена accent-clay когда время выбрано.
 */
export const NewsComposer = forwardRef<NewsComposerHandle, NewsComposerProps>(
function NewsComposer({ onPublish, initialText, onDraftSave }, ref) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * `true` после первого keystroke. Защищает от перезаписи свежего ввода
   * поздно прилетевшим asynchronous `initialText` (server fetch может
   * завершиться через секунду; если юзер уже начал печатать — сохраняем).
   */
  const userTypedRef = useRef(false);

  const trimmed = text.trim();
  const canPublish = trimmed.length > 0 || attachments.length > 0;
  /**
   * Server-side runScheduledCron при rollout'е "созревшей" записи в
   * app_messages игнорирует `attachments` (см. handlers-drafts.js — INSERT
   * только text/priority). Поэтому scheduled+attachments недопустимы — иначе
   * юзер потеряет файлы тихо. Disable Clock когда есть прикреплённые файлы.
   */
  const canSchedule = attachments.length === 0;

  // Hydrate из server draft (приходит после первого render с пустым text'ом).
  // Если юзер уже печатал — игнорируем; иначе ставим draft в state и пересчитываем
  // высоту textarea (для multi-line черновика).
  useEffect(() => {
    if (!initialText || userTypedRef.current) return;
    if (text.length > 0) return;
    setText(initialText);
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
      }
    });
    // text/textareaRef intentionally not in deps — нам важен только initialText
    // changeг (load с сервера); local text changes обрабатываются в onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  // Cleanup pending debounce'a при unmount'е, чтобы не сохранить устаревший
  // draft после ухода со страницы.
  useEffect(() => {
    return () => {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    };
  }, []);

  /**
   * Сбросить scheduledAt когда юзер прикрепил файл — server scheduled flow
   * не передаёт attachments в final message, тихая потеря недопустима.
   */
  useEffect(() => {
    if (attachments.length > 0 && scheduledAt !== null) {
      setScheduledAt(null);
    }
  }, [attachments.length, scheduledAt]);

  const handleFilesPicked = async (files: FileList | File[] | null): Promise<void> => {
    if (!files) return;
    const arr = files instanceof FileList ? Array.from(files) : files;
    if (arr.length === 0) return;
    setAttachError(null);
    for (const file of arr) {
      if (file.size > ATTACHMENT_MAX_SIZE) {
        setAttachError(`«${file.name}» больше 20 МБ`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const isImage = file.type.startsWith('image/');
        const attachment: PendingAttachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: isImage ? 'media' : 'file',
          name: file.name,
          category: isImage ? 'image' : 'file',
          dataUrl,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        };
        setAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:composer] file read failed:', err);
        setAttachError(`Не удалось прочитать «${file.name}»`);
      }
    }
  };

  // Imperative handle — родитель вызывает `addFiles` на drag-drop'е.
  useImperativeHandle(ref, () => ({
    addFiles: (files) => {
      void handleFilesPicked(files);
    },
  }));

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /**
   * Открыть file picker. Server сам определит kind (image/video/gif/file) по
   * MIME — клиенту не нужно фильтровать заранее.
   */
  const triggerPick = (): void => {
    fileInputRef.current?.click();
  };

  const handleEmojiPick = (emoji: string): void => {
    const el = textareaRef.current;
    if (!el) {
      // Fallback: добавить в конец, как было.
      setText((prev) => prev + emoji);
      return;
    }
    const next = insertAtCursor(el, emoji);
    setText(next);
    userTypedRef.current = true;
    // Re-height после вставки.
    queueMicrotask(() => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    });
    if (onDraftSave) {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = setTimeout(() => {
        onDraftSave(textareaRef.current?.value ?? '');
        draftDebounceRef.current = null;
      }, DRAFT_SAVE_DEBOUNCE_MS);
    }
  };

  const handlePublish = () => {
    if (!canPublish) return;
    onPublish?.(trimmed, attachments, scheduledAt);
    setText('');
    setAttachments([]);
    setScheduledAt(null);
    setAttachError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    // Очистить серверный draft — мы публикуем (или планируем) этот текст,
    // он больше не должен всплывать при следующем открытии Pyn'a.
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    userTypedRef.current = false;
    onDraftSave?.('');
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setText(next);
    userTypedRef.current = true;
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    if (onDraftSave) {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = setTimeout(() => {
        onDraftSave(next);
        draftDebounceRef.current = null;
      }, DRAFT_SAVE_DEBOUNCE_MS);
    }
  };

  return (
    <div className="pointer-events-none px-4 pb-3 pt-1">
      <div
        className={cn(
          // pill БЕЗ backdrop-blur — он на parent layer (NewsFeed).
          'pointer-events-auto rounded-xl border border-border-default/60 bg-bg-elevated/45',
          'shadow-lg shadow-bg-deep/30',
          'transition-colors focus-within:border-border-strong',
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border-subtle px-2.5 pb-2.5 pt-2.5">
            {attachments.map((att) => (
              <ComposerAttachmentTile
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {attachError !== null && (
          <div
            className={cn(
              'border-b border-border-subtle px-3 py-2 text-[12px] text-danger',
            )}
          >
            {attachError}
          </div>
        )}

        {scheduledAt && (
          <div
            className={cn(
              'flex items-center gap-2 border-b border-border-subtle px-3 py-2',
              'text-[12px] text-text-secondary',
            )}
          >
            <Clock className="h-3.5 w-3.5 shrink-0 text-accent-clay" strokeWidth={1.75} />
            <span>
              <Trans
                i18nKey="news_schedule_dialog.publish_at"
                values={{ format: formatScheduled(scheduledAt, t) }}
                components={{
                  b: (
                    <button
                      type="button"
                      onClick={() => setScheduleOpen(true)}
                      className="font-medium text-text-strong underline-offset-2 hover:underline"
                    />
                  ),
                }}
              />
            </span>
            <button
              type="button"
              onClick={() => setScheduledAt(null)}
              aria-label={t('news.composer_cancel_schedule_aria')}
              className={cn(
                'ml-auto flex h-5 w-5 items-center justify-center rounded',
                'text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-1.5 px-2 py-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFilesPicked(e.target.files);
              // Reset value, чтобы тот же файл можно было выбрать повторно.
              e.target.value = '';
            }}
          />
          <ToolbarButton
            icon={Paperclip}
            label={t('news.composer_attach_aria')}
            onClick={triggerPick}
          />
          <EmojiPickerButton onPick={handleEmojiPick} />
          <ToolbarButton
            icon={Clock}
            label={
              canSchedule
                ? t('news.composer_schedule_aria')
                : t('news.composer_schedule_disabled_aria')
            }
            active={scheduledAt !== null}
            disabled={!canSchedule}
            onClick={() => setScheduleOpen(true)}
          />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handlePublish();
              }
            }}
            placeholder={t('news.composer_placeholder')}
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug',
              'text-text-primary placeholder:text-text-muted',
              'max-h-[220px] outline-none focus:outline-none',
            )}
          />

          <SendButton enabled={canPublish} onClick={handlePublish} ariaLabel={t('news.composer_publish_aria')} />
        </div>
      </div>

      <NewsScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        initial={scheduledAt}
        onSchedule={setScheduledAt}
      />
    </div>
  );
});

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: typeof Paperclip;
  label: string;
  active?: boolean;
}

/**
 * forwardRef обязателен — ChatAttachmentMenu использует Radix DropdownMenu
 * с `asChild`, и Radix должен прикрепить ref к этой кнопке для anchoring'a
 * popup'a. Без forwardRef Radix не получает ref → меню не открывается.
 * Также пропускаем все extra props (data-state, onClick от Radix и т.д.).
 */
const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ icon: Icon, label, active, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        {...rest}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-40',
          active
            ? 'bg-accent-clay-bg text-accent-clay'
            : 'text-text-muted enabled:hover:bg-bg-hover enabled:hover:text-text-strong',
          'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
          className,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </button>
    );
  },
);

interface SendButtonProps {
  enabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}

function SendButton({ enabled, onClick, ariaLabel }: SendButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={ariaLabel}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
        enabled
          ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
          : 'cursor-not-allowed text-text-muted',
      )}
    >
      <ArrowUp className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}


// ── helpers ───────────────────────────────────────────────────────────────

/** Считывает File → `data:MIME;base64,…` URL для отправки в server attachments[]. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') resolve(r);
      else reject(new Error('file read returned non-string'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

const MONTH_GEN_KEYS = [
  'month_gen_jan', 'month_gen_feb', 'month_gen_mar', 'month_gen_apr', 'month_gen_may', 'month_gen_jun',
  'month_gen_jul', 'month_gen_aug', 'month_gen_sep', 'month_gen_oct', 'month_gen_nov', 'month_gen_dec',
] as const;

const SCHEDULED_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Yekaterinburg',
});

/**
 * Единый формат "5 мая, 2:34 PM" (с годом если не текущий). Месяц берётся
 * локализованным из news_schedule_dialog.month_gen_* через t(). RU/UK дают
 * корректный genitive case; EN/DE/ES — номинатив (для них одно и то же).
 */
function formatScheduled(d: Date, t: TFunction): string {
  const yekFormatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
  });
  const parts = yekFormatter.format(d).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const monthName = t(`news_schedule_dialog.${MONTH_GEN_KEYS[month] ?? 'month_gen_jan'}`);
  const time = SCHEDULED_TIME_FMT.format(d);
  const nowYear = new Date().getFullYear();
  if (year === nowYear) {
    return `${day} ${monthName}, ${time}`;
  }
  return `${day} ${monthName} ${year}, ${time}`;
}
