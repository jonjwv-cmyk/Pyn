import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';

/**
 * «Клик/протяжка по колонке-маркеру → выделить ЦЕЛЫЕ строки» — как в Формировании
 * (юзер 2026-06-12 п.14). Колонка read-only (ДАТА / ИСТОРИЯ / МАРКА): клик — одна строка,
 * протяжка — диапазон. current сохраняем — иначе Glide при протяжке оставляет одну строку.
 *
 * Возвращает новый GridSelection со строками, либо null — если это не выделение по
 * указанной колонке (тогда вызывающий ставит sel как есть).
 */
export function colRowSelection(sel: GridSelection, colIndex: number): GridSelection | null {
  if (colIndex < 0) return null;
  const cur = sel.current;
  if (
    cur &&
    sel.columns.length === 0 &&
    sel.rows.length === 0 &&
    cur.range.x === colIndex &&
    cur.range.width === 1
  ) {
    let rows = CompactSelection.empty();
    for (let r = cur.range.y; r < cur.range.y + cur.range.height; r++) rows = rows.add(r);
    return { columns: CompactSelection.empty(), rows, current: cur };
  }
  return null;
}

/** @deprecated Используйте colRowSelection(sel, 0) — alias для гридов с маркером в col 0. */
export function colZeroRowSelection(sel: GridSelection): GridSelection | null {
  return colRowSelection(sel, 0);
}
