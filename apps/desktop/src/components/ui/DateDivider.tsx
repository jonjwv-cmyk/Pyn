interface DateDividerProps {
  label: string;
  /**
   * §pyn-1.2.54 — динамический top offset для sticky-позиционирования (px).
   * NewsFeed передаёт height pinned-overlay чтобы sticky divider останавливался
   * ПОД pinned-плашками, а не прятался за ними. ChatConversation не передаёт →
   * default 8px (top-2).
   */
  topOffset?: number;
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
export function DateDivider({ label, topOffset }: DateDividerProps) {
  // Сам span — sticky (не обёртка). `width: fit-content` + `mx-auto`
  // центрируют без flex'a (важно: sticky внутри flex с gap'ом иногда
  // криво работает в Chromium). top dynamic = topOffset px или 8px default.
  //
  // §2026-05-19 — z-index поднят до z-30: media (video/iframe/img) внутри
  // sticky-группы создавали свой composited stacking layer и перекрывали
  // pill при скролле (юзер: "закрывается видео или гифкой или фото").
  // z-30 выше fade-gradient'ов (z-10) и любых native media-layers.
  return (
    <span
      data-day-label={label}
      style={{ top: topOffset !== undefined ? `${topOffset}px` : undefined }}
      className={
        // §2026-05-19 — subtle pill: лёгкая полупрозрачная подложка в тон
        // фона + приглушённый текст. Дата читаема, но не выпрыгивает
        // акцентом — как и просил юзер.
        // top-2 fallback когда topOffset не передан (chat и др).
        // z-30 нужен чтобы pill был выше composited media layers (video/img
        // в группе). PinnedPill overlay z-30 — divider в DOM раньше, поэтому
        // overlay визуально побеждает при перекрытии (correct stacking).
        // Composer z-40 — выше divider'а (divider уходит под composer blur).
        'sticky z-30 mx-auto my-2 inline-block w-fit ' +
        (topOffset !== undefined ? '' : 'top-2 ') +
        'rounded-full bg-bg-elevated/40 px-2.5 py-0.5 text-[11px] ' +
        'font-medium tracking-[0.005em] text-text-muted backdrop-blur-[3px]'
      }
    >
      {label}
    </span>
  );
}
