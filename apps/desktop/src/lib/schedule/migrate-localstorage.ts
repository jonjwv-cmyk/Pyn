/**
 * Migration: localStorage `pyn:schedule:months:v1` → server `schedule_state`.
 *
 * §TZ-SERVER-SYNC-COLLAB §11 — выполняется один раз при первом mount раздела
 * «График» после релиза server-sync. Идемпотентно через флаг `pyn:schedule:migrated:v1`.
 *
 * Алгоритм для каждой записи `[YYYY-MM, ScheduleState]`:
 *   1. GET /schedule/get для (year, month)
 *   2. Если на сервере уже есть → server wins, локальная запись отбрасывается
 *      (на сервере могут быть свежие данные от другого пользователя)
 *   3. Если на сервере пусто → PUT с локальным state (expected_version=0)
 *
 * После всех записей:
 *   - Если errors === 0 → ставим флаг `migrated:v1=true` + удаляем localStorage ключи
 *   - Если errors > 0 → флаг НЕ ставим, retry на следующем mount
 *
 * Семантика commit: в этапе A server не имеет /schedule/commit endpoint.
 * Локальный `meta.commit` сохраняется в state_json через PUT → UI продолжает
 * показывать «Зафиксировал…» через `isLocked = !!state.meta.commit`. Когда
 * этап D добавит серверный commit lock, отдельной миграции committed-флагов
 * не потребуется (UI уже работает через meta.commit как fallback).
 */

import { ApiError, scheduleGet, schedulePut, type ScheduleStatePayload } from '@pyn/core';
import { api } from '@/lib/api';
import type { ScheduleState } from './types';

const LEGACY_STORAGE_KEY = 'pyn:schedule:v1';
const LEGACY_ARCHIVE_KEY = 'pyn:schedule:months:v1';
const MIGRATED_FLAG_KEY = 'pyn:schedule:migrated:v1';

export interface ScheduleMigrationResult {
  /** Сколько месяцев успешно перенесено на сервер. */
  migrated: number;
  /** На сервере уже было — локальная запись отброшена. */
  conflicts: number;
  /** Не удалось перенести (network / server error). */
  errors: number;
  /** Migration уже выполнялась ранее — no-op. */
  alreadyDone: boolean;
}

export interface ScheduleMigrationOptions {
  /** Принудительно повторить миграцию даже если флаг уже стоит. */
  force?: boolean;
}

/**
 * Запускает миграцию. Безопасна для multiple calls — повторный вызов
 * после успешной миграции возвращает `alreadyDone: true` без сети.
 */
export async function migrateScheduleLocalStorageToServer(
  opts: ScheduleMigrationOptions = {},
): Promise<ScheduleMigrationResult> {
  const empty: ScheduleMigrationResult = {
    migrated: 0,
    conflicts: 0,
    errors: 0,
    alreadyDone: false,
  };

  if (!opts.force && safeGetItem(MIGRATED_FLAG_KEY) === 'true') {
    return { ...empty, alreadyDone: true };
  }

  const raw = safeGetItem(LEGACY_ARCHIVE_KEY);
  if (!raw) {
    // Нечего мигрировать — пометить и выйти.
    safeSetItem(MIGRATED_FLAG_KEY, 'true');
    safeRemoveItem(LEGACY_STORAGE_KEY);
    return { ...empty, alreadyDone: false };
  }

  let archive: Record<string, ScheduleState>;
  try {
    archive = JSON.parse(raw) as Record<string, ScheduleState>;
  } catch (err) {
    // Corrupt — пометить как done (ничего не вытаскиваем) и почистить.
    console.warn('[schedule:migration] corrupt archive, marking migrated', err);
    safeSetItem(MIGRATED_FLAG_KEY, 'true');
    safeRemoveItem(LEGACY_ARCHIVE_KEY);
    safeRemoveItem(LEGACY_STORAGE_KEY);
    return empty;
  }

  const entries = Object.entries(archive).filter(([key, state]) => {
    if (!state || typeof state !== 'object' || !state.meta) return false;
    const parts = key.split('-');
    return parts.length === 2 && Number.isInteger(Number(parts[0])) && Number.isInteger(Number(parts[1]));
  });

  if (entries.length === 0) {
    safeSetItem(MIGRATED_FLAG_KEY, 'true');
    safeRemoveItem(LEGACY_ARCHIVE_KEY);
    safeRemoveItem(LEGACY_STORAGE_KEY);
    return empty;
  }

  const result: ScheduleMigrationResult = { ...empty };
  for (const [key, state] of entries) {
    const parts = key.split('-').map(Number);
    const year = parts[0]!;
    const month = parts[1]!;
    try {
      const snap = await scheduleGet(api, { year, month });
      if (snap.state) {
        // Server already has data → server wins, skip.
        result.conflicts++;
        // eslint-disable-next-line no-console
        console.log(`[schedule:migration] server wins for ${key}, local discarded`);
        continue;
      }
      const isCommitted = !!state.meta.commit;
      const payload: ScheduleStatePayload = isCommitted
        ? {
            meta: state.meta,
            shopsFrozen: state.shops,
            removedFrozen: state.removedWarehouses,
            shippingFrozen: state.shippingWarehouses,
          }
        : { meta: state.meta };
      await schedulePut(api, {
        year,
        month,
        state: payload,
        expectedVersion: 0,
      });
      result.migrated++;
      // eslint-disable-next-line no-console
      console.log(`[schedule:migration] migrated ${key} (committed=${isCommitted})`);
    } catch (err) {
      result.errors++;
      // 409 (version_conflict) при expectedVersion=0 ⇔ кто-то параллельно создал
      // запись с момента нашего GET'а. Тоже считаем conflict, не error.
      if (err instanceof ApiError && err.code === 'version_conflict') {
        result.errors--;
        result.conflicts++;
        // eslint-disable-next-line no-console
        console.log(`[schedule:migration] race conflict for ${key}, local discarded`);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`[schedule:migration] failed for ${key}:`, err);
    }
  }

  // Завершаем только если errors === 0 — иначе на следующем mount retry.
  if (result.errors === 0) {
    safeSetItem(MIGRATED_FLAG_KEY, 'true');
    safeRemoveItem(LEGACY_ARCHIVE_KEY);
    safeRemoveItem(LEGACY_STORAGE_KEY);
    // eslint-disable-next-line no-console
    console.log('[schedule:migration] complete, localStorage cleaned', result);
  } else {
    // eslint-disable-next-line no-console
    console.warn('[schedule:migration] partial — will retry on next mount', result);
  }
  return result;
}

/** Проверить нужна ли миграция (для UI hint без сетевых вызовов). */
export function isScheduleMigrationPending(): boolean {
  if (safeGetItem(MIGRATED_FLAG_KEY) === 'true') return false;
  return !!safeGetItem(LEGACY_ARCHIVE_KEY);
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — ignore */
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
