import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MOL_UNTIL_PILL_CLASS, molUntilStatus } from '@/lib/mol-format';
import { formatUntilDate } from './flow-sandbox.fixtures';

/**
 * Ячейка ВОДИТЕЛЬ транспорта (юзер 2026-06-12): ФИО плашкой ЦВЕТОМ СТАТУСА + СОТ
 * под ФИО, как у МОЛ в формировании. Двойной клик → ПОИСК по базе контактов (только
 * должность со словом «водитель»). Карточка варианта — как у МОЛ: ФИО (цвет статуса),
 * телефон + статус справа, пилюля МОЛ + «по дату» (если человек МОЛ), ниже должность.
 * Можно вписать ЛЮБОЕ ФИО руками (Enter / строка «Вписать»). Снять (Delete) — чистит оба.
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
  readonly drivers: readonly FlowDriverOption[]; // кандидаты (должность «водитель»)
}
export type FlowDriverCell = CustomCell<FlowDriverData>;

/** Редактор: поиск по ФИО/должности/сот среди водителей базы + «вписать любое». */
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
      data: { ...cell.data, driver: o.fio, phone: o.phone, phoneDisplay: o.phoneDisplay, color: o.color },
    });
  // «Вписать любое» — ФИО руками (без телефона/статуса).
  const pickCustom = (fio: string): void => {
    const v = fio.trim();
    if (!v) return;
    onFinishedEditing({ ...cell, data: { ...cell.data, driver: v, phone: '', phoneDisplay: '', color: '' } });
  };

  const exact = matches.some((m) => m.fio.toLowerCase() === query.trim().toLowerCase());

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
          if (e.key === 'Enter') {
            if (matches[0]) pick(matches[0]);
            else if (query.trim()) pickCustom(query);
          }
        }}
        className="mb-1 h-8 w-full rounded-md border border-white/[0.12] bg-white/[0.04] px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-clay/60"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-0.5 text-text-secondary">
        {/* «Вписать любое» — когда есть запрос без точного совпадения. */}
        {query.trim() && !exact && (
          <button
            type="button"
            onClick={() => pickCustom(query)}
            className="block w-full rounded-lg border border-dashed border-white/[0.14] px-2 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-accent-clay/10"
          >
            Вписать: <span className="font-medium text-text-strong">{query.trim()}</span>
          </button>
        )}
        {matches.length === 0 && !query.trim() ? (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Нет водителей в базе контактов</div>
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
                  {/* 1 — ФИО цветом статуса */}
                  <span className="text-[12px] font-medium leading-snug" style={{ color: o.color || undefined }}>
                    {o.fio}
                  </span>
                </button>
                {/* 2 — телефон (звонок) слева + статус справа (цвет статуса) */}
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
                {/* 3 — пилюля МОЛ + срок «по дату» (только если человек МОЛ) */}
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
                {/* 4 — должность */}
                {o.position && <div className="mt-0.5 text-[10.5px] text-text-muted/60">{o.position}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const flowDriverRenderer: CustomRenderer<FlowDriverCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowDriverCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-driver',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { driver, phoneDisplay, color } = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    const x = rect.x + padX;
    ctx.textBaseline = 'middle';
    if (driver) {
      // ФИО — плашкой ЦВЕТОМ СТАТУСА (как МОЛ): цвет@20% фон + тёмный текст.
      const yTop = rect.y + (phoneDisplay ? rect.height * 0.34 : rect.height / 2);
      ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
      const tw = ctx.measureText(driver).width;
      const padP = 7;
      const ph = 17;
      ctx.fillStyle = (color || '#9AA0A6') + '33';
      ctx.beginPath();
      ctx.roundRect(x, yTop - ph / 2, padP + tw + padP, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = theme.textDark;
      ctx.fillText(driver, x + padP, yTop);
      // СОТ — под ФИО, мельче и приглушённо.
      if (phoneDisplay) {
        ctx.font = `11px ${theme.fontFamily}`;
        ctx.fillStyle = theme.textMedium;
        ctx.fillText(phoneDisplay, x + padP, rect.y + rect.height * 0.74);
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
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, driver: '', phone: '', phoneDisplay: '', color: '' } }),
  onPaste: (v, d) => ({ ...d, driver: v }),
};
