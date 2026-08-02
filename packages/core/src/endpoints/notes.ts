/**
 * Заметки / задачи — личные + общие (передача смены).
 * UI: «Мои заметки» / «Общие», drag между ними; галочки с кто/когда.
 */
import type { ApiClient } from '../api/client';

export type NoteScope = 'private' | 'shared';
export type NoteStatus = 'active' | 'done';

export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
  /** login кто отметил */
  done_by?: string | null;
  /** ФИО кто отметил */
  done_by_name?: string | null;
  /** ISO when marked done */
  done_at?: string | null;
}

export interface Note {
  id: number;
  owner_login: string;
  /** ФИО автора (не login) */
  owner_name?: string;
  scope: NoteScope;
  title: string;
  body_md: string;
  items: NoteItem[];
  status: NoteStatus;
  assignee_login: string | null;
  pinned: boolean;
  /** soft-delete в «Общих»: карточка «Удалено · имя · время» */
  deleted?: boolean;
  deleted_by?: string | null;
  deleted_by_name?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export async function notesList(
  api: ApiClient,
  opts: { scope?: NoteScope; status?: NoteStatus } = {},
): Promise<Note[]> {
  const res = await api.call<{ ok: boolean; notes?: Note[]; error?: string }>('notes_list', {
    scope: opts.scope ?? 'private',
    status: opts.status ?? 'active',
  });
  if (!res?.ok) throw new Error(res?.error || 'notes_list_failed');
  return Array.isArray(res.notes) ? res.notes : [];
}

export async function notesGet(api: ApiClient, id: number): Promise<Note> {
  const res = await api.call<{ ok: boolean; note?: Note; error?: string }>('notes_get', { id });
  if (!res?.ok || !res.note) throw new Error(res?.error || 'notes_get_failed');
  return res.note;
}

export async function notesUpsert(
  api: ApiClient,
  payload: {
    id?: number;
    title?: string;
    body_md?: string;
    items?: NoteItem[];
    scope?: NoteScope;
    status?: NoteStatus;
    assignee_login?: string | null;
    pinned?: boolean;
  },
): Promise<Note> {
  const res = await api.call<{ ok: boolean; note?: Note; error?: string }>('notes_upsert', payload);
  if (!res?.ok || !res.note) throw new Error(res?.error || 'notes_upsert_failed');
  return res.note;
}

export async function notesItemToggle(
  api: ApiClient,
  id: number,
  itemId: string,
): Promise<Note> {
  const res = await api.call<{ ok: boolean; note?: Note; error?: string }>('notes_item_toggle', {
    id,
    item_id: itemId,
  });
  if (!res?.ok || !res.note) throw new Error(res?.error || 'notes_item_toggle_failed');
  return res.note;
}

/** Soft-delete → tombstone note (контент на сервере, 24ч restore). */
export async function notesDelete(api: ApiClient, id: number): Promise<Note | null> {
  const res = await api.call<{
    ok: boolean;
    note?: Note;
    soft?: boolean;
    error?: string;
  }>('notes_delete', { id });
  if (!res?.ok) throw new Error(res?.error || 'notes_delete_failed');
  return res.note ?? null;
}

/** Восстановить удалённую (автор, ≤24ч). */
export async function notesRestore(api: ApiClient, id: number): Promise<Note> {
  const res = await api.call<{ ok: boolean; note?: Note; error?: string }>('notes_restore', {
    id,
  });
  if (!res?.ok || !res.note) throw new Error(res?.error || 'notes_restore_failed');
  return res.note;
}

export async function notesSetStatus(
  api: ApiClient,
  id: number,
  status: NoteStatus,
): Promise<Note> {
  const res = await api.call<{ ok: boolean; note?: Note; error?: string }>('notes_set_status', {
    id,
    status,
  });
  if (!res?.ok || !res.note) throw new Error(res?.error || 'notes_set_status_failed');
  return res.note;
}
