import { app, session } from 'electron';
import { verify } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_URL = 'https://script.google.com/macros/s/AKfycby37-sDHXalmrFwSqGZ86LcQ9IwiDdgmA8nT_gaOfClru3VCkGxjcjF-TctPfoaWY0GeA/exec';
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtTH0yAYjuJeXVHrXCoQK
J29bXXufRb0lYHg/2RxnemcjROO82eDB9BYNYwJMK9QXoTb4sqQy5r+tgpRx8/Fp
DoLqvJN1kXWDpXHy1GdSBYfHFUcg68MWwayH7zozER+LeROuatRqpNELkzVqP1/r
joVPbPTGIhPodloD+Rq3vO44g8qmEyormZnwAn0V1fKNhIKOkEQv8TzlwObFvTUC
pMt3pWhWdjKMteRx2FFBBwkmxcVAlNuilYPoWlD5ibCEPxXNdrLOT4V+Vxbk+Rx4
N5MVUabbRSg1t3zC+6UFvPkZl3mg9g7WAlH3c0e6N84sA0o7y8hXoTjt2c1idv3Q
JwIDAQAB
-----END PUBLIC KEY-----`;

interface RouteServer { id: string; origin: string }
interface SignedConfig {
  schema: 1;
  revision: number;
  issuedAt: number;
  expiresAt: number;
  servers: RouteServer[];
}
interface Envelope { payload: string; signature: string }

const FALLBACK: RouteServer[] = [
  { id: 'selectel', origin: 'https://136-234-25-40.sslip.io' },
  { id: 'beget', origin: 'https://45-12-239-5.sslip.io' },
];
let stateFile = '';
let envelope: Envelope | null = null;
let servers = FALLBACK;
let active = FALLBACK[0]!.origin;
let onChange: (origin: string) => void = () => {};
let switchTask: Promise<boolean> | null = null;

function validOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      u.pathname === '/' && !u.search && !u.hash &&
      u.hostname.endsWith('.sslip.io') && value === u.origin;
  } catch { return false; }
}

export function verifyEnvelope(raw: unknown, now = Date.now()): SignedConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Partial<Envelope>;
  if (typeof e.payload !== 'string' || e.payload.length > 4096 ||
      typeof e.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.signature)) return null;
  if (!verify('RSA-SHA256', Buffer.from(e.payload), PUBLIC_KEY, Buffer.from(e.signature, 'base64'))) return null;
  let c: SignedConfig;
  try { c = JSON.parse(e.payload) as SignedConfig; } catch { return null; }
  if (c.schema !== 1 || !Number.isSafeInteger(c.revision) || c.revision < 1 ||
      !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) ||
      c.issuedAt > now + 300_000 || c.expiresAt <= now ||
      c.expiresAt > c.issuedAt + 31 * 86_400_000 ||
      !Array.isArray(c.servers) || c.servers.length < 1 || c.servers.length > 4) return null;
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const item of c.servers) {
    if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(item.id) ||
        !validOrigin(item.origin) || ids.has(item.id) || origins.has(item.origin)) return null;
    ids.add(item.id);
    origins.add(item.origin);
  }
  return c;
}

function save(): void {
  if (!stateFile) return;
  try {
    const tmp = `${stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ envelope, active }), { mode: 0o600 });
    renameSync(tmp, stateFile);
  } catch (e) { console.warn('[route] cache save failed:', (e as Error).message); }
}

export function initializeRoutes(): void {
  stateFile = join(app.getPath('userData'), 'vps-route.json');
  try {
    const cache = JSON.parse(readFileSync(stateFile, 'utf8')) as { envelope?: Envelope; active?: string };
    const c = verifyEnvelope(cache.envelope);
    if (c) {
      envelope = cache.envelope ?? null;
      servers = c.servers;
      if (servers.some((item) => item.origin === cache.active)) active = cache.active!;
    }
  } catch { /* первая установка */ }
  console.log('[route] active:', new URL(active).hostname);
}

export function getActiveOrigin(): string { return active; }
export function setRouteChangeHandler(handler: (origin: string) => void): void { onChange = handler; }

async function getText(url: string, timeoutMs: number): Promise<string> {
  const res = await session.defaultSession.fetch(url, {
    method: 'GET', cache: 'no-store', redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 8192) throw new Error('response too large');
  return text;
}

async function healthy(origin: string): Promise<boolean> {
  try { return (await getText(`${origin}/__ping`, 2500)).trim() === 'ok'; }
  catch { return false; }
}

function setActive(next: string): boolean {
  if (!next || next === active) return false;
  active = next;
  save();
  console.warn('[route] switched to:', new URL(active).hostname);
  onChange(active);
  return true;
}

async function firstHealthy(exclude = ''): Promise<string> {
  for (const server of servers) {
    if (server.origin !== exclude && await healthy(server.origin)) return server.origin;
  }
  return '';
}

export async function refreshRoutes(): Promise<boolean> {
  try {
    const raw = JSON.parse(await getText(`${CONFIG_URL}?t=${Date.now()}`, 6000)) as Envelope;
    const c = verifyEnvelope(raw);
    if (!c) throw new Error('invalid signature or routes');
    const previous = verifyEnvelope(envelope);
    if (previous && c.revision < previous.revision) throw new Error('old revision');
    envelope = raw;
    servers = c.servers;
    if (!servers.some((item) => item.origin === active)) setActive(await firstHealthy() || servers[0]!.origin);
    save();
    return true;
  } catch (e) {
    console.warn('[route] Google config unavailable:', (e as Error).message);
    return false;
  }
}

export async function failoverIfOffline(): Promise<boolean> {
  if (switchTask) return switchTask;
  switchTask = (async () => {
    const current = active;
    if (await healthy(current)) return false;
    const next = await firstHealthy(current);
    return current === active && setActive(next);
  })();
  try { return await switchTask; } finally { switchTask = null; }
}
