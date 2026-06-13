import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';

/**
 * Ячейка-иконка ИСТОРИЯ транспорта (юзер 2026-06-12: «для истории другой значок»).
 * Раньше рисовался символ «⟲» — читался как «обновить». Теперь — иконка History
 * (часы со стрелкой назад, как lucide `History` в самой карточке истории): рисуется
 * векторно на canvas (Path2D из lucide), цветом приложения (clay), ярче на hover.
 * Двойной клик по ячейке открывает карточку истории машины за день (см. onCellActivated).
 */
export interface FlowHistoryData {
  readonly kind: 'flow-history';
}
export type FlowHistoryCell = CustomCell<FlowHistoryData>;

// lucide `history` (viewBox 0 0 24 24) — те же субпути, что у иконки в карточке.
const HISTORY_PATHS = [
  'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
  'M3 3v5h5',
  'M12 7v5l4 2',
].map((d) => new Path2D(d));

export const flowHistoryRenderer: CustomRenderer<FlowHistoryCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowHistoryCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-history',
  draw: (args) => {
    const { ctx, rect, hoverAmount } = args;
    const size = 14;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // clay приложения; на hover ярче (подсказка, что кликабельно).
    ctx.strokeStyle = `rgba(217,119,87,${(0.5 + 0.5 * (hoverAmount ?? 0)).toFixed(3)})`;
    for (const p of HISTORY_PATHS) ctx.stroke(p);
    ctx.restore();
    return true;
  },
};
