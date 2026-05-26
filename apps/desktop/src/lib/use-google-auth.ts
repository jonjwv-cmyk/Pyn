import { useCallback, useEffect, useState } from 'react';

/**
 * §pyn-1.2.43 — authoritative статус Google-аккаунта.
 *
 * До этого `loggedIn` в TablesScreen вычислялся по URL текущего webview
 * (`currentUrl.startsWith('https://docs.google.com/spreadsheets')`). Это
 * ненадёжный proxy:
 *   • Webview ещё не загрузился → loggedIn=false (false negative).
 *   • Cookies протухли, но webview показывает кэшированный Sheets URL →
 *     loggedIn=true хотя реально не работает.
 *   • Юзер сделал logout в Settings → cookies очищены, но webview не
 *     перезагружен → loggedIn=true хотя cookies нет.
 *
 * Hook берёт source-of-truth из main process через `window.pyn.google.
 * checkStatus()` (Electron реально проверяет partition cookies). Обновляется:
 *   • На mount компонента (initial fetch).
 *   • На event `pyn:google-login-success` (dispatched из GoogleAccountPanel
 *     после успешного login).
 *   • На event `pyn:google-logout` (dispatched после logout).
 *
 * Использование:
 *   const { loggedIn, email, refresh } = useGoogleAuthStatus();
 *   // disabled={!loggedIn} на кнопках действий
 */

export interface GoogleAuthStatus {
  loggedIn: boolean;
  email: string | null;
  refresh: () => Promise<void>;
}

export function useGoogleAuthStatus(): GoogleAuthStatus {
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await window.pyn?.google?.checkStatus();
      if (status) {
        setLoggedIn(status.loggedIn);
        setEmail(status.email);
      }
    } catch {
      setLoggedIn(false);
      setEmail(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLogin = () => void refresh();
    const onLogout = () => {
      setLoggedIn(false);
      setEmail(null);
    };
    window.addEventListener('pyn:google-login-success', onLogin);
    window.addEventListener('pyn:google-logout', onLogout);
    return () => {
      window.removeEventListener('pyn:google-login-success', onLogin);
      window.removeEventListener('pyn:google-logout', onLogout);
    };
  }, [refresh]);

  return { loggedIn, email, refresh };
}
