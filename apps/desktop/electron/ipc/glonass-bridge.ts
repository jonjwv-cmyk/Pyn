import { ipcMain } from 'electron';
import { bridgeFetch } from '../network/map-tiles';

/**
 * Мост к спутниковому мониторингу ГЛОНАСС (hosting.glonasssoft.ru) — раздел
 * «Карта» → кнопка «Глонасс». Главный процесс держит токен и ходит к ГЛОНАСС
 * ТОЛЬКО через VPS-туннель (тот же мост, что спутник/погода; политика
 * «Транспорт — всегда через VPS»). В renderer креды не светим.
 *
 * Аккаунт — общий организационный read-only логин EVRAZ-TT (мониторинг).
 *
 * Проверенные методы (этим аккаунтом):
 *   • POST /v3/auth/login                  → AuthId (токен X-Auth)
 *   • POST /v3/vehicles/find {parents:[]}  → список ТС (89 машин: гаражный № + госномер в name)
 *   • POST /monitoringVehicles/update/0    → ЖИВЫЕ позиции (тот же фид, что рисует сайт!);
 *                                            тело = сырой массив id [216514,…]; ответ
 *                                            [{VehicleID,Latitude,Longitude,Course,Speed,RecordTime,Ign}]
 *   • GET  /history/points                  → сжатые точки маршрута за период
 *   • POST /v3/vehicles/moveStop {vehicleIds,from,to} → движения/стоянки за период
 *   • POST /v3/vehicles/mileageAndMotohours {vehicleIds,from,to} → пробег/моточасы
 *   (raw-трек /v3/terminalMessages этому аккаунту запрещён — 403.)
 */

const GLONASS_BASE = 'https://hosting.glonasssoft.ru/api';
const GLONASS_LOGIN = 'EVRAZ-TT';
const GLONASS_PASSWORD = 'EVRAZ-TT';
const AUTH_TTL_MS = 25 * 60 * 1000; // проактивный перелогин

let authId: string | null = null;
let authAt = 0;
let authInFlight: Promise<string | null> | null = null;

async function login(): Promise<string | null> {
  try {
    const resp = await bridgeFetch(`${GLONASS_BASE}/v3/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: GLONASS_LOGIN, password: GLONASS_PASSWORD }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { AuthId?: unknown };
    authId = typeof data?.AuthId === 'string' ? data.AuthId : null;
    authAt = Date.now();
    return authId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:glonass] login fail', err);
    return null;
  }
}

async function getAuth(force = false): Promise<string | null> {
  if (!force && authId && Date.now() - authAt < AUTH_TTL_MS) return authId;
  if (!authInFlight) authInFlight = login().finally(() => { authInFlight = null; });
  return authInFlight;
}

type ApiResult = { ok: boolean; status: number; data: unknown };

/** Авторизованный POST с одним перелогином при протухшей сессии. */
async function apiPost(path: string, body: unknown): Promise<ApiResult> {
  let token = await getAuth();
  if (!token) return { ok: false, status: 0, data: null };
  const call = (tk: string) =>
    bridgeFetch(`${GLONASS_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': tk },
      body: JSON.stringify(body),
    });
  try {
    let resp = await call(token);
    if (resp.status === 401) {
      token = await getAuth(true);
      if (token) resp = await call(token);
    }
    let data: unknown = null;
    try { data = await resp.json(); } catch { /* не JSON */ }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pyn:glonass] ${path} fail`, err);
    return { ok: false, status: 0, data: null };
  }
}

/** Авторизованный GET с перелогином и мягким retry на rate-limit сайта. */
async function apiGet(path: string): Promise<ApiResult> {
  let token = await getAuth();
  if (!token) return { ok: false, status: 0, data: null };
  const call = (tk: string) =>
    bridgeFetch(`${GLONASS_BASE}${path}`, {
      method: 'GET',
      headers: { 'X-Auth': tk },
    });
  try {
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      resp = await call(token);
      if (resp.status === 401) {
        token = await getAuth(true);
        if (!token) return { ok: false, status: 0, data: null };
        resp = await call(token);
      }
      if (resp.status !== 429 && resp.status !== 503) break;
      const retryAfter = Number(resp.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1200 + attempt * 1400;
      // eslint-disable-next-line no-console
      console.warn(`[pyn:glonass] ${path} rate limited (${resp.status}), retry ${attempt + 1}/5 in ${delayMs}ms`);
      await sleep(delayMs);
    }
    if (!resp) return { ok: false, status: 0, data: null };
    let data: unknown = null;
    try { data = await resp.json(); }
    catch {
      try { data = await resp.text(); } catch { /* keep null */ }
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pyn:glonass] ${path} fail`, err);
    return { ok: false, status: 0, data: null };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Нормализация ────────────────────────────────────────────────────────────

export type GlonassVehicle = {
  id: number;          // vehicleId
  guid: string;        // vehicleGuid
  name: string;        // полное имя из ГЛОНАСС: "(1034) Т300КН 96"
  garage: string;      // гаражный № из скобок: "1034"
  gos: string;         // госномер/остаток имени: "Т300КН 96"
  imei: string;
  status: number;      // статус ГЛОНАСС (-1 нет данных)
};

/** Разбор имени ГЛОНАСС "(1034) Т300КН 96 ГАЗ" → garage="1034", gos="Т300КН 96 ГАЗ". */
function parseVehicleName(name: string): { garage: string; gos: string } {
  const m = /^\s*\(([^)]+)\)\s*(.*)$/.exec(name || '');
  if (m) return { garage: (m[1] ?? '').trim(), gos: (m[2] ?? '').trim() };
  return { garage: '', gos: (name || '').trim() };
}

function normalizeVehicles(data: unknown): GlonassVehicle[] {
  if (!Array.isArray(data)) return [];
  const out: GlonassVehicle[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = Number(r.vehicleId);
    if (!Number.isFinite(id)) continue;
    const name = typeof r.name === 'string' ? r.name : '';
    const { garage, gos } = parseVehicleName(name);
    out.push({
      id,
      guid: typeof r.vehicleGuid === 'string' ? r.vehicleGuid : '',
      name,
      garage,
      gos,
      imei: typeof r.imei === 'string' ? r.imei : '',
      status: Number.isFinite(Number(r.status)) ? Number(r.status) : -1,
    });
  }
  // По гаражному номеру (числом, где можно), затем по имени.
  out.sort((a, b) => {
    const na = Number(a.garage); const nb = Number(b.garage);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.name.localeCompare(b.name, 'ru');
  });
  return out;
}

export type GlonassPosition = {
  id: number;
  lat: number;
  lng: number;
  speed: number | null;
  course: number | null;
  ign: boolean | null;
  time: string | null;  // ISO время последней точки
};

export type GlonassHistoryPoint = {
  lat: number;
  lng: number;
  speed: number | null;
  time: string;
};

/** Достаём позицию из объекта getlastdata, мягко (имена полей могут отличаться). */
function readPosition(row: Record<string, unknown>): GlonassPosition | null {
  const id = Number(row.VehicleID ?? row.vehicleId ?? row.VehicleId ?? row.id);
  const lat = Number(row.Latitude ?? row.lat ?? row.latitude ?? row.Lat);
  const lng = Number(row.Longitude ?? row.lng ?? row.lon ?? row.longitude ?? row.Lon);
  if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  const speedRaw = Number(row.Speed ?? row.speed);
  const courseRaw = Number(row.Course ?? row.course);
  const time = (row.RecordTime ?? row.ReceiveTime ?? row.receiveTime ?? row.deviceTime ?? row.Time ?? row.time ?? null);
  return {
    id,
    lat,
    lng,
    speed: Number.isFinite(speedRaw) ? speedRaw : null,
    course: Number.isFinite(courseRaw) ? courseRaw : null,
    ign: typeof row.Ign === 'boolean' ? row.Ign : (typeof row.ign === 'boolean' ? row.ign : null),
    time: typeof time === 'string' ? time : null,
  };
}

function normalizePositions(data: unknown): GlonassPosition[] {
  if (!Array.isArray(data)) return [];
  const out: GlonassPosition[] = [];
  for (const row of data) {
    if (row && typeof row === 'object') {
      const p = readPosition(row as Record<string, unknown>);
      if (p) out.push(p);
    }
  }
  return out;
}

function normalizeHistoryPoints(data: unknown): GlonassHistoryPoint[] {
  let raw = '';
  if (typeof data === 'string') raw = data;
  else if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>;
    raw = String(r.points ?? r.Points ?? r.data ?? r.Data ?? '');
  }
  raw = raw.trim();
  if (!raw) return [];

  const splitAt = raw.indexOf('&');
  if (splitAt < 0) return [];
  const baseMs = parseGlonassDate(raw.slice(0, splitAt));
  if (!Number.isFinite(baseMs)) return [];

  const out: GlonassHistoryPoint[] = [];
  const rows = raw.slice(splitAt + 1).split(':');
  for (const row of rows) {
    const parts = row.split(',');
    if (parts.length < 4) continue;
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    const offsetSec = Number(parts[2]);
    const speed = Number(parts[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(offsetSec)) continue;
    if (lat === 0 && lng === 0) continue;
    out.push({
      lat,
      lng,
      speed: Number.isFinite(speed) ? speed : null,
      time: new Date(baseMs + offsetSec * 1000).toISOString(),
    });
  }
  return out;
}

function parseGlonassDate(value: string): number {
  const s = value.trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(normalized);
}

// ── IPC ──────────────────────────────────────────────────────────────────────

export function setupGlonassBridge(): void {
  // Список парка (гаражный № + госномер). Кэш-дружелюбно: renderer тянет редко.
  ipcMain.handle('pyn:glonass-vehicles', async () => {
    const res = await apiPost('/v3/vehicles/find', { parents: [] });
    if (!res.ok) return { ok: false, vehicles: [] as GlonassVehicle[], error: describe(res) };
    return { ok: true, vehicles: normalizeVehicles(res.data) };
  });

  // Живые позиции выбранных машин — ТОТ ЖЕ фид, что рисует карту на сайте
  // (POST /monitoringVehicles/update/0, тело = сырой массив id). Возвращает
  // последнюю точку каждой машины (lat/lng/course/speed + время фикса). Старость
  // фикса (нет связи сейчас) определяет renderer по времени.
  ipcMain.handle('pyn:glonass-positions', async (_evt, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
    if (list.length === 0) return { ok: true, positions: [] as GlonassPosition[], offline: false };
    const res = await apiPost('/monitoringVehicles/update/0', list);
    if (!res.ok) return { ok: false, positions: [] as GlonassPosition[], offline: false, error: describe(res) };
    const positions = normalizePositions(res.data);
    return { ok: true, positions, offline: positions.length === 0 };
  });

  // Движения/стоянки за период (для трека/активности на дату).
  ipcMain.handle('pyn:glonass-activity', async (_evt, id: unknown, from: unknown, to: unknown) => {
    const vid = Number(id);
    if (!Number.isFinite(vid)) return { ok: false, moves: [], stops: [] };
    const res = await apiPost('/v3/vehicles/moveStop', { vehicleIds: [vid], from: String(from), to: String(to) });
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
      return { ok: res.ok, moves: [], stops: [], error: res.ok ? null : describe(res) };
    }
    const row = res.data[0] as Record<string, unknown>;
    return {
      ok: true,
      moves: Array.isArray(row.moves) ? row.moves : [],
      stops: Array.isArray(row.stops) ? row.stops : [],
    };
  });

  // Сырые точки исторического маршрута. Сайт отдаёт сжатую строку:
  // "YYYY-MM-DD HH:mm:ssZ&lat,lng,offsetSec,speed:lat,lng,offsetSec,speed..."
  ipcMain.handle('pyn:glonass-history-points', async (_evt, id: unknown, from: unknown, to: unknown) => {
    const vid = Number(id);
    if (!Number.isFinite(vid)) return { ok: false, points: [] as GlonassHistoryPoint[], error: 'bad_vehicle_id' };
    const params = new URLSearchParams({
      vehicleId: String(vid),
      start: String(from),
      end: String(to),
    });
    const res = await apiGet(`/history/points?${params.toString()}`);
    if (!res.ok) return { ok: false, points: [] as GlonassHistoryPoint[], error: describe(res) };
    return { ok: true, points: normalizeHistoryPoints(res.data) };
  });

  // Пробег/моточасы за период (статистика).
  ipcMain.handle('pyn:glonass-stats', async (_evt, ids: unknown, from: unknown, to: unknown) => {
    const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
    if (list.length === 0) return { ok: true, items: [] };
    const res = await apiPost('/v3/vehicles/mileageAndMotohours', { vehicleIds: list, from: String(from), to: String(to) });
    if (!res.ok) return { ok: false, items: [], error: describe(res) };
    return { ok: true, items: Array.isArray(res.data) ? res.data : [] };
  });
}

function describe(res: ApiResult): string {
  const d = res.data as { ApiMessage?: string; Message?: string } | null;
  return (d?.ApiMessage || d?.Message || `HTTP ${res.status}`) ?? 'glonass_error';
}
