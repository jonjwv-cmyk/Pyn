/**
 * Вставить строку в `<textarea>` или `<input>` на позицию курсора и сместить
 * курсор после вставленного. Используется при выборе emoji'а через picker.
 *
 * Возвращает финальный value (caller должен сам обновить React state).
 */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement,
  insert: string,
): string {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + insert + el.value.slice(end);
  // Установить курсор сразу за вставленным — но это нужно делать после
  // того как React обновит value, иначе DOM перезатрёт.
  queueMicrotask(() => {
    try {
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    } catch {
      /* ignore */
    }
  });
  return next;
}
