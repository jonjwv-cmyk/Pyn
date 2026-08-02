import { useEffect, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import type { FlowDeliveryRow } from '@pyn/core';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';
import { PynCalendar, type PynCalDayStatus } from '@/components/pyn-table/PynCalendar';
import '@/components/pyn-table/pyn-table-theme.css';

/**
 * Календарь выбора дня для Плана/Отчёта (ТЗ §6, P7, юзер 2026-06-14: «где календарь?»).
 * Кнопка показывает выбранный день (или «Все дни») → поповер-месяц со статусами дней:
 *  • серый  — прошлый/недоступный день;
 *  • красный — есть НЕзафиксированные строки (черновики) этого дня (актуально для Плана);
 *  • зелёный — есть зафиксированные строки этого дня (актуально для Отчёта);
 *  • смешанный (оба) — фиксация + новые дополнения.
 * Выбор дня фильтрует грид; «Все дни» снимает фильтр.
 *
 * Сетка/навигация месяца — общий <PynCalendar mode="single">, тот же движок, что и у
 * календаря Транспорта (юзер 2026-08-02: единый календарь вместо трёх разных реализаций).
 */

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

  const statByDay = new Map<string, DayStat>();
  for (const r of rows) {
    const d = (r.plan_date || '').slice(0, 10);
    if (!d) continue;
    const s = statByDay.get(d) ?? { draft: false, fixed: false };
    if (Number(r.fixation_id) > 0) s.fixed = true;
    else s.draft = true;
    statByDay.set(d, s);
  }
  const dayStatus = (iso: string): PynCalDayStatus | undefined => {
    const s = statByDay.get(iso);
    if (!s) return undefined;
    if (s.fixed && s.draft) return 'mixed';
    if (s.fixed) return 'fixed';
    if (s.draft) return 'draft';
    return undefined;
  };
  const enabled = (iso: string): boolean => {
    if (minDate && iso < minDate) return false;
    if (isDateEnabled && !isDateEnabled(iso)) return false;
    return true;
  };
  const dayTitle = (iso: string): string => {
    if (!enabled(iso)) return disabledTitle;
    const s = statByDay.get(iso);
    if (!s) return 'нет строк';
    return `${s.fixed ? 'есть зафиксированные' : ''}${s.fixed && s.draft ? ' + ' : ''}${s.draft ? 'есть черновики' : ''}`;
  };

  // Закрытие по клику снаружи.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

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
          <PynCalendar
            mode="single"
            showActions={false}
            selected={selected ? new Set([selected]) : new Set()}
            onChange={(next) => {
              const iso = [...next][0];
              if (iso) {
                onSelect(iso);
                setOpen(false);
              }
            }}
            dayStatus={dayStatus}
            dayTitle={dayTitle}
            isDateEnabled={enabled}
            initialMonth={(selected || today).slice(0, 7)}
          />
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
