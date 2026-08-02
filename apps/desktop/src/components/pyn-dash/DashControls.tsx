import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export function DashSegment({
  children,
  className,
  scroll,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <div
      className={cx('pyn-dash-seg', scroll && 'pyn-dash-seg--scroll', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function DashSegBtn({
  active,
  children,
  className,
  ...rest
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active ? true : false}
      data-active={active ? 'true' : 'false'}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

export function DashChip({
  active,
  children,
  className,
  ...rest
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className={cx('pyn-dash-chip', className)}
      data-active={active ? 'true' : 'false'}
      {...rest}
    >
      {children}
    </button>
  );
}
