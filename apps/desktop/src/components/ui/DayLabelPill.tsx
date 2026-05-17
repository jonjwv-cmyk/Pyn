import { cn } from '@/lib/cn';

interface DayLabelPillProps {
  /** Текст pill'a (например, "Сегодня"). Пусто/null → pill скрыт. */
  label: string | null;
  /** Видимость с авто-fadeout. Управляется родителем по scroll-событиям. */
  visible: boolean;
}

/**
 * Плавающая sticky-«пилюля» с датой текущего видимого пакета сообщений.
 * Появляется при скроллинге, исчезает через ~1.2с после остановки.
 *
 * Telegram-style: пилл крепится к верхней зоне scroll-области и обновляется
 * по мере скроллинга. Родитель отслеживает `data-day-label` атрибуты на
 * inline-`DateDivider`'ах и передаёт label/visible.
 */
export function DayLabelPill({ label, visible }: DayLabelPillProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2',
        'transition-opacity duration-200',
        label && visible ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={!label || !visible}
    >
      <span
        className={cn(
          'inline-block rounded-full border border-border-default bg-bg-elevated/90 backdrop-blur-[2px]',
          'px-3 py-0.5 text-[11px] font-medium tracking-[0.005em] text-text-strong',
          'shadow-md',
        )}
      >
        {label}
      </span>
    </div>
  );
}
