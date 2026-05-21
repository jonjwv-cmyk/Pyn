import { create, type StateCreator } from 'zustand';

/**
 * Kill switch / app lock — состояние обоих scope'ов (desktop + android).
 * Source of truth — сервер; локальный store обновляется ТОЛЬКО через:
 *   • initial fetch при mount AppControlPanel (1 запрос)
 *   • WS event `app_control_state_changed` (push, free)
 *   • после toggle action (1 запрос + refresh)
 *
 * Поллинга нет — это экономит лимит Cloudflare Workers.
 *
 * State machine (соответствует server-side):
 *   normal  — обычная работа
 *   paused  — developer активировал блокировку, countdown до wipe_at
 *   wiping  — wipe_at истёк, IPC pyn:app-lock:wipe запущен
 *   wiped   — данные стёрты, app в процессе relaunch
 */

export type AppLockState = 'normal' | 'paused' | 'wiping' | 'wiped';
export type AppLockScope = 'desktop' | 'android';

export interface AppLockScopeData {
  state: AppLockState;
  title: string;
  message: string;
  /** ISO datetime когда сервер триггернёт wiping. Null если state=normal. */
  wipeAt: string | null;
  initiatedBy: string;
}

export interface AppLockStoreState {
  desktop: AppLockScopeData;
  android: AppLockScopeData;
  devicesActive: Record<string, number>;
  devicesWiped: Record<string, number>;
  /**
   * Scope'ы где сейчас идёт toggle от текущего клиента. Используется как guard
   * против race condition: WS handler не должен переписывать optimistic state
   * пока активный pending toggle (события прилетят 2-3 раза для своего же action).
   * После завершения toggle pending снимается, дальше WS events применяются как обычно.
   */
  pendingScopes: ReadonlyArray<AppLockScope>;
  /** Обновить один scope (из WS event). */
  setScopeFromServer: (scope: AppLockScope, data: Partial<AppLockScopeData>) => void;
  /** Полная замена обоих scope'ов (из get_app_lock_status). */
  setAllFromServer: (data: {
    desktop?: Partial<AppLockScopeData>;
    android?: Partial<AppLockScopeData>;
    devicesActive?: Record<string, number>;
    devicesWiped?: Record<string, number>;
  }) => void;
  /** Optimistic — ставит scope='desktop' в wiping перед IPC wipe. */
  markCurrentWiping: (scope: AppLockScope) => void;
  /** Mark scope как pending от текущего клиента (toggle в процессе). */
  setPending: (scope: AppLockScope, pending: boolean) => void;
  reset: () => void;
}

const INITIAL_SCOPE: AppLockScopeData = {
  state: 'normal',
  title: '',
  message: '',
  wipeAt: null,
  initiatedBy: '',
};

function normalizeState(v: string | undefined): AppLockState | undefined {
  if (v === 'normal' || v === 'paused' || v === 'wiping' || v === 'wiped') return v;
  return undefined;
}

function mergeScope(cur: AppLockScopeData, patch: Partial<AppLockScopeData>): AppLockScopeData {
  return {
    state:       normalizeState(patch.state) ?? cur.state,
    title:       patch.title       ?? cur.title,
    message:     patch.message     ?? cur.message,
    wipeAt:      patch.wipeAt      !== undefined ? patch.wipeAt : cur.wipeAt,
    initiatedBy: patch.initiatedBy ?? cur.initiatedBy,
  };
}

const initializer: StateCreator<AppLockStoreState> = (set) => ({
  desktop: { ...INITIAL_SCOPE },
  android: { ...INITIAL_SCOPE },
  devicesActive: {},
  devicesWiped: {},
  pendingScopes: [],
  setScopeFromServer: (scope, data) => set((cur) => ({
    [scope]: mergeScope(cur[scope], data),
  } as Partial<AppLockStoreState>)),
  setAllFromServer: (data) => set((cur) => ({
    desktop: data.desktop ? mergeScope(cur.desktop, data.desktop) : cur.desktop,
    android: data.android ? mergeScope(cur.android, data.android) : cur.android,
    devicesActive: data.devicesActive ?? cur.devicesActive,
    devicesWiped: data.devicesWiped ?? cur.devicesWiped,
  })),
  markCurrentWiping: (scope) => set((cur) => ({
    [scope]: { ...cur[scope], state: 'wiping' as AppLockState },
  } as Partial<AppLockStoreState>)),
  setPending: (scope, pending) => set((cur) => {
    const has = cur.pendingScopes.includes(scope);
    if (pending && !has) return { pendingScopes: [...cur.pendingScopes, scope] };
    if (!pending && has) return { pendingScopes: cur.pendingScopes.filter((s) => s !== scope) };
    return {};
  }),
  reset: () => set({
    desktop: { ...INITIAL_SCOPE },
    android: { ...INITIAL_SCOPE },
    devicesActive: {},
    devicesWiped: {},
    pendingScopes: [],
  }),
});

export const useAppLockStore = create<AppLockStoreState>(initializer);
