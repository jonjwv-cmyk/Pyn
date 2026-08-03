import type { ReactNode } from 'react';

interface WorkspaceCardProps {
  children: ReactNode;
}

/**
 * «Плавающая карточка» рабочей области (Linear-shell). Хром приложения —
 * сайдбар + верхняя панель экрана — живёт на тёмной подложке (bg-deep), а
 * контент (body) рендерится в этой приподнятой карточке bg-surface с тонким
 * border'ом и мягкой тенью. Шапка экрана рендерится НАД карточкой, прямо на
 * подложке (в слое сайдбара). Gutter: по бокам + снизу + лёгкий сверху, чтобы
 * карточка «парила» отдельно от верхней панели.
 */
export function WorkspaceCard({ children }: WorkspaceCardProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 px-2 pb-2 pt-1">
      <div className="pyn-workspace-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
        {children}
      </div>
    </div>
  );
}
