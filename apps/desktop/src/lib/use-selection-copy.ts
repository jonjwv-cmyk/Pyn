import { useEffect } from 'react';

/**
 * Глобальное копирование выделенного текста по Cmd/Ctrl+C.
 *
 * Зачем: в приложении нет нативного меню (`Menu.setApplicationMenu(null)` в
 * main.ts), поэтому стандартный copy-акселератор не работает — выделенный мышью
 * текст (сообщения чата, ответы ИИ) нельзя скопировать. Восстанавливаем это в
 * рендерере, как уже сделано для таблицы МОЛ.
 *
 * Безопасность от конфликтов: срабатываем ТОЛЬКО при непустом выделении
 * (нативном `getSelection()` или внутри input/textarea). Если выделения нет —
 * молча пропускаем, чтобы не мешать другим Cmd+C-хендлерам (таблица МОЛ копирует
 * свой TSV при `user-select:none`, т.е. нативное выделение там пустое).
 */
export function useSelectionCopy(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'c') return;

      // 1) Выделение внутри input/textarea (напр. composer) — копируем его.
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        const el = ae as HTMLInputElement | HTMLTextAreaElement;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (end > start) {
          const part = el.value.slice(start, end);
          if (part) {
            e.preventDefault();
            void writeClipboard(part);
          }
        }
        return;
      }

      // 2) Обычное выделение страницы (текст сообщения или его часть).
      const text = window.getSelection()?.toString() ?? '';
      if (!text.trim()) return; // нет выделения — не вмешиваемся
      e.preventDefault();
      void writeClipboard(text);
    };
    // Capture-фаза: успеваем до bubble-хендлеров, но действуем лишь при выделении.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function writeClipboard(text: string): Promise<void> {
  return (navigator.clipboard?.writeText?.(text) ?? Promise.reject()).catch(() => {
    try { document.execCommand('copy'); } catch { /* noop */ }
  });
}
