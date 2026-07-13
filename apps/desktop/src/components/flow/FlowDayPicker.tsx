import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FlowDeliveryRow } from '@pyn/core';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * Календарь выбора дня для Плана/Отчёта (ТЗ §6, P7, юзер 2026-06-14: «где календарь?»).
 * Кнопка показывает выбранный день (или «Все дни») → поповер-месяц со статусами дней:
 *  • серый  — прошлый/недоступный день;
 *  • красный — есть НЕзафиксированные строки (черновики) этого дня (актуально для Плана);
 *  • зелёный — есть зафиксированные строки этого дня (актуально для Отчёта);
 *  • смешанный (оба) — фиксация + новые дополнения.
 * Выбор дня фильтрует грид; «Все дни» снимает фильтр.
 */

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август',
  'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function isoToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

interface DayStat {
  draft: boolean; // есть незафиксированные (красный)
  fixed: boolean; // есть зафиксированные (зелёный)
}

export function FlowDayPicker({
  mode,
  rows,
  selected,
  onSelect,
  placeholder = 'Все дни',
  title = 'Календарь — выбрать день плана/отчёта',
  allowClear = true,
  minDate,
  isDateEnabled,
  disabledTitle = 'дата недоступна',
}: {
  mode: 'plan' | 'report';
  rows: readonly FlowDeliveryRow[];
  selected: string | null;
  onSelect: (iso: string | null) => void;
  placeholder?: string;
  title?: string;
  allowClear?: boolean;
  minDate?: string;
  isDateEnabled?: (iso: string) => boolean;
  disabledTitle?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const today = isoToday();

  // Статусы по дню (YYYY-MM-DD → есть черновик/фиксация).
  const statByDay = useMemo(() => {
    const m = new Map<string, DayStat>();
    for (const r of rows) {
      const d = (r.plan_date || '').slice(0, 10);
      if (!d) continue;
      const s = m.get(d) ?? { draft: false, fixed: false };
      if (Number(r.fixation_id) > 0) s.fixed = true;
      else s.draft = true;
      m.set(d, s);
    }
    return m;
  }, [rows]);

  const [view, setView] = useState(() => {
    const base = selected || today;
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });

  // Закрытие по клику снаружи.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const cells = useMemo(() => {
    const firstWd = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7;
    const dim = new Date(view.y, view.m, 0).getDate();
    const out: Array<number | null> = [];
    for (let i = 0; i < firstWd; i++) out.push(null);
    for (let d = 1; d <= dim; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const prevMonth = (): void => setView((s) => (s.m === 1 ? { y: s.y - 1, m: 12 } : { ...s, m: s.m - 1 }));
  const nextMonth = (): void => setView((s) => (s.m === 12 ? { y: s.y + 1, m: 1 } : { ...s, m: s.m + 1 }));
  const isoOf = (d: number): string =>
    `${view.y}-${String(view.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const label = selected
    ? `${parseInt(selected.slice(8, 10), 10)} ${MONTH_ABBR_RU[parseInt(selected.slice(5, 7), 10) - 1] ?? ''}`
    : placeholder;

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] transition-colors ${
          selected
            ? 'border-accent-clay/70 text-[#0A0A0A]'
            : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]'
        }`}
      >
        <CalendarDays size={13} strokeWidth={1.75} />
        {label}
      </button>
      {selected && allowClear && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          title="Показать все дни"
          className="ml-0.5 flex h-6 w-5 items-center justify-center rounded-md border border-black/10 text-[#6B6862] transition-colors hover:text-danger"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-7 z-30 w-[236px] rounded-xl border border-white/10 bg-[#302F2D] p-2 shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
          <div className="mb-1 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={prevMonth}
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <div className="flex-1 text-center text-[12px] font-semibold tabular-nums text-text-strong">
              {MONTHS_RU[view.m - 1]} {view.y}
            </div>
            <button
              type="button"
              onClick={nextMonth}
              className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-medium uppercase tracking-wider text-text-muted">
            {WEEKDAYS_SHORT.map((wd, i) => (
              <div key={wd} className={i >= 5 ? 'text-accent-clay/70' : ''}>
                {wd}
              </div>
            ))}
          </div>
          <div className="mt-0.5 grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d == null) return <div key={`e${i}`} />;
              const iso = isoOf(d);
              const st = statByDay.get(iso);
              const past = iso < today;
              const disabled = (!!minDate && iso < minDate) || (!!isDateEnabled && !isDateEnabled(iso));
              const isSel = iso === selected;
              // Статус-цвет (приоритет: выбранный → смешанный → зелёный → красный → прошлый → нейтр.)
              let cls = 'text-text-primary hover:bg-white/[0.06]';
              if (st?.fixed && st?.draft) cls = 'bg-amber-500/25 text-amber-200';
              else if (st?.fixed) cls = 'bg-emerald-500/25 text-emerald-200';
              else if (st?.draft) cls = 'bg-rose-500/25 text-rose-200';
              else if (past) cls = 'text-text-muted/40';
              if (disabled) cls = 'cursor-not-allowed text-text-muted/25';
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(iso);
                    setOpen(false);
                  }}
                  title={
                    disabled
                      ? disabledTitle
                      : st
                      ? `${st.fixed ? 'есть зафиксированные' : ''}${st.fixed && st.draft ? ' + ' : ''}${st.draft ? 'есть черновики' : ''}`
                      : 'нет строк'
                  }
                  className={`h-7 rounded text-[12px] tabular-nums outline-none transition-colors ${cls} ${
                    isSel ? 'ring-1 ring-inset ring-accent-clay' : ''
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-white/10 pt-1.5">
            <span className="text-[10px] text-text-muted/70">
              {mode === 'report'
                ? 'зелёный — выполнено есть'
                : 'красный — черновики · зелёный — зафиксировано'}
            </span>
            {allowClear && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] text-text-primary transition-colors hover:bg-white/[0.06] hover:text-text-strong"
              >
                Все дни
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
