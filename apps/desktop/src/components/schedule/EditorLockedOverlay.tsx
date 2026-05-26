import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleLockOwner } from '@pyn/core';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { computeInitials } from '@/lib/initials';
import { useEditLock } from '@/lib/schedule/use-edit-lock';

/**
 * Overlay для collaboration lock. Рендерится ПОВЕРХ editor содержимого внутри
 * popover'а / dialog'а: backdrop-blur + центрированная карточка с аватаркой
 * и именем того, кто сейчас редактирует.
 *
 * §TZ-SERVER-SYNC-COLLAB §3.3. Используется в:
 *   • ExceptionsEditor / HolidaysCalendar / CommitButton popover
 *   • PersonEditor / DatePicker / MonthYearPicker
 *
 * Размер фиксированный для popover-контекста (340x280px). Для full-app
 * варианта (base update overlay в этапе E) будет отдельный компонент с
 * `fixed inset-0`.
 */
export function EditorLockedOverlay({
  owner,
  className,
  variant = 'popover',
}: {
  owner: ScheduleLockOwner;
  className?: string;
  /** popover = в Radix Popover.Content; full = на весь экран (этап E base update). */
  variant?: 'popover' | 'full';
}): JSX.Element {
  const { t } = useTranslation();
  const userName = owner.fullName || owner.userLogin || t('lock.user_fallback');
  const initials = computeInitials(userName);

  const containerCls =
    variant === 'full'
      ? 'fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-md bg-bg-deep/40'
      : 'absolute inset-0 z-30 flex items-center justify-center backdrop-blur-md bg-bg-deep/55 rounded-[inherit]';

  return (
    <div
      className={cn(containerCls, className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
        <Avatar
          initials={initials}
          size={variant === 'full' ? 96 : 64}
          login={owner.userLogin || undefined}
          avatarUrl={owner.avatarUrl || undefined}
          avatarBlobKey={owner.avatarBlobKey || undefined}
          avatarBlobNonce={owner.avatarBlobNonce || undefined}
        />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
            {userName}
          </h2>
          <p className="text-[12px] leading-snug text-text-secondary">
            {t('lock.editing_now', { user: userName })}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-text-muted">
            {t('lock.wait_until_done', { user: userName })}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapper для Popover.Content / dialog body. Acquire'ит lock на mount если
 * `active=true`, рендерит overlay если другой юзер уже захватил.
 *
 * Использование:
 * ```tsx
 * <Popover.Content>
 *   <LockedEditorContent resourceId="schedule:2026-05:exceptions" active={open}>
 *     <YourEditorContent />
 *   </LockedEditorContent>
 * </Popover.Content>
 * ```
 *
 * `resourceId === null` → wrapper прозрачен (no lock, for backward compat в
 * местах где collab lock пока не нужен).
 */
export function LockedEditorContent({
  resourceId,
  active,
  children,
  className,
}: {
  resourceId: string | null;
  active: boolean;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { ownedByOther } = useEditLock(resourceId ?? '', active && !!resourceId);
  if (!resourceId) return <>{children}</>;
  return (
    <div className={cn('relative', className)}>
      {children}
      {ownedByOther && <EditorLockedOverlay owner={ownedByOther} />}
    </div>
  );
}
