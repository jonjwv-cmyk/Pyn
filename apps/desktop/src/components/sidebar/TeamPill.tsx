import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { formatBandwidth, formatRtt, useConnectivity } from '@/lib/use-connectivity';
import { usePresenceStore, useUsersStore } from '@/lib/stores';
import type { Role, UserSummary } from '@pyn/core';

interface TeamPillProps {
  myLogin: string;
  myRole: Role;
  collapsed: boolean;
}

/**
 * Объединённый пилл «сеть + команда» в нижней части Sidebar (заменил отдельные
 * ConnectivityIndicator + TeamPill).
 *
 * Две ячейки: слева сеть (мс / скорость, без слова «Онлайн»), справа команда
 * («Команда» / N из M онлайн). Click → popover-список участников (аватар + имя +
 * presence/last_seen). Свёрнуто — 3 строки: мс / скорость / «Команда N/N». Без
 * рамки и без анимированного mark'а (по запросу — «не крутить, без обводки»).
 *
 * Источник presence — единый `usePresenceStore`; сеть — `useConnectivity`
 * (RTT через WS-ping, bandwidth — browser estimate). Фильтр команды: admin +
 * developer без текущего юзера.
 */
export function TeamPill({ myLogin, myRole, collapsed }: TeamPillProps): JSX.Element {
  const { t } = useTranslation();
  const users = useUsersStore((s) => s.users);

  // §pyn-1.2.43 — Source of truth presence: usePresenceStore.byLogin.
  // Selector возвращает stable Map-like объект (Zustand shallow compares).
  const presenceByLogin = usePresenceStore((s) => s.byLogin);

  // Сеть — левая ячейка пилла (мс + скорость), без слова «Онлайн».
  const { online, downlinkMbps, rttMs } = useConnectivity();
  const speed = formatBandwidth(downlinkMbps);
  const rtt = online ? formatRtt(rttMs) : null;
  const rttColor =
    rttMs === null || rttMs < 100
      ? 'text-text-muted'
      : rttMs < 300
        ? 'text-amber-400'
        : 'text-danger';

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
              // px-1.5 (6) + внешний wrapper px-1.5 (6) = content на линии 12,
              // как остальные элементы sidebar. Без border/обводки и без
              // анимированного mark'а (по запросу). h-10 — единая высота.
              'group flex h-10 w-full items-center rounded-md text-text-secondary',
              'bg-bg-elevated outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
              'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
              collapsed
                ? 'flex-col items-start justify-center gap-0 px-1.5 py-0.5'
                : 'gap-2 px-1.5 py-1',
            )}
            aria-label={t('team_pill.aria_open', { count: teammates.length })}
          >
            {collapsed ? (
              <>
                {/* Свёрнуто — 3 строки: мс (1), скорость (2), Команда N/N (3). */}
                <span
                  className={cn(
                    'whitespace-nowrap text-[9px] leading-[11px] tabular-nums',
                    online ? rttColor : 'text-danger',
                  )}
                >
                  {rtt ?? '—'}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-[9px] leading-[11px] tabular-nums',
                    online ? 'text-text-muted' : 'text-danger',
                  )}
                >
                  {speed ?? '—'}
                </span>
                <span className="whitespace-nowrap text-[9px] leading-[11px] tabular-nums text-text-muted">
                  {t('team_pill.cell_label')} {onlineCount}/{teammates.length}
                </span>
              </>
            ) : (
              <>
                {/* Левая ячейка — сеть: мс / скорость (без слова «Онлайн»). */}
                <span className="flex flex-col justify-center leading-tight tabular-nums">
                  <span className={cn('text-[11px]', online ? rttColor : 'text-danger')}>
                    {rtt ?? '—'}
                  </span>
                  <span className={cn('text-[10px]', online ? 'text-text-muted' : 'text-danger')}>
                    {speed ?? '—'}
                  </span>
                </span>
                {/* Правая ячейка — команда: «Команда» / N из M онлайн. */}
                <span className="ml-auto flex flex-col items-end justify-center border-l border-border-subtle/30 pl-2.5 leading-tight">
                  <span className="text-[10px] text-text-muted">{t('team_pill.cell_label')}</span>
                  <span className="text-[11.5px] font-medium tabular-nums text-text-strong">
                    {onlineCount}/{teammates.length}
                  </span>
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
