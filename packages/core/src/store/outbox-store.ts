import { create, type Mutate, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

/**
 * Outbox — очередь отложенной отправки сообщений когда нет сети.
 *
 * Сценарий (1:1 с Android-приложением и Telegram):
 *   1. Юзер пишет/отправляет в чате при offline (`navigator.onLine===false`
 *      или WS disconnected).
 *   2. Сообщение попадает в `outbox` + отображается optimistic'ой
 *      pending-бабла (anim ✓ как «отправляется»).
 *   3. Когда сеть возвращается → драйнер пытается отправить каждое
 *      сообщение через `send_message`; при success — удаляется из outbox.
 *   4. Persist через safeStorage → переживает restart Pyn'a, очередь не
 *      теряется.
 *
 * Limitation первой итерации: attachments (data: URL) хранятся в outbox
 * как есть — это может надуть blob safeStorage'а на десятках МБ. Если
 * проблема — позже вынести attachments в отдельное blob-хранилище.
 */

export interface PendingAttachmentLite {
  /** data:MIME;base64,... — как и в send_message body. */
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface PendingOutgoing {
  /** Local UUID (используется как key в UI bubble и для dequeue). */
  id: string;
  peerLogin: string;
  text: string;
  attachments: PendingAttachmentLite[];
  replyToId?: number;
  /** `Date.now()` когда юзер нажал «отправить». */
  createdAt: number;
}

export interface OutboxState {
  pending: PendingOutgoing[];
  enqueue: (msg: Omit<PendingOutgoing, 'id' | 'createdAt'>) => string;
  dequeue: (id: string) => void;
  clear: () => void;
}

const initializer: StateCreator<OutboxState> = (set) => ({
  pending: [],
  enqueue: (msg) => {
    const id = `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const item: PendingOutgoing = {
      ...msg,
      id,
      createdAt: Date.now(),
    };
    set((prev) => ({ pending: [...prev.pending, item] }));
    return id;
  },
  dequeue: (id) => set((prev) => ({ pending: prev.pending.filter((p) => p.id !== id) })),
  clear: () => set({ pending: [] }),
});

export type OutboxStore = UseBoundStore<
  Mutate<StoreApi<OutboxState>, [['zustand/persist', OutboxState]]>
>;

export function createOutboxStore(storage?: PersistStorage<OutboxState>): OutboxStore {
  if (!storage) {
    return create<OutboxState>()(initializer) as OutboxStore;
  }
  return create<OutboxState>()(
    persist(initializer, {
      name: 'pyn-outbox',
      storage,
      version: 1,
    }),
  ) as OutboxStore;
}
