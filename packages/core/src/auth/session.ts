import type { Role } from './role';

/**
 * Состояние текущей сессии — то, что сохраняется в OS-keystore между запусками
 * и восстанавливается на старте Pyn (без round-trip на сервер для UI).
 *
 * Не персистим `passwordCounter` из LoginResponse — он динамический per-week
 * и доступен отдельно через `getPasswordCounter()`.
 */
export interface Session {
  token: string;
  role: Role;
  user: SessionUser;
  /** ISO timestamp когда клиент успешно залогинился (для UI hint'a / debug). */
  loggedInAt: string;
  /** ISO timestamp когда токен истекает (если задан сервером). */
  expiresAt?: string;
}

export interface SessionUser {
  login: string;
  fullName: string;
  avatarUrl?: string;
}

/**
 * Persisted session storage — abstraction над OS keystore (Mac Keychain,
 * Win DPAPI через Electron safeStorage, mobile expo-secure-store).
 *
 * Имплементация инжектится из приложения (desktop вызовет через IPC, mobile —
 * напрямую expo-secure-store), так что @pyn/core не зависит ни от Electron,
 * ни от Expo.
 *
 * Контракт:
 *   load()  → существующая сессия или null (если нет / расшифровать не вышло)
 *   save(s) → перезаписать
 *   clear() → стереть (no-op если ничего нет)
 */
export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store — fallback / тесты. Не персистит между запусками. */
export class InMemorySessionStore implements SessionStore {
  private session: Session | null = null;
  async load(): Promise<Session | null> {
    return this.session;
  }
  async save(session: Session): Promise<void> {
    this.session = session;
  }
  async clear(): Promise<void> {
    this.session = null;
  }
}

/**
 * Stage 2 заполнит реальной реализацией:
 *   login(client, req) → handshake + login API + tokenStore.save + apiClient.setToken
 *   logout(client) → tokenStore.clear + apiClient.setToken(null) + сервер уведомить
 *   restore() → tokenStore.load → apiClient.setToken + me() → восстановить Session
 *
 * Stage 1: только типы.
 */
export interface SessionManager {
  current(): Session | null;
  subscribe(listener: (s: Session | null) => void): () => void;
}
