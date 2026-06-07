import { Archive, CalendarRange, Database, History, MessageSquare, Newspaper, Scale, Waves } from 'lucide-react';
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

/**
 * Раздел «Поток» (β) — собственный табличный реестр рабочих данных, миграция
 * с Google Sheets. Изолирован: рендерится только для admin/developer (флаг
 * `showFlow` в Sidebar), существующие «Таблицы»/Google не затрагивает. НЕ входит
 * в `NAV_SECTIONS` — у него нет badge'а, незачем участвовать в расчёте ширины/
 * бейджей у всех пользователей. Внутренний id `flow` стабилен независимо от
 * витринного имени (его можно переименовать в одной строке i18n).
 */
export const NAV_FLOW: NavSection = {
  id: 'flow',
  get label() { return i18next.t('sidebar.nav_flow'); },
  icon: Waves,
  iconColor: 'text-amber-400',
};

/**
 * Раздел «ВГХ» (вес-габаритные характеристики) — промежуточный лист дозаполнения
 * веса/габаритов/объёма/MIN QTY/тех-имени + правка базы ВГХ. Тот же изолированный
 * контур, что «Поток» (admin/developer-only, флаг `showVgh`); вне `NAV_SECTIONS`.
 * Из этой базы реалтайм считаются KG/V и тех-имя в формировании.
 */
export const NAV_VGH: NavSection = {
  id: 'vgh',
  get label() { return i18next.t('sidebar.nav_vgh'); },
  icon: Scale,
  iconColor: 'text-violet-400',
};

/**
 * Раздел «LOG» — журнал прогонов выгрузки заказов (кто/когда запускал и итоги:
 * новых/правок/снято OFF/смен складов/ВГХ + длительность). Тот же изолированный
 * контур (admin/developer-only, флаг `showLog`); вне `NAV_SECTIONS`.
 */
export const NAV_LOG: NavSection = {
  id: 'log',
  get label() { return i18next.t('sidebar.nav_log'); },
  icon: History,
};

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
