import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { flowOptionStyleCss, dayOptionTheme, DAY_NEW_COLOR, DAY_OFF_COLOR } from './flow-sandbox.fixtures';
import { useFlipUpIfClipped } from './flow-cell-flip';

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

  // Сегодня (полночь): прошлые даты выбирать НЕЛЬЗЯ — только сегодня и будущее.
  const today = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
  }, []);
  // Листать в прошлое нет смысла: «назад» доступно только если вид ПОЗЖЕ текущего месяца.
  const canPrev = view.y > today.y || (view.y === today.y && view.m > today.m);

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

  const flipRef = useFlipUpIfClipped<HTMLDivElement>(); // §9: календарь не вылезает за низ
  return (
    <div ref={flipRef} className="flex w-[244px] flex-col gap-1 p-1 text-text-secondary">
      {/* «new» ставить НЕЛЬЗЯ (авто-состояние по правилам). Можно только пометить заказ
          удалённым (off) или ОТМЕНИТЬ удаление (снять off). Дата доставки — из календаря. */}
      {v === 'OFF' ? (
        <button
          type="button"
          onClick={() => set('')}
          className="rounded px-2 py-1 text-left text-[12px] font-medium text-text-strong outline-none transition-colors hover:bg-accent-clay/15"
        >
          Отменить удаление
        </button>
      ) : (
        <button
          type="button"
          onClick={() => set('OFF')}
          style={flowOptionStyleCss(dayOptionTheme('OFF'))}
          className="rounded px-2 py-1 text-left text-[12px] font-medium outline-none transition-colors hover:ring-1 hover:ring-inset hover:ring-accent-clay/50"
        >
          off
        </button>
      )}

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
          onClick={() => canPrev && prevMonth()}
          disabled={!canPrev}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-muted"
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
          // Прошлые даты (раньше сегодня) — недоступны.
          const past =
            view.y < today.y ||
            (view.y === today.y && (view.m < today.m || (view.m === today.m && c.day < today.d)));
          return (
            <button
              key={c.day}
              type="button"
              disabled={past}
              onClick={() => !past && pickDay(c.day!)}
              className={[
                'flex h-7 items-center justify-center rounded text-[11.5px] tabular-nums outline-none transition-colors',
                past
                  ? 'cursor-not-allowed text-text-muted/25'
                  : selected
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
    const { value, label, color } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.textBaseline = 'middle';
    const x = rect.x + padX;
    // NEW / OFF — насыщенная пилюля (как «Нет МОЛа»): фон-тон + ЖИРНЫЙ текст
    // цветом пилюли. OFF (нет заказа) краснее и приоритетнее NEW. Свечение
    // строки NEW и красный фон OFF остаются — пилюля рисуется ДОПОЛНИТЕЛЬНО.
    const pill = value === 'new' ? DAY_NEW_COLOR : value === 'OFF' ? DAY_OFF_COLOR : null;
    if (pill && label) {
      // Кегль колонки идёт префиксом в baseFontStyle («600 8px») — для жирной
      // пилюли заменяем вес на 700, сохраняя размер.
      const sizePart = theme.baseFontStyle.replace(/^\s*\d+\s+/, '');
      ctx.font = `700 ${sizePart} ${theme.fontFamily}`;
      const tw = ctx.measureText(label).width;
      const padP = 6;
      const ph = Math.min(rect.height - 4, 18);
      const pw = padP + tw + padP;
      const py = cy - ph / 2;
      ctx.fillStyle = pill + '33'; // ~20% alpha — мягкая подложка
      ctx.beginPath();
      ctx.roundRect(x, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = pill;
      ctx.fillText(label, x + padP, cy);
      ctx.restore();
      return true;
    }
    // Дата доставки / пусто — как было: опц. статус-точка слева + метка.
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    let tx = x;
    if (color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tx + 3.5, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      tx += 13;
    }
    ctx.fillStyle = theme.textDark;
    ctx.fillText(label, tx, cy);
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
