import { PanelLeft, Search } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface SidebarHeaderProps {
  collapsed: boolean;
  sidebarWidth: number;
  onToggleCollapsed: () => void;
  onSearchClick: () => void;
}

// Layout constants — должны совпадать с CSS classes ниже + outer wrapper.
const WRAPPER_PADDING_X = 6;  // outer <div className="px-1.5"> в Sidebar.tsx
const HEADER_PADDING_X = 4;   // px-1 = 4dp у самой шапки
const BUTTON_GAP = 4;         // gap-1 = 4dp между кнопками
const BUTTON_SIZE = 24;       // h-6 w-6 = 24dp
// Выравниваем тултипы шапки ровно по тултипам NavItem (Хранилище/График…):
// NavItem-кнопка во всю ширину колонки (правый край на sidebar_width−6), её
// tooltip `sideOffset=20` → tooltip на sidebar_width+14. Наша формула даёт
// tooltip на sidebar_width+TOOLTIP_GAP, поэтому GAP = 14 (а не 6).
const TOOLTIP_GAP = 14;

/**
 * Top row sidebar — collapse-toggle + search.
 *
 * Кнопки маленькие (24×24). Tooltips располагаются **за правым краем
 * sidebar** (одинаково с NavItem-tooltip'ами в collapsed mode) — это
 * унифицированный паттерн всего sidebar. Offset вычисляется динамически:
 *
 *   sideOffset = sidebarWidth − buttonRightX + TOOLTIP_GAP
 */
export function SidebarHeader({
  collapsed,
  sidebarWidth,
  onToggleCollapsed,
  onSearchClick,
}: SidebarHeaderProps) {
  const { t } = useTranslation();
  const firstButtonRightX = WRAPPER_PADDING_X + HEADER_PADDING_X + BUTTON_SIZE;
  const secondButtonRightX = firstButtonRightX + BUTTON_GAP + BUTTON_SIZE;

  return (
    <div className="flex h-8 items-center gap-1 px-1">
      <IconButton
        icon={PanelLeft}
        tooltip={collapsed ? t('sidebar_extra.show_sidebar') : t('sidebar_extra.hide_sidebar')}
        tooltipSideOffset={sidebarWidth - firstButtonRightX + TOOLTIP_GAP}
        onClick={onToggleCollapsed}
      />
      <IconButton
        icon={Search}
        tooltip={t('sidebar_extra.search')}
        tooltipSideOffset={sidebarWidth - secondButtonRightX + TOOLTIP_GAP}
        onClick={onSearchClick}
      />
    </div>
  );
}

interface IconButtonProps {
  icon: typeof PanelLeft;
  tooltip: string;
  tooltipSideOffset: number;
  onClick: () => void;
}

function IconButton({ icon: Icon, tooltip, tooltipSideOffset, onClick }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={tooltip}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded',
            'text-text-muted transition-colors',
            'hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={tooltipSideOffset}
          className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
        >
          {tooltip}
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
