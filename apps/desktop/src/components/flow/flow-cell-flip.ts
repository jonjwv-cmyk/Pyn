// ============================================================
// flow-cell-flip.ts — оверлей-редактор ячейки открывается РЯДОМ с ячейкой, а не
// поверх неё (юзер 2026-07-30: «поповер не должен закрывать кликнутую ячейку»).
// ============================================================
// Glide рисует кастомный редактор (МОЛ/дата/выпадашка/водитель/ТО/score) через
// портал в позиционированном контейнере `.gdg-d19meir1` (position:absolute), у
// которого `top/left` = верх-лево ЯЧЕЙКИ, а контент растёт ВНИЗ — накрывая её.
//
// Мы перепозиционируем контейнер трансформом по схеме «умно: ниже → выше → сбоку»:
//   • НИЖЕ  — редактор целиком помещается под ячейкой (как обычная выпадашка);
//   • ВЫШЕ  — снизу места нет, но хватает сверху (низ редактора у верхней кромки ячейки);
//   • не хватает ни там, ни там → больший из вертикальных промежутков + внутренний скролл;
//   • СБОКУ — последний резерв: полная высота грида, скролл внутри.
// Ячейка при этом всегда остаётся видимой.
//
// Истинные размеры ЯЧЕЙКИ берём из CSS-переменных, которые Glide (linaria) всегда
// выставляет на контейнере, даже если `styleOverride` перебил min-width/height:
//   --d19meir1-2 = ширина ячейки (targetWidth), --d19meir1-3 = высота (targetHeight).
// Позиция/натуральный размер редактора — из getBoundingClientRect после сброса transform.
//
// Glide переставляет оверлей ПОСЛЕ нас (скролл / собственный useStayOnScreen пишет в
// `style.transform`), затирая сдвиг → следим MutationObserver'ом за `style` контейнера
// и переприменяем. Клик-аутсайд не ломается — DOM-поддерево то же (трансформ визуальный).

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

/** px-значение CSS-переменной/свойства (NaN → 0). */
function readPx(cs: CSSStyleDeclaration, name: string): number {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

/** Минимум полезной высоты, чтобы стек вниз/вверх имел смысл (иначе — сбоку). */
const MIN_STACK = 140;

/** Ref-callback для контейнера редактора: сам ставит оверлей рядом с ячейкой. */
export function useFlipUpIfClipped<T extends HTMLElement>(): (el: T | null) => void {
  const elRef = useRef<T | null>(null);
  const shiftedRef = useRef<HTMLElement | null>(null);
  const moRef = useRef<MutationObserver | null>(null);
  const adjust = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const target = overlayContainerOf(el);

    // Сброс прежнего сдвига (в т.ч. если контейнер сменился).
    if (shiftedRef.current && shiftedRef.current !== target) {
      shiftedRef.current.style.transform = '';
      shiftedRef.current.style.maxHeight = '';
    }
    shiftedRef.current = target;

    // На время НАШИХ записей глушим observer, чтобы не ловить самих себя.
    moRef.current?.disconnect();

    // Сброс: измеряем натуральный размер редактора и реальные top/left ЯЧЕЙКИ.
    target.style.transform = '';
    target.style.maxHeight = 'none';
    for (let n: HTMLElement | null = el.parentElement; n && n !== target; n = n.parentElement) {
      n.style.maxHeight = 'none';
    }

    const margin = 8;
    // Пределы: видимая область ГРИДА (`.flow-grid`) по вертикали; окно — по горизонтали.
    // Без грида-предка (оверлей порталится в body) — по окну.
    const gridEl = el.closest('.flow-grid') as HTMLElement | null;
    const gridRect = gridEl ? gridEl.getBoundingClientRect() : null;
    const topLimit = gridRect ? Math.max(margin, gridRect.top + 2) : margin;
    const bottomLimit = gridRect
      ? Math.min(window.innerHeight - margin, gridRect.bottom - 2)
      : window.innerHeight - margin;
    const leftLimit = margin;
    const rightLimit = window.innerWidth - margin;

    // Геометрия ЯЧЕЙКИ — из CSS-переменных Glide (styleOverride их не трогает).
    const cs = getComputedStyle(target);
    const cellH = readPx(cs, '--d19meir1-3') || parseFloat(cs.minHeight) || 28;
    const cellW = readPx(cs, '--d19meir1-2') || parseFloat(cs.minWidth) || 0;

    // Позиция ячейки и натуральный размер редактора (transform сброшен → rect = ячейка).
    const rect = target.getBoundingClientRect();
    const cellTop = rect.top;
    const cellLeft = rect.left;
    const cellBottom = cellTop + cellH;
    const editorH = rect.height;
    const editorW = rect.width;

    const belowSpace = bottomLimit - cellBottom;
    const aboveSpace = cellTop - topLimit;
    const gridH = bottomLimit - topLimit;

    let dx = 0;
    let dy = 0;
    let maxH = editorH;

    if (belowSpace >= editorH) {
      // ── НИЖЕ: редактор помещается под ячейкой целиком.
      dy = cellH;
      maxH = belowSpace;
    } else if (aboveSpace >= editorH) {
      // ── ВЫШЕ: низ редактора у верхней кромки ячейки.
      dy = -editorH;
      maxH = aboveSpace;
    } else if (Math.max(belowSpace, aboveSpace) >= MIN_STACK) {
      // Целиком не влезает — берём больший промежуток + внутренний скролл.
      if (belowSpace >= aboveSpace) {
        dy = cellH;
        maxH = belowSpace;
      } else {
        dy = -aboveSpace; // верх у topLimit, низ у cellTop
        maxH = aboveSpace;
      }
    } else {
      // ── СБОКУ: полная высота грида, скролл внутри.
      maxH = gridH;
      const usedH = Math.min(editorH, gridH);
      const desiredTop = Math.min(Math.max(cellTop, topLimit), bottomLimit - usedH);
      dy = desiredTop - cellTop;
      const rightSpace = rightLimit - (cellLeft + cellW);
      const leftSpace = cellLeft - leftLimit;
      // Справа, если влезает или места больше; иначе слева.
      if (rightSpace >= editorW || rightSpace >= leftSpace) {
        dx = cellW; // левый край редактора у правой кромки ячейки
      } else {
        dx = -editorW; // правый край редактора у левой кромки ячейки
      }
    }

    // Высоту применяем до горизонтального клампа (ширина от высоты не зависит).
    target.style.maxHeight = `${Math.max(120, maxH)}px`;

    // Горизонталь: удержать редактор в окне (сдвиг влево при выходе за правую кромку),
    // но не левее leftLimit. Для side dx уже задан — кламп лишь страхует от выхода за окно.
    const projLeft = cellLeft + dx;
    const projRight = projLeft + editorW;
    if (projRight > rightLimit) {
      dx -= projRight - rightLimit;
      if (cellLeft + dx < leftLimit) dx = leftLimit - cellLeft;
    } else if (projLeft < leftLimit) {
      dx = leftLimit - cellLeft;
    }

    if (dx !== 0 || dy !== 0) {
      target.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    }

    // Glide переставляет оверлей ПОСЛЕ нас → наблюдаем style и переприменяем сдвиг.
    if (!moRef.current) moRef.current = new MutationObserver(() => adjust());
    moRef.current.observe(target, { attributes: true, attributeFilter: ['style'] });
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
      moRef.current?.disconnect();
      moRef.current = null;
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
