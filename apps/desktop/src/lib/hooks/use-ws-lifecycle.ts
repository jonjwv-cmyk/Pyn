import { useEffect } from 'react';
import type { Session } from '@pyn/core';
import { startWs, stopWs } from '@/lib/ws';

/**
 * WS lifecycle: connect при наличии session, disconnect при logout.
 */
export function useWsLifecycle(session: Session | null): void {
  useEffect(() => {
    if (!session) {
      void stopWs();
      return;
    }
    void startWs(session.user.login, session.token);
  }, [session]);
}
