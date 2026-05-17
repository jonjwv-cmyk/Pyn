import { NAV_SECTIONS } from '@/lib/nav-sections';
import { cn } from '@/lib/cn';
import type { NavSection, NavSectionId } from '@/types/nav';
import { SidebarHeader } from './SidebarHeader';
import { NavItem } from './NavItem';
import { BottomUserRow } from './BottomUserRow';
import { UserPopupMenu } from './UserPopupMenu';

interface SidebarProps {
  collapsed: boolean;
  activeSection: NavSectionId;
  /** Имя текущего пользователя — рендерится в BottomUserRow. */
  username: string;
  /** 1-2 буквенные initials текущего пользователя. */
  initials: string;
  /**
   * Динамические unread-badge'и по section.id. App.tsx считает из stores
   * (chats unread, news unread). Если для section нет ключа — фиксированный
   * badge из NAV_SECTIONS (обычно 0).
   */
  badges?: Partial<Record<NavSectionId, number>>;
  onToggleCollapsed: () => void;
  onSearchClick: () => void;
  onSectionClick: (id: NavSectionId) => void;
  onLogout: () => void;
}

const EXPANDED_WIDTH = 200;
// Базовая collapsed-ширина — 80px чтобы macOS traffic-lights (span 16..68dp
// от окна) полностью вписались в sidebar. При большом badge'е sidebar
// расширяется через computeCollapsedWidth — цифры не наезжают на правый край.
const COLLAPSED_BASE_WIDTH = 80;

/**
 * Расчёт collapsed-ширины sidebar исходя из самого крупного badge'a в NAV.
 *
 * Layout NavItem в collapsed (горизонтально):
 *   [nav px 6] [btn px 6] [icon 28] [gap 6] [badge] [gap 6] [label = 0] [btn px 6] [nav px 6]
 *
 * Итого фикс: 12+12+28+12 = 64px + badge_width.
 * Badge: min-width 18, либо px-1.5 (12) + ≈7px × число символов (text-[11px]
 * tabular-nums). Display: "999+" если max > 999.
 */
function computeCollapsedWidth(sections: NavSection[]): number {
  const maxBadge = Math.max(0, ...sections.map((s) => s.badge ?? 0));
  if (maxBadge <= 0) return COLLAPSED_BASE_WIDTH;
  const display = maxBadge > 999 ? '999+' : String(maxBadge);
  const badgeWidth = Math.max(18, 12 + display.length * 7);
  return Math.max(COLLAPSED_BASE_WIDTH, 64 + badgeWidth);
}

/**
 * Sidebar — Linear-вдохновлённый компонент навигации.
 *
 * Vertical layout (top → bottom):
 *   1. **Drag region 44px** — top inset под macOS traffic-lights (даёт
 *      "дышащее" пространство между chrome и нашими элементами).
 *   2. **SidebarHeader** — collapse + search в одну row (выглядит как nav-item).
 *   3. **Spacer 4px** — лёгкий разрыв между header и nav items.
 *   4. **Nav items** — 5 разделов из NAV_SECTIONS.
 *
 * Ширина: 200px expanded / 80px collapsed, smooth CSS transition 220ms.
 */
export function Sidebar({
  collapsed,
  activeSection,
  username,
  initials,
  badges,
  onToggleCollapsed,
  onSearchClick,
  onSectionClick,
  onLogout,
}: SidebarProps) {
  // Sections с обновлёнными badges (dynamic поверх hardcoded из NAV_SECTIONS).
  const sections: NavSection[] = NAV_SECTIONS.map((s) => ({
    ...s,
    badge: badges?.[s.id] ?? s.badge,
  }));
  const collapsedWidth = computeCollapsedWidth(sections);
  const width = collapsed ? collapsedWidth : EXPANDED_WIDTH;

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-bg-surface',
        'border-r border-border-subtle',
        'transition-[width] duration-[220ms] ease-out',
      )}
      style={{ width }}
    >
      {/* Top inset 48px — единая «линия заголовка» по всему приложению (h-12).
          В Conversation и ChatList тот же h-12 содержит avatar/name/labels —
          здесь область пустая, чисто под macOS traffic-lights. */}
      <div className="drag-region h-12 shrink-0" />

      <div className="px-1.5">
        <SidebarHeader
          collapsed={collapsed}
          sidebarWidth={width}
          onToggleCollapsed={onToggleCollapsed}
          onSearchClick={onSearchClick}
        />
      </div>

      <div className="h-1 shrink-0" />

      <nav className="flex flex-col gap-0.5 px-1.5">
        {sections.map((section) => (
          <NavItem
            key={section.id}
            icon={section.icon}
            label={section.label}
            active={section.id === activeSection}
            collapsed={collapsed}
            badge={section.badge}
            onClick={() => onSectionClick(section.id)}
          />
        ))}
      </nav>

      {/* Flex spacer — придавливает user-row к низу */}
      <div className="flex-1" />

      {/* Bottom user row — открывает popup-меню профиля */}
      <div className="px-1.5 pb-1.5">
        <UserPopupMenu
          username={username}
          desktopVersion="v0.0.1"
          androidVersion="v0.0.1"
          dbVersion="v1.2"
          dbDate="17.05.2026"
          onAccountSettings={() => {
            /* TODO */
          }}
          onLanguage={() => {
            /* TODO */
          }}
          onAppearance={() => {
            /* TODO */
          }}
          onRefreshDb={() => {
            /* TODO */
          }}
          onLogout={onLogout}
        >
          <BottomUserRow
            username={username}
            initials={initials}
            presence="online"
            collapsed={collapsed}
          />
        </UserPopupMenu>
      </div>
    </aside>
  );
}
