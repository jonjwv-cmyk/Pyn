import * as Popover from '@radix-ui/react-popover';
import { WEEKDAYS, type Weekday } from '@/lib/schedule/types';

interface WeekdayPickerProps {
  value: Weekday;
  onChange: (weekday: Weekday) => void;
  children: React.ReactNode;
}

/**
 * Маленький popover для смены дня недели у строки цеха. 7 кнопок в ряд,
 * клик → меняет weekday + закрывает popover. Радус-стайл с clay-ring
 * на выбранном дне.
 */
export function WeekdayPicker({ value, onChange, children }: WeekdayPickerProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-lg border border-white/[0.08] bg-bg-elevated p-2 text-text-primary shadow-2xl outline-none"
        >
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((wd) => {
              const selected = wd === value;
              return (
                <Popover.Close asChild key={wd}>
                  <button
                    type="button"
                    onClick={() => onChange(wd)}
                    className={[
                      'flex h-7 w-7 items-center justify-center rounded text-[11px] font-semibold outline-none transition-colors',
                      selected
                        ? 'bg-accent-clay-bg text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                        : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                    ].join(' ')}
                  >
                    {wd}
                  </button>
                </Popover.Close>
              );
            })}
          </div>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
