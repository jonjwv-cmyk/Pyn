import { create, type StateCreator } from 'zustand';

/**
 * Координация блокировки листов между всеми клиентами при выполнении
 * скриптов и SAP-макросов. Source of truth — WS broadcast
 * (`sheet_lock_acquired` / `sheet_lock_released`) от сервера. Initiator
 * делает локальный `acquire(...)` сразу (оптимистично) перед сетевым
 * вызовом, остальные клиенты узнают через WS.
 *
 * Per-tab scope: `lockedTabRawNames` определяет какие именно вкладки
 * нужно перекрыть overlay'ом. Юзер может свободно работать с
 * незаблокированными вкладками, пока скрипт идёт в фоне.
 *
 * Без persist — state эфемерный, переживать reload Pyn ему не нужно.
 */

export interface SheetLock {
  /** ID action'а (из `SHEETS_REGISTRY.files[].tabs[].actions[].id`). */
  actionId: string;
  /** Человеко-читаемая подпись из registry — отображается в overlay. */
  actionLabel: string;
  /** ФИО юзера который запустил (для отображения в overlay). */
  userName: string;
  /**
   * §pyn-1.2.43 — login юзера-инициатора. Используется для lookup avatar
   * + presence (через `usePresenceStore.byLogin[userLogin]`). Опционально
   * для back-compat со старым клиентом без поля.
   */
  userLogin?: string;
  /** Имя листа (rawName) где была инициирована операция. */
  tabName: string;
  /** Какие листы Google Sheets перекрыты overlay'ем (по rawName). */
  lockedTabRawNames: string[];
}

export interface SheetsLockState {
  activeLock: SheetLock | null;
  /** Локальный optimistic lock (initiator вызывает перед сетевым запросом). */
  acquire: (lock: SheetLock) => void;
  /** Release lock — только если actionId совпадает с текущим. Гард от race. */
  release: (actionId: string) => void;
  /** Прямое set из WS broadcast — server-authoritative. */
  setFromWs: (lock: SheetLock | null) => void;
  /** Force reset (e.g., при logout / WS disconnect). */
  reset: () => void;
}

const initializer: StateCreator<SheetsLockState> = (set, get) => ({
  activeLock: null,
  acquire: (lock) => set({ activeLock: lock }),
  release: (actionId) => {
    const cur = get().activeLock;
    if (cur && cur.actionId === actionId) set({ activeLock: null });
  },
  setFromWs: (lock) => set({ activeLock: lock }),
  reset: () => set({ activeLock: null }),
});

export const useSheetsLockStore = create<SheetsLockState>(initializer);
