/**
 * Абстракция над хранилищем session token'a.
 *
 * Реализации (stage 2):
 *   • Desktop: Electron `safeStorage` (encrypted с OS Keychain / DPAPI) →
 *     fallback `~/.pyn/session_token.bin` (AES-GCM, key=PBKDF2(password, 100k)).
 *   • Mobile: `expo-secure-store` (Keychain / Keystore native).
 *
 * Stage 1: интерфейс готов, реализации — заглушки. ApiClient уже умеет работать
 * с любым TokenStore через DI (см. session.ts).
 */
export interface TokenStore {
  /** null если токена нет (не залогинены). */
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory fallback — на случай если ни OS keystore, ни file storage не доступны. */
export class InMemoryTokenStore implements TokenStore {
  private token: string | null = null;
  async load(): Promise<string | null> {
    return this.token;
  }
  async save(token: string): Promise<void> {
    this.token = token;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}
