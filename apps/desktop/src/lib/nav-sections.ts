import { Archive, IdCard, MessageSquare, Newspaper } from 'lucide-react';
import type { NavSection } from '@/types/nav';

/**
 * Список **статических** разделов Pyn. Google-таблицы (Workflow / OTIF / …)
 * рендерятся отдельно через `TableNavItems` и вставляются между
 * `NAV_SECTIONS_BEFORE_TABLES` и `NAV_SECTIONS_AFTER_TABLES` (см. Sidebar).
 * Порядок ниже задаёт визуальную последовательность в основном меню.
 */
export const NAV_SECTIONS_BEFORE_TABLES: NavSection[] = [
  { id: 'vault', label: 'Хранилище', icon: Archive },
];

export const NAV_SECTIONS_AFTER_TABLES: NavSection[] = [
  { id: 'mol',   label: 'МОЛы',    icon: IdCard },
  { id: 'chats', label: 'Чаты',    icon: MessageSquare },
  { id: 'news',  label: 'Новости', icon: Newspaper },
];

/** Объединённый список для расчёта collapsed-ширины и dynamic badges. */
export const NAV_SECTIONS: NavSection[] = [
  ...NAV_SECTIONS_BEFORE_TABLES,
  ...NAV_SECTIONS_AFTER_TABLES,
];
