import { createZustandStore, persist } from '@pyn/core';
import { createCacheStorage } from './cache-storage';

/**
 * Одно сообщение общего ИИ-чата: вопрос пользователя + ответ ИИ.
 * `key` — стабильный локальный ключ для React (server id или временный).
 */
export interface AiChatMessage {
  key: string;
  id?: number;
  login: string;
  name: string;
  question: string;
  answer: string;
  created_at?: string;
  pending?: boolean;
  error?: boolean;
}

/** Сообщение как его отдаёт сервер (ai_history / событие ai_message). */
export interface AiServerMessage {
  id: number;
  login: string;
  name: string;
  question: string;
  answer: string;
  created_at?: string;
}

interface AiLimits {
  used?: number;
  limit?: number;
  remaining?: number;
}

interface AiStoreState {
  open: boolean;
  minimized: boolean;
  messages: AiChatMessage[];
  used: number;
  limit: number;
  remaining: number;
  /** Наибольший server-id виденного сообщения — для инкрементальной догрузки. */
  lastId: number;
  setOpen: (v: boolean) => void;
  toggleMinimized: () => void;
  setMessages: (updater: (prev: AiChatMessage[]) => AiChatMessage[]) => void;
  setLimits: (used: number, limit: number, remaining: number) => void;
  /** Вставить/обновить серверное сообщение (из ai_message broadcast), дедуп по id. */
  upsertServer: (m: AiServerMessage, lim?: AiLimits) => void;
  /** Слить инкрементальную историю (ai_history) в ленту. */
  applyHistory: (list: AiServerMessage[], lim?: AiLimits) => void;
}

function toChat(m: AiServerMessage): AiChatMessage {
  return {
    key: `srv-${m.id}`,
    id: m.id,
    login: m.login,
    name: m.name,
    question: m.question,
    answer: m.answer,
    created_at: m.created_at,
  };
}

/** Порядок ленты: серверные по возрастанию id, оптимистичные (без id) — в конец. */
const ord = (m: AiChatMessage): number => (typeof m.id === 'number' ? m.id : Number.MAX_SAFE_INTEGER);
const sortMsgs = (list: AiChatMessage[]): AiChatMessage[] =>
  list.slice().sort((a, b) => ord(a) - ord(b));

export const useAiStore = createZustandStore<AiStoreState>()(
  persist(
    (set) => ({
      open: false,
      minimized: false,
      messages: [],
      used: 0,
      limit: 0,
      remaining: 0,
      lastId: 0,
      setOpen: (v) => set({ open: v, minimized: false }),
      toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
      setMessages: (updater) => set((s) => ({ messages: updater(s.messages) })),
      setLimits: (used, limit, remaining) => set({ used, limit, remaining }),
      upsertServer: (m, lim) =>
        set((s) => {
          const idx = s.messages.findIndex((x) => x.id === m.id);
          let messages: AiChatMessage[];
          if (idx >= 0) {
            messages = s.messages.slice();
            messages[idx] = { ...messages[idx], ...toChat(m), pending: false };
          } else {
            messages = sortMsgs([...s.messages, toChat(m)]);
          }
          return { messages, lastId: Math.max(s.lastId, m.id), ...lim };
        }),
      applyHistory: (list, lim) =>
        set((s) => {
          const byId = new Map<number, AiChatMessage>();
          for (const x of s.messages) if (typeof x.id === 'number') byId.set(x.id, x);
          let lastId = s.lastId;
          for (const m of list) {
            byId.set(m.id, toChat(m));
            if (m.id > lastId) lastId = m.id;
          }
          const optimistic = s.messages.filter((x) => x.id == null);
          const messages = sortMsgs([...byId.values(), ...optimistic]);
          return { messages, lastId, ...lim };
        }),
    }),
    {
      name: 'pyn-ai-chat',
      storage: createCacheStorage<AiStoreState>(),
      version: 1,
      // Кэшируем только подтверждённые сообщения + позицию догрузки; UI-флаги
      // (open/minimized) и счётчик лимита берём заново при открытии.
      partialize: (s) =>
        ({
          messages: s.messages.filter((m) => typeof m.id === 'number'),
          lastId: s.lastId,
        }) as AiStoreState,
    },
  ),
);
