import type { ReactNode } from 'react';
import { cx } from './cx';

export function DashLegend({
  children,
  className,
  'aria-label': ariaLabel = 'Легенда',
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <div className={cx('pyn-dash-legend', className)} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function DashLegLine({
  kind = 'plan',
  children,
}: {
  kind?: 'plan' | 'fact';
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="pyn-dash-leg">
      <span
        className={cx(
          'pyn-dash-leg-line',
          kind === 'plan' && 'pyn-dash-leg-line--plan',
          kind === 'fact' && 'pyn-dash-leg-line--fact',
        )}
      />
      {children}
    </span>
  );
}

export function DashLegDot({
  kind = 'match',
  children,
}: {
  kind?: 'match' | 'over';
  children: ReactNode;
}): JSX.Element {
  return (
    <span className="pyn-dash-leg">
      <span
        className={cx(
          'pyn-dash-leg-dot',
          kind === 'match' && 'pyn-dash-leg-dot--match',
          kind === 'over' && 'pyn-dash-leg-dot--over',
        )}
      />
      {children}
    </span>
  );
}

export function DashLegSep(): JSX.Element {
  return <span className="pyn-dash-leg-sep" aria-hidden />;
}
