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
  const users = conversations.filter((c) => c.type === 'user');
  const clients = conversations.filter((c) => c.type === 'client');

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-bg-surface',
        'border-r border-border-subtle',
      )}
      style={{ width: CHAT_LIST_WIDTH }}
    >
      <div className="drag-region h-12 shrink-0" />
      <div className="mx-3 h-px shrink-0 bg-border-subtle" />

      <Block
        title={t('chat_list.section_dispatchers')}
        items={users}
        activeId={activeId}
        onSelect={onSelect}
        emptyHint={t('chat_list.empty')}
      />

      <div className="mx-3 h-px shrink-0 bg-border-subtle" />

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
          'text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted',
        )}
      >
        {title}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11.5px] text-text-muted/70">{emptyHint}</p>
          ) : (
            <div className="flex flex-col gap-px px-1.5 pb-2">
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
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-bg-surface to-transparent" />
      </div>
    </div>
  );
}
