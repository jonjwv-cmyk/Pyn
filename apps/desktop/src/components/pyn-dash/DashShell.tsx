import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type DashShellProps = {
  children: ReactNode;
  /** Stagger enter animation (Svelte-soft). Default true. */
  enter?: boolean;
  className?: string;
  'aria-label'?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>;

/**
 * Корневая сетка дашборда (1 → 2 → 4 кол.).
 * Кладём KPI / Panel / Header как прямых детей — span через className.
 */
export function DashShell({
  children,
  enter = true,
  className,
  'aria-label': ariaLabel = 'Дашборд',
  ...rest
}: DashShellProps): JSX.Element {
  return (
    <section
      className={cx('pyn-dash', 'pyn-dash-shell', className)}
      data-enter={enter ? 'true' : 'false'}
      aria-label={ariaLabel}
      {...rest}
    >
      {children}
    </section>
  );
}

export function DashSpanFull({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={cx('pyn-dash-span-full', className)}>{children}</div>;
}

export function DashSpanHalf({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={cx('pyn-dash-span-half', className)}>{children}</div>;
}
