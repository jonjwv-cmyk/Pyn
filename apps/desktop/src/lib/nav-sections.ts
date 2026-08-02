import { CalendarRange, Container, Database, FileBarChart2, History, MapPinned, MessageSquare, Newspaper, Radio, Rss, Scale, StickyNote, Truck, Waves } from 'lucide-react';
import i18next from 'i18next';
import type { NavSection } from '@/types/nav';

/**
 * **Статические** разделы Pyn, сгруппированы в 2 секции сайдбара (Linear-стиль):
 *   • «Рабочее» — рабочие инструменты: График, Google-таблицы, МОЛ.
 *     Google-таблицы (Workflow / OTIF / …) динамические — рендерятся через
 *     `TableNavItems` внутри этой группы, между BEFORE/AFTER подсписками.
 *   • «Лента» — Чаты + Новости.
 * Label — функция i18n (читает текущий язык при каждом render).
 *
 * §2026-05-27: старый «График» (ScheduleScreen) удалён. «Проба» переименована
 * в «График» и теперь использует id 'proba' под новым label `nav_schedule`.
 * §2026-07-26: пункт «Хранилище» (vault) убран из сайдбара.
 */

// Группа «Рабочее» — до Google-таблиц.
export const NAV_WORKSPACE_BEFORE_TABLES: NavSection[] = [
  { id: 'proba', get label() { return i18next.t('sidebar.nav_schedule'); }, icon: CalendarRange },
];

// Группа «Рабочее» — после Google-таблиц.
// «База» (Контакты/Склады) — один из трёх дневных «героев» → цветная иконка (blue,
// семья Поток-teal / ВГХ-violet / База-blue). Остальное — нейтральное + подсветка выбора.
export const NAV_WORKSPACE_AFTER_TABLES: NavSection[] = [
  { id: 'mol', get label() { return i18next.t('sidebar.nav_base'); }, icon: Database, iconColor: 'text-blue-400' },
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
  // Флагман «Поток» = teal (вода/поток — под иконку Waves); прохладная семья с ВГХ-violet
  // и База-blue, чётко контрастирует с тёплой clay-подсветкой активной вкладки.
  iconColor: 'text-teal-400',
};

/**
 * Раздел «Сводка» (id `report`) — PDF White/Black (ручные + вывоз + причины).
 * Тот же гейт, что «Поток» (`showFlow`); вне `NAV_SECTIONS`.
 */
export const NAV_REPORT: NavSection = {
  id: 'report',
  get label() { return i18next.t('sidebar.nav_report', 'Сводка'); },
  icon: FileBarChart2,
  iconColor: 'text-lime-400',
};

/**
 * «Заметки» — личные + общие задачи (передача смены).
 * Всем авторизованным; cloud D1 per-user / shared.
 */
export const NAV_NOTES: NavSection = {
  id: 'notes',
  get label() { return i18next.t('sidebar.nav_notes', 'Заметки'); },
  icon: StickyNote,
  iconColor: 'text-sky-400',
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
  // Цвет снят (юзер 2026-06-12): цветные значки только у Поток/Транспорт/База, ВГХ — нейтральный.
};

/**
 * Раздел «Транспорт» — реестр «машина на день» (база машин + лист дня, эталон —
 * лист 🚚). Тот же изолированный контур, что «Поток» (admin/developer-only); вне
 * `NAV_SECTIONS`. Вынесен из вкладок Потока в отдельный пункт (юзер 2026-06-11).
 */
export const NAV_TRANSPORT: NavSection = {
  id: 'transport',
  get label() { return i18next.t('sidebar.nav_transport', 'Транспорт'); },
  icon: Truck,
  // Цветной значок (юзер 2026-06-12): транспорт — amber (дорога/машина), в семье с
  // Поток-teal и База-blue. ВГХ цвет снят.
  iconColor: 'text-amber-400',
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

/**
 * Раздел «Рассылка» — массовые рассылки (контент позже). Вне `NAV_SECTIONS`;
 * гейт на клиенте через `showBroadcast` (как «Поток»/LOG).
 */
export const NAV_BROADCAST: NavSection = {
  id: 'broadcast',
  get label() { return i18next.t('sidebar.nav_broadcast'); },
  // Значок-«вещание» (Rss) — простой и узнаваемый символ рассылки/вещания (не письмо/почта,
  // не рупор, не громоздкая вышка), цветной rose (юзер 2026-06-12). В семье Поток-teal /
  // Транспорт-amber / База-blue.
  icon: Rss,
  iconColor: 'text-rose-400',
};

/**
 * Раздел «Карта» — снимок территории НТМК + точки складов (склад может быть в
 * нескольких точках), области цехов, нарисованные дороги и логистическая
 * оптимизация расположения склада отгрузки. Тот же изолированный admin/developer-
 * контур, что «Поток»/«Транспорт» (флаг `showMap`); вне `NAV_SECTIONS`.
 */
export const NAV_MAP: NavSection = {
  id: 'map',
  get label() { return i18next.t('sidebar.nav_map', 'Карта'); },
  // Цветной значок (карта/местность) — emerald, в семье Поток-teal / Транспорт-amber /
  // База-blue / Рассылка-rose.
  icon: MapPinned,
  iconColor: 'text-emerald-400',
};

/**
 * Раздел «Технология» — встроенный публичный логистический борт pynflow.ru
 * (заявки цехов · кладовщики 9010/9030 · машины 7.1/7.2 · рейсы · ГЛОНАСС-статус)
 * через Electron `<webview>`. Тот же изолированный admin/developer-контур, что
 * «Поток»/«Карта» (флаг `showTech`); вне `NAV_SECTIONS`. См. `TechScreen`.
 */
export const NAV_TECH: NavSection = {
  id: 'tech',
  get label() { return i18next.t('sidebar.nav_tech', 'Технология'); },
  // Контейнер (логистика/отгрузка) — orange, под clay-бренд сайта; в семье
  // Поток-teal / Транспорт-amber / База-blue / Карта-emerald / Рассылка-rose.
  icon: Container,
  iconColor: 'text-orange-400',
};

/**
 * «Волна» — SoundCloud webview (музыка). Partition = Google-таблицы
 * (`persist:google-sheets`): SSO Google + bridge/PAC на корп-сети.
 * Всем авторизованным; вне `NAV_SECTIONS`. См. `WaveScreen`.
 */
export const NAV_WAVE: NavSection = {
  id: 'wave',
  get label() { return i18next.t('sidebar.nav_wave', 'Волна'); },
  icon: Radio,
  iconColor: 'text-fuchsia-400',
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
