import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatUntilDate } from './flow-sandbox.fixtures';

/**
 * Ячейка МОЛ: пилюля ФИО по статусу + выпадающий список молов склада-получателя
 * (TO) из РЕАЛЬНОЙ базы МОЛ (`useMolStore`). Открытие — двойной клик. Выбор меняет
 * МОЛ строки; телефон в опции → звонок через общий диалог (как в Цеха/МОЛ).
 */
export interface FlowMolOption {
  readonly fio: string;
  readonly color: string;
  readonly phone: string; // сырой (для tel:)
  readonly phoneDisplay: string; // форматированный (как в разделе МОЛ)
  readonly until: string;
  readonly status: string; // текст статуса из базы («работает» и т.п.)
}
export interface FlowMolData {
  readonly kind: 'flow-mol';
  readonly value: string; // сырое значение МОЛ строки
  readonly fio: string; // показываемое ФИО
  readonly color: string; // цвет статус-точки
  readonly options: readonly FlowMolOption[]; // молы склада TO
  readonly noMol?: boolean; // «Нет мола» — акцентная красная пилюля
}
export type FlowMolCell = CustomCell<FlowMolData>;

/**
 * Молы склада карточками БЕЗ поиска (юзер: список и так короткий, по алфавиту,
 * порядок как в МОЛ — зелёные → красные → серые; сортировка задаётся при сборке
 * опций). Карточка: ФИО цветом статуса, срок «по дату», телефон-кнопка + статус.
 */
function FlowMolEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowMolCell;
  onFinishedEditing: (next?: FlowMolCell) => void;
}) {
  const { options, value } = cell.data;

  return (
    <div className="flex max-h-80 w-64 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-0.5 text-text-secondary">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Нет молов для склада</div>
        ) : (
          options.map((o, i) => {
            const selected = o.fio === value;
            return (
              <div
                key={`${o.fio}-${i}`}
                className={cn(
                  'rounded-lg border px-2 py-1.5 transition-colors',
                  selected
                    ? 'border-accent-clay/40 bg-accent-clay/15'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                )}
              >
                <button
                  type="button"
                  onClick={() => onFinishedEditing({ ...cell, data: { ...cell.data, value: o.fio } })}
                  className="block w-full text-left"
                >
                  {/* 1 — ФИО */}
                  <span className="text-[12px] font-medium leading-snug" style={{ color: o.color }}>
                    {o.fio}
                  </span>
                  {/* 2 — срок «по дата» отдельной строкой (если задан) */}
                  {o.until && (
                    <span className="mt-0.5 block text-[11px] font-normal text-text-muted/70">
                      по {formatUntilDate(o.until)}
                    </span>
                  )}
                </button>
                {/* 3 — телефон (звонок) + статус ЦВЕТОМ (зел/красн/серый). Всё живое — из базы МОЛ. */}
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  {o.phone && (
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('flow:contact', {
                            detail: { kind: 'call', target: o.phone, display: o.phoneDisplay, contactName: o.fio },
                          }),
                        )
                      }
                      className="flex items-center gap-1 text-text-muted/70 transition-colors hover:text-accent-clay"
                    >
                      <Phone size={11} strokeWidth={1.75} />
                      {o.phoneDisplay}
                    </button>
                  )}
                  <span style={{ color: o.color }}>{o.status || '—'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
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
    const { fio, color, noMol } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // «Нет мола» — жирный тёмный текст в насыщенной красной пилюле (акцент).
    ctx.font = `${noMol ? '700 ' : ''}${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    const x = rect.x + padX;
    if (fio) {
      // Статус — ЦВЕТОМ пилюли (без отдельной точки): зелёная/красная/серая.
      const tw = ctx.measureText(fio).width;
      const padP = 7;
      const ph = Math.min(rect.height - 5, 17);
      const pw = padP + tw + padP;
      ctx.fillStyle = noMol ? 'rgba(220,38,38,0.26)' : color + '33';
      ctx.beginPath();
      ctx.roundRect(x, cy - ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = noMol ? '#6E120D' : theme.textDark;
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
  // Delete на ячейке стирает МОЛ (как в Excel) — потом снова выбрать двойным кликом.
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
