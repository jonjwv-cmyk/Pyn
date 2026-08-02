import type { ReactNode } from 'react';
import { cx } from './cx';

export type DashHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Full-width in shell grid. Default true. */
  full?: boolean;
};

/** Заголовок периода / страницы: title · meta · actions. */
export function DashHeader({
  title,
  meta,
  actions,
  className,
  full = true,
}: DashHeaderProps): JSX.Element {
  return (
    <header className={cx('pyn-dash-header', full && 'pyn-dash-span-full', className)}>
      <h2 className="pyn-dash-header-title">{title}</h2>
      {meta != null && meta !== false ? <div className="pyn-dash-header-meta">{meta}</div> : null}
      {actions ? <div className="pyn-dash-header-actions">{actions}</div> : null}
    </header>
  );
}
