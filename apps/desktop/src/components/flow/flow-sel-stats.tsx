// ============================================================
// flow-sel-stats.tsx — нижняя панель агрегатов выделения (кол-во / сумма / среднее /
// мин / макс по ЕИ + транспортная норма). Общий движок для Формирования и План/Отчёта
// (задача 21, юзер 2026-07-28). Компонент — маленький подписчик LiveValue<GridSelection>:
// протяжка мыши пересчитывает ТОЛЬКО его, не монолит-лист.
// ============================================================
// Обобщён через аксессоры: вызывающий грид сам говорит, как прочитать число+ЕИ у ячейки
// и данные строки для нормы — модель строк/колонок у гридов разная (Формирование /
// План-Отчёт), а логика агрегатов одна.
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { type GridSelection } from '@glideapps/glide-data-grid';
import { useLiveValue, type LiveValue } from './flow-live-value';

const STAT_CAP = 50_000;
/** Толеранс транспортной нормы: недобор снимается при Σ×1.5 ≥ MIN QTY (≈66.7%). */
const MIN_QTY_TOLERANCE = 1.5;
/** ЕИ, которые форматируем как измеримые (тонны/объём — до 3 знаков). Иначе — целые (штуки). */
const MEASURE_UNITS = new Set(['КГ', 'Т', 'Г', 'Л', 'М', 'М2', 'М3', 'М³', 'ПМ', 'КМ', 'ММ', 'СМ', 'ГА']);

export function fmtStatNum(n: number, unit: string): string {
  if (!MEASURE_UNITS.has(unit.trim().toUpperCase())) return Math.round(n).toLocaleString('ru-RU');
  const r = Math.round(n * 1000) / 1000;
  const hasFrac = Math.abs(r - Math.round(r)) > 1e-9;
  return r.toLocaleString(
    'ru-RU',
    hasFrac ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : { maximumFractionDigits: 0 },
  );
}

export interface FlowUnitStat {
  unit: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/** Число+ЕИ ячейки [col,row] для агрегатов, либо null (не числовая ячейка). */
export type NumCellAt = (col: number, row: number) => { value: number; unit: string } | null;
/** Данные строки для транспортной нормы (Σ по одной номенклатуре в одной связке fr|to). */
export type NormRowAt = (row: number) => { qty: number; groupKey: string; noKey: string; uom: string } | null;

/** Агрегаты выделения по ЕИ (кол-во ячеек + Σ/среднее/мин/макс числовых). */
export function buildSelStats(
  selection: GridSelection,
  rowCount: number,
  colCount: number,
  numAt: NumCellAt,
): { count: number; units: FlowUnitStat[] } | null {
  const cur = selection.current;
  let count = 0;
  if (cur) {
    count = cur.range.width * cur.range.height;
    for (const r of cur.rangeStack) count += r.width * r.height;
  } else if (selection.columns.length > 0) {
    count = selection.columns.length * rowCount;
  } else if (selection.rows.length > 0) {
    count = selection.rows.length * colCount;
  }
  if (count === 0) return null;

  const byUnit = new Map<string, { count: number; sum: number; min: number; max: number }>();
  if (count <= STAT_CAP) {
    const add = (c: number, r: number): void => {
      const cell = numAt(c, r);
      if (!cell || !Number.isFinite(cell.value)) return;
      const unit = cell.unit || '—';
      let g = byUnit.get(unit);
      if (!g) {
        g = { count: 0, sum: 0, min: Infinity, max: -Infinity };
        byUnit.set(unit, g);
      }
      g.count++;
      g.sum += cell.value;
      if (cell.value < g.min) g.min = cell.value;
      if (cell.value > g.max) g.max = cell.value;
    };
    if (cur) {
      for (const rect of [cur.range, ...cur.rangeStack]) {
        for (let r = rect.y; r < rect.y + rect.height; r++) {
          for (let c = rect.x; c < rect.x + rect.width; c++) add(c, r);
        }
      }
    } else if (selection.columns.length > 0) {
      for (const c of selection.columns) for (let r = 0; r < rowCount; r++) add(c, r);
    } else if (selection.rows.length > 0) {
      for (const r of selection.rows) for (let c = 0; c < colCount; c++) add(c, r);
    }
  }
  const units = [...byUnit.entries()]
    .map(([unit, g]) => ({ unit, count: g.count, sum: g.sum, avg: g.sum / g.count, min: g.min, max: g.max }))
    .sort((a, b) => b.count - a.count);
  return { count, units };
}

/** Транспортная норма выделения: ячейки QTY строк ОДНОЙ номенклатуры в ОДНОЙ связке
 *  отправитель+получатель → сколько НЕ ХВАТАЕТ до нормы (просто и с толерансом). */
export function buildSelNorm(
  selection: GridSelection,
  qtyCol: number,
  rowAt: NormRowAt,
  minQtyOf: (noKey: string) => number | null,
): { uom: string; minQty: number; needPlain: number; needTol: number } | null {
  if (qtyCol < 0) return null;
  const rowsSet = new Set<number>();
  const cur = selection.current;
  if (cur) {
    for (const rect of [cur.range, ...cur.rangeStack]) {
      if (qtyCol < rect.x || qtyCol >= rect.x + rect.width) continue;
      for (let r = rect.y; r < rect.y + rect.height; r++) rowsSet.add(r);
    }
  }
  // Выделение целыми строками (План/Отчёт: клик по колонке-маркеру) — колонка QTY входит.
  for (const r of selection.rows) rowsSet.add(r);
  if (rowsSet.size === 0) return null;

  let group = '', noKey = '', uom = '', sum = 0, n = 0;
  for (const r of rowsSet) {
    const d = rowAt(r);
    if (!d || !Number.isFinite(d.qty)) continue;
    if (n === 0) {
      group = d.groupKey;
      noKey = d.noKey;
      uom = d.uom;
    } else if (d.groupKey !== group || d.noKey !== noKey) {
      return null; // разные связки/номенклатуры — норма не применима
    }
    sum += d.qty;
    n++;
  }
  if (n === 0 || !noKey) return null;
  const minQty = minQtyOf(noKey);
  if (minQty == null || !Number.isFinite(minQty)) return null;
  return {
    uom: uom || '—',
    minQty,
    needPlain: Math.max(0, minQty - sum),
    needTol: Math.max(0, minQty / MIN_QTY_TOLERANCE - sum),
  };
}

/** Один агрегат (подпись + число) на светлом листе. */
function FlowStat({ label, value, unit }: { label: string; value: number; unit: string }): JSX.Element {
  return (
    <span>
      {label}: <span className="tabular-nums text-[#2A2925]">{fmtStatNum(value, unit)}</span>
    </span>
  );
}

/** Несколько ЕИ в выделении → раскрытие с табличкой агрегатов по каждой ЕИ. */
function FlowUnitStatsPopover({ units }: { units: FlowUnitStat[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[12px] text-[#2A2925] outline-none transition-colors hover:border-black/30 data-[state=open]:border-black/30"
        >
          Итоги по ЕИ: {units.length}
          <ChevronDown size={12} strokeWidth={1.75} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-30 overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
          <table className="text-[12px] tabular-nums">
            <thead>
              <tr className="text-[11px] text-text-muted/70">
                <th className="px-2.5 py-1.5 text-left font-medium">ЕИ</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Кол-во</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Сумма</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Среднее</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Мин</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Макс</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.unit} className="border-t border-white/[0.06]">
                  <td className="px-2.5 py-1.5 text-left font-semibold text-text-strong">{u.unit}</td>
                  <td className="px-2.5 py-1.5 text-right">{u.count.toLocaleString('ru-RU')}</td>
                  <td className="px-2.5 py-1.5 text-right text-text-primary">{fmtStatNum(u.sum, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.avg, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.min, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.max, u.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Панель агрегатов выделения (подписчик selLive). Считает по строкам, УЖЕ отфильтрованным
 * гридом (в План/Отчёте — по выбранному дню/дням/месяцу): аксессоры читают текущие viewRows.
 */
export function FlowSelStats({
  selLive,
  rowCount,
  colCount,
  numAt,
  qtyCol,
  normRowAt,
  minQtyOf,
}: {
  selLive: LiveValue<GridSelection>;
  rowCount: number;
  colCount: number;
  numAt: NumCellAt;
  qtyCol: number;
  normRowAt: NormRowAt;
  minQtyOf: (noKey: string) => number | null;
}): JSX.Element | null {
  const selection = useLiveValue(selLive);
  const selStats = useMemo(
    () => buildSelStats(selection, rowCount, colCount, numAt),
    [selection, rowCount, colCount, numAt],
  );
  const selNorm = useMemo(
    () => buildSelNorm(selection, qtyCol, normRowAt, minQtyOf),
    [selection, qtyCol, normRowAt, minQtyOf],
  );
  if (!selStats && !selNorm) return null;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-[#6B6862]">
      {selStats && (
        <>
          <span>
            Выделено: <span className="tabular-nums text-[#2A2925]">{selStats.count.toLocaleString('ru-RU')}</span>
          </span>
          {selStats.units.length === 1 && (
            <>
              <span className="text-black/25">·</span>
              <span className="rounded bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-[#2A2925]">
                {selStats.units[0]!.unit}
              </span>
              <FlowStat label="Сумма" value={selStats.units[0]!.sum} unit={selStats.units[0]!.unit} />
              <FlowStat label="Среднее" value={selStats.units[0]!.avg} unit={selStats.units[0]!.unit} />
              <FlowStat label="Мин" value={selStats.units[0]!.min} unit={selStats.units[0]!.unit} />
              <FlowStat label="Макс" value={selStats.units[0]!.max} unit={selStats.units[0]!.unit} />
            </>
          )}
          {selStats.units.length >= 2 && (
            <>
              <span className="text-black/25">·</span>
              <FlowUnitStatsPopover units={selStats.units} />
            </>
          )}
        </>
      )}
      {selNorm && (
        <>
          <span className="text-black/25">·</span>
          <span className="rounded bg-accent-clay/15 px-1.5 py-px text-[11px] font-semibold text-[#8A4B2E]">
            норма {selNorm.minQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
          </span>
          <span>
            не хватает{' '}
            <span className="tabular-nums font-semibold text-[#2A2925]">
              {selNorm.needPlain.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
            </span>
          </span>
          <span className="text-black/25">·</span>
          <span>
            с толерансом{' '}
            <span className="tabular-nums font-semibold text-[#2A2925]">
              {selNorm.needTol.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
