import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import type { FlowCardLine } from './flow-sandbox.fixtures';
import { useFlipUpIfClipped } from './flow-cell-flip';

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
  // У нижнего края экрана карточка обрезалась (юзер 2026-07-04) — показываем ВЫШЕ ячейки.
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  return (
    <div ref={flipRef} className="flex max-h-[60vh] min-w-[280px] max-w-[70vw] flex-col gap-0.5 overflow-y-auto p-2 text-[12px] leading-relaxed text-text-secondary">
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
      // Восклицательный знак — ярко-жёлтый, во ВСЮ высоту ячейки (ручной заказ = приоритет).
      // Раньше был бледный полупрозрачный эмодзи ⚠ — еле читался.
      const top = rect.y + 2.5;
      const bot = rect.y + rect.height - 2.5;
      const stemW = Math.max(3, (bot - top) * 0.2);
      const dotR = stemW * 0.6;
      ctx.fillStyle = '#F5B301';
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.lineWidth = 0.75;
      // стебель
      ctx.beginPath();
      ctx.roundRect(x, top, stemW, bot - top - dotR * 2 - 1.5, stemW / 2);
      ctx.fill();
      ctx.stroke();
      // точка
      ctx.beginPath();
      ctx.arc(x + stemW / 2, bot - dotR, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      x += stemW + 7;
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
