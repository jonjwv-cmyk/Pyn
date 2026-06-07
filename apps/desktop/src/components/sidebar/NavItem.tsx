import type { LucideIcon } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  onClick: () => void;
  /** Текстовый пункт без иконки (Лента: Чаты/Новости) — текст виден и в collapsed. */
  textOnly?: boolean;
  /** Постоянный цвет иконки (Tailwind-класс) — акцент раздела, как у Google-табов. */
  iconColor?: string;
  /** Приглушённый («сероватый, как бы не активный») вид — для уходящих разделов
   *  (Хранилище/Workflow): не мешают глазу. На hover/active светлеют как обычно. */
  muted?: boolean;
}

/**
 * Один пункт навигации.
 *
 * Layout: [Icon] [Badge?] [Label?]
 *   • Icon — фиксированная позиция (icon-box 28×28), не "прыгает" при collapse
 *   • Badge — inline сразу после icon (всегда, если badge > 0).
 *     Видим и в collapsed (узкий sidebar 80px достаточно для icon+badge),
 *     и в expanded (после label, prijaт к правому краю — ml-auto).
 *   • Label — visible только в expanded mode, плавно сжимается через max-width.
 *
 * В collapsed mode компонент обёрнут в Radix Tooltip — при hover подпись
 * раздела справа от иконки, не перекрытая курсором.
 */
export function NavItem({ icon: Icon, label, active, collapsed, badge, onClick, textOnly = false, iconColor, muted = false }: NavItemProps) {
  const showBadge = badge !== undefined && badge > 0;

  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 transition-colors',
        'hover:bg-bg-hover',
        muted ? 'text-text-muted/55 hover:text-text-secondary' : 'text-text-primary hover:text-text-strong',
        active && 'bg-bg-selected text-text-strong',
      )}
    >
      {/* Icon-box: justify-start — все элементы sidebar (mark, icon, avatar)
          выровнены по одной невидимой вертикальной линии слева, независимо
          от размера content'а. §pyn-1.2.54. */}
      {!textOnly && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-start">
          <Icon
            className={cn(
              'h-[18px] w-[18px] transition-colors',
              iconColor ??
                (active
                  ? 'text-accent-clay'
                  : muted
                    ? 'text-text-muted/45 group-hover:text-text-secondary'
                    : 'text-text-primary group-hover:text-text-strong'),
            )}
            strokeWidth={1.75}
          />
        </span>
      )}

      {/* Badge inline — виден и в collapsed, и в expanded.
          В collapsed: сразу за иконкой.
          В expanded: после label, prijаt к правому краю (ml-auto). */}
      {showBadge && collapsed && !textOnly && <Badge count={badge} />}

      {/* Label + expanded badge — анимируются через max-width при collapse */}
      <span
        className={cn(
          // Ширину лейбла гасим не max-width-анимацией (давала рывок: при
          // max-w 200→0 первую половину ничего не двигалось, потом снап), а
          // flex-1: доступная ширина сама плавно сжимается вместе с шириной
          // aside (CSS width-transition) → лейбл клипается плавно. Иконка
          // (shrink-0, justify-start) стоит на line-12. Гасим только opacity.
          'flex min-w-0 flex-1 items-center overflow-hidden',
          !textOnly && 'transition-opacity duration-200',
          !textOnly && (collapsed ? 'opacity-0' : 'opacity-100'),
        )}
      >
        <span
          className={cn(
            'truncate text-[13px] font-normal tracking-[-0.005em]',
            // textOnly (Лента: Чаты/Новости) — иконки нет, поэтому при выборе
            // красим в clay сам текст (как иконка clay'ится у icon-пунктов).
            textOnly && active && 'text-accent-clay',
          )}
        >
          {label}
        </span>
        {showBadge && <Badge count={badge} className="ml-auto shrink-0" />}
      </span>
    </button>
  );

  // textOnly (Чаты/Новости) показывают подпись и в collapsed → тултип не нужен.
  if (!collapsed || textOnly) return button;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={20}
          className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
        >
          {label}
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
