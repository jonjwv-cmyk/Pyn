import type { ApiClient } from '../api/client';

/**
 * Drafts endpoints — auto-save / restore черновика композера.
 *
 * Server хранит по тройке `(user_login, scope, text)`. Scope — произвольная
 * строка, конвенция:
 *   • `news`            — composer новостей
 *   • `chat:<login>`    — диалог с конкретным юзером
 *   • `poll`            — отдельный poll-composer
 *
 * Пустой `text` (empty/whitespace) → server удаляет запись (auto-cleanup).
 */

// ── SAVE_DRAFT ─────────────────────────────────────────────────────────────

/**
 * Сохранить (или обновить) черновик. Auto-save из композера каждые ~2с после
 * последнего change'а; вызывается с пустым text при сабмите → server удалит
 * запись.
 */
export async function saveDraft(
  client: ApiClient,
  req: { scope: string; text: string },
): Promise<void> {
  await client.call('save_draft', {
    scope: req.scope,
    text: req.text,
  });
}

// ── LOAD_DRAFT ─────────────────────────────────────────────────────────────

export interface DraftSnapshot {
  text: string;
  updatedAt: string;
}

/**
 * Прочитать draft по scope. Если черновика нет — возвращает пустой `text: ''`
 * (а не throw'ает) — соответствует server-side behavior.
 */
export async function loadDraft(
  client: ApiClient,
  scope: string,
): Promise<DraftSnapshot> {
  const wire = await client.call<{ data?: { text?: string; updated_at?: string } }>(
    'load_draft',
    { scope },
  );
  return {
    text: wire.data?.text ?? '',
    updatedAt: wire.data?.updated_at ?? '',
  };
}

// ── LIST_DRAFTS ────────────────────────────────────────────────────────────

export interface DraftListItem {
  scope: string;
  text: string;
  updatedAt: string;
}

/** Все черновики текущего юзера, свежие сверху. */
export async function listDrafts(client: ApiClient): Promise<DraftListItem[]> {
  const wire = await client.call<{
    data?: Array<{ scope: string; text: string; updated_at?: string }>;
  }>('list_drafts', {});
  return (wire.data ?? []).map((r) => ({
    scope: r.scope,
    text: r.text,
    updatedAt: r.updated_at ?? '',
  }));
}
