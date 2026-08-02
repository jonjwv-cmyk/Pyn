/**
 * Заметки — UX как usememos/Memos: timeline-карточки, текст виден сразу.
 * Личные + общие (передача смены). Markdown + paste + PDF.
 * Чеклист: галочка → done; всю карточку → «Выполнено».
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type DragEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  GripVertical,
  Loader2,
  Plus,
  Share2,
  StickyNote,
  Trash2,
  Users,
  X,
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

function nid(): string {
  return `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function newItem(text = ''): NoteItem {
  return { id: nid(), text, done: false };
}

function fmtWhen(iso: string): string {
  if (!iso) return '';
  const s = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdHtml(src: string): string {
  try {
    return marked.parse(src || '') as string;
  } catch {
    return escapeHtml(src || '');
  }
}

export function NotesScreen(): JSX.Element {
  const [me, setMe] = useState('');
  const [scope, setScope] = useState<NoteScope>('private');
  const [bucket, setBucket] = useState<NoteStatus>('active');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Composer (новый memo)
  const [cText, setCText] = useState('');
  const [cItems, setCItems] = useState<NoteItem[]>([]);
  const [cShared, setCShared] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const dragId = useRef<number | null>(null);

  useEffect(() => {
    void sessionStore.load().then((s) => setMe((s?.user?.login || '').toLowerCase()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const list = await notesList(api, { scope, status: bucket });
      setNotes(list);
    } catch (e) {
      setErr(String(e).slice(0, 140));
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [scope, bucket]);

  useEffect(() => {
    void load();
  }, [load]);

  const postMemo = useCallback(async () => {
    const text = cText.trim();
    const items = cItems.filter((i) => i.text.trim());
    if (!text && items.length === 0) {
      composerRef.current?.focus();
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const title =
        text.split('\n').find((l) => l.trim())?.slice(0, 80) ||
        items[0]?.text.slice(0, 80) ||
        '';
      const saved = await notesUpsert(api, {
        title,
        body_md: text,
        items: items.length ? items : undefined,
        scope: cShared ? 'shared' : 'private',
        status: 'active',
      });
      setCText('');
      setCItems([]);
      if (bucket === 'active' && (cShared ? scope === 'shared' : scope === 'private')) {
        setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      } else {
        setScope(cShared ? 'shared' : 'private');
        setBucket('active');
      }
    } catch (e) {
      setErr(String(e).slice(0, 140));
    } finally {
      setSaving(false);
    }
  }, [cText, cItems, cShared, bucket, scope]);

  const onComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
        setCText((t) => `${t}${t ? '\n\n' : ''}![image](${dataUrl})\n`);
      };
      reader.readAsDataURL(file);
      return;
    }
  }, []);

  const removeNote = useCallback(
    async (n: Note) => {
      if (n.owner_login && me && n.owner_login.toLowerCase() !== me) {
        setErr('Удалить может только автор');
        return;
      }
      try {
        await notesDelete(api, n.id);
        setNotes((prev) => prev.filter((x) => x.id !== n.id));
        if (editId === n.id) setEditId(null);
      } catch (e) {
        setErr(String(e).slice(0, 140));
      }
    },
    [me, editId],
  );

  const setStatus = useCallback(
    async (n: Note, status: NoteStatus) => {
      try {
        await notesSetStatus(api, n.id, status);
        setNotes((prev) => prev.filter((x) => x.id !== n.id));
        if (editId === n.id) setEditId(null);
      } catch (e) {
        setErr(String(e).slice(0, 140));
      }
    },
    [editId],
  );

  const toggleItem = useCallback(async (n: Note, itemId: string) => {
    try {
      const saved = await notesItemToggle(api, n.id, itemId);
      if (saved.status === 'done' && bucket === 'active') {
        setNotes((prev) => prev.filter((x) => x.id !== saved.id));
      } else if (saved.status === 'active' && bucket === 'done') {
        setNotes((prev) => prev.filter((x) => x.id !== saved.id));
      } else {
        setNotes((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      }
    } catch (e) {
      setErr(String(e).slice(0, 140));
    }
  }, [bucket]);

  const saveEdit = useCallback(
    async (n: Note) => {
      setSaving(true);
      try {
        const title =
          editTitle.trim() ||
          editText.split('\n').find((l) => l.trim())?.slice(0, 80) ||
          n.title;
        const saved = await notesUpsert(api, {
          id: n.id,
          title,
          body_md: editText,
          items: n.items,
          scope: n.scope,
          status: n.status,
          assignee_login: n.assignee_login,
          pinned: n.pinned,
        });
        setNotes((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        setEditId(null);
      } catch (e) {
        setErr(String(e).slice(0, 140));
      } finally {
        setSaving(false);
      }
    },
    [editText, editTitle],
  );

  const toggleScope = useCallback(async (n: Note) => {
    if (n.owner_login && me && n.owner_login.toLowerCase() !== me) return;
    try {
      const saved = await notesUpsert(api, {
        id: n.id,
        title: n.title,
        body_md: n.body_md,
        items: n.items,
        scope: n.scope === 'shared' ? 'private' : 'shared',
        status: n.status,
        pinned: n.pinned,
      });
      // если смотрим «Мои» и сделали shared — убрать из списка
      if (scope === 'private' && saved.scope === 'shared') {
        setNotes((prev) => prev.filter((x) => x.id !== saved.id));
      } else if (scope === 'shared' && saved.scope === 'private') {
        setNotes((prev) => prev.filter((x) => x.id !== saved.id));
      } else {
        setNotes((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      }
    } catch (e) {
      setErr(String(e).slice(0, 140));
    }
  }, [me, scope]);

  const onDropBucket = useCallback(
    async (target: NoteStatus) => {
      const id = dragId.current;
      dragId.current = null;
      if (id == null) return;
      const n = notes.find((x) => x.id === id);
      if (!n || n.status === target) return;
      await setStatus(n, target);
    },
    [notes, setStatus],
  );

  const exportPdf = useCallback((n: Note) => {
    const title = n.title || 'Заметка';
    const itemsHtml = n.items
      .map((it) => `<li>${it.done ? '☑' : '☐'} ${escapeHtml(it.text)}</li>`)
      .join('');
    const bodyHtml = mdHtml(n.body_md);
    const w = window.open('', '_blank', 'noopener,noreferrer,width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;color:#111;padding:28px;max-width:720px;margin:0 auto;line-height:1.5}
h1{font-size:18px;margin:0 0 6px} .meta{color:#666;font-size:12px;margin-bottom:14px}
ul{padding-left:1.2em} img{max-width:100%}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${n.scope === 'shared' ? 'Общая · ' : ''}${fmtWhen(n.updated_at)}</div>
${itemsHtml ? `<ul>${itemsHtml}</ul>` : ''}
<div>${bodyHtml}</div>
<script>window.onload=()=>window.print()</script>
</body></html>`);
    w.document.close();
  }, []);

  const isOwner = useCallback(
    (n: Note) => !n.owner_login || n.owner_login.toLowerCase() === me,
    [me],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--pd-bg,#1f1e1b)]">
      {/* top bar */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
        <StickyNote size={14} className="text-sky-400/90" strokeWidth={1.75} />
        <span className="text-[13px] font-semibold tracking-tight text-[#f5f4ef]">Заметки</span>
        {saving && <Loader2 size={12} className="animate-spin text-zinc-500" />}
        {err ? (
          <span className="no-drag-region max-w-[360px] truncate text-[11px] text-rose-400" title={err}>
            {err}
          </span>
        ) : null}
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col px-3 py-3">
        {/* filters */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Chip active={scope === 'private'} onClick={() => setScope('private')} icon={<StickyNote size={12} />}>
            Мои
          </Chip>
          <Chip active={scope === 'shared'} onClick={() => setScope('shared')} icon={<Users size={12} />}>
            Общие
          </Chip>
          <span className="mx-1 h-4 w-px bg-white/10" />
          <Chip
            active={bucket === 'active'}
            onClick={() => setBucket('active')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => void onDropBucket('active')}
          >
            Активные
          </Chip>
          <Chip
            active={bucket === 'done'}
            onClick={() => setBucket('done')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => void onDropBucket('done')}
            icon={<CheckCircle2 size={12} />}
          >
            Выполнено
          </Chip>
          <span className="ml-auto text-[11px] text-zinc-600">
            перетащи карточку на «Активные» / «Выполнено»
          </span>
        </div>

        {/* composer — always on top like Memos */}
        {bucket === 'active' && (
          <div className="mb-3 shrink-0 rounded-2xl border border-white/[0.1] bg-[#2a2926] p-3 shadow-lg">
            <textarea
              ref={composerRef}
              value={cText}
              onChange={(e) => setCText(e.target.value)}
              onPaste={onComposerPaste}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void postMemo();
                }
              }}
              rows={3}
              placeholder="Что записать? Markdown · Ctrl/Cmd+V скрин · ⌘↵ отправить"
              className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {cItems.length > 0 && (
              <div className="mb-2 space-y-1 border-t border-white/[0.06] pt-2">
                {cItems.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded border border-white/20" />
                    <input
                      value={it.text}
                      onChange={(e) =>
                        setCItems((prev) =>
                          prev.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)),
                        )
                      }
                      placeholder="задача…"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCItems((prev) => prev.filter((x) => x.id !== it.id))}
                      className="text-zinc-600 hover:text-rose-300"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCItems((prev) => [...prev, newItem('')])}
                className="flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <Plus size={12} /> задача
              </button>
              <button
                type="button"
                onClick={() => setCShared((v) => !v)}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]',
                  cShared
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-white/10 text-zinc-400',
                )}
                title="Общая — видят все (передача смены)"
              >
                <Share2 size={12} />
                {cShared ? 'Общая' : 'Личная'}
              </button>
              <button
                type="button"
                disabled={saving || (!cText.trim() && !cItems.some((i) => i.text.trim()))}
                onClick={() => void postMemo()}
                className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[#d97757]/45 bg-[#d97757]/20 px-3 text-[12px] font-medium text-[#e8a48a] disabled:opacity-40"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                Записать
              </button>
            </div>
          </div>
        )}

        {/* timeline */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-6 pr-0.5">
          {loading && (
            <div className="py-12 text-center text-[12px] text-zinc-500">Загрузка…</div>
          )}
          {!loading && notes.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[13px] leading-relaxed text-zinc-500">
              {bucket === 'done'
                ? 'Пока нет выполненных.'
                : scope === 'shared'
                  ? 'Нет общих. Создай и отметь «Общая» — увидят все.'
                  : 'Лента пуста. Напиши сверху и нажми «Записать».'}
            </div>
          )}

          {notes.map((n) => {
            const owner = isOwner(n);
            const editing = editId === n.id;
            return (
              <article
                key={n.id}
                draggable={owner}
                onDragStart={() => {
                  dragId.current = n.id;
                }}
                onDragEnd={() => {
                  dragId.current = null;
                }}
                className={cn(
                  'group rounded-2xl border border-white/[0.08] bg-[#2a2926] p-3.5 shadow-md transition-colors',
                  'hover:border-white/[0.12]',
                )}
              >
                {/* meta row */}
                <div className="mb-2 flex items-start gap-2">
                  {owner && (
                    <span
                      className="mt-0.5 cursor-grab text-zinc-600 opacity-0 group-hover:opacity-100"
                      title="Перетащи на «Выполнено» / «Активные»"
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                      <span className="tabular-nums text-zinc-400">{fmtWhen(n.updated_at)}</span>
                      {n.scope === 'shared' && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-px text-sky-300/90">
                          общая
                        </span>
                      )}
                      {scope === 'shared' && n.owner_login && (
                        <span className="truncate">{n.owner_login}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
                    {owner && bucket === 'active' && (
                      <IconBtn
                        title="В выполненные"
                        onClick={() => void setStatus(n, 'done')}
                      >
                        <Check size={13} />
                      </IconBtn>
                    )}
                    {owner && bucket === 'done' && (
                      <IconBtn title="Вернуть в активные" onClick={() => void setStatus(n, 'active')}>
                        <CheckCircle2 size={13} />
                      </IconBtn>
                    )}
                    {owner && (
                      <IconBtn
                        title={n.scope === 'shared' ? 'Сделать личной' : 'Сделать общей'}
                        onClick={() => void toggleScope(n)}
                      >
                        <Share2 size={13} />
                      </IconBtn>
                    )}
                    <IconBtn title="PDF" onClick={() => exportPdf(n)}>
                      <Download size={13} />
                    </IconBtn>
                    {owner && (
                      <IconBtn title="Удалить" danger onClick={() => void removeNote(n)}>
                        <Trash2 size={13} />
                      </IconBtn>
                    )}
                  </div>
                </div>

                {/* title + body — always readable */}
                {editing ? (
                  <div className="space-y-2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Заголовок (необяз.)"
                      className="w-full bg-transparent text-[14px] font-semibold text-[#f5f4ef] outline-none placeholder:text-zinc-600"
                    />
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={6}
                      className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 font-mono text-[13px] leading-relaxed text-zinc-200 outline-none"
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void saveEdit(n)}
                        className="h-7 rounded-md border border-[#d97757]/40 bg-[#d97757]/15 px-2.5 text-[11px] text-[#e8a48a]"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditId(null)}
                        className="h-7 rounded-md border border-white/10 px-2.5 text-[11px] text-zinc-400"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full cursor-text text-left"
                    onClick={() => {
                      if (!owner) return;
                      setEditId(n.id);
                      setEditTitle(n.title);
                      setEditText(n.body_md);
                    }}
                    title={owner ? 'Нажми, чтобы править' : undefined}
                  >
                    {n.title ? (
                      <h3 className="mb-1.5 text-[14px] font-semibold leading-snug text-[#f5f4ef]">
                        {n.title}
                      </h3>
                    ) : null}
                    {n.body_md ? (
                      <div
                        className="notes-md max-w-none text-[13.5px] leading-relaxed text-zinc-200 [&_a]:text-sky-400 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_img]:my-2 [&_img]:max-h-64 [&_img]:rounded-lg [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/30 [&_pre]:p-2 [&_ul]:my-1 [&_ul]:pl-5"
                        dangerouslySetInnerHTML={{ __html: mdHtml(n.body_md) }}
                      />
                    ) : !n.items.length ? (
                      <div className="text-[13px] italic text-zinc-600">пусто — нажми, чтобы написать</div>
                    ) : null}
                  </button>
                )}

                {/* tasks always visible */}
                {n.items.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t border-white/[0.06] pt-2.5">
                    {n.items.map((it) => (
                      <li key={it.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          disabled={!owner}
                          onClick={() => void toggleItem(n, it.id)}
                          className={cn(
                            'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border',
                            it.done
                              ? 'border-emerald-500/45 bg-emerald-500/20 text-emerald-300'
                              : 'border-white/25 text-transparent hover:border-[#d97757]/50',
                          )}
                        >
                          <Check size={11} strokeWidth={2.5} />
                        </button>
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-[13px] leading-snug',
                            it.done ? 'text-zinc-500 line-through' : 'text-zinc-200',
                          )}
                        >
                          {it.text || '…'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  icon,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-white/15 bg-white/[0.1] text-[#f0eeea]'
          : 'border-white/[0.08] text-zinc-500 hover:border-white/12 hover:text-zinc-300',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06]',
        danger ? 'hover:text-rose-300' : 'hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  );
}
