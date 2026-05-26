interface EvrazLogoProps {
  /** CSS height value. Default `0.72em` — точная cap-height bold sans-serif,
   *  чтобы inline SVG с `vertical-align: baseline` ставил нижнюю полоску
   *  ровно на baseline текста, а верхнюю — на cap-line. */
  height?: string;
  className?: string;
}

/**
 * Знак Евраза — ТОЛЬКО три полоски, без текста. Текст «ЕВРАЗ» теперь
 * идёт обычным шрифтом в составе заголовка, чтобы вся надпись
 * «ЕВРАЗ ГРАФИК ДОСТАВКИ …» была одним типографическим объектом.
 *
 * Геометрия: viewBox 50×44 tight (без padding), 3 полоски h=10 gap=7 —
 * top stripe прижата к y=0, bottom — к y=34 (нижний край y=44 = bottom
 * viewBox). При rendered height = cap-height текста, верх SVG ложится
 * на cap-line, низ — на baseline. Полоски «обрамляют» строку букв.
 */
export function EvrazLogo({ height = '0.72em', className }: EvrazLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 50 44"
      style={{
        height,
        width: 'auto',
        userSelect: 'none',
        display: 'inline-block',
        verticalAlign: 'baseline',
      }}
      className={className}
      fill="none"
      role="img"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="50" height="10" fill="#F4B028" />
      <rect x="0" y="17" width="50" height="10" fill="#F08020" />
      <rect x="0" y="34" width="50" height="10" fill="#E15428" />
    </svg>
  );
}
