import { useCallback, useEffect, useState } from 'react';
import { Check, Chrome, LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Панель Google-аккаунта. Использует тот же подход что OTLHelper2 — открывает
 * Google login во встроенном Electron BrowserWindow с `persist:google-sheets`
 * partition. Этот же partition использует `<webview>` в TablesScreen, поэтому
 * после input password юзер автоматически залогинен и в таблицах.
 *
 * Без explicit OAuth code-exchange — cookies сохраняются Electron'ом.
 */

interface AccountStatus {
  loggedIn: boolean;
  email: string | null;
}

export function GoogleAccountPanel(): JSX.Element {
  const [status, setStatus] = useState<AccountStatus>({ loggedIn: false, email: null });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const s = await window.pyn.google.checkStatus();
      setStatus(s);
    } catch {
      setStatus({ loggedIn: false, email: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onLogin = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await window.pyn.google.openLogin();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const onLogout = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await window.pyn.google.logout();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      <section
        className={cn(
          'flex items-center gap-4 rounded-xl border border-border-default bg-bg-elevated p-5',
        )}
      >
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
            status.loggedIn ? 'bg-presence-online/15' : 'bg-bg-hover',
          )}
        >
          {status.loggedIn ? (
            <Check className="h-6 w-6 text-presence-online" strokeWidth={1.5} />
          ) : (
            <Chrome className="h-6 w-6 text-text-muted" strokeWidth={1.5} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-[14px] font-semibold text-text-strong">
            {loading
              ? 'Проверяем…'
              : status.loggedIn
                ? 'Вы вошли в Google'
                : 'Не подключён'}
          </h2>
          <p className="text-[12px] text-text-muted">
            {status.loggedIn
              ? status.email
                ? `Аккаунт: ${status.email}`
                : 'Сессия активна. Можно редактировать таблицы и запускать скрипты.'
              : 'Без входа таблицы открыты на чтение, скрипты заблокированы.'}
          </p>
        </div>
        {status.loggedIn ? (
          <button
            type="button"
            onClick={() => {
              void onLogout();
            }}
            disabled={busy}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border-default px-3.5 py-1.5',
              'text-[13px] font-medium text-text-secondary outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
            Выйти
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              void onLogin();
            }}
            disabled={busy}
            className={cn(
              'flex items-center gap-2 rounded-md bg-accent-clay px-3.5 py-1.5',
              'text-[13px] font-medium text-white outline-none',
              'transition-colors hover:bg-accent-clay-dim',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
            {busy ? 'Открываем…' : 'Войти в Google'}
          </button>
        )}
      </section>

      {!status.loggedIn && (
        <section className="rounded-xl border border-border-subtle bg-bg-primary/40 p-5">
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-text-muted">
            Что будет после входа
          </h3>
          <ul className="flex flex-col gap-2 text-[12.5px] text-text-secondary">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>Редактирование ячеек напрямую — сохраняется в Google Sheets.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>Запуск скриптов — макросы для SAP и обработка диапазонов.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>Меню «Редактировать» — Правка / Вставка / Данные.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>Сессия сохраняется — повторно входить не нужно.</span>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
