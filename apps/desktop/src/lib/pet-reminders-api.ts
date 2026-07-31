/**
 * API + локальный стейт напоминаний питомца (per-user на сервере).
 */
import { api } from '@/lib/api';
import { createZustandStore } from '@pyn/core';

export interface PetReminder {
  id: number;
  body: string;
  fire_at: string;
  status: 'pending' | 'due' | 'acked' | 'cancelled' | string;
  created_at?: string;
  acked_at?: string | null;
}

/** Ожидание «сегодня / следующую неделю» */
export interface ReminderClarify {
  body: string;
  weekday: number;
  weekdayRu: string;
  hour: number;
  minute: number;
}

interface ReminderStore {
  items: PetReminder[];
  clarify: ReminderClarify | null;
  lastPullAt: number;
  setItems: (items: PetReminder[]) => void;
  setClarify: (c: ReminderClarify | null) => void;
  removeLocal: (id: number) => void;
  upsertLocal: (r: PetReminder) => void;
}

export const usePetRemindersStore = createZustandStore<ReminderStore>()((set, get) => ({
  items: [],
  clarify: null,
  lastPullAt: 0,
  setItems: (items) => set({ items, lastPullAt: Date.now() }),
  setClarify: (clarify) => set({ clarify }),
  removeLocal: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
  upsertLocal: (r) => {
    const rest = get().items.filter((x) => x.id !== r.id);
    set({ items: [...rest, r].sort((a, b) => a.fire_at.localeCompare(b.fire_at)) });
  },
}));

export function dueReminders(items: PetReminder[], now = Date.now()): PetReminder[] {
  return items.filter((r) => {
    if (r.status === 'acked' || r.status === 'cancelled') return false;
    if (r.status === 'due') return true;
    const t = parseFireAt(r.fire_at);
    return t != null && t <= now;
  });
}

/** SQLite UTC 'YYYY-MM-DD HH:MM:SS' or ISO */
export function parseFireAt(s: string): number | null {
  if (!s) return null;
  if (s.includes('T') || s.endsWith('Z')) {
    const n = Date.parse(s);
    return Number.isFinite(n) ? n : null;
  }
  // treat as UTC wall
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const n = Date.parse(s.replace(' ', 'T') + 'Z');
    return Number.isFinite(n) ? n : null;
  }
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0),
  );
  return ms;
}

export async function pullPetReminders(): Promise<PetReminder[]> {
  try {
    const r = await api.call<{ ok?: boolean; reminders?: PetReminder[] }>(
      'pet_reminders_list',
      {},
      { timeoutMs: 15_000 },
    );
    const list = Array.isArray(r.reminders) ? r.reminders : [];
    usePetRemindersStore.getState().setItems(list);
    return list;
  } catch (err) {
    console.warn('[pyn:reminders] pull failed', err);
    return usePetRemindersStore.getState().items;
  }
}

export async function addPetReminder(body: string, fireAt: Date): Promise<PetReminder | null> {
  try {
    const r = await api.call<{ ok?: boolean; reminder?: PetReminder; error?: string }>(
      'pet_reminders_add',
      {
        body,
        fire_at: fireAt.toISOString(),
      },
      { timeoutMs: 15_000 },
    );
    if (r.ok && r.reminder) {
      usePetRemindersStore.getState().upsertLocal(r.reminder);
      return r.reminder;
    }
    console.warn('[pyn:reminders] add failed', r.error);
    return null;
  } catch (err) {
    console.warn('[pyn:reminders] add error', err);
    return null;
  }
}

export async function ackPetReminder(id: number): Promise<boolean> {
  try {
    const r = await api.call<{ ok?: boolean }>('pet_reminders_ack', { id }, { timeoutMs: 12_000 });
    if (r.ok) {
      usePetRemindersStore.getState().removeLocal(id);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** DeepSeek Flash: разбор «напомни…» когда локальный regex не уверен. */
export type AiReminderParse =
  | {
      ok: true;
      body: string;
      fireAt: Date;
      model?: string;
      tokens?: number;
    }
  | {
      ok: false;
      need?: 'time' | 'weekday' | 'clarify' | string;
      body?: string;
      ask?: string | null;
      weekday?: number | null;
      error?: string;
    };

/** Диагностика в ~/Desktop/pyn-debug.log — чтобы на корп-ПК видеть реальную причину. */
function remindDebug(msg: string): void {
  try {
    window.pyn?.debugLog?.('pet:remind', msg);
  } catch {
    /* */
  }
}

export async function parseReminderViaAi(text: string): Promise<AiReminderParse> {
  try {
    const r = await api.call<{
      ok?: boolean;
      body?: string;
      fire_at?: string;
      need?: string;
      ask?: string | null;
      weekday?: number | null;
      error?: string;
      model?: string;
      tokens?: number;
    }>(
      'ai_pet_reminder_parse',
      { text, now_iso: new Date().toISOString() },
      // DeepSeek на корп-канале бывает медленным; чат терпит 90с — здесь тоже даём запас.
      { timeoutMs: 30_000 },
    );

    if (r.ok && r.fire_at && r.body) {
      const fireAt = new Date(r.fire_at);
      if (!Number.isFinite(fireAt.getTime())) {
        return { ok: false, error: 'bad_fire_at', need: 'time', body: r.body };
      }
      return {
        ok: true,
        body: r.body,
        fireAt,
        model: r.model,
        tokens: r.tokens,
      };
    }

    // Сервер ответил, но не ok — логируем точную причину (forbidden / pet_ai_unconfigured /
    // deepseek_http_* / remind_*_cap / bad_json / incomplete), чтобы не чинить вслепую.
    if (r.error) remindDebug(`server not-ok: error=${r.error} need=${r.need ?? '-'}`);
    return {
      ok: false,
      need: r.need || (r.error ? 'clarify' : 'time'),
      body: r.body,
      ask: r.ask,
      weekday: r.weekday,
      error: r.error,
    };
  } catch (err) {
    // Сеть/таймаут/прокси — не дошли до сервера. На корп-ПК это ключевой признак.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[pyn:reminders] ai parse failed', err);
    remindDebug(`network/timeout: ${msg.slice(0, 160)}`);
    return { ok: false, error: 'network', need: 'clarify' };
  }
}
