// ============================================================
// flow-tabulator-stats.tsx — подвал агрегатов выделения для Tabulator-гридов Потока.
// ============================================================
// ТЗ 2026-08-06 п.11:
//  • считаем СТРОГО в рамках ОДНОЙ колонки — выделили две, агрегатов нет (только счётчик);
//  • агрегаты — в рамках ОДНОЙ ЕИ (несколько ЕИ → разбивка в поповере);
//  • транспортная норма работает как раньше, но НЕ показывается, если в выделении
//    разные материалы ИЛИ разные получатели (колонка TO) — тогда остаются только
//    счётчик / сумма / среднее.
// Аналог glide-версии flow-sel-stats.tsx, но на ячейках Tabulator (не GridSelection).
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useVghStore, normVghKey } from '@/lib/vgh-store';

/** Толеранс транспортной нормы: недобор снимается при Σ×1.5 ≥ MIN QTY (≈66.7%). */
const MIN_QTY_TOLERANCE = 1.5;
/** ЕИ, которые форматируем дробно (тонны/объём). Остальное — целые (штуки). */
const MEASURE_UNITS = new Set(['КГ', 'Т', 'Г', 'Л', 'М', 'М2', 'М3', 'М³', 'ПМ', 'КМ', 'ММ', 'СМ', 'ГА', '%']);

export function fmtStatNum(n: number, unit: string): string {
  if (!MEASURE_UNITS.has(unit.trim().toUpperCase())) return Math.round(n).toLocaleString('ru-RU');
  const r = Math.round(n * 1000) / 1000;
  const hasFrac = Math.abs(r - Math.round(r)) > 1e-9;
  return r.toLocaleString(
    'ru-RU',
    hasFrac ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : { maximumFractionDigits: 0 },
  );
}

/** Одна выделенная ячейка в терминах агрегатов (грид собирает это сам). */
export interface StatsCell {
  field: string;
  numeric: boolean;
  value: number;
  /** ЕИ значения (для QTY — ЕИ строки, для KG/V — КГ/М3). */
  unit: string;
  rowId: number;
  /** Кол-во строки — для транспортной нормы. */
  qty: number;
  /** Номенклатура строки. */
  noKey: string;
  /** Получатель строки (колонка TO). */
  toKey: string;
  /** Связка отправитель|получатель. */
  groupKey: string;
  uom: string;
}

interface UnitStat {
  unit: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

function FlowStat({ label, value, unit }: { label: string; value: number; unit: string }): JSX.Element {
  return (
    <span>
      {label}: <span className="tabular-nums text-[#2A2925]">{fmtStatNum(value, unit)}</span>
    </span>
  );
}

function UnitStatsPopover({ units }: { units: UnitStat[] }): JSX.Element {
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

export function FlowTabStats({ cells }: { cells: readonly StatsCell[] }): JSX.Element | null {
  const vghByKey = useVghStore((s) => s.byKey);

  const model = useMemo(() => {
    if (cells.length === 0) return null;
    const fields = new Set(cells.map((c) => c.field));
    // ТЗ п.11: две колонки одновременно не считаем.
    if (fields.size > 1) return { count: cells.length, multiColumn: true as const, units: [], norm: null };

    const field = [...fields][0]!;
    const numeric = cells[0]?.numeric ?? false;
    const byUnit = new Map<string, { count: number; sum: number; min: number; max: number }>();
    if (numeric) {
      for (const c of cells) {
        if (!Number.isFinite(c.value)) continue;
        const unit = c.unit || '—';
        let g = byUnit.get(unit);
        if (!g) {
          g = { count: 0, sum: 0, min: Infinity, max: -Infinity };
          byUnit.set(unit, g);
        }
        g.count++;
        g.sum += c.value;
        if (c.value < g.min) g.min = c.value;
        if (c.value > g.max) g.max = c.value;
      }
    }
    const units: UnitStat[] = [...byUnit.entries()]
      .map(([unit, g]) => ({ unit, count: g.count, sum: g.sum, avg: g.sum / g.count, min: g.min, max: g.max }))
      .sort((a, b) => b.count - a.count);

    // Транспортная норма — только по колонке QTY.
    let norm: { uom: string; minQty: number; needPlain: number; needTol: number } | null = null;
    if (field === 'qty') {
      const rows = new Map<number, StatsCell>();
      for (const c of cells) if (!rows.has(c.rowId)) rows.set(c.rowId, c);
      const list = [...rows.values()];
      const noKeys = new Set(list.map((c) => c.noKey));
      const toKeys = new Set(list.map((c) => c.toKey));
      const groups = new Set(list.map((c) => c.groupKey));
      // Разные материалы ИЛИ разные получатели — норму не показываем (ТЗ п.11).
      if (noKeys.size === 1 && toKeys.size === 1 && groups.size === 1) {
        const noKey = [...noKeys][0] ?? '';
        const vgh = vghByKey.get(normVghKey(noKey));
        const minQty = vgh?.min_qty ?? null;
        if (minQty != null && Number.isFinite(minQty)) {
          const sum = list.reduce((s, c) => s + (Number.isFinite(c.qty) ? c.qty : 0), 0);
          norm = {
            uom: list[0]?.uom || '—',
            minQty,
            needPlain: Math.max(0, minQty - sum),
            needTol: Math.max(0, minQty / MIN_QTY_TOLERANCE - sum),
          };
        }
      }
    }
    return { count: cells.length, multiColumn: false as const, units, norm };
  }, [cells, vghByKey]);

  if (!model) return null;

  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-[#6B6862]">
      <span>
        Выделено: <span className="tabular-nums text-[#2A2925]">{model.count.toLocaleString('ru-RU')}</span>
      </span>
      {model.multiColumn && <span className="opacity-70">— выберите ОДНУ колонку для расчёта</span>}
      {!model.multiColumn && model.units.length === 1 && (
        <>
          <span className="text-black/25">·</span>
          <span className="rounded bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-[#2A2925]">
            {model.units[0]!.unit}
          </span>
          <FlowStat label="Сумма" value={model.units[0]!.sum} unit={model.units[0]!.unit} />
          <FlowStat label="Среднее" value={model.units[0]!.avg} unit={model.units[0]!.unit} />
          <FlowStat label="Мин" value={model.units[0]!.min} unit={model.units[0]!.unit} />
          <FlowStat label="Макс" value={model.units[0]!.max} unit={model.units[0]!.unit} />
        </>
      )}
      {!model.multiColumn && model.units.length >= 2 && (
        <>
          <span className="text-black/25">·</span>
          <UnitStatsPopover units={model.units} />
        </>
      )}
      {model.norm && (
        <>
          <span className="text-black/25">·</span>
          <span className="rounded bg-accent-clay/15 px-1.5 py-px text-[11px] font-semibold text-[#8A4B2E]">
            норма {model.norm.minQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {model.norm.uom}
          </span>
          <span>
            не хватает{' '}
            <span className="tabular-nums font-semibold text-[#2A2925]">
              {model.norm.needPlain.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {model.norm.uom}
            </span>
          </span>
          <span className="text-black/25">·</span>
          <span>
            с толерансом{' '}
            <span className="tabular-nums font-semibold text-[#2A2925]">
              {model.norm.needTol.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {model.norm.uom}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
