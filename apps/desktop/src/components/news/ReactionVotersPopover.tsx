import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import { computeInitials } from '@/lib/initials';
import { useStatsStore, useUsersStore } from '@/lib/stores';
import { getReactions, type ReactionsDetails } from '@pyn/core';

interface ReactionVotersPopoverProps {
  /** Сама chip-кнопка реакции — Trigger через `asChild`. */
  children: React.ReactNode;
  /** ID новости / сообщения, для которой запрашиваем voters. */
  messageId: number;
  /** Какую конкретно реакцию подсветить (выбирает воters[emoji]). */
  emoji: string;
}

/**
 * Hover-popover со списком кто-когда поставил конкретную реакцию.
 *
 * Только developer должен оборачивать chip'ы в этот компонент (см.
 * `currentUserRole === 'developer'` в NewsCard). Для остальных ролей —
 * обычный chip без popover'а.
 *
 * Поведение:
 *   • При первом open — лениво запросить `get_reactions(messageId)`. Cache
 *     внутри компонента — повторный hover не делает запрос.
 *   • На уход курсора — popover закрывается с small delay (Radix default).
 *   • При ошибке тихо рендерим "Не удалось загрузить" — это admin-tool,
 *     юзер сам разберётся по логам если надо.
 *
 * Аватары/имена берутся из `usersStore` (общий префетч admin'а через
 * `get_users`) — fallback на инициалы из voter.fullName / login.
 */
export function ReactionVotersPopover({
  children,
  messageId,
  emoji,
}: ReactionVotersPopoverProps) {
  const { t } = useTranslation();
  // Cache-first: cached details из глобального stats-store; popover показывает
  // их мгновенно, fetch идёт silent. WS news_update kind=reaction
  // инвалидирует — следующий hover триггерит refresh.
  const cachedDetails = useStatsStore((s) => s.reactionsByMessageId[messageId] ?? null);
  const setStatsReactions = useStatsStore((s) => s.setReactions);

  const [details, setDetails] = useState<ReactionsDetails | null>(cachedDetails);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const users = useUsersStore((s) => s.users);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      // Каждый open запускает silent refetch (даже если кеш есть) — реакции
      // часто меняются, цена запроса минимальна. Loading-индикатор показываем
      // только если кеша вообще нет.
      const hasCached = details !== null || cachedDetails !== null;
      if (!hasCached) setLoading(true);
      setError(false);
      getReactions(api, messageId)
        .then((d) => {
          setDetails(d);
          setStatsReactions(messageId, d);
        })
        .catch(() => {
          if (!hasCached) setError(true);
        })
        .finally(() => setLoading(false));
    },
    [messageId, details, cachedDetails, setStatsReactions],
  );

  const effectiveDetails = details ?? cachedDetails;
  const voters = effectiveDetails?.voters[emoji] ?? [];

  return (
    <HoverCard.Root openDelay={150} closeDelay={120} onOpenChange={handleOpenChange}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 max-h-[280px] w-[260px] overflow-y-auto rounded-xl',
            'border border-border-default bg-bg-elevated p-2 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="mb-1 flex items-center gap-1.5 px-1 py-0.5">
            <span className="text-[14px] leading-none">{emoji}</span>
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
              {t('reaction_voters.title')}
            </span>
          </div>
          {loading && (
            <ul className="flex animate-pulse flex-col gap-2 py-1">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                  <div className="h-[22px] w-[22px] rounded-full bg-bg-hover" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="h-2 w-3/4 rounded bg-bg-hover/80" />
                    <div className="h-1.5 w-1/2 rounded bg-bg-hover/60" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && error && (
            <div className="px-2 py-3 text-center text-[12px] text-danger">
              {t('reaction_voters.load_failed')}
            </div>
          )}
          {!loading && !error && voters.length === 0 && (
            <div className="px-2 py-3 text-center text-[12px] text-text-muted">
              {t('reaction_voters.empty')}
            </div>
          )}
          {!loading && !error && voters.length > 0 && (
            <ul className="flex flex-col">
              {voters.map((v) => {
                const u = users.find((x) => x.login === v.userLogin);
                const displayName = v.fullName || u?.fullName || v.userLogin;
                const initials = computeInitials(displayName);
                return (
                  <li
                    key={v.userLogin}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-bg-hover"
                  >
                    <Avatar
                      initials={initials}
                      size={22}
                      login={v.userLogin}
                      avatarUrl={u?.avatarUrl}
                      avatarBlobKey={u?.avatarBlobKey}
                      avatarBlobNonce={u?.avatarBlobNonce}
                    />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[12px] text-text-primary">
                        {displayName}
                      </span>
                      <span className="truncate text-[10.5px] text-text-muted">
                        {v.createdAt ? formatFullYek(v.createdAt) : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
