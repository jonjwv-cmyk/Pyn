/**
 * §pyn-1.2.51 — недавно открытые файлы/папки Хранилища (LRU 10 шт).
 *
 * Используется в StorageHome для right-колонки «История». FileList пушит
 * элементы при open/navigate; Home читает at mount + on window focus
 * (чтобы вернувшись из вложенной папки сразу видеть свежий список).
 *
 * Хранение — localStorage (sync, не требует IPC, persistent через рестарты).
 * Без шифрования: пути файлов уже видны в renderer'е.
 */

const STORAGE_KEY = 'pyn:storage:history';
const MAX_ITEMS = 10;

export interface StorageHistoryItem {
  fullPath: string;
  name: string;
  isDirectory: boolean;
  openedAt: number;
}

/** Прочитать всю историю (newest first). */
export function readStorageHistory(): StorageHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    // Sanity check on каждый элемент
    return arr.filter(
      (x): x is StorageHistoryItem =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as StorageHistoryItem).fullPath === 'string' &&
        typeof (x as StorageHistoryItem).name === 'string' &&
        typeof (x as StorageHistoryItem).isDirectory === 'boolean' &&
        typeof (x as StorageHistoryItem).openedAt === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * Добавить элемент в начало истории. Если такой fullPath уже был — старая
 * запись удаляется (LRU semantic). После добавления список обрезается до
 * MAX_ITEMS.
 */
export function pushStorageHistory(
  item: Omit<StorageHistoryItem, 'openedAt'>,
): void {
  const arr = readStorageHistory();
  const filtered = arr.filter((x) => x.fullPath !== item.fullPath);
  filtered.unshift({ ...item, openedAt: Date.now() });
  const trimmed = filtered.slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / privacy mode — игнорируем, история не критична. */
  }
}
