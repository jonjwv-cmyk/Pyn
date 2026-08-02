/**
 * Заметки — личные + общие (передача смены).
 * Layout: TakeNote (sidebar + editor). Spirit: Markpad (markdown, paste, PDF).
 * UI: Linear / warm-dark Pyn.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  FileText,
  ListTodo,
  Loader2,
  Plus,
  Share2,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import marked from 'marked';
import {
  notesDelete,
  notesItemToggle,
  notesList,
  notesSetStatus,
  notesUpsert,
  type Note,
  type NoteItem,
  type NoteScope,
  type NoteStatus,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { sessionStore } from '@/lib/token-store';

marked.setOptions({ breaks: true, gfm: true });

function newItem(text = ''): NoteItem {
  return { id: `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, text, done: false };
}

function fmtWhen(iso: string): string {
  if (!iso) return '';
  const s = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotesScreen(): JSX.Element {
  const [me, setMe] = useState('');
  const [scope, setScope] = useState<NoteScope>('private');
  const [bucket, setBucket] = useState<NoteStatus>('active');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void sessionStore.load().then((s) => setMe((s?.user?.login || '').toLowerCase()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const list = await notesList(api, { scope, status: bucket });
      setNotes(list);
      setSelectedId((cur) => {
        if (cur && list.some((n) => n.id === cur)) return cur;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setErr(String(e).slice(0, 120));
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [scope, bucket]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId == null) {
      setDraft(null);
      return;
    }
    const n = notes.find((x) => x.id === selectedId) ?? null;
    setDraft(n ? { ...n, items: n.items.map((i) => ({ ...i })) } : null);
  }, [selectedId, notes]);

  const scheduleSave = useCallback((next: Note) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          const saved = await notesUpsert(api, {
            id: next.id > 0 ? next.id : undefined,
            title: next.title,
            body_md: next.body_md,
            items: next.items,
            scope: next.scope,
            status: next.status,
            assignee_login: next.assignee_login,
            pinned: next.pinned,
          });
          setNotes((prev) => {
            const rest = prev.filter((n) => n.id !== saved.id && n.id !== next.id);
            // Если статус сменился — выкинуть из текущего bucket
            if (saved.status !== bucket && next.id > 0) return rest;
            return [saved, ...rest].sort((a, b) =>
              (b.pinned === a.pinned ? 0 : b.pinned ? 1 : -1) ||
              b.updated_at.localeCompare(a.updated_at),
            );
          });
          setSelectedId(saved.id);
          setDraft(saved);
        } catch (e) {
          setErr(String(e).slice(0, 120));
        } finally {
          setSaving(false);
        }
      })();
    }, 500);
  }, [bucket]);

  const patchDraft = useCallback(
    (patch: Partial<Note>) => {
      setDraft((cur) => {
        if (!cur) return cur;
        const next = { ...cur, ...patch };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const createNote = useCallback(async () => {
    setSaving(true);
    setErr('');
    try {
      const saved = await notesUpsert(api, {
        title: '',
        body_md: '',
        items: [newItem('')],
        scope,
        status: 'active',
      });
      setBucket('active');
      setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      setSelectedId(saved.id);
      setDraft(saved);
      setTimeout(() => titleRef.current?.focus(), 50);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    } finally {
      setSaving(false);
    }
  }, [scope]);

  const removeNote = useCallback(async () => {
    if (!draft || draft.id <= 0) return;
    if (draft.owner_login && me && draft.owner_login.toLowerCase() !== me) {
      setErr('Удалить может только автор');
      return;
    }
    try {
      await notesDelete(api, draft.id);
      setNotes((prev) => prev.filter((n) => n.id !== draft.id));
      setSelectedId(null);
      setDraft(null);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  }, [draft, me]);

  const toggleItem = useCallback(
    async (itemId: string) => {
      if (!draft || draft.id <= 0) {
        // local-only (ещё не сохранено) — toggle in draft
        patchDraft({
          items: draft?.items.map((it) =>
            it.id === itemId ? { ...it, done: !it.done } : it,
          ),
        });
        return;
      }
      try {
        const saved = await notesItemToggle(api, draft.id, itemId);
        if (saved.status !== bucket) {
          setNotes((prev) => prev.filter((n) => n.id !== saved.id));
          setSelectedId(null);
          setDraft(null);
        } else {
          setNotes((prev) => prev.map((n) => (n.id === saved.id ? saved : n)));
          setDraft(saved);
        }
      } catch (e) {
        setErr(String(e).slice(0, 120));
      }
    },
    [draft, bucket, patchDraft],
  );

  const markDone = useCallback(async () => {
    if (!draft || draft.id <= 0) return;
    try {
      const saved = await notesSetStatus(api, draft.id, 'done');
      setNotes((prev) => prev.filter((n) => n.id !== saved.id));
      setSelectedId(null);
      setDraft(null);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  }, [draft]);

  const reopen = useCallback(async () => {
    if (!draft || draft.id <= 0) return;
    try {
      const saved = await notesSetStatus(api, draft.id, 'active');
      setNotes((prev) => prev.filter((n) => n.id !== saved.id));
      setSelectedId(null);
      setDraft(null);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  }, [draft]);

  const exportPdf = useCallback(() => {
    if (!draft) return;
    const title = draft.title || 'Без названия';
    const itemsHtml = draft.items
      .map(
        (it) =>
          `<li style="margin:4px 0">${it.done ? '☑' : '☐'} ${escapeHtml(it.text)}</li>`,
      )
      .join('');
    const bodyHtml = marked.parse(draft.body_md || '') as string;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;color:#111;padding:28px;max-width:720px;margin:0 auto;line-height:1.45}
  h1{font-size:20px;margin:0 0 8px}
  .meta{color:#666;font-size:12px;margin-bottom:16px}
  ul{padding-left:1.2em}
  img{max-width:100%}
  pre{background:#f4f4f4;padding:8px;overflow:auto}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${draft.scope === 'shared' ? 'Общая · ' : ''}${fmtWhen(draft.updated_at)}</div>
${itemsHtml ? `<ul>${itemsHtml}</ul>` : ''}
<div class="md">${bodyHtml}</div>
<script>window.onload=()=>{window.print()}</script>
</body></html>`);
    w.document.close();
  }, [draft]);

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (!it.type.startsWith('image/')) continue;
        e.preventDefault();
        const file = it.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          if (!dataUrl) return;
          // data-URL в markdown (MVP); позже → R2 blob
          const md = `\n\n![image](${dataUrl})\n\n`;
          patchDraft({ body_md: (draft?.body_md || '') + md });
        };
        reader.readAsDataURL(file);
        return;
      }
    },
    [draft?.body_md, patchDraft],
  );

  const openItems = useMemo(
    () => (draft?.items || []).filter((i) => !i.done),
    [draft?.items],
  );
  const doneItems = useMemo(
    () => (draft?.items || []).filter((i) => i.done),
    [draft?.items],
  );

  const isOwner = !draft || !draft.owner_login || draft.owner_login.toLowerCase() === me;
  const previewHtml = useMemo(() => {
    try {
      return marked.parse(draft?.body_md || '') as string;
    } catch {
      return '';
    }
  }, [draft?.body_md]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--pd-bg,#1f1e1b)]">
      {/* chrome */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
        <StickyNote size={14} className="text-sky-400/90" strokeWidth={1.75} />
        <span className="text-[13px] font-semibold tracking-tight text-[#f5f4ef]">Заметки</span>
        {saving && <Loader2 size={12} className="animate-spin text-zinc-500" />}
        {err && (
          <span className="no-drag-region truncate text-[11px] text-rose-400" title={err}>
            {err}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-white/[0.06] bg-[#252422]">
          <div className="flex gap-1 p-2">
            <SegBtn
              active={scope === 'private'}
              onClick={() => setScope('private')}
              icon={<StickyNote size={12} />}
              label="Мои"
            />
            <SegBtn
              active={scope === 'shared'}
              onClick={() => setScope('shared')}
              icon={<Users size={12} />}
              label="Общие"
            />
          </div>
          <div className="flex gap-1 px-2 pb-2">
            <SegBtn
              active={bucket === 'active'}
              onClick={() => setBucket('active')}
              icon={<ListTodo size={12} />}
              label="Активные"
              small
            />
            <SegBtn
              active={bucket === 'done'}
              onClick={() => setBucket('done')}
              icon={<CheckCircle2 size={12} />}
              label="Выполнено"
              small
            />
          </div>

          <button
            type="button"
            onClick={() => void createNote()}
            className="mx-2 mb-2 flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#d97757]/40 bg-[#d97757]/15 text-[12px] font-medium text-[#e8a48a] transition-colors hover:bg-[#d97757]/25"
          >
            <Plus size={14} strokeWidth={1.75} />
            Новая
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {loading && (
              <div className="px-2 py-6 text-center text-[12px] text-zinc-500">Загрузка…</div>
            )}
            {!loading && notes.length === 0 && (
              <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-zinc-500">
                {scope === 'shared'
                  ? 'Нет общих задач. Создай и отметь «Общая» — увидят все.'
                  : 'Пусто. Новая заметка — текст, скрин, чеклист.'}
              </div>
            )}
            {notes.map((n) => {
              const open = n.items.filter((i) => !i.done).length;
              const done = n.items.filter((i) => i.done).length;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    'mb-0.5 w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                    selectedId === n.id
                      ? 'bg-white/[0.08] ring-1 ring-white/10'
                      : 'hover:bg-white/[0.04]',
                  )}
                >
                  <div className="flex items-start gap-1.5">
                    <FileText
                      size={13}
                      className={cn(
                        'mt-0.5 shrink-0',
                        n.scope === 'shared' ? 'text-sky-400/80' : 'text-zinc-500',
                      )}
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-[#e8e6e1]">
                        {n.title || 'Без названия'}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-zinc-500">
                        <span>{fmtWhen(n.updated_at)}</span>
                        {n.items.length > 0 && (
                          <span className="tabular-nums">
                            · {done}/{n.items.length}
                          </span>
                        )}
                        {scope === 'shared' && n.owner_login && (
                          <span className="truncate">· {n.owner_login}</span>
                        )}
                        {open > 0 && bucket === 'active' && (
                          <span className="text-amber-400/80">{open} откр.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* editor */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!draft ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <StickyNote size={28} className="text-zinc-600" strokeWidth={1.25} />
              <div className="text-[14px] text-zinc-400">
                Быстро: новая → вставил скрин / текст → галочка = сделано
              </div>
              <button
                type="button"
                onClick={() => void createNote()}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/[0.05]"
              >
                Создать заметку
              </button>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
                <input
                  ref={titleRef}
                  value={draft.title}
                  disabled={!isOwner}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  placeholder="Заголовок"
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold tracking-tight text-[#f5f4ef] outline-none placeholder:text-zinc-600"
                />
                <button
                  type="button"
                  title={draft.scope === 'shared' ? 'Сделать личной' : 'Сделать общей (видят все)'}
                  disabled={!isOwner}
                  onClick={() =>
                    patchDraft({ scope: draft.scope === 'shared' ? 'private' : 'shared' })
                  }
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]',
                    draft.scope === 'shared'
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                      : 'border-white/10 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Share2 size={12} />
                  {draft.scope === 'shared' ? 'Общая' : 'Личная'}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview((v) => !v)}
                  className={cn(
                    'h-7 rounded-md border px-2 text-[11px]',
                    preview
                      ? 'border-white/20 bg-white/10 text-zinc-200'
                      : 'border-white/10 text-zinc-400',
                  )}
                >
                  {preview ? 'Правка' : 'Просмотр'}
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  className="flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-zinc-400 hover:text-zinc-200"
                  title="PDF / печать"
                >
                  <Download size={12} />
                  PDF
                </button>
                {bucket === 'active' && isOwner && (
                  <button
                    type="button"
                    onClick={() => void markDone()}
                    className="flex h-7 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] text-emerald-300"
                  >
                    <Check size={12} />
                    Готово
                  </button>
                )}
                {bucket === 'done' && isOwner && (
                  <button
                    type="button"
                    onClick={() => void reopen()}
                    className="h-7 rounded-md border border-white/10 px-2 text-[11px] text-zinc-400"
                  >
                    Вернуть
                  </button>
                )}
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => void removeNote()}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-500 hover:border-rose-500/40 hover:text-rose-300"
                    title="Удалить"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {/* checklist */}
                <div className="mb-4 space-y-1">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    Задачи
                  </div>
                  {openItems.map((it) => (
                    <TaskRow
                      key={it.id}
                      item={it}
                      disabled={!isOwner}
                      onToggle={() => void toggleItem(it.id)}
                      onChangeText={(text) =>
                        patchDraft({
                          items: draft.items.map((x) =>
                            x.id === it.id ? { ...x, text } : x,
                          ),
                        })
                      }
                      onRemove={() =>
                        patchDraft({ items: draft.items.filter((x) => x.id !== it.id) })
                      }
                    />
                  ))}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => patchDraft({ items: [...draft.items, newItem('')] })}
                      className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300"
                    >
                      <Plus size={13} /> пункт
                    </button>
                  )}
                  {doneItems.length > 0 && (
                    <div className="mt-3 border-t border-white/[0.06] pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                        Выполнено в заметке
                      </div>
                      {doneItems.map((it) => (
                        <TaskRow
                          key={it.id}
                          item={it}
                          disabled={!isOwner}
                          onToggle={() => void toggleItem(it.id)}
                          onChangeText={(text) =>
                            patchDraft({
                              items: draft.items.map((x) =>
                                x.id === it.id ? { ...x, text } : x,
                              ),
                            })
                          }
                          onRemove={() =>
                            patchDraft({ items: draft.items.filter((x) => x.id !== it.id) })
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* body */}
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Заметка · markdown · paste screenshot
                </div>
                {preview ? (
                  <div
                    className="prose prose-invert max-w-none text-[13.5px] leading-relaxed text-zinc-200 prose-p:my-2 prose-headings:text-[#f5f4ef] prose-a:text-sky-400"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <textarea
                    value={draft.body_md}
                    disabled={!isOwner}
                    onChange={(e) => patchDraft({ body_md: e.target.value })}
                    onPaste={onPaste}
                    placeholder="Пиши… вставь скрин (Ctrl/Cmd+V) · markdown **жирный** · списки"
                    className="min-h-[220px] w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-[#d97757]/35"
                    spellCheck
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  icon,
  label,
  small,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  small?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors',
        small ? 'h-7' : 'h-8',
        active
          ? 'border-white/15 bg-white/[0.08] text-[#f0eeea]'
          : 'border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TaskRow({
  item,
  disabled,
  onToggle,
  onChangeText,
  onRemove,
}: {
  item: NoteItem;
  disabled?: boolean;
  onToggle: () => void;
  onChangeText: (t: string) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/[0.03]">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
          item.done
            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
            : 'border-white/20 text-transparent hover:border-[#d97757]/50',
        )}
        aria-label={item.done ? 'Снять' : 'Выполнено'}
      >
        <Check size={12} strokeWidth={2.5} />
      </button>
      <input
        value={item.text}
        disabled={disabled}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="задача…"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[13px] outline-none',
          item.done ? 'text-zinc-500 line-through' : 'text-zinc-200',
        )}
      />
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-rose-300"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
