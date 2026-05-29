import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { LockableTrigger } from './LockableTrigger';
import type { ScheduleApproverDate } from '@/lib/schedule/types';

interface DatePickerProps {
  date: ScheduleApproverDate;
  onChange: (date: ScheduleApproverDate) => void;
  /** Custom trigger element (требуется — компонент только-в-Пробе). */
  children: React.ReactNode;
  /** Collaboration lock resource_id, e.g. 'schedule:2026-05:date'. */
  lockResourceId?: string;
  /** true — месяц зафиксирован: пикер не открывается, на hover tooltip. */
  locked?: boolean;
}

/**
 * Полный date-picker: год (current + next) сверху → месяц со стрелками →
 * grid дней выбранного месяца. Patterns reused: clay-ring selection,
 * Linear hairline divider, ПН-первый календарь как у HolidaysCalendar.
 */
export function DatePicker({ date, onChange, children, lockResourceId, locked = false }: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // viewYear / viewMonth — навигация внутри picker'а, не коммитятся пока
  // не выбрана конкретная дата. Сбрасываем на selected при каждом открытии.
  const [viewYear, setViewYear] = useState(date.year);
  const [viewMonth, setViewMonth] = useState(date.month);

  // Локализованные имена месяцев / weekday'a — через common.month_N / common.weekday_short_*
  const weekdaysShort = useMemo(
    () => [
      t('common.weekday_short_mon'),
      t('common.weekday_short_tue'),
      t('common.weekday_short_wed'),
      t('common.weekday_short_thu'),
      t('common.weekday_short_fri'),
      t('common.weekday_short_sat'),
      t('common.weekday_short_sun'),
    ],
    [t],
  );

  useEffect(() => {
    if (open) {
      setViewYear(date.year);
      setViewMonth(date.month);
    }
  }, [open, date.year, date.month]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now, now + 1];
  }, []);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth - 1, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const out: Array<{ day: number | null; weekend: boolean }> = [];
    for (let i = 0; i < firstWeekday; i++) {
      out.push({ day: null, weekend: i >= 5 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(viewYear, viewMonth - 1, d);
      const dow = (dt.getDay() + 6) % 7;
      out.push({ day: d, weekend: dow >= 5 });
    }
    while (out.length % 7 !== 0) {
      const dow = out.length % 7;
      out.push({ day: null, weekend: dow >= 5 });
    }
    return out;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };
  const pickDay = (day: number) => {
    onChange({ year: viewYear, month: viewMonth, day });
    setOpen(false);
  };

  return (
    <Popover.Root open={locked ? false : open} onOpenChange={(o) => { if (!locked) setOpen(o); }}>
      <LockableTrigger locked={locked}>{children}</LockableTrigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[244px] rounded-lg border border-white/[0.08] bg-bg-elevated p-2.5 text-text-primary shadow-2xl outline-none"
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          {/* Год — current + next (без label, понятно по 4-значным числам) */}
          <div className="grid grid-cols-2 gap-1">
            {years.map((y) => {
              const selected = y === viewYear;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setViewYear(y)}
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

          {/* Месяц со стрелками */}
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={prevMonth}
              title={t('schedule.prev_month')}
              className="flex h-7 w-7 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <div className="flex-1 text-center text-[12px] font-semibold tabular-nums text-text-strong">
              {t(`common.month_${viewMonth}`)}
            </div>
            <button
              type="button"
              onClick={nextMonth}
              title={t('schedule.next_month')}
              className="flex h-7 w-7 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="my-2 h-px bg-white/[0.06]" />

          {/* Дата — grid 7×6 дней выбранного месяца */}
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[9px] font-medium uppercase tracking-wider text-text-muted">
            {weekdaysShort.map((wd, i) => (
              <div key={wd} className={i >= 5 ? 'text-accent-clay/70' : ''}>
                {wd}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              if (c.day === null) {
                return <div key={`empty_${i}`} className="h-7" />;
              }
              const selected =
                viewYear === date.year &&
                viewMonth === date.month &&
                c.day === date.day;
              return (
                <button
                  key={c.day}
                  type="button"
                  onClick={() => pickDay(c.day!)}
                  className={[
                    'flex h-7 items-center justify-center rounded text-[11.5px] tabular-nums outline-none transition-colors',
                    selected
                      ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                      : c.weekend
                        ? 'text-accent-clay/80 hover:bg-white/[0.06] hover:text-accent-clay'
                        : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                  ].join(' ')}
                >
                  {c.day}
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
