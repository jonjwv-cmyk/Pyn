import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  type DataEditorRef,
  type GridSelection,
  type Rectangle,
} from '@glideapps/glide-data-grid';
import type { FlowSearchGroup } from './FlowSearchPanel';

/**
 * Общий поисковый «движок» гридов «Потока» — ровно как в Формировании
 * (FlowSandboxGrid), вынесен в хук, чтобы Транспорт/План/Отчёт использовали ОДНУ
 * реализацию (юзер 2026-06-13: «поиск такой же как в формировании и везде»). Это
 * НЕ фильтр: строки не прячутся — совпадения подсвечиваются жёлтым, активное —
 * clay-рамкой, клик по результату перелетает к ячейке (highlightRegions + scrollTo).
 * Панель ввода — общий компонент FlowSearchPanel; здесь только логика.
 */

/** Лимит ПОКАЗЫВАЕМЫХ совпадений на колонку (полный счётчик считаем всё равно). */
export const SEARCH_CAP_PER_COL = 50;
/** Потолок ПОДСВЕЧИВАЕМЫХ совпадений в гриде (защита от тысяч регионов). */
export const SEARCH_HL_CAP = 4000;
/** Жёлтая подсветка совпадений (как «найти» в браузере). */
export const SEARCH_HL_COLOR = 'rgba(250, 204, 21, 0.40)';
/** Активное (к которому перешли) — clay-заливка + сплошная рамка. */
export const SEARCH_ACTIVE_COLOR = 'rgba(217, 119, 87, 0.45)';
/** Буфер строк выше/ниже видимой зоны для подсветки («не вижу — не гружу» + запас). */
export const SEARCH_HL_BUFFER = 150;

/** Регион подсветки в формате glide highlightRegions. */
export interface FlowHighlightRegion {
  color: string;
  range: { x: number; y: number; width: number; height: number };
  style: 'no-outline' | 'solid' | 'dashed';
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (const ch of glob) {
    if (ch === '*') out += '.*';
    else if (/[.+?^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * Матчер с `*`-синтаксисом (юзер 2026-06-04): БЕЗ `*` — СОДЕРЖИТ (по умолчанию);
 * `42*` — начинается; `*42` — заканчивается; `*42*` — ТОЧНОЕ совпадение. null = пусто.
 */
export function makeSearchMatcher(rawQuery: string): ((value: string) => boolean) | null {
  const q = rawQuery.trim();
  if (q === '') return null;
  const lead = q.startsWith('*');
  const tail = q.endsWith('*');
  const core = q.replace(/^\*+/, '').replace(/\*+$/, '');
  if (core === '') return () => true; // запрос из одних `*`
  if (core.includes('*')) {
    const re = globToRegExp(q);
    return (value) => re.test(value);
  }
  const lc = core.toLowerCase();
  if (lead && tail) return (value) => value.toLowerCase() === lc; // *x* — точное
  if (tail) return (value) => value.toLowerCase().startsWith(lc); // x* — начинается
  if (lead) return (value) => value.toLowerCase().endsWith(lc); // *x — заканчивается
  return (value) => value.toLowerCase().includes(lc); // x — содержит
}

/** Колонка для поиска: id (ключ значения), заголовок, число ли (для замены). */
export interface FlowSearchColumn {
  id: string;
  title: string;
  isNumber?: boolean;
}

export interface FlowGridSearch {
  open: boolean;
  setOpen: (o: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  groups: FlowSearchGroup[];
  totalMatches: number;
  activeMatch: { colIndex: number; id: number } | null;
  dimmed: boolean;
  replaceResult: number | null;
  /** Регионы для DataEditor.highlightRegions (жёлтые совпадения + активное). */
  highlightRegions: FlowHighlightRegion[];
  /** Передать в DataEditor.onVisibleRegionChanged (подсветка следует за прокруткой). */
  onVisibleRegionChanged: (range: Rectangle) => void;
  /** ⌘F/Esc — вызвать из onKeyDown грида; вернёт true, если событие обработано. */
  handleKey: (e: { key: string; ctrlKey: boolean; metaKey: boolean; cancel: () => void }) => boolean;
  goToMatch: (colIndex: number, id: number) => void;
  replaceAll: (replacement: string) => void;
  /** Колбэки для FlowSearchPanel (сброс dimmed/result при вводе/открытии). */
  onOpenChange: (o: boolean) => void;
  onQueryChange: (q: string) => void;
}

/**
 * Хук поиска для одного грида. `rows` — вся база (для групп/замены), `viewRows` —
 * показ (для подсветки/перелёта). `getRaw` — сырое значение ячейки для матча;
 * `getDisplay` — как показать совпадение в панели. `applyReplace` (опц.) — применить
 * замену через edit-конвейер грида; без него «Заменить» в панели скрыт.
 */
export function useFlowGridSearch<TRow extends { id: number }>(args: {
  columns: FlowSearchColumn[];
  rows: TRow[];
  viewRows: TRow[];
  gridRef: React.RefObject<DataEditorRef | null>;
  getRaw: (row: TRow, colId: string) => string;
  getDisplay: (col: FlowSearchColumn, row: TRow) => string;
  setSelection?: (sel: GridSelection) => void;
  applyReplace?: (edits: { id: number; colId: string; value: string }[]) => void;
}): FlowGridSearch {
  const { columns, rows, viewRows, gridRef, getRaw, getDisplay, setSelection, applyReplace } = args;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState<{ colIndex: number; id: number } | null>(null);
  const [dimmed, setDimmed] = useState(false);
  const [replaceResult, setReplaceResult] = useState<number | null>(null);

  const openRef = useRef(open);
  openRef.current = open;
  const visibleRef = useRef<{ start: number; end: number }>({ start: 0, end: 80 });
  const [visibleWindow, setVisibleWindow] = useState<{ start: number; end: number }>({ start: 0, end: 80 });

  const matcher = useMemo(() => makeSearchMatcher(query), [query]);

  // Группы результатов ПО КОЛОНКАМ (по всей базе rows). Показ усечён до лимита.
  const groups = useMemo<FlowSearchGroup[]>(() => {
    if (!matcher) return [];
    const out: FlowSearchGroup[] = [];
    columns.forEach((col, colIndex) => {
      const matches: { id: number; value: string }[] = [];
      let total = 0;
      for (const row of rows) {
        if (matcher(getRaw(row, col.id))) {
          total++;
          if (matches.length < SEARCH_CAP_PER_COL) matches.push({ id: row.id, value: getDisplay(col, row) });
        }
      }
      if (total > 0) out.push({ colIndex, title: col.title, matches, total });
    });
    return out;
  }, [matcher, rows, columns, getRaw, getDisplay]);

  const totalMatches = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);

  // id строки → индекс показа (порядок показа ≠ данных).
  const idToViewRow = useMemo(() => {
    const m = new Map<number, number>();
    for (let i = 0; i < viewRows.length; i++) {
      const vr = viewRows[i];
      if (vr) m.set(vr.id, i);
    }
    return m;
  }, [viewRows]);

  // Жёлтая подсветка — только в видимой зоне ± буфер (за прокруткой). Скрытые строки нет.
  const matchRegions = useMemo<FlowHighlightRegion[]>(() => {
    if (!open || !matcher) return [];
    const from = Math.max(0, visibleWindow.start - SEARCH_HL_BUFFER);
    const to = Math.min(viewRows.length, visibleWindow.end + SEARCH_HL_BUFFER);
    const o: FlowHighlightRegion[] = [];
    for (let r = from; r < to && o.length < SEARCH_HL_CAP; r++) {
      const vr = viewRows[r];
      if (!vr) continue;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        if (col && matcher(getRaw(vr, col.id))) {
          o.push({ color: SEARCH_HL_COLOR, range: { x: c, y: r, width: 1, height: 1 }, style: 'no-outline' });
          if (o.length >= SEARCH_HL_CAP) break;
        }
      }
    }
    return o;
  }, [open, matcher, viewRows, visibleWindow, columns, getRaw]);

  const activeRegion = useMemo<FlowHighlightRegion | null>(() => {
    if (!open || !activeMatch) return null;
    const vr = idToViewRow.get(activeMatch.id);
    if (vr === undefined) return null;
    return {
      color: SEARCH_ACTIVE_COLOR,
      range: { x: activeMatch.colIndex, y: vr, width: 1, height: 1 },
      style: 'solid',
    };
  }, [open, activeMatch, idToViewRow]);

  const highlightRegions = useMemo<FlowHighlightRegion[]>(
    () => [...matchRegions, ...(activeRegion ? [activeRegion] : [])],
    [matchRegions, activeRegion],
  );

  const onVisibleRegionChanged = useCallback((range: Rectangle) => {
    visibleRef.current = { start: range.y, end: range.y + range.height };
    if (!openRef.current) return;
    setVisibleWindow((prev) =>
      Math.abs(prev.start - range.y) >= 8 ? { start: range.y, end: range.y + range.height } : prev,
    );
  }, []);

  // При открытии — синхронизируем окно подсветки с текущей зоной видимости.
  useEffect(() => {
    if (open) setVisibleWindow(visibleRef.current);
  }, [open]);

  // Клик по совпадению: перелёт scrollTo (повтор на след. кадрах — точное приземление
  // к дальним строкам с первого клика). Метку даёт активный clay-регион (не зависит от фокуса).
  const goToMatch = useCallback(
    (colIndex: number, id: number) => {
      const vr = idToViewRow.get(id);
      if (vr === undefined) return;
      const fly = (): void => {
        gridRef.current?.scrollTo(colIndex, vr, 'both', 0, 0, { hAlign: 'center', vAlign: 'center' });
      };
      fly();
      setSelection?.({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: { cell: [colIndex, vr], range: { x: colIndex, y: vr, width: 1, height: 1 }, rangeStack: [] },
      });
      setActiveMatch({ colIndex, id });
      setDimmed(true); // перелетели — окно гаснет, чтобы не перекрывать результат
      requestAnimationFrame(() => {
        fly();
        requestAnimationFrame(fly);
      });
    },
    [idToViewRow, gridRef, setSelection],
  );

  // Заменить значение во ВСЕХ найденных ячейках на новое — целиком, через конвейер грида.
  const replaceAll = useCallback(
    (replacement: string) => {
      if (!matcher || !applyReplace) {
        setReplaceResult(0);
        return;
      }
      const edits: { id: number; colId: string; value: string }[] = [];
      for (const row of rows) {
        for (const col of columns) {
          if (!matcher(getRaw(row, col.id))) continue;
          if (col.isNumber && !Number.isFinite(Number(replacement.replace(',', '.')))) continue;
          edits.push({ id: row.id, colId: col.id, value: replacement });
        }
      }
      if (edits.length > 0) {
        applyReplace(edits);
        setActiveMatch(null);
      }
      setReplaceResult(edits.length);
    },
    [matcher, rows, columns, getRaw, applyReplace],
  );

  const handleKey = useCallback(
    (e: { key: string; ctrlKey: boolean; metaKey: boolean; cancel: () => void }): boolean => {
      if (e.key === 'Escape') {
        if (openRef.current) {
          setOpen(false);
          return true;
        }
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.cancel();
        setOpen(true);
        return true;
      }
      return false;
    },
    [],
  );

  const onOpenChange = useCallback((o: boolean) => {
    setOpen(o);
    if (o) {
      setDimmed(false);
      setReplaceResult(null);
    }
  }, []);

  const onQueryChange = useCallback((q: string) => {
    setQuery(q);
    setActiveMatch(null);
    setDimmed(false);
    setReplaceResult(null);
  }, []);

  return {
    open,
    setOpen,
    query,
    setQuery,
    groups,
    totalMatches,
    activeMatch,
    dimmed,
    replaceResult,
    highlightRegions,
    onVisibleRegionChanged,
    handleKey,
    goToMatch,
    replaceAll,
    onOpenChange,
    onQueryChange,
  };
}
