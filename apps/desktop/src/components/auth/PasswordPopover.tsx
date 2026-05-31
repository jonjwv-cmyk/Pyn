import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  login,
  type LoginResponse,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { getDeviceId, getDeviceLabel } from '@/lib/device';
import { PasswordInput } from '@/components/ui/PasswordInput';

interface PasswordTriggerProps {
  onClick: () => void;
  active: boolean;
}

/**
 * §pyn-1.2.54 — trigger button «Войти по паролю» (key icon + label).
 * Open-state управляется снаружи (LoginScreen) — visual `active` ставит
 * фон/цвет hover-like когда popover открыт.
 */
export function PasswordTrigger({ onClick, active }: PasswordTriggerProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1',
        'text-[11.5px] text-text-muted outline-none transition-colors',
        'hover:bg-bg-hover hover:text-text-primary',
        active && 'bg-bg-hover text-text-primary',
      )}
    >
      <KeyRound className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      <span className="text-text-primary">{t('login.switch_password_l1')}</span>
    </button>
  );
}

interface PasswordPopoverProps {
  /** Колбэк со свежим LoginResponse при успешном логине. */
  onSuccess: (result: LoginResponse) => Promise<void>;
  /** Закрыть popover (Отмена). */
  onCancel: () => void;
}

/**
 * §pyn-1.2.54 — форма ввода логина и пароля, **отцентрирована внутри
 * LoginScreen card** через absolute inset-0 + flex center. Появляется
 * как «pill раскрылся из воздуха» — scale(0)→scale(1) + opacity 0→1
 * easeOutQuint (Linear/Figma slow-tail). Не закрывается ни по click-outside,
 * ни по Esc — только через явные кнопки «Отмена» / «Войти».
 */
export function PasswordPopover({
  onSuccess,
  onCancel,
}: PasswordPopoverProps) {
  const { t } = useTranslation();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = loginValue.trim();
    if (!trimmed || !password) return;
    setLoading(true);
    setError(null);
    try {
      const result = await login(api, {
        login: trimmed,
        password,
        deviceLabel: getDeviceLabel(),
        desktopOs: window.pyn?.platform === 'darwin' ? 'mac' : 'win',
        deviceId: getDeviceId(),
      });
      await onSuccess(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pyn:login] password failed:', err);
      setError(formatError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = (): void => {
    setLoginValue('');
    setPassword('');
    setError(null);
    onCancel();
  };

  const canSubmit = loginValue.trim().length > 0 && password.length > 0 && !loading;

  return (
    <div
      className={cn(
        'absolute inset-0 z-30 flex items-center justify-center',
        'rounded-2xl bg-bg-surface/85 backdrop-blur-sm',
      )}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          'password-popover-content flex w-[300px] flex-col gap-3',
          'rounded-xl border border-border-default bg-bg-elevated p-4 shadow-2xl',
        )}
      >
        <div className="flex flex-col gap-2">
          <Field
            label={t('login.login_label')}
            value={loginValue}
            onChange={setLoginValue}
            placeholder="username"
            autoFocus
            autoComplete="username"
          />
          <Field
            label={t('login.password_label')}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        {error !== null && (
          <div
            className={cn(
              'rounded-md border border-danger/30 bg-danger/10 px-3 py-2',
              'text-[12px] leading-snug text-danger',
            )}
          >
            {error}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className={cn(
              'flex h-8 items-center rounded-md px-3 text-[13px]',
              'text-text-secondary outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
            )}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors',
              canSubmit
                ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
                : 'cursor-not-allowed bg-bg-hover text-text-muted',
            )}
          >
            {loading ? t('login.submit_loading') : t('login.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoFocus,
  autoComplete,
}: FieldProps) {
  const inputClass = cn(
    'h-9 w-full rounded-md border border-border-default bg-bg-primary px-3',
    'text-[13px] text-text-strong outline-none transition-colors',
    'placeholder:text-text-muted',
    'focus:border-border-strong',
  );
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
        {label}
      </span>
      {type === 'password' ? (
        <PasswordInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className={inputClass}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className={inputClass}
        />
      )}
    </label>
  );
}

/**
 * Mapping server error codes → локализованные сообщения через i18n.
 * Принимает функцию `t` от useTranslation чтобы быть выполнимой как pure func.
 */
function formatError(err: unknown, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'user_not_found':
        return t('login.error_user_not_found');
      case 'user_inactive':
        return t('login.error_user_inactive');
      case 'user_suspended':
        return t('login.error_user_suspended');
      case 'wrong_password':
      case 'invalid_credentials':
      case 'unauthorized':
        return t('login.error_wrong_password');
      case 'desktop_role_forbidden':
        return t('login.error_desktop_role_forbidden');
      case 'password_login_weekly_limit':
        return t('login.error_password_login_limit');
      case 'binary_tampered':
        return t('login.error_binary_tampered');
      case 'network':
        return t('login.error_network', { message: err.message });
      case 'invalid_envelope':
        return t('login.error_crypto', { message: err.message });
      case 'crypto_required':
        return t('login.error_e2e_required');
      default:
        return t('login.error_login_code', { code: err.code });
    }
  }
  if (err instanceof Error) return err.message;
  return t('login.error_fallback');
}
