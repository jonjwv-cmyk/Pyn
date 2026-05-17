import { forwardRef } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import type { PresenceState } from '@/types/presence';

interface BottomUserRowProps {
  username: string;
  initials: string;
  /** Login юзера — для детерминированного цвета фона (если нет аватарки). */
  login?: string;
  /** Зашифрованный URL аватарки (если есть) — server отдаёт в `me()`. */
  avatarUrl?: string;
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
  collapsed: boolean;
  /** Состояние присутствия текущего пользователя — точка на аватаре. */
  presence: PresenceState;
  /** onClick / Radix prop forwarding (для open popup menu) */
  onClick?: () => void;
}

/**
 * Нижняя строка sidebar — аватар + имя пользователя.
 *
 *  • Hover подсвечивает всю строку как nav-item (bg-bg-hover, rounded-md).
 *  • При collapsed — только avatar (имя hide через max-width transition).
 *  • Имя может быть длинным → wrap в 2 строки (line-clamp-2). Если короткое —
 *    1 строка (Tailwind просто wrap'нет content, line-clamp-2 ограничит max).
 *
 * Компонент `forwardRef` чтобы Radix DropdownMenu.Trigger мог положить ref
 * на button (нужно для popover-anchoring).
 */
export const BottomUserRow = forwardRef<HTMLButtonElement, BottomUserRowProps>(
  function BottomUserRow(
    {
      username,
      initials,
      login,
      avatarUrl,
      avatarBlobKey,
      avatarBlobNonce,
      collapsed,
      presence,
      onClick,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5',
          'text-text-primary transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
          'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
        )}
        {...props}
      >
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
          <Avatar
            initials={initials}
            size={26}
            login={login}
            avatarUrl={avatarUrl}
            avatarBlobKey={avatarBlobKey}
            avatarBlobNonce={avatarBlobNonce}
          />
          <PresenceDot
            state={presence}
            size={9}
            ringClass="ring-bg-surface"
            className="absolute bottom-0 right-0"
          />
        </span>

        {/* Имя — плавно сворачивается при collapse */}
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center overflow-hidden',
            'transition-[max-width,opacity] duration-200',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
          )}
        >
          <span className="line-clamp-2 text-left text-[13px] font-medium leading-tight tracking-[-0.005em]">
            {username}
          </span>
        </span>
      </button>
    );
  },
);
