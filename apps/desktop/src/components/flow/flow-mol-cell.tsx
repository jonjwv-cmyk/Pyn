import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  MOL_UNTIL_PILL_CLASS,
  isMolAssignableUntil,
  isMolWasUntil,
  molUntilStatus,
} from '@/lib/mol-format';
import { formatUntilDate } from './flow-sandbox.fixtures';
import { useFlipUpIfClipped } from './flow-cell-flip';

/**
 * Ячейка МОЛ: пилюля ФИО по статусу + выпадающий список молов склада-получателя
 * (TO) из РЕАЛЬНОЙ базы МОЛ (`useMolStore`). Открытие — двойной клик. Выбор меняет
 * МОЛ строки; телефон в опции → звонок через общий диалог (как в Цеха/МОЛ).
 * Фантом «был» (склад без активного МОЛ) — только просмотр, выбрать нельзя.
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
  readonly phoneDisplay?: string; // телефон выбранного МОЛ — строкой ПОД ФИО (п.3)
  /** Статус склада из базы (юзер 2026-07-02): «склада нет в SAP» / «склад удалён» —
   *  РЯДОМ, ПОСЛЕ плашки/ФИО (не внутри) — сразу понятно, почему нет МОЛа. */
  readonly suffix?: string;
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
  // R3.2: выбранный МОЛ — ВВЕРХ списка при открытии.
  const ordered = [...options].sort((a, b) => (b.fio === value ? 1 : 0) - (a.fio === value ? 1 : 0));
  const flipRef = useFlipUpIfClipped<HTMLDivElement>(); // §9: не вылезать за низ экрана

  return (
    <div ref={flipRef} className="flex max-h-80 w-64 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-0.5 text-text-secondary">
        {ordered.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Нет молов для склада</div>
        ) : (
          ordered.map((o, i) => {
            const selected = o.fio === value;
            const isWas = isMolWasUntil(o.until);
            const canSelect = isMolAssignableUntil(o.until);
            return (
              <div
                key={`${o.fio}-${i}`}
                className={cn(
                  'rounded-lg border px-2 py-1.5 transition-colors',
                  isWas
                    ? 'border-white/[0.04] bg-white/[0.015] opacity-80'
                    : selected
                      ? 'border-accent-clay/40 bg-accent-clay/15'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                )}
              >
                <button
                  type="button"
                  disabled={!canSelect}
                  onClick={() => {
                    if (!canSelect) return;
                    onFinishedEditing({ ...cell, data: { ...cell.data, value: o.fio } });
                  }}
                  className={cn(
                    'block w-full text-left',
                    !canSelect && 'cursor-default',
                  )}
                  title={isWas ? 'ранее — только просмотр, выбрать нельзя' : undefined}
                >
                  {/* 1 — ФИО */}
                  <span
                    className={cn(
                      'text-[12px] font-medium leading-snug',
                      isWas && 'text-text-muted',
                    )}
                    style={isWas ? undefined : { color: o.color }}
                  >
                    {o.fio}
                  </span>
                  {/* 2 — срок «по дата» / фантом «ранее» (не выбирается). */}
                  {o.until && (
                    <span className="mt-1 block">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ring-1',
                          isWas
                            ? 'bg-text-muted/12 text-text-muted ring-border-default/60'
                            : MOL_UNTIL_PILL_CLASS[molUntilStatus(o.until)],
                        )}
                      >
                        {isWas ? 'ранее' : `по ${formatUntilDate(o.until)}`}
                      </span>
                    </span>
                  )}
                </button>
                {/* 3 — телефон (звонок) + статус. Фантом: телефон можно глянуть/позвонить. */}
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
                  <span style={isWas ? undefined : { color: o.color }} className={isWas ? 'text-text-muted' : undefined}>
                    {o.status || '—'}
                  </span>
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
    const { fio, color, noMol, phoneDisplay, suffix } = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    // «Нет мола» — жирный тёмный текст в насыщенной красной пилюле (акцент).
    ctx.font = `${noMol ? '700 ' : ''}${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    const x = rect.x + padX;
    // Телефон выбранного МОЛ — строкой ПОД ФИО (п.3, юзер 2026-06-14). Если телефона нет —
    // ФИО по центру (как было). С телефоном — ФИО выше, телефон ниже (как у экспедитора).
    const hasPhone = !noMol && !!phoneDisplay;
    const fioCy = hasPhone ? rect.y + rect.height * 0.34 : rect.y + rect.height / 2;
    let suffixX = x; // статус склада — РЯДОМ, ПОСЛЕ плашки/ФИО (юзер 2026-07-02)
    if (fio) {
      // Статус — ЦВЕТОМ пилюли (без отдельной точки): зелёная/красная/серая.
      const tw = ctx.measureText(fio).width;
      const padP = 7;
      const ph = Math.min(rect.height - 5, 17);
      const pw = padP + tw + padP;
      // Плотнее, чем '33': пилл читается и на заливке машины (юзер 2026-07-05).
      ctx.fillStyle = noMol ? 'rgba(220,38,38,0.26)' : color + '4D';
      ctx.beginPath();
      ctx.roundRect(x, fioCy - ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = noMol ? '#6E120D' : theme.textDark;
      ctx.fillText(fio, x + padP, fioCy);
      suffixX = x + pw + 6;
      if (hasPhone) {
        ctx.font = `600 9px ${theme.fontFamily}`;
        ctx.fillStyle = theme.textMedium;
        ctx.fillText(phoneDisplay as string, x + padP, rect.y + rect.height * 0.74, rect.width - padX * 2);
      }
    }
    if (suffix) {
      // «склада нет в SAP» / «склад удалён» — мелко, тёмно-красным, после плашки.
      ctx.font = `600 9px ${theme.fontFamily}`;
      ctx.fillStyle = '#B3261E';
      const maxW = rect.x + rect.width - padX - suffixX;
      if (maxW > 12) ctx.fillText(suffix, suffixX, fioCy, maxW);
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
  // Снять МОЛ можно ТОЛЬКО когда у склада несколько НАЗНАЧАЕМЫХ молов.
  // Фантомы «был» и «Нет мола» не считаются; единственного живого мола руками не убираем.
  onDelete: (cell) => {
    const assignable = cell.data.options.filter((o) => isMolAssignableUntil(o.until));
    return cell.data.noMol || assignable.length <= 1
      ? cell
      : { ...cell, data: { ...cell.data, value: '' } };
  },
  onPaste: (v, d) => ({ ...d, value: v }),
};
