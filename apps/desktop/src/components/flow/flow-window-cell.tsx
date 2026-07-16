import {
  drawTextCell,
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';
import {
  DAY_LUNCH_END_MIN,
  DAY_LUNCH_START_MIN,
  DAY_SHIFT_END_MONTHU_MIN,
  DAY_SHIFT_START_MIN,
} from '@/lib/prod-calendar';
import { useFlipUpIfClipped } from './flow-cell-flip';

/**
 * Ячейка «Доставка» — окно ДНЕВНОЙ смены (юзер 2026-07-14). Не из САП.
 *
 * Смена: 08:30 → конец дневной смены (ПН-ЧТ 16:30 / ПТ 15:00), в предпраздничные
 * дни −1ч (15:30 / 14:00). Конец приходит per-row в `endMin` (из производственного
 * календаря по дате колонки ГРАФ); дефолт 16:30. Шаг 15 мин.
 * Константы смены/обеда — из prod-calendar (единый источник).
 *
 * Обед 12:00–12:45 «мёртвый»: ни начало, ни конец окна не могут лежать внутри
 * блока обеда — только ДО (≤11:45) или ПОСЛЕ (≥12:45). Окно на всю смену
 * спокойно ПЕРЕКРЫВАЕТ обед — запрет только на сами эндпоинты.
 *
 * Значение = «HH:MM–HH:MM». Пусто = стандартное окно всей смены (рисуется приглушённо).
 */
export interface FlowWindowData {
  readonly kind: 'flow-window';
  readonly value: string;
  /** Конец дневной смены (мин от полуночи) для даты этой строки. Дефолт 16:30. */
  readonly endMin?: number;
}
export type FlowWindowCell = CustomCell<FlowWindowData>;

const DAY_START = DAY_SHIFT_START_MIN; // 08:30
const DEFAULT_END = DAY_SHIFT_END_MONTHU_MIN; // 16:30 (ПН-ЧТ, если endMin не передан)
const STEP = 15;
const LUNCH_START = DAY_LUNCH_START_MIN; // 12:00
const LUNCH_END = DAY_LUNCH_END_MIN; // 12:45

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function parseWindow(value: string): { start: number | null; end: number | null } {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(value || '');
  if (!m) return { start: null, end: null };
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}
/** Эндпоинт лежит в блоке обеда [12:00, 12:45) — запрещён. 12:45 разрешён («после»). */
function inLunch(t: number): boolean {
  return t >= LUNCH_START && t < LUNCH_END;
}
/** Допустимые НАЧАЛА: 08:00..end−15 шаг 15, кроме блока обеда. */
function startOptions(endMin: number): number[] {
  const out: number[] = [];
  for (let t = DAY_START; t <= endMin - STEP; t += STEP) {
    if (inLunch(t)) continue;
    out.push(t);
  }
  return out;
}
/** Допустимые КОНЦЫ при заданном начале: (start+15)..end шаг 15, кроме блока обеда. */
function endOptions(start: number | null, endMin: number): number[] {
  const from = start == null ? DAY_START + STEP : start + STEP;
  const out: number[] = [];
  for (let t = from; t <= endMin; t += STEP) {
    if (inLunch(t)) continue;
    out.push(t);
  }
  return out;
}

function FlowWindowEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowWindowCell;
  onFinishedEditing: (newValue?: FlowWindowCell) => void;
}) {
  const endMin = cell.data.endMin ?? DEFAULT_END;
  const cur = parseWindow(cell.data.value);
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  const commit = (start: number, end: number): void =>
    onFinishedEditing({ ...cell, data: { ...cell.data, value: `${fmt(start)}–${fmt(end)}` } });
  const clear = (): void => onFinishedEditing({ ...cell, data: { ...cell.data, value: '' } });

  // Клик по началу — если конец несовместим, подбираем ближайший валидный.
  const pickStart = (s: number): void => {
    const ends = endOptions(s, endMin);
    const keep = cur.end != null && ends.includes(cur.end) ? cur.end : ends[ends.length - 1]!;
    commit(s, keep);
  };
  const pickEnd = (e: number): void => {
    const s =
      cur.start != null && startOptions(endMin).includes(cur.start) && e > cur.start
        ? cur.start
        : DAY_START;
    commit(s, e);
  };

  const starts = startOptions(endMin);
  const ends = endOptions(cur.start, endMin);
  const col = 'flex max-h-[300px] min-h-0 flex-1 flex-col overflow-y-auto';
  const item = (active: boolean) =>
    cn(
      'shrink-0 rounded px-2 py-1 text-center text-[12px] tabular-nums transition-colors',
      active ? 'bg-accent-clay/25 text-text-strong' : 'text-text-primary hover:bg-accent-clay/20',
    );
  return (
    <div ref={flipRef} className="flex w-52 flex-col text-text-secondary">
      <div className="flex gap-1">
        <div className={col}>
          <div className="sticky top-0 bg-[#302F2D] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Начало
          </div>
          {starts.map((s) => (
            <button type="button" key={s} onClick={() => pickStart(s)} className={item(s === cur.start)}>
              {fmt(s)}
            </button>
          ))}
        </div>
        <div className={col}>
          <div className="sticky top-0 bg-[#302F2D] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Конец
          </div>
          {ends.map((e) => (
            <button type="button" key={e} onClick={() => pickEnd(e)} className={item(e === cur.end)}>
              {fmt(e)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 shrink-0 rounded px-2 py-1 text-center text-[11px] text-text-muted transition-colors hover:bg-accent-clay/20"
      >
        вся смена (очистить)
      </button>
    </div>
  );
}

export const flowWindowRenderer: CustomRenderer<FlowWindowCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowWindowCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-window',
  draw: (args, cell) => {
    const v = cell.data.value;
    if (v) {
      drawTextCell(args, v, cell.contentAlign);
      return true;
    }
    // Пусто → стандартное окно всей смены, приглушённо (08:00–конец смены).
    const end = cell.data.endMin ?? DEFAULT_END;
    const def = `${fmt(DAY_START)}–${fmt(end)}`;
    drawTextCell(
      { ...args, theme: { ...args.theme, textDark: args.theme.textLight } },
      def,
      cell.contentAlign,
    );
    return true;
  },
  provideEditor: () => ({
    editor: FlowWindowEditor,
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
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
