import { Chrome, Globe, Palette, ServerCog, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isDeveloper, type Role } from '@pyn/core';
import { cn } from '@/lib/cn';

/** Идентификатор подсекции внутри Settings — добавляется по мере появления панелей. */
export type SettingsSubSection =
  | 'users'
  | 'language'
  | 'appearance'
  | 'google'
  | 'app-control';

interface SubItem {
  id: SettingsSubSection;
  /** i18n-ключ внутри `settings_sidebar.*`. */
  labelKey: string;
  icon: LucideIcon;
  /** Видим только developer'у — Пользователи и system-admin утилиты. */
  devOnly?: boolean;
  /** Заглушка — рендерится с opacity, выбрать нельзя. */
  comingSoon?: boolean;
}

const ALL_ITEMS: SubItem[] = [
  { id: 'users',        labelKey: 'users',       icon: Users,       devOnly: true },
  { id: 'language',     labelKey: 'language',    icon: Globe },
  { id: 'appearance',   labelKey: 'appearance',  icon: Palette },
  { id: 'google',       labelKey: 'google',      icon: Chrome },
  { id: 'app-control',  labelKey: 'app_control', icon: ServerCog,   devOnly: true },
];

interface SettingsSidebarProps {
  myRole: Role;
  activeId: SettingsSubSection;
  onSelect: (id: SettingsSubSection) => void;
}

/** Дефолтный пункт при заходе в Settings: developer → Пользователи, остальные → Язык. */
export function defaultSettingsSubSection(myRole: Role): SettingsSubSection {
  return isDeveloper(myRole) ? 'users' : 'language';
}

/**
 * Узкий sidebar внутри Settings (180px). Принципиально проще основного
 * Sidebar'а — нет collapse, нет badge'ей; только список пунктов с role-фильтром.
 *
 *   • Пользователи (+ системные admin-утилиты) — только developer
 *   • Язык / Оформление — всем
 *
 * Coming-soon пункты задизейблены (показываются для honesty roadmap'a;
 * выбрать нельзя).
 */
export function SettingsSidebar({ myRole, activeId, onSelect }: SettingsSidebarProps) {
  const { t } = useTranslation();
  const items = ALL_ITEMS.filter((item) => !item.devOnly || isDeveloper(myRole));
  return (
    <aside
      className={cn(
        // Без border-r — фон одинаковый с content area, граница невидима →
        // лаконичнее без неё (юзер визуально читает разделение по структуре
        // active-пункта, а не по линии).
        'flex w-[200px] shrink-0 flex-col gap-0.5 bg-bg-surface p-1.5',
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        const disabled = item.comingSoon === true;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!disabled) onSelect(item.id);
            }}
            disabled={disabled}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px]',
              'outline-none transition-colors',
              active
                ? 'bg-bg-hover text-text-strong'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
              // §2026-05-19 — убран `cursor-not-allowed` (юзер: на Win
              // рисует круг-перечёркнутый, ugly). Disabled state видно
              // через opacity-40 + soft hover suppress, без cursor change.
              disabled && 'opacity-40 hover:bg-transparent hover:text-text-secondary',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="flex-1 truncate">{t(`settings_sidebar.${item.labelKey}`)}</span>
            {disabled && (
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                {t('settings_sidebar.soon')}
              </span>
            )}
          </button>
        );
      })}
    </aside>
  );
}
