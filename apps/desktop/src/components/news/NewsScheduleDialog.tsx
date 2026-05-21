import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface NewsScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если уже было запланировано — стартовое значение пикеров. */
  initial?: Date | null;
  onSchedule: (date: Date) => void;
}

const MONTH_KEYS = [
  'month_jan', 'month_feb', 'month_mar', 'month_apr', 'month_may', 'month_jun',
  'month_jul', 'month_aug', 'month_sep', 'month_oct', 'month_nov', 'month_dec',
] as const;
const MONTH_GEN_KEYS = [
  'month_gen_jan', 'month_gen_feb', 'month_gen_mar', 'month_gen_apr', 'month_gen_may', 'month_gen_jun',
  'month_gen_jul', 'month_gen_aug', 'month_gen_sep', 'month_gen_oct', 'month_gen_nov', 'month_gen_dec',
] as const;
const WEEKDAY_KEYS = ['day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'] as const;

type Period = 'AM' | 'PM';

/**
 * Модал выбора времени отложенной публикации.
 *
 * Три блока:
 *   • Календарь — собственная сетка месяца с навигацией (стилизована под нашу
 *     тёмную палитру).
 *   • Время — HH : MM, 12-часовой формат, текстовые поля с авто-clamp'ом.
 *   • AM/PM — pill-toggle.
 *
 * Внизу — preview ("Опубликуется: сегодня в 2:30 PM") и кнопки Отмена / Запланировать.
 */
export function NewsScheduleDialog({
  open,
  onOpenChange,
  initial,
  onSchedule,
}: NewsScheduleDialogProps) {
  const { t } = useTranslation();
  const [viewYear, setViewYear] = useState(0);
  const [viewMonth, setViewMonth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [hours12, setHours12] = useState(9);
  const [minutes, setMinutes] = useState(0);
  const [period, setPeriod] = useState<Period>('AM');

  // Sync state with initial / current time каждый раз при открытии диалога.
  useEffect(() => {
    if (!open) return;
    const d = initial ?? defaultStart();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(stripTime(d));
    setHours12(((d.getHours() + 11) % 12) + 1);
    setMinutes(d.getMinutes());
    setPeriod(d.getHours() >= 12 ? 'PM' : 'AM');
  }, [open, initial]);

  const composed = useMemo(() => {
    const d = new Date(selectedDate);
    const h24 = period === 'AM'
      ? (hours12 === 12 ? 0 : hours12)
      : (hours12 === 12 ? 12 : hours12 + 12);
    d.setHours(h24, minutes, 0, 0);
    return d;
  }, [selectedDate, hours12, minutes, period]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
            {t('news_schedule_dialog.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12px] text-text-muted">
            {t('news_schedule_dialog.subtitle')}
          </Dialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <CalendarBlock
              viewYear={viewYear}
              viewMonth={viewMonth}
              selectedDate={selectedDate}
              onChangeView={(y, m) => {
                setViewYear(y);
                setViewMonth(m);
              }}
              onSelectDate={setSelectedDate}
            />

            <div className="flex items-center gap-2">
              <TimeBlock
                hours12={hours12}
                minutes={minutes}
                onChangeHours={setHours12}
                onChangeMinutes={setMinutes}
              />
              <PeriodToggle value={period} onChange={setPeriod} />
            </div>
          </div>

          <div className="mt-4 rounded-md bg-bg-primary px-3 py-2 text-[12px] text-text-secondary">
            <Trans
              i18nKey="news_schedule_dialog.publish_at"
              values={{ format: formatScheduleLocalized(composed, t) }}
              components={{ b: <span className="font-medium text-text-strong" /> }}
            />
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                {t('news_schedule_dialog.cancel')}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onSchedule(composed);
                onOpenChange(false);
              }}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {t('news_schedule_dialog.submit')}
            </button>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Calendar (date block) ──────────────────────────────────────────────────

interface CalendarBlockProps {
  viewYear: number;
  viewMonth: number;
  selectedDate: Date;
  onChangeView: (year: number, month: number) => void;
  onSelectDate: (date: Date) => void;
}

function CalendarBlock({
  viewYear,
  viewMonth,
  selectedDate,
  onChangeView,
  onSelectDate,
}: CalendarBlockProps) {
  const { t } = useTranslation();
  const today = useMemo(() => stripTime(new Date()), []);
  // Сегодняшний день в Yek-календаре (UTC+5). UI работает с local Date'ами
  // но сравнение «прошлое/будущее» делаем по Yek-зоне, чтобы юзер в любой
  // timezone видел одинаковое поведение (рабочее окно сервера тоже в Yek).
  const todayYek = useMemo(() => yekTodayKey(), []);
  const days = useMemo(
    () => buildCalendarDays(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  // Запрещаем переход на прошлые месяцы — server отвергнет любые scheduled
  // в прошлом. UX-cue: prev-стрелка disabled когда мы уже в текущем месяце.
  const atCurrentMonth =
    viewYear === todayYek.y && viewMonth === todayYek.m;
  const inPastMonth =
    viewYear < todayYek.y || (viewYear === todayYek.y && viewMonth < todayYek.m);

  const goPrev = () => {
    if (atCurrentMonth || inPastMonth) return;
    if (viewMonth === 0) onChangeView(viewYear - 1, 11);
    else onChangeView(viewYear, viewMonth - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) onChangeView(viewYear + 1, 0);
    else onChangeView(viewYear, viewMonth + 1);
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-primary/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <NavButton
          onClick={goPrev}
          disabled={atCurrentMonth}
          ariaLabel={t('news_schedule_dialog.prev_month')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </NavButton>
        <span className="text-[13px] font-medium text-text-strong">
          {t(`news_schedule_dialog.${MONTH_KEYS[viewMonth]}`)} {viewYear}
        </span>
        <NavButton onClick={goNext} ariaLabel={t('news_schedule_dialog.next_month')}>
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </NavButton>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {WEEKDAY_KEYS.map((key) => (
          <div key={key} className="py-1">
            {t(`news_schedule_dialog.${key}`)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map(({ date, otherMonth }) => {
          const isToday = date.getTime() === today.getTime();
          const isSelected = isSameDay(date, selectedDate);
          // Прошедшие дни (по Yek) недоступны для выбора — server всё равно
          // отвергнет `send_at_not_in_future`. Навигацию на старые месяцы
          // оставляем (как ask юзера) — там просто все ячейки disabled.
          const isPast = compareYmd(dateToYmd(date), todayYek) < 0;
          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => {
                if (isPast) return;
                onSelectDate(stripTime(date));
              }}
              disabled={isPast}
              aria-disabled={isPast}
              className={cn(
                'h-8 rounded-md text-[12.5px] tabular-nums outline-none transition-colors',
                isPast
                  ? 'cursor-not-allowed text-text-muted/30'
                  : isSelected
                    ? 'bg-accent-clay font-medium text-white'
                    : otherMonth
                      ? 'text-text-muted/40 hover:bg-bg-hover/40 hover:text-text-muted'
                      : 'text-text-primary hover:bg-bg-hover hover:text-text-strong',
                !isPast && !isSelected && isToday && 'ring-1 ring-accent-clay/70',
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Yek-date helpers (для disable past) ────────────────────────────────────

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** (y, m, d) сегодняшнего дня по Екатеринбургу (UTC+5). */
function yekTodayKey(): Ymd {
  const yekNow = new Date(Date.now() + 5 * 3600 * 1000);
  return {
    y: yekNow.getUTCFullYear(),
    m: yekNow.getUTCMonth(),
    d: yekNow.getUTCDate(),
  };
}

function dateToYmd(d: Date): Ymd {
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

interface NavButtonProps {
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}

function NavButton({ onClick, ariaLabel, disabled, children }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md',
        'outline-none transition-colors',
        disabled
          ? 'cursor-not-allowed text-text-muted/30'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      {children}
    </button>
  );
}

// ── Time block (HH:MM) ─────────────────────────────────────────────────────

interface TimeBlockProps {
  hours12: number;
  minutes: number;
  onChangeHours: (n: number) => void;
  onChangeMinutes: (n: number) => void;
}

function TimeBlock({ hours12, minutes, onChangeHours, onChangeMinutes }: TimeBlockProps) {
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center gap-1 rounded-lg',
        'border border-border-subtle bg-bg-primary/40 p-1.5',
      )}
    >
      <NumberField value={hours12} min={1} max={12} onChange={onChangeHours} />
      <span className="text-[15px] font-medium text-text-muted">:</span>
      <NumberField value={minutes} min={0} max={59} onChange={onChangeMinutes} />
    </div>
  );
}

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function NumberField({ value, min, max, onChange }: NumberFieldProps) {
  const [text, setText] = useState(pad2(value));

  // Sync external value → displayed text (incl. при открытии диалога).
  useEffect(() => {
    setText(pad2(value));
  }, [value]);

  const commit = (raw: string) => {
    const num = parseInt(raw, 10);
    if (isNaN(num)) {
      setText(pad2(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    onChange(clamped);
    setText(pad2(clamped));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 2))}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          commit(String(Math.min(max, value + 1)));
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          commit(String(Math.max(min, value - 1)));
        }
      }}
      className={cn(
        'w-9 rounded-md bg-transparent py-1 text-center text-[15px] font-medium tabular-nums',
        'text-text-strong outline-none',
        'focus:bg-bg-hover',
      )}
    />
  );
}

// ── AM/PM toggle ───────────────────────────────────────────────────────────

interface PeriodToggleProps {
  value: Period;
  onChange: (p: Period) => void;
}

function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div className="flex rounded-lg border border-border-subtle bg-bg-primary/40 p-0.5">
      <PeriodOption active={value === 'AM'} onClick={() => onChange('AM')}>
        AM
      </PeriodOption>
      <PeriodOption active={value === 'PM'} onClick={() => onChange('PM')}>
        PM
      </PeriodOption>
    </div>
  );
}

interface PeriodOptionProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function PeriodOption({ active, onClick, children }: PeriodOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1 text-[12.5px] font-medium outline-none transition-colors',
        active
          ? 'bg-accent-clay text-white'
          : 'text-text-muted hover:text-text-strong',
      )}
    >
      {children}
    </button>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Дефолт: +1 час от сейчас, округлено вниз до минут. */
function defaultStart(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, d.getMinutes(), 0, 0);
  return d;
}

function stripTime(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function buildCalendarDays(
  year: number,
  month: number,
): { date: Date; otherMonth: boolean }[] {
  const firstOfMonth = new Date(year, month, 1);
  // Хотим Пн=0 ... Вс=6, в JS getDay() даёт Вс=0...Сб=6 — сдвиг на -1 mod 7.
  const firstDayOfWeek = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - firstDayOfWeek);

  const out: { date: Date; otherMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({ date: d, otherMonth: d.getMonth() !== month });
  }
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatScheduleLocalized(d: Date, t: TFunction): string {
  const today = stripTime(new Date());
  const target = stripTime(d);
  const dayDiff = Math.round((target.getTime() - today.getTime()) / 86400000);

  const h12 = ((d.getHours() + 11) % 12) + 1;
  const period = d.getHours() >= 12 ? 'PM' : 'AM';
  const time = `${h12}:${pad2(d.getMinutes())} ${period}`;

  if (dayDiff === 0) return t('news_schedule_dialog.schedule_today', { time });
  if (dayDiff === 1) return t('news_schedule_dialog.schedule_tomorrow', { time });
  if (dayDiff === -1) return t('news_schedule_dialog.schedule_yesterday', { time });
  const month = t(`news_schedule_dialog.${MONTH_GEN_KEYS[d.getMonth()]}`);
  return t('news_schedule_dialog.schedule_other', { day: d.getDate(), month, time });
}
