import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Ban,
  CheckCircle2,
  Edit3,
  Key,
  KeyRound,
  LogIn,
  MoreVertical,
  RotateCcw,
  Shield,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { cn } from '@/lib/cn';
import { formatFullYek } from '@/lib/format-time';
import {
  isDeveloper,
  resetPasswordLoginCounter,
  toggleUser,
  type Role,
  type UserSummary,
} from '@pyn/core';
import {
  ChangeLoginDialog,
  ChangeRoleDialog,
  DeleteUserConfirm,
  RenameUserDialog,
  ResetPasswordDialog,
} from './UserDialogs';
import { RoleBadge } from './RoleBadge';

interface UserListRowProps {
  user: UserSummary;
  myRole: Role;
  /** Логин текущего юзера — чтобы заблокировать self-destructive actions. */
  myLogin: string;
  /** Уведомление родителю (toast в UsersPanel header). */
  onStatusChange: (msg: string) => void;
  /** Триггер reload списка после успешного действия (создание/изменение/удаление). */
  onRefresh: () => void;
}

/**
 * Строка пользователя в списке. Линеарь-стиль:
 *   • avatar + presence dot
 *   • ФИО + role-badge + статус + presence label
 *   • MoreVertical меню с действиями (admin/developer)
 *
 * Self-protection (нельзя на себе):
 *   • toggle (block/unblock)
 *   • delete
 *   • change role
 *   • change login
 *
 * UI guards дублируют server (server тоже откажет с `cannot_*_self`).
 */
export function UserListRow({ user, myRole, myLogin, onStatusChange, onRefresh }: UserListRowProps) {
  const { t } = useTranslation();
  const [showRename, setShowRename] = useState(false);
  const [showChangeLogin, setShowChangeLogin] = useState(false);
  const [showChangeRole, setShowChangeRole] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelf = user.login === myLogin;
  const isDev = isDeveloper(myRole);
  const isEnabled = user.isActive && !user.isSuspended;
  const presence = isEnabled ? user.presenceStatus ?? 'offline' : 'offline';

  const statusLabel = user.isSuspended
    ? t('user_list_row.status_blocked')
    : !user.isActive
      ? t('user_list_row.status_inactive')
      : t('user_list_row.status_active');
  const statusColor = user.isSuspended
    ? 'text-danger'
    : !user.isActive
      ? 'text-text-muted'
      : 'text-presence-online';

  const handleToggle = () => {
    if (isSelf || busy) return;
    setBusy(true);
    toggleUser(api, user.login)
      .then((res) => {
        const label = res.isSuspended
          ? t('user_list_row.toast_blocked')
          : res.isActive
            ? t('user_list_row.toast_unblocked')
            : t('user_list_row.toast_deactivated');
        onStatusChange(label);
        onRefresh();
      })
      .catch((err: { code?: string; message?: string }) => {
        onStatusChange(t('tables.toast_error', { message: err.message || err.code || 'unknown' }));
      })
      .finally(() => setBusy(false));
  };

  const handleResetLimit = () => {
    if (busy) return;
    setBusy(true);
    resetPasswordLoginCounter(api)
      .then(() => onStatusChange(t('user_list_row.toast_password_limit_reset')))
      .catch((err: { code?: string; message?: string }) => {
        onStatusChange(t('tables.toast_error', { message: err.message || err.code || 'unknown' }));
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2.5',
          'transition-colors hover:border-border-default',
          !isEnabled && 'opacity-70',
        )}
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          <Avatar
            initials={user.initials}
            size={40}
            login={user.login}
            avatarUrl={user.avatarUrl}
            avatarBlobKey={user.avatarBlobKey}
            avatarBlobNonce={user.avatarBlobNonce}
          />
          <PresenceDot
            state={presence}
            size={10}
            ringClass="ring-bg-elevated"
            className="absolute bottom-0 right-0"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-text-strong">
              {user.fullName}
            </span>
            {isSelf && (
              <span className="rounded bg-bg-hover px-1.5 py-px text-[10px] uppercase tracking-wider text-text-muted">
                {t('user_list_row.you_chip')}
              </span>
            )}
            <RoleBadge role={user.role} />
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
            <span className="font-mono">{user.login}</span>
            <span>·</span>
            <span className={statusColor}>{statusLabel}</span>
            {isEnabled && user.presenceStatus && (
              <>
                <span>·</span>
                <span>{presenceLabel(user.presenceStatus, user.lastSeenAt, t)}</span>
              </>
            )}
          </div>
        </div>

        {isDev && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={t('user_list_row.actions_aria')}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md',
                  'text-text-muted outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                  'data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong',
                )}
              >
                <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className={cn(
                  'z-50 w-[230px] rounded-xl border border-border-default bg-bg-elevated p-1.5 shadow-xl',
                  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
                )}
              >
                <MenuItem icon={Edit3} label={t('user_list_row.rename')} onSelect={() => setShowRename(true)} />
                <MenuItem
                  icon={LogIn}
                  label={t('user_list_row.change_login')}
                  onSelect={() => setShowChangeLogin(true)}
                  disabled={isSelf}
                />
                <MenuItem
                  icon={Shield}
                  label={t('user_list_row.change_role')}
                  onSelect={() => setShowChangeRole(true)}
                  disabled={isSelf}
                />
                <MenuItem
                  icon={isEnabled ? Ban : CheckCircle2}
                  label={isEnabled ? t('user_list_row.block') : t('user_list_row.unblock')}
                  onSelect={handleToggle}
                  disabled={isSelf || busy}
                />
                <MenuItem icon={Key} label={t('user_list_row.reset_password')} onSelect={() => setShowReset(true)} />
                {/* Лимит парольных входов имеет смысл только для ролей, которые
                    логинятся через desktop (admin/developer). User/client идут
                    через mobile QR — для них сброс лимита бесполезен. */}
                {(user.role === 'admin' || user.role === 'developer') && (
                  <MenuItem
                    icon={RotateCcw}
                    label={t('user_list_row.reset_password_limit')}
                    onSelect={handleResetLimit}
                    disabled={busy}
                  />
                )}
                <Separator />
                <MenuItem
                  icon={Trash2}
                  label={t('user_list_row.delete')}
                  onSelect={() => setShowDelete(true)}
                  danger
                  disabled={isSelf}
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      {showRename && (
        <RenameUserDialog
          open={showRename}
          user={user}
          onClose={() => setShowRename(false)}
          onSuccess={(m) => {
            onStatusChange(m);
            onRefresh();
          }}
        />
      )}
      {showChangeLogin && (
        <ChangeLoginDialog
          open={showChangeLogin}
          user={user}
          onClose={() => setShowChangeLogin(false)}
          onSuccess={(m) => {
            onStatusChange(m);
            onRefresh();
          }}
        />
      )}
      {showChangeRole && (
        <ChangeRoleDialog
          open={showChangeRole}
          user={user}
          onClose={() => setShowChangeRole(false)}
          onSuccess={(m) => {
            onStatusChange(m);
            onRefresh();
          }}
        />
      )}
      {showReset && (
        <ResetPasswordDialog
          open={showReset}
          user={user}
          onClose={() => setShowReset(false)}
          onSuccess={(m) => {
            onStatusChange(m);
            onRefresh();
          }}
        />
      )}
      {showDelete && (
        <DeleteUserConfirm
          open={showDelete}
          user={user}
          onClose={() => setShowDelete(false)}
          onSuccess={(m) => {
            onStatusChange(m);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function MenuItem({ icon: Icon, label, onSelect, danger, disabled }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      disabled={disabled}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 outline-none text-[12.5px]',
        'transition-colors',
        danger
          ? 'text-danger data-[highlighted]:bg-danger/15'
          : 'text-text-primary data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-strong',
        // §2026-05-19 — без cursor-not-allowed (на Win рисует круг-перечёркнутый).
        disabled && 'opacity-40',
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5 shrink-0', danger ? 'text-danger' : 'text-text-muted')}
        strokeWidth={1.75}
      />
      <span className="flex-1 truncate">{label}</span>
    </DropdownMenu.Item>
  );
}

function Separator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />;
}

/** Локализованный presence label: online / away / formatted last seen. */
function presenceLabel(presence: string, lastSeenAt: string | undefined, t: TFunction): string {
  if (presence === 'online') return t('user_list_row.presence_online');
  if (presence === 'away') return t('user_list_row.presence_away');
  return lastSeenAt ? formatFullYek(lastSeenAt) : t('user_list_row.presence_offline');
}

// Suppress: KeyRound импортирован на будущее (change_password для self),
// чтобы не плодить отдельные diff'ы. Если так и не пригодится — удалить.
void KeyRound;
