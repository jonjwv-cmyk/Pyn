/**
 * §pyn-1.2.33 — SSE-transport как fallback для WS в сетях с NTLM-прокси.
 * §pyn-1.2.35 — все diagnostic-логи идут через debugLog IPC → main-process
 * пишет их в `Desktop\pyn-debug.log` (открыл блокнотом — увидел).
 */

const SSE_BASE_URL = 'https://45-12-239-5.sslip.io/events';

let eventSource: EventSource | null = null;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
  try { window.pyn?.debugLog?.('pyn:sse', msg); } catch { /* ignore */ }
}

export function startSse(token: string, scope: string): void {
  if (eventSource) {
    log('start skipped — already connected/connecting');
    return;
  }
  if (!token) {
    log('start skipped — empty token');
    return;
  }

  const url = `${SSE_BASE_URL}?token=${encodeURIComponent(token)}&scope=${encodeURIComponent(scope)}`;
  log(`starting → ${SSE_BASE_URL}?scope=${scope}&token=<${token.length}ch>`);

  try {
    eventSource = new EventSource(url);
    log(`EventSource constructed, readyState=${eventSource.readyState}`);
  } catch (err) {
    log(`EventSource constructor threw: ${String(err)}`);
    return;
  }

  eventSource.onopen = () => {
    log(`OPEN (readyState=${eventSource?.readyState})`);
  };

  eventSource.onmessage = (e) => {
    if (!e.data) return;
    let event: unknown;
    try {
      event = JSON.parse(e.data);
    } catch (err) {
      log(`parse error: ${String(err)} | raw: ${String(e.data).slice(0, 100)}`);
      return;
    }
    if (!event || typeof event !== 'object') return;
    log(`event: ${(event as { type?: string }).type ?? '?'}`);
    window.dispatchEvent(new CustomEvent('pyn:server-event', { detail: event }));
  };

  eventSource.onerror = () => {
    log(`ERROR readyState=${eventSource?.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`);
  };
}

export function stopSse(): void {
  if (!eventSource) return;
  log('stopping');
  try { eventSource.close(); } catch { /* ignore */ }
  eventSource = null;
}

export function isSseConnected(): boolean {
  return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}
