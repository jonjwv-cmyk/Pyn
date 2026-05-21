import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/ui/PasswordInput';
import {
  changeLogin,
  changeRole,
  createUser,
  deleteUser,
  renameUser,
  resetPassword,
  type Role,
  type UserSummary,
} from '@pyn/core';
import { roleDisplayKey } from './RoleBadge';

/**
 * Все модалы Users management в одном файле — каждый сам по себе мелкий,
 * их объединяет общий dialog-shell (`<UserDialogShell>`). Open-state хранит
 * родитель (UserListRow / UsersPanel) и закрывает через `onClose`.
 *
 * Server-permissions:
 *   • create — admin+; admin может создать только user/admin, developer — все.
 *   • rename / changeLogin / changeRole / reset / delete — developer-only.
 */

// ── Shared shell ──────────────────────────────────────────────────────────

interface UserDialogShellProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function UserDialogShell({ open, title, onClose, children }: UserDialogShellProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <Dialog.Title className="mb-3 text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Shared input ──────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  autoFocus?: boolean;
  placeholder?: string;
}

function Field({ label, value, onChange, type = 'text', autoFocus, placeholder }: FieldProps) {
  const inputClass = cn(
    'w-full rounded-md border border-border-default bg-bg-primary px-2.5 py-1.5',
    'text-[13px] text-text-primary outline-none transition-colors',
    'focus:border-accent-clay',
  );
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] text-text-secondary">{label}</span>
      {type === 'password' ? (
        <PasswordInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={inputClass}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={inputClass}
        />
      )}
    </label>
  );
}

// ── Buttons row ───────────────────────────────────────────────────────────

interface ActionsRowProps {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}

function ActionsRow({ onCancel, onConfirm, confirmLabel, confirmDisabled, busy, danger }: ActionsRowProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className={cn(
          'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
        )}
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled || busy}
        className={cn(
          'rounded-md px-3 py-1.5 text-[13px] font-medium outline-none transition-colors',
          danger
            ? 'bg-danger text-white hover:bg-danger/85'
            : 'bg-accent-clay text-white hover:bg-accent-clay-dim',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {busy ? '…' : confirmLabel}
      </button>
    </div>
  );
}

interface ErrorLineProps {
  error: string;
}

function ErrorLine({ error }: ErrorLineProps): JSX.Element | null {
  if (!error) return null;
  return <p className="mt-2 text-[12px] text-danger">{error}</p>;
}

// ── Create user ───────────────────────────────────────────────────────────

interface CreateUserDialogProps {
  open: boolean;
  myRole: Role;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const CREATE_ROLES_DEV: Role[] = ['user', 'client', 'admin', 'developer'];
const CREATE_ROLES_ADMIN: Role[] = ['user', 'admin'];

export function CreateUserDialog({ open, myRole, onClose, onSuccess }: CreateUserDialogProps) {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const availableRoles = myRole === 'developer' ? CREATE_ROLES_DEV : CREATE_ROLES_ADMIN;
  const canSubmit = login.trim() && fullName.trim() && password.trim();

  const reset = () => {
    setLogin('');
    setFullName('');
    setPassword('');
    setRole('user');
    setMustChange(true);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    createUser(api, {
      login: login.trim(),
      fullName: fullName.trim(),
      password,
      role,
      mustChangePassword: mustChange,
    })
      .then(() => {
        onSuccess(t('users_dialog.create_success'));
        handleClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.create_title')} onClose={handleClose}>
      <div className="flex flex-col gap-3">
        <Field label={t('users_dialog.create_login')} value={login} onChange={setLogin} autoFocus />
        <Field label={t('users_dialog.create_full_name')} value={fullName} onChange={setFullName} />
        <Field label={t('users_dialog.create_password')} value={password} onChange={setPassword} type="password" />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-text-secondary">{t('users_dialog.create_role')}</span>
          {/* §v1.2.14 — 2×2 grid вместо flex-wrap: одинаковая ширина всех
              4-х кнопок, аккуратная разметка (Linear-style). Раньше длинные
              лейблы (Администратор) wrap'или последнюю кнопку на новую
              строку → 3+1 кривое разбиение. */}
          <div className="grid grid-cols-2 gap-1.5">
            {availableRoles.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                  role === r
                    ? 'border-accent-clay bg-accent-clay-bg text-accent-clay'
                    : 'border-border-default bg-bg-primary text-text-secondary hover:text-text-strong',
                )}
              >
                {t(roleDisplayKey(r))}
              </button>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
          <input
            type="checkbox"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent-clay"
          />
          {t('users_dialog.create_must_change')}
        </label>
        <ErrorLine error={error} />
      </div>
      <ActionsRow
        onCancel={handleClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.create_submit')}
        confirmDisabled={!canSubmit}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Rename ────────────────────────────────────────────────────────────────

interface SingleUserDialogProps {
  open: boolean;
  user: UserSummary;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export function RenameUserDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(user.fullName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!fullName.trim()) return;
    setBusy(true);
    setError('');
    renameUser(api, { targetLogin: user.login, fullName: fullName.trim() })
      .then(() => {
        onSuccess(t('users_dialog.rename_success'));
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.rename_title')} onClose={onClose}>
      <Field label={t('users_dialog.create_full_name')} value={fullName} onChange={setFullName} autoFocus />
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.rename_submit')}
        confirmDisabled={!fullName.trim() || fullName.trim() === user.fullName}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Change login ──────────────────────────────────────────────────────────

export function ChangeLoginDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const { t } = useTranslation();
  const [newLogin, setNewLogin] = useState(user.login);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!newLogin.trim() || newLogin.trim() === user.login) return;
    setBusy(true);
    setError('');
    changeLogin(api, { targetLogin: user.login, newLogin: newLogin.trim() })
      .then(() => {
        onSuccess(t('users_dialog.change_login_success'));
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.change_login_title')} onClose={onClose}>
      <Field label={t('users_dialog.change_login_field')} value={newLogin} onChange={setNewLogin} autoFocus />
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.rename_submit')}
        confirmDisabled={!newLogin.trim() || newLogin.trim() === user.login}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Change role ───────────────────────────────────────────────────────────

const ALL_ROLES: Role[] = ['user', 'client', 'admin', 'developer'];

export function ChangeRoleDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (selected === user.role) return;
    setBusy(true);
    setError('');
    changeRole(api, { targetLogin: user.login, newRole: selected })
      .then(() => {
        onSuccess(t('users_dialog.change_role_success'));
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.change_role_title')} onClose={onClose}>
      <p className="mb-2 text-[12px] text-text-muted">
        <Trans
          i18nKey="users_dialog.change_role_current"
          values={{ role: t(roleDisplayKey(user.role)) }}
          components={{ b: <span className="text-text-secondary" /> }}
        />
      </p>
      <div className="flex flex-col gap-1.5">
        {ALL_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSelected(r)}
            className={cn(
              'w-full rounded-md border px-3 py-2 text-left text-[13px] transition-colors',
              selected === r
                ? 'border-accent-clay bg-accent-clay-bg text-accent-clay'
                : 'border-border-default bg-bg-primary text-text-secondary hover:text-text-strong',
            )}
          >
            {t(roleDisplayKey(r))}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.rename_submit')}
        confirmDisabled={selected === user.role}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Reset password ────────────────────────────────────────────────────────

export function ResetPasswordDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    setBusy(true);
    setError('');
    resetPassword(api, {
      targetLogin: user.login,
      newPassword: newPassword.trim() || undefined,
    })
      .then((res) => {
        onSuccess(
          t('users_dialog.reset_pw_success', {
            n: res.sessionsRevoked,
            password: res.generatedPassword ?? '',
          }),
        );
        setNewPassword('');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.reset_pw_title', { name: user.fullName })} onClose={onClose}>
      <Field
        label={t('users_dialog.reset_pw_field')}
        value={newPassword}
        onChange={setNewPassword}
        type="password"
        placeholder={t('users_dialog.reset_pw_placeholder')}
        autoFocus
      />
      <p className="mt-2 text-[11.5px] text-text-muted">
        {t('users_dialog.reset_pw_warning')}
      </p>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.reset_pw_submit')}
        busy={busy}
        danger
      />
    </UserDialogShell>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────

export function DeleteUserConfirm({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    setBusy(true);
    setError('');
    deleteUser(api, user.login)
      .then(() => {
        onSuccess(t('users_dialog.delete_success'));
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || t('common.error_fallback'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={t('users_dialog.delete_title')} onClose={onClose}>
      <p className="text-[13px] leading-snug text-text-secondary">
        <Trans
          i18nKey="users_dialog.delete_body"
          values={{ name: user.fullName, login: user.login }}
          components={{ b: <span className="text-text-strong" /> }}
        />
      </p>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel={t('users_dialog.delete_submit')}
        busy={busy}
        danger
      />
    </UserDialogShell>
  );
}
