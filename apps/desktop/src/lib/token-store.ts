import { InMemorySessionStore, type Session, type SessionStore } from '@pyn/core';

/**
 * Renderer-side обёртка над `window.pyn.tokenStore` — реализует
 * `SessionStore` из @pyn/core через IPC к main process'у (safeStorage).
 *
 * Если preload bridge не загружен (например, mid-HMR-edge-case) — fallback
 * на in-memory, чтобы UI не падал. Это значит сессия не сохранится между
 * запусками, но текущая работа продолжится.
 */
function createDesktopSessionStore(): SessionStore {
  if (typeof window === 'undefined' || !window.pyn?.tokenStore) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:token] window.pyn.tokenStore unavailable, falling back to in-memory');
    return new InMemorySessionStore();
  }
  const bridge = window.pyn.tokenStore;
  return {
    async load(): Promise<Session | null> {
      try {
        return await bridge.load();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:token] load failed:', err);
        return null;
      }
    },
    async save(session: Session): Promise<void> {
      await bridge.save(session);
    },
    async clear(): Promise<void> {
      await bridge.clear();
    },
  };
}

export const sessionStore: SessionStore = createDesktopSessionStore();
