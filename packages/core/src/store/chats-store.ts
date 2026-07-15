import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

/**
 * Stale-while-revalidate cache для чатов:
 *   • Список диалогов (partners) — last message per peer, presence
 *   • Сообщения для каждого peer'a отдельно (paginated)
 *
 * Store не знает domain types напрямую (ChatPartner/ChatMessageItem живут в
 * apps/desktop/src/types), потому что они UI-specific. Передаём как generics
 * через factory.
 *
 * Rationale: типы чатов могут отличаться desktop vs mobile, но shape store —
 * один.
 */

export const CHATS_STALE_MS = 5 * 60 * 1000;
export const CHAT_MESSAGES_STALE_MS = 30 * 1000; // короче — активный диалог обновляется чаще

export interface ChatsState<TPartner, TMessage> {
  partners: TPartner[];
  partnersLastFetchedAt: number | null;
  messagesByPeer: Record<string, TMessage[]>;
  messagesLastFetchedByPeer: Record<string, number>;

  setPartners: (partners: TPartner[]) => void;
  setMessagesForPeer: (peer: string, messages: TMessage[]) => void;
  appendMessageForPeer: (peer: string, message: TMessage) => void;
  clear: () => void;
}

function makeInitializer<TPartner, TMessage>(): StateCreator<ChatsState<TPartner, TMessage>> {
  return (set) => ({
    partners: [],
    partnersLastFetchedAt: null,
    messagesByPeer: {},
    messagesLastFetchedByPeer: {},

    setPartners: (partners) =>
      set({ partners, partnersLastFetchedAt: Date.now() }),

    setMessagesForPeer: (peer, messages) =>
      set((s) => ({
        messagesByPeer: { ...s.messagesByPeer, [peer]: messages },
        messagesLastFetchedByPeer: { ...s.messagesLastFetchedByPeer, [peer]: Date.now() },
      })),

    appendMessageForPeer: (peer, message) =>
      set((s) => ({
        messagesByPeer: {
          ...s.messagesByPeer,
          [peer]: [...(s.messagesByPeer[peer] ?? []), message],
        },
      })),

    clear: () =>
      set({
        partners: [],
        partnersLastFetchedAt: null,
        messagesByPeer: {},
        messagesLastFetchedByPeer: {},
      }),
  });
}

export function createChatsStore<TPartner, TMessage>(
  storage?: PersistStorage<ChatsState<TPartner, TMessage>>,
): UseBoundStore<StoreApi<ChatsState<TPartner, TMessage>>> {
  const initializer = makeInitializer<TPartner, TMessage>();
  if (!storage) return create<ChatsState<TPartner, TMessage>>()(initializer);
  return create<ChatsState<TPartner, TMessage>>()(
    persist(initializer, {
      name: 'pyn-chats-cache',
      storage,
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        if (version < 2 && persisted && typeof persisted === 'object') {
          const s = persisted as Partial<ChatsState<TPartner, TMessage>>;
          return {
            partners: Array.isArray(s.partners) ? s.partners : [],
            partnersLastFetchedAt: s.partnersLastFetchedAt ?? null,
            messagesByPeer: s.messagesByPeer && typeof s.messagesByPeer === 'object' ? s.messagesByPeer : {},
            messagesLastFetchedByPeer:
              s.messagesLastFetchedByPeer && typeof s.messagesLastFetchedByPeer === 'object'
                ? s.messagesLastFetchedByPeer
                : {},
          } as unknown as ChatsState<TPartner, TMessage>;
        }
        return persisted as ChatsState<TPartner, TMessage>;
      },
    }),
  );
}

export function isChatsStale(lastFetchedAt: number | null, ttlMs = CHATS_STALE_MS): boolean {
  return lastFetchedAt === null || Date.now() - lastFetchedAt > ttlMs;
}
