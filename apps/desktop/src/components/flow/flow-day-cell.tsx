import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';

/**
 * Ячейка DAY: метка `new` / `OFF` / дата доставки. Двойной клик → поповер с двумя
 * пунктами (новый / удалён) и календарём (на какое число планируется). Значение
 * пишется в `day_wk` ('' = новый, 'OFF', либо ISO-дата YYYY-MM-DD); дата тянется копированием.
 */
export interface FlowDayData {
  readonly kind: 'flow-day';
  readonly value: string; // сырое: '' | 'OFF' | 'YYYY-MM-DD'
  readonly label: string; // показ: new / OFF / «5 июня»
  readonly color?: string; // точка статуса (OFF — красная)
}
export type FlowDayCell = CustomCell<FlowDayData>;

function FlowDayEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDayCell;
  onFinishedEditing: (next?: FlowDayCell) => void;
}) {
  const v = cell.data.value;
  const isoDate = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
  const set = (nv: string) => onFinishedEditing({ ...cell, data: { ...cell.data, value: nv } });
  return (
    <div className="flex w-48 flex-col gap-1 p-1 text-text-secondary">
      <button
        type="button"
        onClick={() => set('')}
        className="rounded px-2 py-1 text-left text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15"
      >
        Новый заказ (new)
      </button>
      <button
        type="button"
        onClick={() => set('OFF')}
        className="rounded px-2 py-1 text-left text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15"
      >
        Удалён (off)
      </button>
      <label className="flex flex-col gap-0.5 border-t border-white/10 px-2 pb-1 pt-1.5 text-[11px] text-text-muted/80">
        День доставки
        <input
          type="date"
          value={isoDate}
          onChange={(e) => e.target.value && set(e.target.value)}
          className="rounded border border-white/15 bg-black/20 px-1.5 py-1 text-[12px] text-text-primary outline-none"
        />
      </label>
    </div>
  );
}

export const flowDayRenderer: CustomRenderer<FlowDayCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowDayCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-day',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { label, color } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    let x = rect.x + padX;
    if (color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 3.5, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      x += 13;
    }
    ctx.fillStyle = theme.textDark;
    ctx.fillText(label, x, cy);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowDayEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '4px',
    },
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
