import type { ChatMessageItem, ChatPartner } from '@/types/chat';

/**
 * Mock-данные раздела Чаты. Разделены на экспедиторов и клиентов
 * (порядок и разделение задаются в ChatList).
 */

export const CHAT_USERS: ChatPartner[] = [
  {
    id: 'u1',
    type: 'user',
    name: 'Анна Соколова',
    initials: 'АС',
    lastMessage: 'Документ согласован, отправляю',
    lastMessageTime: '12:42',
    unreadCount: 2,
    presence: 'online',
  },
  {
    id: 'u2',
    type: 'user',
    name: 'Михаил Петров',
    initials: 'МП',
    lastMessage: 'Спасибо, принял',
    lastMessageTime: '11:08',
    presence: 'offline',
  },
  {
    id: 'u3',
    type: 'user',
    name: 'Екатерина Волкова',
    initials: 'ЕВ',
    lastMessage: 'Перезвоню через 10 минут',
    lastMessageTime: 'Вчера',
    presence: 'online',
  },
  {
    id: 'u4',
    type: 'user',
    name: 'Дмитрий Соловьёв',
    initials: 'ДС',
    lastMessage: 'Ок, понял',
    lastMessageTime: '14.05',
    presence: 'away',
  },
];

export const CHAT_CLIENTS: ChatPartner[] = [
  {
    id: 'c1',
    type: 'client',
    name: 'ООО «Феникс»',
    initials: 'Ф',
    lastMessage: 'Можно уточнить сроки поставки?',
    lastMessageTime: '13:21',
    unreadCount: 1,
    presence: 'offline',
  },
  {
    id: 'c2',
    type: 'client',
    name: 'ИП Морозов А.Б.',
    initials: 'М',
    lastMessage: 'Принято, ждём счёт',
    lastMessageTime: '09:55',
    presence: 'away',
  },
  {
    id: 'c3',
    type: 'client',
    name: 'ЗАО «СтройИнвест»',
    initials: 'СИ',
    lastMessage: 'Перенесём встречу на завтра?',
    lastMessageTime: 'Вчера',
    presence: 'away',
  },
];

export const CHAT_MESSAGES: Record<string, ChatMessageItem[]> = {
  u1: [
    { id: 'm1', authorId: 'u1', text: 'Добрый день! Документ по проекту получили?', time: '12:30', isOwn: false },
    { id: 'm2', authorId: 'me', text: 'Да, получил, изучаю', time: '12:34', isOwn: true },
    { id: 'm3', authorId: 'u1', text: 'Отлично! Если будут вопросы — пишите', time: '12:35', isOwn: false },
    { id: 'm4', authorId: 'me', text: 'Один момент: по пункту 4 уточните, пожалуйста, сроки', time: '12:38', isOwn: true },
    { id: 'm5', authorId: 'u1', text: 'До конца недели всё закрываем', time: '12:40', isOwn: false },
    { id: 'm6', authorId: 'u1', text: 'Документ согласован, отправляю', time: '12:42', isOwn: false },
  ],
  u2: [
    { id: 'm1', authorId: 'u2', text: 'Файл закинул в папку', time: '10:55', isOwn: false },
    { id: 'm2', authorId: 'me', text: 'Посмотрю сегодня', time: '11:02', isOwn: true },
    { id: 'm3', authorId: 'u2', text: 'Спасибо, принял', time: '11:08', isOwn: false },
  ],
  u3: [
    { id: 'm1', authorId: 'me', text: 'Свободна для звонка?', time: 'Вчера', isOwn: true },
    { id: 'm2', authorId: 'u3', text: 'Перезвоню через 10 минут', time: 'Вчера', isOwn: false },
  ],
  u4: [
    { id: 'm1', authorId: 'me', text: 'Доступы выслал', time: '14.05', isOwn: true },
    { id: 'm2', authorId: 'u4', text: 'Ок, понял', time: '14.05', isOwn: false },
  ],
  c1: [
    { id: 'm1', authorId: 'c1', text: 'Здравствуйте! Можно уточнить сроки поставки?', time: '13:21', isOwn: false },
  ],
  c2: [
    { id: 'm1', authorId: 'me', text: 'Счёт сформирую сегодня', time: '09:50', isOwn: true },
    { id: 'm2', authorId: 'c2', text: 'Принято, ждём счёт', time: '09:55', isOwn: false },
  ],
  c3: [
    { id: 'm1', authorId: 'c3', text: 'Перенесём встречу на завтра?', time: 'Вчера', isOwn: false },
  ],
};
