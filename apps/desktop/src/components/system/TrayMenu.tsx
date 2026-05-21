import { useEffect } from 'react';
import { LogOut, Settings, SquareArrowOutUpRight, type LucideIcon } from 'lucide-react';

/**
 * Custom tray menu в popup BrowserWindow. Кастомное UI вместо native
 * Windows context menu — rounded corners, accent hover, в стиле основного
 * приложения. Открывается через right-click на tray icon.
 *
 * Items:
 *   • Открыть Pyn — показать главное окно
 *   • Настройки — показать главное окно + открыть Settings overlay
 *   • Выйти — quit приложения (единственный способ полностью закрыть Pyn)
 */
export function TrayMenu() {
  // Esc / клик вне окна → закрыть меню (blur handler в main process).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.pyn?.tray?.closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-2">
      <div className="w-full overflow-hidden rounded-2xl border border-stroke-soft bg-bg-surface shadow-2xl">
        <div className="py-1.5">
          <MenuItem
            icon={SquareArrowOutUpRight}
            label="Открыть Pyn"
            onClick={() => void window.pyn?.tray?.show()}
          />
          <MenuItem
            icon={Settings}
            label="Настройки"
            onClick={() => void window.pyn?.tray?.openSettings()}
          />
          <div className="mx-3 my-1 h-px bg-stroke-soft" />
          <MenuItem
            icon={LogOut}
            label="Выйти"
            onClick={() => void window.pyn?.tray?.quit()}
            accent
          />
        </div>
      </div>
    </div>
  );
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  accent?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, accent }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent-clay/15 ${
        accent ? 'text-accent-clay' : 'text-text-primary'
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
