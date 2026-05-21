import type { ApiClient } from '../api/client';

/**
 * Kill switch / app lock endpoints (v2, 2026-05-20).
 *
 * Server-side: `handlers-app-lock.js`. Developer-only кроме `confirmWipe`.
 *
 * Dual scope:
 *   • 'desktop' — блокирует Mac + Win клиенты Pyn
 *   • 'android' — блокирует Android клиенты Pyn
 * Каждый scope управляется независимо.
 */

export type AppLockState = 'normal' | 'paused' | 'wiping' | 'wiped';
export type AppLockScope = 'desktop' | 'android';

export interface AppLockScopeStatus {
  scope: AppLockScope;
  state: AppLockState;
  title: string;
  message: string;
  wipeAt: string | null;
  initiatedBy: string;
  updatedAt: string;
}

export interface AppLockStatus {
  desktop: AppLockScopeStatus;
  android: AppLockScopeStatus;
  devicesActive: Record<string, number>;
  devicesWiped: Record<string, number>;
}

interface AppLockStatusWire {
  data?: {
    desktop?: AppLockScopeWire;
    android?: AppLockScopeWire;
    devices_active?: Record<string, number>;
    devices_wiped?: Record<string, number>;
  };
}

interface AppLockScopeWire {
  scope?: string;
  state?: string;
  title?: string;
  message?: string;
  wipe_at?: string | null;
  initiated_by?: string;
  updated_at?: string;
}

function normalizeState(v: string | undefined): AppLockState {
  if (v === 'normal' || v === 'paused' || v === 'wiping' || v === 'wiped') return v;
  return 'normal';
}

function parseScopeStatus(wire: AppLockScopeWire | undefined, fallbackScope: AppLockScope): AppLockScopeStatus {
  return {
    scope: (wire?.scope === 'desktop' || wire?.scope === 'android') ? wire.scope : fallbackScope,
    state: normalizeState(wire?.state),
    title: wire?.title || '',
    message: wire?.message || '',
    wipeAt: wire?.wipe_at ?? null,
    initiatedBy: wire?.initiated_by || '',
    updatedAt: wire?.updated_at || '',
  };
}

/**
 * Активировать kill switch для указанного scope.
 * @param scope 'desktop' (Mac + Win) или 'android'.
 * @param password Toggle-пароль (server check). Без него — 403 wrong_password.
 * @param wipeAfterSeconds Default 86400 (24h). Min 30, max 7 дней.
 */
export async function activateAppLock(
  client: ApiClient,
  args: {
    scope: AppLockScope;
    password: string;
    message?: string;
    title?: string;
    wipeAfterSeconds?: number;
  },
): Promise<{ scope: AppLockScope; state: AppLockState; wipeAt: string | null }> {
  const wire = await client.call<{ scope?: string; state?: string; wipe_at?: string | null }>(
    'activate_app_lock',
    {
      scope: args.scope,
      password: args.password,
      title: args.title,
      message: args.message,
      wipe_after_seconds: args.wipeAfterSeconds,
    },
  );
  return {
    scope: (wire.scope === 'desktop' || wire.scope === 'android') ? wire.scope : args.scope,
    state: normalizeState(wire.state),
    wipeAt: wire.wipe_at ?? null,
  };
}

/** Снять lock для указанного scope. Требует toggle-пароль. */
export async function deactivateAppLock(
  client: ApiClient,
  args: { scope: AppLockScope; password: string },
): Promise<{ scope: AppLockScope; state: AppLockState; prevState: AppLockState }> {
  const wire = await client.call<{ scope?: string; state?: string; prev_state?: string }>(
    'deactivate_app_lock',
    { scope: args.scope, password: args.password },
  );
  return {
    scope: (wire.scope === 'desktop' || wire.scope === 'android') ? wire.scope : args.scope,
    state: normalizeState(wire.state),
    prevState: normalizeState(wire.prev_state),
  };
}

/** Возвращает state обоих scope'ов + agregated device stats для UI. */
export async function getAppLockStatus(client: ApiClient): Promise<AppLockStatus> {
  const wire = await client.call<AppLockStatusWire>('get_app_lock_status', {});
  const d = wire.data;
  return {
    desktop: parseScopeStatus(d?.desktop, 'desktop'),
    android: parseScopeStatus(d?.android, 'android'),
    devicesActive: d?.devices_active || {},
    devicesWiped: d?.devices_wiped || {},
  };
}

/**
 * Подтвердить локальный wipe. Server и так пометил device 'wiped' через
 * auto-trigger, это аудит-row.
 */
export async function confirmWipe(
  client: ApiClient,
  deviceId: string,
): Promise<void> {
  await client.call<{ success?: boolean }>('confirm_wipe', { device_id: deviceId });
}
