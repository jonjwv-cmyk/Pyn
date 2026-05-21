import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, CornerUpLeft, Paperclip, X } from 'lucide-react';
import { ComposerAttachmentTile } from '@/components/ui/ComposerAttachmentTile';
import { EmojiPickerButton } from '@/components/ui/EmojiPickerButton';
import { cn } from '@/lib/cn';
import { insertAtCursor } from '@/lib/insert-at-cursor';
import {
  ATTACHMENT_MAX_SIZE,
  type ChatMessageItem,
  type PendingAttachment,
} from '@/types/chat';

/**
 * Imperative handle для drag-and-drop файлов из родителя (ChatConversation).
 */
export interface ChatComposerHandle {
  addFiles: (files: FileList | File[]) => void;
}

interface ChatComposerProps {
  /**
   * Callback при отправке. Сообщение может содержать только текст,
   * только attachments, либо и то, и другое. Composer чистит state сам.
   */
  onSend?: (text: string, attachments: PendingAttachment[]) => void;
  /**
   * Восстановленный с сервера draft текст. Применяется только если юзер ещё
   * не печатал — асинхронный load не должен затирать ввод.
   */
  initialText?: string;
  /**
   * Debounced (~1.5с) колбэк сохранения черновика. Также вызывается с `''`
   * после отправки — server трактует пустой текст как DELETE.
   */
  onDraftSave?: (text: string) => void;
  /**
   * Сообщение на которое отвечаем. Если задано — над textarea показывается
   * preview-полоска с автор+текст и кнопка отмены. Server use `reply_to_id`.
   */
  replyTo?: ChatMessageItem | null;
  /** Callback отмены reply (X-кнопка в preview-row). */
  onCancelReply?: () => void;
}

const MAX_TEXTAREA_HEIGHT = 160;
const DRAFT_SAVE_DEBOUNCE_MS = 1500;

/**
 * Панель ввода: ряд прикреплений (если есть) → строка [📎] [textarea] [↑].
 *
 * Composer владеет state'ом attachments. File picker (`<input type=file>`)
 * читает выбранные файлы → base64 `data:MIME;…` URL → передаются вверх в
 * onSend → `send_message` body. Server encrypt'ит в R2 при receipt и вернёт
 * blob_key/blob_nonce в response. Cap — 20 МБ per file.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
function ChatComposer(
  { onSend, initialText, onDraftSave, replyTo, onCancelReply },
  ref,
) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userTypedRef = useRef(false);

  const trimmed = text.trim();
  const canSend = trimmed.length > 0 || attachments.length > 0;

  // Hydrate из server draft. При смене peer'а (ChatConversation размонтирует
  // и снова монтирует ChatComposer) initialText прилетает заново → useState
  // снова '' → этот effect снова применяется.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  useEffect(() => {
    return () => {
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    };
  }, []);

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

  useImperativeHandle(ref, () => ({
    addFiles: (files) => {
      void handleFilesPicked(files);
    },
  }));

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const triggerPick = (): void => {
    fileInputRef.current?.click();
  };

  const handleEmojiPick = (emoji: string): void => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const next = insertAtCursor(el, emoji);
    setText(next);
    userTypedRef.current = true;
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

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(trimmed, attachments);
    setText('');
    setAttachments([]);
    setAttachError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* Blur-layer mask «50% → transparent» вверх: blur активен в нижней
          половине pill'а и ниже, выше pill — чётко. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[64px] backdrop-blur-xl"
        style={{
          maskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
        }}
      />
      <div className="relative px-4 pb-3 pt-1">
        <div
          className={cn(
            // pill БЕЗ backdrop-blur — он на layer ниже.
            'pointer-events-auto rounded-xl border border-border-default/60 bg-bg-elevated/45',
            'shadow-lg shadow-bg-deep/30',
            'transition-colors focus-within:border-border-strong',
          )}
        >
        {replyTo && (
          <ReplyPreview replyTo={replyTo} onCancel={onCancelReply} />
        )}

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
            aria-label={t('chat_composer.attach_aria')}
            onClick={triggerPick}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              'text-text-muted outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
            )}
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <EmojiPickerButton onPick={handleEmojiPick} />

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
            placeholder={t('chat_composer.placeholder')}
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
    </div>
  );
});

interface ReplyPreviewProps {
  replyTo: ChatMessageItem;
  onCancel: (() => void) | undefined;
}

function ReplyPreview({ replyTo, onCancel }: ReplyPreviewProps) {
  const { t } = useTranslation();
  const previewText = replyTo.text?.trim() || t('chat_message.attachment_quote');
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border-subtle px-3 py-2',
        'text-[12px] text-text-secondary',
      )}
    >
      <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-accent-clay" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[10.5px] uppercase tracking-wider text-text-muted">
          {t('chat_composer.reply_label')}
        </span>
        <span className="truncate text-text-primary">{previewText}</span>
      </span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('chat_composer.cancel_reply_aria')}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded',
            'text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}


interface SendButtonProps {
  enabled: boolean;
  onClick: () => void;
}

function SendButton({ enabled, onClick }: SendButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={t('chat_composer.send_aria')}
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
