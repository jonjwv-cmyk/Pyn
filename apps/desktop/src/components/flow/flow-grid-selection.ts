import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';

/**
 * «Клик/протяжка по ПЕРВОЙ колонке → выделить ЦЕЛЫЕ строки» — как в Формировании
 * (юзер 2026-06-12 п.14). Первая колонка во всех гридах потока read-only (ДАТА/МАРКА),
 * поэтому выделение в ней (x===0, width===1) трактуем как выбор строк: клик — одна,
 * протяжка/Shift — диапазон. Дальше Delete/массовая отметка работают по selection.rows.
 *
 * Возвращает новый GridSelection со строками, либо null — если это не выделение по
 * первой колонке (тогда вызывающий ставит sel как есть).
 */
export function colZeroRowSelection(sel: GridSelection): GridSelection | null {
  const cur = sel.current;
  if (
    cur &&
    sel.columns.length === 0 &&
    sel.rows.length === 0 &&
    cur.range.x === 0 &&
    cur.range.width === 1
  ) {
    let rows = CompactSelection.empty();
    for (let r = cur.range.y; r < cur.range.y + cur.range.height; r++) rows = rows.add(r);
    return { columns: CompactSelection.empty(), rows, current: undefined };
  }
  return null;
}
