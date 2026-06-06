import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scheduleMonthsList } from '@pyn/core';
import { api } from '@/lib/api';
import { useScheduleMonthsMeta, monthKey } from '@/lib/schedule/use-schedule-sync';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';

interface MonthYearPickerProps {
  year: number;
  month: number;
  onChangeYear: (year: number) => void;
  onChangeMonth: (month: number) => void;
  /**
   * Optional custom trigger. Если передан — Popover.Trigger asChild оборачивает
   * этот элемент вместо встроенной кнопки. Используется в «Пробе», где
   * триггером служит сам заголовок «ГРАФИК ДОСТАВКИ — МАЙ 2026».
   */
  children?: React.ReactNode;
  /** Collaboration lock resource_id, e.g. 'schedule:2026-05:month'. */
  lockResourceId?: string;
  /**
   * z-index класс поповера (default `z-50`). В разделе «Поток» все поповеры
   * живут на `z-30` (ниже системных окон: сессия z-40), поэтому там передаём
   * `z-30`, чтобы пикер месяца не перекрывал предупреждение о сессии.
   */
  contentZIndex?: string;
  /**
   * Помечать ЖЁЛТЫМ месяцы без «дней без доставки» (раздел График). Доступ к
   * выбору остаётся — это лишь индикатор «тут не заданы дни без доставки» (как в
   * Потоке·Формировании). Включает тихую дозагрузку списка месяцев + holidays.
   */
  markNoHolidayMonths?: boolean;
}

/**
 * Popover-выбор месяца+года в Pyn-стиле (не нативный select).
 * Layout: две колонки — месяцы 3×4 grid, года скролл-список.
 */
export function MonthYearPicker({
  year,
  month,
  onChangeYear,
  onChangeMonth,
  children,
  lockResourceId,
  contentZIndex = 'z-50',
  markNoHolidayMonths = false,
}: MonthYearPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const years = useMemo(() => {
    // Только текущий + следующий календарный год. Старые года не нужны —
    // график живёт «сейчас и ближайшее планирование».
    const now = new Date().getFullYear();
    return [now, now + 1];
  }, []);
  // Текущий месяц/год «сейчас» — подсвечиваем отдельным индикатором (не выбором),
  // чтобы было видно, какой месяц нынешний (а не только какой открыт).
  const today = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1 };
  }, []);

  // Жёлтая пометка месяцев без «дней без доставки» (только при markNoHolidayMonths).
  // Список существующих месяцев — один запрос на открытие; holidays — для существующих.
  // Месяца НЕТ в графике → дней без доставки нет → жёлтый (но выбрать всё равно можно).
  const [monthsExist, setMonthsExist] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!open || !markNoHolidayMonths || monthsExist) return;
    let alive = true;
    void scheduleMonthsList(api)
      .then((list) => {
        if (alive) setMonthsExist(new Set(list.map((m) => `${m.year}-${m.month}`)));
      })
      .catch(() => {
        if (alive) setMonthsExist(new Set());
      });
    return () => {
      alive = false;
    };
  }, [open, markNoHolidayMonths, monthsExist]);
  const noHolMetaMonths = useMemo(() => {
    if (!open || !markNoHolidayMonths || !monthsExist) return [];
    const out: { year: number; month: number }[] = [];
    for (const y of years) {
      for (let m = 1; m <= 12; m++) if (monthsExist.has(`${y}-${m}`)) out.push({ year: y, month: m });
    }
    return out;
  }, [open, markNoHolidayMonths, monthsExist, years]);
  const noHolMetaMap = useScheduleMonthsMeta(noHolMetaMonths);
  const monthHasNoHolidays = (y: number, m: number): boolean => {
    if (!markNoHolidayMonths || !monthsExist) return false; // выкл / ещё грузится
    if (!monthsExist.has(`${y}-${m}`)) return true; // месяца нет → дней без доставки нет
    const meta = noHolMetaMap.get(monthKey(y, m));
    return meta ? meta.holidays.length === 0 : false; // holidays грузятся → пока не желтим
  };
  // Локализованные имена месяцев — common.month_1 .. common.month_12
  const monthNames = useMemo(
    () => Array.from({ length: 12 }, (_, i) => t(`common.month_${i + 1}`)),
    [t],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {children ?? (
          <button
            type="button"
            className="no-drag-region flex h-7 items-center gap-1 rounded px-2 text-[13px] font-medium text-text-strong outline-none transition-colors hover:bg-white/[0.06] data-[state=open]:bg-white/[0.08]"
          >
            <span className="tabular-nums">
              {monthNames[month - 1]} {year}
            </span>
            <ChevronDown className="h-3 w-3 text-text-muted" strokeWidth={1.75} />
          </button>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={`${contentZIndex} w-[228px] rounded-lg border border-white/[0.08] bg-bg-elevated p-2.5 text-text-primary shadow-2xl outline-none`}
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          {/* Год — current + next. Labels убраны: 4-значные числа vs 3-буквенные
             месяцы достаточно явно различимы. */}
          <div className="grid grid-cols-2 gap-1">
            {years.map((y) => {
              const selected = y === year;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => onChangeYear(y)}
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

          <div className="my-2 h-px bg-white/[0.06]" />

          {/* Месяцы — 3 колонки × 4 строки, column-major */}
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
              gridAutoFlow: 'column',
            }}
          >
            {monthNames.map((name, idx) => {
              const m = idx + 1;
              const selected = m === month;
              // «Сейчас» = этот месяц в текущем году (год пикера = year).
              const isCurrent = year === today.y && m === today.m;
              // Жёлтый — нет «дней без доставки» (выбрать всё равно можно).
              const noHol = !selected && monthHasNoHolidays(year, m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeMonth(m)}
                  title={
                    noHol
                      ? 'Нет «дней без доставки»'
                      : isCurrent
                        ? 'Текущий месяц'
                        : undefined
                  }
                  className={[
                    'relative h-7 rounded text-[11.5px] outline-none transition-colors',
                    selected
                      ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                      : noHol
                        ? 'text-amber-400/80 hover:bg-white/[0.06] hover:text-amber-300'
                        : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                  ].join(' ')}
                >
                  {name.slice(0, 3)}
                  {/* Текущий месяц — полоска-индикатор снизу (как активная вкладка). */}
                  {isCurrent && (
                    <span className="absolute bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-accent-clay/80" />
                  )}
                </button>
              );
            })}
          </div>
          </LockedEditorContent>

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
