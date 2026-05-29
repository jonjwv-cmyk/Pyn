import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Calendar, Check } from 'lucide-react';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import { LockableTrigger } from '@/components/proba/LockableTrigger';
import { MONTH_NAMES_RU } from '@/lib/schedule/compute';

interface HolidaysCalendarProps {
  year: number;
  month: number;
  holidays: number[];
  onChange: (holidays: number[]) => void;
  /**
   * Optional custom trigger. Если передан — Popover.Trigger asChild оборачивает
   * этот элемент вместо встроенной «Не возим»-кнопки. Используется в «Пробе»,
   * где триггером служит строка из мета-блока листа.
   */
  children?: React.ReactNode;
  /** Collaboration lock resource_id, e.g. 'schedule:2026-05:holidays'. */
  lockResourceId?: string;
  /** true — месяц зафиксирован: календарь не открывается, на hover tooltip. */
  locked?: boolean;
}

/**
 * Popover-календарь для выбора дней-исключений месяца («не возим»).
 *
 * Дизайн — Linear style: 7×6 grid дат текущего месяца, click toggle. ПН-первый,
 * выходные подсвечены отдельным оттенком. Сегодня (если попадает в месяц) —
 * outlined clay-ring. Toggle через клик: чёрный фон = «не возим».
 *
 * Правки draft'овые: клики меняют локальный черновик, в график применяются
 * только по кнопке «Подтвердить» (как в ExceptionsEditor). Закрытие без
 * подтверждения отбрасывает черновик — это убирает лавину пересчётов графика
 * на каждый клик дня.
 */
export function HolidaysCalendar({
  year,
  month,
  holidays,
  onChange,
  children,
  lockResourceId,
  locked = false,
}: HolidaysCalendarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(holidays);
  const monthName = MONTH_NAMES_RU[month - 1];
  const draftSet = useMemo(() => new Set(draft), [draft]);

  // Ресинк черновика с внешними holidays при открытии поповера. Пока поповер
  // открыт, holidays не меняются (onChange только по «Подтвердить»), поэтому
  // черновик пользователя не затирается.
  useEffect(() => {
    if (open) setDraft(holidays);
  }, [open, holidays]);

  // 6×7 grid начиная с первого ПН недели, в которой 1-е число.
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    // JS getDay: 0=Sun..6=Sat → нужно ПН=0..ВС=6
    const firstWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const out: Array<{ day: number | null; weekend: boolean }> = [];
    // empty cells before day 1
    for (let i = 0; i < firstWeekday; i++) {
      out.push({ day: null, weekend: i >= 5 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const dow = (dt.getDay() + 6) % 7;
      out.push({ day: d, weekend: dow >= 5 });
    }
    // trailing empties to complete last row
    while (out.length % 7 !== 0) {
      const dow = out.length % 7;
      out.push({ day: null, weekend: dow >= 5 });
    }
    return out;
  }, [year, month]);

  const todayDay = useMemo(() => {
    const now = new Date();
    if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return null;
    return now.getDate();
  }, [year, month]);

  const toggleDay = (day: number) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return [...next].sort((a, b) => a - b);
    });
  };

  const clearAll = () => setDraft([]);

  const fillWeekends = () => {
    const weekends: number[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = (new Date(year, month - 1, d).getDay() + 6) % 7;
      if (dow >= 5) weekends.push(d);
    }
    // Объединяем с уже выбранными — fill, не replace, чтобы не терять
    // праздники-будни (1, 9 мая и т.д.).
    setDraft((prev) => [...new Set([...prev, ...weekends])].sort((a, b) => a - b));
  };

  const dirty = useMemo(() => {
    if (draft.length !== holidays.length) return true;
    const committed = new Set(holidays);
    return draft.some((d) => !committed.has(d));
  }, [draft, holidays]);

  const confirm = () => {
    onChange([...draft].sort((a, b) => a - b));
    setOpen(false);
  };

  return (
    <Popover.Root open={locked ? false : open} onOpenChange={(o) => { if (!locked) setOpen(o); }}>
      <LockableTrigger locked={locked}>
        {children ?? (
          <button
            type="button"
            className="no-drag-region flex h-7 items-center gap-1.5 rounded px-2 text-[12px] font-medium text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong data-[state=open]:bg-white/[0.08] data-[state=open]:text-text-strong"
            title="Дни-исключения (праздники / выходные)"
          >
            <Calendar className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span>Не возим</span>
            {holidays.length > 0 && (
              <span className="tabular-nums text-text-muted/80">· {holidays.length}</span>
            )}
          </button>
        )}
      </LockableTrigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[280px] rounded-lg border border-white/[0.08] bg-bg-elevated p-3 text-text-primary shadow-2xl outline-none"
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-medium text-text-strong">
              Дни без доставки
            </div>
            <div className="text-[10px] tabular-nums text-text-muted">
              {monthName} {year} · {draft.length} {draft.length === 1 ? 'день' : 'дн.'}
            </div>
          </div>

          {/* Weekday labels */}
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[9px] font-medium uppercase tracking-wider text-text-muted">
            {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((wd, i) => (
              <div key={wd} className={i >= 5 ? 'text-accent-clay/70' : ''}>
                {wd}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) => {
              if (c.day === null) {
                return <div key={`empty_${i}`} className="h-7" />;
              }
              const selected = draftSet.has(c.day);
              const isToday = todayDay === c.day;
              return (
                <button
                  key={c.day}
                  type="button"
                  onClick={() => toggleDay(c.day!)}
                  className={[
                    'flex h-7 items-center justify-center rounded text-[11.5px] tabular-nums transition-colors',
                    selected
                      ? 'bg-text-strong text-bg-primary font-semibold'
                      : c.weekend
                        ? 'text-accent-clay/80 hover:bg-white/[0.06] hover:text-accent-clay'
                        : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                    isToday && !selected ? 'ring-1 ring-inset ring-accent-clay/50' : '',
                  ].join(' ')}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          {/* Footer actions */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={fillWeekends}
                className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
              >
                + выходные
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={draft.length === 0}
                className="text-[11px] text-text-muted transition-colors hover:text-accent-clay disabled:cursor-not-allowed disabled:opacity-30"
              >
                Очистить
              </button>
            </div>
            <button
              type="button"
              onClick={confirm}
              disabled={!dirty}
              className="flex h-7 items-center gap-1 rounded bg-accent-clay px-2.5 text-[11px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Check className="h-3 w-3" strokeWidth={2.5} />
              Подтвердить
            </button>
          </div>
          </LockedEditorContent>

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
