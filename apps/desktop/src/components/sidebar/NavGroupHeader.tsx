interface NavGroupHeaderProps {
  label: string;
  collapsed: boolean;
}

/**
 * Заголовок группы разделов в сайдбаре. Sentence case (не CAPS) — мелкий,
 * приглушённый, как у Linear/Figma/Claude/Notion 2026; выровнен по левому
 * рейлу (line-12, как иконки nav).
 *
 * В collapsed текста нет — рендерим тонкую линию-разделитель по центру
 * узкого рейла, чтобы группы оставались визуально разделены без подписи.
 */
export function NavGroupHeader({ label, collapsed }: NavGroupHeaderProps) {
  // Высота фиксирована (h-7) в ОБОИХ режимах — иначе при сворачивании сайдбара
  // высокий текст-заголовок схлопывается в тонкую линию, и пункты ниже «уезжают»
  // вверх. Фикс-высота держит их ровно на месте (как канон-пилюли снизу).
  if (collapsed) {
    return (
      <div className="flex h-7 items-center justify-center" aria-hidden>
        <span className="h-px w-5 bg-border-subtle/60" />
      </div>
    );
  }
  return (
    <div className="flex h-7 select-none items-end px-1.5 pb-1 text-[11px] font-medium leading-none tracking-[-0.005em] text-text-muted/70">
      {label}
    </div>
  );
}
