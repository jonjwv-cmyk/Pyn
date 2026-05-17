import { FileText, Image as ImageIcon } from 'lucide-react';
import { useDecryptedBlob } from '@/lib/avatar';
import { cn } from '@/lib/cn';
import type { Attachment } from '@pyn/core';

interface AttachmentTileProps {
  attachment: Attachment;
}

/**
 * Универсальный тайл прикрепления — image preview, video player, file chip.
 *
 *   • `image/*` → `<img>` с blob URL (тап → открыть в новом окне)
 *   • `video/*` → `<video controls>` с blob URL
 *   • остальное → file chip с `<a download>` после decrypt
 *
 * Использует общий `useDecryptedBlob` с known wire MIME для точного типа
 * (magic-bytes детектор не покрывает video/audio/документы).
 *
 * Используется в News-карточках и в чат-сообщениях.
 */
export function AttachmentTile({ attachment }: AttachmentTileProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isVideo = attachment.mimeType.startsWith('video/');
  const blobUrl = useDecryptedBlob(
    attachment.url,
    attachment.blobKey,
    attachment.blobNonce,
    attachment.mimeType,
  );

  if (isImage) {
    return (
      <a
        href={blobUrl ?? '#'}
        target={blobUrl ? '_blank' : undefined}
        rel="noreferrer"
        onClick={(e) => !blobUrl && e.preventDefault()}
        className={cn(
          'block max-w-[280px] overflow-hidden rounded-lg',
          'border border-border-default bg-bg-primary',
          'transition-colors hover:border-border-strong',
        )}
        title={attachment.filename}
      >
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={attachment.filename}
            className="h-auto max-h-[240px] w-full object-cover"
          />
        ) : (
          <span className="flex h-24 w-full items-center justify-center text-text-muted">
            <ImageIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
        )}
      </a>
    );
  }

  if (isVideo) {
    return (
      <div
        className={cn(
          'block max-w-[280px] overflow-hidden rounded-lg',
          'border border-border-default bg-bg-primary',
        )}
        title={attachment.filename}
      >
        {blobUrl ? (
          <video src={blobUrl} controls preload="metadata" className="h-auto max-h-[240px] w-full" />
        ) : (
          <span className="flex h-24 w-full items-center justify-center text-text-muted">
            <FileText className="h-5 w-5" strokeWidth={1.75} />
          </span>
        )}
      </div>
    );
  }

  return (
    <a
      href={blobUrl ?? '#'}
      download={blobUrl ? attachment.filename : undefined}
      onClick={(e) => !blobUrl && e.preventDefault()}
      className={cn(
        'inline-flex max-w-[280px] items-center gap-2 rounded-lg',
        'border border-border-default bg-bg-primary px-2.5 py-1.5',
        'transition-colors',
        blobUrl ? 'cursor-pointer hover:border-border-strong' : 'cursor-default opacity-60',
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent-clay-bg text-accent-clay">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] text-text-primary">{attachment.filename}</span>
        <span className="text-[10.5px] tabular-nums text-text-muted">
          {formatBytes(attachment.size)}
        </span>
      </span>
    </a>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}
