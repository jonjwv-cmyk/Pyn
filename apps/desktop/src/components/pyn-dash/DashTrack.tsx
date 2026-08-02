import { cx } from './cx';

export type DashTrackTone = 'accent' | 'ok' | 'danger' | 'muted';

export function DashTrack({
  pct,
  tone = 'accent',
  size = 'md',
  className,
}: {
  /** 0–100 */
  pct: number;
  tone?: DashTrackTone;
  size?: 'md' | 'sm';
  className?: string;
}): JSX.Element {
  const w = Math.min(100, Math.max(0, pct));
  const shown = w <= 0 ? 0 : Math.max(3, w);
  return (
    <div className={cx('pyn-dash-track', size === 'sm' && 'pyn-dash-track--sm', className)}>
      <div
        className={cx(
          'pyn-dash-track-fill',
          tone === 'ok' && 'pyn-dash-track-fill--ok',
          tone === 'danger' && 'pyn-dash-track-fill--danger',
          tone === 'muted' && 'pyn-dash-track-fill--muted',
          tone === 'accent' && 'pyn-dash-track-fill--accent',
        )}
        style={{ width: `${shown}%` }}
      />
    </div>
  );
}

export function DashStatBar({
  name,
  count,
  pct,
  maxCount,
  tone = 'danger',
}: {
  name: string;
  count: number;
  /** Удельный вес от общего, % */
  pct: number;
  maxCount: number;
  tone?: DashTrackTone;
}): JSX.Element {
  // Полоска = доля от общего (pct), не от max — так вес читается честно
  const bar = Math.min(100, Math.max(0, pct));
  void maxCount;
  return (
    <div className="pyn-dash-stat">
      <div className="pyn-dash-stat-top">
        <span className="pyn-dash-stat-name">{name}</span>
        <span className="pyn-dash-stat-val">
          {count}
          <span> · {pct}%</span>
        </span>
      </div>
      <DashTrack pct={bar > 0 ? Math.max(3, bar) : 0} tone={tone} size="sm" />
    </div>
  );
}
