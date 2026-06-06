/**
 * Persons store — единая база ПЕРСОН (ФИО + МОЛ), вкладка «Контакты».
 * Server-backed (как склады/МОЛ): данные качаются с сервера (`persons-repo.ts`),
 * кэшируются зашифрованно (safeStorage), правки уходят на сервер. На холодном
 * старте до первого sync список пуст; дальше работает зашифрованный кэш.
 */

import {
  createZustandStore as create,
  type Person,
  type PersonsMeta,
} from '@pyn/core';

export type PersonsSyncStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type PersonsRefreshOutcome = 'up-to-date' | 'updated' | 'error' | null;

interface PersonsState {
  persons: Person[];
  byId: Map<number, Person>;
  meta: PersonsMeta | null;
  status: PersonsSyncStatus;
  lastRefreshOutcome: PersonsRefreshOutcome;

  get(id: number): Person | undefined;

  setLoaded(p: { persons: Person[]; meta: PersonsMeta | null }): void;
  setStatus(status: PersonsSyncStatus): void;
  setRefreshOutcome(outcome: PersonsRefreshOutcome): void;
  /** Optimistic локальный патч одного контакта (после server save). */
  patchLocal(id: number, fields: Partial<Person>): void;
  /** Полная очистка (logout / wipe). */
  clear(): void;
}

function buildIndex(arr: Person[]): Map<number, Person> {
  return new Map(arr.map((p) => [p.id, p]));
}

export const usePersonsStore = create<PersonsState>((set, get) => ({
  persons: [],
  byId: new Map(),
  meta: null,
  status: 'idle',
  lastRefreshOutcome: null,

  get(id: number) {
    return get().byId.get(id);
  },

  setLoaded({ persons, meta }) {
    set({ persons, byId: buildIndex(persons), meta, status: 'loaded' });
  },

  setStatus(status) {
    set({ status });
  },

  setRefreshOutcome(outcome) {
    set({ lastRefreshOutcome: outcome });
  },

  patchLocal(id, fields) {
    set((s) => {
      const next = s.persons.map((p) => (p.id === id ? { ...p, ...fields } : p));
      return { persons: next, byId: buildIndex(next) };
    });
  },

  clear() {
    set({ persons: [], byId: new Map(), meta: null, status: 'idle', lastRefreshOutcome: null });
  },
}));
