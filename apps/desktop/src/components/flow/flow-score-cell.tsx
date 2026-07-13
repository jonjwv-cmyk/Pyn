import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { useFlipUpIfClipped } from './flow-cell-flip';
import { levelFor, type EpsLevel } from './flow-eps';

/**
 * Ячейка «Балл» (EPS) для Потока. На canvas — жирный балл, цвет по уровню; клик
 * (двойной, как у выпадашек) открывает попап-обоснование: два блока друг под
 * другом — балльный (почему такой EPS) и «Маршрутизация · OR-Tools» (пока «— скоро»).
 * Редактор read-only: ничего не коммитит, просто показывает обоснование.
 */
export interface FlowScoreData {
  readonly kind: 'flow-score';
  readonly eps: number | null;
  readonly levelLabel: string;
  readonly whyHigh: readonly string[];
  readonly whyLow: readonly string[];
  readonly routeNote?: string;
}
export type FlowScoreCell = CustomCell<FlowScoreData>;

const LEVEL_COLOR: Record<EpsLevel, string> = {
  critical: '#B42318',
  high: '#B45309',
  mid: '#2D6FA8',
  low: '#5B6472',
};
function scoreColor(eps: number | null): string {
  return eps == null ? '#8C8983' : LEVEL_COLOR[levelFor(eps)];
}

function FlowScorePopup({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowScoreCell;
  onFinishedEditing: (newValue?: FlowScoreCell) => void;
}) {
  void onFinishedEditing; // read-only попап; закрытие делает Glide (клик вне / Escape)
  const { eps, levelLabel, whyHigh, whyLow, routeNote } = cell.data;
  const color = scoreColor(eps);
  const why = [...whyHigh.map((s) => `↑ ${s}`), ...whyLow.map((s) => `↓ ${s}`)];
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  return (
    <div ref={flipRef} className="w-72 text-text-secondary">
      <div className="px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[13px] font-bold tabular-nums"
            style={{ background: `${color}2a`, color }}
          >
            {eps ?? '—'}
          </span>
          <b className="text-text-strong">{levelLabel || 'балл'}</b>
        </div>
        <div className="text-[12px] leading-relaxed text-text-muted">
          {why.length ? why.map((w, i) => <div key={i}>{w}</div>) : '—'}
        </div>
      </div>
      <div className="border-t border-white/10 px-3 py-2.5">
        <div className="mb-1 text-[12px] font-semibold text-text-secondary">Маршрутизация</div>
        <div className="text-[12px] italic text-text-muted">{routeNote || '— скоро'}</div>
      </div>
    </div>
  );
}

export const flowScoreRenderer: CustomRenderer<FlowScoreCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowScoreCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-score',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { eps } = cell.data;
    const txt = eps == null ? '—' : String(Math.round(eps));
    ctx.save();
    ctx.font = `700 ${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.fillStyle = scoreColor(eps);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowScorePopup,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '0',
    },
  }),
};
