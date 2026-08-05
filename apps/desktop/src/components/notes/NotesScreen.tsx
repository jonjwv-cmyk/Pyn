/**
 * Заметки: текст + чеклист.
 * Мои заметки | Общие · Активные | Выполнено.
 * В общие / обратно — перетаскиванием. Имя (не login). Галочка → кто/когда.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bold,
  Check,
  CheckCircle2,
  GripVertical,
  Italic,
  ListOrdered,
  Loader2,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import * as markedNs from 'marked';
import {
  notesDelete,
  notesItemToggle,
  notesList,
  notesRestore,
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
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { WorkspaceSurfaceToggle } from '@/components/WorkspaceSurfaceToggle';
import { useWorkspaceSurface } from '@/lib/workspace-surface';
import '@/components/pyn-dash/pyn-dash.css';
import '@/components/workspace-surface.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markedApi: any =
  (markedNs as { marked?: unknown }).marked ??
  (markedNs as { default?: unknown }).default ??
  markedNs;
if (typeof markedApi?.setOptions === 'function') {
  markedApi.setOptions({ breaks: true, gfm: true });
}

type CacheKey = `${NoteScope}:${NoteStatus}`;

function cacheKey(scope: NoteScope, status: NoteStatus): CacheKey {
  return `${scope}:${status}`;
}

function nid(): string {
  return `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function newItem(text = ''): NoteItem {
  return { id: nid(), text, done: false };
}

const NOTE_MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** «август 3 · 14:30» — месяц, день, затем часы (юзер 2026-08-04). */
function fmtWhen(iso: string): string {
  if (!iso) return '';
  const s = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return time;
  const mon = NOTE_MONTHS[d.getMonth()] ?? '';
  const day = d.getDate();
  const yPart = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${mon} ${day}${yPart} · ${time}`;
}

function displayName(n: Pick<Note, 'owner_name' | 'owner_login'>): string {
  const name = (n.owner_name || '').trim();
  return name || n.owner_login || '';
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
    const parse = markedApi?.parse ?? markedApi;
    return String(typeof parse === 'function' ? parse(src || '') : '');
  } catch {
    return escapeHtml(src || '');
  }
}

/** Вставить markdown-обёртку вокруг выделения (или в курсор). */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
): { next: string; selStart: number; selEnd: number } {
  const a = value.slice(0, start);
  const mid = value.slice(start, end);
  const b = value.slice(end);
  if (mid) {
    const next = `${a}${before}${mid}${after}${b}`;
    return {
      next,
      selStart: start + before.length,
      selEnd: start + before.length + mid.length,
    };
  }
  const next = `${a}${before}${after}${b}`;
  const pos = start + before.length;
  return { next, selStart: pos, selEnd: pos };
}

/**
 * Нумерованный список по ВЫДЕЛЕНИЮ: каждый непустой абзац в выделении получает
 * свой номер (1. 2. 3.), а не одна текущая строка. Без выделения — нумеруется
 * строка с курсором. Уже пронумерованные строки перенумеровываются, а не
 * получают «1. 1. ».
 */
function numberSelectedLines(
  text: string,
  selStart: number,
  selEnd: number,
): { next: string; selStart: number; selEnd: number } {
  const from = text.lastIndexOf('\n', selStart - 1) + 1;
  const endIdx = text.indexOf('\n', selEnd);
  const to = endIdx === -1 ? text.length : endIdx;
  const block = text.slice(from, to);
  let n = 0;
  const numbered = block
    .split('\n')
    .map((line) => {
      const bare = line.replace(/^\s*\d+\.\s+/, '');
      if (!bare.trim()) return bare;
      n += 1;
      return `${n}. ${bare}`;
    })
    .join('\n');
  const next = `${text.slice(0, from)}${numbered}${text.slice(to)}`;
  return { next, selStart: from, selEnd: from + numbered.length };
}

function autoResizeTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
}

function allItemsDone(n: Note): boolean {
  return n.items.length > 0 && n.items.every((it) => it.done);
}

const RESTORE_MS = 24 * 60 * 60 * 1000;

/** Автор может восстановить в течение 24ч с deleted_at. */
function canRestoreNote(n: Note, meLogin: string): boolean {
  if (!n.deleted) return false;
  if (!n.owner_login || n.owner_login.toLowerCase() !== meLogin) return false;
  if (!n.deleted_at) return false;
  const s = n.deleted_at.includes('T') ? n.deleted_at : `${n.deleted_at.replace(' ', 'T')}Z`;
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= RESTORE_MS;
}

function patchInCache(
  cache: Map<CacheKey, Note[]>,
  note: Note,
  removeOnly?: boolean,
): void {
  for (const [k, list] of cache) {
    const filtered = list.filter((x) => x.id !== note.id);
    if (filtered.length !== list.length) cache.set(k, filtered);
  }
  if (removeOnly) return;
  const k = cacheKey(note.scope, note.status);
  const cur = cache.get(k) || [];
  cache.set(k, [note, ...cur.filter((x) => x.id !== note.id)]);
}

export function NotesScreen(): JSX.Element {
  const surface = useWorkspaceSurface('notes');
  const [me, setMe] = useState('');
  const [myName, setMyName] = useState('');
  const [scope, setScope] = useState<NoteScope>('private');
  const [bucket, setBucket] = useState<NoteStatus>('active');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [cText, setCText] = useState('');
  const [cItems, setCItems] = useState<NoteItem[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  /** Карточка в режиме правки — для «клик мимо = выход». */
  const editCardRef = useRef<HTMLElement | null>(null);
  /** Заметка, у которой зажали ручку перетаскивания (только она draggable). */
  const [dragArmedId, setDragArmedId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const dragId = useRef<number | null>(null);
  const cacheRef = useRef<Map<CacheKey, Note[]>>(new Map());
  const loadGen = useRef(0);
  const scopeRef = useRef(scope);
  const bucketRef = useRef(bucket);
  scopeRef.current = scope;
  bucketRef.current = bucket;

  useEffect(() => {
    void sessionStore.load().then((s) => {
      setMe((s?.user?.login || '').toLowerCase());
      setMyName((s?.user?.fullName || s?.user?.login || '').trim());
    });
  }, []);

  const applyView = useCallback((s: NoteScope, b: NoteStatus) => {
    const hit = cacheRef.current.get(cacheKey(s, b));
    if (hit) {
      setNotes(hit);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }, []);

  const fetchBucket = useCallback(async (s: NoteScope, b: NoteStatus): Promise<Note[]> => {
    const list = await notesList(api, { scope: s, status: b });
    cacheRef.current.set(cacheKey(s, b), list);
    return list;
  }, []);

  const load = useCallback(
    async (s: NoteScope, b: NoteStatus) => {
      const gen = ++loadGen.current;
      applyView(s, b);
      setErr('');
      try {
        const list = await fetchBucket(s, b);
        if (gen !== loadGen.current) return;
        if (scopeRef.current === s && bucketRef.current === b) {
          setNotes(list);
          setLoading(false);
        }
      } catch (e) {
        if (gen !== loadGen.current) return;
        if (scopeRef.current === s && bucketRef.current === b) {
          setErr(String(e).slice(0, 140));
          if (!cacheRef.current.has(cacheKey(s, b))) setNotes([]);
          setLoading(false);
        }
      }
    },
    [applyView, fetchBucket],
  );

  useEffect(() => {
    void load(scope, bucket);
  }, [scope, bucket, load]);

  useEffect(() => {
    const all: Array<[NoteScope, NoteStatus]> = [
      ['private', 'active'],
      ['private', 'done'],
      ['shared', 'active'],
      ['shared', 'done'],
    ];
    void Promise.allSettled(all.map(([s, b]) => fetchBucket(s, b))).then(() => {
      const hit = cacheRef.current.get(cacheKey(scopeRef.current, bucketRef.current));
      if (hit) setNotes(hit);
    });
  }, [fetchBucket]);

  const showList = useCallback(
    (s: NoteScope, b: NoteStatus) => {
      if (s === scope && b === bucket) return;
      applyView(s, b);
      setScope(s);
      setBucket(b);
    },
    [scope, bucket, applyView],
  );

  const postMemo = useCallback(async () => {
    const text = cText.trim();
    const items = cItems.filter((i) => i.text.trim());
    if (!text && items.length === 0) {
      composerRef.current?.focus();
      return;
    }
    setSaving(true);
    setErr('');
    // всегда в «Мои» — в общие только drag
    const targetScope: NoteScope = 'private';
    try {
      const saved = await notesUpsert(api, {
        title: '',
        body_md: text,
        items: items.length ? items : undefined,
        scope: targetScope,
        status: 'active',
      });
      setCText('');
      setCItems([]);
      // Высота поля — inline-стиль от автороста; без сброса «шаблон» оставался
      // ростом с только что сохранённую заметку. Возвращаем компактный вид.
      const composer = composerRef.current;
      if (composer) {
        composer.style.height = '';
        requestAnimationFrame(() => autoResizeTextarea(composerRef.current));
      }
      patchInCache(cacheRef.current, saved);
      if (scope === 'private' && bucket === 'active') {
        setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      } else {
        applyView('private', 'active');
        setScope('private');
        setBucket('active');
      }
    } catch (e) {
      setErr(String(e).slice(0, 140));
    } finally {
      setSaving(false);
    }
  }, [cText, cItems, bucket, scope, applyView]);

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

  const isOwner = useCallback(
    (n: Note) => !n.owner_login || n.owner_login.toLowerCase() === me,
    [me],
  );

  /** Shared: галочки может любой; правки/удаление/scope — owner. */
  const canCheck = useCallback(
    (n: Note) => isOwner(n) || n.scope === 'shared',
    [isOwner],
  );

  const removeNote = useCallback(
    async (n: Note) => {
      if (!isOwner(n) || n.deleted) {
        setErr('Удалить может только автор');
        return;
      }
      const prev = notes;
      if (editId === n.id) setEditId(null);

      const tomb: Note = {
        ...n,
        deleted: true,
        deleted_by: me,
        deleted_by_name: myName || me,
        deleted_at: new Date().toISOString(),
        // UI-tombstone; контент на сервере для restore 24ч
        title: '',
        body_md: '',
        items: [],
        updated_at: new Date().toISOString(),
      };
      setNotes((p) => p.map((x) => (x.id === n.id ? tomb : x)));
      patchInCache(cacheRef.current, tomb);
      try {
        const saved = await notesDelete(api, n.id);
        if (saved) {
          patchInCache(cacheRef.current, saved);
          setNotes((p) => p.map((x) => (x.id === saved.id ? saved : x)));
        }
      } catch (e) {
        setNotes(prev);
        cacheRef.current.set(cacheKey(n.scope, n.status), prev);
        setErr(String(e).slice(0, 140));
      }
    },
    [isOwner, editId, notes, me, myName],
  );

  const restoreNote = useCallback(
    async (n: Note) => {
      if (!canRestoreNote(n, me)) {
        setErr('Восстановить можно только автору в течение 24 часов');
        return;
      }
      const prev = notes;
      try {
        const saved = await notesRestore(api, n.id);
        patchInCache(cacheRef.current, saved);
        if (scopeRef.current === saved.scope && bucketRef.current === saved.status) {
          setNotes((p) => p.map((x) => (x.id === saved.id ? saved : x)));
        } else {
          setNotes((p) => p.filter((x) => x.id !== n.id));
          patchInCache(cacheRef.current, saved);
        }
      } catch (e) {
        setNotes(prev);
        setErr(String(e).slice(0, 140));
      }
    },
    [me, notes],
  );

  const setStatus = useCallback(
    async (n: Note, status: NoteStatus) => {
      if (!isOwner(n)) return;
      const prev = notes;
      // только статус карточки — галочки задач как были
      const optimistic: Note = {
        ...n,
        status,
        updated_at: new Date().toISOString(),
      };
      setNotes((p) => p.filter((x) => x.id !== n.id));
      patchInCache(cacheRef.current, optimistic);
      if (editId === n.id) setEditId(null);
      try {
        const saved = await notesSetStatus(api, n.id, status);
        patchInCache(cacheRef.current, saved);
      } catch (e) {
        setNotes(prev);
        cacheRef.current.set(cacheKey(n.scope, n.status), prev);
        setErr(String(e).slice(0, 140));
      }
    },
    [editId, notes, isOwner],
  );

  const setNoteScope = useCallback(
    async (n: Note, nextScope: NoteScope) => {
      if (!isOwner(n) || n.scope === nextScope) return;
      const prev = notes;
      const optimistic: Note = {
        ...n,
        scope: nextScope,
        updated_at: new Date().toISOString(),
      };
      setNotes((p) => p.filter((x) => x.id !== n.id));
      patchInCache(cacheRef.current, optimistic);
      try {
        const saved = await notesUpsert(api, {
          id: n.id,
          title: '',
          body_md: n.body_md || n.title || '',
          items: n.items,
          scope: nextScope,
          status: n.status,
          pinned: n.pinned,
        });
        patchInCache(cacheRef.current, saved);
        if (scopeRef.current === saved.scope && bucketRef.current === saved.status) {
          setNotes((p) => [saved, ...p.filter((x) => x.id !== saved.id)]);
        }
      } catch (e) {
        setNotes(prev);
        cacheRef.current.set(cacheKey(n.scope, n.status), prev);
        setErr(String(e).slice(0, 140));
      }
    },
    [isOwner, notes],
  );

  const toggleItem = useCallback(
    async (n: Note, itemId: string) => {
      if (!canCheck(n)) return;
      const prev = notes;
      const now = new Date().toISOString();
      const items = n.items.map((it) => {
        if (it.id !== itemId) return it;
        const nextDone = !it.done;
        if (nextDone) {
          return {
            ...it,
            done: true,
            done_by: me,
            done_by_name: myName || me,
            done_at: now,
          };
        }
        return {
          ...it,
          done: false,
          done_by: null,
          done_by_name: null,
          done_at: null,
        };
      });
      const nextStatus: NoteStatus =
        items.length > 0 && items.every((it) => it.done) ? 'done' : 'active';
      const optimistic: Note = {
        ...n,
        items,
        status: nextStatus,
        updated_at: now,
      };

      if (nextStatus !== n.status && nextStatus === 'done' && bucket === 'active') {
        setNotes((p) => p.filter((x) => x.id !== n.id));
      } else if (nextStatus !== n.status && nextStatus === 'active' && bucket === 'done') {
        setNotes((p) => p.filter((x) => x.id !== n.id));
      } else {
        setNotes((p) => p.map((x) => (x.id === n.id ? optimistic : x)));
      }
      patchInCache(cacheRef.current, optimistic);

      try {
        const saved = await notesItemToggle(api, n.id, itemId);
        patchInCache(cacheRef.current, saved);
        if (scopeRef.current === saved.scope && bucketRef.current === saved.status) {
          setNotes((p) => {
            if (p.some((x) => x.id === saved.id)) {
              return p.map((x) => (x.id === saved.id ? saved : x));
            }
            if (saved.status === bucketRef.current) return [saved, ...p];
            return p;
          });
        } else {
          setNotes((p) => p.filter((x) => x.id !== saved.id));
        }
      } catch (e) {
        setNotes(prev);
        cacheRef.current.set(cacheKey(n.scope, n.status), prev);
        setErr(String(e).slice(0, 140));
      }
    },
    [bucket, notes, canCheck, me, myName],
  );

  const saveEdit = useCallback(
    async (n: Note) => {
      setSaving(true);
      try {
        const saved = await notesUpsert(api, {
          id: n.id,
          title: '',
          body_md: editText,
          items: n.items,
          scope: n.scope,
          status: n.status,
          assignee_login: n.assignee_login,
          pinned: n.pinned,
        });
        patchInCache(cacheRef.current, saved);
        setNotes((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        setEditId(null);
      } catch (e) {
        setErr(String(e).slice(0, 140));
      } finally {
        setSaving(false);
      }
    },
    [editText],
  );

  // Отпустили кнопку мыши где угодно — снимаем «взвод» перетаскивания, иначе
  // карточка осталась бы draggable и снова мешала выделять текст.
  useEffect(() => {
    if (dragArmedId == null) return;
    const off = (): void => setDragArmedId(null);
    window.addEventListener('mouseup', off);
    return () => window.removeEventListener('mouseup', off);
  }, [dragArmedId]);

  /**
   * Фокус в поле правки — БЕЗ прокрутки страницы: `autoFocus` утаскивал длинную
   * заметку вверх, и до её начала было не домотать (юзер 2026-08-04).
   */
  useEffect(() => {
    if (editId == null) return;
    const ta = document.getElementById(`note-edit-${editId}`) as HTMLTextAreaElement | null;
    if (!ta) return;
    autoResizeTextarea(ta);
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
  }, [editId]);

  /**
   * Выход из правки кликом ЗА пределами карточки (не только кнопкой): текст,
   * если его меняли, сохраняем — иначе правки молча терялись бы.
   */
  useEffect(() => {
    if (editId == null) return;
    const onDown = (e: MouseEvent): void => {
      const card = editCardRef.current;
      if (!card || card.contains(e.target as Node)) return;
      const n = notes.find((x) => x.id === editId);
      if (n && editText !== (n.body_md || n.title || '')) void saveEdit(n);
      else setEditId(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [editId, notes, editText, saveEdit]);

  const onDropStatus = useCallback(
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

  const onDropScope = useCallback(
    async (target: NoteScope) => {
      const id = dragId.current;
      dragId.current = null;
      if (id == null) return;
      const n = notes.find((x) => x.id === id);
      if (!n || n.scope === target) return;
      await setNoteScope(n, target);
    },
    [notes, setNoteScope],
  );

  return (
    <main
      className="notes-screen relative flex flex-1 flex-col overflow-hidden"
      data-pyn-surface={surface}
    >
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <StickyNote size={14} className="text-sky-400/90" strokeWidth={1.75} />
        <span className="text-[13px] font-semibold tracking-tight text-text-strong">Заметки</span>
        {saving && <Loader2 size={12} className="animate-spin text-zinc-500" />}
        {err ? (
          <span className="no-drag-region max-w-[360px] truncate text-[11px] text-rose-400" title={err}>
            {err}
          </span>
        ) : null}
        <div className="flex-1" />
        <WorkspaceSurfaceToggle section="notes" />
      </div>

      <WorkspaceCard>
      <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col px-3 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            className="pyn-segment"
            role="tablist"
            aria-label="Область"
            onDragOver={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="tab"
              data-active={scope === 'private' ? 'true' : 'false'}
              aria-selected={scope === 'private'}
              onClick={() => showList('private', bucket)}
              onDrop={() => void onDropScope('private')}
            >
              Мои заметки
            </button>
            <button
              type="button"
              role="tab"
              data-active={scope === 'shared' ? 'true' : 'false'}
              aria-selected={scope === 'shared'}
              onClick={() => showList('shared', bucket)}
              onDrop={() => void onDropScope('shared')}
            >
              Общие
            </button>
          </div>
          <div
            className="pyn-segment"
            role="tablist"
            aria-label="Статус"
            onDragOver={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="tab"
              data-active={bucket === 'active' ? 'true' : 'false'}
              aria-selected={bucket === 'active'}
              onClick={() => showList(scope, 'active')}
              onDrop={() => void onDropStatus('active')}
            >
              Активные
            </button>
            <button
              type="button"
              role="tab"
              data-active={bucket === 'done' ? 'true' : 'false'}
              aria-selected={bucket === 'done'}
              onClick={() => showList(scope, 'done')}
              onDrop={() => void onDropStatus('done')}
            >
              Выполнено
            </button>
          </div>
        </div>

        {bucket === 'active' && scope === 'private' && (
          <div className="notes-compose mb-3 shrink-0 rounded-xl border border-white/[0.1] bg-[#2a2926] p-3 shadow-lg">
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              <FormatBtn
                title="Жирный"
                onClick={() => {
                  const el = composerRef.current;
                  if (!el) return;
                  const r = wrapSelection(cText, el.selectionStart, el.selectionEnd, '**', '**');
                  setCText(r.next);
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(r.selStart, r.selEnd);
                    autoResizeTextarea(el);
                  });
                }}
              >
                <Bold size={12} strokeWidth={2.5} />
              </FormatBtn>
              <FormatBtn
                title="Курсив"
                onClick={() => {
                  const el = composerRef.current;
                  if (!el) return;
                  const r = wrapSelection(cText, el.selectionStart, el.selectionEnd, '_', '_');
                  setCText(r.next);
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(r.selStart, r.selEnd);
                  });
                }}
              >
                <Italic size={12} />
              </FormatBtn>
              <FormatBtn
                title="Нумерованный список"
                onClick={() => {
                  const el = composerRef.current;
                  if (!el) return;
                  const r = numberSelectedLines(cText, el.selectionStart, el.selectionEnd);
                  setCText(r.next);
                  requestAnimationFrame(() => {
                    el.focus();
                    el.setSelectionRange(r.selStart, r.selEnd);
                    autoResizeTextarea(el);
                  });
                }}
              >
                <ListOrdered size={12} />
              </FormatBtn>
            </div>
            <textarea
              ref={composerRef}
              value={cText}
              onChange={(e) => {
                setCText(e.target.value);
                autoResizeTextarea(e.target);
              }}
              onPaste={onComposerPaste}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void postMemo();
                }
                if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const r = wrapSelection(cText, el.selectionStart, el.selectionEnd, '**', '**');
                  setCText(r.next);
                  requestAnimationFrame(() => el.setSelectionRange(r.selStart, r.selEnd));
                }
              }}
              rows={3}
              placeholder="Черкани заметку ✏️"
              className="notes-field w-full resize-none rounded-md border border-transparent bg-black/20 px-2 py-1.5 text-[13.5px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {cItems.length > 0 && (
              <div className="mb-2 mt-2 space-y-1 border-t border-white/[0.06] pt-2">
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
                      className="notes-field min-w-0 flex-1 rounded border border-transparent bg-black/15 px-1.5 py-0.5 text-[13px] text-zinc-200 outline-none"
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
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCItems((prev) => [...prev, newItem('')])}
                className="flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <Plus size={12} /> задача
              </button>
              <button
                type="button"
                disabled={saving || (!cText.trim() && !cItems.some((i) => i.text.trim()))}
                onClick={() => void postMemo()}
                className="notes-btn-save ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[#d97757]/45 bg-[#d97757]/20 px-3 text-[12px] font-medium text-[#e8a48a] disabled:opacity-40"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                Записать
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-6 pr-0.5">
          {loading && notes.length === 0 && (
            <div className="py-12 text-center text-[12px] text-zinc-500">Загрузка…</div>
          )}
          {!loading && notes.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-[13px] text-zinc-500">
              {bucket === 'done'
                ? 'Пока пусто'
                : scope === 'shared'
                  ? 'Пока пусто'
                  : 'Пока пусто'}
            </div>
          )}

          {notes.map((n) => {
            const owner = isOwner(n);
            const editing = editId === n.id;
            const green = !n.deleted && (bucket === 'done' || allItemsDone(n) || n.status === 'done');
            const who = displayName(n);

            // удалена — «Удалено · имя · время»; автор ≤24ч — Восстановить
            if (n.deleted) {
              const delName = (n.deleted_by_name || n.deleted_by || who || '').trim();
              const showRestore = canRestoreNote(n, me);
              return (
                <article
                  key={n.id}
                  className="notes-card rounded-xl border border-white/[0.06] bg-[#252421]/80 px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-zinc-500">
                      <span className="font-medium text-zinc-400">Удалено</span>
                      {delName ? <span className="text-zinc-300">{delName}</span> : null}
                      <span className="tabular-nums text-zinc-500">
                        {fmtWhen(n.deleted_at || n.updated_at)}
                      </span>
                    </div>
                    {showRestore ? (
                      <button
                        type="button"
                        onClick={() => void restoreNote(n)}
                        className="shrink-0 rounded-md border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-zinc-200 transition-colors hover:border-emerald-500/35 hover:bg-emerald-500/10 hover:text-emerald-300"
                      >
                        Восстановить
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            }

            return (
              <article
                key={n.id}
                ref={editing ? editCardRef : undefined}
                // draggable включаем ТОЛЬКО пока держат ручку (слева вверху):
                // при draggable на всей карточке выделение текста мышью
                // превращалось в перетаскивание — скопировать было нельзя.
                draggable={owner && dragArmedId === n.id}
                onDragStart={() => {
                  dragId.current = n.id;
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDragArmedId(null);
                }}
                className={cn(
                  'notes-card group rounded-xl border p-3.5 shadow-md transition-colors',
                  green
                    ? 'notes-card--done border-emerald-500/35 bg-emerald-950/35 hover:border-emerald-500/45'
                    : 'border-white/[0.08] bg-[#2a2926] hover:border-white/[0.12]',
                )}
              >
                <div className="mb-2 flex items-start gap-2">
                  {owner && (
                    <span
                      className="mt-0.5 cursor-grab text-zinc-600 opacity-40 transition-opacity group-hover:opacity-100"
                      title="Перетащить заметку"
                      onMouseDown={() => setDragArmedId(n.id)}
                      onMouseUp={() => setDragArmedId(null)}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                      {who ? <span className="truncate text-zinc-300">{who}</span> : null}
                      <span className="tabular-nums text-zinc-500">{fmtWhen(n.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                    {owner && !editing && (
                      <IconBtn
                        title="Редактировать"
                        onClick={() => {
                          setEditId(n.id);
                          setEditText(n.body_md || n.title || '');
                        }}
                      >
                        <Pencil size={13} />
                      </IconBtn>
                    )}
                    {owner && bucket === 'active' && (
                      <IconBtn title="Выполнено" onClick={() => void setStatus(n, 'done')} accent="green">
                        <Check size={13} strokeWidth={2.5} />
                      </IconBtn>
                    )}
                    {owner && bucket === 'done' && (
                      <IconBtn title="Активные" onClick={() => void setStatus(n, 'active')}>
                        <CheckCircle2 size={13} />
                      </IconBtn>
                    )}
                    {owner && (
                      <IconBtn title="Удалить" danger onClick={() => void removeNote(n)}>
                        <Trash2 size={13} />
                      </IconBtn>
                    )}
                  </div>
                </div>

                {editing ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <FormatBtn
                        title="Жирный (⌘B)"
                        onClick={() => {
                          const ta = document.getElementById(`note-edit-${n.id}`) as HTMLTextAreaElement | null;
                          if (!ta) return;
                          const r = wrapSelection(editText, ta.selectionStart, ta.selectionEnd, '**', '**');
                          setEditText(r.next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            ta.setSelectionRange(r.selStart, r.selEnd);
                            autoResizeTextarea(ta);
                          });
                        }}
                      >
                        <Bold size={12} strokeWidth={2.5} />
                      </FormatBtn>
                      <FormatBtn
                        title="Курсив"
                        onClick={() => {
                          const ta = document.getElementById(`note-edit-${n.id}`) as HTMLTextAreaElement | null;
                          if (!ta) return;
                          const r = wrapSelection(editText, ta.selectionStart, ta.selectionEnd, '_', '_');
                          setEditText(r.next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            ta.setSelectionRange(r.selStart, r.selEnd);
                          });
                        }}
                      >
                        <Italic size={12} />
                      </FormatBtn>
                      <FormatBtn
                        title="Список 1. 2. 3."
                        onClick={() => {
                          const ta = document.getElementById(`note-edit-${n.id}`) as HTMLTextAreaElement | null;
                          if (!ta) return;
                          const r = numberSelectedLines(editText, ta.selectionStart, ta.selectionEnd);
                          setEditText(r.next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            ta.setSelectionRange(r.selStart, r.selEnd);
                            autoResizeTextarea(ta);
                          });
                        }}
                      >
                        <ListOrdered size={12} />
                      </FormatBtn>
                    </div>
                    <textarea
                      id={`note-edit-${n.id}`}
                      value={editText}
                      onChange={(e) => {
                        setEditText(e.target.value);
                        autoResizeTextarea(e.target);
                      }}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                          e.preventDefault();
                          const ta = e.currentTarget;
                          const r = wrapSelection(editText, ta.selectionStart, ta.selectionEnd, '**', '**');
                          setEditText(r.next);
                          requestAnimationFrame(() => ta.setSelectionRange(r.selStart, r.selEnd));
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditId(null);
                        }
                      }}
                      rows={4}
                      className="notes-field w-full resize-none rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[13px] leading-relaxed text-zinc-200 outline-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void saveEdit(n)}
                        className="notes-btn-save h-7 rounded-md border border-[#d97757]/45 bg-[#d97757]/20 px-2.5 text-[11px] font-medium text-[#e8a48a]"
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
                  // Не кнопка: текст должен выделяться и копироваться прямо тут,
                  // без входа в редактирование (вход — карандашом в шапке).
                  <div className="w-full cursor-text select-text text-left">
                    {n.body_md || n.title ? (
                      <div
                        className="notes-md max-w-none text-[13.5px] leading-relaxed text-zinc-200 [&_a]:text-sky-400 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_img]:my-2 [&_img]:max-h-64 [&_img]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/30 [&_pre]:p-2"
                        dangerouslySetInnerHTML={{ __html: mdHtml(n.body_md || n.title) }}
                      />
                    ) : !n.items.length ? (
                      <div className="text-[13px] italic text-zinc-600">пусто</div>
                    ) : null}
                  </div>
                )}

                {n.items.length > 0 && (
                  <ul className="mt-2.5 space-y-1.5 border-t border-white/[0.06] pt-2.5">
                    {n.items.map((it) => (
                      <li key={it.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          disabled={!canCheck(n)}
                          onClick={() => void toggleItem(n, it.id)}
                          className={cn(
                            'notes-item-check mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors',
                            it.done
                              ? 'notes-item-check--done border-emerald-500/50 bg-emerald-500/25 text-emerald-300'
                              : 'border-white/25 text-transparent hover:border-emerald-500/40',
                          )}
                        >
                          <Check size={11} strokeWidth={2.5} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              'text-[13px] leading-snug',
                              it.done
                                ? 'notes-item-text--done text-emerald-400/75 line-through'
                                : 'text-zinc-200',
                            )}
                          >
                            {it.text || '…'}
                          </div>
                          {it.done && (it.done_by_name || it.done_at) ? (
                            <div className="mt-0.5 text-[10.5px] tabular-nums leading-none text-zinc-500">
                              {[fmtWhen(it.done_at || ''), (it.done_by_name || '').trim()]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>
      </WorkspaceCard>
    </main>
  );
}

function FormatBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
  accent,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  accent?: 'green';
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
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.06]',
        danger
          ? 'notes-icon-btn--danger text-zinc-500 hover:text-rose-300'
          : accent === 'green'
            ? 'notes-icon-btn--green text-emerald-400/80 hover:bg-emerald-500/15 hover:text-emerald-300'
            : 'text-zinc-500 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  );
}
