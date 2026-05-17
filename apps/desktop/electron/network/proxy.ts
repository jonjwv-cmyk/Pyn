import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Socket } from 'node:net';

const execFileAsync = promisify(execFile);

export interface ProxyConfig {
  host: string;
  port: number;
}

const FORCE_DIRECT_VALUES = new Set(['1', 'true', 'yes']);

/**
 * Windows-only детект корпоративного прокси (1:1 порт `CorporateProxy.kt`).
 *
 * Алгоритм:
 *   1. ENV `OTLD_FORCE_DIRECT` (1/true/yes) → null (direct).
 *   2. PowerShell: `[System.Net.WebRequest]::DefaultWebProxy.GetProxy('https://otlhelper.com/api').AbsoluteUri`
 *      Если возвращает наш собственный URL — proxy не настроен → null.
 *   3. TCP probe найденного host:port с timeout 2с. Не пробился → null (домашняя сеть с
 *      WPAD/GPO, но прокси за firewall).
 *
 * На Mac / Linux всегда null — личные устройства, корп.политики не учитываем.
 */
export async function detectProxy(): Promise<ProxyConfig | null> {
  if (process.platform !== 'win32') return null;

  const force = (process.env['OTLD_FORCE_DIRECT'] ?? '').toLowerCase();
  if (FORCE_DIRECT_VALUES.has(force)) return null;

  const ps = await runPowerShellProxy().catch(() => null);
  if (!ps) return null;

  const reachable = await probeTcp(ps.host, ps.port, 2000);
  return reachable ? ps : null;
}

async function runPowerShellProxy(): Promise<ProxyConfig | null> {
  const cmd =
    "[System.Net.WebRequest]::DefaultWebProxy.GetProxy('https://otlhelper.com/api').AbsoluteUri";
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', cmd],
    { timeout: 5000 },
  );
  const url = stdout.trim();
  if (!url) return null;
  // Если PowerShell вернул наш URL — DefaultWebProxy решил что прокси не нужен.
  if (url.includes('otlhelper.com')) return null;

  const match = /^https?:\/\/([^:/]+)(?::(\d+))?/i.exec(url);
  if (!match || !match[1]) return null;
  const host = match[1];
  const port = match[2] ? Number.parseInt(match[2], 10) : 3128;
  return { host, port };
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}
