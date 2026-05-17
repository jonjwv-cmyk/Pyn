import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import type { NewsStats, PollStats } from '../types';
import type { ReactionsDetails } from '../endpoints/reactions';
import type { ScheduledMessage } from '../endpoints/scheduled';

/**
 * Кеш статистики и реакций — для cache-first UX в диалогах. Когда юзер
 * открывает «Статистика по новости» или «Реакции» — UI рендерит сразу
 * cached snapshot, не ждёт сети. Параллельно идёт fetch и обновляет.
 *
 * Когда инвалидировать:
 *   • WS `news_update` event с `id` (kind=reaction|edit|delete|poll_vote)
 *     → `invalidateMessage(id)` + UI триггерит свежий fetch на следующий open.
 *   • При logout / clear cache — все Map'ы пустые.
 *
 * Без persist — статистика сравнительно «горячие» данные, и если Pyn
 * закрыт/открыт заново, проще перетянуть свежий snapshot чем восстанавливать
 * stale кеш из диска. Это совпадает с поведением OTLHelper2 Android.
 */
export interface StatsState {
  /** Прочитавшие/не-прочитавшие, key = message_id новости. */
  newsReadersByMessageId: Record<number, NewsStats>;
  /** Воты + не-воты в опросе, key = poll_id. */
  pollStatsByPollId: Record<number, PollStats>;
  /** Aggregate + voters реакций, key = message_id. */
  reactionsByMessageId: Record<number, ReactionsDetails>;
  /**
   * Запланированные публикации (list_scheduled). NULL = ещё не загружено.
   * При open ScheduledListDialog UI рендерит cached сразу + параллельно
   * silent refetch. WS news_update kind=scheduled_sent инвалидирует.
   */
  scheduledList: ScheduledMessage[] | null;

  setNewsReaders: (messageId: number, stats: NewsStats) => void;
  setPollStats: (pollId: number, stats: PollStats) => void;
  setReactions: (messageId: number, details: ReactionsDetails) => void;
  setScheduledList: (list: ScheduledMessage[]) => void;

  /**
   * Инвалидируем всё что связано с этим message: readers, реакции, и если
   * это poll-сообщение — соответствующий poll-snapshot тоже. Caller-у нужно
   * знать `pollId`, если этот message — опрос; передаёт опционально.
   */
  invalidateMessage: (messageId: number, pollId?: number) => void;
  invalidateScheduled: () => void;
  clear: () => void;
}

const initializer: StateCreator<StatsState> = (set) => ({
  newsReadersByMessageId: {},
  pollStatsByPollId: {},
  reactionsByMessageId: {},
  scheduledList: null,
  setNewsReaders: (messageId, stats) =>
    set((prev) => ({
      newsReadersByMessageId: { ...prev.newsReadersByMessageId, [messageId]: stats },
    })),
  setPollStats: (pollId, stats) =>
    set((prev) => ({ pollStatsByPollId: { ...prev.pollStatsByPollId, [pollId]: stats } })),
  setReactions: (messageId, details) =>
    set((prev) => ({
      reactionsByMessageId: { ...prev.reactionsByMessageId, [messageId]: details },
    })),
  setScheduledList: (list) => set({ scheduledList: list }),
  invalidateMessage: (messageId, pollId) =>
    set((prev) => {
      const nextReaders = { ...prev.newsReadersByMessageId };
      delete nextReaders[messageId];
      const nextReactions = { ...prev.reactionsByMessageId };
      delete nextReactions[messageId];
      const nextPolls = { ...prev.pollStatsByPollId };
      if (pollId !== undefined) delete nextPolls[pollId];
      return {
        newsReadersByMessageId: nextReaders,
        reactionsByMessageId: nextReactions,
        pollStatsByPollId: nextPolls,
      };
    }),
  invalidateScheduled: () => set({ scheduledList: null }),
  clear: () =>
    set({
      newsReadersByMessageId: {},
      pollStatsByPollId: {},
      reactionsByMessageId: {},
      scheduledList: null,
    }),
});

export type StatsStore = UseBoundStore<StoreApi<StatsState>>;

export function createStatsStore(): StatsStore {
  return create<StatsState>()(initializer) as StatsStore;
}
