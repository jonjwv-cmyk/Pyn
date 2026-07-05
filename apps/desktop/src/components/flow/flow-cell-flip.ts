// ============================================================
// flow-cell-flip.ts — держим оверлей-редактор ячейки в пределах экрана (юзер 2026-07-03, §9;
// доработан 2026-07-04: у нижних строк карточки МОЛ/MAT всё ещё обрезались).
// ============================================================
// Glide рисует кастомный редактор (МОЛ/дата/выпадашка/карточка MAT) ВНИЗ от ячейки.
// У нижних строк он вылезал за нижнюю кромку окна и обрезался. Сдвигать НАДО
// ПОЗИЦИОНИРОВАННЫЙ КОНТЕЙНЕР оверлея Glide (а не внутренний div: у контейнера
// overflow/фон — контент, сдвинутый внутри, просто обрезался сверху, снаружи ничего
// не менялось — скрины юзера 2026-07-04). Меряем после раскладки (двойной rAF) и
// при изменении размеров содержимого (ResizeObserver) — Glide позиционирует оверлей
// после монтирования. Клик-аутсайд Glide не ломается — DOM-поддерево то же.

import { useCallback, useEffect, useRef } from 'react';

/** Ближайший ПОЗИЦИОНИРОВАННЫЙ предок (сам оверлей Glide в портале). */
function overlayContainerOf(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== document.body) {
    const pos = window.getComputedStyle(cur).position;
    if (pos === 'fixed' || pos === 'absolute') return cur;
    cur = cur.parentElement;
  }
  return el;
}

/** Ref-callback для контейнера редактора: сам подтягивает оверлей в видимую область. */
export function useFlipUpIfClipped<T extends HTMLElement>(): (el: T | null) => void {
  const elRef = useRef<T | null>(null);
  const shiftedRef = useRef<HTMLElement | null>(null);
  const adjust = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const target = overlayContainerOf(el);
    // Сбрасываем прежний сдвиг (и на старом контейнере, если он сменился).
    if (shiftedRef.current && shiftedRef.current !== target) shiftedRef.current.style.transform = '';
    target.style.transform = '';
    shiftedRef.current = target;
    // КЛЮЧЕВОЕ (юзер 2026-07-04, «виден один МОЛ и прокрутка»): у нижних строк Glide
    // ЗАЖИМАЕТ оверлей maxHeight'ом до нижней кромки окна — список сплющивался до одной
    // строки. Снимаем maxHeight с контейнера и обёрток до нашего элемента: высоту
    // ограничивает сам редактор (max-h-80 и т.п.), а положение — сдвиг ниже.
    for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
      if (n.style.maxHeight) n.style.maxHeight = 'none';
      if (n === target) break;
    }
    const rect = target.getBoundingClientRect();
    const margin = 8;
    const overflowBottom = rect.bottom - (window.innerHeight - margin);
    if (overflowBottom > 0) {
      // Не поднимаем выше верхней кромки: ограничиваем сдвиг так, чтобы top ≥ margin.
      const shift = Math.min(overflowBottom, Math.max(0, rect.top - margin));
      if (shift > 0) target.style.transform = `translateY(${-shift}px)`;
    }
  }, []);
  useEffect(() => {
    // Glide может позиционировать оверлей после mount — повторный замер за 2 кадра
    // + следим за изменением размеров содержимого (поиск сужает список и т.п.).
    adjust();
    const raf1 = requestAnimationFrame(() => requestAnimationFrame(adjust));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(adjust) : null;
    if (elRef.current && ro) ro.observe(elRef.current);
    window.addEventListener('resize', adjust);
    return () => {
      cancelAnimationFrame(raf1);
      ro?.disconnect();
      window.removeEventListener('resize', adjust);
    };
  });
  return useCallback(
    (el: T | null) => {
      elRef.current = el;
      if (el) adjust();
    },
    [adjust],
  );
}
