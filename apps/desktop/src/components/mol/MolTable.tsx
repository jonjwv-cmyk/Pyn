import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy as CopyIcon, Search, SlidersHorizontal, X } from 'lucide-react';
import type { MolRecord, ParsedMolQuery } from '@pyn/core';
import { cn } from '@/lib/cn';
import {
  formatMobilePhone,
  molStatusKind,
  splitAndFormatWorkPhones,
} from '@/lib/mol-format';
import { useUiStateStore } from '@/lib/stores';
import { ScrollToBottomButton } from '@/components/ui/ScrollToBottomButton';
import type { ContactActionRequest } from './ContactActionDialog';

interface MolTableProps {
  records: MolRecord[];
  hasSidebar: boolean;
  onContactAction: (req: ContactActionRequest) => void;
  persistScrollKey: string;
  /** Главный поиск (из MolTopBar) — для подсветки найденного в ячейках. */
  searchQuery?: ParsedMolQuery;
}

/**
 * §pyn-1.2.24 — таблица МОЛ. 5 колонок (как и раньше):
 *   № | ФИО (+должность) | Телефоны | E-mail | Статус (+таб.)
 *
 * Каждый header (кроме №) — кликабельный chip + ChevronDown. Клик открывает
 * Popover с:
 *   - Sort buttons (asc/desc/reset) сверху одной строкой
 *   - Search input (substring filter)
 *   - Scroll list уникальных значений с галочками (Excel-style)
 * Юзер: «название колонки нажимаешь и там строка поиска и список ниже где
 * можно галочками выбирать а рядом сортировка. чтобы одна строка была а то
 * строка поиска строка сортировки по колонке все отдельно».
 *
 * Excel-like cell selection (rectangle drag) + Cmd/Ctrl+A + Cmd/Ctrl+C → TSV.
 * Cursor над ячейками — обычная стрелка (раньше `cursor-cell` показывал
 * белый «плюс», который не вписывался в тему).
 */

type SortKey = 'fio' | 'mobile' | 'mail' | 'status' | null;
type SortDir = 'asc' | 'desc';
type FilterKey = 'fio' | 'phone' | 'mail' | 'status';

interface ColFilter {
  /** Substring-фильтр (по тексту ячейки). */
  search: string;
  /** Выбранные точные значения (Excel-style). null = все. */
  selected: Set<string> | null;
}

const EMPTY_FILTER: ColFilter = { search: '', selected: null };
const EMPTY_FILTERS: Record<FilterKey, ColFilter> = {
  fio: EMPTY_FILTER,
  phone: EMPTY_FILTER,
  mail: EMPTY_FILTER,
  status: EMPTY_FILTER,
};

interface CellRect {
  sr: number; sc: number; er: number; ec: number;
}

const COL_COUNT = 5;

export function MolTable({
  records,
  hasSidebar,
  onContactAction,
  persistScrollKey,
  searchQuery,
}: MolTableProps) {
  const { t } = useTranslation();
  const tableRef = useRef<HTMLTableElement>(null);
  // §copy-fix — фокусируемый контейнер сетки. mousedown по ячейке делает
  // preventDefault (чтобы не было нативного text-select), из-за чего фокус
  // оставался на поле поиска → Cmd+C считался «в инпуте» и копирование молча
  // не срабатывало. Явно фокусируем сетку при выделении → activeElement = div.
  const gridRef = useRef<HTMLDivElement>(null);
  // §copy-flash — после успешного копирования на ~1.4с делаем рамку выделения
  // пунктирной = визуальное подтверждение «скопировано».
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCopied = useCallback(() => {
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }, []);
  // Чистка таймера на unmount (сброс при смене выделения — ниже, после selection).
  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const molScrollTop = useUiStateStore((s) => s.molScrollTop);
  const setMolScrollTop = useUiStateStore((s) => s.setMolScrollTop);
  const [uiHydrated, setUiHydrated] = useState(() => useUiStateStore.persist.hasHydrated());
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScrollRef = useRef<number>(-1);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filters, setFilters] = useState<Record<FilterKey, ColFilter>>(EMPTY_FILTERS);

  const [selection, setSelection] = useState<CellRect | null>(null);
  const dragModeRef = useRef<'cell' | 'column' | 'row' | null>(null);
  const [nativeEditCell, setNativeEditCell] = useState<{ r: number; c: number } | null>(null);
  // §pyn-1.2.32 — refs на все cells для позиционирования overlay (один div
  // с border + glow вокруг всего range, без per-cell shadow → нет странных
  // вертикальных линий внутри selection).
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const setCellRef = useCallback((r: number, c: number) => (el: HTMLTableCellElement | null) => {
    const key = `${r}-${c}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  // §pyn-1.2.25 — диалог опций при Ctrl+C если в selection попала колонка
  // ФИО (где есть должность) или Статус (где есть табельный). Юзер выбирает
  // включать ли поля. Default — off (чистые основные значения).
  const [copyDialog, setCopyDialog] = useState<{ rect: CellRect } | null>(null);
  const [includePosition, setIncludePosition] = useState(false);
  const [includeTab, setIncludeTab] = useState(false);

  const hasAnyFilter = useMemo(
    () => Object.values(filters).some((f) => f.search.trim().length > 0 || f.selected !== null),
    [filters],
  );

  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    if (uiHydrated) return;
    const unsub = useUiStateStore.persist.onFinishHydration(() => setUiHydrated(true));
    return unsub;
  }, [uiHydrated]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!uiHydrated || records.length === 0 || restoredRef.current) return;
    const saved = molScrollTop;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved;
      lastSavedScrollRef.current = saved;
      restoredRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiHydrated, records.length === 0, persistScrollKey]);

  useEffect(() => {
    restoredRef.current = false;
    lastSavedScrollRef.current = -1;
  }, [persistScrollKey]);

  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSelection(null);
    setNativeEditCell(null);
    setSortKey(null);
  }, [persistScrollKey]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 64);

    if (!uiHydrated || !restoredRef.current) return;
    const current = el.scrollTop;
    if (Math.abs(current - lastSavedScrollRef.current) < 8) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedScrollRef.current = current;
      setMolScrollTop(current);
    }, 250);
  };

  useEffect(() => {
    handleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]);

  // Apply filters + sort
  const visibleRecords = useMemo(() => {
    let out = records;
    if (hasAnyFilter) {
      out = out.filter((r) => {
        // FIO
        const f = filters.fio;
        if (f.search.trim()) {
          const q = f.search.toLowerCase();
          if (!r.fio.toLowerCase().includes(q) && !r.position.toLowerCase().includes(q)) return false;
        }
        if (f.selected && !f.selected.has(r.fio)) return false;

        // Phone
        const fp = filters.phone;
        if (fp.search.trim()) {
          const q = fp.search.replace(/\D/g, '');
          if (!q) return false;
          const m = r.mobile.replace(/\D/g, '');
          const w = r.work.replace(/\D/g, '');
          if (!m.includes(q) && !w.includes(q)) return false;
        }
        if (fp.selected && !fp.selected.has(r.mobile || r.work)) return false;

        // Mail
        const fm = filters.mail;
        if (fm.search.trim()) {
          if (!r.mail.toLowerCase().includes(fm.search.toLowerCase())) return false;
        }
        if (fm.selected && !fm.selected.has(r.mail)) return false;

        // Status (search ищет и в статусе, и в табельном)
        const fs = filters.status;
        if (fs.search.trim()) {
          const q = fs.search.toLowerCase();
          if (!r.status.toLowerCase().includes(q) && !r.tab.toLowerCase().includes(q)) return false;
        }
        if (fs.selected && !fs.selected.has(r.status)) return false;

        return true;
      });
    }
    if (sortKey) {
      const sign = sortDir === 'asc' ? 1 : -1;
      out = out.slice().sort((a, b) => {
        const va = pickSortValue(a, sortKey);
        const vb = pickSortValue(b, sortKey);
        return va.localeCompare(vb, 'ru', { numeric: true }) * sign;
      });
    }
    return out;
  }, [records, filters, hasAnyFilter, sortKey, sortDir]);

  // Unique значений для checkbox-списка — собираем из всех `records` (не из
  // visibleRecords), чтобы юзер видел все варианты независимо от текущего
  // выбора.
  const uniqueValues = useMemo(() => {
    const fio = new Set<string>();
    const phone = new Set<string>();
    const mail = new Set<string>();
    const status = new Set<string>();
    for (const r of records) {
      if (r.fio) fio.add(r.fio);
      const p = r.mobile || r.work;
      if (p) phone.add(p);
      if (r.mail) mail.add(r.mail);
      if (r.status) status.add(r.status);
    }
    return {
      fio: Array.from(fio).sort((a, b) => a.localeCompare(b, 'ru')),
      phone: Array.from(phone).sort((a, b) => a.localeCompare(b, 'ru')),
      mail: Array.from(mail).sort((a, b) => a.localeCompare(b, 'ru')),
      status: Array.from(status).sort((a, b) => a.localeCompare(b, 'ru')),
    };
  }, [records]);

  const cycleSort = (key: NonNullable<SortKey>, dir?: SortDir): void => {
    if (dir) {
      setSortKey(key);
      setSortDir(dir);
      return;
    }
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
      return;
    }
    if (sortDir === 'asc') {
      setSortDir('desc');
      return;
    }
    setSortKey(null);
    setSortDir('asc');
  };

  const updateFilter = (key: FilterKey, patch: Partial<ColFilter>): void => {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const clearAllFilters = (): void => {
    setFilters(EMPTY_FILTERS);
    setSortKey(null);
  };

  // Global mouseup завершает drag (любого типа).
  useEffect(() => {
    const up = () => {
      dragModeRef.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // §pyn-1.2.32 — снять выделение при клике где угодно, кроме selectable
  // cells/headers/№/popover/dialog. Юзер: «выделил и щёлкнул где угодно
  // выделение уходит». Внутри scroll, клик на blank space (не на cell) —
  // тоже clear. Cells/headers/№ помечены атрибутом data-mol-selectable;
  // их собственные handlers решают toggle/replace в логике mousedown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('[role="dialog"]')
        || target.closest('[data-radix-popper-content-wrapper]')
        || target.closest('[data-mol-selectable="1"]')
      ) return;
      setSelection(null);
      setNativeEditCell(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null;
        const inInput = !!active && (
          active.tagName === 'INPUT'
          || active.tagName === 'TEXTAREA'
          || active.isContentEditable
        );
        if (inInput) return;
        setSelection(null);
        setNativeEditCell(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // §pyn-1.2.26 — keydown handler для Cmd/Ctrl+A и Cmd/Ctrl+C.
  // Раньше пробовал `copy` event — он НЕ срабатывает на Mac когда native
  // selection пустая (`user-select: none` на tbody). keydown работает
  // всегда. Для C → пишем в clipboard через navigator.clipboard.writeText
  // (Electron не требует permission, работает синхронно после user-gesture).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const active = document.activeElement as HTMLElement | null;
      const inInput = !!active && (
        active.tagName === 'INPUT'
        || active.tagName === 'TEXTAREA'
        || active.isContentEditable
      );
      if (inInput) return;
      // §pyn-1.2.23 — раньше `e.key.toLowerCase()`. На Win с русской раскладкой
      // Ctrl+C даёт `e.key === 'с'` (кириллица) → handler skip. `e.code` —
      // physical key (`KeyA`/`KeyC`), не зависит от раскладки.
      const code = e.code;

      if (code === 'KeyA') {
        if (visibleRecords.length === 0) return;
        e.preventDefault();
        setSelection({ sr: 0, sc: 0, er: visibleRecords.length - 1, ec: COL_COUNT - 1 });
        window.getSelection()?.removeAllRanges();
        return;
      }

      if (code === 'KeyC') {
        if (!selection) return;
        if (nativeEditCell) return; // native edit → пусть браузер сам копирует текст
        e.preventDefault();
        // Очищаем native selection чтобы default copy ничего лишнего не взял.
        window.getSelection()?.removeAllRanges();

        const minC = Math.min(selection.sc, selection.ec);
        const maxC = Math.max(selection.sc, selection.ec);
        const hasNameCol = minC <= 1 && maxC >= 1;
        const hasStatusCol = minC <= 4 && maxC >= 4;

        if (hasNameCol || hasStatusCol) {
          setCopyDialog({ rect: selection });
          return;
        }

        const tsv = buildTsvFromRect(visibleRecords, selection, {
          includePosition: false, includeTab: false,
        });
        if (!tsv) return;
        void copyTsv(tsv).then((ok) => { if (ok) flashCopied(); });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visibleRecords, selection, nativeEditCell, flashCopied]);

  const handleCellMouseDown = useCallback((r: number, c: number) => (ev: React.MouseEvent) => {
    const target = ev.target as HTMLElement;
    if (target.closest('button')) return;
    if (nativeEditCell && nativeEditCell.r === r && nativeEditCell.c === c) return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    setNativeEditCell(null);
    window.getSelection()?.removeAllRanges();
    if (ev.shiftKey && selection) {
      setSelection({ sr: selection.sr, sc: selection.sc, er: r, ec: c });
      dragModeRef.current = 'cell';
      return;
    }
    // §pyn-1.2.32 — toggle: если cell уже в selection → snyatie. Иначе new.
    if (selection) {
      const minR = Math.min(selection.sr, selection.er);
      const maxR = Math.max(selection.sr, selection.er);
      const minC = Math.min(selection.sc, selection.ec);
      const maxC = Math.max(selection.sc, selection.ec);
      if (r >= minR && r <= maxR && c >= minC && c <= maxC) {
        setSelection(null);
        return;
      }
    }
    setSelection({ sr: r, sc: c, er: r, ec: c });
    dragModeRef.current = 'cell';
  }, [selection, nativeEditCell]);

  const handleCellMouseEnter = useCallback((r: number, c: number) => () => {
    if (dragModeRef.current !== 'cell') return;
    setSelection((prev) => prev ? { ...prev, er: r, ec: c } : { sr: r, sc: c, er: r, ec: c });
  }, []);

  const handleCellDoubleClick = useCallback((r: number, c: number) => () => {
    setNativeEditCell({ r, c });
    setSelection(null);
  }, []);

  // §pyn-1.2.28 — клик на header «зону» (не на chip-кнопку) → select column.
  // Drag по headers → multi-column selection. Linear/Figma-style.
  const lastRowIdx = Math.max(0, visibleRecords.length - 1);
  const handleColumnSelectMouseDown = useCallback((c: number) => (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    setNativeEditCell(null);
    window.getSelection()?.removeAllRanges();
    if (ev.shiftKey && selection) {
      setSelection({ sr: 0, sc: selection.sc, er: lastRowIdx, ec: c });
      dragModeRef.current = 'column';
      return;
    }
    // §pyn-1.2.32 — toggle: если эта column уже выделена single column →
    // snyatie. Иначе new.
    if (selection) {
      const minC = Math.min(selection.sc, selection.ec);
      const maxC = Math.max(selection.sc, selection.ec);
      const minR = Math.min(selection.sr, selection.er);
      const maxR = Math.max(selection.sr, selection.er);
      const isThisColumnOnly = minC === c && maxC === c && minR === 0 && maxR === lastRowIdx;
      if (isThisColumnOnly) {
        setSelection(null);
        return;
      }
    }
    setSelection({ sr: 0, sc: c, er: lastRowIdx, ec: c });
    dragModeRef.current = 'column';
  }, [selection, lastRowIdx]);

  const handleColumnSelectMouseEnter = useCallback((c: number) => () => {
    if (dragModeRef.current !== 'column') return;
    setSelection((prev) => prev ? { ...prev, ec: c, er: lastRowIdx } : { sr: 0, sc: c, er: lastRowIdx, ec: c });
  }, [lastRowIdx]);

  // §pyn-1.2.28 — клик на № (первая колонка) → select row. Drag → multi-row.
  const handleRowSelectMouseDown = useCallback((r: number) => (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    setNativeEditCell(null);
    window.getSelection()?.removeAllRanges();
    if (ev.shiftKey && selection) {
      setSelection({ sr: selection.sr, sc: 0, er: r, ec: COL_COUNT - 1 });
      dragModeRef.current = 'row';
      return;
    }
    // §pyn-1.2.32 — toggle: если эта row уже выделена single → snyatie.
    if (selection) {
      const minR = Math.min(selection.sr, selection.er);
      const maxR = Math.max(selection.sr, selection.er);
      const minC = Math.min(selection.sc, selection.ec);
      const maxC = Math.max(selection.sc, selection.ec);
      const isThisRowOnly = minR === r && maxR === r && minC === 0 && maxC === COL_COUNT - 1;
      if (isThisRowOnly) {
        setSelection(null);
        return;
      }
    }
    setSelection({ sr: r, sc: 0, er: r, ec: COL_COUNT - 1 });
    dragModeRef.current = 'row';
  }, [selection]);

  const handleRowSelectMouseEnter = useCallback((r: number) => () => {
    if (dragModeRef.current !== 'row') return;
    setSelection((prev) => prev ? { ...prev, er: r, ec: COL_COUNT - 1 } : { sr: r, sc: 0, er: r, ec: COL_COUNT - 1 });
  }, []);

  // §pyn-1.2.30 — normalized bounds + edge detection per cell.
  // Linear-style: outline только по краям area selection (а не per cell ring).
  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    return {
      minR: Math.min(selection.sr, selection.er),
      maxR: Math.max(selection.sr, selection.er),
      minC: Math.min(selection.sc, selection.ec),
      maxC: Math.max(selection.sc, selection.ec),
    };
  }, [selection]);

  // §copy-flash — подтверждение «скопировано» сбрасываем при смене выделения.
  useEffect(() => { setCopied(false); }, [selection]);

  const isCellSelected = useCallback((r: number, c: number): boolean => {
    if (!selectionBounds) return false;
    return r >= selectionBounds.minR && r <= selectionBounds.maxR
      && c >= selectionBounds.minC && c <= selectionBounds.maxC;
  }, [selectionBounds]);

  // §pyn-1.2.28-29 — индикаторы выделения column header / row number.
  // Особый случай: Cmd+A (full rectangle 0..last × 0..COL_COUNT-1) — это
  // «select all», не должно подсвечивать сразу все headers + все № — иначе
  // вся таблица в accent цвете. Detect "full selection" и пропускаем визуал.
  const isFullSelection = useMemo(() => {
    if (!selection) return false;
    const minR = Math.min(selection.sr, selection.er);
    const maxR = Math.max(selection.sr, selection.er);
    const minC = Math.min(selection.sc, selection.ec);
    const maxC = Math.max(selection.sc, selection.ec);
    return minR === 0 && maxR === lastRowIdx
      && minC === 0 && maxC === COL_COUNT - 1;
  }, [selection, lastRowIdx]);

  const isColumnSelected = useCallback((c: number): boolean => {
    if (!selection || isFullSelection) return false;
    const minC = Math.min(selection.sc, selection.ec);
    const maxC = Math.max(selection.sc, selection.ec);
    if (c < minC || c > maxC) return false;
    const minR = Math.min(selection.sr, selection.er);
    const maxR = Math.max(selection.sr, selection.er);
    return minR === 0 && maxR === lastRowIdx;
  }, [selection, lastRowIdx, isFullSelection]);

  const isRowSelected = useCallback((r: number): boolean => {
    if (!selection || isFullSelection) return false;
    const minR = Math.min(selection.sr, selection.er);
    const maxR = Math.max(selection.sr, selection.er);
    if (r < minR || r > maxR) return false;
    const minC = Math.min(selection.sc, selection.ec);
    const maxC = Math.max(selection.sc, selection.ec);
    return minC === 0 && maxC === COL_COUNT - 1;
  }, [selection, isFullSelection]);

  return (
    <div ref={gridRef} tabIndex={-1} className="relative flex flex-1 flex-col overflow-hidden outline-none">
      <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="mol-scroll flex-1 overflow-y-auto pb-2"
      >
        <div ref={tableWrapperRef} className="relative">
        <table
          ref={tableRef}
          className="w-full table-fixed border-separate border-spacing-0 text-[12px]"
        >
          {hasSidebar ? (
            <colgroup>
              <col className="w-[5%]" />
              <col className="w-[28%]" />
              <col className="w-[17%]" />
              <col className="w-[36%]" />
              <col className="w-[14%]" />
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[25%]" />
              <col className="w-[15%]" />
              <col className="w-[44%]" />
              <col className="w-[12%]" />
            </colgroup>
          )}
          <thead className="select-none sticky top-0 z-10 bg-bg-surface">
            <tr className="text-center text-[10.5px] uppercase tracking-wider text-text-muted">
              <ThClearAll show={hasAnyFilter} onClear={clearAllFilters} ariaLabel={t('mol.clear_column_filters')} />
              <ThColumn
                colIndex={1}
                label={t('mol.fio')}
                sortActive={sortKey === 'fio'}
                sortDir={sortDir}
                onSort={(d) => cycleSort('fio', d)}
                onSortReset={() => { if (sortKey === 'fio') setSortKey(null); }}
                filter={filters.fio}
                uniqueValues={uniqueValues.fio}
                onFilterChange={(p) => updateFilter('fio', p)}
                searchPlaceholder={t('mol.col_filter.fio')}
                selected={isColumnSelected(1)}
                onSelectMouseDown={handleColumnSelectMouseDown(1)}
                onSelectMouseEnter={handleColumnSelectMouseEnter(1)}
              />
              <ThColumn
                colIndex={2}
                label={t('mol.phones')}
                sortActive={sortKey === 'mobile'}
                sortDir={sortDir}
                onSort={(d) => cycleSort('mobile', d)}
                onSortReset={() => { if (sortKey === 'mobile') setSortKey(null); }}
                filter={filters.phone}
                uniqueValues={uniqueValues.phone}
                onFilterChange={(p) => updateFilter('phone', p)}
                searchPlaceholder={t('mol.col_filter.phone')}
                selected={isColumnSelected(2)}
                onSelectMouseDown={handleColumnSelectMouseDown(2)}
                onSelectMouseEnter={handleColumnSelectMouseEnter(2)}
              />
              <ThColumn
                colIndex={3}
                label="E-mail"
                sortActive={sortKey === 'mail'}
                sortDir={sortDir}
                onSort={(d) => cycleSort('mail', d)}
                onSortReset={() => { if (sortKey === 'mail') setSortKey(null); }}
                filter={filters.mail}
                uniqueValues={uniqueValues.mail}
                onFilterChange={(p) => updateFilter('mail', p)}
                searchPlaceholder={t('mol.col_filter.mail')}
                selected={isColumnSelected(3)}
                onSelectMouseDown={handleColumnSelectMouseDown(3)}
                onSelectMouseEnter={handleColumnSelectMouseEnter(3)}
              />
              <ThColumn
                colIndex={4}
                label={t('mol.status')}
                sortActive={sortKey === 'status'}
                sortDir={sortDir}
                onSort={(d) => cycleSort('status', d)}
                onSortReset={() => { if (sortKey === 'status') setSortKey(null); }}
                filter={filters.status}
                uniqueValues={uniqueValues.status}
                onFilterChange={(p) => updateFilter('status', p)}
                searchPlaceholder={t('mol.col_filter.status_tab')}
                selected={isColumnSelected(4)}
                onSelectMouseDown={handleColumnSelectMouseDown(4)}
                onSelectMouseEnter={handleColumnSelectMouseEnter(4)}
              />
            </tr>
          </thead>
          <tbody className="select-none">
            {visibleRecords.length === 0 && hasAnyFilter && (
              <tr>
                <td colSpan={COL_COUNT} className="px-2 py-6 text-center text-[12px] text-text-muted">
                  {t('mol.no_matches_after_filter')}
                </td>
              </tr>
            )}
            {visibleRecords.map((r, idx) => (
              <MolRow
                key={`${r.remoteId}-${r.warehouseId}-${idx}`}
                record={r}
                index={idx}
                search={searchQuery}
                onContactAction={onContactAction}
                onCellMouseDown={handleCellMouseDown}
                onCellMouseEnter={handleCellMouseEnter}
                onCellDoubleClick={handleCellDoubleClick}
                isCellSelected={isCellSelected}
                selectionBounds={selectionBounds}
                rowSelected={isRowSelected(idx)}
                onRowSelectMouseDown={handleRowSelectMouseDown(idx)}
                onRowSelectMouseEnter={handleRowSelectMouseEnter(idx)}
                nativeEditCell={nativeEditCell}
                setCellRef={setCellRef}
              />
            ))}
          </tbody>
        </table>
        {selectionBounds && !isFullSelection && (
          <SelectionOverlay
            wrapperRef={tableWrapperRef}
            cellRefs={cellRefs}
            bounds={selectionBounds}
            visibleRecordsCount={visibleRecords.length}
            copied={copied}
          />
        )}
        </div>
      </div>

      {copyDialog && (
        <CopyOptionsDialog
          rect={copyDialog.rect}
          includePosition={includePosition}
          includeTab={includeTab}
          setIncludePosition={setIncludePosition}
          setIncludeTab={setIncludeTab}
          onCancel={() => setCopyDialog(null)}
          onConfirm={() => {
            const tsv = buildTsvFromRect(visibleRecords, copyDialog.rect, {
              includePosition,
              includeTab,
            });
            if (tsv) void copyTsv(tsv).then((ok) => { if (ok) flashCopied(); });
            setCopyDialog(null);
          }}
        />
      )}
    </div>
  );
}

function CopyOptionsDialog({
  rect,
  includePosition,
  includeTab,
  setIncludePosition,
  setIncludeTab,
  onCancel,
  onConfirm,
}: {
  rect: CellRect;
  includePosition: boolean;
  includeTab: boolean;
  setIncludePosition: (v: boolean) => void;
  setIncludeTab: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const minC = Math.min(rect.sc, rect.ec);
  const maxC = Math.max(rect.sc, rect.ec);
  const hasNameCol = minC <= 1 && maxC >= 1;
  const hasStatusCol = minC <= 4 && maxC >= 4;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-clay-bg text-accent-clay">
              <CopyIcon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <Dialog.Title className="text-[14px] font-semibold text-text-strong">
              {t('mol.copy_dialog.title')}
            </Dialog.Title>
          </div>

          <div className="flex flex-col gap-2">
            {hasNameCol && (
              <CopyOptCheckbox
                checked={includePosition}
                onChange={setIncludePosition}
                label={t('mol.copy_dialog.include_position')}
              />
            )}
            {hasStatusCol && (
              <CopyOptCheckbox
                checked={includeTab}
                onChange={setIncludeTab}
                label={t('mol.copy_dialog.include_tab')}
              />
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'text-text-secondary outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              autoFocus
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'outline-none transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {t('mol.copy_dialog.copy')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CopyOptCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-bg-hover">
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded',
          'border transition-colors',
          checked
            ? 'border-accent-clay bg-accent-clay text-white'
            : 'border-border-default bg-transparent',
        )}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-text-secondary">{label}</span>
    </label>
  );
}

/**
 * §pyn-1.2.32 — overlay div с outline + glow вокруг всего range selection.
 * Один div вместо per-cell box-shadow → нет странных вертикальных линий
 * внутри области selection. Figma/Linear-style: 1px sharp border + soft
 * outer glow.
 */
function SelectionOverlay({
  wrapperRef,
  cellRefs,
  bounds,
  visibleRecordsCount: _visibleRecordsCount,
  copied = false,
}: {
  wrapperRef: React.RefObject<HTMLDivElement>;
  cellRefs: React.MutableRefObject<Map<string, HTMLTableCellElement>>;
  bounds: SelectionBounds;
  visibleRecordsCount: number;
  /** true сразу после копирования → пунктирная рамка = «скопировано». */
  copied?: boolean;
}): JSX.Element | null {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const compute = (): void => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return setRect(null);
      const tl = cellRefs.current.get(`${bounds.minR}-${bounds.minC}`);
      const br = cellRefs.current.get(`${bounds.maxR}-${bounds.maxC}`);
      if (!tl || !br) return setRect(null);
      const wrapperRect = wrapper.getBoundingClientRect();
      const tlRect = tl.getBoundingClientRect();
      const brRect = br.getBoundingClientRect();
      setRect({
        top: tlRect.top - wrapperRect.top,
        left: tlRect.left - wrapperRect.left,
        width: brRect.right - tlRect.left,
        height: brRect.bottom - tlRect.top,
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [bounds, wrapperRef, cellRefs]);

  if (!rect) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        zIndex: 5,
        // §copy-flash — после копирования рамка становится пунктирной и ярче.
        border: copied
          ? '1px dashed rgba(217, 132, 87, 0.95)'
          : '1px solid rgba(217, 132, 87, 0.5)',
        borderRadius: 4,
        // §design — без заливки ячеек: тонкая рамка + рассеянное (feathered)
        // внутреннее свечение по краям выделения, центр чистый.
        boxShadow: copied
          ? 'inset 0 0 12px 1px rgba(217, 132, 87, 0.20), 0 0 4px 0 rgba(217, 132, 87, 0.18)'
          : 'inset 0 0 12px 1px rgba(217, 132, 87, 0.12), 0 0 3px 0 rgba(217, 132, 87, 0.10)',
      }}
    />
  );
}

function pickSortValue(r: MolRecord, key: NonNullable<SortKey>): string {
  switch (key) {
    case 'fio':    return r.fio.toLowerCase();
    case 'mobile': return r.mobile.replace(/\D/g, '') || r.mobile;
    case 'mail':   return r.mail.toLowerCase();
    case 'status': return r.status.toLowerCase();
  }
}

interface SelectionBounds {
  minR: number; maxR: number; minC: number; maxC: number;
}

interface RowProps {
  record: MolRecord;
  index: number;
  /** Главный поиск — подсветка найденного значения «пиллом». */
  search?: ParsedMolQuery;
  onContactAction: (req: ContactActionRequest) => void;
  onCellMouseDown: (r: number, c: number) => (ev: React.MouseEvent) => void;
  onCellMouseEnter: (r: number, c: number) => () => void;
  onCellDoubleClick: (r: number, c: number) => () => void;
  isCellSelected: (r: number, c: number) => boolean;
  selectionBounds: SelectionBounds | null;
  rowSelected: boolean;
  onRowSelectMouseDown: (ev: React.MouseEvent) => void;
  onRowSelectMouseEnter: () => void;
  nativeEditCell: { r: number; c: number } | null;
  setCellRef: (r: number, c: number) => (el: HTMLTableCellElement | null) => void;
}

function MolRow({
  record,
  index,
  search,
  onContactAction,
  onCellMouseDown,
  onCellMouseEnter,
  onCellDoubleClick,
  isCellSelected,
  selectionBounds: _selectionBounds,
  rowSelected,
  onRowSelectMouseDown,
  onRowSelectMouseEnter,
  nativeEditCell,
  setCellRef,
}: RowProps): JSX.Element {
  const { t } = useTranslation();
  const mobile = formatMobilePhone(record.mobile);
  const workPhones = splitAndFormatWorkPhones(record.work);

  // Подсветка найденного по режиму главного поиска: name → ФИО/должность/таб;
  // phone → телефоны/таб (по цифрам); email → почта.
  const mode = search?.mode;
  const sq = search?.tokens[0] ?? '';
  const nameQ = mode === 'name' ? sq : '';
  const phoneQ = mode === 'phone' ? sq : '';
  const emailQ = mode === 'email' ? sq : '';
  const tabQ = mode === 'phone' ? phoneQ : nameQ;
  const tabKind = mode === 'phone' ? 'digits' : 'text';

  // §design — список НЕ красим (ни зебры, ни заливки строк) — только тонкие
  // divider'ы + hover. Семантику несёт цвет ТЕКСТА статуса: «Работает» —
  // зелёный; «на больничном / в отпуске / уволен» (error) — красный;
  // без статуса — amber «—».
  const kind = molStatusKind(record.status);
  const hasStatus = record.status.trim().length > 0;
  const rowBg = 'hover:bg-bg-hover';
  const statusColor = !hasStatus
    ? 'text-amber-400'
    : kind === 'error'
      ? 'text-danger'
      : 'text-presence-online';

  const callMobile = () =>
    onContactAction({
      kind: 'call', target: record.mobile, display: mobile,
      contactName: record.fio || t('mol.contact_unknown'),
    });

  const callWork = (workDisplay: string) =>
    onContactAction({
      kind: 'call', target: workDisplay, display: workDisplay,
      contactName: t('mol.contact_work_suffix', {
        name: record.fio || t('mol.contact_unknown_short'),
      }),
    });

  const sendMail = () =>
    onContactAction({
      kind: 'mail', target: record.mail, display: record.mail,
      contactName: record.fio || t('mol.contact_unknown'),
    });

  // §pyn-1.2.32 — outline теперь через overlay div (один SelectionOverlay
  // на всю область). Per-cell — только bg fill (subtle accent tint).
  const cellProps = (c: number) => {
    const sel = isCellSelected(index, c);
    return {
      onMouseDown: onCellMouseDown(index, c),
      onMouseEnter: onCellMouseEnter(index, c),
      onDoubleClick: onCellDoubleClick(index, c),
      'data-selected': sel ? '1' : undefined,
      'data-native-edit': nativeEditCell?.r === index && nativeEditCell?.c === c ? '1' : undefined,
      'data-mol-selectable': '1' as const,
    };
  };

  return (
    <tr className={cn('group transition-colors', rowBg)}>
      {/* §pyn-1.2.28-29 — № row-header: клик/drag выделяет строку/строки.
          Linear-style: subtle bg + tonkий accent stripe слева для selected.
          № никогда НЕ копируется в clipboard (см. buildTsvFromRect). */}
      <td
        ref={setCellRef(index, 0)}
        data-mol-selectable="1"
        onMouseDown={onRowSelectMouseDown}
        onMouseEnter={onRowSelectMouseEnter}
        className={cn(
          'relative border-b border-border-subtle/25 px-2 py-1.5 align-middle text-center tabular-nums',
          'select-none cursor-default transition-colors',
          rowSelected
            ? 'bg-accent-clay/[0.10] font-medium text-accent-clay before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-accent-clay before:rounded-r-full'
            : 'text-text-muted hover:bg-bg-hover/50',
        )}
      >
        {index + 1}
      </td>

      <Td tdRef={setCellRef(index, 1)} {...cellProps(1)}>
        <div className="whitespace-normal break-words text-[13px] font-medium leading-snug text-text-strong">
          <SearchMark text={record.fio || '—'} query={nameQ} />
        </div>
        {record.position && (
          <div className="mt-0.5 whitespace-normal break-words text-[11px] leading-snug text-text-muted">
            <SearchMark text={record.position} query={nameQ} />
          </div>
        )}
      </Td>

      <Td className="tabular-nums" tdRef={setCellRef(index, 2)} {...cellProps(2)}>
        {mobile || workPhones.length > 0 ? (
          <div className="flex flex-col gap-0.5 leading-tight">
            {mobile && (
              <button
                type="button"
                onClick={callMobile}
                className="text-left whitespace-nowrap text-text-strong hover:text-accent-clay"
              >
                <SearchMark text={mobile} query={phoneQ} kind="digits" />
              </button>
            )}
            {workPhones.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => callWork(p)}
                className="text-left whitespace-nowrap text-[11px] text-text-muted hover:text-accent-clay"
              >
                <SearchMark text={p} query={phoneQ} kind="digits" />
              </button>
            ))}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      <Td tdRef={setCellRef(index, 3)} {...cellProps(3)}>
        {record.mail ? (
          <button
            type="button"
            onClick={sendMail}
            className="block text-left break-all leading-snug text-accent-clay hover:underline"
          >
            <SearchMark text={record.mail} query={emailQ} />
          </button>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      <Td tdRef={setCellRef(index, 4)} {...cellProps(4)}>
        <div
          className={cn(
            'whitespace-normal break-words text-[11.5px] font-medium leading-snug',
            statusColor,
          )}
        >
          {record.status || '—'}
        </div>
        {record.tab && (
          <div className="mt-0.5 text-[10.5px] tabular-nums text-text-muted">
            таб. <SearchMark text={record.tab} query={tabQ} kind={tabKind} />
          </div>
        )}
      </Td>
    </tr>
  );
}

// ─── Headers ─────────────────────────────────────────────────────────────

function ThClearAll({
  show,
  onClear,
  ariaLabel,
}: {
  show: boolean;
  onClear: () => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <th className="bg-bg-surface px-1 py-1.5 align-middle">
      {show ? (
        <button
          type="button"
          onClick={onClear}
          title={ariaLabel}
          aria-label={ariaLabel}
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-accent-clay"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : (
        <span className="text-[11px]">№</span>
      )}
    </th>
  );
}

interface ThColumnProps {
  colIndex: number;
  label: string;
  sortActive: boolean;
  sortDir: SortDir;
  onSort: (dir: SortDir) => void;
  onSortReset: () => void;
  filter: ColFilter;
  uniqueValues: string[];
  onFilterChange: (patch: Partial<ColFilter>) => void;
  searchPlaceholder: string;
  /** §pyn-1.2.28 — column selection state + handlers (Linear-style). */
  selected: boolean;
  onSelectMouseDown: (ev: React.MouseEvent) => void;
  onSelectMouseEnter: () => void;
}

function ThColumn({
  colIndex: _colIndex,
  label,
  sortActive,
  sortDir,
  onSort,
  onSortReset,
  filter,
  uniqueValues,
  onFilterChange,
  searchPlaceholder,
  selected,
  onSelectMouseDown,
  onSelectMouseEnter,
}: ThColumnProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasFilter = filter.search.trim().length > 0 || filter.selected !== null;
  const SortIcon = !sortActive ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;

  // Visible unique values (substring filter поверх search input)
  const visibleUnique = useMemo(() => {
    if (!filter.search.trim()) return uniqueValues;
    const q = filter.search.toLowerCase();
    return uniqueValues.filter((v) => v.toLowerCase().includes(q));
  }, [uniqueValues, filter.search]);

  const toggleSelected = (v: string): void => {
    const current = filter.selected ?? new Set<string>(uniqueValues);
    const next = new Set(current);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Если выбраны все — selected = null (нет фильтра)
    if (next.size === uniqueValues.length) {
      onFilterChange({ selected: null });
    } else {
      onFilterChange({ selected: next });
    }
  };

  const selectAll = (): void => onFilterChange({ selected: null });
  const selectNone = (): void => onFilterChange({ selected: new Set<string>() });

  return (
    <th
      className={cn(
        'relative bg-bg-surface px-1 py-1 align-middle',
        'transition-colors',
        // Linear-style: вместо ring — tonkий accent strip сверху + subtle bg
        selected
          ? 'bg-accent-clay/[0.08] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-accent-clay before:rounded-b-full'
          : '',
      )}
    >
      <div className="flex items-center gap-0.5">
        {/* §pyn-1.2.29 — название заголовка = column-select trigger (как № для
            строки). Mousedown → select column. Mouseenter (during drag) → extend.
            Linear/Figma-style: rounded chip, hover muted. */}
        <div
          data-mol-selectable="1"
          onMouseDown={onSelectMouseDown}
          onMouseEnter={onSelectMouseEnter}
          className={cn(
            'group/colhead flex flex-1 cursor-default select-none items-center justify-center gap-1 rounded-md px-1.5 py-1 transition-colors',
            !selected && 'hover:bg-accent-clay/[0.06] hover:text-text-strong',
            (sortActive || hasFilter) && 'text-accent-clay',
          )}
        >
          <span className="truncate">{label}</span>
          {sortActive && (
            <SortIcon className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2} />
          )}
          {hasFilter && (
            <span className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-clay" />
          )}
        </div>

        {/* Маленькая filter-кнопка справа — открывает popover (sort + galочки) */}
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={t('mol.col_filter.fio')}
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors',
                hasFilter || open
                  ? 'text-accent-clay bg-accent-clay/15'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <SlidersHorizontal className="h-3 w-3" strokeWidth={2} />
            </button>
          </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className={cn(
              'z-50 flex w-[260px] flex-col gap-2 rounded-xl border border-border-default',
              'bg-bg-elevated p-2 shadow-2xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
              'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            )}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {/* Sort row */}
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10.5px] uppercase tracking-wider text-text-muted">
                {t('mol.popover.sort')}
              </span>
              <SortPill
                active={sortActive && sortDir === 'asc'}
                onClick={() => onSort('asc')}
                icon={<ArrowUp className="h-3 w-3" strokeWidth={2} />}
                label={t('mol.popover.sort_asc')}
              />
              <SortPill
                active={sortActive && sortDir === 'desc'}
                onClick={() => onSort('desc')}
                icon={<ArrowDown className="h-3 w-3" strokeWidth={2} />}
                label={t('mol.popover.sort_desc')}
              />
              {sortActive && (
                <button
                  type="button"
                  onClick={onSortReset}
                  className="ml-auto rounded px-1.5 py-0.5 text-[10.5px] text-text-muted hover:bg-bg-hover hover:text-text-strong"
                >
                  {t('mol.popover.sort_reset')}
                </button>
              )}
            </div>

            {/* Search input */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted"
                strokeWidth={2}
              />
              <input
                type="text"
                value={filter.search}
                onChange={(e) => onFilterChange({ search: e.target.value })}
                placeholder={searchPlaceholder}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className={cn(
                  'w-full rounded-md border border-border-subtle bg-bg-primary py-1.5 pl-7 pr-7 text-[12px] outline-none',
                  'text-text-strong placeholder:text-text-muted/70',
                  'focus:border-accent-clay/60',
                )}
              />
              {filter.search && (
                <button
                  type="button"
                  onClick={() => onFilterChange({ search: '' })}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-strong"
                  aria-label={t('common.cancel')}
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Select All / None */}
            <div className="flex items-center gap-1 text-[10.5px]">
              <button
                type="button"
                onClick={selectAll}
                className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-hover hover:text-text-strong"
              >
                {t('mol.popover.select_all')}
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-hover hover:text-text-strong"
              >
                {t('mol.popover.select_none')}
              </button>
              <span className="ml-auto text-text-muted tabular-nums">
                {filter.selected ? filter.selected.size : uniqueValues.length}/{uniqueValues.length}
              </span>
            </div>

            {/* Checkbox list */}
            <div className="-mx-2 max-h-[280px] overflow-y-auto px-2">
              {visibleUnique.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-text-muted">
                  {t('mol.popover.no_values')}
                </div>
              ) : (
                <ul className="flex flex-col">
                  {visibleUnique.map((v) => {
                    const checked = filter.selected === null || filter.selected.has(v);
                    return (
                      <li key={v}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px]',
                            'hover:bg-bg-hover',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded',
                              'border transition-colors',
                              checked
                                ? 'border-accent-clay bg-accent-clay text-white'
                                : 'border-border-default bg-transparent',
                            )}
                          >
                            {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => toggleSelected(v)}
                          />
                          <span className="truncate text-text-secondary">{v}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
        </Popover.Root>
      </div>
    </th>
  );
}

function SortPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded transition-colors',
        active
          ? 'bg-accent-clay text-white'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-strong',
      )}
    >
      {icon}
    </button>
  );
}

interface TdProps {
  children: React.ReactNode;
  className?: string;
  onMouseDown?: (ev: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onDoubleClick?: () => void;
  'data-selected'?: string;
  'data-native-edit'?: string;
  'data-mol-selectable'?: '1';
  style?: React.CSSProperties;
  tdRef?: (el: HTMLTableCellElement | null) => void;
}

function Td(props: TdProps): JSX.Element {
  const { children, className, style, tdRef, ...rest } = props;
  const nativeEdit = rest['data-native-edit'] === '1';
  return (
    <td
      {...rest}
      ref={tdRef}
      style={style}
      className={cn(
        // §pyn-1.2.31 — ультра-тонкие row dividers (border /25), Linear-style.
        'border-b border-border-subtle/25 px-2 py-1.5 align-middle text-left',
        'cursor-default',
        nativeEdit && 'select-text cursor-text',
        className,
      )}
    >
      {children}
    </td>
  );
}

interface CopyOpts {
  includePosition: boolean;
  includeTab: boolean;
}

function buildTsvFromRect(
  records: MolRecord[],
  rect: CellRect,
  opts: CopyOpts,
): string | null {
  const minR = Math.min(rect.sr, rect.er);
  const maxR = Math.max(rect.sr, rect.er);
  // §pyn-1.2.29 — № (col 0) НИКОГДА не копируется в clipboard, даже если
  // выделение включает его (row-select захватывает col 0..4). Юзер:
  // «при копировании номер строки не копируем».
  const minC = Math.max(1, Math.min(rect.sc, rect.ec));
  const maxC = Math.max(rect.sc, rect.ec);
  if (minC > maxC) return null; // выделение только №
  const rows: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const rec = records[r];
    if (!rec) continue;
    const cells: string[] = [];
    for (let c = minC; c <= maxC; c++) {
      cells.push(cellTextFor(rec, c, r, opts));
    }
    rows.push(cells.join('\t'));
  }
  if (rows.length === 0) return null;
  return rows.join('\n');
}

function cellTextFor(rec: MolRecord, col: number, rowIdx: number, opts: CopyOpts): string {
  switch (col) {
    case 0: return String(rowIdx + 1);
    case 1: return opts.includePosition && rec.position ? `${rec.fio} (${rec.position})` : rec.fio;
    case 2: {
      // §pyn-1.2.25 — digits-only формат (юзер: «нужно в формате 79193734517»).
      // Excel при paste с `+` префиксом подозревал formula и ставил force-text
      // апостроф `'=+79193734517`. Чистые digits — safe для любой таблицы.
      const m = rec.mobile.replace(/\D/g, '');
      const w = rec.work.replace(/\D/g, '');
      if (m && w) return `${m} / ${w}`;
      return m || w || '';
    }
    case 3: return rec.mail || '';
    case 4: {
      const s = rec.status || '';
      const tab = opts.includeTab && rec.tab ? `таб. ${rec.tab}` : '';
      if (s && tab) return `${s} (${tab})`;
      return s || tab || '';
    }
    default: return '';
  }
}

async function copyTsv(tsv: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText?.(tsv);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* noop */ }
    document.body.removeChild(ta);
    return ok;
  }
}

// ─── Подсветка найденного ──────────────────────────────────────────────────

/** Диапазон совпадения: text — substring; digits — по цифрам сквозь формат. */
function molSearchRange(text: string, query: string, kind: 'text' | 'digits'): [number, number] | null {
  const q = query.trim();
  if (!q || !text) return null;
  if (kind === 'text') {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    return idx === -1 ? null : [idx, idx + q.length];
  }
  const qd = q.replace(/\D/g, '');
  if (!qd) return null;
  const digitPos: number[] = [];
  let digits = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch >= '0' && ch <= '9') {
      digitPos.push(i);
      digits += ch;
    }
  }
  const di = digits.indexOf(qd);
  if (di === -1) return null;
  return [digitPos[di]!, digitPos[di + qd.length - 1]! + 1];
}

/**
 * Подсветка найденного «пиллом» — clay-обводка 1px + мягкое свечение (как
 * подсветка склада в графике, `.proba-code--search`). Подсвечивает совпавшую
 * подстроку; для телефонов матч идёт по цифрам сквозь пробелы формата.
 */
function SearchMark({
  text,
  query,
  kind = 'text',
}: {
  text: string;
  query: string;
  kind?: 'text' | 'digits';
}): JSX.Element {
  const range = query ? molSearchRange(text, query, kind) : null;
  if (!range) return <>{text}</>;
  const [s, e] = range;
  return (
    <>
      {text.slice(0, s)}
      <span className="rounded-[3px] bg-accent-clay/10 px-0.5 text-text-strong shadow-[0_0_0_1px_rgba(217,119,87,0.9),0_0_5px_1px_rgba(217,119,87,0.3)]">
        {text.slice(s, e)}
      </span>
      {text.slice(e)}
    </>
  );
}
