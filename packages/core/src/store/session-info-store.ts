import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import type { MeSessionInfo } from '../endpoints/auth';

/**
 * Эпhemerное хранилище свежего `me_session_info` ответа — shared между
 * SessionExpiryWatch (производитель) и UI-консьюмерами (UserPopupMenu и т.п.)
 * чтобы не дублировать polling-цикл.
 *
 * Без persist'а: info актуален только пока сессия живёт; на logout/auth-failure
 * очищается вызывающим кодом.
 */

export interface SessionInfoState {
  info: MeSessionInfo | null;
  /**
   * `Date.now()` в момент успешного `me_session_info` poll'а. Нужен чтобы
   * посчитать локально elapsed-время с серверного `remaining_ms` snapshot'а
   * (server даёт авторитативные миллисекунды, мы вычитаем сколько секунд
   * прошло с момента запроса). Это надёжнее парсинга `expires_at` —
   * не зависит от часового пояса / формата.
   */
  polledAt: number;
  setInfo: (info: MeSessionInfo) => void;
  clear: () => void;
}

const initializer: StateCreator<SessionInfoState> = (set) => ({
  info: null,
  polledAt: 0,
  setInfo: (info) => set({ info, polledAt: Date.now() }),
  clear: () => set({ info: null, polledAt: 0 }),
});

export function createSessionInfoStore(): UseBoundStore<StoreApi<SessionInfoState>> {
  return create<SessionInfoState>()(initializer);
}
