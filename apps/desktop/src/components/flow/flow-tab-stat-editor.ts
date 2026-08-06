// ============================================================
// flow-tab-stat-editor.ts — редактор ячейки STAT для Tabulator-гридов Потока.
// ============================================================
// Вид 1:1 с выпадашкой Отчёта (flow-dropdown-cell.tsx в glide): тёмный поповер
// в стиле меню колонки, ветки АТУ / склад / цех / экспедиция РАСКРЫВАЮТСЯ (▸/▾),
// подпункт коммитит «верх · под», галка у выбранного. Дефолтный list-editor
// Tabulator этого не умеет — он рисует плоский список с разделителями.
//
// Реализован на DOM (без React): Tabulator ждёт от editor'а обычный элемент,
// а список кладём отдельным слоем в тот же popupContainer, чтобы тема попала.
import type { CellComponent } from 'tabulator-tables';
import type { FlowStatDropdownGroup } from '@pyn/core';

/** Сигнатура editor'а Tabulator (типы пакета неудобны для кастомных редакторов). */
type EditorSuccess = (value: unknown) => void;
type EditorCancel = (value?: unknown) => void;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Фабрика редактора: groups — то же дерево, что рисует Отчёт.
 * host — куда класть слой списка (корень грида, чтобы наследовалась тема).
 */
export function makeStatEditor(
  groups: readonly FlowStatDropdownGroup[],
  host: () => HTMLElement | null,
) {
  return function statEditor(
    cell: CellComponent,
    onRendered: (cb: () => void) => void,
    success: EditorSuccess,
    cancel: EditorCancel,
  ): HTMLElement {
    const current = String(cell.getValue() ?? '');
    // Заглушка в самой ячейке: показываем текущее значение, ввода в ней нет —
    // весь выбор идёт в поповере (как в Отчёте).
    const anchor = el('div', 'flow-stat-anchor');
    anchor.textContent = current;

    const layer = el('div', 'flow-stat-pop');
    const search = document.createElement('input');
    search.className = 'flow-stat-pop-search';
    search.placeholder = 'Поиск…';
    layer.appendChild(search);
    const list = el('div', 'flow-stat-pop-list');
    layer.appendChild(list);

    const foot = el('div', 'flow-stat-pop-foot');
    const clearBtn = el('button', 'flow-stat-pop-btn', 'Очистить');
    foot.appendChild(clearBtn);
    layer.appendChild(foot);

    let closed = false;
    const close = (commit: string | null): void => {
      if (closed) return;
      closed = true;
      window.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('keydown', onKey, true);
      layer.remove();
      if (commit == null) cancel();
      else success(commit);
    };

    function onOutside(e: MouseEvent): void {
      if (!layer.contains(e.target as Node)) close(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    }

    /** Раскрытые ветки: по умолчанию раскрыта та, где стоит текущее значение. */
    const open = new Set<string>();
    const curTop = current.includes(' · ') ? current.slice(0, current.indexOf(' · ')) : current;
    if (curTop) open.add(curTop);

    const render = (): void => {
      const q = search.value.trim().toLowerCase();
      list.textContent = '';
      for (const g of groups) {
        const kids = g.children ?? [];
        const selfHit = !q || g.label.toLowerCase().includes(q);
        const hitKids = q ? kids.filter((k) => k.label.toLowerCase().includes(q) || k.value.toLowerCase().includes(q)) : kids;
        if (!selfHit && hitKids.length === 0) continue;

        if (kids.length === 0) {
          // Лист верхнего уровня — коммитит сразу.
          const item = el('button', 'flow-stat-item', g.label);
          if (current === g.id) item.classList.add('flow-stat-item--on');
          item.addEventListener('click', () => close(g.id));
          list.appendChild(item);
          continue;
        }

        const isOpen = open.has(g.id) || (!!q && hitKids.length > 0);
        const branch = el('button', 'flow-stat-item flow-stat-item--branch');
        branch.appendChild(el('span', 'flow-stat-caret', isOpen ? '▾' : '▸'));
        branch.appendChild(el('span', 'flow-stat-branch-label', g.label));
        branch.appendChild(el('span', 'flow-stat-count', String(kids.length)));
        branch.addEventListener('click', () => {
          if (open.has(g.id)) open.delete(g.id);
          else open.add(g.id);
          render();
        });
        list.appendChild(branch);

        if (!isOpen) continue;
        const sub = el('div', 'flow-stat-subs');
        for (const k of hitKids) {
          const item = el('button', 'flow-stat-item flow-stat-item--sub', k.label);
          if (current === k.value) item.classList.add('flow-stat-item--on');
          item.addEventListener('click', () => close(k.value));
          sub.appendChild(item);
        }
        list.appendChild(sub);
      }
      if (!list.childNodes.length) list.appendChild(el('div', 'flow-stat-empty', 'Ничего не найдено'));
    };

    search.addEventListener('input', render);
    clearBtn.addEventListener('click', () => close(''));
    render();

    onRendered(() => {
      const parent = host() ?? document.body;
      parent.appendChild(layer);
      // Позиционируем под ячейкой, при нехватке места снизу — над ней.
      const rect = anchor.getBoundingClientRect();
      const hostRect = parent.getBoundingClientRect();
      const width = 260;
      const maxH = 340;
      let top = rect.bottom - hostRect.top + 2;
      if (rect.bottom + maxH > window.innerHeight) {
        top = Math.max(4, rect.top - hostRect.top - maxH - 2);
      }
      let left = rect.left - hostRect.left;
      if (rect.left + width > window.innerWidth) left = Math.max(4, window.innerWidth - width - 8 - hostRect.left);
      layer.style.top = `${top}px`;
      layer.style.left = `${left}px`;
      layer.style.width = `${width}px`;
      layer.style.maxHeight = `${maxH}px`;
      search.focus();
      window.addEventListener('mousedown', onOutside, true);
      window.addEventListener('keydown', onKey, true);
    });

    return anchor;
  };
}
