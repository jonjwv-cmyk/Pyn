interface DateDividerProps {
  label: string;
}

/**
 * Telegram-style sticky date pill между группами сообщений разных дней.
 * Использует `position: sticky` — divider **прилипает** к верху scroll-
 * контейнера при прокрутке, и когда подходит следующий day-divider, тот
 * визуально «выталкивает» предыдущий вверх. Без отдельного floating-pill
 * (один и тот же элемент работает и как inline-разделитель, и как
 * floating header).
 *
 * Требования к parent'у: контейнер с `overflow-y: auto/scroll`, position
 * relative (или нет — sticky работает без неё, но удобнее).
 *
 * §2026-05-19 — переход с `useScrollDayPill` + `DayLabelPill` (отдельный
 * floating pill) на CSS sticky. Раньше divider был invisible-якорь, а pill
 * сверху рисовался отдельно с opacity-fade. Юзер: "не отдельно дубликат
 * вверху, а сам divider прилипает" → это как раз position: sticky.
 */
export function DateDivider({ label }: DateDividerProps) {
  // Сам span — sticky (не обёртка). `width: fit-content` + `mx-auto`
  // центрируют без flex'a (важно: sticky внутри flex с gap'ом иногда
  // криво работает в Chromium). top-2 = прилипает на 8px от верха
  // scroll-container'а.
  //
  // §2026-05-19 — z-index поднят до z-30: media (video/iframe/img) внутри
  // sticky-группы создавали свой composited stacking layer и перекрывали
  // pill при скролле (юзер: "закрывается видео или гифкой или фото").
  // z-30 выше fade-gradient'ов (z-10) и любых native media-layers.
  return (
    <span
      data-day-label={label}
      className={
        // §2026-05-19 — subtle pill: лёгкая полупрозрачная подложка в тон
        // фона + приглушённый текст. Дата читаема, но не выпрыгивает
        // акцентом — как и просил юзер.
        'sticky top-2 z-30 mx-auto my-2 inline-block w-fit ' +
        'rounded-full bg-bg-elevated/40 px-2.5 py-0.5 text-[11px] ' +
        'font-medium tracking-[0.005em] text-text-muted backdrop-blur-[3px]'
      }
    >
      {label}
    </span>
  );
}
