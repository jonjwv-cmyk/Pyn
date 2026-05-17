import { useDecryptedBlob } from '@/lib/avatar';
import { cn } from '@/lib/cn';
import { AttachmentTile, type AttachmentContext } from './AttachmentTile';
import { FileText, Play } from 'lucide-react';
import type { Attachment } from '@pyn/core';

interface AttachmentGroupProps {
  attachments: Attachment[];
  context?: AttachmentContext;
}

/**
 * Группа прикреплений в сообщении/новости.
 *
 *   • 1 attachment → одиночный `AttachmentTile` (естественный aspect ratio).
 *   • 2+ media → Telegram-album: 2-column grid с aspect-square thumbnails.
 *   • Mixed (media + файлы) → media в grid, файлы списком ниже.
 *
 * MVP-вариант — без aspect-aware mosaic'a Telegram'a; квадратные ячейки
 * `object-cover`. Достаточно эстетично для большинства случаев.
 */
export function AttachmentGroup({ attachments, context = 'chat' }: AttachmentGroupProps) {
  if (attachments.length === 0) return null;
  if (attachments.length === 1) {
    return <AttachmentTile attachment={attachments[0]!} context={context} />;
  }

  // Разделяем на media (показываем grid'ом) и файлы (списком).
  const media = attachments.filter((a) =>
    a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/'),
  );
  const files = attachments.filter(
    (a) => !a.mimeType.startsWith('image/') && !a.mimeType.startsWith('video/'),
  );

  return (
    <div className="flex flex-col gap-1.5">
      {media.length === 1 && (
        <AttachmentTile attachment={media[0]!} context={context} />
      )}
      {media.length >= 2 && <MediaGrid items={media} context={context} />}
      {files.map((f) => (
        <AttachmentTile key={f.id} attachment={f} context={context} />
      ))}
    </div>
  );
}

interface MediaGridProps {
  items: Attachment[];
  context: AttachmentContext;
}

/**
 * 2-column grid для 2+ media-attachment'ов. Aspect-square ячейки, object-cover.
 * Last-item на full-width если общее количество нечётное (Telegram-эстетика).
 */
function MediaGrid({ items, context }: MediaGridProps) {
  const maxW = context === 'news' ? 'max-w-[480px]' : 'max-w-[320px]';
  return (
    <div className={cn('grid w-full grid-cols-2 gap-1', maxW)}>
      {items.map((item, idx) => {
        const isLastOdd = items.length % 2 === 1 && idx === items.length - 1;
        return (
          <GridCell
            key={item.id}
            item={item}
            context={context}
            className={isLastOdd ? 'col-span-2' : ''}
          />
        );
      })}
    </div>
  );
}

interface GridCellProps {
  item: Attachment;
  context: AttachmentContext;
  className?: string;
}

/**
 * Одна ячейка media-grid'a: квадратный thumbnail с object-cover. На клик —
 * открывает blob в новой вкладке (chat) либо просто decrypt без открытия
 * (news). Для video — статичная превьюшка первого кадра без play-overlay
 * (полный video player доступен только для single attachment'a, в grid'е —
 * только preview).
 */
function GridCell({ item, context, className }: GridCellProps) {
  const blobUrl = useDecryptedBlob(item.url, item.blobKey, item.blobNonce, item.mimeType);
  const isNews = context === 'news';
  const isVideo = item.mimeType.startsWith('video/');

  return (
    <a
      href={blobUrl && !isNews ? blobUrl : '#'}
      target={blobUrl && !isNews ? '_blank' : undefined}
      rel="noreferrer"
      onClick={(e) => {
        if (!blobUrl || isNews) e.preventDefault();
      }}
      onContextMenu={(e) => {
        if (isNews) e.preventDefault();
      }}
      draggable={!isNews}
      className={cn(
        'relative block aspect-square overflow-hidden rounded-md',
        'border border-border-default bg-bg-primary',
        className,
        isNews && 'select-none',
      )}
    >
      {blobUrl ? (
        isVideo ? (
          <>
            <video
              src={blobUrl}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              disablePictureInPicture={isNews}
              className="h-full w-full object-cover"
            />
            <span
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-deep/20"
              aria-hidden
            >
              <Play
                className="h-7 w-7 text-white drop-shadow"
                strokeWidth={2}
                fill="currentColor"
              />
            </span>
          </>
        ) : (
          <img src={blobUrl} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <span className="flex h-full w-full items-center justify-center text-text-muted">
          <FileText className="h-5 w-5" strokeWidth={1.75} />
        </span>
      )}
    </a>
  );
}
