import { useCallback, useState } from 'react';
import { KeyRound, LogIn, QrCode } from 'lucide-react';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { getDeviceLabel } from '@/lib/device';
import { cn } from '@/lib/cn';
import {
  ApiError,
  login,
  loginResponseToSession,
  type LoginResponse,
  type Session,
} from '@pyn/core';
import { QrLoginPanel } from './QrLoginPanel';

interface LoginScreenProps {
  onSuccess: (session: Session) => void;
}

type Mode = 'qr' | 'password';

/**
 * Экран входа. Две вкладки:
 *   • **QR** (default) — primary способ login'а на desktop'е. Скан со смартфона
 *     через OTLHelper2-Android → server подтверждает PC-сессию → token.
 *   • **Пароль** — fallback, лимитирован 3/неделю server-side.
 *
 * Оба пути после успеха конвертируют LoginResponse → Session, персистят через
 * safeStorage (token-store) и зовут `onSuccess(session)`.
 */
export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>('qr');

  // Общий хелпер: LoginResponse → Session → persist → onSuccess.
  // Вынесен в callback, чтобы handlers password-mode и QR-mode шли одним путём.
  const handleSessionSuccess = useCallback(
    async (result: LoginResponse): Promise<void> => {
      api.setToken(result.token);
      const session = loginResponseToSession(result);
      try {
        await sessionStore.save(session);
      } catch (saveErr) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:login] session persist failed:', saveErr);
      }
      onSuccess(session);
    },
    [onSuccess],
  );

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-bg-surface">
      {/* Drag-region для перемещения окна */}
      <div className="drag-region absolute inset-x-0 top-0 h-12" />

      <div
        className={cn(
          'flex w-[360px] flex-col gap-4 rounded-2xl border border-border-default',
          'bg-bg-elevated px-6 py-7 shadow-2xl',
        )}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-clay-bg">
            <LogIn className="h-5 w-5 text-accent-clay" strokeWidth={1.75} />
          </div>
          <h1 className="text-[16px] font-semibold tracking-[-0.005em] text-text-strong">
            Вход в Pyn
          </h1>
          <p className="text-[12px] text-text-muted">
            {mode === 'qr'
              ? 'Отсканируйте QR со смартфона'
              : 'Введите логин и пароль аккаунта'}
          </p>
        </div>

        {mode === 'qr' ? (
          <QrLoginPanel
            onSuccess={(result) => {
              void handleSessionSuccess(result);
            }}
          />
        ) : (
          <PasswordForm onSuccess={handleSessionSuccess} />
        )}

        <button
          type="button"
          onClick={() => setMode((m) => (m === 'qr' ? 'password' : 'qr'))}
          className={cn(
            'flex h-8 items-center justify-center gap-1.5 rounded-md',
            'border border-border-subtle text-[12px] text-text-muted',
            'transition-colors hover:border-border-default hover:text-text-primary',
          )}
        >
          {mode === 'qr' ? (
            <>
              <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
              Войти по паролю
            </>
          ) : (
            <>
              <QrCode className="h-3.5 w-3.5" strokeWidth={1.75} />
              Войти через QR
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Password form (fallback mode) ──────────────────────────────────────────

interface PasswordFormProps {
  onSuccess: (result: LoginResponse) => Promise<void>;
}

function PasswordForm({ onSuccess }: PasswordFormProps) {
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
      });
      await onSuccess(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pyn:login] password failed:', err);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = loginValue.trim().length > 0 && password.length > 0 && !loading;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Field
          label="Логин"
          value={loginValue}
          onChange={setLoginValue}
          placeholder="username"
          autoFocus
          autoComplete="username"
        />
        <Field
          label="Пароль"
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

      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(
          'flex h-9 items-center justify-center rounded-md',
          'text-[13px] font-medium transition-colors',
          canSubmit
            ? 'bg-accent-clay text-white hover:bg-accent-clay-dim'
            : 'cursor-not-allowed bg-bg-hover text-text-muted',
        )}
      >
        {loading ? 'Вход…' : 'Войти'}
      </button>
    </form>
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
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className={cn(
          'h-9 rounded-md border border-border-default bg-bg-primary px-3',
          'text-[13px] text-text-strong outline-none transition-colors',
          'placeholder:text-text-muted',
          'focus:border-border-strong',
        )}
      />
    </label>
  );
}

/**
 * Mapping server error codes → русские сообщения. 1:1 порт из
 * OTLHelper2 LoginScreen.kt (line 278-286), плюс наши transport-уровневые.
 */
function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      // Server-side codes (LoginScreen.kt error mapping)
      case 'user_not_found':
        return 'Пользователь не найден';
      case 'user_inactive':
        return 'Пользователь деактивирован';
      case 'user_suspended':
        return 'Пользователь заблокирован';
      case 'wrong_password':
      case 'invalid_credentials':
      case 'unauthorized':
        return 'Неверный пароль';
      case 'desktop_role_forbidden':
        return 'Desktop-версия только для администраторов и разработчиков';
      case 'password_login_weekly_limit':
        return 'Превышен лимит парольных входов на этой неделе. Попросите разработчика сбросить.';
      case 'binary_tampered':
        return 'Целостность приложения нарушена. Переустановите Pyn.';

      // Transport / crypto codes
      case 'network':
        return `Нет связи с сервером: ${err.message}`;
      case 'invalid_envelope':
        return `Ошибка шифрования: ${err.message}`;
      case 'crypto_required':
        return 'Сервер требует E2E-шифрования (несовместимая версия клиента?)';

      default:
        return `Ошибка входа: ${err.code}${err.message && err.message !== err.code ? ` (${err.message})` : ''}`;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Не удалось войти';
}
