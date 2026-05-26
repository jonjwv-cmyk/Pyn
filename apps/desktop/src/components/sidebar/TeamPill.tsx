import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { usePresenceStore, useUsersStore } from '@/lib/stores';
import type { Role, UserSummary } from '@pyn/core';

interface TeamPillProps {
  myLogin: string;
  myRole: Role;
  collapsed: boolean;
}

/**
 * §pyn-1.2.43 — Team pill в нижней части Sidebar.
 *
 * Показывает других admin/developer (без меня) — кто из коллег сейчас работает
 * в Pyn. Компактный pill с overlapping avatars + click → popover со списком
 * (имя + presence dot + last_seen).
 *
 * Источник presence — единый `usePresenceStore` (обновляется через WS push
 * presence_change + heartbeat response + getUsers fetch). Status для self
 * исключён, поэтому конкуренции с BottomUserRow нет.
 *
 * Фильтр: admins + developer, исключая текущего юзера. Если список пуст
 * (один админ в системе) — pill не рендерится.
 *
 * В collapsed-режиме показываем только counter без аватаров; popover работает
 * на click (анchor — counter).
 */
export function TeamPill({ myLogin, myRole, collapsed }: TeamPillProps): JSX.Element | null {
  const { t } = useTranslation();
  const users = useUsersStore((s) => s.users);

  // §pyn-1.2.43 — Source of truth presence: usePresenceStore.byLogin.
  // Selector возвращает stable Map-like объект (Zustand shallow compares).
  // Если меняется один login — re-render только если он в нашем фильтре.
  const presenceByLogin = usePresenceStore((s) => s.byLogin);

  const teammates = useMemo(() => {
    const filtered = users
      .filter(
        (u) =>
          u.login !== myLogin &&
          (u.role === 'admin' || u.role === 'developer') &&
          u.isActive &&
          !u.isSuspended,
      )
      // Online сначала, потом away, потом offline. Внутри group — по name.
      .sort((a, b) => {
        const pa = presenceRank(presenceByLogin[a.login]?.status);
        const pb = presenceRank(presenceByLogin[b.login]?.status);
        if (pa !== pb) return pa - pb;
        return (a.fullName || a.login).localeCompare(b.fullName || b.login, 'ru');
      });
    return filtered;
  }, [users, myLogin, presenceByLogin]);

  // myRole не используется в текущей логике, но прокидываем — позже если
  // нужны role-specific фильтры (developer видит больше уровней).
  void myRole;

  // §pyn-1.2.43 — TeamPill отображается ВСЕГДА (даже когда teammates.length===0).
  // Юзер сказал «администраторы разработчики показываются всегда а не когда
  // есть». Пустое состояние с placeholder вместо аватаров.
  const onlineCount = teammates.filter(
    (u) => presenceByLogin[u.login]?.status === 'online',
  ).length;
  const isEmpty = teammates.length === 0;

  // §pyn-1.2.54 — controlled state + window blur listener (mirror UserPopupMenu).
  // Radix Popover не ловит outside-click из Google webview (другой document) —
  // юзер кликает в таблицу → focus уходит на guest process → window emit 'blur',
  // мы закрываем popover.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onBlur = (): void => setOpen(false);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [open]);

  return (
    <div className="px-1.5 pb-0.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              // §pyn-1.2.54 — pl-[5px] компенсирует border (1px) чтобы content
              // (mark, avatar stack) был на той же визуальной линии что и
              // avatar/Online text/nav icons (aside + 12px).
              // h-10 — единая высота с Update/Session/Connectivity, не скачет.
              'group flex h-10 w-full items-center gap-2 rounded-md py-1 pl-[5px] pr-2',
              'border border-border-subtle bg-bg-elevated text-text-secondary',
              'outline-none transition-colors',
              'hover:border-border-default hover:text-text-strong',
              'data-[state=open]:border-border-default data-[state=open]:text-text-strong',
            )}
            aria-label={t('team_pill.aria_open', { count: teammates.length })}
          >
            {/* §pyn-1.2.54 — collapsed: Pyn-mark логотип (вместо серой
                Users-иконки) + counter «N/M». Expanded: avatar stack +
                «N в сети» подпись. */}
            {collapsed ? (
              <>
                {/* §pyn-1.2.54 — Animated Pyn-mark в icon-box (28×28, justify-start)
                    чтобы выровнять mark с другими элементами sidebar (NavItem
                    icons, BottomUserRow avatar) по одной невидимой линии слева.
                    -ml-[4px] компенсирует встроенный offset stem-полоски внутри
                    team-mark CSS (left: 15.625% от 24px = 3.75px) — без этого
                    самая левая полоска визуально смещена на 4px от линии 12. */}
                <span className="-ml-[4px] flex h-7 w-7 shrink-0 items-center justify-start">
                  <div className="team-mark" aria-hidden>
                    <div className="team-mark-stem" />
                    <div className="team-mark-top-bow" />
                    <div className="team-mark-mid-bow" />
                  </div>
                </span>
                {!isEmpty && (
                  <span className="text-[10.5px] font-medium tabular-nums leading-none text-text-secondary">
                    {onlineCount}/{teammates.length}
                  </span>
                )}
              </>
            ) : isEmpty ? (
              <>
                <span
                  className={cn(
                    'flex h-[22px] w-[22px] shrink-0 items-center justify-center',
                    'rounded-full bg-bg-hover text-text-muted',
                  )}
                >
                  <Users className="h-3 w-3" strokeWidth={1.75} />
                </span>
                <span className="ml-auto flex shrink-0 items-baseline gap-1 text-[11.5px]">
                  <span className="text-text-muted">{t('team_pill.empty_label')}</span>
                </span>
              </>
            ) : (
              <>
                <AvatarStack
                  users={teammates}
                  presenceByLogin={presenceByLogin}
                  max={4}
                />
                <span className="ml-auto flex shrink-0 items-baseline gap-1 text-[11.5px]">
                  <span className="font-medium tabular-nums text-text-strong">{onlineCount}</span>
                  <span className="text-text-muted">{t('team_pill.online_suffix')}</span>
                </span>
              </>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={6}
            className={cn(
              'z-50 w-[260px] max-h-[420px] overflow-y-auto rounded-xl border border-border-default',
              'bg-bg-elevated p-1.5 shadow-xl',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            )}
          >
            <div className="mb-1 px-2 pt-1 pb-1 text-[10.5px] uppercase tracking-[0.06em] text-text-muted">
              {t('team_pill.popover_title', { count: teammates.length })}
            </div>
            {isEmpty ? (
              <p className="px-2 py-3 text-center text-[12px] italic text-text-muted">
                {t('team_pill.popover_empty')}
              </p>
            ) : (
              <div className="flex flex-col gap-px">
                {teammates.map((u) => (
                  <TeamRow
                    key={u.login}
                    user={u}
                    presence={presenceByLogin[u.login]}
                  />
                ))}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function presenceRank(status: string | undefined): number {
  if (status === 'online') return 0;
  if (status === 'away') return 1;
  return 2;
}

interface AvatarStackProps {
  users: UserSummary[];
  presenceByLogin: Record<string, { status: string; lastSeenAt: string } | undefined>;
  max: number;
}

function AvatarStack({ users, presenceByLogin, max }: AvatarStackProps): JSX.Element {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <div className="flex shrink-0 items-center">
      {visible.map((u, idx) => (
        <span
          key={u.login}
          className="relative inline-block"
          style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: visible.length - idx }}
        >
          <Avatar
            initials={u.initials}
            size={22}
            login={u.login}
            avatarUrl={u.avatarUrl}
            avatarBlobKey={u.avatarBlobKey ?? undefined}
            avatarBlobNonce={u.avatarBlobNonce ?? undefined}
            className="ring-2 ring-bg-elevated"
          />
          <PresenceDot
            state={
              (presenceByLogin[u.login]?.status as 'online' | 'away' | 'offline') ?? 'offline'
            }
            size={7}
            ringClass="ring-bg-elevated"
            className="absolute -bottom-0.5 -right-0.5"
          />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'relative inline-flex h-[22px] min-w-[22px] items-center justify-center',
            'rounded-full bg-bg-hover px-1.5 text-[10px] font-medium text-text-secondary',
            'ring-2 ring-bg-elevated',
          )}
          style={{ marginLeft: -8, zIndex: 0 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

interface TeamRowProps {
  user: UserSummary;
  presence: { status: string; lastSeenAt: string } | undefined;
}

function TeamRow({ user, presence }: TeamRowProps): JSX.Element {
  const { t } = useTranslation();
  const lastSeenLabel = useFormatYek(presence?.lastSeenAt);
  const status = presence?.status ?? 'offline';

  const statusLabel =
    status === 'online'
      ? t('team_pill.status_online')
      : status === 'away'
        ? t('team_pill.status_away')
        : lastSeenLabel || t('team_pill.status_offline');

  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <span className="relative shrink-0">
        <Avatar
          initials={user.initials}
          size={28}
          login={user.login}
          avatarUrl={user.avatarUrl}
          avatarBlobKey={user.avatarBlobKey ?? undefined}
          avatarBlobNonce={user.avatarBlobNonce ?? undefined}
        />
        <PresenceDot
          state={status as 'online' | 'away' | 'offline'}
          size={8}
          ringClass="ring-bg-elevated"
          className="absolute -bottom-0.5 -right-0.5"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12.5px] font-medium text-text-strong">
          {user.fullName || user.login}
        </span>
        <span className="truncate text-[11px] text-text-muted">{statusLabel}</span>
      </span>
    </div>
  );
}
