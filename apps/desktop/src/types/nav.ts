import type { LucideIcon } from 'lucide-react';

/**
 * Идентификатор раздела. Static-разделы — фиксированные строки; динамические
 * Google-таблицы рендерятся как `sheet:<google-sheet-id>` (см. Sidebar +
 * `TableNavItems`). Строковый тип вместо union — нужен для динамики.
 */
export type NavSectionId = string;

/** Префикс динамических nav-id для Google-таблиц. */
export const SHEET_NAV_PREFIX = 'sheet:';

export function isSheetNavId(id: NavSectionId): boolean {
  return id.startsWith(SHEET_NAV_PREFIX);
}

export function makeSheetNavId(fileId: string): NavSectionId {
  return `${SHEET_NAV_PREFIX}${fileId}`;
}

export function sheetIdFromNavId(id: NavSectionId): string | null {
  return id.startsWith(SHEET_NAV_PREFIX) ? id.slice(SHEET_NAV_PREFIX.length) : null;
}

/** Спецификация одного пункта sidebar. */
export interface NavSection {
  id: NavSectionId;
  label: string;
  icon: LucideIcon;
  /** Постоянный цвет иконки (Tailwind-класс) — акцент раздела, как у Google-табов
   *  (TableNavItems). Не задан — стандартное поведение (clay при active). */
  iconColor?: string;
  /** Кол-во непрочитанных / новых элементов. 0 — не показывать badge. */
  badge?: number;
}
