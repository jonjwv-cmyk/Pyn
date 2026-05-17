import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Clock,
  Database,
  LogOut,
  Monitor,
  RefreshCw,
  Settings,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format-time';
import { useSessionRemaining } from '@/lib/use-session-remaining';

interface UserPopupMenuProps {
  /** Заголовок: имя/логин (greyed). */
  username: string;
  desktopVersion: string;
  androidVersion: string;
  /** Версия БД и её дата (для combined row). */
  dbVersion: string;
  dbDate: string;
  /** true пока refresh базы идёт — RefreshCw spin + кнопка disabled. */
  dbLoading?: boolean;
  /** Status-сообщение под строкой базы («Проверяем…» / «База актуальна» / …). */
  dbToast?: string | null;
  /** Цвет toast'а — `'info'` muted-clay, `'error'` — danger. */
  dbToastKind?: 'info' | 'error';
  onRefreshDb: () => void;
  /** Открыть экран Settings (full-screen overlay). Виден всем — внутри
   *  Settings уже свой role-фильтр для подсекций. */
  onOpenSettings: () => void;
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
  dbLoading = false,
  dbToast = null,
  dbToastKind = 'info',
  onRefreshDb,
  onOpenSettings,
  onLogout,
  children,
}: UserPopupMenuProps) {
  const { remainingMs, hasInfo, extensionsUsed, extensionsMax } = useSessionRemaining();
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
          <div className="px-2.5 pt-1.5 pb-0.5 text-[12px] text-text-muted truncate">
            {username}
          </div>
          {hasInfo && (
            <div
              className={cn(
                'flex items-center gap-1.5 px-2.5 pb-1.5 text-[11px] text-text-muted',
                'tabular-nums',
              )}
            >
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              <span className="text-text-secondary">{formatDuration(remainingMs)}</span>
              <span className="text-text-muted">·</span>
              {/* «0» — нулевая (свежая, без продлений); «1/2/3» — после
                   соответствующего продления. После 3-й server тайм-аутнёт
                   сессию → global auth-handler уведёт на QR-login. */}
              <span title="Номер сессии в этом окне (0 = без продлений)">
                сессия {extensionsUsed} / {extensionsMax}
              </span>
            </div>
          )}

          <Divider />

          <ActionRow icon={Settings} label="Настройки" onClick={onOpenSettings} />

          <Divider />

          <VersionRow icon={Monitor} label="Pyn Desktop" value={desktopVersion} />
          <VersionRow icon={Smartphone} label="Pyn Android" value={androidVersion} />
          <DbVersionRow
            version={dbVersion}
            date={dbDate}
            loading={dbLoading}
            onRefresh={onRefreshDb}
          />
          {dbToast && (
            <div
              className={cn(
                'px-2 pb-1.5 text-[11px] tabular-nums',
                'animate-in fade-in-0 slide-in-from-top-0.5 duration-200',
                dbToastKind === 'error' ? 'text-danger' : 'text-accent-clay',
              )}
            >
              {dbToast}
            </div>
          )}

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
  variant?: 'default' | 'danger';
  onClick: () => void;
}

function ActionRow({ icon: Icon, label, variant = 'default', onClick }: ActionRowProps) {
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
  loading: boolean;
  onRefresh: () => void;
}

/**
 * База данных — версия + дата + кнопка проверки/обновления в одной строке.
 * Refresh не закрывает popup при клике (preventDefault). Во время loading
 * иконка крутится, нижняя полоса в строке показывает прогресс indeterminate.
 */
function DbVersionRow({ version, date, loading, onRefresh }: DbVersionRowProps) {
  return (
    <div
      className={cn(
        'relative flex h-8 items-center gap-2 rounded-md px-2 text-[12px]',
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
          if (!loading) onRefresh();
        }}
        disabled={loading}
        aria-label="Проверить и обновить базу"
        title={loading ? 'Проверяем…' : 'Проверить новую версию'}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded',
          'text-text-muted transition-colors',
          'hover:bg-bg-pressed hover:text-text-strong',
          'disabled:cursor-default disabled:opacity-100',
        )}
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5', loading && 'animate-spin text-accent-clay')}
          strokeWidth={1.75}
        />
      </button>
      {loading && (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full">
          <div className="mol-progress-bar h-full w-1/3 rounded-full bg-accent-clay" />
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />;
}
