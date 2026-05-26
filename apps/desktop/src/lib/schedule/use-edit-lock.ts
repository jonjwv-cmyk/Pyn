/**
 * useEditLock(resourceId, active) — collaboration lock на конкретный
 * editor/dialog/popover. §TZ-SERVER-SYNC-COLLAB этап C.
 *
 * Lifecycle:
 *   active=true (popover открыт):
 *     • acquire lock (POST /schedule_lock_acquire)
 *     • если 409 lock_held → setOwner(other-user) → caller рендерит overlay
 *     • если OK → start heartbeat interval (10s)
 *   active=false (popover закрыт):
 *     • clearInterval heartbeat
 *     • release lock (fire-and-forget)
 *
 * WS события:
 *   • lock_acquired (другим юзером): если совпадает resource_id → setOwner
 *   • lock_released (any): если совпадает resource_id → setOwner(null) →
 *     caller убирает overlay, может попробовать acquire снова
 *
 * Throttling per TZ §8:
 *   • Heartbeat 10s — только пока active=true
 *   • Acquire — однократно при active true
 *   • Release — fire-and-forget on close
 */

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  readLockOwner,
  scheduleLockAcquire,
  scheduleLockHeartbeat,
  scheduleLockRelease,
  type ScheduleLockAcquiredEvent,
  type ScheduleLockOwner,
  type ScheduleLockReleasedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { sessionStore } from '@/lib/token-store';

const HEARTBEAT_MS = 10_000;

export interface UseEditLockResult {
  /** Текущий owner — null если lock не захвачен ИЛИ owner — это мы. */
  ownedByOther: ScheduleLockOwner | null;
  /** Мы успешно захватили lock (acquire OK, heartbeat активен). */
  ownedByMe: boolean;
  /** Идёт acquire / первый heartbeat — UI может показать «Подключение…». */
  isAcquiring: boolean;
  /** Последняя ошибка (network / unexpected). */
  error: string | null;
}

/**
 * @param resourceId  e.g. 'schedule:2026-05:exceptions'. Пустая строка → no-op.
 * @param active      хук активен только когда popover/dialog открыт (true).
 *                    При false: release + cleanup heartbeat.
 */
export function useEditLock(
  resourceId: string,
  active: boolean,
): UseEditLockResult {
  const [ownedByOther, setOwnedByOther] = useState<ScheduleLockOwner | null>(null);
  const [ownedByMe, setOwnedByMe] = useState(false);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Свой login — нужен для дедупа WS lock_acquired (свой acquire тоже broadcast'ится).
  const [myLogin, setMyLogin] = useState('');
  useEffect(() => {
    sessionStore.load().then((s) => {
      if (s?.user?.login) setMyLogin(s.user.login);
    }).catch(() => {});
  }, []);

  // Heartbeat timer + флаг что мы owner.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ownedByMeRef = useRef(false);
  ownedByMeRef.current = ownedByMe;

  // Стабильный ref на resourceId — для async коллбеков чтобы не race'ить
  // если active меняется while acquire pending.
  const resourceIdRef = useRef(resourceId);
  resourceIdRef.current = resourceId;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Acquire + heartbeat lifecycle.
  useEffect(() => {
    if (!active || !resourceId) {
      // Cleanup — может быть activated previous run.
      return;
    }
    let cancelled = false;

    const acquire = async () => {
      setIsAcquiring(true);
      setError(null);
      try {
        await scheduleLockAcquire(api, resourceId);
        if (cancelled) {
          // Active изменился пока мы acquire'или → сразу release.
          void scheduleLockRelease(api, resourceId).catch(() => {});
          return;
        }
        setOwnedByMe(true);
        setOwnedByOther(null);
        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          void scheduleLockHeartbeat(api, resourceIdRef.current)
            .catch((err) => {
              if (err instanceof ApiError && err.code === 'lock_not_owned') {
                // Лок перехватили / истёк — снимаем UI.
                setOwnedByMe(false);
                if (heartbeatRef.current) {
                  clearInterval(heartbeatRef.current);
                  heartbeatRef.current = null;
                }
              }
              // Network errors — silent retry на следующем интервале.
            });
        }, HEARTBEAT_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'lock_held') {
          const owner = readLockOwner(err);
          setOwnedByOther(owner);
          setOwnedByMe(false);
        } else if (err instanceof ApiError && err.code === 'too_many_locks') {
          // v1.2.56 DoS protection: юзер уже держит 10 lock'ов в других popover'ах.
          // UI просто не блокируется (ownedByMe=false, no overlay) — пусть юзер
          // закроет старые popover'ы; новый редактирование работает на client'е
          // optimistically. Toast не пушим — обычный юзер не должен видеть.
          // eslint-disable-next-line no-console
          console.warn('[edit-lock] too_many_locks — закройте другие popover\'ы');
          setError('too_many_locks');
        } else if (err instanceof ApiError && err.code === 'lock_hold_exceeded') {
          // Hard cap 30 мин превышен. UI разблокируется (lock release'нут), юзер
          // продолжает работать, но коллаб-защита снимается. Реальная UX-доработка
          // (диалог «Продолжить?») — отдельная задача.
          setError('lock_hold_exceeded');
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          // eslint-disable-next-line no-console
          console.error('[edit-lock] acquire failed', err);
        }
      } finally {
        if (!cancelled) setIsAcquiring(false);
      }
    };
    void acquire();

    return () => {
      cancelled = true;
      // Cleanup heartbeat
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      // Release (fire-and-forget; ignore errors)
      if (ownedByMeRef.current) {
        void scheduleLockRelease(api, resourceId).catch(() => {});
      }
      setOwnedByMe(false);
      setOwnedByOther(null);
      setIsAcquiring(false);
      setError(null);
    };
  }, [resourceId, active]);

  // WS event: lock acquired by another user
  useWsEvent<ScheduleLockAcquiredEvent>('schedule_lock_acquired', (event) => {
    if (event.resource_id !== resourceIdRef.current) return;
    if (!activeRef.current) return;
    if (event.user_login === myLogin) return;  // свой acquire — skip
    setOwnedByOther({
      userLogin: String(event.user_login || ''),
      fullName: String(event.full_name || ''),
      avatarUrl: String(event.avatar_url || ''),
      avatarBlobKey: String(event.avatar_blob_key || ''),
      avatarBlobNonce: String(event.avatar_blob_nonce || ''),
      acquiredAt: '',
      leaseExpiresAt: '',
    });
    setOwnedByMe(false);
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  });

  // WS event: lock released (другим юзером или cron'ом)
  useWsEvent<ScheduleLockReleasedEvent>('schedule_lock_released', (event) => {
    if (event.resource_id !== resourceIdRef.current) return;
    if (!activeRef.current) return;
    // Если у нас был ownedByOther — он отпустил, теперь можем acquire сами.
    if (ownedByOther) {
      setOwnedByOther(null);
      // Перепопытка acquire через cleanup→re-mount цикл useEffect выше:
      // active === true, ownedByOther → null → ничего, но lock UI разблокирован.
      // Чтобы взять lock — нужен повторный acquire. Делаем без полного remount:
      void (async () => {
        try {
          await scheduleLockAcquire(api, resourceIdRef.current);
          if (!activeRef.current) {
            void scheduleLockRelease(api, resourceIdRef.current).catch(() => {});
            return;
          }
          setOwnedByMe(true);
          if (!heartbeatRef.current) {
            heartbeatRef.current = setInterval(() => {
              void scheduleLockHeartbeat(api, resourceIdRef.current).catch(() => {});
            }, HEARTBEAT_MS);
          }
        } catch (err) {
          // Скорее всего race — кто-то ещё успел захватить.
          if (err instanceof ApiError && err.code === 'lock_held') {
            const owner = readLockOwner(err);
            setOwnedByOther(owner);
          }
        }
      })();
    }
  });

  return {
    ownedByOther,
    ownedByMe,
    isAcquiring,
    error,
  };
}
