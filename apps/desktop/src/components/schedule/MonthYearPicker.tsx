import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
}: MonthYearPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const years = useMemo(() => {
    // Только текущий + следующий календарный год. Старые года не нужны —
    // график живёт «сейчас и ближайшее планирование».
    const now = new Date().getFullYear();
    return [now, now + 1];
  }, []);
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
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeMonth(m)}
                  className={[
                    'h-7 rounded text-[11.5px] outline-none transition-colors',
                    selected
                      ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                      : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                  ].join(' ')}
                >
                  {name.slice(0, 3)}
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
