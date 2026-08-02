import type { ReactNode } from 'react';
import { cx } from './cx';

export type DashPanelProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right side of head (legend, actions) */
  headRight?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  full?: boolean;
  half?: boolean;
  tightHead?: boolean;
};

/**
 * Панель-блок: chart / list / table / form.
 * head (title+sub | right) + body.
 */
export function DashPanel({
  title,
  subtitle,
  headRight,
  children,
  className,
  bodyClassName,
  full,
  half,
  tightHead,
}: DashPanelProps): JSX.Element {
  const hasHead = title != null || subtitle != null || headRight != null;
  return (
    <section
      className={cx(
        'pyn-dash-panel',
        full && 'pyn-dash-span-full',
        half && 'pyn-dash-span-half',
        className,
      )}
    >
      {hasHead ? (
        <div className={cx('pyn-dash-panel-head', tightHead && 'pyn-dash-panel-head--tight')}>
          <div className="min-w-0">
            {title != null ? <div className="pyn-dash-panel-title">{title}</div> : null}
            {subtitle != null ? <div className="pyn-dash-panel-sub">{subtitle}</div> : null}
          </div>
          {headRight}
        </div>
      ) : null}
      <div className={cx('pyn-dash-panel-body', bodyClassName)}>{children}</div>
    </section>
  );
}
