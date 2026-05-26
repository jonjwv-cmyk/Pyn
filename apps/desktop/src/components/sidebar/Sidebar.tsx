import { useTranslation } from 'react-i18next';
import type { Role } from '@pyn/core';
import {
  NAV_SECTIONS,
  NAV_SECTIONS_AFTER_TABLES,
  NAV_SECTIONS_BEFORE_TABLES,
} from '@/lib/nav-sections';
import { cn } from '@/lib/cn';
import { formatDbDate } from '@/lib/mol-format';
import { refreshMolFromServer } from '@/lib/mol-repo';
import { useMolStore, usePresenceStore, useUiStateStore } from '@/lib/stores';
import type { NavSection, NavSectionId } from '@/types/nav';
import { ConnectivityIndicator } from './ConnectivityIndicator';
import { SessionExpiryPill } from './SessionExpiryPill';
import { SidebarHeader } from './SidebarHeader';
import { NavItem } from './NavItem';
import { BottomUserRow } from './BottomUserRow';
import { TableNavItems } from './TableNavItems';
import { TeamPill } from './TeamPill';
import { UpdateAvailablePill, type UpdatePillStage } from './UpdateAvailablePill';
import { UserPopupMenu } from './UserPopupMenu';

interface SidebarProps {
  collapsed: boolean;
  activeSection: NavSectionId;
  /** Имя текущего пользователя — рендерится в BottomUserRow. */
  username: string;
  /** 1-2 буквенные initials текущего пользователя. */
  initials: string;
  /** Login юзера — для цвета avatar fallback'a. */
  userLogin?: string;
  /** Роль — нужна попап-меню чтобы показать «Настройки» только developer'у. */
  userRole: Role;
  /** Зашифрованный URL аватарки + ключ + nonce (из `me()` response). */
  userAvatarUrl?: string;
  userAvatarBlobKey?: string;
  userAvatarBlobNonce?: string;
  /**
   * Динамические unread-badge'и по section.id. App.tsx считает из stores
   * (chats unread, news unread). Если для section нет ключа — фиксированный
   * badge из NAV_SECTIONS (обычно 0).
   */
  badges?: Partial<Record<NavSectionId, number>>;
  onToggleCollapsed: () => void;
  onSearchClick: () => void;
  onSectionClick: (id: NavSectionId) => void;
  /** Клик «Настройки» в попап-меню профиля — открывает Settings overlay. */
  onOpenSettings: () => void;
  onLogout: () => void;
  /**
   * Если есть доступное обновление — рендерим Pill над SessionExpiryPill.
   * State держится в App.tsx (download stage + bytes), Sidebar — pure render.
   */
  updatePill?: {
    stage: UpdatePillStage;
    bytes?: number;
    total?: number;
    onClick: () => void;
  };
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
  userLogin,
  userRole,
  userAvatarUrl,
  userAvatarBlobKey,
  userAvatarBlobNonce,
  badges,
  onToggleCollapsed,
  onSearchClick,
  onSectionClick,
  onOpenSettings,
  onLogout,
  updatePill,
}: SidebarProps) {
  const { t } = useTranslation();
  // Sections с обновлёнными badges (dynamic поверх hardcoded из NAV_SECTIONS).
  const sections: NavSection[] = NAV_SECTIONS.map((s) => ({
    ...s,
    badge: badges?.[s.id] ?? s.badge,
  }));

  // Метадата базы МОЛ — для попап-меню. `Sidebar` всегда rendered поверх
  // mol-store, поэтому subscribe здесь и пасуем в UserPopupMenu пропсами.
  const molMeta = useMolStore((s) => s.meta);
  const molStatus = useMolStore((s) => s.status);
  const molOutcome = useMolStore((s) => s.lastRefreshOutcome);

  // §pyn-1.2.42 — self-status из единого presenceStore (раньше был hardcoded
  // 'online'). Source of truth — server через heartbeat response → setOne.
  const myPresence = usePresenceStore((s) =>
    userLogin ? s.byLogin[userLogin]?.status ?? 'online' : 'online',
  );

  // State выбранной таблицы/вкладки — persist'ится в ui-state-store, чтобы
  // и Sidebar (table-nav-items), и TablesScreen (webview) читали единый источник.
  const setActiveTable = useUiStateStore((s) => s.setActiveTable);

  // Сообщение под строкой «База данных» в попапе — отражает прогресс/итог
  // последней проверки. Loading в приоритете (идёт прямо сейчас).
  const dbToast: string | null =
    molStatus === 'loading'
      ? t('sidebar_extra.version_checking')
      : molOutcome === 'up-to-date'
        ? t('sidebar_extra.db_current')
        : molOutcome === 'updated'
          ? t('sidebar_extra.db_updated')
          : molOutcome === 'error'
            ? t('sidebar_extra.db_error')
            : null;
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
        {NAV_SECTIONS_BEFORE_TABLES.map((section) => {
          const merged = sections.find((s) => s.id === section.id) ?? section;
          return (
            <NavItem
              key={merged.id}
              icon={merged.icon}
              label={merged.label}
              active={merged.id === activeSection}
              collapsed={collapsed}
              badge={merged.badge}
              onClick={() => onSectionClick(merged.id)}
            />
          );
        })}
        {/* Google-таблицы — между Хранилище и МОЛы. Каждая таблица — свой
            nav-item с hover-flyout справа со списком вкладок. */}
        <TableNavItems
          collapsed={collapsed}
          activeSection={activeSection}
          onPick={(sectionId, fileId, tabName) => {
            setActiveTable(fileId, tabName);
            onSectionClick(sectionId);
          }}
        />
        {NAV_SECTIONS_AFTER_TABLES.map((section) => {
          const merged = sections.find((s) => s.id === section.id) ?? section;
          return (
            <NavItem
              key={merged.id}
              icon={merged.icon}
              label={merged.label}
              active={merged.id === activeSection}
              collapsed={collapsed}
              badge={merged.badge}
              onClick={() => onSectionClick(merged.id)}
            />
          );
        })}
      </nav>

      {/* Flex spacer — придавливает user-row к низу */}
      <div className="flex-1" />

      {/* §pyn-1.2.43 — Team pill: другие admin/developer (без self) с presence.
          Источник правды для статусов — usePresenceStore. Реактивно
          обновляется при WS push presence_change. */}
      {userLogin && <TeamPill myLogin={userLogin} myRole={userRole} collapsed={collapsed} />}

      {/* Update pill — над SessionExpiryPill (юзер сначала видит апдейт,
          потом критический countdown). §pyn-1.2.54 — рендерится и в collapsed
          (компактный «Обновить» лейбл), чтобы не было layout-скачка при сворачивании. */}
      {updatePill && (
        <div className="px-1.5 pb-0.5">
          <UpdateAvailablePill
            stage={updatePill.stage}
            bytes={updatePill.bytes}
            total={updatePill.total}
            collapsed={collapsed}
            onClick={updatePill.onClick}
          />
        </div>
      )}

      {/* Session expiry pill — только когда продлений уже нет.
          §pyn-1.2.54 — collapsed показывает компактный «OFF» + timer, без скачков. */}
      <div className="px-1.5">
        <SessionExpiryPill collapsed={collapsed} />
      </div>

      {/* Connectivity status — над user row, отдельной полоской */}
      <div className="px-1.5">
        <ConnectivityIndicator collapsed={collapsed} />
      </div>

      {/* Bottom user row — открывает popup-меню профиля */}
      <div className="px-1.5 pb-1.5">
        <UserPopupMenu
          username={username}
          desktopVersion={`v${window.pyn?.appVersion ?? '0.0.0'}`}
          androidVersion="v2.5.13"
          dbVersion={molMeta ? `v${molMeta.version}` : '—'}
          dbDate={molMeta ? formatDbDate(molMeta.updatedAt) : t('sidebar_extra.db_not_loaded')}
          dbLoading={molStatus === 'loading'}
          dbToast={dbToast}
          dbToastKind={molOutcome === 'error' ? 'error' : 'info'}
          onOpenSettings={onOpenSettings}
          onRefreshDb={() => {
            void refreshMolFromServer({ force: true });
          }}
          onLogout={onLogout}
        >
          <BottomUserRow
            username={username}
            initials={initials}
            login={userLogin}
            avatarUrl={userAvatarUrl}
            avatarBlobKey={userAvatarBlobKey}
            avatarBlobNonce={userAvatarBlobNonce}
            presence={myPresence}
            collapsed={collapsed}
          />
        </UserPopupMenu>
      </div>
    </aside>
  );
}
