/**
 * Календарь: три кнопки (Сегодня | Все дни | Сброс) + навигация месяца + дни.
 * Без чипов месяцев.
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

export function PynCalendar({
  selected,
  onChange,
  dataDays,
  onSelectMonth,
  onReset,
  resetEnabled = false,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  dataDays?: Set<string>;
  /** Все дни открытого месяца (YYYY-MM). */
  onSelectMonth?: (ym: string) => void;
  onReset?: () => void;
  resetEnabled?: boolean;
  /** @deprecated чипы месяцев убраны */
  monthsWithData?: string[];
}): JSX.Element {
  const today = useMemo(() => isoToday(), []);
  const firstSel = [...selected].sort()[0];
  const [ym, setYm] = useState(() => {
    const base = firstSel || today;
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });

  const drag = useRef<{ base: Set<string>; anchor: string; moved: boolean } | null>(null);
  useEffect(() => {
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const iso = (d: number): string => `${ym.y}-${pad2(ym.m)}-${pad2(d)}`;
  const ymKey = `${ym.y}-${pad2(ym.m)}`;

  const rangeOf = (a: string, b: string): string[] => {
    const lo = Math.min(dayNum(a), dayNum(b));
    const hi = Math.max(dayNum(a), dayNum(b));
    const out: string[] = [];
    for (let d = lo; d <= hi; d += 1) out.push(iso(d));
    return out;
  };

  const onDown = (dIso: string): void => {
    drag.current = { base: new Set(selected), anchor: dIso, moved: false };
  };
  const onEnter = (dIso: string): void => {
    const dr = drag.current;
    if (!dr) return;
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

  const selectAllDays = (): void => {
    if (onSelectMonth) {
      onSelectMonth(ymKey);
      return;
    }
    const next = new Set<string>();
    for (let d = 1; d <= daysIn; d += 1) next.add(iso(d));
    onChange(next);
  };

  const canReset = resetEnabled || selected.size > 0;

  return (
    <div className="pyn-cal">
      <div className="pyn-cal-actions">
        <button type="button" className="pyn-cal-action pyn-cal-action--primary" onClick={jumpToday}>
          Сегодня
        </button>
        <button type="button" className="pyn-cal-action pyn-cal-action--primary" onClick={selectAllDays}>
          Все дни
        </button>
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
          return (
            <button
              key={dIso}
              type="button"
              onPointerDown={() => onDown(dIso)}
              onPointerEnter={() => onEnter(dIso)}
              onPointerUp={() => onUp(dIso)}
              className={[
                'pyn-cal-day',
                sel ? 'is-selected' : '',
                isToday ? 'is-today' : '',
                hasData ? 'has-data' : '',
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
