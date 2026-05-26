import type { ApiClient } from '../api/client';

/**
 * Schedule endpoints — server-sync для раздела «График».
 *
 * §TZ-SERVER-SYNC-COLLAB этап A: GET / PUT / months_list.
 *
 * Один row per (year, month) в D1 `schedule_state`. state JSON содержит
 * meta (всегда) + опциональные shopsFrozen / removedFrozen / shippingFrozen
 * (заморозка на commit). Optimistic concurrency через `version`.
 *
 * Wire-формат (snake_case) изолирован в этом файле — UI работает с camelCase.
 */

// ── Domain types (camelCase, для UI) ───────────────────────────────────────

/**
 * State объект который кладётся в server JSON. По-сути сериализуемая часть
 * ScheduleState клиента — клиент знает свой полный shape (ScheduleMeta + т.д.),
 * сервер просто хранит как opaque JSON.
 *
 * Используем generic `Record<string, unknown>` чтобы не дублировать тип в
 * @pyn/core (UI типы живут в apps/desktop/src/lib/schedule/types.ts).
 */
export type ScheduleStatePayload = Record<string, unknown>;

export interface ScheduleSnapshot {
  /** Содержимое state_json (null если на сервере ничего нет за этот месяц). */
  state: ScheduleStatePayload | null;
  /** Текущая version в DB. 0 если row отсутствует. */
  version: number;
  /** 1 = irreversibly committed. */
  committed: number;
  /** Login юзера зафиксировавшего месяц. */
  committedBy: string;
  /** Full name юзера зафиксировавшего (snapshot на момент commit'а). */
  committedByName: string;
  /** ISO timestamp commit'а. */
  committedAt: string;
  /** Login последнего write'а (любого, не commit'а). */
  updatedBy: string;
  /** Full name последнего write'а. */
  updatedByName: string;
  /** ISO timestamp последнего write'а. */
  updatedAt: string;
}

export interface ScheduleMonthSummary {
  year: number;
  month: number;
  committed: number;
  committedByName: string;
  updatedAt: string;
  updatedByName: string;
}

export interface SchedulePutResult {
  version: number;
  updatedBy: string;
  updatedByName: string;
}

/**
 * Когда сервер возвращает 409 — это бросается клиенту как `ApiError`
 * с code='version_conflict'. Server вкладывает в response (теперь в
 * `ApiError.details`) актуальный snapshot — caller использует этот helper
 * чтобы извлечь его без ручного парсинга.
 *
 * Аналогично — code='month_committed' (403): сервер тоже возвращает свежий
 * snapshot, помогает мгновенно обновить UI до read-only состояния.
 */
export function readConflictSnapshot(err: unknown): ScheduleSnapshot | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; details?: unknown };
  if (e.code !== 'version_conflict' && e.code !== 'month_committed') return null;
  return parseSnapshot(e.details as Record<string, unknown> | null | undefined);
}

// ── SCHEDULE_GET ───────────────────────────────────────────────────────────

/**
 * Прочитать снапшот за (year, month). Если на сервере ничего нет —
 * возвращает `{ state: null, version: 0, committed: 0 }`.
 */
export async function scheduleGet(
  client: ApiClient,
  req: { year: number; month: number },
): Promise<ScheduleSnapshot> {
  const wire = await client.call<Record<string, unknown>>('schedule_get', {
    year: req.year,
    month: req.month,
  });
  return parseSnapshot(wire);
}

// ── SCHEDULE_PUT ───────────────────────────────────────────────────────────

/**
 * Записать снапшот за (year, month). `expectedVersion`:
 *   • 0 — INSERT (row не должен существовать). Если есть → 409 conflict.
 *   • >0 — UPDATE WHERE version = expectedVersion. Если version изменилась → 409.
 *
 * При 409 — caller должен ре-фечнуть и пере-применить локальные изменения.
 * Сервер при 409 возвращает payload с актуальным snapshot, см. `readConflictSnapshot`.
 *
 * Throw'ает ApiError с code='month_committed' если месяц зафиксирован.
 */
export async function schedulePut(
  client: ApiClient,
  req: {
    year: number;
    month: number;
    state: ScheduleStatePayload;
    expectedVersion: number;
  },
): Promise<SchedulePutResult> {
  const wire = await client.call<{
    version?: number;
    updated_by?: string;
    updated_by_name?: string;
  }>('schedule_put', {
    year: req.year,
    month: req.month,
    state: req.state,
    expected_version: req.expectedVersion,
  });
  return {
    version: Number(wire.version ?? 0),
    updatedBy: String(wire.updated_by ?? ''),
    updatedByName: String(wire.updated_by_name ?? ''),
  };
}

// ── SCHEDULE_MONTHS_LIST ───────────────────────────────────────────────────

/** Список всех записанных (year, month) с краткой meta. Сортировка — свежие сверху. */
export async function scheduleMonthsList(
  client: ApiClient,
): Promise<ScheduleMonthSummary[]> {
  const wire = await client.call<{
    data?: Array<{
      year: number;
      month: number;
      committed: number;
      committed_by_name?: string;
      updated_at?: string;
      updated_by_name?: string;
    }>;
  }>('schedule_months_list', {});
  return (wire.data ?? []).map((r) => ({
    year: Number(r.year),
    month: Number(r.month),
    committed: Number(r.committed) || 0,
    committedByName: r.committed_by_name ?? '',
    updatedAt: r.updated_at ?? '',
    updatedByName: r.updated_by_name ?? '',
  }));
}

// ── LOCK MECHANISM (этап C) ────────────────────────────────────────────────

/**
 * User info из lock row для отображения в EditorLockedOverlay.
 * Соответствует server-side колонкам schedule_edit_lock.user_*.
 */
export interface ScheduleLockOwner {
  userLogin: string;
  fullName: string;
  avatarUrl: string;
  avatarBlobKey: string;
  avatarBlobNonce: string;
  acquiredAt: string;
  leaseExpiresAt: string;
}

/**
 * Если acquire вернул 409 lock_held — этот helper достаёт owner info
 * из ApiError.details для отображения в overlay.
 */
export function readLockOwner(err: unknown): ScheduleLockOwner | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; details?: unknown };
  if (e.code !== 'lock_held') return null;
  const d = e.details as Record<string, unknown> | null | undefined;
  const owner = d?.owner as Record<string, unknown> | undefined;
  if (!owner) return null;
  return {
    userLogin: String(owner.user_login ?? ''),
    fullName: String(owner.full_name ?? ''),
    avatarUrl: String(owner.avatar_url ?? ''),
    avatarBlobKey: String(owner.avatar_blob_key ?? ''),
    avatarBlobNonce: String(owner.avatar_blob_nonce ?? ''),
    acquiredAt: String(owner.acquired_at ?? ''),
    leaseExpiresAt: String(owner.lease_expires_at ?? ''),
  };
}

/**
 * Acquire lock на конкретный resource_id. Throw'ает ApiError('lock_held') если
 * lock занят другим юзером — caller использует `readLockOwner(err)` чтобы
 * получить user info для overlay.
 *
 * Lock TTL = 30s. Heartbeat extend'ит каждые 10s пока активен.
 */
export async function scheduleLockAcquire(
  client: ApiClient,
  resourceId: string,
): Promise<{ resourceId: string; leaseExpiresAt: string }> {
  const wire = await client.call<{
    resource_id?: string;
    lease_expires_at?: string;
  }>('schedule_lock_acquire', { resource_id: resourceId });
  return {
    resourceId: String(wire.resource_id ?? resourceId),
    leaseExpiresAt: String(wire.lease_expires_at ?? ''),
  };
}

/**
 * Heartbeat — extend lease на ещё 30s. Throw'ает ApiError('lock_not_owned')
 * если lock уже у другого юзера или expired (caller release'ит UI lock).
 */
export async function scheduleLockHeartbeat(
  client: ApiClient,
  resourceId: string,
): Promise<{ leaseExpiresAt: string }> {
  const wire = await client.call<{ lease_expires_at?: string }>(
    'schedule_lock_heartbeat',
    { resource_id: resourceId },
  );
  return { leaseExpiresAt: String(wire.lease_expires_at ?? '') };
}

/**
 * Release lock — fire-and-forget на client'е (response не критичен). Server
 * проверяет owner (защита от чужого release).
 */
export async function scheduleLockRelease(
  client: ApiClient,
  resourceId: string,
): Promise<void> {
  await client.call('schedule_lock_release', { resource_id: resourceId });
}

// ── helpers ────────────────────────────────────────────────────────────────

function parseSnapshot(wire: Record<string, unknown> | null | undefined): ScheduleSnapshot {
  const w = wire ?? {};
  const state = (w.state as ScheduleStatePayload | null | undefined) ?? null;
  return {
    state: state && typeof state === 'object' ? state : null,
    version: Number(w.version ?? 0),
    committed: Number(w.committed ?? 0) || 0,
    committedBy: String(w.committed_by ?? ''),
    committedByName: String(w.committed_by_name ?? ''),
    committedAt: String(w.committed_at ?? ''),
    updatedBy: String(w.updated_by ?? ''),
    updatedByName: String(w.updated_by_name ?? ''),
    updatedAt: String(w.updated_at ?? ''),
  };
}
