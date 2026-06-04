import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';

/**
 * Ячейка МОЛ: пилюля ФИО по статусу + выпадающий список молов склада-получателя
 * (TO) из РЕАЛЬНОЙ базы МОЛ (`useMolStore`). Открытие — двойной клик. Выбор меняет
 * МОЛ строки; телефон в опции → звонок через общий диалог (как в Цеха/МОЛ).
 */
export interface FlowMolOption {
  readonly fio: string;
  readonly color: string;
  readonly phone: string;
  readonly until: string;
}
export interface FlowMolData {
  readonly kind: 'flow-mol';
  readonly value: string; // сырое значение МОЛ строки
  readonly fio: string; // показываемое ФИО
  readonly color: string; // цвет статус-точки
  readonly options: readonly FlowMolOption[]; // молы склада TO
}
export type FlowMolCell = CustomCell<FlowMolData>;

/** Список молов: статус-точка + ФИО (+ срок) и ниже телефон-кнопка (звонок). */
function FlowMolEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowMolCell;
  onFinishedEditing: (next?: FlowMolCell) => void;
}) {
  const { options, value } = cell.data;
  return (
    <div className="flex max-h-72 w-full flex-col overflow-y-auto text-text-secondary">
      {options.length === 0 && (
        <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Нет молов для склада</div>
      )}
      {options.map((o, i) => {
        const selected = o.fio === value;
        return (
          <div
            key={`${o.fio}-${i}`}
            className={cn(
              'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 transition-colors',
              selected ? 'bg-accent-clay/25' : 'hover:bg-accent-clay/15',
            )}
          >
            <button
              type="button"
              onClick={() => onFinishedEditing({ ...cell, data: { ...cell.data, value: o.fio } })}
              className="flex items-center gap-1.5 text-left text-[12px] text-text-strong"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
              {o.fio}
              {o.until && <span className="text-[11px] font-normal text-text-muted/70">· до {o.until}</span>}
            </button>
            {o.phone && (
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('flow:contact', {
                      detail: { kind: 'call', target: o.phone, display: o.phone, contactName: o.fio },
                    }),
                  )
                }
                className="pl-3.5 text-left text-[11px] text-text-muted/70 transition-colors hover:text-accent-clay"
              >
                📞 {o.phone}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const flowMolRenderer: CustomRenderer<FlowMolCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowMolCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-mol',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { fio, color } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    const x = rect.x + padX;
    if (fio) {
      // Статус — ЦВЕТОМ пилюли (без отдельной точки): зелёная/красная/серая.
      const tw = ctx.measureText(fio).width;
      const padP = 7;
      const ph = Math.min(rect.height - 5, 17);
      const pw = padP + tw + padP;
      ctx.fillStyle = color + '33';
      ctx.beginPath();
      ctx.roundRect(x, cy - ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = theme.textDark;
      ctx.fillText(fio, x + padP, cy);
    }
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowMolEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '4px',
      minWidth: '240px',
    },
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
