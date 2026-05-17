import { Archive, IdCard, MessageSquare, Newspaper, Table2 } from 'lucide-react';
import type { NavSection } from '@/types/nav';

/**
 * Список разделов Pyn — порядок и счётчики.
 *
 * Mock данные; в будущем счётчики будут приходить из @pyn/core (state store /
 * websocket events). Имя и иконка — фикс, structure совпадает с API.
 */
export const NAV_SECTIONS: NavSection[] = [
  { id: 'vault',  label: 'Хранилище', icon: Archive },
  { id: 'tables', label: 'Таблицы',   icon: Table2 },
  { id: 'mol',    label: 'МОЛы',      icon: IdCard },
  { id: 'chats',  label: 'Чаты',      icon: MessageSquare },
  { id: 'news',   label: 'Новости',   icon: Newspaper },
];
