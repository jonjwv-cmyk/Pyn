import { useTranslation } from 'react-i18next';
import type { Role } from '@pyn/core';
import {
  NAV_FEED,
  NAV_FLOW,
  NAV_VGH,
  NAV_TRANSPORT,
  NAV_LOG,
  NAV_SECTIONS,
  NAV_WORKSPACE_BEFORE_TABLES,
} from '@/lib/nav-sections';
import { cn } from '@/lib/cn';
import { formatDbDate } from '@/lib/mol-format';
import { refreshPersonsFromServer } from '@/lib/persons-repo';
import { usePersonsStore } from '@/lib/persons-store';
import { refreshWarehousesFromServer } from '@/lib/warehouses-repo';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { usePresenceStore, useUiStateStore } from '@/lib/stores';
import type { NavSection, NavSectionId } from '@/types/nav';
import { SessionExpiryPill } from './SessionExpiryPill';
import { SidebarHeader } from './SidebarHeader';
import { NavItem } from './NavItem';
import { NavGroupHeader } from './NavGroupHeader';
import { BaseNavRow } from './BaseNavRow';
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
  showAi: boolean;
  /**
   * Показывать ли раздел «Поток» (β) — собственный табличный реестр (миграция
   * с Google Sheets). На время разработки виден только admin/developer, как
   * кнопка ИИ, чтобы рабочие пользователи не видели незавершённый раздел.
   */
  showFlow: boolean;
  /** Показывать ли раздел «ВГХ» — тот же admin/developer-контур, что «Поток». */
  showVgh: boolean;
  /** Показывать ли раздел «LOG» (журнал выгрузок) — тот же admin/developer-контур. */
  showLog: boolean;
  onToggleCollapsed: () => void;
  onAiClick: () => void;
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
  showAi,
  showFlow,
  showVgh,
  showLog,
  onToggleCollapsed,
  onAiClick,
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

  // Метадата единой базы «Контакты» (persons) — для попап-меню. МОЛ — её
  // производное, отдельной базы МОЛ больше нет.
  const molMeta = usePersonsStore((s) => s.meta);
  const molStatus = usePersonsStore((s) => s.status);
  // Складская база («Цеха») — версия/дата/статус для строки «База данных Цеха».
  const whMeta = useWarehousesStore((s) => s.meta);
  const whStatus = useWarehousesStore((s) => s.status);
  const molOutcome = usePersonsStore((s) => s.lastRefreshOutcome);
  const whOutcome = useWarehousesStore((s) => s.lastRefreshOutcome);

  // §pyn-1.2.42 — self-status из единого presenceStore (раньше был hardcoded
  // 'online'). Source of truth — server через heartbeat response → setOne.
  const myPresence = usePresenceStore((s) =>
    userLogin ? s.byLogin[userLogin]?.status ?? 'online' : 'online',
  );

  // State выбранной таблицы/вкладки — persist'ится в ui-state-store, чтобы
  // и Sidebar (table-nav-items), и TablesScreen (webview) читали единый источник.
  const setActiveTable = useUiStateStore((s) => s.setActiveTable);
  const baseTab = useUiStateStore((s) => s.baseTab);
  const setBaseTab = useUiStateStore((s) => s.setBaseTab);

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
  // То же сообщение под строкой базы «Цеха» (склады) — те же i18n-ключи.
  const whToast: string | null =
    whStatus === 'loading'
      ? t('sidebar_extra.version_checking')
      : whOutcome === 'up-to-date'
        ? t('sidebar_extra.db_current')
        : whOutcome === 'updated'
          ? t('sidebar_extra.db_updated')
          : whOutcome === 'error'
            ? t('sidebar_extra.db_error')
            : null;
  const collapsedWidth = computeCollapsedWidth(sections);
  const width = collapsed ? collapsedWidth : EXPANDED_WIDTH;

  // «Рабочее» раскладываем по частоте: График и Хранилище достаём поимённо, чтобы
  // расставить их в новом порядке (График — над Google-таблицами, Хранилище — внизу).
  const navSchedule = NAV_WORKSPACE_BEFORE_TABLES.find((s) => s.id === 'proba');
  const navVault = NAV_WORKSPACE_BEFORE_TABLES.find((s) => s.id === 'vault');

  // Один пункт nav с учётом dynamic badge'а (merge из `sections`).
  const renderNavItem = (section: NavSection, textOnly = false) => {
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
        textOnly={textOnly}
        iconColor={merged.iconColor}
        muted={merged.muted}
      />
    );
  };

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-bg-deep',
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
          showAi={showAi}
          onToggleCollapsed={onToggleCollapsed}
          onAiClick={onAiClick}
        />
      </div>

      <div className="h-1 shrink-0" />

      {/* §2026-05-29 — профиль + статус-пиллы перенесены НАВЕРХ (под сворачивание),
          по запросу. Аватар сразу под кнопкой сворачивания, ниже — команда /
          обновление / сессия / связь. (Раньше весь стек был внизу.) */}
      <div className="px-1.5 pb-1">
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
            void refreshPersonsFromServer({ force: true });
          }}
          warehouseDbVersion={whMeta ? `v${whMeta.version}` : '—'}
          warehouseDbDate={whMeta ? formatDbDate(whMeta.updatedAt) : t('sidebar_extra.db_not_loaded')}
          warehouseDbLoading={whStatus === 'loading'}
          warehouseDbToast={whToast}
          warehouseDbToastKind={whOutcome === 'error' ? 'error' : 'info'}
          onRefreshWarehouseDb={() => {
            void refreshWarehousesFromServer({ force: true });
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
      {userLogin && <TeamPill myLogin={userLogin} myRole={userRole} collapsed={collapsed} />}
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
      <div className="px-1.5">
        <SessionExpiryPill collapsed={collapsed} />
      </div>

      <div className="h-2 shrink-0" />

      <nav className="flex flex-col gap-0.5 px-1.5">
        {/* Порядок по ЧАСТОТЕ работы (юзер 2026-06-07): ежедневный «Поток»-контур наверху,
            ежемесячное/архивное — ниже. Поток → ВГХ → База → ЛОГ → График → Google-таблицы
            (ОТИФ/Workflow) → Хранилище. Заголовков нет — основное не подписываем (Linear). */}

        {/* §flow-β — «Поток» (собственный табличный реестр, миграция с Google Sheets):
            каждый день формируем план/отчёт — главный раздел. admin/developer-only. */}
        {showFlow && renderNavItem(NAV_FLOW)}

        {/* §vgh — «ВГХ» (вес/габариты): прямая связь с «Потоком», работаем часто. */}
        {showVgh && renderNavItem(NAV_VGH)}
        {showVgh && renderNavItem(NAV_TRANSPORT)}

        {/* «База» (Контакты/МОЛы / Склады) — частые проверки в течение дня + при «Потоке».
            Пункт с hover-флайаутом листов; выбор листа → setBaseTab + переход. */}
        <BaseNavRow
          collapsed={collapsed}
          active={activeSection === 'mol'}
          baseTab={baseTab}
          onPick={(t) => {
            setBaseTab(t);
            onSectionClick('mol');
          }}
        />

        {/* §log — «LOG» (журнал прогонов выгрузки): глянуть по ходу дня. admin-контур. */}
        {showLog && renderNavItem(NAV_LOG)}

        {/* «График» — реже, на месяц (если вопросы). */}
        {navSchedule && renderNavItem(navSchedule)}

        {/* Google-таблицы: ОТИФ5 (закрытие месяца) — сверху, Workflow (почти не используется,
            скоро уберём) — ниже (сортировка внутри TableNavItems). Hover-flyout со вкладками. */}
        <TableNavItems
          collapsed={collapsed}
          activeSection={activeSection}
          onPick={(sectionId, fileId, tabName) => {
            setActiveTable(fileId, tabName);
            onSectionClick(sectionId);
          }}
        />

        {/* «Хранилище» — вспомогательное, внизу рабочей группы. */}
        {navVault && renderNavItem(navVault)}

        {/* Группа «Лента»: Чаты, Новости. */}
        <NavGroupHeader label={t('sidebar.group_feed')} collapsed={collapsed} />
        {NAV_FEED.map((s) => renderNavItem(s, true))}
      </nav>

      {/* Flex spacer — низ остаётся пустым: профиль + статус-пиллы перенесены
          наверх (под сворачивание), по запросу 2026-05-29. */}
      <div className="flex-1" />
    </aside>
  );
}
