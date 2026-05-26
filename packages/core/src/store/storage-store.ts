import { create } from 'zustand';

/**
 * Storage state: текущий путь + history стек для back/forward.
 * Не persist'им (сетевой контент — не критично сохранять между сессиями;
 * корни всегда показываются заново).
 */
interface StorageState {
  currentPath: string;
  history: string[]; // back stack
  forwardStack: string[]; // forward stack (когда юзер нажал back)
  expandedFolders: Set<string>; // в FolderTree какие папки раскрыты

  setCurrentPath: (path: string) => void;
  navigateTo: (path: string) => void;
  back: () => void;
  forward: () => void;
  toggleExpanded: (path: string) => void;
  reset: () => void;
}

export const useStorageStore = create<StorageState>((set, get) => ({
  currentPath: '',
  history: [],
  forwardStack: [],
  expandedFolders: new Set<string>(),

  setCurrentPath: (path) => set({ currentPath: path }),

  navigateTo: (path) => {
    const cur = get().currentPath;
    if (cur === path) return;
    set({
      history: cur ? [...get().history, cur] : get().history,
      forwardStack: [],
      currentPath: path,
    });
  },

  back: () => {
    const hist = get().history;
    if (hist.length === 0) return;
    const prev = hist[hist.length - 1];
    if (!prev) return;
    set({
      history: hist.slice(0, -1),
      forwardStack: [get().currentPath, ...get().forwardStack],
      currentPath: prev,
    });
  },

  forward: () => {
    const fwd = get().forwardStack;
    if (fwd.length === 0) return;
    const next = fwd[0];
    if (!next) return;
    set({
      history: [...get().history, get().currentPath],
      forwardStack: fwd.slice(1),
      currentPath: next,
    });
  },

  toggleExpanded: (path) => {
    const set2 = new Set(get().expandedFolders);
    if (set2.has(path)) set2.delete(path);
    else set2.add(path);
    set({ expandedFolders: set2 });
  },

  reset: () => set({
    currentPath: '',
    history: [],
    forwardStack: [],
    expandedFolders: new Set<string>(),
  }),
}));
