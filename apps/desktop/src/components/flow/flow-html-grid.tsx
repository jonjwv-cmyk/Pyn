import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/cn';

/** Колонка HTML-таблицы Потока (движок G4). */
export interface HtmlGridColumn {
  readonly id: string;
  readonly title: string;
  readonly width: number;
}

export interface FlowHtmlGridProps<TRow> {
  columns: readonly HtmlGridColumn[];
  rows: readonly TRow[];
  /** Фиксированная или переменная высота строки (px). */
  rowHeight: number | ((index: number) => number);
  /** Окно вне вьюпорта: ±N строк (ТЗ G4: ~100). */
  overscan?: number;
  getRowStyle?: (row: TRow, index: number) => CSSProperties | undefined;
  renderCell: (row: TRow, col: HtmlGridColumn, rowIndex: number, colIndex: number) => ReactNode;
  onCellDoubleClick?: (rowIndex: number, colIndex: number) => void;
  className?: string;
}

/**
 * HTML-движок таблицы с виртуализацией строк (G4 спайк).
 * Референс — MolTable.tsx; в DOM живёт только окно ±overscan строк.
 */
export function FlowHtmlGrid<TRow>({
  columns,
  rows,
  rowHeight,
  overscan = 100,
  getRowStyle,
  renderCell,
  onCellDoubleClick,
  className,
}: FlowHtmlGridProps<TRow>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (typeof rowHeight === 'function' ? rowHeight(i) : rowHeight),
    overscan,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className={cn('flow-html-grid h-full overflow-auto', className)}
    >
      <table
        className="table-fixed border-separate border-spacing-0 text-[12px]"
        style={{ width: totalWidth, minWidth: '100%' }}
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-[#FDFDFB] shadow-[0_1px_0_#E8E6E1]">
          <tr className="text-[10.5px] uppercase tracking-wider text-[#9C9892]">
            {columns.map((c) => (
              <th
                key={c.id}
                className="border-b border-[#E8E6E1] px-1.5 py-1 text-left font-semibold"
                style={{ width: c.width }}
              >
                <span className="block truncate">{c.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-[12px] text-[#9C9892]">
                Нет строк
              </td>
            </tr>
          )}
          {items.length > 0 && items[0]!.start > 0 && (
            <tr aria-hidden style={{ height: items[0]!.start }}>
              <td colSpan={columns.length} />
            </tr>
          )}
          {items.map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            const style = getRowStyle?.(row, vi.index);
            return (
              <tr
                key={vi.key}
                className="border-b border-[#F0EEEA]/80"
                style={{ height: vi.size, ...style }}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col.id}
                    className="overflow-hidden px-1.5 py-0.5 align-top text-[#3D3B36]"
                    style={{ width: col.width, maxWidth: col.width }}
                    onDoubleClick={() => onCellDoubleClick?.(vi.index, ci)}
                  >
                    <div className="min-w-0 truncate leading-[1.35]">
                      {renderCell(row, col, vi.index, ci)}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
          {items.length > 0 && (
            <tr aria-hidden style={{ height: virtualizer.getTotalSize() - (items[items.length - 1]!.start + items[items.length - 1]!.size) }}>
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}