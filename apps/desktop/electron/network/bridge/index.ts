import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { session } from 'electron';
import { base64ToBytes } from '@pyn/core';
import { getProxyState } from '../../ipc/api-bridge';
import { createTunnel, type BridgeConfig } from './tunnel';
import { setBridgeProxyEndpoint } from './state';

/**
 * Google-bridge (клиент). Когда обнаружен корп-прокси, заворачивает webview
 * Google-таблиц в шифр-туннель до нашего VPS-релея (см. `tunnel.ts`):
 *
 *   webview → [PAC на persist:google-sheets] → локальный CONNECT-прокси (тут)
 *           → net.request к релею (через корп-прокси, authenticated) → Google
 *
 * PAC маршрутизирует пер-хост: Google-хосты (docs/контент/static/api) → локальный
 * прокси (= мост), `accounts.google.com` + не-Google → корп-прокси напрямую
 * (логин на корп-IP, Chromium сам авторизуется). На не-корп сети (proxy=null)
 * PAC не ставим — webview ходит напрямую.
 *
 * PAC отдаём inline через `data:`-URL (без зависимости от localhost-фетча).
 * Публичный ключ релея — НЕ секрет (как SPKI-пин); приватник/ticket — на VPS/CF.
 */

const GOOGLE_PARTITION = 'persist:google-sheets';

/** Публичный X25519 ключ VPS-релея (пара к BRIDGE_PRIVKEY_B64 в SECRETS.md). */
const BRIDGE_PUBKEY_B64 = 'CWwTAS2KY5N5oZHbVCXRQFfXdNPQBHwX2hvCOvAMC3U=';

let localServer: http.Server | null = null;
let localPort = 0;
let cfg: BridgeConfig | null = null;

/** Поднять локальный CONNECT-прокси (один раз). Резолвится когда слушает. */
function startLocalProxy(): Promise<void> {
  if (localServer && localPort) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      // Обычные GET сюда не ходят (PAC inline) — отвечаем 404.
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
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      localPort = (server.address() as AddressInfo).port;
      localServer = server;
      // eslint-disable-next-line no-console
      console.log(`[pyn:bridge] local proxy on 127.0.0.1:${localPort}`);
      resolve();
    });
  });
}

function buildPacScript(): string {
  const proxy = getProxyState();
  const corp = proxy ? `PROXY ${proxy.host}:${proxy.port}` : 'DIRECT';
  const bridge = `PROXY 127.0.0.1:${localPort}`;
  // accounts.* → корп-прокси (логин на корп-IP). Весь остальной Google → мост.
  return `function FindProxyForURL(url, host) {
  if (host === "accounts.google.com" || host === "accounts.youtube.com") return "${corp}";
  if (dnsDomainIs(host, ".google.com") || dnsDomainIs(host, ".googleusercontent.com") || dnsDomainIs(host, ".gstatic.com") || dnsDomainIs(host, ".googleapis.com") || dnsDomainIs(host, ".ggpht.com")) return "${bridge}";
  return "${corp}";
}`;
}

/**
 * Применить мост к партишену Google-таблиц. Вызывается из renderer'а
 * (`window.pyn.bridge.configure`) после get_client_config с `config.bridge =
 * { url, ticket }`. Идемпотентно. Возвращает `true` если мост реально включён
 * (есть корп-прокси) — renderer тогда перезагружает webview'ы Таблиц. На
 * не-корп сети → `false` (webview ходит напрямую).
 */
export async function configureBridge(url: string, ticket: string): Promise<boolean> {
  const proxy = getProxyState();
  if (typeof url !== 'string' || typeof ticket !== 'string' || !url || !ticket) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:bridge] configure ignored — bad url/ticket');
    return false;
  }

  await startLocalProxy();
  cfg = { url: url.replace(/\/+$/, ''), ticket, relayPubKey: base64ToBytes(BRIDGE_PUBKEY_B64) };
  setBridgeProxyEndpoint({ host: '127.0.0.1', port: localPort });

  if (!proxy) {
    // На не-корп сети webview Google-таблиц оставляем direct, но карта всё равно
    // может тянуть Google-спутник через VPS-релей: это убирает прямой Google из
    // renderer/main и даёт одинаковый маршрут в офисе и дома.
    // eslint-disable-next-line no-console
    console.log(`[pyn:bridge] no corp proxy — webview direct, map tiles via bridge ${cfg.url} (local 127.0.0.1:${localPort})`);
    return false;
  }

  const pac = buildPacScript();
  const dataUrl = 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64');
  const ses = session.fromPartition(GOOGLE_PARTITION);
  await ses.setProxy({ mode: 'pac_script', pacScript: dataUrl });
  // eslint-disable-next-line no-console
  console.log(`[pyn:bridge] PAC applied to ${GOOGLE_PARTITION} (bridge ${cfg.url}, local 127.0.0.1:${localPort}, ticket ${ticket.slice(0, 12)}…)`);
  return true;
}
