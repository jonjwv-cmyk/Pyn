import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronRight,
  Database,
  Globe,
  LogOut,
  Monitor,
  Palette,
  RefreshCw,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface UserPopupMenuProps {
  /** Заголовок: имя/логин (greyed). */
  username: string;
  desktopVersion: string;
  androidVersion: string;
  /** Версия БД и её дата (для combined row). */
  dbVersion: string;
  dbDate: string;
  onRefreshDb: () => void;
  onAccountSettings: () => void;
  onLanguage: () => void;
  onAppearance: () => void;
  onLogout: () => void;
  /** Trigger element (обычно BottomUserRow). */
  children: ReactNode;
}

/**
 * Popup профиля. Открывается из bottom user-row.
 *
 *   username                              ← greyed header
 *   ───
 *   [⚙] Аккаунт настройки
 *   ───
 *   [🌐] Язык                     ›
 *   [🎨] Оформление               ›
 *   ───
 *   [🖥] Pyn Desktop      v0.0.1
 *   [📱] Pyn Android      v0.0.1
 *   [💾] База данных  v1.2 16.05  [↻]   ← refresh inside item
 *   ───
 *   [⎋] Выйти                              ← Danger color
 */
export function UserPopupMenu({
  username,
  desktopVersion,
  androidVersion,
  dbVersion,
  dbDate,
  onRefreshDb,
  onAccountSettings,
  onLanguage,
  onAppearance,
  onLogout,
  children,
}: UserPopupMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            'z-50 w-[272px] rounded-xl',
            'border border-border-default bg-bg-elevated',
            'p-1.5 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        >
          <div className="px-2.5 py-1.5 text-[12px] text-text-muted truncate">{username}</div>

          <Divider />

          <ActionRow icon={Settings} label="Аккаунт настройки" onClick={onAccountSettings} />

          <Divider />

          <ActionRow icon={Globe} label="Язык" trailingChevron onClick={onLanguage} />
          <ActionRow icon={Palette} label="Оформление" trailingChevron onClick={onAppearance} />

          <Divider />

          <VersionRow icon={Monitor} label="Pyn Desktop" value={desktopVersion} />
          <VersionRow icon={Smartphone} label="Pyn Android" value={androidVersion} />
          <DbVersionRow version={dbVersion} date={dbDate} onRefresh={onRefreshDb} />

          <Divider />

          <ActionRow icon={LogOut} label="Выйти" onClick={onLogout} variant="danger" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface ActionRowProps {
  icon: LucideIcon;
  label: string;
  trailingChevron?: boolean;
  variant?: 'default' | 'danger';
  onClick: () => void;
}

function ActionRow({ icon: Icon, label, trailingChevron, variant = 'default', onClick }: ActionRowProps) {
  const danger = variant === 'danger';
  return (
    <DropdownMenu.Item
      onSelect={onClick}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 outline-none transition-colors',
        'text-[13px]',
        danger
          ? 'text-danger data-[highlighted]:bg-danger/15 data-[highlighted]:text-danger'
          : 'text-text-primary data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
      )}
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', danger ? 'text-danger' : 'text-text-muted')}
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate">{label}</span>
      {trailingChevron && <ChevronRight className="h-3.5 w-3.5 text-text-muted" />}
    </DropdownMenu.Item>
  );
}

interface VersionRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function VersionRow({ icon: Icon, label, value }: VersionRowProps) {
  return (
    <div className="flex h-7 items-center gap-2.5 px-2 text-[12px]">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="flex-1 text-text-secondary">{label}</span>
      <span className="text-text-secondary tabular-nums">{value}</span>
    </div>
  );
}

interface DbVersionRowProps {
  version: string;
  date: string;
  onRefresh: () => void;
}

/**
 * База данных — версия + дата + кнопка обновления в одной строке.
 * Refresh кнопка не закрывает popup при клике (e.preventDefault).
 */
function DbVersionRow({ version, date, onRefresh }: DbVersionRowProps) {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-[12px]',
        'group/db hover:bg-bg-hover transition-colors',
      )}
    >
      <Database className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="flex-1 truncate text-text-secondary">База данных</span>
      <span className="text-text-secondary tabular-nums">{version}</span>
      <span className="text-text-muted tabular-nums">{date}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRefresh();
        }}
        aria-label="Обновить базу данных"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded',
          'text-text-muted transition-colors',
          'hover:bg-bg-pressed hover:text-text-strong',
        )}
      >
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function Divider() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />;
}
