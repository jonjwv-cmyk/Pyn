interface DateDividerProps {
  label: string;
}

/**
 * **Невидимый** sentinel-якорь для даты. Inline-разделители в ленте отключены
 * по UX-решению — день показывается только через плавающий `DayLabelPill`
 * при скролле (Telegram-style). Этот компонент рендерит 0-height элемент
 * с `data-day-label`, который `useScrollDayPill` ищет в DOM, чтобы решать
 * какой label показать в пилюле.
 *
 * Зачем не убрать компонент полностью: caller-логика (chat + news feed) уже
 * группирует сообщения по dayKey и нуждается в DOM-якоре для каждой группы.
 * Минимально-инвазивный fix — оставить компонент, но без visual.
 */
export function DateDivider({ label }: DateDividerProps) {
  return (
    <div
      data-day-label={label}
      aria-hidden
      className="h-0 w-full overflow-hidden"
    />
  );
}
