import type { ApiClient } from '../api/client';
import { parseRole, type Role } from '../auth/role';
import type { Session } from '../auth/session';

/**
 * POST /api action=password_login_pc — desktop password login.
 *
 * НЕ `login` — это action для mobile. Desktop использует специальный flow
 * `password_login_pc` с rate limit'ом 3 раза в неделю (server-side).
 * Primary login на desktop'е — QR (`request_pc_session_qr` + polling),
 * password — fallback.
 */

export interface LoginRequest {
  login: string;
  password: string;
  /**
   * Человекочитаемый label устройства (max 40 chars). Видно админу в
   * `list_pc_sessions`. Например "Pyn-mac-b7fac2b2".
   */
  deviceLabel: string;
  desktopOs: 'mac' | 'win';
  /** Optional custom expiry для token'a (ISO 8601). */
  customExpiryIso?: string;
}

export interface LoginResponse {
  token: string;
  role: Role;
  user: {
    login: string;
    fullName: string;
    avatarUrl?: string;
  };
  expiresAt?: string;
  /** Server-side rate counter: used / limit парольных входов на этой неделе. */
  passwordCounter?: { used: number; limit: number };
}

interface LoginWire {
  token?: string;
  expires_at?: string;
  user?: {
    login?: string;
    role?: string;
    full_name?: string;
    avatar_url?: string;
  };
  password_counter?: { used?: number; limit?: number };
}

export async function login(client: ApiClient, req: LoginRequest): Promise<LoginResponse> {
  const wire = await client.call<LoginWire>('password_login_pc', {
    login: req.login,
    password: req.password,
    device_label: req.deviceLabel.slice(0, 40),
    desktop_os: req.desktopOs,
    custom_expiry_iso: req.customExpiryIso,
  });
  const counter = wire.password_counter;
  return {
    token: wire.token ?? '',
    role: parseRole(wire.user?.role),
    user: {
      login: wire.user?.login ?? req.login,
      fullName: wire.user?.full_name ?? '',
      avatarUrl: wire.user?.avatar_url,
    },
    expiresAt: wire.expires_at,
    passwordCounter:
      counter && typeof counter.used === 'number' && typeof counter.limit === 'number'
        ? { used: counter.used, limit: counter.limit }
        : undefined,
  };
}

/**
 * Конвертер LoginResponse → Session для персистенции. `passwordCounter` не
 * сохраняем — он динамический per-week и доступен отдельно.
 */
export function loginResponseToSession(r: LoginResponse): Session {
  return {
    token: r.token,
    role: r.role,
    user: {
      login: r.user.login,
      fullName: r.user.fullName,
      avatarUrl: r.user.avatarUrl,
    },
    loggedInAt: new Date().toISOString(),
    expiresAt: r.expiresAt,
  };
}

// ── GET_PASSWORD_COUNTER ───────────────────────────────────────────────────

export interface PasswordCounter {
  used: number;
  limit: number;
}

/** Текущее число использованных парольных входов за неделю (для UI hint'a). */
export async function getPasswordCounter(
  client: ApiClient,
  loginValue: string,
): Promise<PasswordCounter | null> {
  try {
    const wire = await client.call<{ used?: number; limit?: number }>('get_password_counter', {
      login: loginValue,
    });
    if (typeof wire.used !== 'number' || typeof wire.limit !== 'number') return null;
    return { used: wire.used, limit: wire.limit };
  } catch {
    return null;
  }
}

// ── ME ────────────────────────────────────────────────────────────────────

export interface MeResponse {
  login: string;
  fullName: string;
  role: Role;
  avatarUrl?: string;
  presenceStatus?: 'online' | 'away' | 'offline';
}

interface MeWire {
  login?: string;
  full_name?: string;
  role?: string;
  avatar_url?: string;
  presence_status?: string;
}

export async function me(client: ApiClient): Promise<MeResponse> {
  const wire = await client.call<MeWire>('me', {});
  return {
    login: wire.login ?? '',
    fullName: wire.full_name ?? '',
    role: parseRole(wire.role),
    avatarUrl: wire.avatar_url,
    presenceStatus: parsePresence(wire.presence_status),
  };
}

function parsePresence(v: string | undefined): 'online' | 'away' | 'offline' | undefined {
  if (v === 'online' || v === 'away' || v === 'offline') return v;
  return undefined;
}

// ── QR LOGIN (request_pc_session_qr + check_pc_session_status) ────────────

/**
 * QR-login это **primary** способ login'а на desktop'е в OTLHelper2:
 *   1. Desktop вызывает `request_pc_session_qr` → получает challenge + qr_payload (JSON string)
 *   2. Рендерит QR из qr_payload, polling'ует `check_pc_session_status` каждые 2 сек
 *   3. Юзер сканирует QR со смартфона (OTLHelper2 Android) → confirm → server создаёт PC session
 *   4. На следующем poll desktop получает `status:"redeemed"` + полный session object
 *
 * Server гарантирует single-PC policy — на redeem'е новой PC-сессии все
 * предыдущие revoke'аются.
 *
 * TTL QR — 60 секунд. После expiry desktop должен пере-запросить новый.
 */

export interface RequestPcSessionQrRequest {
  /** Человекочитаемый device label (mac/win-something), max 40 chars. */
  deviceLabel: string;
  desktopOs: 'mac' | 'win';
}

export interface RequestPcSessionQrResponse {
  /** Challenge token — кладётся в pending_pc_sessions, используется для polling'а. */
  challenge: string;
  /** Готовая JSON-строка для кодирования в QR-матрицу. Не парсим — отдаём библиотеке как есть. */
  qrPayload: string;
  /** Сколько секунд QR валиден — обычно 60. */
  ttlSec: number;
}

export async function requestPcSessionQr(
  client: ApiClient,
  req: RequestPcSessionQrRequest,
): Promise<RequestPcSessionQrResponse> {
  const wire = await client.call<{ challenge?: string; qr_payload?: string; ttl_sec?: number }>(
    'request_pc_session_qr',
    {
      device_label: req.deviceLabel.slice(0, 40),
      desktop_os: req.desktopOs,
    },
  );
  return {
    challenge: wire.challenge ?? '',
    qrPayload: wire.qr_payload ?? '',
    ttlSec: wire.ttl_sec ?? 60,
  };
}

export type PcSessionStatus = 'pending' | 'redeemed' | 'expired';

export interface CheckPcSessionStatusResponse {
  status: PcSessionStatus;
  /** Заполнено при `status === "redeemed"` — содержит token + user info как у password login. */
  session?: LoginResponse;
}

interface PcSessionStatusWire {
  status?: string;
  session?: {
    token?: string;
    login?: string;
    role?: string;
    full_name?: string;
    avatar_url?: string;
    expires_at?: string;
  };
}

export async function checkPcSessionStatus(
  client: ApiClient,
  challenge: string,
): Promise<CheckPcSessionStatusResponse> {
  try {
    const wire = await client.call<PcSessionStatusWire>('check_pc_session_status', {
      challenge,
    });
    const status = parseStatus(wire.status);
    if (status === 'redeemed' && wire.session) {
      const s = wire.session;
      return {
        status,
        session: {
          token: s.token ?? '',
          role: parseRole(s.role),
          user: {
            login: s.login ?? '',
            fullName: s.full_name ?? '',
            avatarUrl: s.avatar_url,
          },
          expiresAt: s.expires_at,
        },
      };
    }
    return { status };
  } catch (err) {
    // Сервер при expiry отвечает 401 / {ok:false, error:"qr_expired"} —
    // ApiClient бросает ApiError. Мапим в expired status вместо throw.
    const code = (err as { code?: string }).code;
    if (code === 'qr_expired' || code === 'expired' || code === 'session_not_found') {
      return { status: 'expired' };
    }
    throw err;
  }
}

function parseStatus(s: string | undefined): PcSessionStatus {
  if (s === 'redeemed' || s === 'expired') return s;
  return 'pending';
}

// ── EXTEND_SESSION + ME_SESSION_INFO (lifecycle) ──────────────────────────

/**
 * Продлевает срок жизни PC-сессии. Server enforce'ит max extensions count
 * (обычно 3 × 30 мин). Возвращает новый expires_at.
 */
export async function extendSession(client: ApiClient): Promise<{ expiresAt: string }> {
  const wire = await client.call<{ expires_at?: string }>('extend_session', {});
  return { expiresAt: wire.expires_at ?? '' };
}

export interface MeSessionInfo {
  id: string;
  deviceId?: string;
  platform?: string;
  expiresAt?: string;
  lastSeenAt?: string;
}

/** Текущая сессия — id, device, expiry. Для countdown UI в Settings. */
export async function meSessionInfo(client: ApiClient): Promise<MeSessionInfo> {
  const wire = await client.call<{
    session?: {
      id?: string;
      device_id?: string;
      platform?: string;
      expires_at?: string;
      last_seen_at?: string;
    };
  }>('me_session_info', {});
  const s = wire.session;
  if (!s) throw new Error('me_session_info: empty session');
  return {
    id: s.id ?? '',
    deviceId: s.device_id,
    platform: s.platform,
    expiresAt: s.expires_at,
    lastSeenAt: s.last_seen_at,
  };
}

// ── APP_STATUS (публичный — без token) ─────────────────────────────────────

export interface AppStatusRequest {
  appScope: 'desktop-mac' | 'desktop-win';
  appVersion: string;
  binarySha?: string;
}

export interface AppStatusResponse {
  currentVersion: string;
  updateUrl?: string;
  forceUpdate: boolean;
}

interface AppStatusWire {
  current_version?: string;
  update_url?: string;
  force_update?: boolean;
}

export async function appStatus(
  client: ApiClient,
  req: AppStatusRequest,
): Promise<AppStatusResponse> {
  const wire = await client.call<AppStatusWire>('app_status', {
    app_scope: req.appScope,
    app_version: req.appVersion,
    binary_sha: req.binarySha,
  });
  return {
    currentVersion: wire.current_version ?? req.appVersion,
    updateUrl: wire.update_url,
    forceUpdate: wire.force_update ?? false,
  };
}
