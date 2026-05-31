import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Pin, Play } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { AttachmentTile } from '@/components/ui/AttachmentTile';
import { useDecryptedBlob } from '@/lib/avatar';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { usePresenceStore } from '@/lib/stores';
import { cn } from '@/lib/cn';
import type { Attachment, NewsItem, Role } from '@pyn/core';
import { NewsCardActionsMenu, ReactionsRow } from './NewsCard';
import { NewsPollVoting } from './NewsPollVoting';
import { NewsEditDialog } from './NewsEditDialog';
import { NewsStatsDialog } from './NewsStatsDialog';

interface PinnedPillProps {
  news: NewsItem;
  currentUserRole: Role;
  onReact: (newsId: number, emoji: string) => void;
  onVote?: (newsId: number, optionId: number) => void;
  onTogglePin?: (newsId: number) => void;
  onDelete?: (newsId: number) => void;
  /** Локальное обновление текста после успешного редактирования. */
  onEdited?: (newsId: number, newText: string) => void;
  /** Перенести скролл ленты к этой новости (клик по карточке / «В ленте»). */
  onJumpToNews?: (newsId: number) => void;
}

const isMedia = (a: Attachment): boolean =>
  a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/');

/**
 * Компактная функциональная копия закреплённой новости/опроса (правая колонка
 * Новостей). Это «слот» — мини-версия новости: автор + время, текст (4 строки),
 * вписанная превью media (с ambient-блюром по бокам — видна реальная форма),
 * опрос (голосовать можно тут же), кнопка «В ленте» и реакции. Без плашки
 * «📌 Новость (важно)» — пин подразумевается самим нахождением в этой колонке.
 * Клик по карточке переносит к оригиналу в ленте слева.
 */
export function PinnedPill({
  news,
  currentUserRole,
  onReact,
  onVote,
  onTogglePin,
  onDelete,
  onEdited,
  onJumpToNews,
}: PinnedPillProps) {
  const { t } = useTranslation();
  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const dateLabel = useFormatYek(news.createdAt);

  const media = news.attachments.filter(isMedia);
  const files = news.attachments.filter((a) => !isMedia(a));
  const jump = () => onJumpToNews?.(news.id);

  return (
    <article
      className={cn(
        // Слот фикс-размера (flex-1 = 1/3 колонки). Контент вписывается, лишнее
        // обрезается; шапка и футер (контролы) всегда видны.
        'group/news flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl',
        // Рамка слота — как у закреплённой новости в самой ленте (clay-tint).
        'border border-accent-clay-bg/60 bg-bg-elevated ring-1 ring-accent-clay-bg/30',
        'transition-shadow hover:ring-accent-clay-bg/55',
        // «Падение» в слот при закреплении (и мягкое появление на загрузке).
        'animate-in fade-in-0 zoom-in-95 duration-200',
      )}
    >
      {/* Header — автор + время + меню. Клик по телу карточки НЕ переходит к
          новости: переход — только по пиллу «В ленте» в футере. */}
      <div className="flex shrink-0 items-center gap-2.5 px-3 pt-2.5">
        <span className="relative shrink-0">
          <Avatar
            initials={news.senderInitials}
            size={24}
            login={news.senderLogin}
            avatarUrl={news.senderAvatarUrl}
            avatarBlobKey={news.senderAvatarBlobKey}
            avatarBlobNonce={news.senderAvatarBlobNonce}
          />
          <PinnedSenderPresenceDot login={news.senderLogin} fallback={news.senderPresence} />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[12.5px] font-medium text-text-strong">
            {news.senderName}
          </span>
          <span className="shrink-0 text-[11px] text-text-muted tabular-nums">{dateLabel}</span>
        </span>
        <span className="shrink-0">
          <NewsCardActionsMenu
            news={news}
            currentUserRole={currentUserRole}
            onOpenStats={() => setStatsOpen(true)}
            onEdit={() => setEditOpen(true)}
            onTogglePin={() => onTogglePin?.(news.id)}
            onDelete={() => onDelete?.(news.id)}
          />
        </span>
      </div>

      {/* Контент — вписывается, лишнее обрезается (fade снизу). */}
      <div className="relative min-h-0 flex-1 overflow-hidden px-3 pt-2">
        <div className="flex flex-col gap-2">
          {news.text && (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-primary">
              {news.text}
            </p>
          )}
          {media.length > 0 && (
            <PinnedMedia attachment={media[0]!} extraCount={media.length - 1} />
          )}
          {files.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <AttachmentTile attachment={files[0]!} context="news" />
              {files.length > 1 && (
                <span className="px-0.5 text-[11px] text-text-muted">+{files.length - 1}</span>
              )}
            </div>
          )}
          {/* Опрос — функциональный (если влез); голосовать можно из слота. */}
          {news.poll && (
            <NewsPollVoting poll={news.poll} onVote={(optionId) => onVote?.(news.id, optionId)} />
          )}
        </div>
        {/* Fade снизу — индикатор, что контент не влез целиком (обрезан). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-bg-elevated to-transparent" />
      </div>

      {/* Footer — «В ленте» (единственный переход к новости) → реакции. Стиль
          пилла — как у пиллов карточки склада: rounded, компактный, semibold. */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-1.5">
        <button
          type="button"
          onClick={jump}
          className="inline-flex shrink-0 items-center rounded bg-accent-clay-bg px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-accent-clay outline-none transition-colors hover:bg-accent-clay/20"
        >
          {t('pinned_pill.jump_to_feed')}
        </button>
        <div className="flex min-w-0 items-center">
          <ReactionsRow
            messageId={news.id}
            reactions={news.reactions}
            myReactions={news.myReactions}
            developerView={currentUserRole === 'developer'}
            onToggle={(emoji) => onReact(news.id, emoji)}
          />
        </div>
      </div>

      <NewsStatsDialog news={news} open={statsOpen} onOpenChange={setStatsOpen} />
      <NewsEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        newsId={news.id}
        initialText={news.text}
        createdAt={news.createdAt}
        onEdited={(newText) => onEdited?.(news.id, newText)}
      />
    </article>
  );
}

/**
 * Пустой слот закрепления — подсвеченное место со значком-пином (фикс-размер,
 * как заполненный слот). Показывается для каждого незанятого из трёх слотов.
 */
export function EmptyPinSlot() {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl',
        'border border-dashed border-accent-clay/20 bg-accent-clay/[0.035]',
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-clay/[0.08] text-accent-clay/55 shadow-[0_0_20px_rgba(217,119,87,0.10)]">
        <Pin className="h-4 w-4" strokeWidth={1.5} />
      </span>
    </div>
  );
}

/**
 * Превью при drag-to-pin: пока тащат новость над колонкой, в целевом слоте
 * показывается её уменьшенная версия (автор + сниппет) с clay-подсветкой —
 * «вот сюда упадёт». Заменяет EmptyPinSlot на время перетаскивания.
 */
export function PinDropPreview({ news }: { news: NewsItem }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-xl px-3 py-2.5',
        'border-2 border-dashed border-accent-clay/55 bg-accent-clay/[0.07] ring-1 ring-accent-clay/20',
        'animate-in fade-in-0 zoom-in-95 duration-150',
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar
          initials={news.senderInitials}
          size={20}
          login={news.senderLogin}
          avatarUrl={news.senderAvatarUrl}
          avatarBlobKey={news.senderAvatarBlobKey}
          avatarBlobNonce={news.senderAvatarBlobNonce}
        />
        <span className="truncate text-[12px] font-medium text-text-strong">{news.senderName}</span>
      </div>
      {news.text && (
        <p className="line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-snug text-text-secondary">
          {news.text}
        </p>
      )}
      <span className="mt-auto flex items-center gap-1 text-[10.5px] font-medium text-accent-clay">
        <Pin className="h-3 w-3" strokeWidth={1.75} />
        {t('pinned_pill.drop_to_pin')}
      </span>
    </div>
  );
}

interface PinnedMediaProps {
  attachment: Attachment;
  /** Сколько ещё media-вложений скрыто (бейдж «+N» в углу). */
  extraCount: number;
}

/**
 * Компактная превью media для слота: фикс-высота 132px. Foreground —
 * естественный aspect ratio (`object-contain`, вписан, не обрезан → видно
 * реальную форму/размер), за ним ambient-backdrop: размытая увеличенная копия
 * того же кадра заполняет бока (Apple/YouTube-style, как в ленте). Сохранение/
 * перетаскивание заблокировано (broadcast-контент).
 */
function PinnedMedia({ attachment, extraCount }: PinnedMediaProps) {
  const blobUrl = useDecryptedBlob(
    attachment.url,
    attachment.blobKey,
    attachment.blobNonce,
    attachment.mimeType,
  );
  const isVideo = attachment.mimeType.startsWith('video/');

  return (
    <div className="relative h-[132px] w-full select-none overflow-hidden rounded-lg border border-border-default bg-bg-primary">
      {blobUrl ? (
        <>
          {/* Ambient backdrop — размытая копия кадра по бокам. */}
          {isVideo ? (
            <MutedVideo
              blobUrl={blobUrl}
              backdrop
              className="absolute inset-0 z-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
            />
          ) : (
            <img
              src={blobUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 z-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
            />
          )}
          {/* Foreground — вписан целиком, без обрезки. */}
          {isVideo ? (
            <MutedVideo
              blobUrl={blobUrl}
              className="relative z-10 mx-auto block h-full w-auto max-w-full object-contain"
            />
          ) : (
            <img
              src={blobUrl}
              alt=""
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
              className="relative z-10 mx-auto block h-full w-auto max-w-full object-contain"
            />
          )}
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-text-muted">
          {isVideo ? (
            <Play className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <ImageIcon className="h-5 w-5" strokeWidth={1.75} />
          )}
        </span>
      )}
      {extraCount > 0 && (
        <span className="absolute bottom-1.5 right-1.5 z-20 rounded-md bg-bg-deep/70 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-[2px]">
          +{extraCount}
        </span>
      )}
    </div>
  );
}

/**
 * Автоплей-видео с гарантированным mute (и для foreground, и для backdrop).
 * React `muted`-prop иногда игнорируется браузером для autoplay blob-URL —
 * принудительно через ref. `backdrop` версия не интерактивна (aria-hidden).
 */
function MutedVideo({
  blobUrl,
  className,
  backdrop = false,
}: {
  blobUrl: string;
  className: string;
  backdrop?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.volume = 0;
  }, []);
  return (
    <video
      ref={ref}
      src={blobUrl}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
      aria-hidden={backdrop || undefined}
      tabIndex={backdrop ? -1 : undefined}
      onContextMenu={backdrop ? undefined : (e) => e.preventDefault()}
      draggable={backdrop ? undefined : false}
      className={className}
    />
  );
}

/**
 * §pyn-1.2.42 — presence-dot для автора закреплённой новости. Single source
 * of truth — usePresenceStore. Fallback на server snapshot только до того
 * как presenceStore получит live данные.
 */
function PinnedSenderPresenceDot({
  login,
  fallback,
}: {
  login: string;
  fallback: 'online' | 'away' | 'offline';
}) {
  const live = usePresenceStore((s) => s.byLogin[login]?.status);
  return (
    <PresenceDot
      state={live ?? fallback}
      size={9}
      ringClass="ring-bg-elevated"
      className="absolute -bottom-0.5 -right-0.5"
    />
  );
}
