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

/**
 * Статус модели от сервера: какая модель цепочки сейчас обслуживает и сколько
 * у неё осталось дневной квоты (%). Авто-цепочка: Gemini Flash → Flash-Lite →
 * Llama (бэкстоп), переключение бесшовное — клиент только показывает текущую.
 */
export interface AiStatus {
  model_label?: string;
  remaining_pct?: number;
}

/**
 * Геометрия окна ИИ (persist между сессиями).
 * - `pill` — левый-верхний угол свёрнутой пилюли в px; `null` = дефолтный
 *   якорь «низ-право».
 * - `size` — размер развёрнутого окна в px (окно якорится в низ-право, ресайз
 *   за верхне-левый угол растит к верху/левому краю).
 */
export interface AiGeom {
  pill: { x: number; y: number } | null;
  size: { w: number; h: number };
}

const DEFAULT_GEOM: AiGeom = { pill: null, size: { w: 380, h: 520 } };

interface AiStoreState {
  open: boolean;
  minimized: boolean;
  messages: AiChatMessage[];
  /** Какая модель сейчас обслуживает (напр. «Gemini Flash», «Llama 3.3»). */
  modelLabel: string;
  /** Остаток дневной квоты текущей модели, 0..100. */
  remainingPct: number;
  /** Наибольший server-id виденного сообщения — для инкрементальной догрузки. */
  lastId: number;
  /** Геометрия окна: позиция свёрнутой пилюли + размер развёрнутого окна. */
  geom: AiGeom;
  setOpen: (v: boolean) => void;
  toggleMinimized: () => void;
  /** Сохранить позицию свёрнутой пилюли (левый-верхний угол, px). */
  setPillPos: (x: number, y: number) => void;
  /** Сохранить размер развёрнутого окна (px). */
  setPanelSize: (w: number, h: number) => void;
  setMessages: (updater: (prev: AiChatMessage[]) => AiChatMessage[]) => void;
  /** Обновить индикатор «модель + остаток %» (из ответа/брокаста/статуса). */
  setStatus: (s: AiStatus) => void;
  /** Вставить/обновить серверное сообщение (из ai_message broadcast), дедуп по id. */
  upsertServer: (m: AiServerMessage, st?: AiStatus) => void;
  /** Слить инкрементальную историю (ai_history) в ленту. */
  applyHistory: (list: AiServerMessage[], st?: AiStatus) => void;
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

/** Патч статуса: берём только заданные поля, чтобы не затирать undefined'ом. */
function statusPatch(st?: AiStatus): Partial<AiStoreState> {
  const patch: Partial<AiStoreState> = {};
  if (st?.model_label != null) patch.modelLabel = st.model_label;
  if (typeof st?.remaining_pct === 'number') patch.remainingPct = st.remaining_pct;
  return patch;
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
      modelLabel: '',
      remainingPct: 100,
      lastId: 0,
      geom: DEFAULT_GEOM,
      setOpen: (v) => set({ open: v, minimized: false }),
      toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
      setPillPos: (x, y) => set((s) => ({ geom: { ...s.geom, pill: { x, y } } })),
      setPanelSize: (w, h) => set((s) => ({ geom: { ...s.geom, size: { w, h } } })),
      setMessages: (updater) => set((s) => ({ messages: updater(s.messages) })),
      setStatus: (st) => set(statusPatch(st)),
      upsertServer: (m, st) =>
        set((s) => {
          const idx = s.messages.findIndex((x) => x.id === m.id);
          let messages: AiChatMessage[];
          if (idx >= 0) {
            messages = s.messages.slice();
            messages[idx] = { ...messages[idx], ...toChat(m), pending: false };
          } else {
            messages = sortMsgs([...s.messages, toChat(m)]);
          }
          return { messages, lastId: Math.max(s.lastId, m.id), ...statusPatch(st) };
        }),
      applyHistory: (list, st) =>
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
          return { messages, lastId, ...statusPatch(st) };
        }),
    }),
    {
      name: 'pyn-ai-chat',
      storage: createCacheStorage<AiStoreState>(),
      version: 1,
      // Кэшируем подтверждённые сообщения + позицию догрузки + геометрию окна;
      // UI-флаги (open/minimized) и индикатор модели берём заново при открытии.
      partialize: (s) =>
        ({
          messages: s.messages.filter((m) => typeof m.id === 'number'),
          lastId: s.lastId,
          geom: s.geom,
        }) as AiStoreState,
    },
  ),
);
