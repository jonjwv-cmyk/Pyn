import { useEffect } from 'react';

/**
 * Базовое правило приложения (юзер 2026-06-06): окна-уведомления (сессия, МОЛ,
 * обновление и т.п.) закрываются ТОЛЬКО своей кнопкой. Клик мимо окна не закрывает
 * его и — главное — НЕ «проваливается» к гриду/фильтру за ним (не сбивает фильтр).
 *
 * Механика (применяется автоматически, без правок в каждом окне/фильтре):
 *   • окно-уведомление: `useBlockingModal(open)` + `{...blockingDialogContentProps}`
 *     на `Dialog.Content` → пока открыто, поднят глобальный счётчик и окно не
 *     закрывается по клику/фокусу мимо;
 *   • поповер фильтра: `onInteractOutside={guardInteractOutside}` → пока висит
 *     любое окно-уведомление, фильтр не закрывается по клику мимо.
 * Новое окно или новый фильтр подключаются теми же одной-двумя строками — правило
 * распространяется само, новые сессии его не сбивают.
 */

let openCount = 0;

/** Открыто ли сейчас хотя бы одно блокирующее окно-уведомление. */
export function isBlockingModalOpen(): boolean {
  return openCount > 0;
}

/** Пока `open` — окно числится блокирующим (глобальный счётчик). */
export function useBlockingModal(open: boolean): void {
  useEffect(() => {
    if (!open) return undefined;
    openCount += 1;
    return () => {
      openCount -= 1;
    };
  }, [open]);
}

/** Radix-пропы для `Dialog.Content`: не закрывать окно по клику/фокусу мимо него. */
export const blockingDialogContentProps = {
  onPointerDownOutside: (e: { preventDefault: () => void }) => e.preventDefault(),
  onInteractOutside: (e: { preventDefault: () => void }) => e.preventDefault(),
};

/** Для `Popover.Content` фильтров: не закрываться, пока открыто окно-уведомление. */
export function guardInteractOutside(e: { preventDefault: () => void }): void {
  if (isBlockingModalOpen()) e.preventDefault();
}
