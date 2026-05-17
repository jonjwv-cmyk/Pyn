import { useEffect, useState } from 'react';
import { subscribeWs } from '@/lib/ws';

/**
 * Network connectivity status — для индикатора онлайн/оффлайн в Sidebar.
 *
 * Источники (все passive, БЕЗ дополнительных запросов к серверу):
 *   • `navigator.onLine` — флаг наличия сети.
 *   • `PerformanceObserver(resource)` — измеряет реальную скорость по уже-
 *     идущим загрузкам (blob attachments, avatars, etc). Sliding window 10с:
 *     суммируем `transferSize` и `duration`, считаем Mbps. Это true-realtime
 *     показатель, который дёргается каждый раз когда Pyn что-то качает, и
 *     не создаёт никакого лишнего трафика.
 *   • `navigator.connection.downlink` — Chromium-estimate, fallback когда
 *     PerformanceObserver ещё ничего не собрал (пустое окно ~10с после
 *     открытия Pyn'a).
 *   • `rttMs` — RTT до сервера через WS-ping (один уже-открытый WS канал,
 *     ноль HTTP-запросов).
 */
export interface ConnectivityInfo {
  online: boolean;
  /** Mbps. Сначала живой PerformanceObserver-замер, fallback на browser estimate. NULL если оба пусты. */
  downlinkMbps: number | null;
  /** Realtime RTT до сервера в мс. NULL если ещё не было pong'a. */
  rttMs: number | null;
}

interface NetworkConnection extends EventTarget {
  downlink?: number;
  effectiveType?: string;
}

function readBrowserDownlink(): number | null {
  const conn = (navigator as Navigator & { connection?: NetworkConnection }).connection;
  return typeof conn?.downlink === 'number' ? conn.downlink : null;
}

/**
 * Sliding-window bandwidth meter. Хранит последние транзакции (bytes, durMs,
 * endedAt) в массиве; периодически пересчитывает сумму за последние WINDOW_MS.
 * Передаём в hook через callback при каждой новой transaction.
 */
const WINDOW_MS = 10_000;
interface Sample {
  bytes: number;
  durMs: number;
  endedAt: number;
}

export function useConnectivity(): ConnectivityInfo {
  const [info, setInfo] = useState<ConnectivityInfo>(() => ({
    online: navigator.onLine,
    downlinkMbps: readBrowserDownlink(),
    rttMs: null,
  }));

  // online/offline + browser-level connection change.
  useEffect(() => {
    const onChange = () =>
      setInfo((prev) => ({
        ...prev,
        online: navigator.onLine,
      }));
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    const conn = (navigator as Navigator & { connection?: NetworkConnection }).connection;
    conn?.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
      conn?.removeEventListener?.('change', onChange);
    };
  }, []);

  // PerformanceObserver — измеряет скорость по уже-идущим загрузкам.
  // НЕ создаёт никакого лишнего трафика: пассивно слушает результат загрузок,
  // которые приложение делает по своим причинам (blob аватаров, attachments,
  // gif/видео в ленте). Каждые 1с пересчитываем sliding window 10с.
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const samples: Sample[] = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const r = entry as PerformanceResourceTiming;
        // transferSize включает headers; encodedBodySize — без них. Используем
        // transferSize (реальные байты по сети). Если 0 (cache hit, opaque) —
        // не учитываем: не было реальной передачи.
        const bytes = r.transferSize;
        const durMs = r.duration;
        if (!bytes || durMs <= 0) continue;
        samples.push({ bytes, durMs, endedAt: r.responseEnd });
      }
    });
    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      return;
    }

    const recompute = (): void => {
      const cutoff = performance.now() - WINDOW_MS;
      // Drop samples older than window.
      while (samples.length > 0) {
        const head = samples[0];
        if (head && head.endedAt < cutoff) samples.shift();
        else break;
      }
      if (samples.length === 0) {
        // Нет свежих загрузок — fallback на browser estimate.
        setInfo((prev) => ({ ...prev, downlinkMbps: readBrowserDownlink() }));
        return;
      }
      let totalBytes = 0;
      let totalMs = 0;
      for (const s of samples) {
        totalBytes += s.bytes;
        totalMs += s.durMs;
      }
      if (totalMs <= 0) return;
      const mbps = (totalBytes * 8) / 1_000_000 / (totalMs / 1000);
      setInfo((prev) => ({ ...prev, downlinkMbps: mbps }));
    };

    const tickId = setInterval(recompute, 1000);
    return () => {
      clearInterval(tickId);
      observer.disconnect();
    };
  }, []);

  // RTT через WS ping/pong (main process эмитит `ws_rtt`).
  useEffect(() => {
    const unsub = subscribeWs((event) => {
      if (event.type !== 'ws_rtt') return;
      const rtt = (event as unknown as { rtt_ms?: number }).rtt_ms;
      if (typeof rtt === 'number' && Number.isFinite(rtt)) {
        setInfo((prev) => ({ ...prev, rttMs: rtt }));
      }
    });
    return unsub;
  }, []);

  return info;
}

/**
 * Форматирует bandwidth в красивую строку:
 *   12.3 → «12 Мбит/с»
 *   0.5  → «0,5 Мбит/с»
 *   null → null
 */
export function formatBandwidth(mbps: number | null): string | null {
  if (mbps === null) return null;
  if (mbps >= 10) return `${Math.round(mbps)} Мбит/с`;
  return `${mbps.toFixed(1).replace('.', ',')} Мбит/с`;
}

/**
 * Форматирует RTT в мс. NULL если ещё нет первого pong'a.
 *   42  → «42 мс»
 *   1230 → «1230 мс»
 */
export function formatRtt(rttMs: number | null): string | null {
  if (rttMs === null) return null;
  return `${Math.round(rttMs)} мс`;
}
