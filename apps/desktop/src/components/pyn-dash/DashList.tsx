import type { ReactNode } from 'react';
import { cx } from './cx';

export function DashList({
  children,
  className,
  empty,
}: {
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
}): JSX.Element {
  const hasKids = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasKids && empty != null) {
    return <div className={cx('pyn-dash-empty', className)}>{empty}</div>;
  }
  if (!hasKids) {
    return <div className={cx('pyn-dash-empty', className)}>Нет данных</div>;
  }
  return <div className={cx('pyn-dash-list', className)}>{children}</div>;
}

export function DashRow({
  title,
  subtitle,
  side,
  track,
  className,
  leading,
  /** Перенос длинного title (ФИО и т.п.) */
  titleWrap,
  /** subtitle как flex-meta (телефон + бейдж) */
  subMeta,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  side?: ReactNode;
  track?: ReactNode;
  className?: string;
  leading?: ReactNode;
  titleWrap?: boolean;
  subMeta?: boolean;
}): JSX.Element {
  return (
    <div className={cx('pyn-dash-row', className)}>
      {leading}
      <div className="pyn-dash-row-main">
        <div className={cx('pyn-dash-row-title', titleWrap && 'pyn-dash-row-title--wrap')}>{title}</div>
        {subtitle != null ? (
          <div className={cx('pyn-dash-row-sub', subMeta && 'pyn-dash-row-sub--meta')}>{subtitle}</div>
        ) : null}
        {track}
      </div>
      {side != null ? <div className="pyn-dash-row-side">{side}</div> : null}
    </div>
  );
}

export function DashEmpty({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cx('pyn-dash-empty', className)}>{children}</div>;
}

export function DashMolBadge(): JSX.Element {
  return <span className="pyn-dash-mol">МОЛ</span>;
}
