import { useEffect } from 'react';
import { api } from '@/lib/api';

/**
 * Глобальный handler auth-failure'ов: любой API-call, который возвращает
 * `unauthorized` / `session_expired_window` / `token_*` / etc → ApiClient
 * вызывает этот callback. Wipe всё + перевод на LoginScreen. Не нужно ловить
 * эти коды в каждом catch'е компонентов.
 */
export function useAuthFailureHandler(onFailure: (code: string) => void): void {
  useEffect(() => {
    api.setOnAuthFailure((code) => {
      window.pyn?.debugLog?.('auth-failure', `code=${code} — wiping session`);
      onFailure(code);
    });
    return () => {
      api.setOnAuthFailure(null);
    };
  }, [onFailure]);
}
