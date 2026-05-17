import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  BarChart3,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { AttachmentGroup } from '@/components/ui/AttachmentGroup';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import { MessageActionsPopup } from '@/components/ui/MessageActionsPopup';
import { can, isAdminLike, type NewsItem, type Role } from '@pyn/core';
import { NewsEditDialog } from './NewsEditDialog';
import { NewsPollVoting } from './NewsPollVoting';
import { NewsStatsDialog } from './NewsStatsDialog';
import { ReactionVotersPopover } from './ReactionVotersPopover';

interface NewsCardProps {
  news: NewsItem;
  /** Role текущего пользователя — для permission gating меню действий. */
  currentUserRole: Role;
  onReact: (newsId: number, emoji: string) => void;
  onVote?: (newsId: number, optionId: number) => void;
  onTogglePin?: (newsId: number) => void;
  onDelete?: (newsId: number) => void;
  /** Optimistic update текста после редактирования. */
  onEdited?: (newsId: number, newText: string) => void;
}

// Реакции 1:1 с server validation (`@pyn/core/reactions.ts::ALLOWED_REACTIONS`).
// Любая правка вызовет invalid_emoji от сервера — менять только синхронно с
// `handlers-reactions.js::ALLOWED_EMOJIS`.

/**
 * Полная карточка новости в обычной ленте.
 *
 * Header (avatar + presence + name + time + pinned chip + unread dot + actions menu)
 *   ↓
 * NewsCardBody (text + attachments + poll + reactions)
 *
 * PinnedPill в свёрнутом виде показывает свой компактный header и при раскрытии
 * переиспользует ровно тот же NewsCardBody — DRY.
 */
export function NewsCard({
  news,
  currentUserRole,
  onReact,
  onVote,
  onTogglePin,
  onDelete,
  onEdited,
}: NewsCardProps) {
  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <article
      className={cn(
        'group/news flex flex-col gap-3 rounded-xl border bg-bg-elevated px-4 py-3.5',
        news.isPinned
          ? 'border-accent-clay-bg/60 ring-1 ring-accent-clay-bg/30'
          : 'border-border-subtle',
      )}
    >
      <header className="flex items-start gap-3">
        <span className="relative shrink-0">
          <Avatar
            initials={news.senderInitials}
            size={32}
            login={news.senderLogin}
            avatarUrl={news.senderAvatarUrl}
            avatarBlobKey={news.senderAvatarBlobKey}
            avatarBlobNonce={news.senderAvatarBlobNonce}
          />
          <PresenceDot
            state={news.senderPresence}
            size={10}
            ringClass="ring-bg-elevated"
            className="absolute -bottom-0.5 -right-0.5"
          />
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold tracking-[-0.005em] text-text-strong">
            {news.senderName}
          </span>
          <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
            {news.createdAtLabel}
          </span>
          {!news.isRead && !news.isOwn && (
            <span
              aria-label="Не прочитано"
              className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-clay"
            />
          )}
        </div>

        <NewsCardActionsMenu
          news={news}
          currentUserRole={currentUserRole}
          onOpenStats={() => setStatsOpen(true)}
          onEdit={() => setEditOpen(true)}
          onTogglePin={() => onTogglePin?.(news.id)}
          onDelete={() => onDelete?.(news.id)}
        />
      </header>

      <NewsCardBody
        news={news}
        currentUserRole={currentUserRole}
        onReact={onReact}
        onVote={onVote}
      />

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

// ── Body (без header'a) ────────────────────────────────────────────────────

interface NewsCardBodyProps {
  news: NewsItem;
  /**
   * Role текущего юзера — нужна чтобы решать, оборачивать ли chip'ы реакций
   * в hover-popover со списком voter'ов. Только `developer` это видит.
   */
  currentUserRole: Role;
  onReact: (newsId: number, emoji: string) => void;
  onVote?: (newsId: number, optionId: number) => void;
}

/**
 * Содержимое новости без header'a: текст, attachments, опрос, реакции.
 * Используется в NewsCard (с header'ом) и PinnedPill (со своим компактным
 * header'ом-плашкой).
 */
export function NewsCardBody({ news, currentUserRole, onReact, onVote }: NewsCardBodyProps) {
  return (
    <div className="flex flex-col gap-3">
      {news.text && (
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-text-primary">
          {news.text}
        </p>
      )}

      {news.attachments.length > 0 && (
        <AttachmentGroup attachments={news.attachments} context="news" />
      )}

      {news.poll && (
        <NewsPollVoting
          poll={news.poll}
          onVote={(optionId) => onVote?.(news.id, optionId)}
        />
      )}

      <ReactionsRow
        messageId={news.id}
        reactions={news.reactions}
        myReactions={news.myReactions}
        developerView={currentUserRole === 'developer'}
        onToggle={(emoji) => onReact(news.id, emoji)}
      />
    </div>
  );
}

// ── Actions Menu (три точки) ───────────────────────────────────────────────

interface NewsCardActionsMenuProps {
  news: NewsItem;
  currentUserRole: Role;
  onOpenStats: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

/**
 * Меню «⋯» для NewsCard и PinnedPill: Статистика / Закрепить / Удалить.
 * Удалить показывается только для своих новостей.
 */
export function NewsCardActionsMenu({
  news,
  currentUserRole,
  onOpenStats,
  onEdit,
  onTogglePin,
  onDelete,
}: NewsCardActionsMenuProps) {
  // Permission gating: server тоже enforce'ит, но мы скрываем кнопки, которые
  // юзеру всё равно не дадут нажать → меньше попыток с ошибками + чище UI.
  //   Stats   — admin/developer (server gate в get_news_readers/get_poll_stats)
  //   Edit    — автор ИЛИ admin/developer (server gate в edit_message)
  //   Pin     — admin/developer (server gate в pin_message)
  //   Delete  — автор ИЛИ admin/developer (server gate в soft_delete_message)
  const canStats = isAdminLike(currentUserRole);
  const canEdit = news.isOwn || can(currentUserRole, 'news.delete-others');
  const canPin = can(currentUserRole, 'news.pin');
  const canDelete = canEdit;

  if (!canStats && !canEdit && !canPin && !canDelete) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Действия с новостью"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            'text-text-muted outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-strong',
            'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
          )}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={4}
          className={cn(
            'z-50 w-[200px] rounded-xl',
            'border border-border-default bg-bg-elevated',
            'p-1.5 shadow-xl',
          )}
        >
          {canStats && <MenuRow icon={BarChart3} label="Статистика" onSelect={onOpenStats} />}
          {canEdit && <MenuRow icon={Pencil} label="Редактировать" onSelect={onEdit} />}
          {canPin && (
            <MenuRow
              icon={news.isPinned ? PinOff : Pin}
              label={news.isPinned ? 'Открепить' : 'Закрепить'}
              onSelect={onTogglePin}
            />
          )}
          {canDelete && (canStats || canEdit || canPin) && (
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          )}
          {canDelete && (
            <MenuRow icon={Trash2} label="Удалить" onSelect={onDelete} variant="danger" />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface MenuRowProps {
  icon: LucideIcon;
  label: string;
  variant?: 'default' | 'danger';
  onSelect: () => void;
}

function MenuRow({ icon: Icon, label, variant = 'default', onSelect }: MenuRowProps) {
  const danger = variant === 'danger';
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 outline-none transition-colors',
        'text-[13px]',
        danger
          ? 'text-danger data-[highlighted]:bg-danger/15 data-[highlighted]:text-danger'
          : 'text-text-primary data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', danger ? 'text-danger' : 'text-text-muted')} strokeWidth={1.75} />
      <span className="flex-1 truncate">{label}</span>
    </DropdownMenu.Item>
  );
}

// ── private helpers ────────────────────────────────────────────────────────

interface ReactionsRowProps {
  /** ID новости — нужен для запроса voter'ов в hover-popover. */
  messageId: number;
  reactions: Record<string, number>;
  myReactions: string[];
  /** `true` для role=developer — chip'ы оборачиваются в `ReactionVotersPopover`. */
  developerView: boolean;
  onToggle: (emoji: string) => void;
}

function ReactionsRow({
  messageId,
  reactions,
  myReactions,
  developerView,
  onToggle,
}: ReactionsRowProps) {
  const entries = Object.entries(reactions).filter(([, c]) => c > 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([emoji, count]) => {
        const mine = myReactions.includes(emoji);
        const chip = (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[12px] transition-colors',
              mine
                ? 'border-accent-clay/40 bg-accent-clay-bg text-text-strong'
                : 'border-border-subtle bg-bg-primary text-text-secondary hover:border-border-default hover:text-text-strong',
            )}
          >
            <span className="text-[13px] leading-none">{emoji}</span>
            <span className="tabular-nums">{count}</span>
          </button>
        );
        if (!developerView) return chip;
        return (
          <ReactionVotersPopover key={emoji} messageId={messageId} emoji={emoji}>
            {chip}
          </ReactionVotersPopover>
        );
      })}
      {/* News popup — только реакции (без Copy/Reply, см. UX-решение).
          Chat-сообщения используют MessageActionsPopup с полным набором. */}
      <MessageActionsPopup onReact={onToggle} myReactions={myReactions}>
        <button
          type="button"
          aria-label="Поставить реакцию"
          className={cn(
            'inline-flex h-[22px] items-center gap-1 rounded-pill border border-dashed border-border-subtle px-2',
            'text-[11px] text-text-muted outline-none transition-all',
            'opacity-0 group-hover/news:opacity-100',
            'hover:border-border-default hover:text-text-strong',
            'data-[state=open]:opacity-100 data-[state=open]:text-text-strong',
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2} />
        </button>
      </MessageActionsPopup>
    </div>
  );
}


