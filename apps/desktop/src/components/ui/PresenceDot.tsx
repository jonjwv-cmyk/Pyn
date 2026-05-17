import { cn } from '@/lib/cn';
import type { PresenceState } from '@/types/presence';

interface PresenceDotProps {
  state: PresenceState;
  /** Диаметр в px. По умолчанию 10. */
  size?: number;
  /**
   * Tailwind-класс ring-цвета, под цвет фона за аватаром. Например:
   *   • 'ring-bg-surface' — sidebar и chat list
   *   • 'ring-bg-primary' — conversation area
   */
  ringClass: string;
  className?: string;
}

const COLOR_BY_STATE: Record<PresenceState, string> = {
  online: 'bg-presence-online',
  away: 'bg-presence-away',
  offline: 'bg-presence-offline',
};

/**
 * Маленький круглый индикатор присутствия. Позиционируется родителем
 * (обычно absolute bottom-0 right-0 поверх аватара). Цвет — от state,
 * ring отделяет от заднего фона.
 */
export function PresenceDot({ state, size = 10, ringClass, className }: PresenceDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full ring-2',
        COLOR_BY_STATE[state],
        ringClass,
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
