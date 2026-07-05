// ============================================================
// flow-cell-flip.ts — держим оверлей-редактор ячейки в пределах экрана (юзер 2026-07-03, §9;
// доработан 2026-07-05: НАЙДЕН корень обрезки карточек МОЛ/MAT у низа окна).
// ============================================================
// Glide рисует кастомный редактор (МОЛ/дата/выпадашка/карточка MAT) ВНИЗ от ячейки.
// У нижних строк он вылезал за нижнюю кромку окна и обрезался. Сдвигать НАДО
// ПОЗИЦИОНИРОВАННЫЙ КОНТЕЙНЕР оверлея Glide (а не внутренний div: у контейнера
// overflow/фон — контент, сдвинутый внутри, просто обрезался сверху, снаружи ничего
// не менялось — скрины юзера 2026-07-04). Меряем после раскладки (двойной rAF) и
// при изменении размеров содержимого (ResizeObserver) — Glide позиционирует оверлей
// после монтирования. Клик-аутсайд Glide не ломается — DOM-поддерево то же.
//
// КОРЕНЬ (найден 2026-07-05, три прошлые попытки мимо): Glide зажимает оверлей
// max-height'ом из CSS-КЛАССА (linaria .gdg-d19meir1: `max-height: calc(100vh -
// var(--overlay-top))`) — НЕ инлайн-стилем. Прежний код проверял `n.style.maxHeight`
// (инлайн), который всегда пуст → ничего не снимал, у нижних строк потолок оставался
// в десятки пикселей («виден один МОЛ и прокрутка»). Лечение: перебиваем ИНЛАЙНОМ
// безусловно — потолок = высота окна минус поля, положение — сдвигом вверх.

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
    if (shiftedRef.current && shiftedRef.current !== target) {
      shiftedRef.current.style.transform = '';
      shiftedRef.current.style.maxHeight = '';
    }
    target.style.transform = '';
    shiftedRef.current = target;
    const margin = 8;
    // Потолок Glide сидит в CSS-классе (calc(100vh - top)) — инлайн его ПЕРЕБИВАЕТ
    // безусловно: карточке доступна вся высота окна минус поля; если контент выше —
    // скроллится внутри (.gdg-clip-region / собственные max-h редакторов).
    target.style.maxHeight = `${Math.max(120, window.innerHeight - margin * 2)}px`;
    for (let n: HTMLElement | null = el.parentElement; n && n !== target; n = n.parentElement) {
      n.style.maxHeight = 'none';
    }
    const rect = target.getBoundingClientRect();
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
