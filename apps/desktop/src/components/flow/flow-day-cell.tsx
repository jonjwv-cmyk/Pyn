import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Ячейка DAY: метка `new` / `OFF` / дата доставки. Двойной клик → поповер с двумя
 * пунктами (новый / удалён) и календарём (на какое число планируется). Значение
 * пишется в `day_wk` ('new' = новый, 'OFF' = удалён, ISO-дата YYYY-MM-DD = доставка,
 * '' = без стадии/пусто); дата тянется копированием.
 */
export interface FlowDayData {
  readonly kind: 'flow-day';
  readonly value: string; // сырое: '' | 'OFF' | 'YYYY-MM-DD'
  readonly label: string; // показ: new / OFF / «5 июня»
  readonly color?: string; // точка статуса (OFF — красная)
}
export type FlowDayCell = CustomCell<FlowDayData>;

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/**
 * Редактор DAY: «Новый (new)» / «Удалён (off)» + календарь В СТИЛЕ ГРАФИКА (тот же
 * вид, что DatePicker раздела «Проба»): год (текущий+следующий) → месяц со стрелками
 * → сетка дней (ПН-первый, выходные clay, выбор — clay-ring). Хранит ISO YYYY-MM-DD.
 */
function FlowDayEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDayCell;
  onFinishedEditing: (next?: FlowDayCell) => void;
}) {
  const v = cell.data.value;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
  const set = (nv: string) => onFinishedEditing({ ...cell, data: { ...cell.data, value: nv } });

  const selY = iso ? Number(iso.slice(0, 4)) : null;
  const selM = iso ? Number(iso.slice(5, 7)) : null;
  const selD = iso ? Number(iso.slice(8, 10)) : null;

  const [view, setView] = useState(() => {
    if (iso) return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) };
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  });

  const years = useMemo(() => {
    const n = new Date().getFullYear();
    return [n, n + 1];
  }, []);

  const cells = useMemo(() => {
    const firstWd = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7;
    const dim = new Date(view.y, view.m, 0).getDate();
    const out: Array<{ day: number | null; weekend: boolean }> = [];
    for (let i = 0; i < firstWd; i++) out.push({ day: null, weekend: i >= 5 });
    for (let d = 1; d <= dim; d++) {
      const dow = (new Date(view.y, view.m - 1, d).getDay() + 6) % 7;
      out.push({ day: d, weekend: dow >= 5 });
    }
    while (out.length % 7 !== 0) {
      const dow = out.length % 7;
      out.push({ day: null, weekend: dow >= 5 });
    }
    return out;
  }, [view]);

  const prevMonth = () => setView((s) => (s.m === 1 ? { y: s.y - 1, m: 12 } : { ...s, m: s.m - 1 }));
  const nextMonth = () => setView((s) => (s.m === 12 ? { y: s.y + 1, m: 1 } : { ...s, m: s.m + 1 }));
  const pickDay = (d: number) =>
    set(`${view.y}-${String(view.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  return (
    <div className="flex w-[244px] flex-col gap-1 p-1 text-text-secondary">
      <button
        type="button"
        onClick={() => set('new')}
        className="rounded px-2 py-1 text-left text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15"
      >
        new
      </button>
      <button
        type="button"
        onClick={() => set('OFF')}
        className="rounded px-2 py-1 text-left text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15"
      >
        off
      </button>

      <div className="mt-1 border-t border-white/10 px-1 pt-1.5 text-[11px] text-text-muted/80">
        День доставки
      </div>
      {/* Год — текущий + следующий */}
      <div className="grid grid-cols-2 gap-1">
        {years.map((y) => {
          const selected = y === view.y;
          return (
            <button
              key={y}
              type="button"
              onClick={() => setView((s) => ({ ...s, y }))}
              className={[
                'h-7 rounded text-[12px] tabular-nums outline-none transition-colors',
                selected
                  ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                  : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
              ].join(' ')}
            >
              {y}
            </button>
          );
        })}
      </div>
      {/* Месяц со стрелками */}
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={prevMonth}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <div className="flex-1 text-center text-[12px] font-semibold tabular-nums text-text-strong">
          {MONTHS_RU[view.m - 1]}
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {/* Дни недели */}
      <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-medium uppercase tracking-wider text-text-muted">
        {WEEKDAYS_SHORT.map((wd, i) => (
          <div key={wd} className={i >= 5 ? 'text-accent-clay/70' : ''}>
            {wd}
          </div>
        ))}
      </div>
      {/* Сетка дней */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          if (c.day === null) return <div key={`e${i}`} className="h-7" />;
          const selected = selY === view.y && selM === view.m && selD === c.day;
          return (
            <button
              key={c.day}
              type="button"
              onClick={() => pickDay(c.day!)}
              className={[
                'flex h-7 items-center justify-center rounded text-[11.5px] tabular-nums outline-none transition-colors',
                selected
                  ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                  : c.weekend
                    ? 'text-accent-clay/80 hover:bg-white/[0.06] hover:text-accent-clay'
                    : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
              ].join(' ')}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const flowDayRenderer: CustomRenderer<FlowDayCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowDayCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-day',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { label, color } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    let x = rect.x + padX;
    if (color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 3.5, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      x += 13;
    }
    ctx.fillStyle = theme.textDark;
    ctx.fillText(label, x, cy);
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowDayEditor,
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
  // Delete стирает день (как в Excel) — потом снова выбрать двойным кликом.
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
