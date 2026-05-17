import { useCallback, useRef, useState, type DragEvent, type DragEventHandler } from 'react';

/**
 * Хук-обёртка для drag-and-drop файлов на любой контейнер. Возвращает
 * `dropProps` (раскрыть spread'ом в нужный JSX-элемент) и флаг `dragging` —
 * для visual overlay'a.
 *
 * Реагируем только на drag с типом `Files` — никакого reorder'a текста /
 * перетаскивания ссылок. Браузер по умолчанию открывает dropped файл как
 * navigation; preventDefault на dragover + drop отменяет это поведение.
 *
 * Counter (`dragDepth`) защищает от ложных `dragLeave` event'ов когда
 * курсор переходит между nested-элементами того же контейнера: реальный
 * leave засчитываем только когда счётчик опускается до 0.
 */
export function useFileDrop(onFiles: (files: File[]) => void): {
  dragging: boolean;
  dropProps: {
    onDragEnter: DragEventHandler<HTMLElement>;
    onDragOver: DragEventHandler<HTMLElement>;
    onDragLeave: DragEventHandler<HTMLElement>;
    onDrop: DragEventHandler<HTMLElement>;
  };
} {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const hasFiles = (e: DragEvent): boolean => {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  };

  const onDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (dragDepth.current === 1) setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return {
    dragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
