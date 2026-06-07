import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  type DataEditorRef,
  GridCellKind,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid';
import { ArrowDownUp, Lock } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import {
  flowVghStagingGet,
  flowVghStagingEdit,
  type VghEdit,
  type VghRow,
  type VghStagingRow,
  type VghChangedEvent,
  type VghStagingChangedEvent,
  type ScheduleLockAcquiredEvent,
  type ScheduleLockReleasedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { sessionStore } from '@/lib/token-store';
import { useEditLock } from '@/lib/schedule/use-edit-lock';
import { FLOW_GRID_THEME } from '@/components/flow/flow-grid-theme';
import { FlowHeaderMenu, type FlowHeaderMenuAnchor } from '@/components/flow/FlowHeaderMenu';
import { FlowZoomControl } from '@/components/flow/FlowZoomControl';
import { FlowSearchPanel, type FlowSearchGroup } from '@/components/flow/FlowSearchPanel';
import { applyVghChanged } from '@/lib/vgh-repo';
import {
  VGH_COLUMNS,
  autoWeightByUom,
  computeVolume,
  fmtFixed,
  fmtSmart,
  fmtVolume,
  isPieceUom,
  numToEdit,
  vghDefaultCompare,
  vghReady,
  vghTransferred,
  vghText,
  type VghColId,
  type VghColumnSpec,
  type VghStagingView,
} from './vgh-staging.fixtures';

// Шрифт как в Потоке-формировании: дефолт значений 10px; «схожие» колонки — тем же кеглем,
// что в формировании (КГ↔KG / V↔V = 8px), остальные — стандарт 10; жирные FR/КГ/V.
const BASE_FONT = 10;
const HEADER_FONT = 10;
const BASE_ROW_HEIGHT = 22;
const BASE_HPAD = 6;

/** Кегль значения колонки (px при 100%) — совпадающие с формированием КГ/V мельче (8). */
const VGH_COL_FONT_PX: Partial<Record<VghColId, number>> = { weight_kg: 8, volume: 8 };
function vghColFontPx(id: VghColId): number {
  return VGH_COL_FONT_PX[id] ?? BASE_FONT;
}
/** Жирные значения — как в формировании (склад-отправитель, КГ, V). */
const VGH_BOLD_COLS = new Set<VghColId>(['fr', 'weight_kg', 'volume']);
function vghValueFontStyle(id: VghColId, zoom: number): string {
  return `${VGH_BOLD_COLS.has(id) ? '600 ' : ''}${Math.round(vghColFontPx(id) * zoom)}px`;
}
const MAX_DISTINCT = 2000;
const SEARCH_CAP_PER_COL = 50;
const SEARCH_HL_BUFFER = 150;
const SEARCH_HL_CAP = 4000;
const SEARCH_HL_COLOR = 'rgba(250, 204, 21, 0.40)';
const SEARCH_ACTIVE_COLOR = 'rgba(217, 119, 87, 0.45)';
const EMPTY_SET: ReadonlySet<string> = new Set();
const LOCK_PREFIX = 'vgh_staging:';
const EDIT_LOCK_HOLD_MS = 8000;

const GRID_FONT_FAMILY = FLOW_GRID_THEME.fontFamily ?? 'Inter, sans-serif';
const MEASURE_CTX = document.createElement('canvas').getContext('2d');

/** Минимальная ширина «резиновой» колонки ТЕХ-ИМЯ — ýже не даём (дальше горизонт. скролл). */
const TECH_MIN_WIDTH = 200;

/** Кэш числа строк переноса (ключ: шрифт+ширина+текст) — чтобы getRowHeight не мерил
 *  одно и то же повторно при прокрутке. (Как в формировании.) */
const WRAP_CACHE = new Map<string, number>();
/** Сколько визуальных строк займёт текст в колонке шириной maxWidth (явные \n + мягкий
 *  перенос по словам) — для «резиновой» колонки ТЕХ-ИМЯ (строка растёт под текст). */
function countWrapLines(text: string, maxWidth: number, fontPx: number): number {
  if (!text) return 1;
  const ctx = MEASURE_CTX;
  if (!ctx || maxWidth <= 0) return text.includes('\n') ? text.split('\n').length : 1;
  const key = `${fontPx} ${Math.round(maxWidth)} ${text}`;
  const cached = WRAP_CACHE.get(key);
  if (cached !== undefined) return cached;
  ctx.font = `${fontPx}px ${GRID_FONT_FAMILY}`;
  let total = 0;
  for (const para of text.split('\n')) {
    if (para === '') { total += 1; continue; }
    const tokens = para.split(/(\s+)/);
    let line = '';
    let lines = 1;
    for (const tok of tokens) {
      const test = line + tok;
      if (ctx.measureText(test).width > maxWidth && line.trim() !== '') {
        lines += 1;
        line = tok.replace(/^\s+/, '');
      } else {
        line = test;
      }
    }
    total += lines;
  }
  if (WRAP_CACHE.size > 4000) WRAP_CACHE.clear();
  WRAP_CACHE.set(key, total);
  return total;
}

interface ColumnFilter {
  search: string;
  excluded: Set<string>;
}
interface SortLevel {
  colId: string;
  dir: 'asc' | 'desc';
}
interface HighlightRegion {
  color: string;
  range: { x: number; y: number; width: number; height: number };
  style: 'solid' | 'no-outline';
}

function emptySelection(): GridSelection {
  return { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: undefined };
}

/** Авто-ширина колонок по содержимому (несколько самых длинных значений). */
function computeAutoWidths(rows: VghStagingView[], zoom: number): Record<string, number> {
  const ctx = MEASURE_CTX;
  const out: Record<string, number> = {};
  for (const spec of VGH_COLUMNS) {
    if (!ctx) {
      out[spec.id] = spec.width;
      continue;
    }
    ctx.font = `800 ${Math.round(vghColFontPx(spec.id) * zoom)}px ${GRID_FONT_FAMILY}`;
    let max = ctx.measureText(spec.title).width + 26; // место под значок меню
    ctx.font = `${vghValueFontStyle(spec.id, zoom)} ${GRID_FONT_FAMILY}`;
    // Берём до 40 самых длинных по символам значений и мерим их пиксельно.
    const sample = rows
      .map((r) => vghText(r, spec.id))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .slice(0, 40);
    for (const v of sample) {
      const w = ctx.measureText(v).width + 2 * Math.round(BASE_HPAD * zoom) + 6;
      if (w > max) max = w;
    }
    out[spec.id] = Math.max(spec.kind === 'check' ? 40 : 48, Math.min(360, Math.round(max)));
  }
  return out;
}

function numCmp(a: unknown, b: unknown): number {
  const an = a == null || a === '' ? NaN : Number(a);
  const bn = b == null || b === '' ? NaN : Number(b);
  const ae = Number.isNaN(an);
  const be = Number.isNaN(bn);
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  return an - bn;
}

function compareRows(a: VghStagingView, b: VghStagingView, spec: VghColumnSpec, dir: 'asc' | 'desc'): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (spec.kind === 'number' || spec.kind === 'volume' || spec.kind === 'check') {
    const av = spec.id === 'volume' ? a.volume : spec.id === 'marked' ? a.marked : (a as unknown as Record<string, unknown>)[spec.id];
    const bv = spec.id === 'volume' ? b.volume : spec.id === 'marked' ? b.marked : (b as unknown as Record<string, unknown>)[spec.id];
    return sign * numCmp(av, bv);
  }
  return sign * vghText(a, spec.id).localeCompare(vghText(b, spec.id), 'ru', { numeric: true });
}

/**
 * Промежуточный лист «ВГХ» (наш Glide-грид, как формирование): дозаполнение веса/
 * габаритов/объёма/MIN QTY/тех-имени. Чекбокс при наличии веса → перенос в базу ВГХ
 * (строка зеленеет, через сутки скрыта). Фильтр/поиск/масштаб — переиспользуем
 * компоненты формирования. Реалтайм по WS `vgh_staging_changed`; защита строки —
 * когда кто-то её редактирует (общий schedule_lock, resourceId `vgh_staging:{no_num}`).
 */
export function VghStagingGrid() {
  const [rows, setRows] = useState<VghStagingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [fontsReady, setFontsReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Ширина для РАСКЛАДКИ колонок (резиновый ТЕХ-ИМЯ) — с задержкой, чтобы при движении
  // сайдбара канвас следовал live, а переразметка колонок шла раз по остановке (без прыжка).
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [selection, setSelection] = useState<GridSelection>(emptySelection);
  const [sortLevels, setSortLevels] = useState<SortLevel[]>([]);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [menu, setMenu] = useState<FlowHeaderMenuAnchor | null>(null);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  // Поиск (как в формировании): панель, запрос, активное совпадение, окно видимости.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState<{ colIndex: number; id: number } | null>(null);
  const [searchDimmed, setSearchDimmed] = useState(false);
  const [visibleWindow, setVisibleWindow] = useState<{ start: number; end: number }>({ start: 0, end: 80 });
  const visibleRef = useRef<{ start: number; end: number }>({ start: 0, end: 80 });
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;

  const gridRef = useRef<DataEditorRef>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<Map<string, 'asc' | 'desc'>>(new Map());
  const filteredColsRef = useRef<Set<string>>(new Set());
  const idByNoNumRef = useRef<Map<string, number>>(new Map());
  const idCounterRef = useRef(1);
  const viewRowsRef = useRef<VghStagingView[]>([]);

  // Защита строки: кто из ДРУГИХ юзеров сейчас держит строку (resource vgh_staging:*).
  const [lockedByOthers, setLockedByOthers] = useState<Map<string, { login: string; name: string }>>(new Map());
  const [myLogin, setMyLogin] = useState('');
  // Моя «активная» строка (редактирую) — захватываем lock; авто-сброс через паузу.
  const [editingNoNum, setEditingNoNum] = useState('');
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionStore.load().then((s) => { if (s?.user?.login) setMyLogin(s.user.login); }).catch(() => {});
  }, []);

  // Шрифт Inter мог не загрузиться к первому замеру авто-ширины — ждём и пересчитываем.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.ready) { setFontsReady(true); return; }
    fonts.ready.then(() => setFontsReady(true)).catch(() => setFontsReady(true));
  }, []);

  // Стабильный numeric id по no_num (для поиска/перелёта/выделения; переживает WS-слияния).
  const idFor = useCallback((noNum: string): number => {
    const map = idByNoNumRef.current;
    let id = map.get(noNum);
    if (id === undefined) { id = idCounterRef.current++; map.set(noNum, id); }
    return id;
  }, []);

  const toView = useCallback(
    (r: VghStagingRow): VghStagingView => ({
      ...r,
      _id: idFor(String(r.no_num)),
      volume: computeVolume(r.len_mm, r.wid_mm, r.hgt_mm),
    }),
    [idFor],
  );

  const load = useCallback(async () => {
    try {
      const list = await flowVghStagingGet(api);
      setRows(list.map(toView));
    } catch {
      /* пусто — покажем 0 строк */
    } finally {
      setLoading(false);
    }
  }, [toView]);

  useEffect(() => { void load(); }, [load]);

  // Реалтайм: правки/перенос/пересбор промежуточного листа у всех.
  useWsEvent<VghStagingChangedEvent>('vgh_staging_changed', (e) => {
    if (e.full) { void load(); return; }
    const incoming = Array.isArray(e.rows) ? e.rows : [];
    if (incoming.length === 0) return;
    setRows((prev) => {
      const byNo = new Map(prev.map((r) => [String(r.no_num), r]));
      for (const raw of incoming) byNo.set(String(raw.no_num), toView(raw as unknown as VghStagingRow));
      // Перенесённые >суток назад сервер уже не отдаёт; локально не выкидываем (скроет следующий get).
      return Array.from(byNo.values());
    });
  });
  // База ВГХ тоже могла измениться переносом — обновим стор (для карточки/формирования).
  useWsEvent<VghChangedEvent>('vgh_changed', (e) => {
    if (Array.isArray(e.rows)) applyVghChanged(e.rows as unknown as VghRow[]);
  });

  // — защита строки: слушаем общие schedule_lock-события по нашим resource'ам —
  useWsEvent<ScheduleLockAcquiredEvent>('schedule_lock_acquired', (e) => {
    if (!e.resource_id.startsWith(LOCK_PREFIX)) return;
    if (e.user_login === myLogin) return;
    const noNum = e.resource_id.slice(LOCK_PREFIX.length);
    setLockedByOthers((prev) => new Map(prev).set(noNum, { login: e.user_login, name: e.full_name || e.user_login }));
  });
  useWsEvent<ScheduleLockReleasedEvent>('schedule_lock_released', (e) => {
    if (!e.resource_id.startsWith(LOCK_PREFIX)) return;
    const noNum = e.resource_id.slice(LOCK_PREFIX.length);
    setLockedByOthers((prev) => {
      if (!prev.has(noNum)) return prev;
      const next = new Map(prev);
      next.delete(noNum);
      return next;
    });
  });

  // Захват МОЕГО lock'а на редактируемую строку (общий schedule_lock).
  useEditLockRow(editingNoNum);

  // Размеры контейнера (canvas требует пиксели).
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      setSize({ width: w, height: h }); // live — канвас следует за окном
      setLayoutWidth((prev) => (prev === 0 ? w : prev)); // первый раз сразу
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLayoutWidth(w), 160); // дальше — по паузе движения
    });
    ro.observe(el);
    return () => { if (timer) clearTimeout(timer); ro.disconnect(); };
  }, []);

  const colWidths = useMemo(
    () => computeAutoWidths(rows, zoom),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fontsReady, zoom],
  );

  // ТЕХ-ИМЯ — «резиновая» (как NOTE в формировании): добивает таблицу до края окна; остаток
  // после прочих колонок. Мал → текст переносится (строка растёт), широко → показ как есть.
  const techWidth = useMemo(() => {
    const others = VGH_COLUMNS.reduce(
      (sum, c) => (c.id === 'tech_name' ? sum : sum + Math.round((colWidths[c.id] ?? c.width) * zoom)),
      0,
    );
    return Math.max(TECH_MIN_WIDTH, layoutWidth - others - 12); // -12: полоса/зазор
  }, [layoutWidth, colWidths, zoom]);

  // Представление = фильтр показа + сортировка поверх источника.
  const viewRows = useMemo<VghStagingView[]>(() => {
    let out: VghStagingView[] = rows;
    const active = Object.entries(filters)
      .filter(([, f]) => f.search.trim() !== '' || f.excluded.size > 0)
      .map(([colId, f]) => ({ spec: VGH_COLUMNS.find((c) => c.id === colId), f }))
      .filter((x): x is { spec: VghColumnSpec; f: ColumnFilter } => x.spec !== undefined);
    if (active.length > 0) {
      out = rows.filter((row) =>
        active.every(({ spec, f }) => {
          const v = vghText(row, spec.id);
          const q = f.search.trim().toLowerCase();
          if (q && !v.toLowerCase().includes(q)) return false;
          if (f.excluded.has(v)) return false;
          return true;
        }),
      );
    }
    if (sortLevels.length > 0) {
      const levels = sortLevels
        .map((lv) => ({ spec: VGH_COLUMNS.find((c) => c.id === lv.colId), dir: lv.dir }))
        .filter((x): x is { spec: VghColumnSpec; dir: 'asc' | 'desc' } => x.spec !== undefined);
      if (levels.length > 0) {
        const base = out === rows ? out.slice() : out;
        base.sort((a, b) => {
          for (const { spec, dir } of levels) {
            const c = compareRows(a, b, spec, dir);
            if (c !== 0) return c;
          }
          return 0;
        });
        out = base;
      }
    } else {
      // Без пользовательской сортировки — дефолт ВГХ: FR → ЕИ (не штучное→штучное) → MAT.
      const base = out === rows ? out.slice() : out;
      base.sort(vghDefaultCompare);
      out = base;
    }
    return out;
  }, [rows, filters, sortLevels]);

  viewRowsRef.current = viewRows;
  sortRef.current = new Map(sortLevels.map((lv) => [lv.colId, lv.dir]));
  filteredColsRef.current = new Set(
    Object.entries(filters).filter(([, f]) => f.search.trim() !== '' || f.excluded.size > 0).map(([id]) => id),
  );

  const idToViewRow = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < viewRows.length; i++) { const vr = viewRows[i]; if (vr) map.set(vr._id, i); }
    return map;
  }, [viewRows]);

  // Уникальные значения колонки открытого меню (чек-лист фильтра).
  const menuValues = useMemo<string[]>(() => {
    if (!menu) return [];
    const spec = VGH_COLUMNS[menu.colIndex];
    if (!spec) return [];
    const set = new Set<string>();
    for (const r of rows) { set.add(vghText(r, spec.id)); if (set.size >= MAX_DISTINCT) break; }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  }, [menu, rows]);

  // Колонки (авто-ширина × зум + меню + индикатор фильтра).
  const columns: GridColumn[] = useMemo(
    () =>
      VGH_COLUMNS.map((c) => {
        const f = filters[c.id];
        const filtered = f ? f.search.trim() !== '' || f.excluded.size > 0 : false;
        return {
          id: c.id,
          title: c.title,
          // ТЕХ-ИМЯ — резиновая (остаток до края окна), прочие — по авто-ширине × зум.
          width: c.id === 'tech_name' ? techWidth : Math.round((colWidths[c.id] ?? c.width) * zoom),
          hasMenu: true,
          themeOverride: {
            headerFontStyle: `800 ${Math.round(vghColFontPx(c.id) * zoom)}px`,
            ...(filtered
              ? { textHeader: '#B35E45', bgHeader: '#EFE2DA', bgHeaderHovered: '#EEDBD1', bgHeaderHasFocus: '#EEDDD4' }
              : {}),
          },
        };
      }),
    [colWidths, filters, zoom, techWidth],
  );

  const getCellContent = useCallback(
    (cellPos: Item): GridCell => {
      const [col, row] = cellPos;
      const spec = VGH_COLUMNS[col];
      const rowData = viewRows[row];
      if (!spec || !rowData) return { kind: GridCellKind.Loading, allowOverlay: false };

      const lockedOther = lockedByOthers.has(String(rowData.no_num));
      const done = vghTransferred(rowData);
      // read-only: не правится спец-колонка / перенесённая (готова) / занятая другим.
      const ro = !spec.editable || done || lockedOther;

      if (spec.kind === 'check') {
        // Чекбокс активен только если есть вес (валидация ДО оптимистики) и строка свободна.
        const checkable = vghReady(rowData) && !lockedOther && !done;
        return {
          kind: GridCellKind.Boolean,
          data: Number(rowData.marked) === 1,
          allowOverlay: false,
          readonly: !checkable,
        };
      }
      if (spec.kind === 'number' || spec.kind === 'volume') {
        // Авто-значения по ЕИ (нельзя менять, чтобы не ошибиться): вес для Т/КГ/Г; MIN QTY=1
        // для штучных. Показываем посчитанное и блокируем ячейку.
        const autoW = spec.id === 'weight_kg' ? autoWeightByUom(rowData.uom) : null;
        const autoMin = spec.id === 'min_qty' && isPieceUom(rowData.uom) ? 1 : null;
        const auto = autoW != null ? autoW : autoMin;
        const fieldRaw = spec.id === 'volume' ? rowData.volume : ((rowData as unknown as Record<string, unknown>)[spec.id] as number | null);
        const raw = auto != null ? auto : fieldRaw;
        const empty = raw == null || raw === undefined;
        const num = empty ? NaN : Number(raw);
        const valid = Number.isFinite(num);
        // Объём — умно до первого значащего знака (чтобы не обнулить крошечные); Д/Ш/В — чисто
        // мм (целые) умным показом без принудительных 4 знаков; КГ/MIN QTY — РОВНО 4 знака (фикс,
        // вкл. авто-значения) единообразно по столбцу.
        const dim = spec.id === 'len_mm' || spec.id === 'wid_mm' || spec.id === 'hgt_mm';
        let display = valid
          ? spec.id === 'volume'
            ? fmtVolume(num)
            : dim
              ? fmtSmart(num)
              : fmtFixed(num, spec.frac ?? 4)
          : '';
        // КГ пусто → подсказка (обратный счёт) серым, если есть и вес не авто.
        const hint = auto == null && spec.id === 'weight_kg' && empty && rowData.weight_hint != null;
        if (hint) display = `≈ ${fmtSmart(rowData.weight_hint, 3)}`;
        const cellRo = ro || auto != null; // авто-значение по ЕИ — read-only
        // Число-ячейка = ТЕКСТ со своим показом: редактор правит «чистое» значение запятой-
        // десятич без разрядов, грид показывает отформатированное → ввод запятой работает.
        return {
          kind: GridCellKind.Text,
          data: valid ? numToEdit(num) : '',
          displayData: display,
          allowOverlay: !cellRo,
          readonly: cellRo,
          contentAlign: 'right',
          themeOverride: { baseFontStyle: vghValueFontStyle(spec.id, zoom), ...(hint ? { textDark: '#9AA0A6' } : {}) },
        };
      }
      const txt = vghText(rowData, spec.id);
      return {
        kind: GridCellKind.Text,
        data: txt,
        displayData: txt,
        allowOverlay: !ro,
        readonly: ro,
        themeOverride: { baseFontStyle: vghValueFontStyle(spec.id, zoom) },
        // ТЕХ-ИМЯ — резиновая: перенос текста по словам + многострочный редактор.
        ...(spec.id === 'tech_name' ? { allowWrapping: true } : {}),
      };
    },
    [viewRows, lockedByOthers, zoom],
  );

  // — применение правок (валидация + защита строки + сервер + оптимистика) —
  const applyEdits = useCallback(
    (edits: { location: Item; value: EditableGridCell }[]) => {
      const patchByNo = new Map<string, Record<string, string | number | boolean | null>>();
      let blocked = false;
      for (const { location, value } of edits) {
        const [col, row] = location;
        const spec = VGH_COLUMNS[col];
        const rowData = viewRows[row];
        if (!spec || !rowData || !spec.editable) continue;
        if (vghTransferred(rowData)) continue;
        if (lockedByOthers.has(String(rowData.no_num))) { blocked = true; continue; }

        let v: string | number | boolean | null;
        if (spec.kind === 'check') {
          if (value.kind !== GridCellKind.Boolean) continue;
          if (value.data && !vghReady(rowData)) { setToast('Сначала заполните вес — без него нельзя перенести в базу'); continue; }
          v = !!value.data;
        } else if (spec.kind === 'number') {
          // Правка-числом ИЛИ вставка-текстом из буфера: принимаем оба; запятая→точка.
          if (value.kind === GridCellKind.Number) {
            v = value.data == null ? null : Number(value.data);
          } else if (value.kind === GridCellKind.Text) {
            const s = value.data.trim().replace(/\s+/g, '').replace(',', '.');
            v = s === '' ? null : Number(s);
          } else continue;
          if (v != null && !Number.isFinite(v)) continue;
        } else {
          if (value.kind === GridCellKind.Text) v = value.data;
          else if (value.kind === GridCellKind.Number) v = value.data == null ? '' : String(value.data);
          else continue;
        }
        const p = patchByNo.get(String(rowData.no_num)) ?? {};
        p[spec.id] = v;
        patchByNo.set(String(rowData.no_num), p);
        // Я редактирую эту строку → держим lock + продлеваем.
        markEditing(String(rowData.no_num));
      }
      if (blocked) setToast('Строку сейчас редактирует другой пользователь');
      if (patchByNo.size === 0) return;

      // Оптимистично применяем локально (числа/текст/чекбокс; объём пересчитываем).
      setRows((prev) =>
        prev.map((r) => {
          const p = patchByNo.get(String(r.no_num));
          if (!p) return r;
          const merged = { ...r, ...p } as VghStagingView;
          merged.volume = computeVolume(merged.len_mm, merged.wid_mm, merged.hgt_mm);
          merged.marked = 'marked' in p ? (p.marked ? 1 : 0) : r.marked;
          return merged;
        }),
      );

      const verBy = new Map(rows.map((r) => [String(r.no_num), r.row_version]));
      const batch: VghEdit[] = [...patchByNo.entries()].map(([no_num, fields]) => ({
        no_num,
        row_version: verBy.get(no_num) ?? 0,
        fields,
      }));
      void flowVghStagingEdit(api, batch)
        .then((res) => {
          // Сервер вернул актуальные строки (включая transferred_at при переносе).
          if (res.rows.length > 0) {
            setRows((prev) => {
              const byNo = new Map(prev.map((r) => [String(r.no_num), r]));
              for (const raw of res.rows) byNo.set(String(raw.no_num), toView(raw));
              return Array.from(byNo.values());
            });
          }
          if (res.transferred.length > 0) setToast(`Перенесено в базу ВГХ: ${res.transferred.length}`);
        })
        .catch(() => setToast('Не удалось сохранить — попробуйте ещё раз'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewRows, rows, lockedByOthers, toView],
  );

  // Отмечаю, что редактирую строку — держим lock, авто-сброс через паузу.
  const markEditing = useCallback((noNum: string) => {
    setEditingNoNum(noNum);
    if (editTimerRef.current) clearTimeout(editTimerRef.current);
    editTimerRef.current = setTimeout(() => setEditingNoNum(''), EDIT_LOCK_HOLD_MS);
  }, []);

  const onCellEdited = useCallback(
    (cellPos: Item, value: EditableGridCell) => applyEdits([{ location: cellPos, value }]),
    [applyEdits],
  );

  // Множественная правка / вставка из буфера (Glide зовёт onCellsEdited при paste).
  const onCellsEdited = useCallback(
    (edits: readonly { location: Item; value: EditableGridCell }[]) => {
      applyEdits(edits.map((e) => ({ location: e.location, value: e.value })));
      return true;
    },
    [applyEdits],
  );

  // Вставка одной ячейки в ВЕСЬ выделенный диапазон (Excel-поведение).
  const handlePaste = useCallback(
    (_target: Item, values: readonly (readonly string[])[]): boolean => {
      const single = values.length === 1 && values[0]?.length === 1 ? values[0][0] : undefined;
      const range = selection.current?.range;
      if (single !== undefined && range && (range.width > 1 || range.height > 1)) {
        const edits: { location: Item; value: EditableGridCell }[] = [];
        for (let r = range.y; r < range.y + range.height; r++) {
          for (let c = range.x; c < range.x + range.width; c++) {
            edits.push({ location: [c, r], value: { kind: GridCellKind.Text, data: single, displayData: single, allowOverlay: true } });
          }
        }
        applyEdits(edits);
        return false;
      }
      return true;
    },
    [selection, applyEdits],
  );

  // — меню колонки (фильтр/сортировка) —
  const menuColId = menu ? VGH_COLUMNS[menu.colIndex]?.id : undefined;
  const menuFilter = menuColId ? filters[menuColId] : undefined;

  const handleHeaderMenuClick = useCallback((colIndex: number, bounds: Rectangle) => {
    const spec = VGH_COLUMNS[colIndex];
    if (!spec) return;
    setMenu({ colIndex, title: spec.title, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  }, []);

  const applyColumnSort = useCallback((colId: string, dir: 'asc' | 'desc') => {
    setSortLevels((prev) => {
      const idx = prev.findIndex((l) => l.colId === colId);
      if (idx >= 0) { const next = prev.slice(); next[idx] = { colId, dir }; return next; }
      return [...prev, { colId, dir }];
    });
    setSelection(emptySelection());
  }, []);
  const handleSort = useCallback((dir: 'asc' | 'desc') => { if (menuColId) applyColumnSort(menuColId, dir); }, [menuColId, applyColumnSort]);
  const handleSortReset = useCallback(() => { if (menuColId) setSortLevels((p) => p.filter((l) => l.colId !== menuColId)); }, [menuColId]);

  const updateColumnFilter = useCallback((colId: string, updater: (cur: ColumnFilter) => ColumnFilter) => {
    setFilters((prev) => ({ ...prev, [colId]: updater(prev[colId] ?? { search: '', excluded: new Set<string>() }) }));
    setSelection(emptySelection());
  }, []);
  const handleSearchChange = useCallback((q: string) => { if (menuColId) updateColumnFilter(menuColId, (cur) => ({ search: q, excluded: cur.excluded })); }, [menuColId, updateColumnFilter]);
  const handleToggleValue = useCallback(
    (value: string) => { if (menuColId) updateColumnFilter(menuColId, (cur) => { const ex = new Set(cur.excluded); ex.has(value) ? ex.delete(value) : ex.add(value); return { search: cur.search, excluded: ex }; }); },
    [menuColId, updateColumnFilter],
  );
  const handleClearColumnFilter = useCallback(() => { if (menuColId) updateColumnFilter(menuColId, () => ({ search: '', excluded: new Set<string>() })); }, [menuColId, updateColumnFilter]);
  const handleDeselectAllColumn = useCallback(() => { if (menuColId) updateColumnFilter(menuColId, (cur) => ({ search: cur.search, excluded: new Set(menuValues) })); }, [menuColId, updateColumnFilter, menuValues]);

  // — поиск по всей базе (как в формировании) —
  const searchLc = searchQuery.trim().toLowerCase();
  const searchGroups = useMemo<FlowSearchGroup[]>(() => {
    if (!searchLc) return [];
    const groups: FlowSearchGroup[] = [];
    VGH_COLUMNS.forEach((spec, colIndex) => {
      const matches: { id: number; value: string }[] = [];
      let total = 0;
      for (const r of rows) {
        const v = vghText(r, spec.id);
        if (v.toLowerCase().includes(searchLc)) {
          total++;
          if (matches.length < SEARCH_CAP_PER_COL) matches.push({ id: r._id, value: v });
        }
      }
      if (total > 0) groups.push({ colIndex, title: spec.title, matches, total });
    });
    return groups;
  }, [searchLc, rows]);
  const totalMatches = useMemo(() => searchGroups.reduce((s, g) => s + g.total, 0), [searchGroups]);

  const searchMatchRegions = useMemo<HighlightRegion[]>(() => {
    if (!searchOpen || !searchLc) return [];
    const from = Math.max(0, visibleWindow.start - SEARCH_HL_BUFFER);
    const to = Math.min(viewRows.length, visibleWindow.end + SEARCH_HL_BUFFER);
    const out: HighlightRegion[] = [];
    for (let r = from; r < to && out.length < SEARCH_HL_CAP; r++) {
      const vr = viewRows[r];
      if (!vr) continue;
      for (let c = 0; c < VGH_COLUMNS.length; c++) {
        const spec = VGH_COLUMNS[c];
        if (spec && vghText(vr, spec.id).toLowerCase().includes(searchLc)) {
          out.push({ color: SEARCH_HL_COLOR, range: { x: c, y: r, width: 1, height: 1 }, style: 'no-outline' });
        }
      }
    }
    return out;
  }, [searchOpen, searchLc, viewRows, visibleWindow]);

  const activeRegion = useMemo<HighlightRegion | null>(() => {
    if (!searchOpen || !activeMatch) return null;
    const vr = idToViewRow.get(activeMatch.id);
    if (vr === undefined) return null;
    return { color: SEARCH_ACTIVE_COLOR, range: { x: activeMatch.colIndex, y: vr, width: 1, height: 1 }, style: 'solid' };
  }, [searchOpen, activeMatch, idToViewRow]);

  const gridHighlights = useMemo(() => [...searchMatchRegions, ...(activeRegion ? [activeRegion] : [])], [searchMatchRegions, activeRegion]);

  const goToMatch = useCallback((colIndex: number, id: number) => {
    const vr = idToViewRow.get(id);
    if (vr === undefined) return;
    const fly = () => gridRef.current?.scrollTo(colIndex, vr, 'both', 0, 0, { hAlign: 'center', vAlign: 'center' });
    fly();
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [colIndex, vr], range: { x: colIndex, y: vr, width: 1, height: 1 }, rangeStack: [] } });
    setActiveMatch({ colIndex, id });
    setSearchDimmed(true);
    requestAnimationFrame(() => { fly(); requestAnimationFrame(fly); });
  }, [idToViewRow]);

  const handleVisibleRegionChanged = useCallback((range: Rectangle) => {
    visibleRef.current = { start: range.y, end: range.y + range.height };
    if (!searchOpenRef.current) return;
    setVisibleWindow((prev) => (Math.abs(prev.start - range.y) >= 8 ? { start: range.y, end: range.y + range.height } : prev));
  }, []);
  useEffect(() => { if (searchOpen) setVisibleWindow(visibleRef.current); }, [searchOpen]);

  // Условное форматирование строки: перенесённая → зелёная; занятая другим → серая.
  const getRowThemeOverride = useCallback(
    (row: number) => {
      const r = viewRows[row];
      if (!r) return undefined;
      if (vghTransferred(r)) return { bgCell: '#E7F6E7', bgCellMedium: '#E2F2E2', textDark: '#2F6A35' };
      if (lockedByOthers.has(String(r.no_num))) return { bgCell: '#F1F0EC', bgCellMedium: '#ECEBE6', textDark: '#8A8782' };
      return undefined;
    },
    [viewRows, lockedByOthers],
  );

  // Разделитель между складами-отправителями (FR) — толстая ОПАКОВАЯ линия (2.5px, #1E1E1E)
  // по верху первой строки группы FR, как граница кластера в Потоке. Опаковая (без alpha) →
  // не копит цвет на hover-перерисовках. По умолчанию лист отсортирован FR→ЕИ→MAT, поэтому
  // линии делят именно по отправителю. save/restore — чтобы цвет не утёк в соседние ячейки.
  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent();
      const { ctx, rect, row } = args;
      if (row <= 0) return;
      const r = viewRows[row];
      const prev = viewRows[row - 1];
      if (!r || !prev) return;
      if (String(prev.fr ?? '') !== String(r.fr ?? '')) {
        ctx.save();
        ctx.fillStyle = '#1E1E1E';
        ctx.fillRect(rect.x, rect.y, rect.width, 2.5);
        ctx.restore();
      }
    },
    [viewRows],
  );

  // Индикаторы шапки (стрелка меню на hover + сортировки) — как в формировании.
  const drawHeader = useCallback<DrawHeaderCallback>((args, drawContent) => {
    drawContent();
    if (args.column.hasMenu !== true) return;
    const { ctx, menuBounds, theme, isSelected, hasSelectedCell, isHovered } = args;
    const sortedDir = sortRef.current.get(args.column.id ?? '') ?? null;
    if (!isHovered && !sortedDir) return;
    const cx = menuBounds.x + menuBounds.width - 13;
    const cy = menuBounds.y + menuBounds.height / 2;
    ctx.save();
    ctx.fillStyle = isSelected ? theme.accentColor : hasSelectedCell ? theme.bgHeaderHasFocus ?? '#ECEBE5' : isHovered ? theme.bgHeaderHovered ?? '#ECEBE5' : theme.bgHeader ?? '#ECEBE5';
    ctx.fillRect(cx - 8, menuBounds.y, 18, menuBounds.height);
    const filtered = filteredColsRef.current.has(args.column.id ?? '');
    ctx.strokeStyle = isSelected ? '#FFFFFF' : filtered ? '#B35E45' : '#D97757';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (isHovered || sortedDir === 'desc') {
      ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4); ctx.moveTo(cx - 2.5, cy + 1.5); ctx.lineTo(cx, cy + 4); ctx.lineTo(cx + 2.5, cy + 1.5);
    } else {
      ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy - 4); ctx.moveTo(cx - 2.5, cy - 1.5); ctx.lineTo(cx, cy - 4); ctx.lineTo(cx + 2.5, cy - 1.5);
    }
    ctx.stroke();
    ctx.restore();
  }, []);

  const gridTheme = useMemo(
    () => ({
      ...FLOW_GRID_THEME,
      baseFontStyle: `${Math.round(BASE_FONT * zoom)}px`,
      headerFontStyle: `800 ${Math.round(HEADER_FONT * zoom)}px`,
      editorFontSize: `${Math.round(BASE_FONT * zoom)}px`,
      cellHorizontalPadding: Math.max(4, Math.round(BASE_HPAD * zoom)),
    }),
    [zoom],
  );
  const rowH = Math.round(BASE_ROW_HEIGHT * zoom);

  // Высота строки: резиновая ТЕХ-ИМЯ переносится по ширине → растим строку под число строк.
  const getRowHeight = useCallback(
    (row: number): number => {
      const r = viewRows[row];
      const v = r ? r.tech_name : '';
      if (typeof v !== 'string' || !v) return rowH;
      const fontPx = Math.round(BASE_FONT * zoom);
      const innerW = techWidth - 2 * Math.max(4, Math.round(BASE_HPAD * zoom));
      const lines = countWrapLines(v, innerW, fontPx);
      return lines <= 1 ? rowH : rowH + (lines - 1) * Math.round(fontPx * 1.3);
    },
    [viewRows, rowH, zoom, techWidth],
  );

  const contentWidth = useMemo(
    () => VGH_COLUMNS.reduce((s, c) => s + (c.id === 'tech_name' ? techWidth : Math.round((colWidths[c.id] ?? c.width) * zoom)), 0) + 12,
    [colWidths, zoom, techWidth],
  );

  const filtered = viewRows.length !== rows.length;
  const visibleLocked = useMemo(() => {
    if (lockedByOthers.size === 0) return null;
    for (const r of viewRows) { const o = lockedByOthers.get(String(r.no_num)); if (o) return o; }
    return null;
  }, [viewRows, lockedByOthers]);

  // Авто-скрытие тоста.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      {/* Тулбар: масштаб · поиск · сортировка · пересбор. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-1.5">
        <FlowZoomControl zoom={zoom} onZoomChange={setZoom} />
        <FlowSearchPanel
          open={searchOpen}
          onOpenChange={(o) => { setSearchOpen(o); if (o) setSearchDimmed(false); }}
          query={searchQuery}
          onQueryChange={(q) => { setSearchQuery(q); setActiveMatch(null); setSearchDimmed(false); }}
          groups={searchGroups}
          totalMatches={totalMatches}
          active={activeMatch}
          onGoTo={goToMatch}
          onReplace={() => {}}
          replaceResult={null}
          dimmed={searchDimmed}
        />
        <button
          type="button"
          onClick={() => setSortLevels([])}
          disabled={sortLevels.length === 0}
          title={sortLevels.length > 0 ? 'Сбросить сортировку' : 'Сортировка — в меню колонки'}
          className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] transition-all ${
            sortLevels.length > 0
              ? 'border-accent-clay/70 text-[#0A0A0A] shadow-[0_0_7px_rgba(217,119,87,0.45)]'
              : 'cursor-default border-black/10 text-[#6B6862]/45'
          }`}
        >
          <ArrowDownUp size={13} strokeWidth={1.75} />
          Сортировка
        </button>
        {visibleLocked && (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-[#8A8782]">
            <Lock size={12} strokeWidth={1.75} />
            Редактирует: {visibleLocked.name}
          </span>
        )}
      </div>

      <div ref={measureRef} className="flow-grid relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
            Загрузка списка ВГХ…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
            <span>Список пуст — всё, что нужно для формирования, уже есть в базе ВГХ.</span>
            <span className="text-[12px] text-[#9A9792]">Пополняется автоматически при выгрузке заказов.</span>
          </div>
        )}
        {size.width > 0 && size.height > 0 && (
          <DataEditor
            ref={gridRef}
            theme={gridTheme}
            width={Math.min(size.width, contentWidth)}
            height={size.height}
            columns={columns}
            rows={viewRows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            onCellsEdited={onCellsEdited}
            onPaste={handlePaste}
            onHeaderMenuClick={handleHeaderMenuClick}
            drawCell={drawCell}
            drawHeader={drawHeader}
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            onVisibleRegionChanged={handleVisibleRegionChanged}
            highlightRegions={gridHighlights}
            getRowThemeOverride={getRowThemeOverride}
            getCellsForSelection
            rowMarkers="none"
            freezeColumns={5}
            rangeSelect="multi-rect"
            rowHeight={getRowHeight}
            headerHeight={rowH}
            smoothScrollX
            smoothScrollY
            keybindings={{ search: false }}
          />
        )}
      </div>

      {/* Статус-строка снизу (только счётчик). */}
      <div className="flex shrink-0 items-center gap-3 border-t border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        <span className="ml-auto">
          {filtered ? (
            <>Показано <span className="tabular-nums text-[#2A2925]">{viewRows.length}</span> из <span className="tabular-nums text-[#2A2925]">{rows.length}</span></>
          ) : (
            <><span className="tabular-nums text-[#2A2925]">{rows.length}</span> строк</>
          )}
        </span>
      </div>

      <FlowHeaderMenu
        state={menu}
        sortDir={menuColId ? (sortLevels.find((l) => l.colId === menuColId)?.dir ?? null) : null}
        search={menuFilter?.search ?? ''}
        values={menuValues}
        excluded={menuFilter?.excluded ?? EMPTY_SET}
        onSort={handleSort}
        onSortReset={handleSortReset}
        onSearchChange={handleSearchChange}
        onToggleValue={handleToggleValue}
        onClear={handleClearColumnFilter}
        onDeselectAll={handleDeselectAllColumn}
        onClose={() => setMenu(null)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-white/10 bg-[#302F2D] px-3.5 py-2 text-[12.5px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Захват моего lock'а на редактируемую строку (общий schedule_lock). */
function useEditLockRow(noNum: string): void {
  useEditLock(noNum ? `${LOCK_PREFIX}${noNum}` : '', !!noNum);
}
