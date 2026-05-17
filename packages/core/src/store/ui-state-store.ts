import { create, type Mutate, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

/**
 * Persistent UI state — где юзер был, что искал, на каком чате стоял.
 * Сохраняется через safeStorage encrypted blob (как остальные cache-stores),
 * восстанавливается на старте Pyn'a → юзер возвращается ровно туда где
 * закрыл приложение.
 *
 * Принцип «Telegram-style continuation»:
 *   • Открыл МОЛы с запросом `0609` → закрыл → открыл → видишь те же
 *     результаты, scroll на том же месте, query сохранён.
 *   • Был в чате с Ивановым на середине переписки → ровно там же.
 *   • Был на 50-й новости в feed'е → scroll туда же.
 *
 * Тексты композеров (draft) уже сохраняются server-side через
 * `save_draft`/`load_draft` — здесь только клиентский UI-state.
 *
 * Поле `activeSection` — string (а не enum), потому что @pyn/core не
 * знает о desktop-specific `NavSectionId`. Client'ы кастуют.
 */
export interface UiState {
  /** Активный раздел (NavSectionId на desktop). */
  activeSection: string;
  /** Логин активного чата (null = ни один не открыт). */
  activeChatId: string | null;
  /** Текст поиска МОЛ — восстанавливается между сессиями. */
  molQuery: string;
  /** Scroll-position таблицы МОЛ (px от верха). */
  molScrollTop: number;
  /** Scroll-position ленты новостей. */
  newsScrollTop: number;
  /** Scroll-position в каждом чате (key = login партнёра). */
  chatScrollTopByPeer: Record<string, number>;
  /** Активная Google-таблица (sheet ID) в разделе «Таблицы». */
  activeTableFileId: string | null;
  /** Активная вкладка (rawName) в текущей Google-таблице. */
  activeTableTabName: string | null;
  /** Свёрнут ли список таблиц в основном Sidebar. По умолчанию раскрыт. */
  tablesListCollapsed: boolean;

  setActiveSection: (id: string) => void;
  setActiveChatId: (id: string | null) => void;
  setMolQuery: (q: string) => void;
  setMolScrollTop: (top: number) => void;
  setNewsScrollTop: (top: number) => void;
  setChatScrollTop: (peer: string, top: number) => void;
  setActiveTable: (fileId: string | null, tabName: string | null) => void;
  setTablesListCollapsed: (v: boolean) => void;
  clear: () => void;
}

const initializer: StateCreator<UiState> = (set) => ({
  activeSection: 'news',
  activeChatId: null,
  molQuery: '',
  molScrollTop: 0,
  newsScrollTop: 0,
  chatScrollTopByPeer: {},
  activeTableFileId: null,
  activeTableTabName: null,
  tablesListCollapsed: false,
  setActiveSection: (id) => set({ activeSection: id }),
  setActiveChatId: (id) => set({ activeChatId: id }),
  setMolQuery: (q) => set({ molQuery: q }),
  setMolScrollTop: (top) => set({ molScrollTop: top }),
  setNewsScrollTop: (top) => set({ newsScrollTop: top }),
  setChatScrollTop: (peer, top) =>
    set((prev) => ({ chatScrollTopByPeer: { ...prev.chatScrollTopByPeer, [peer]: top } })),
  setActiveTable: (fileId, tabName) =>
    set({ activeTableFileId: fileId, activeTableTabName: tabName }),
  setTablesListCollapsed: (v) => set({ tablesListCollapsed: v }),
  clear: () =>
    set({
      activeSection: 'news',
      activeChatId: null,
      molQuery: '',
      molScrollTop: 0,
      newsScrollTop: 0,
      chatScrollTopByPeer: {},
      activeTableFileId: null,
      activeTableTabName: null,
      tablesListCollapsed: false,
    }),
});

/**
 * Return-type включает `persist` API (hasHydrated, onFinishHydration, …) —
 * Zustand `persist` middleware расширяет store этим объектом, и потребители
 * (компоненты) могут дождаться hydration перед restore'ом scroll-positions.
 */
export type UiStateStore = UseBoundStore<
  Mutate<StoreApi<UiState>, [['zustand/persist', UiState]]>
>;

export function createUiStateStore(storage?: PersistStorage<UiState>): UiStateStore {
  if (!storage) {
    return create<UiState>()(initializer) as UiStateStore;
  }
  return create<UiState>()(
    persist(initializer, {
      name: 'pyn-ui-state',
      storage,
      version: 1,
    }),
  ) as UiStateStore;
}
