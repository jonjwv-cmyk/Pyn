import { Archive, CalendarRange, IdCard, MessageSquare, Newspaper } from 'lucide-react';
import i18next from 'i18next';
import type { NavSection } from '@/types/nav';

/**
 * Список **статических** разделов Pyn. Label — функция i18n (читает текущий
 * язык при каждом render). Google-таблицы (Workflow / OTIF / …) рендерятся
 * отдельно через `TableNavItems` между BEFORE/AFTER списками.
 *
 * §2026-05-27: старый «График» (ScheduleScreen) удалён. «Проба» переименована
 * в «График» и теперь использует id 'proba' под новым label `nav_schedule`.
 */
export const NAV_SECTIONS_BEFORE_TABLES: NavSection[] = [
  { id: 'vault',    get label() { return i18next.t('sidebar.nav_storage');  }, icon: Archive },
  { id: 'proba',    get label() { return i18next.t('sidebar.nav_schedule'); }, icon: CalendarRange },
];

export const NAV_SECTIONS_AFTER_TABLES: NavSection[] = [
  { id: 'mol',   get label() { return i18next.t('sidebar.nav_mol'); },   icon: IdCard },
  { id: 'chats', get label() { return i18next.t('sidebar.nav_chats'); }, icon: MessageSquare },
  { id: 'news',  get label() { return i18next.t('sidebar.nav_news'); },  icon: Newspaper },
];

/** Объединённый список для расчёта collapsed-ширины и dynamic badges. */
export const NAV_SECTIONS: NavSection[] = [
  ...NAV_SECTIONS_BEFORE_TABLES,
  ...NAV_SECTIONS_AFTER_TABLES,
];
