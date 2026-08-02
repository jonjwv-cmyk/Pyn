/**
 * Календарь: три кнопки (Сегодня | Все дни | Сброс) + навигация месяца + дни.
 * Без чипов месяцев.
 *
 * Два режима (юзер 2026-08-02: единый календарь для Разнарядки и Транспорта):
 *  · multi (по умолчанию) — драг/клик мультивыбор дней, «has-data» точка (Транспорт);
 *  · single — клик сразу выбирает один день, доступна раскраска по статусу
 *    draft/fixed/mixed (Разнарядка: черновик/факт) и disabled-дни.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dayNum(iso: string): number {
  return Number(iso.slice(8, 10)) || 0;
}

export type PynCalDayStatus = 'draft' | 'fixed' | 'mixed';

export function PynCalendar({
  selected,
  onChange,
  dataDays,
  onReset,
  resetEnabled = false,
  mode = 'multi',
  dayStatus,
  dayTitle,
  isDateEnabled,
  initialMonth,
  showActions = true,
  primaryActionLabel = 'Сегодня',
  onPrimaryAction,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  dataDays?: Set<string>;
  onReset?: () => void;
  resetEnabled?: boolean;
  /** @deprecated чипы месяцев убраны */
  monthsWithData?: string[];
  /** single — клик по дню сразу выбирает один день (без драг-мультивыбора). */
  mode?: 'multi' | 'single';
  /** Раскраска дня по статусу (режим single, напр. Разнарядка: черновик/факт/оба). */
  dayStatus?: (iso: string) => PynCalDayStatus | undefined;
  /** title-подсказка дня (hover). */
  dayTitle?: (iso: string) => string | undefined;
  /** Заблокировать выбор дня (недоступная дата). */
  isDateEnabled?: (iso: string) => boolean;
  /** Открыть конкретный месяц (YYYY-MM), если выбора/сегодня недостаточно. */
  initialMonth?: string;
  /** Скрыть встроенную строку Сегодня/Все дни/Сброс — свои кнопки у консьюмера. */
  showActions?: boolean;
  /** Текст первой кнопки действий (по умолчанию «Сегодня»). */
  primaryActionLabel?: string;
  /** Своя логика первой кнопки — напр. «Последнее» (ближайший день с данными)
   * вместо жёсткого перехода на сегодня (юзер 2026-08-02). */
  onPrimaryAction?: () => void;
}): JSX.Element {
  const today = useMemo(() => isoToday(), []);
  const firstSel = [...selected].sort()[0];
  const [ym, setYm] = useState(() => {
    const base = initialMonth ? `${initialMonth}-01` : firstSel || today;
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });

  const isSingle = mode === 'single';

  const drag = useRef<{ base: Set<string>; anchor: string; moved: boolean } | null>(null);
  useEffect(() => {
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const iso = (d: number): string => `${ym.y}-${pad2(ym.m)}-${pad2(d)}`;

  const rangeOf = (a: string, b: string): string[] => {
    const lo = Math.min(dayNum(a), dayNum(b));
    const hi = Math.max(dayNum(a), dayNum(b));
    const out: string[] = [];
    for (let d = lo; d <= hi; d += 1) out.push(iso(d));
    return out;
  };

  const onDown = (dIso: string): void => {
    if (isDateEnabled && !isDateEnabled(dIso)) return;
    drag.current = { base: new Set(selected), anchor: dIso, moved: false };
  };
  const onEnter = (dIso: string): void => {
    const dr = drag.current;
    if (!dr) return;
    if (isDateEnabled && !isDateEnabled(dIso)) return;
    dr.moved = true;
    const next = new Set(dr.base);
    for (const r of rangeOf(dr.anchor, dIso)) next.add(r);
    onChange(next);
  };
  const onUp = (dIso: string): void => {
    const dr = drag.current;
    if (!dr) return;
    if (!dr.moved) {
      const next = new Set(dr.base);
      if (next.has(dIso)) next.delete(dIso);
      else next.add(dIso);
      onChange(next);
    }
    drag.current = null;
  };

  const onSingleClick = (dIso: string): void => {
    if (isDateEnabled && !isDateEnabled(dIso)) return;
    onChange(new Set([dIso]));
  };

  const first = new Date(ym.y, ym.m - 1, 1);
  const startWd = (first.getDay() + 6) % 7;
  const daysIn = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWd }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => i + 1),
  ];

  const jumpToday = (): void => {
    const t = isoToday();
    setYm({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) });
    onChange(new Set([t]));
  };

  // «Все дни» — тумблер открытого месяца (юзер 2026-08-02): месяц целиком выбран →
  // жмём ещё раз → снимаем именно этот месяц; не весь целиком (снял один день руками) →
  // жмём → доливаем недостающие. Другие месяцы, выбранные раньше, не трогаем — копятся.
  const monthDays = useMemo(() => {
    const out: string[] = [];
    for (let d = 1; d <= daysIn; d += 1) out.push(iso(d));
    return out;
  }, [ym.y, ym.m, daysIn]);
  const isMonthFull = monthDays.length > 0 && monthDays.every((d) => selected.has(d));

  const selectAllDays = (): void => {
    const next = new Set(selected);
    if (isMonthFull) {
      for (const d of monthDays) next.delete(d);
    } else {
      for (const d of monthDays) next.add(d);
    }
    onChange(next);
  };

  const canReset = resetEnabled || selected.size > 0;

  return (
    <div className="pyn-cal">
      {showActions && (
        <div className="pyn-cal-actions">
          <button type="button" className="pyn-cal-action pyn-cal-action--primary" onClick={onPrimaryAction ?? jumpToday}>
            {primaryActionLabel}
          </button>
          {!isSingle && (
            <button type="button" className="pyn-cal-action pyn-cal-action--primary" onClick={selectAllDays}>
              Все дни
            </button>
          )}
          <button
            type="button"
            className="pyn-cal-action"
            disabled={!canReset}
            onClick={() => {
              onChange(new Set());
              onReset?.();
            }}
          >
            Сброс
          </button>
        </div>
      )}

      <div className="pyn-cal-nav">
        <button
          type="button"
          className="pyn-cal-nav-btn"
          aria-label="Предыдущий месяц"
          onClick={() => setYm((p) => (p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 }))}
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <div className="pyn-cal-nav-title">
          {MONTH_RU[ym.m - 1]} {ym.y}
        </div>
        <button
          type="button"
          className="pyn-cal-nav-btn"
          aria-label="Следующий месяц"
          onClick={() => setYm((p) => (p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }))}
        >
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="pyn-cal-dow">
        {DOW.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="pyn-cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} className="pyn-cal-empty" />;
          const dIso = iso(d);
          const sel = selected.has(dIso);
          const hasData = dataDays?.has(dIso);
          const isToday = dIso === today;
          const st = dayStatus?.(dIso);
          const disabled = isDateEnabled ? !isDateEnabled(dIso) : false;
          return (
            <button
              key={dIso}
              type="button"
              disabled={disabled}
              title={dayTitle?.(dIso)}
              onPointerDown={isSingle ? undefined : () => onDown(dIso)}
              onPointerEnter={isSingle ? undefined : () => onEnter(dIso)}
              onPointerUp={isSingle ? undefined : () => onUp(dIso)}
              onClick={isSingle ? () => onSingleClick(dIso) : undefined}
              className={[
                'pyn-cal-day',
                sel ? 'is-selected' : '',
                isToday ? 'is-today' : '',
                hasData ? 'has-data' : '',
                st === 'mixed' ? 'is-mixed' : st === 'fixed' ? 'is-fixed' : st === 'draft' ? 'is-draft' : '',
                disabled ? 'is-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
