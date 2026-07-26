import { PanelLeft } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { AiNavButton } from './AiNavButton';

interface SidebarHeaderProps {
  collapsed: boolean;
  sidebarWidth: number;
  showAi: boolean;
  onToggleCollapsed: () => void;
  onAiClick: () => void;
}

// Layout constants — должны совпадать с CSS classes ниже + outer wrapper.
const WRAPPER_PADDING_X = 6;  // outer <div className="px-1.5"> в Sidebar.tsx
const HEADER_PADDING_X = 4;   // px-1 = 4dp у самой шапки
const BUTTON_SIZE = 24;       // h-6 w-6 = 24dp
// Выравниваем тултип шапки ровно по тултипам NavItem (Хранилище/График…).
const TOOLTIP_GAP = 14;

/**
 * Top row sidebar — сворачивание + кнопка «Питомец» (плеер только у питомца).
 */
export function SidebarHeader({
  collapsed,
  sidebarWidth,
  showAi,
  onToggleCollapsed,
  onAiClick,
}: SidebarHeaderProps) {
  const { t } = useTranslation();
  const firstButtonRightX = WRAPPER_PADDING_X + HEADER_PADDING_X + BUTTON_SIZE;

  return (
    <div className="flex h-8 items-center gap-1 px-1">
      <IconButton
        icon={PanelLeft}
        tooltip={collapsed ? t('sidebar_extra.show_sidebar') : t('sidebar_extra.hide_sidebar')}
        tooltipSideOffset={sidebarWidth - firstButtonRightX + TOOLTIP_GAP}
        onClick={onToggleCollapsed}
      />
      {showAi && <AiNavButton collapsed={collapsed} onClick={onAiClick} />}
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
