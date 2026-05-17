import { useRef, useState } from 'react';
import { ArrowUp, Image as ImageIcon, FileText, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ATTACHMENT_MAX_SIZE, type PendingAttachment } from '@/types/chat';

interface ChatComposerProps {
  /**
   * Callback при отправке. Сообщение может содержать только текст,
   * только attachments, либо и то, и другое. Composer чистит state сам.
   */
  onSend?: (text: string, attachments: PendingAttachment[]) => void;
}

const MAX_TEXTAREA_HEIGHT = 160;

/**
 * Панель ввода: ряд прикреплений (если есть) → строка [📎] [textarea] [↑].
 *
 * Composer владеет state'ом attachments. File picker (`<input type=file>`)
 * читает выбранные файлы → base64 `data:MIME;…` URL → передаются вверх в
 * onSend → `send_message` body. Server encrypt'ит в R2 при receipt и вернёт
 * blob_key/blob_nonce в response. Cap — 20 МБ per file.
 */
export function ChatComposer({ onSend }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 || attachments.length > 0;

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
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: isImage ? 'media' : 'file',
            name: file.name,
            category: isImage ? 'image' : 'file',
            dataUrl,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
          },
        ]);
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

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(trimmed, attachments);
    setText('');
    setAttachments([]);
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
          <div className="border-b border-border-subtle px-3 py-2 text-[12px] text-danger">
            {attachError}
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
              e.target.value = '';
            }}
          />
          <button
            type="button"
            aria-label="Прикрепить файл"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              'text-text-muted outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
            )}
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Сообщение…"
            rows={1}
            className={cn(
              'flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug',
              'text-text-primary placeholder:text-text-muted',
              'max-h-40 outline-none focus:outline-none',
            )}
          />

          <SendButton enabled={canSend} onClick={handleSend} />
        </div>
      </div>
    </div>
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
          'text-text-muted transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </span>
  );
}

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
      aria-label="Отправить"
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
