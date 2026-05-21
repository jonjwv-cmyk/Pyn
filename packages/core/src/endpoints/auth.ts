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
  /**
   * Полный device_id (UUID v4) для kill switch trust-store (device_marks).
   * Persistится в encrypted cache локально. При wipe удаляется → новый
   * install получит свежий UUID, сервер начнёт track'ить как новое
   * устройство.
   */
  deviceId: string;
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
    device_id: req.deviceId,
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

// ── Android / mobile login (action='login', не PC-only) ───────────────────

export interface AndroidLoginRequest {
  login: string;
  password: string;
  /** Полный device_id (UUID v4) для kill switch trust-store. */
  deviceId: string;
  /** Версия mobile-app для min_version check. */
  appVersion: string;
}

/**
 * Mobile/Android login через action='login'. Возвращает тот же тип
 * LoginResponse как desktop'овский `login()`, но проходит через другой
 * server handler (handlers-session.js::handleLogin, не PC sessions).
 */
export async function androidLogin(
  client: ApiClient,
  req: AndroidLoginRequest,
): Promise<LoginResponse> {
  const wire = await client.call<LoginWire>('login', {
    login: req.login,
    password: req.password,
    device_id: req.deviceId,
    app_version: req.appVersion,
    platform: 'android',
  });
  return {
    token: wire.token ?? '',
    role: parseRole(wire.user?.role),
    user: {
      login: wire.user?.login ?? req.login,
      fullName: wire.user?.full_name ?? '',
      avatarUrl: wire.user?.avatar_url,
    },
    expiresAt: wire.expires_at,
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
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
  presenceStatus?: 'online' | 'away' | 'offline';
}

/**
 * Server FLAT envelope для `me` имеет форму `{ok, user:{...}, features}` —
 * поля юзера лежат в `user`, не на верхнем уровне. Точное зеркало
 * `server-modular/handlers-session.js::handleMe`.
 */
interface MeWire {
  user?: {
    login?: string;
    full_name?: string;
    role?: string;
    avatar_url?: string;
    avatar_blob_key_b64?: string;
    avatar_blob_nonce_b64?: string;
    presence_status?: string;
  };
}

export async function me(client: ApiClient): Promise<MeResponse> {
  const wire = await client.call<MeWire>('me', {});
  const u = wire.user;
  return {
    login: u?.login ?? '',
    fullName: u?.full_name ?? '',
    role: parseRole(u?.role),
    avatarUrl: u?.avatar_url || undefined,
    avatarBlobKey: u?.avatar_blob_key_b64 || undefined,
    avatarBlobNonce: u?.avatar_blob_nonce_b64 || undefined,
    presenceStatus: parsePresence(u?.presence_status),
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

/** Тип сессии. PC-сессии (`pc_qr`, `pc_password`) подлежат time-window enforcement. */
export type SessionKind = 'pc_qr' | 'pc_password' | 'mobile' | 'standard' | string;

export interface MeSessionInfo {
  sessionId: string;
  sessionKind: SessionKind;
  /** true если сессия — PC (QR или password); только тогда есть extensions. */
  isPc: boolean;
  /** ISO server-local time `YYYY-MM-DD HH:MM:SS` (Yek). */
  expiresAt: string;
  /** Server-computed remaining milliseconds; клиент может использовать как baseline. */
  remainingMs: number;
  /** Кол-во уже использованных extension'ов (макс 3). */
  extensionsUsed: number;
  /** Сколько extensions осталось (0 для не-PC сессий). */
  extensionsRemaining: number;
  deviceLabel: string;
  createdAt?: string;
  /** Yek HH:MM время истечения для краткого UI-label'a. */
  yekHm?: string;
}

/**
 * Текущая сессия — id, тип, expiry, оставшиеся extensions. Используется для
 * SessionExpiryWatch (предложение продлить за 5 мин до истечения PC-сессии).
 */
export async function meSessionInfo(client: ApiClient): Promise<MeSessionInfo> {
  const wire = await client.call<{
    session?: {
      session_id?: string;
      session_kind?: string;
      is_pc?: boolean;
      expires_at?: string;
      remaining_ms?: number;
      extensions_used?: number;
      extensions_remaining?: number;
      device_label?: string;
      created_at?: string;
      yek_hm?: string;
    };
  }>('me_session_info', {});
  const s = wire.session;
  if (!s) throw new Error('me_session_info: empty session');
  return {
    sessionId: s.session_id ?? '',
    sessionKind: (s.session_kind ?? 'standard') as SessionKind,
    isPc: Boolean(s.is_pc),
    expiresAt: s.expires_at ?? '',
    remainingMs: Number(s.remaining_ms ?? 0),
    extensionsUsed: Number(s.extensions_used ?? 0),
    extensionsRemaining: Number(s.extensions_remaining ?? 0),
    deviceLabel: s.device_label ?? '',
    createdAt: s.created_at,
    yekHm: s.yek_hm,
  };
}

// ── CHANGE_PASSWORD (self) ────────────────────────────────────────────────

/**
 * Сменить свой пароль. Server валидирует `oldPassword`, отвергнет
 * `new_password_too_short`. После успеха все остальные сессии этого юзера
 * остаются — server не revoke'ит их (отличие от admin `reset_password`).
 */
export async function changePassword(
  client: ApiClient,
  args: { oldPassword: string; newPassword: string },
): Promise<void> {
  await client.call<{ success?: boolean }>('change_password', {
    old_password: args.oldPassword,
    new_password: args.newPassword,
  });
}

// ── APP_STATUS (публичный — без token) ─────────────────────────────────────

export interface AppStatusRequest {
  /** 'desktop-mac' | 'desktop-win' — desktop scope. 'main' / 'android' — Android. */
  appScope: 'desktop-mac' | 'desktop-win' | 'main' | 'android';
  appVersion: string;
  binarySha?: string;
}

export interface AppStatusResponse {
  currentVersion: string;
  updateUrl?: string;
  forceUpdate: boolean;
  /**
   * SHA-256 hash бинаря current_version на сервере (hex, lowercase).
   * Client после download проверяет хэш — защита от подмены exe в пути
   * CF→VPS→client. Если пусто — verify пропускается.
   */
  binarySha?: string;
  /**
   * Kill switch / app lock state (2026-05-20). 'normal' если не активна.
   * При 'paused' / 'wiping' клиент показывает overlay и (для wiping)
   * вызывает IPC wipe.
   */
  appLockState?: 'normal' | 'paused' | 'wiping' | 'wiped';
  appLockTitle?: string;
  appLockMessage?: string;
  appLockWipeAt?: string | null;
  appLockInitiatedBy?: string;
}

interface AppStatusWire {
  current_version?: string;
  update_url?: string;
  force_update?: boolean;
  binary_sha?: string;
  app_state?: string;
  app_title?: string;
  app_message?: string;
  app_lock_scope?: string | null;
  app_lock_wipe_at?: string | null;
  app_lock_initiated_by?: string;
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
    binarySha: wire.binary_sha || '',
    appLockState: normalizeAppLockState(wire.app_state),
    appLockTitle: wire.app_title || '',
    appLockMessage: wire.app_message || '',
    appLockWipeAt: wire.app_lock_wipe_at ?? null,
    appLockInitiatedBy: wire.app_lock_initiated_by || '',
  };
}

function normalizeAppLockState(v: string | undefined):
  'normal' | 'paused' | 'wiping' | 'wiped' | undefined {
  if (v === 'normal' || v === 'paused' || v === 'wiping' || v === 'wiped') return v;
  return undefined;
}
