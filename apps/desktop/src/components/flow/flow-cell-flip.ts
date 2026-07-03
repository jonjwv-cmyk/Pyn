// ============================================================
// flow-cell-flip.ts — держим оверлей-редактор ячейки в пределах экрана (юзер 2026-07-03, §9).
// ============================================================
// Glide рисует кастомный редактор (МОЛ/дата/выпадашка) ВНИЗ от ячейки. У нижних строк
// он вылезал за нижнюю кромку окна и обрезался. Хук измеряет реальный низ редактора
// после монтирования и, если он ниже видимой области, сдвигает редактор ВВЕРХ
// (translateY), не давая уйти выше 8px от верха. Клик-аутсайд Glide не ломается —
// элемент остаётся в том же DOM-поддереве.

import { useCallback, useLayoutEffect, useRef } from 'react';

/** Ref-callback для контейнера редактора: сам подтягивает его в видимую область. */
export function useFlipUpIfClipped<T extends HTMLElement>(): (el: T | null) => void {
  const elRef = useRef<T | null>(null);
  const adjust = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.style.transform = '';
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const overflowBottom = rect.bottom - (window.innerHeight - margin);
    if (overflowBottom > 0) {
      // Не поднимаем выше верхней кромки: ограничиваем сдвиг так, чтобы top ≥ margin.
      const shift = Math.min(overflowBottom, Math.max(0, rect.top - margin));
      if (shift > 0) el.style.transform = `translateY(${-shift}px)`;
    }
  }, []);
  useLayoutEffect(() => {
    adjust();
    const onResize = (): void => adjust();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
  return useCallback(
    (el: T | null) => {
      elRef.current = el;
      if (el) adjust();
    },
    [adjust],
  );
}
