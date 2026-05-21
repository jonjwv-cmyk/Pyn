/**
 * Persistent cache fvid'ов Google Sheets filter views.
 *
 * Структура: ключ `${spreadsheetId}:${viewName}` → fvid (строка цифр).
 * Хранится в localStorage renderer'a — IPC не нужен, доступ синхронный.
 *
 * fvid — внутренний идентификатор Google для filter view; стабилен между
 * сессиями, между устройствами, и пока view существует. Persistent cache
 * позволяет применять view мгновенно через `window.location.hash =
 * "gid=X&fvid=Y"` — без programmatic menu navigation и без мерцания.
 */

const STORAGE_KEY = 'pyn:filter-fvid-cache:v1';

type Cache = Record<string, string>;

let mem: Cache | null = null;

function load(): Cache {
  if (mem !== null) return mem;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    mem = raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    mem = {};
  }
  return mem;
}

function save(): void {
  if (!mem) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mem));
  } catch {
    /* quota / disabled storage — silent */
  }
}

function keyOf(fileId: string, viewName: string): string {
  return fileId + ':' + viewName;
}

export function getFvid(fileId: string, viewName: string): string | undefined {
  return load()[keyOf(fileId, viewName)];
}

export function setFvid(fileId: string, viewName: string, fvid: string): void {
  const cache = load();
  cache[keyOf(fileId, viewName)] = fvid;
  save();
}

export function setFvidsForFile(
  fileId: string,
  mapping: Record<string, string>,
): void {
  const cache = load();
  for (const [name, fvid] of Object.entries(mapping)) {
    cache[keyOf(fileId, name)] = fvid;
  }
  save();
}

/** Имена views, для которых есть сохранённый fvid в данном файле. */
export function listViewNames(fileId: string): string[] {
  const cache = load();
  const prefix = fileId + ':';
  const out: string[] = [];
  for (const k of Object.keys(cache)) {
    if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
  }
  return out;
}

export function clearAll(): void {
  mem = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
