import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
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
import { roleDisplayName } from './RoleBadge';

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
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Закрыть"
              className={cn(
                'absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md',
                'text-text-muted outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
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
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] text-text-secondary">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-border-default bg-bg-primary px-2.5 py-1.5',
          'text-[13px] text-text-primary outline-none transition-colors',
          'focus:border-accent-clay',
        )}
      />
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
        Отмена
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
        onSuccess('Пользователь создан');
        handleClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Не удалось создать');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title="Новый пользователь" onClose={handleClose}>
      <div className="flex flex-col gap-3">
        <Field label="Логин" value={login} onChange={setLogin} autoFocus />
        <Field label="ФИО" value={fullName} onChange={setFullName} />
        <Field label="Пароль" value={password} onChange={setPassword} type="password" />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-text-secondary">Роль</span>
          <div className="flex flex-wrap gap-1.5">
            {availableRoles.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[12px] transition-colors',
                  role === r
                    ? 'border-accent-clay bg-accent-clay-bg text-accent-clay'
                    : 'border-border-default bg-bg-primary text-text-secondary hover:text-text-strong',
                )}
              >
                {roleDisplayName(r)}
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
          Сменить пароль при первом входе
        </label>
        <ErrorLine error={error} />
      </div>
      <ActionsRow
        onCancel={handleClose}
        onConfirm={handleSubmit}
        confirmLabel="Создать"
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
  const [fullName, setFullName] = useState(user.fullName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!fullName.trim()) return;
    setBusy(true);
    setError('');
    renameUser(api, { targetLogin: user.login, fullName: fullName.trim() })
      .then(() => {
        onSuccess('Имя обновлено');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Ошибка');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title="Переименовать" onClose={onClose}>
      <Field label="ФИО" value={fullName} onChange={setFullName} autoFocus />
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel="Сохранить"
        confirmDisabled={!fullName.trim() || fullName.trim() === user.fullName}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Change login ──────────────────────────────────────────────────────────

export function ChangeLoginDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const [newLogin, setNewLogin] = useState(user.login);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!newLogin.trim() || newLogin.trim() === user.login) return;
    setBusy(true);
    setError('');
    changeLogin(api, { targetLogin: user.login, newLogin: newLogin.trim() })
      .then(() => {
        onSuccess('Логин изменён');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Ошибка');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title="Сменить логин" onClose={onClose}>
      <Field label="Новый логин" value={newLogin} onChange={setNewLogin} autoFocus />
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel="Сохранить"
        confirmDisabled={!newLogin.trim() || newLogin.trim() === user.login}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Change role ───────────────────────────────────────────────────────────

const ALL_ROLES: Role[] = ['user', 'client', 'admin', 'developer'];

export function ChangeRoleDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const [selected, setSelected] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (selected === user.role) return;
    setBusy(true);
    setError('');
    changeRole(api, { targetLogin: user.login, newRole: selected })
      .then(() => {
        onSuccess('Роль изменена');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Ошибка');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title="Сменить роль" onClose={onClose}>
      <p className="mb-2 text-[12px] text-text-muted">
        Текущая: <span className="text-text-secondary">{roleDisplayName(user.role)}</span>
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
            {roleDisplayName(r)}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel="Сохранить"
        confirmDisabled={selected === user.role}
        busy={busy}
      />
    </UserDialogShell>
  );
}

// ── Reset password ────────────────────────────────────────────────────────

export function ResetPasswordDialog({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
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
        const generated = res.generatedPassword
          ? ` Временный пароль: ${res.generatedPassword}`
          : '';
        onSuccess(`Пароль сброшен (revoked ${res.sessionsRevoked} сессий).${generated}`);
        setNewPassword('');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Ошибка');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title={`Сброс пароля — ${user.fullName}`} onClose={onClose}>
      <Field
        label="Новый пароль (опционально)"
        value={newPassword}
        onChange={setNewPassword}
        type="password"
        placeholder="оставьте пустым — сервер сгенерит"
        autoFocus
      />
      <p className="mt-2 text-[11.5px] text-text-muted">
        Все активные сессии этого юзера будут отозваны.
      </p>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel="Сбросить"
        busy={busy}
        danger
      />
    </UserDialogShell>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────

export function DeleteUserConfirm({ open, user, onClose, onSuccess }: SingleUserDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    setBusy(true);
    setError('');
    deleteUser(api, user.login)
      .then(() => {
        onSuccess('Пользователь удалён');
        onClose();
      })
      .catch((err: { code?: string; message?: string }) => {
        setError(err.message || err.code || 'Ошибка');
      })
      .finally(() => setBusy(false));
  };

  return (
    <UserDialogShell open={open} title="Удалить пользователя?" onClose={onClose}>
      <p className="text-[13px] leading-snug text-text-secondary">
        Пользователь <span className="text-text-strong">{user.fullName}</span> ({user.login})
        будет удалён. Сообщения сохранятся на сервере 24 часа, затем будут вычищены.
      </p>
      <ErrorLine error={error} />
      <ActionsRow
        onCancel={onClose}
        onConfirm={handleSubmit}
        confirmLabel="Удалить"
        busy={busy}
        danger
      />
    </UserDialogShell>
  );
}
