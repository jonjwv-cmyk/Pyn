import { useEffect, useState } from 'react';
import { useSessionInfoStore } from './stores';

const TICK_MS = 1_000;

interface SessionRemaining {
  /** Осталось до истечения сессии (ms). 0 если info ещё не загружен или сессия истекла. */
  remainingMs: number;
  /** true когда `me_session_info` уже был успешно получен хотя бы раз. */
  hasInfo: boolean;
  /** Сколько extension'ов уже использовано (0..3). 0 = «нулевая попытка», свежая сессия. */
  extensionsUsed: number;
  /** Максимум extension'ов в этой сессии (server-controlled, обычно 3). */
  extensionsMax: number;
}

/**
 * Локальный 1-сек countdown поверх serverного `me_session_info.remaining_ms`.
 *
 * Логика:
 *   • Server вернул `remaining_ms` snapshot на момент `polledAt`.
 *   • Локально считаем `now - polledAt` ms прошедших с момента ответа.
 *   • `remainingMs = max(0, server_snapshot - elapsed)`.
 *
 * НЕ используем `expires_at` — server может вернуть его как `YYYY-MM-DD
 * HH:MM:SS` (Yek local), `ISO Z` (UTC) или вообще пусто для non-PC сессий.
 * `remaining_ms` всегда числовой и однозначный. После следующего poll'а
 * (раз в 30с в SessionExpiryWatch) snapshot обновится и drift'a не будет.
 */
export function useSessionRemaining(): SessionRemaining {
  const info = useSessionInfoStore((s) => s.info);
  const polledAt = useSessionInfoStore((s) => s.polledAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!info) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [info]);

  if (!info || polledAt === 0) {
    return { remainingMs: 0, hasInfo: false, extensionsUsed: 0, extensionsMax: 3 };
  }
  const elapsed = Math.max(0, now - polledAt);
  const remainingMs = Math.max(0, info.remainingMs - elapsed);
  const extensionsMax = info.extensionsUsed + info.extensionsRemaining;
  return {
    remainingMs,
    hasInfo: true,
    extensionsUsed: info.extensionsUsed,
    extensionsMax: extensionsMax > 0 ? extensionsMax : 3,
  };
}
