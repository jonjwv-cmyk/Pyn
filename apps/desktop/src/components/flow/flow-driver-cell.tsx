import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { Phone } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Ячейка ВОДИТЕЛЬ транспорта (юзер 2026-06-12, п.4+6): ФИО плашкой + СОТ ПОД ФИО
 * (не отдельной колонкой), как у МОЛ в формировании. Двойной клик → ПОИСК по базе
 * контактов (только должность «водитель»): набираешь → ФИО + ниже должность; выбрал →
 * телефон подтянулся. Снять (Delete) — чистит ФИО и телефон.
 */
export interface FlowDriverOption {
  readonly fio: string;
  readonly position: string;
  readonly phone: string; // сырой (для записи)
  readonly phoneDisplay: string; // форматированный (как в разделе МОЛ)
}
export interface FlowDriverData {
  readonly kind: 'flow-driver';
  readonly driver: string; // ФИО водителя строки
  readonly phone: string; // сырой телефон строки
  readonly phoneDisplay: string; // форматированный телефон строки
  readonly drivers: readonly FlowDriverOption[]; // кандидаты (должность «водитель»)
}
export type FlowDriverCell = CustomCell<FlowDriverData>;

/** Редактор: поиск по ФИО/должности среди водителей базы. Выбор → ФИО + телефон. */
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
    return base.slice(0, 30);
  }, [drivers, query]);

  const pick = (o: FlowDriverOption): void =>
    onFinishedEditing({
      ...cell,
      data: { ...cell.data, driver: o.fio, phone: o.phone, phoneDisplay: o.phoneDisplay },
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
            {query ? 'Не найдено среди водителей' : 'Нет водителей в базе контактов'}
          </div>
        ) : (
          matches.map((o, i) => {
            const selected = o.fio === driver;
            return (
              <button
                key={`${o.fio}-${i}`}
                type="button"
                onClick={() => pick(o)}
                className={cn(
                  'block w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
                  selected
                    ? 'border-accent-clay/40 bg-accent-clay/15'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                )}
              >
                {/* 1 — ФИО */}
                <span className="block text-[12px] font-medium leading-snug text-text-strong">{o.fio}</span>
                {/* 2 — должность + телефон */}
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted/70">
                  <span className="truncate">{o.position || 'водитель'}</span>
                  {o.phoneDisplay && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
                      <Phone size={10} strokeWidth={1.75} />
                      {o.phoneDisplay}
                    </span>
                  )}
                </span>
              </button>
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
    const { driver, phoneDisplay } = cell.data;
    const padX = theme.cellHorizontalPadding;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    const x = rect.x + padX;
    ctx.textBaseline = 'middle';
    if (driver) {
      // ФИО — плашкой (как МОЛ): верхняя строка ячейки.
      const yTop = rect.y + (phoneDisplay ? rect.height * 0.34 : rect.height / 2);
      ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
      const tw = ctx.measureText(driver).width;
      const padP = 7;
      const ph = 17;
      ctx.fillStyle = 'rgba(138,75,46,0.14)'; // лёгкая clay-плашка
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
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, driver: '', phone: '', phoneDisplay: '' } }),
  onPaste: (v, d) => ({ ...d, driver: v }),
};
