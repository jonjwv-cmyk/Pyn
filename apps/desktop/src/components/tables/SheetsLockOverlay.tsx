import { Trans, useTranslation } from 'react-i18next';
import type { SheetLock } from '@pyn/core';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { PynLoader } from '@/components/ui/PynLoader';
import { cn } from '@/lib/cn';
import { computeInitials } from '@/lib/initials';
import { usePresenceStore, useUsersStore } from '@/lib/stores';

/**
 * Полноэкранный overlay поверх Google Sheets webview, когда на текущем
 * листе запущен скрипт/макрос. Перекрывает клики (pointer-events:auto).
 *
 * §pyn-1.2.43 — переработан: показывает аватар инициатора + presence-dot
 * из единого `usePresenceStore` + имя + «запустил скрипт «X»». Никаких
 * заголовков/hint'ов — минимальный UX, юзер сразу видит КТО заблокировал
 * и ЧЕМ занят.
 */
export function SheetsLockOverlay({ lock }: { lock: SheetLock }): JSX.Element {
  const { t } = useTranslation();
  const userLogin = lock.userLogin || '';
  // §pyn-1.2.43 — presence из единого store (single source of truth).
  const presence = usePresenceStore((s) =>
    userLogin ? (s.byLogin[userLogin]?.status ?? 'offline') : 'offline',
  );
  // Avatar lookup: usersStore содержит UserSummary с blob params (только
  // для admin/dev). Если юзер не в кеше — fallback на initials.
  const user = useUsersStore((s) =>
    userLogin ? s.users.find((u) => u.login === userLogin) : undefined,
  );
  const initials = user?.initials || computeInitials(lock.userName || userLogin);

  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-0 z-30 flex items-center justify-center',
        'sheets-pattern-bg backdrop-blur-[2px]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <span className="relative shrink-0">
          <Avatar
            initials={initials}
            size={56}
            login={userLogin || undefined}
            avatarUrl={user?.avatarUrl}
            avatarBlobKey={user?.avatarBlobKey ?? undefined}
            avatarBlobNonce={user?.avatarBlobNonce ?? undefined}
          />
          <PresenceDot
            state={presence as 'online' | 'away' | 'offline'}
            size={14}
            ringClass="ring-bg-surface"
            className="absolute -bottom-0.5 -right-0.5"
          />
        </span>

        <div className="flex flex-col items-center gap-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.005em] text-text-strong">
            {lock.userName || userLogin || t('sheet_lock.user_fallback')}
          </h2>
          <p className="flex items-center gap-2 text-[13px] leading-relaxed text-text-secondary">
            <Trans
              i18nKey="sheet_lock.running"
              values={{ action: lock.actionLabel }}
              components={{ strong: <span className="font-medium text-text-strong" /> }}
            />
            {/* §pyn-1.2.54 — PynLoader inline после названия скрипта —
                визуальный indicator что macros выполняется. */}
            <PynLoader size="sm" />
          </p>
        </div>
      </div>
    </div>
  );
}
