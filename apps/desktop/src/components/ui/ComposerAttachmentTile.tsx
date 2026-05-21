import { File, FileText, Film, Image as ImageIcon, Music, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { PendingAttachment } from '@/types/chat';

interface ComposerAttachmentTileProps {
  attachment: PendingAttachment;
  onRemove: () => void;
}

/**
 * Превью прикреплённого файла в composer'e — 60×60 тайл с remove-кнопкой.
 *
 *   • Картинка → реальный thumbnail (data URL у нас в руках до отправки).
 *   • Видео / GIF / аудио / документ → большая иконка по типу + filename
 *     truncated снизу. Размер файла под именем.
 *
 * Применяется и в NewsComposer и в ChatComposer (DRY).
 */
export function ComposerAttachmentTile({
  attachment,
  onRemove,
}: ComposerAttachmentTileProps) {
  const { t } = useTranslation();
  const mime = attachment.mimeType ?? '';
  const isImage = mime.startsWith('image/') && !mime.includes('gif');
  const isGif = mime === 'image/gif';
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const showImagePreview = (isImage || isGif) && typeof attachment.dataUrl === 'string';

  return (
    <div
      className={cn(
        'group relative flex h-[68px] w-[68px] shrink-0 flex-col overflow-hidden rounded-lg',
        'border border-border-default bg-bg-primary',
      )}
    >
      {showImagePreview ? (
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <FileBody
          mime={mime}
          name={attachment.name}
          size={attachment.size ?? 0}
          isVideo={isVideo}
          isAudio={isAudio}
        />
      )}

      {/* GIF / video бейджик — поверх preview'и */}
      {isGif && (
        <span className="absolute bottom-1 left-1 rounded bg-bg-deep/80 px-1 py-px text-[8px] font-bold text-white">
          GIF
        </span>
      )}
      {isVideo && showImagePreview === false && (
        <span className="absolute bottom-1 left-1 rounded bg-bg-deep/80 px-1 py-px text-[8px] font-bold text-white">
          VIDEO
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={t('attachments.remove_aria')}
        className={cn(
          'absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full',
          'bg-bg-deep/70 text-white outline-none backdrop-blur-[1px] transition-opacity',
          'opacity-0 group-hover:opacity-100',
          'hover:bg-danger',
        )}
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

interface FileBodyProps {
  mime: string;
  name: string;
  size: number;
  isVideo: boolean;
  isAudio: boolean;
}

function FileBody({ mime, name, size, isVideo, isAudio }: FileBodyProps) {
  // Выбираем иконку по mime. ImageIcon — для не-image нет (мы там показываем
  // real thumbnail), но оставим как fallback для broken data URL.
  const Icon = pickIcon(mime, isVideo, isAudio);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1.5">
      <Icon className="h-6 w-6 shrink-0 text-accent-clay" strokeWidth={1.75} />
      <span className="line-clamp-2 break-all px-0.5 text-center text-[9px] leading-tight text-text-primary">
        {name}
      </span>
      {size > 0 && (
        <span className="text-[8px] tabular-nums text-text-muted">
          {formatSize(size)}
        </span>
      )}
    </div>
  );
}

function pickIcon(mime: string, isVideo: boolean, isAudio: boolean) {
  if (isVideo) return Film;
  if (isAudio) return Music;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('pdf') || mime.includes('text') || mime.includes('word')) {
    return FileText;
  }
  return File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
