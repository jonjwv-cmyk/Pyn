import { Archive, CalendarRange, Database, MessageSquare, Newspaper } from 'lucide-react';
import i18next from 'i18next';
import type { NavSection } from '@/types/nav';

/**
 * **Статические** разделы Pyn, сгруппированы в 2 секции сайдбара (Linear-стиль):
 *   • «Рабочее» — рабочие инструменты: Хранилище, График, Google-таблицы, МОЛ.
 *     Google-таблицы (Workflow / OTIF / …) динамические — рендерятся через
 *     `TableNavItems` внутри этой группы, между BEFORE/AFTER подсписками.
 *   • «Лента» — Чаты + Новости.
 * Label — функция i18n (читает текущий язык при каждом render).
 *
 * §2026-05-27: старый «График» (ScheduleScreen) удалён. «Проба» переименована
 * в «График» и теперь использует id 'proba' под новым label `nav_schedule`.
 */

// Группа «Рабочее» — до Google-таблиц.
export const NAV_WORKSPACE_BEFORE_TABLES: NavSection[] = [
  { id: 'vault', get label() { return i18next.t('sidebar.nav_storage');  }, icon: Archive },
  { id: 'proba', get label() { return i18next.t('sidebar.nav_schedule'); }, icon: CalendarRange },
];

// Группа «Рабочее» — после Google-таблиц.
export const NAV_WORKSPACE_AFTER_TABLES: NavSection[] = [
  { id: 'mol', get label() { return i18next.t('sidebar.nav_base'); }, icon: Database },
];

// Группа «Лента».
export const NAV_FEED: NavSection[] = [
  { id: 'chats', get label() { return i18next.t('sidebar.nav_chats'); }, icon: MessageSquare },
  { id: 'news',  get label() { return i18next.t('sidebar.nav_news'); },  icon: Newspaper },
];

/** Объединённый список для расчёта collapsed-ширины и dynamic badges. */
export const NAV_SECTIONS: NavSection[] = [
  ...NAV_WORKSPACE_BEFORE_TABLES,
  ...NAV_WORKSPACE_AFTER_TABLES,
  ...NAV_FEED,
];
