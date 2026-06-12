import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';

/**
 * Ячейка «две строки в одной» (юзер 2026-06-12): сверху — главное (жирным, если boldTop),
 * снизу — второстепенное (мельче, приглушённо). Read-only показ. Используется для:
 *  • Гаражный № (жирный) + ГОС. № под ним;
 *  • МАРКА (сверху) + ЦВЕТ кузова под ней.
 */
export interface FlowStackData {
  readonly kind: 'flow-stack';
  readonly top: string;
  readonly bottom: string;
  readonly boldTop?: boolean;
}
export type FlowStackCell = CustomCell<FlowStackData>;

export const flowStackRenderer: CustomRenderer<FlowStackCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowStackCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-stack',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { top, bottom, boldTop } = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    const x = rect.x + padX;
    ctx.textBaseline = 'middle';
    if (top) {
      ctx.font = `${boldTop ? '600 ' : ''}${theme.baseFontStyle} ${theme.fontFamily}`;
      ctx.fillStyle = theme.textDark;
      ctx.fillText(top, x, rect.y + (bottom ? rect.height * 0.34 : rect.height / 2));
    }
    if (bottom) {
      ctx.font = `10.5px ${theme.fontFamily}`;
      ctx.fillStyle = theme.textMedium;
      ctx.fillText(bottom, x, rect.y + rect.height * 0.72);
    }
    ctx.restore();
    return true;
  },
};
