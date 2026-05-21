import { useCallback, useState } from 'react';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { cn } from '@/lib/cn';
import {
  loginResponseToSession,
  type LoginResponse,
  type Session,
} from '@pyn/core';
import { LanguageSwitcher } from './LanguageSwitcher';
import { PasswordPopover } from './PasswordPopover';
import { QrLoginPanel } from './QrLoginPanel';

interface LoginScreenProps {
  onSuccess: (session: Session) => void;
}

/**
 * Экран входа. Primary flow — QR со смартфона. Password-flow — popover-форма
 * из top-right карточки (для admin'ов / fallback'a).
 *
 * Оба пути после успеха конвертируют LoginResponse → Session, персистят через
 * safeStorage (token-store) и зовут `onSuccess(session)`.
 */
export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { t } = useTranslation();
  const [pwOpen, setPwOpen] = useState(false);

  // Общий хелпер: LoginResponse → Session → persist → onSuccess.
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
    <div className="login-pattern-bg relative flex h-full w-full items-center justify-center">
      {/* Drag-region для перемещения окна */}
      <div className="drag-region absolute inset-x-0 top-0 h-12" />

      <div
        className={cn(
          'relative flex w-[360px] flex-col gap-4 rounded-2xl border border-border-default',
          'bg-bg-elevated px-6 py-7 shadow-2xl',
        )}
      >
        {/* Симметричная top-bar карточки: Password trigger в левом углу,
            Language switcher в правом — отражение друг друга на одной линии.
            Не отвлекают от primary flow login'а. */}
        <div className="absolute left-3 top-3 z-10">
          <PasswordPopover
            open={pwOpen}
            onOpenChange={setPwOpen}
            onSuccess={handleSessionSuccess}
          />
        </div>
        <div className="absolute right-3 top-3 z-10">
          <LanguageSwitcher />
        </div>

        {/* Main login content (QR + steps + counter). Blur'ится при open
            password popover'а — визуальный фокус на форме ввода. */}
        <div
          className={cn(
            'flex flex-col gap-4 transition-[filter,opacity] duration-200',
            pwOpen && 'pointer-events-none blur-sm opacity-60',
          )}
          aria-hidden={pwOpen}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-clay-bg">
              <LogIn className="h-5 w-5 text-accent-clay" strokeWidth={1.75} />
            </div>
            <h1 className="text-[16px] font-semibold tracking-[-0.005em] text-text-strong">
              {t('login.title')}
            </h1>
          </div>

          <QrLoginPanel
            onSuccess={(result) => {
              void handleSessionSuccess(result);
            }}
          />
        </div>
      </div>
    </div>
  );
}
