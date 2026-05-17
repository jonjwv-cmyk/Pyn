import { forwardRef, useRef, useState } from 'react';
import { ArrowUp, Clock, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ATTACHMENT_MAX_SIZE, type PendingAttachment } from '@/types/chat';
import { NewsScheduleDialog } from './NewsScheduleDialog';

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
}

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
export function NewsComposer({ onPublish }: NewsComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  const canPublish = trimmed.length > 0 || attachments.length > 0;

  const handleFilesPicked = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setAttachError(null);
    for (const file of Array.from(files)) {
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

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handlePublish = () => {
    if (!canPublish) return;
    onPublish?.(trimmed, attachments, scheduledAt);
    setText('');
    setAttachments([]);
    setScheduledAt(null);
    setAttachError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div
        className={cn(
          'rounded-xl border border-border-default bg-bg-elevated',
          'transition-colors focus-within:border-border-strong',
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-2 pb-2 pt-2">
            {attachments.map((att) => (
              <AttachmentChip
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
              Опубликуется:{' '}
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="font-medium text-text-strong underline-offset-2 hover:underline"
              >
                {formatScheduledRu(scheduledAt)}
              </button>
            </span>
            <button
              type="button"
              onClick={() => setScheduledAt(null)}
              aria-label="Отменить отложку"
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
            label="Прикрепить файл"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolbarButton
            icon={Clock}
            label="Отложить публикацию"
            active={scheduledAt !== null}
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
            placeholder="Поделитесь новостью…"
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug',
              'text-text-primary placeholder:text-text-muted',
              'max-h-[220px] outline-none focus:outline-none',
            )}
          />

          <SendButton enabled={canPublish} onClick={handlePublish} />
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
}

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
          active
            ? 'bg-accent-clay-bg text-accent-clay'
            : 'text-text-muted hover:bg-bg-hover hover:text-text-strong',
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
}

function SendButton({ enabled, onClick }: SendButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Опубликовать"
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

interface AttachmentChipProps {
  attachment: PendingAttachment;
  onRemove: () => void;
}

function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const Icon = attachment.category === 'image' ? ImageIcon : FileText;
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-lg',
        'border border-border-default bg-bg-primary pl-1.5 pr-0.5',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-accent-clay" strokeWidth={1.75} />
      <span className="truncate text-[12px] text-text-primary">{attachment.name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Удалить вложение"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded',
          'text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong',
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </span>
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

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const SCHEDULED_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Yekaterinburg',
});

function formatScheduledRu(d: Date): string {
  // Везде в Pyn — единый формат: "5 мая, 2:34 PM" (с годом если не текущий).
  // Yek timezone через Intl. У scheduledAt — это уже Date выбранный юзером,
  // парсить не надо, просто форматируем в Yek calendar.
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
  const monthName = MONTHS_GEN[month] ?? '';
  const time = SCHEDULED_TIME_FMT.format(d);
  const nowYear = new Date().getFullYear();
  if (year === nowYear) {
    return `${day} ${monthName}, ${time}`;
  }
  return `${day} ${monthName} ${year}, ${time}`;
}
