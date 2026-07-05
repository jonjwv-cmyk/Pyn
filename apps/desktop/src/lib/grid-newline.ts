// ============================================================
// grid-newline.ts — Alt+Enter (⌥+Enter на Mac) = перенос строки В ЯЧЕЙКЕ,
// как в Excel (юзер 2026-07-05), во ВСЕХ таблицах приложения.
// ============================================================
// Все гриды (Glide) монтируют редактор ячейки в общий `#portal`; Enter там
// КОММИТИТ значение (обработчик Glide на .gdg-clip-region). Перехватываем
// Alt+Enter НА ОКНЕ в capture-фазе — раньше обработчиков Glide/React — и вместо
// коммита вставляем `\n` в textarea по месту курсора. Значение записываем через
// НАТИВНЫЙ сеттер + событие input, иначе контролируемый React-редактор Glide
// (GrowingEntry) не увидит изменение.

/** Включить глобально (один раз в App). Возвращает снятие обработчика. */
export function installGridAltEnterNewline(): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || !e.altKey || e.metaKey || e.ctrlKey) return;
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName !== 'TEXTAREA') return;
    if (!document.getElementById('portal')?.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();
    const ta = t as HTMLTextAreaElement;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const next = `${ta.value.slice(0, start)}\n${ta.value.slice(end)}`;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, next);
    else ta.value = next;
    ta.selectionStart = start + 1;
    ta.selectionEnd = start + 1;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
