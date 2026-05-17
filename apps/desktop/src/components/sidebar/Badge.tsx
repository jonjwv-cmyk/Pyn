import { cn } from '@/lib/cn';

interface BadgeProps {
  count: number;
  /** Если count > maxValue, показываем "{maxValue}+". По умолчанию 999. */
  max?: number;
  /** Variant — `inline` (рядом с label) или `corner` (overlay у иконки). */
  variant?: 'inline' | 'corner';
  className?: string;
}

/**
 * Счётчик-pill — компактный индикатор непрочитанных / новых элементов.
 *
 * Два варианта:
 *  • inline — рядом с label в expanded sidebar. Subtle accent-clay-bg tint.
 *  • corner — overlay у иконки в collapsed sidebar. Solid accent-clay
 *    с белым текстом для максимального контраста — чтобы был виден на любом
 *    фоне (active/hover/idle), не сливался с активной accent-clay иконкой.
 */
export function Badge({ count, max = 999, variant = 'inline', className }: BadgeProps) {
  if (count <= 0) return null;
  const display = count > max ? `${max}+` : String(count);

  const variantClasses =
    variant === 'corner'
      ? 'bg-accent-clay text-white shadow-[0_0_0_1.5px_var(--tw-bg-surface)]'
      : 'bg-accent-clay-bg text-text-strong';

  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill',
        'px-1.5 text-[11px] font-semibold tabular-nums leading-none',
        variantClasses,
        className,
      )}
      style={
        variant === 'corner'
          ? { boxShadow: '0 0 0 1.5px #1F1E1B' /* bg-surface ring для отделения от иконки */ }
          : undefined
      }
    >
      {display}
    </span>
  );
}
