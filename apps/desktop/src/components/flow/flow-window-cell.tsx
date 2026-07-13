import {
  drawTextCell,
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';
import { useFlipUpIfClipped } from './flow-cell-flip';

/**
 * Ячейка «Доставка» — наше окно времени (юзер 2026-07-12). Не из САП.
 * Правила: рабочий диапазон 08:30–19:30, шаг 30 мин; конец > начала (мин. окно 30 мин,
 * т.е. если конец 19:30 — начало максимум 19:00). Обед 12:00–12:30 — «мёртвый»:
 * начало ≠ 12:00, конец ∉ {12:00, 12:30}. Значение = «HH:MM–HH:MM» (пусто = вся смена).
 */
export interface FlowWindowData {
  readonly kind: 'flow-window';
  readonly value: string;
}
export type FlowWindowCell = CustomCell<FlowWindowData>;

const DAY_START = 8 * 60 + 30; // 08:30
const DAY_END = 19 * 60 + 30; // 19:30
const STEP = 30;
const LUNCH_START = 12 * 60; // 12:00
const LUNCH_END = 12 * 60 + 30; // 12:30

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
/** Допустимые НАЧАЛА: 08:30..19:00 шаг 30, кроме 12:00 (обед). */
function startOptions(): number[] {
  const out: number[] = [];
  for (let t = DAY_START; t <= DAY_END - STEP; t += STEP) {
    if (t === LUNCH_START) continue;
    out.push(t);
  }
  return out;
}
/** Допустимые КОНЦЫ при заданном начале: (start+30)..19:30 шаг 30, кроме 12:00 и 12:30. */
function endOptions(start: number | null): number[] {
  const from = start == null ? DAY_START + STEP : start + STEP;
  const out: number[] = [];
  for (let t = from; t <= DAY_END; t += STEP) {
    if (t === LUNCH_START || t === LUNCH_END) continue;
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
  const cur = parseWindow(cell.data.value);
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  const commit = (start: number, end: number): void =>
    onFinishedEditing({ ...cell, data: { ...cell.data, value: `${fmt(start)}–${fmt(end)}` } });
  const clear = (): void => onFinishedEditing({ ...cell, data: { ...cell.data, value: '' } });

  // Клик по началу — если конец несовместим, подбираем ближайший валидный.
  const pickStart = (s: number): void => {
    const ends = endOptions(s);
    const keep = cur.end != null && ends.includes(cur.end) ? cur.end : ends[0]!;
    commit(s, keep);
  };
  const pickEnd = (e: number): void => {
    const s = cur.start != null && startOptions().includes(cur.start) && e > cur.start ? cur.start : DAY_START;
    commit(s, e);
  };

  const starts = startOptions();
  const ends = endOptions(cur.start);
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
    drawTextCell(args, cell.data.value ?? '', cell.contentAlign);
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
