import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import type { FlowCardLine } from './flow-sandbox.fixtures';

/**
 * Ячейка MAT: ⚠ (если заказ не GROKHOVSKIJ = ручной) + название. Двойной клик →
 * карточка-оверлей со свёрнутыми полями (Создал/Выгружен/Вывезено%/тех-имя) —
 * как у МОЛ, только показ (read-only). Тех-имя переносится, шапка задаёт ширину.
 */
export interface FlowMatData {
  readonly kind: 'flow-mat';
  readonly name: string;
  readonly warn: boolean;
  readonly lines: readonly FlowCardLine[];
}
export type FlowMatCell = CustomCell<FlowMatData>;

function FlowMatEditor({ value: cell }: { value: FlowMatCell }) {
  const { lines } = cell.data;
  return (
    <div className="flex max-w-[320px] flex-col gap-0.5 p-1.5 text-[12px] leading-relaxed text-text-secondary">
      {lines.length === 0 && <div className="text-text-muted/70">Нет данных</div>}
      {lines.map((ln, i) => (
        <div
          key={i}
          className={`${ln.muted ? 'text-text-muted/80' : 'text-text-secondary'}${ln.nowrap ? ' whitespace-nowrap' : ''}`}
        >
          {ln.t}
        </div>
      ))}
    </div>
  );
}

export const flowMatRenderer: CustomRenderer<FlowMatCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowMatCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-mat',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { name, warn } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    let x = rect.x + padX;
    if (warn) {
      ctx.fillStyle = '#E3873A';
      ctx.fillText('⚠', x, cy);
      x += ctx.measureText('⚠').width + 4;
    }
    ctx.fillStyle = theme.textDark;
    ctx.fillText(name, x, cy);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowMatEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(217,119,87,0.40)',
      borderRadius: '12px',
      boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
      padding: '4px',
    },
  }),
};
