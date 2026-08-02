import type { ReactNode } from 'react';
import { cx } from './cx';

export type DashKpiTone = 'default' | 'accent' | 'ok' | 'danger';
export type DashKpiValueSize = 'md' | 'sm' | 'xs';

export type DashKpiProps = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  /** Border tone */
  tone?: DashKpiTone;
  /** Value color tone */
  valueTone?: DashKpiTone;
  valueSize?: DashKpiValueSize;
  className?: string;
};

/**
 * KPI-карточка: uppercase label · value · meta.
 * Hover lift + border (TW density + Svelte motion).
 */
export function DashKpi({
  label,
  value,
  meta,
  tone = 'default',
  valueTone = 'default',
  valueSize = 'md',
  className,
}: DashKpiProps): JSX.Element {
  return (
    <article
      className={cx(
        'pyn-dash-kpi',
        tone === 'accent' && 'pyn-dash-kpi--accent',
        tone === 'ok' && 'pyn-dash-kpi--ok',
        tone === 'danger' && 'pyn-dash-kpi--danger',
        className,
      )}
    >
      <div className="pyn-dash-kpi-label">{label}</div>
      <div
        className={cx(
          'pyn-dash-kpi-value',
          valueSize === 'sm' && 'pyn-dash-kpi-value--sm',
          valueSize === 'xs' && 'pyn-dash-kpi-value--xs',
          valueTone === 'accent' && 'pyn-dash-kpi-value--accent',
          valueTone === 'ok' && 'pyn-dash-kpi-value--ok',
          valueTone === 'danger' && 'pyn-dash-kpi-value--danger',
        )}
      >
        {value}
      </div>
      {meta != null && meta !== false ? <div className="pyn-dash-kpi-meta">{meta}</div> : null}
    </article>
  );
}

/** Цветная метка для meta (разница, доп. и т.п.). */
export function DashDelta({
  value,
  suffix = '',
  mode = 'auto',
}: {
  value: number;
  suffix?: string;
  /** auto: sign → color; up/down/flat force */
  mode?: 'auto' | 'up' | 'down' | 'flat';
}): JSX.Element {
  const kind =
    mode !== 'auto' ? mode : value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={kind === 'up' ? 'pd-up' : kind === 'down' ? 'pd-down' : 'pd-flat'}>
      {sign}
      {value}
      {suffix}
    </span>
  );
}
