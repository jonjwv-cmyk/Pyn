import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseScrollDayPillResult {
  /** Подключить как `onScroll` к scroll-контейнеру. */
  onScroll: () => void;
  /** Активный label (последний divider, пересекающий верх viewport'а). */
  activeLabel: string | null;
  /** `true` пока юзер скроллит — родитель показывает pill, потом fade-out. */
  isScrolling: boolean;
}

const HIDE_AFTER_MS = 1200;

/**
 * Отслеживает scroll-событие в контейнере и вычисляет какой `data-day-label`
 * divider сейчас прикреплён к верху viewport'а. Возвращает label + флаг
 * "isScrolling" — нужно ли показывать pill (с auto-fade через 1.2с после
 * последнего scroll-события).
 *
 * Алгоритм:
 *   • На каждый scroll: ищем самый «нижний» divider, у которого top ≤
 *     scroll-container top + offset(8px). Его label — активный.
 *   • Если активен — setActiveLabel и start fade timer (1.2s).
 *
 * Performance: реальный walk через `querySelectorAll` каждого scroll-tick'a
 * нормально для лент до ~500 items. При больших лентах перейти на
 * IntersectionObserver, но MVP — простой подход.
 */
export function useScrollDayPill(
  scrollRef: RefObject<HTMLElement | null>,
): UseScrollDayPillResult {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const dividers = root.querySelectorAll<HTMLElement>('[data-day-label]');
    let label: string | null = null;
    for (let i = dividers.length - 1; i >= 0; i--) {
      const el = dividers[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top - rootTop < 8) {
        label = el.dataset.dayLabel ?? null;
        break;
      }
    }
    setActiveLabel(label);
    setIsScrolling(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setIsScrolling(false);
      hideTimerRef.current = null;
    }, HIDE_AFTER_MS);
  }, [scrollRef]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return { onScroll, activeLabel, isScrolling };
}
