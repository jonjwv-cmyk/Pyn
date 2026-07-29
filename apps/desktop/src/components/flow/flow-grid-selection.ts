import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';

/**
 * «Клик/протяжка по колонке-маркеру → выделить ЦЕЛЫЕ строки» — как в Формировании
 * (юзер 2026-06-12 п.14). Колонка read-only (ДАТА / ИСТОРИЯ / МАРКА): клик — одна строка,
 * протяжка — диапазон. current сохраняем — иначе Glide при протяжке оставляет одну строку.
 *
 * Ctrl/Cmd+click (задача 3, юзер 2026-07-26): выделение не только сплошное — Glide копит
 * доп. прямоугольники в `current.rangeStack` (нужен `rangeSelect="multi-rect"`); собираем
 * строки из основного диапазона И из rangeStack (только по этой колонке-маркеру).
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
    // Основной диапазон + ctrl-накопленные прямоугольники той же колонки (несплошной выбор).
    for (const rg of [cur.range, ...cur.rangeStack]) {
      if (rg.x !== colIndex || rg.width !== 1) continue;
      for (let r = rg.y; r < rg.y + rg.height; r++) rows = rows.add(r);
    }
    return { columns: CompactSelection.empty(), rows, current: cur };
  }
  return null;
}

/** @deprecated Используйте colRowSelection(sel, 0) — alias для гридов с маркером в col 0. */
export function colZeroRowSelection(sel: GridSelection): GridSelection | null {
  return colRowSelection(sel, 0);
}
