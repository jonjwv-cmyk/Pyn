import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MOL_UNTIL_PILL_CLASS, molUntilStatus } from '@/lib/mol-format';
import { formatUntilDate } from './flow-sandbox.fixtures';

/**
 * Ячейка ВОДИТЕЛЬ транспорта (юзер 2026-06-12): ФИО плашкой ЦВЕТОМ СТАТУСА + под ним
 * СОТ, а если человек МОЛ — пилюля «МОЛ» и «по дату» рядом с сотовым (видно и ПОСЛЕ
 * выбора, не только в списке). Двойной клик → ПОИСК по базе контактов (должность со
 * словом «водитель»). Выбор — ТОЛЬКО ИЗ БАЗЫ (своё личное вписать нельзя). Карточка
 * варианта — как у МОЛ: ФИО (цвет статуса), телефон + статус, пилюля МОЛ + «по дату»,
 * ниже должность. Снять (Delete) — чистит водителя и телефон.
 */
export interface FlowDriverOption {
  readonly fio: string;
  readonly position: string;
  readonly phone: string; // сырой (для записи)
  readonly phoneDisplay: string; // форматированный (как в разделе МОЛ)
  readonly status: string; // текст статуса из базы
  readonly color: string; // цвет статуса (зел/красн/серый)
  readonly isMol: boolean; // материально-ответственный
  readonly until: string; // срок «по дату» (ближайший склад), если МОЛ
}
export interface FlowDriverData {
  readonly kind: 'flow-driver';
  readonly driver: string; // ФИО водителя строки
  readonly phone: string; // сырой телефон строки
  readonly phoneDisplay: string; // форматированный телефон строки
  readonly color: string; // цвет плашки ФИО по статусу текущего водителя
  readonly isMol: boolean; // показать пилюлю «МОЛ» в ячейке
  readonly until: string; // срок «по дату» — пилюлей в ячейке (если есть)
  readonly drivers: readonly FlowDriverOption[]; // кандидаты (должность «водитель»)
}
export type FlowDriverCell = CustomCell<FlowDriverData>;

/** Редактор: поиск по ФИО/должности/сот среди водителей базы. Выбор ТОЛЬКО из базы. */
function FlowDriverEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDriverCell;
  onFinishedEditing: (next?: FlowDriverCell) => void;
}) {
  const { drivers, driver } = cell.data;
  const [query, setQuery] = useState('');

  const matches = useMemo<readonly FlowDriverOption[]>(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const base = q
      ? drivers.filter((d) => {
          const byFio = d.fio.toLowerCase().includes(q);
          const byPos = d.position.toLowerCase().includes(q);
          const byPhone = digits.length >= 3 && d.phone.replace(/\D/g, '').includes(digits);
          return byFio || byPos || byPhone;
        })
      : drivers;
    return base.slice(0, 40);
  }, [drivers, query]);

  const pick = (o: FlowDriverOption): void =>
    onFinishedEditing({
      ...cell,
      data: {
        ...cell.data,
        driver: o.fio,
        phone: o.phone,
        phoneDisplay: o.phoneDisplay,
        color: o.color,
        isMol: o.isMol,
        until: o.until,
      },
    });

  return (
    <div className="flex max-h-80 w-72 flex-col">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        spellCheck={false}
        placeholder="Поиск водителя: ФИО / должность / сот."
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) pick(matches[0]);
        }}
        className="mb-1 h-8 w-full rounded-md border border-white/[0.12] bg-white/[0.04] px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-clay/60"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-0.5 text-text-secondary">
        {matches.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">
            {query ? 'Не найдено среди водителей базы' : 'Нет водителей в базе контактов'}
          </div>
        ) : (
          matches.map((o, i) => {
            const selected = o.fio === driver;
            return (
              <div
                key={`${o.fio}-${i}`}
                className={cn(
                  'rounded-lg border px-2 py-1.5 transition-colors',
                  selected ? 'border-accent-clay/40 bg-accent-clay/15' : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                )}
              >
                <button type="button" onClick={() => pick(o)} className="block w-full text-left">
                  <span className="text-[12px] font-medium leading-snug" style={{ color: o.color || undefined }}>
                    {o.fio}
                  </span>
                </button>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  {o.phoneDisplay && (
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
                  {o.status && (
                    <span className="ml-auto" style={{ color: o.color || undefined }}>
                      {o.status}
                    </span>
                  )}
                </div>
                {o.isMol && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center rounded-md bg-accent-clay/20 px-1.5 py-0.5 text-[10.5px] font-medium text-accent-clay ring-1 ring-accent-clay/30">
                      МОЛ
                    </span>
                    {o.until && (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ring-1',
                          MOL_UNTIL_PILL_CLASS[molUntilStatus(o.until)],
                        )}
                      >
                        по {formatUntilDate(o.until)}
                      </span>
                    )}
                  </div>
                )}
                {o.position && <div className="mt-0.5 text-[10.5px] text-text-muted/60">{o.position}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Рисует пилюлю на canvas (текст уже измеряется текущим шрифтом). Возвращает X после пилюли. */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg: string,
): number {
  const tw = ctx.measureText(text).width;
  const padP = 4;
  const h = 13;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, padP + tw + padP, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + padP, y);
  return x + padP + tw + padP + 4;
}

/** Цвета пилюли срока «по дату» для canvas (по статусу близости дедлайна). */
function untilPillColors(until: string): [string, string] {
  const st = molUntilStatus(until);
  if (st === 'expired') return ['rgba(192,57,43,0.18)', '#A02919'];
  if (st === 'soon') return ['rgba(176,120,20,0.22)', '#6E4E00'];
  return ['rgba(217,119,87,0.16)', '#8A4B2E'];
}

export const flowDriverRenderer: CustomRenderer<FlowDriverCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowDriverCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-driver',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { driver, phoneDisplay, color, isMol, until } = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    const x0 = rect.x + padX;
    ctx.textBaseline = 'middle';
    if (driver) {
      // ФИО — плашкой ЦВЕТОМ СТАТУСА (10px, как стандарт формирования).
      const yTop = rect.y + rect.height * 0.32;
      ctx.font = `10px ${theme.fontFamily}`;
      const tw = ctx.measureText(driver).width;
      const padP = 6;
      const ph = 15;
      ctx.fillStyle = (color || '#9AA0A6') + '33';
      ctx.beginPath();
      ctx.roundRect(x0, yTop - ph / 2, padP + tw + padP, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = theme.textDark;
      ctx.fillText(driver, x0 + padP, yTop);
      // Нижняя строка: СОТ — РОВНО ПОД ФИО (отступ x0+padP = начало текста ФИО внутри
      // плашки, а не её левый край) и ЖИРНЫМ (юзер 2026-06-12). Пилюли МОЛ/«по дату» — мельче.
      const yB = rect.y + rect.height * 0.72;
      let x = x0 + padP;
      if (phoneDisplay) {
        ctx.font = `600 9px ${theme.fontFamily}`;
        ctx.fillStyle = theme.textMedium;
        ctx.fillText(phoneDisplay, x, yB);
        x += ctx.measureText(phoneDisplay).width + 6;
      }
      ctx.font = `8px ${theme.fontFamily}`;
      if (isMol) {
        x = drawPill(ctx, x, yB, 'МОЛ', 'rgba(217,119,87,0.20)', '#8A4B2E');
        if (until) {
          const [bg, fg] = untilPillColors(until);
          drawPill(ctx, x, yB, `по ${formatUntilDate(until)}`, bg, fg);
        }
      }
    }
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowDriverEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '6px',
      minWidth: '260px',
    },
  }),
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, driver: '', phone: '', phoneDisplay: '', color: '', isMol: false, until: '' } }),
  onPaste: (v, d) => ({ ...d, driver: v }),
};
