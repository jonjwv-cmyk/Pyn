import {
  drawTextCell,
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';

/**
 * Ячейка TO (склад-получатель): двойной клик → выпадашка складов ТОГО ЖЕ ЦЕХА на
 * замену (сверху — название цеха, снизу — список складов). Выбор другого склада
 * пишется в TO; авто-PR (исходный склад → PR) делает грид в applyEdits.
 */
export interface FlowToOption {
  readonly id: string;
  readonly desc: string;
}
export interface FlowToData {
  readonly kind: 'flow-to';
  readonly value: string;
  readonly shopName: string;
  readonly options: readonly FlowToOption[];
  /** Заголовок выпадашки (по умолчанию — имя цеха). Для FR — «Склад-отправитель». */
  readonly title?: string;
  /** Статус склада из базы (юзер 2026-07-02): «склада нет в SAP» / «склад удалён». */
  readonly statusNote?: string;
}
export type FlowToCell = CustomCell<FlowToData>;

function FlowToEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowToCell;
  onFinishedEditing: (next?: FlowToCell) => void;
}) {
  const { options, value, shopName, title, statusNote } = cell.data;
  return (
    <div className="max-h-72 w-56 overflow-y-auto text-text-secondary">
      {/* Шапка-цех закреплена (sticky) — прокручивается ТОЛЬКО список складов: один
          скроллер, без бессмысленной двойной прокрутки. Фон = фон контейнера оверлея. */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#302F2D] px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/80">
        {title || shopName || 'Цех не задан'}
      </div>
      {/* Склад строки не найден в базе / помечен удалённым — говорим прямо (юзер 2026-07-02). */}
      {statusNote && (
        <div className="border-b border-white/10 px-2 py-1.5 text-[11px] font-medium text-[#E5484D]">
          {statusNote}
        </div>
      )}
      <div className="p-1">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Нет складов цеха</div>
        )}
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onFinishedEditing({ ...cell, data: { ...cell.data, value: o.id } })}
              className={cn(
                'w-full rounded px-2 py-1 text-left text-[12px] tabular-nums transition-colors',
                selected ? 'bg-accent-clay/25 text-text-strong' : 'text-text-primary hover:bg-accent-clay/15',
              )}
            >
              {o.id}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const flowToRenderer: CustomRenderer<FlowToCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowToCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-to',
  draw: (args, cell) => {
    drawTextCell(args, cell.data.value ?? '', cell.contentAlign);
    return true;
  },
  provideEditor: () => ({
    editor: FlowToEditor,
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
  // Delete стирает склад-получатель (как в Excel) — потом снова выбрать двойным кликом.
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
