import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Pin } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import type { NewsItem, Role } from '@pyn/core';
import { NewsCardActionsMenu, NewsCardBody } from './NewsCard';
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
  /**
   * Перенести скролл ленты к указанной новости. Click на body pill'а
   * (label «Новость» / «Опрос») триггерит это; chevron'ом ниже остаётся
   * inline-раскрытие самого пилла.
   */
  onJumpToNews?: (newsId: number) => void;
}

/**
 * Компактная "плашка" закреплённой новости.
 *
 *   • Свёрнутая: [📌] Новость (важно) / Опрос (важно) [⋯] [▼]
 *   • Раскрытая: + sender row (avatar + name + time) + полный NewsCardBody.
 *
 * Каждая плашка раскрывается независимо. Pin рендерится как маленький
 * clay-tinted chip (4dp радиус), чтобы визуально отделить pinned-секцию.
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
  const [expanded, setExpanded] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const kindLabel = news.kind === 'poll' ? t('news.label_poll') : t('news.label_news');

  return (
    <article
      className={cn(
        'flex flex-col rounded-xl border bg-bg-elevated',
        'border-accent-clay-bg/60 ring-1 ring-accent-clay-bg/30',
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <PinChip />

        <button
          type="button"
          onClick={() => onJumpToNews?.(news.id)}
          aria-label={t('pinned_pill.jump_aria', { kind: kindLabel })}
          className={cn(
            'flex min-w-0 flex-1 items-baseline gap-1.5 text-left outline-none',
            'rounded transition-colors hover:text-accent-clay',
          )}
        >
          <span className="shrink-0 text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
            {kindLabel}
          </span>
          <span className="shrink-0 text-[12px] text-text-muted">{t('pinned_pill.important')}</span>
        </button>

        <NewsCardActionsMenu
          news={news}
          currentUserRole={currentUserRole}
          onOpenStats={() => setStatsOpen(true)}
          onEdit={() => setEditOpen(true)}
          onTogglePin={() => onTogglePin?.(news.id)}
          onDelete={() => onDelete?.(news.id)}
        />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t('pinned_pill.collapse_aria') : t('pinned_pill.expand_aria')}
          aria-expanded={expanded}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            'text-text-muted outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')}
            strokeWidth={1.75}
          />
        </button>
      </div>

      {expanded && (
        // `group/news` нужен ReactionsRow внутри NewsCardBody — иначе plus-
        // кнопка (`opacity-0 group-hover/news:opacity-100`) никогда не
        // показывается в expanded pinned (мы не в NewsCard который сам group).
        <div className="group/news flex flex-col gap-3 border-t border-border-subtle px-4 pb-3.5 pt-3">
          <SenderRow news={news} />
          <NewsCardBody
            news={news}
            currentUserRole={currentUserRole}
            onReact={onReact}
            onVote={onVote}
          />
        </div>
      )}

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
 * Маленький clay-tinted chip с filled-pin — заменяет одинокую иконку, делает
 * pinned-плашку визуально опознаваемой даже мельком.
 */
function PinChip() {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
        'bg-accent-clay-bg',
      )}
    >
      <Pin
        className="h-3.5 w-3.5 fill-accent-clay text-accent-clay"
        strokeWidth={1.5}
      />
    </span>
  );
}

interface SenderRowProps {
  news: NewsItem;
}

/**
 * Sender-инфо в раскрытом виде: avatar + presence + name + время.
 * Заменяет header'у обычной NewsCard — нужна чтобы видеть кто и когда
 * запостил, когда плашка свёрнутая показывает только тип.
 */
function SenderRow({ news }: SenderRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative shrink-0">
        <Avatar
          initials={news.senderInitials}
          size={26}
          login={news.senderLogin}
          avatarUrl={news.senderAvatarUrl}
          avatarBlobKey={news.senderAvatarBlobKey}
          avatarBlobNonce={news.senderAvatarBlobNonce}
        />
        <PresenceDot
          state={news.senderPresence}
          size={9}
          ringClass="ring-bg-elevated"
          className="absolute -bottom-0.5 -right-0.5"
        />
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[12.5px] font-medium text-text-strong">
          {news.senderName}
        </span>
        <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
          {news.createdAtLabel}
        </span>
      </span>
    </div>
  );
}
