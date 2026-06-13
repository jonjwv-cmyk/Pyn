import { useCallback, useMemo, useState } from 'react';
import type { FlowHeaderMenuAnchor } from './FlowHeaderMenu';

/**
 * Фильтры/сортировка колонок гридов «Потока» — как в Формировании (FlowSandboxGrid),
 * вынесены в общий хук для Транспорта/Плана/Отчёта (юзер 2026-06-13). Меню колонки —
 * общий FlowHeaderMenu (сорт + поиск по колонке + чек-лист значений). Объединённые
 * колонки фильтруются по СКЛЕЕННОМУ значению (getValue даёт «A · B»): поиск в меню
 * сужает по любому под-значению — удобно, как фильтр заказа в Формировании.
 *
 * Это клиентский «фильтр показа» поверх загруженных строк (строки не трогаем). Список
 * значений колонки считается КАСКАДНО — по строкам, прошедшим ОСТАЛЬНЫЕ фильтры (как
 * в Гугл-таблицах), кроме её собственного.
 */

/** Фильтр одной колонки: поиск-сужение + снятые галочкой (скрытые) значения. */
export interface FlowColFilter {
  search: string;
  excluded: Set<string>;
}

const MAX_DISTINCT = 5000;

export interface FlowColumnFiltersApi<TRow> {
  menu: FlowHeaderMenuAnchor | null;
  menuColId: string | undefined;
  menuSearch: string;
  menuValues: string[];
  menuExcluded: ReadonlySet<string>;
  menuSortDir: 'asc' | 'desc' | null;
  /** id колонок с активным фильтром — для подсветки заголовка (themeOverride). */
  activeFilterColIds: Set<string>;
  /** Есть ли активная колоночная сортировка (грид тогда не применяет дефолтную). */
  hasColumnSort: boolean;
  handleHeaderMenuClick: (colIndex: number, bounds: { x: number; y: number; width: number; height: number }) => void;
  closeMenu: () => void;
  onMenuSearchChange: (q: string) => void;
  onToggleValue: (v: string) => void;
  onClear: () => void;
  onDeselectAll: () => void;
  onSort: (dir: 'asc' | 'desc') => void;
  onSortReset: () => void;
  /** Применить фильтры показа (для viewRows). */
  applyFilters: (rows: TRow[]) => TRow[];
  /** Пересортировать по активной колонке (если есть) — иначе вернуть как есть. */
  applySort: (rows: TRow[]) => TRow[];
}

export function useFlowColumnFilters<TRow extends { id: number }>(args: {
  columns: { id: string; title: string }[];
  rows: TRow[];
  getValue: (row: TRow, colId: string) => string;
}): FlowColumnFiltersApi<TRow> {
  const { columns, rows, getValue } = args;
  const [filters, setFilters] = useState<Record<string, FlowColFilter>>({});
  const [sort, setSort] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null);
  const [menu, setMenu] = useState<FlowHeaderMenuAnchor | null>(null);

  const menuColId = menu ? columns[menu.colIndex]?.id : undefined;

  // Активные фильтры (кроме опционально исключённой колонки).
  const activeEntries = useCallback(
    (exceptCol?: string) =>
      Object.entries(filters).filter(
        ([colId, f]) => colId !== exceptCol && (f.search.trim() !== '' || f.excluded.size > 0),
      ),
    [filters],
  );

  const filterRows = useCallback(
    (src: TRow[], exceptCol?: string): TRow[] => {
      const active = activeEntries(exceptCol);
      if (active.length === 0) return src;
      return src.filter((row) =>
        active.every(([colId, f]) => {
          const v = getValue(row, colId);
          const q = f.search.trim().toLowerCase();
          if (q && !v.toLowerCase().includes(q)) return false;
          if (f.excluded.has(v)) return false;
          return true;
        }),
      );
    },
    [activeEntries, getValue],
  );

  const applyFilters = useCallback((src: TRow[]) => filterRows(src), [filterRows]);

  const applySort = useCallback(
    (src: TRow[]): TRow[] => {
      if (!sort) return src;
      const { colId, dir } = sort;
      const sign = dir === 'asc' ? 1 : -1;
      return [...src].sort(
        (a, b) => sign * getValue(a, colId).localeCompare(getValue(b, colId), 'ru', { numeric: true }),
      );
    },
    [sort, getValue],
  );

  // Каскадные значения колонки открытого меню (по строкам, прошедшим ОСТАЛЬНЫЕ фильтры).
  const menuValues = useMemo<string[]>(() => {
    if (!menuColId) return [];
    const set = new Set<string>();
    for (const r of filterRows(rows, menuColId)) {
      set.add(getValue(r, menuColId));
      if (set.size >= MAX_DISTINCT) break;
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  }, [menuColId, filterRows, rows, getValue]);

  const menuFilter = menuColId ? filters[menuColId] : undefined;
  const menuSearch = menuFilter?.search ?? '';
  const menuExcluded = menuFilter?.excluded ?? EMPTY_SET;
  const menuSortDir = sort && menuColId && sort.colId === menuColId ? sort.dir : null;

  const activeFilterColIds = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    for (const [colId, f] of Object.entries(filters)) {
      if (f.search.trim() !== '' || f.excluded.size > 0) s.add(colId);
    }
    return s;
  }, [filters]);

  const handleHeaderMenuClick = useCallback(
    (colIndex: number, bounds: { x: number; y: number; width: number; height: number }) => {
      const col = columns[colIndex];
      if (!col) return;
      setMenu({ colIndex, title: col.title, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    },
    [columns],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const update = useCallback(
    (colId: string, fn: (cur: FlowColFilter) => FlowColFilter) => {
      setFilters((prev) => ({ ...prev, [colId]: fn(prev[colId] ?? { search: '', excluded: new Set<string>() }) }));
    },
    [],
  );

  const onMenuSearchChange = useCallback(
    (q: string) => {
      if (menuColId) update(menuColId, (cur) => ({ search: q, excluded: cur.excluded }));
    },
    [menuColId, update],
  );

  const onToggleValue = useCallback(
    (value: string) => {
      if (!menuColId) return;
      update(menuColId, (cur) => {
        const excluded = new Set(cur.excluded);
        if (excluded.has(value)) excluded.delete(value);
        else excluded.add(value);
        return { search: cur.search, excluded };
      });
    },
    [menuColId, update],
  );

  const onClear = useCallback(() => {
    if (menuColId) update(menuColId, () => ({ search: '', excluded: new Set<string>() }));
  }, [menuColId, update]);

  const onDeselectAll = useCallback(() => {
    if (menuColId) update(menuColId, (cur) => ({ search: cur.search, excluded: new Set(menuValues) }));
  }, [menuColId, update, menuValues]);

  const onSort = useCallback(
    (dir: 'asc' | 'desc') => {
      if (menuColId) setSort({ colId: menuColId, dir });
    },
    [menuColId],
  );

  const onSortReset = useCallback(() => {
    setSort((cur) => (cur && menuColId && cur.colId === menuColId ? null : cur));
  }, [menuColId]);

  return {
    menu,
    menuColId,
    menuSearch,
    menuValues,
    menuExcluded,
    menuSortDir,
    activeFilterColIds,
    hasColumnSort: sort !== null,
    handleHeaderMenuClick,
    closeMenu,
    onMenuSearchChange,
    onToggleValue,
    onClear,
    onDeselectAll,
    onSort,
    onSortReset,
    applyFilters,
    applySort,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
