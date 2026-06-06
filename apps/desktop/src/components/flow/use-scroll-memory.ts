import { useCallback, useRef } from 'react';

/** Запомненная прокрутка списков фильтров по ключу (модульный кэш — переживает
 *  размонтирование Radix-поповера при закрытии). */
const store = new Map<string, number>();

/**
 * Сохраняет и восстанавливает положение прокрутки списка фильтра (юзер 2026-06-06):
 * выбрал что-то и снова открыл фильтр → возвращаемся на то же место, а не крутим
 * список заново. Поповеры размонтируют контент при закрытии, поэтому держим скролл
 * в модульном кэше по ключу (колонка / под-поле / список заказов).
 *
 * Применение: `<div ref={ref} onScroll={onScroll} className="… overflow-y-auto">`.
 */
export function useScrollMemory(key: string): {
  ref: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
} {
  const elRef = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      // Ref-callback вызывается после монтирования детей → scrollHeight уже верный.
      if (el) el.scrollTop = store.get(key) ?? 0;
    },
    [key],
  );
  const onScroll = useCallback(() => {
    const el = elRef.current;
    if (el) store.set(key, el.scrollTop);
  }, [key]);
  return { ref, onScroll };
}
