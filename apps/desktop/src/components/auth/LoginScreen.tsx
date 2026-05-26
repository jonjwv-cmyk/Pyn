import { useCallback, useState } from 'react';
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
import { PasswordPopover, PasswordTrigger } from './PasswordPopover';
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
      {/* §pyn-1.2.54 — pattern layer (mini Pyn-marks). Initial opacity 0,
          fade-in одновременно с card animation → визуально подложка
          «вырисовывается» из тёмного фона в момент когда card раскрывается. */}
      <div className="login-bg-pattern" />

      {/* Drag-region для перемещения окна */}
      <div className="drag-region absolute inset-x-0 top-0 h-12" />

      <div
        data-login-card
        className={cn(
          'relative flex w-[360px] flex-col gap-4 rounded-2xl border border-border-default',
          'bg-bg-surface px-6 py-7 shadow-2xl',
        )}
      >
        {/* Симметричная top-bar карточки: Password trigger в левом углу,
            Language switcher в правом — отражение друг друга на одной линии.
            Не отвлекают от primary flow login'а. */}
        <div className="absolute left-3 top-3 z-10">
          <PasswordTrigger onClick={() => setPwOpen(true)} active={pwOpen} />
        </div>
        <div className="absolute right-3 top-3 z-10">
          <LanguageSwitcher />
        </div>

        {/* §pyn-1.2.54 — password popover как overlay внутри card, отцентрирован.
            Появляется как «pill раскрылся из воздуха» — см. .password-popover-content. */}
        {pwOpen && (
          <PasswordPopover
            onSuccess={handleSessionSuccess}
            onCancel={() => setPwOpen(false)}
          />
        )}

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
            {/* §pyn-1.2.45 — canon Pyn-mark (T2) вместо generic LogIn-иконки. */}
            <PynMarkIcon />
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

/**
 * §pyn-1.2.45 — canon Pyn-mark T2 (3 контейнера, tonal variation).
 * Inline SVG чтобы избежать загрузки PNG и контролировать ring/background
 * через Tailwind. Геометрия 1:1 с `apps/desktop/build/icon.svg`.
 */
function PynMarkIcon(): JSX.Element {
  return (
    // §pyn-1.2.54 — data-attribute для splash measurement: SplashScreen
    // считывает позицию ЭТОЙ иконки через getBoundingClientRect и
    // переносит splash-mark ровно сюда (не «примерно», а пиксель-в-пиксель).
    <div
      data-pyn-login-mark
      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-deep"
      // §pyn-1.2.54 — orange outline 1px (inset box-shadow, не изменяет
       // layout). Тот же color/thickness что у splash outline — линия,
       // нарисованная в splash, ОСТАЁТСЯ видимой после handoff к LoginScreen.
      style={{ boxShadow: 'inset 0 0 0 1px #D97757' }}
    >
      <svg width="40" height="40" viewBox="0 0 256 256" aria-hidden>
        <rect x="40" y="40" width="48" height="176" rx="8" fill="#B35E45"/>
        <rect x="96" y="40" width="120" height="48" rx="8" fill="#C56C50"/>
        <rect x="96" y="104" width="88" height="48" rx="8" fill="#9D533D"/>
      </svg>
    </div>
  );
}
