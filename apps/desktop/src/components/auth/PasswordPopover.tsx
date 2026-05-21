import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
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

interface PasswordPopoverProps {
  /** Колбэк со свежим LoginResponse при успешном логине. */
  onSuccess: (result: LoginResponse) => Promise<void>;
  /** Контроллер open-state — поднят наверх (LoginScreen), чтобы main-area
   *  могла blur'нуться при open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Popover-форма ввода логина и пароля. Trigger — кнопка с иконкой ключа в
 * top-right карточки login'а. При open:
 *   • main login-content (QR + steps + counter) blur'ится через `[data-pw-open]`
 *     state на root LoginScreen.
 *   • Popover не закрывается ни по click-outside, ни по Esc — только через
 *     явные кнопки «Отмена» / «Войти». Это спасает от случайных закрытий с
 *     частично-набранным паролем.
 */
export function PasswordPopover({
  onSuccess,
  open,
  onOpenChange,
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
    onOpenChange(false);
  };

  const canSubmit = loginValue.trim().length > 0 && password.length > 0 && !loading;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2',
            'text-[11.5px] text-text-muted outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-primary',
            'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary',
          )}
        >
          <KeyRound className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span>{t('login.switch_password')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          // Запрет close на click-outside и Esc — только явные кнопки.
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className={cn(
            'z-50 w-[320px] rounded-xl border border-border-default bg-bg-elevated p-4 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-[12px] text-text-muted">{t('login.subtitle_password')}</p>

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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
