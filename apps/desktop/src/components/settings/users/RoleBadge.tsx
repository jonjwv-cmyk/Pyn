import type { Role } from '@pyn/core';
import { cn } from '@/lib/cn';

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

/**
 * Компактный «значок роли» рядом с именем юзера. Для `user` ничего не
 * рендерится (это базовая роль — не зашумлять). 1:1 с Android RoleBadge
 * `DEV` / `ADM` / `CLI` (см. UserManagementSupport.kt).
 */
export function RoleBadge({ role, className }: RoleBadgeProps): JSX.Element | null {
  const meta = ROLE_META[role];
  if (!meta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider',
        meta.bg,
        meta.text,
        meta.border,
        'border',
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

const ROLE_META: Partial<Record<Role, { label: string; bg: string; text: string; border: string }>> = {
  developer: {
    label: 'DEV',
    bg: 'bg-danger/15',
    text: 'text-danger',
    border: 'border-danger/40',
  },
  admin: {
    label: 'ADM',
    bg: 'bg-accent-clay-bg',
    text: 'text-accent-clay',
    border: 'border-accent-clay/40',
  },
  client: {
    label: 'CLI',
    bg: 'bg-bg-elevated',
    text: 'text-text-secondary',
    border: 'border-border-default',
  },
};

/**
 * Translation key для отображаемого имени роли. Применяется через
 * `t(roleDisplayKey(role))` на стороне consumer'a (для Change-role dialog'а
 * и UserListRow). Раньше функция возвращала RU-литералы; теперь возвращает
 * стабильный ключ, локализация в @pyn/core/i18n/locales/*.json :: roles.*.
 */
export function roleDisplayKey(role: Role): string {
  return `roles.${role}`;
}
