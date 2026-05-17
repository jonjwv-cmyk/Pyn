import type { LucideIcon } from 'lucide-react';

/** Идентификатор раздела — type-safe для switch/route. */
export type NavSectionId = 'vault' | 'tables' | 'mol' | 'chats' | 'news';

/** Спецификация одного пункта sidebar. */
export interface NavSection {
  id: NavSectionId;
  label: string;
  icon: LucideIcon;
  /** Кол-во непрочитанных / новых элементов. 0 — не показывать badge. */
  badge?: number;
}
