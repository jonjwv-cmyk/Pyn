import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { ChatPartner } from '@/types/chat';
import { ChatListRow } from './ChatListRow';

interface ChatListProps {
  /**
   * Все диалоги одним массивом. Внутри блок делится по `partner.type`
   * — 'user' → Экспедиторы, 'client' → Клиенты. Когда сервер начнёт
   * присылать тип в response — split станет осмысленным; пока всё в
   * 'user' (см. chats-repo wireToChatPartner).
   */
  conversations: ChatPartner[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const CHAT_LIST_WIDTH = 280;

/**
 * Secondary sidebar раздела Чаты — 280dp столбец, две независимые scroll
 * области по 50% высоты для Экспедиторов и Клиентов.
 */
export function ChatList({ conversations, activeId, onSelect }: ChatListProps) {
  const { t } = useTranslation();
  // Порядок внутри секции: открытый чат закреплён сверху, затем непрочитанные,
  // затем остальные по свежести (см. sortConversations). Re-sort при смене
  // активного → контакт, в чьём чате сидим, всегда вверху своей секции.
  const users = useMemo(
    () => sortConversations(conversations.filter((c) => c.type === 'user'), activeId),
    [conversations, activeId],
  );
  const clients = useMemo(
    () => sortConversations(conversations.filter((c) => c.type === 'client'), activeId),
    [conversations, activeId],
  );

  return (
    <aside
      className="flex h-full shrink-0 flex-col"
      style={{ width: CHAT_LIST_WIDTH }}
    >
      <Block
        title={t('chat_list.section_dispatchers')}
        items={users}
        activeId={activeId}
        onSelect={onSelect}
        emptyHint={t('chat_list.empty')}
      />

      <Block
        title={t('chat_list.section_clients')}
        items={clients}
        activeId={activeId}
        onSelect={onSelect}
        emptyHint={t('chat_list.empty')}
      />
    </aside>
  );
}

interface BlockProps {
  title: string;
  items: ChatPartner[];
  activeId: string | null;
  onSelect: (id: string) => void;
  emptyHint: string;
}

function Block({ title, items, activeId, onSelect, emptyHint }: BlockProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'shrink-0 px-3 pb-1.5 pt-3',
          'text-[11px] font-medium text-text-muted/70',
        )}
      >
        {title}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11.5px] text-text-muted/70">{emptyHint}</p>
          ) : (
            <div className="flex flex-col gap-1 px-1.5 pb-2">
              {items.map((item) => (
                <ChatListRow
                  key={item.id}
                  partner={item}
                  active={item.id === activeId}
                  onClick={() => onSelect(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Свежесть из raw server timestamp `lastMessageAt`. Формат может быть epoch
 *  (число-строкой) или ISO — пробуем Number, затем Date.parse; важна не
 *  абсолютная величина, а согласованный порядок. */
function recencyKey(s: string): number {
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Порядок контактов внутри секции:
 *   1) открытый (активный) чат — закреплён сверху;
 *   2) непрочитанные — сразу под закреплённым;
 *   3) остальные — по свежести последнего сообщения (новые выше).
 * Копия массива (не мутируем вход), стабильна для равных ключей.
 */
function sortConversations(items: ChatPartner[], activeId: string | null): ChatPartner[] {
  return [...items].sort((a, b) => {
    const aActive = a.id === activeId;
    const bActive = b.id === activeId;
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aUnread = (a.unreadCount ?? 0) > 0;
    const bUnread = (b.unreadCount ?? 0) > 0;
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    return recencyKey(b.lastMessageAt) - recencyKey(a.lastMessageAt);
  });
}
