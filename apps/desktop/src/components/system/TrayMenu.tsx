import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut, Settings, SquareArrowOutUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Custom tray menu в popup BrowserWindow. Кастомное UI вместо native
 * Windows context menu — rounded corners, accent hover, в стиле основного
 * приложения.
 *
 * §pyn-1.2.29 — Полностью переделан под стиль `ScriptsDropdown` в
 * TablesScreen + danger-color для «Выйти» как в `UserPopupMenu` (sidebar).
 * Компактные h-8 кнопки, rounded-md, border-border-default + bg-bg-elevated.
 * Окно подогнано под фактический content (220x124) — без пустоты снизу.
 */
export function TrayMenu() {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.pyn?.tray?.closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={cn(
        'flex h-screen w-screen flex-col gap-0.5 overflow-hidden',
        // §pyn-1.2.32 — rounded-2xl (16px) вместо rounded-lg (8px). На Win где
        // transparent работает — углы более заметно скруглены; где не
        // работает — больше пиксельная разница между square окном и rounded
        // content, маскируется Electron hasShadow.
        'rounded-2xl border border-border-default bg-bg-elevated p-1 shadow-xl',
      )}
    >
      <MenuItem
        icon={SquareArrowOutUpRight}
        label={t('tray_menu.open')}
        onClick={() => void window.pyn?.tray?.show()}
      />
      <MenuItem
        icon={Settings}
        label={t('tray_menu.settings')}
        onClick={() => void window.pyn?.tray?.openSettings()}
      />
      <MenuItem
        icon={LogOut}
        label={t('tray_menu.quit')}
        onClick={() => void window.pyn?.tray?.quit()}
        danger
      />
    </div>
  );
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]',
        'outline-none transition-colors',
        danger
          ? 'text-danger hover:bg-danger/15'
          : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5 shrink-0', danger ? 'text-danger' : 'text-text-muted')}
        strokeWidth={1.75}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
