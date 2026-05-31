import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { session } from 'electron';
import { base64ToBytes } from '@pyn/core';
import { getProxyState } from '../../ipc/api-bridge';
import { createTunnel, type BridgeConfig } from './tunnel';

/**
 * Google-bridge (клиент). Когда обнаружен корп-прокси, заворачивает webview
 * Google-таблиц в шифр-туннель до нашего VPS-релея (см. `tunnel.ts`):
 *
 *   webview → [PAC на persist:google-sheets] → локальный CONNECT-прокси (тут)
 *           → net.request к релею (через корп-прокси, authenticated) → Google
 *
 * PAC маршрутизирует пер-хост: тяжёлые Google-хосты (docs/контент) → локальный
 * прокси (= мост), всё остальное (вкл. accounts.google.com, не-Google) → корп-
 * прокси напрямую (Chromium сам авторизуется). На не-корп сети (proxy=null)
 * PAC не ставим — webview ходит напрямую.
 *
 * Публичный ключ релея — НЕ секрет (как SPKI-пин). Приватник/ticket-секрет
 * живут на VPS/CF; ticket приходит в рантайме из get_client_config.
 */

const GOOGLE_PARTITION = 'persist:google-sheets';

/** Публичный X25519 ключ VPS-релея (пара к BRIDGE_PRIVKEY_B64 в SECRETS.md). */
const BRIDGE_PUBKEY_B64 = 'CWwTAS2KY5N5oZHbVCXRQFfXdNPQBHwX2hvCOvAMC3U=';

/** Хосты, которые гоним через мост (режутся корп-прокси). Остальное → корп-прокси. */
const BRIDGED_HOSTS_EXACT = ['docs.google.com'];
const BRIDGED_HOSTS_SUFFIX = ['.googleusercontent.com', '.gstatic.com'];

let localServer: http.Server | null = null;
let localPort = 0;
let cfg: BridgeConfig | null = null;

function startLocalProxy(): void {
  if (localServer) return;
  const server = http.createServer((req, res) => {
    // Раздаём PAC-файл (Chromium фетчит его напрямую, минуя прокси).
    if (req.url === '/proxy.pac') {
      res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' });
      res.end(buildPacScript());
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // CONNECT от webview (https-туннель) → заворачиваем в мост.
  server.on('connect', (req, socket, head) => {
    if (!cfg) {
      socket.destroy();
      return;
    }
    const [host, portStr] = String(req.url).split(':');
    const port = Number.parseInt(portStr ?? '443', 10) || 443;
    if (!host) {
      socket.destroy();
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) socket.unshift(head);
    createTunnel(host, port, socket, cfg);
  });

  server.on('clientError', (_e, socket) => {
    try { socket.destroy(); } catch { /* ignore */ }
  });

  server.listen(0, '127.0.0.1', () => {
    localPort = (server.address() as AddressInfo).port;
    // eslint-disable-next-line no-console
    console.log(`[pyn:bridge] local proxy on 127.0.0.1:${localPort}`);
  });
  localServer = server;
}

function buildPacScript(): string {
  const proxy = getProxyState();
  const corp = proxy ? `PROXY ${proxy.host}:${proxy.port}` : 'DIRECT';
  const exact = JSON.stringify(BRIDGED_HOSTS_EXACT);
  const suffix = JSON.stringify(BRIDGED_HOSTS_SUFFIX);
  // PAC: bridged-хосты → локальный прокси (мост), остальное → корп-прокси.
  return `function FindProxyForURL(url, host) {
  var EXACT = ${exact};
  var SUFFIX = ${suffix};
  for (var i = 0; i < EXACT.length; i++) if (host === EXACT[i]) return "PROXY 127.0.0.1:${localPort}";
  for (var j = 0; j < SUFFIX.length; j++) if (dnsDomainIs(host, SUFFIX[j])) return "PROXY 127.0.0.1:${localPort}";
  return "${corp}";
}
`;
}

/**
 * Применить мост к партишену Google-таблиц. Вызывается из renderer'а
 * (`window.pyn.bridge.configure`) после get_client_config, когда есть
 * `config.bridge = { url, ticket }`. Идемпотентно (повторный вызов обновляет
 * ticket). На не-корп сети (нет прокси) — no-op, webview ходит напрямую.
 */
export async function configureBridge(url: string, ticket: string): Promise<void> {
  const proxy = getProxyState();
  if (!proxy) {
    // eslint-disable-next-line no-console
    console.log('[pyn:bridge] no corp proxy — bridge disabled (webview direct)');
    return;
  }
  if (typeof url !== 'string' || typeof ticket !== 'string' || !url || !ticket) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:bridge] configure ignored — bad url/ticket');
    return;
  }

  startLocalProxy();
  cfg = { url: url.replace(/\/+$/, ''), ticket, relayPubKey: base64ToBytes(BRIDGE_PUBKEY_B64) };

  const pacUrl = `http://127.0.0.1:${localPort}/proxy.pac`;
  const ses = session.fromPartition(GOOGLE_PARTITION);
  await ses.setProxy({ mode: 'pac_script', pacScript: pacUrl });
  // eslint-disable-next-line no-console
  console.log(`[pyn:bridge] PAC applied to ${GOOGLE_PARTITION} (bridge ${cfg.url}, ticket ${ticket.slice(0, 12)}…)`);
}
