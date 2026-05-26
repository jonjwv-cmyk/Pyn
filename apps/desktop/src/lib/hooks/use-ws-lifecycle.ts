import { useEffect } from 'react';
import type { Session } from '@pyn/core';
import { startWs, stopWs } from '@/lib/ws';
import { startSse, stopSse } from '@/lib/sse-client';
import { getDesktopScope } from '@/lib/version';

/**
 * WS + SSE lifecycle: connect при наличии session, disconnect при logout.
 *
 * §pyn-1.2.33 — SSE открывается параллельно WS. В корп сетях с NTLM-прокси
 * WS не апгрейдится (407), но SSE как обычный HTTP-stream проходит → push
 * работает через него. В сетях где WS работает — оба канала активны, события
 * могут дублироваться, но handlers идемпотентны (compareSemver, refetch).
 */
export function useWsLifecycle(session: Session | null): void {
  useEffect(() => {
    if (!session) {
      void stopWs();
      stopSse();
      return;
    }
    void startWs(session.user.login, session.token);
    startSse(session.token, getDesktopScope());
  }, [session]);
}
