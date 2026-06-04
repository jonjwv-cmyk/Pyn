import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  type DataEditorRef,
  GridCellKind,
  type DrawHeaderCallback,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridKeyEventArgs,
  type GridMouseEventArgs,
  type GridSelection,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid';
import { Redo2, Trash2, Undo2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { flowTwoToneRenderer, type FlowTwoCell } from './flow-composed-cells';
import { flowMolRenderer, type FlowMolCell, type FlowMolOption } from './flow-mol-cell';
import { flowDayRenderer, type FlowDayCell } from './flow-day-cell';
import { flowMatRenderer, type FlowMatCell } from './flow-mat-cell';
import { flowToRenderer, type FlowToCell, type FlowToOption } from './flow-to-cell';
import { FlowHeaderMenu, type FlowHeaderMenuAnchor } from './FlowHeaderMenu';
import { FlowZoomControl } from './FlowZoomControl';
import { FlowSearchPanel, type FlowSearchGroup } from './FlowSearchPanel';
import { ContactActionDialog, type ContactActionRequest } from '@/components/mol/ContactActionDialog';
import { useMolStore } from '@/lib/stores';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { molStatusKind, formatMobilePhone } from '@/lib/mol-format';
import {
  FLOW_COLUMNS,
  makeFlowRows,
  fmtNum3,
  flowComposed,
  flowDisplayText,
  flowCard,
  parseMol,
  rowTheme,
  dayState,
  type FlowCardLine,
  type FlowColumnSpec,
  type FlowSandboxRow,
} from './flow-sandbox.fixtures';

/** Объём тестового набора — проверяем грид на «рабочем» масштабе (база). */
const SANDBOX_ROW_COUNT = 20_000;
/** Кастомные рендереры ячеек (своя выпадашка в стиле меню колонки). */
const FLOW_RENDERERS = [
  flowDropdownRenderer,
  flowTwoToneRenderer,
  flowMolRenderer,
  flowDayRenderer,
  flowMatRenderer,
  flowToRenderer,
];
/** Базовые метрики грида при 100% (масштабируются кнопкой масштаба).
 *  Шрифт 13px (Inter) — как в сайдбаре: читаемо и компактно (вкус Linear/Figma);
 *  высота строки плотная. */
const BASE_ROW_HEIGHT = 20;
const BASE_FONT = 12;
const BASE_HPAD = 6;
const BASE_VPAD = 2;
/** Базовая ширина колонки-№ (хватает на «20000» при 13px); масштабируется зумом. */
const ROW_MARKER_BASE = 60;
/** Семейство шрифта для замера авто-ширины — ДОЛЖНО совпадать с темой грида
 *  (Inter Variable); canvas меряет по нему, иначе ширины разойдутся с рендером. */
const GRID_FONT_FAMILY =
  '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
/** Один переиспользуемый canvas-контекст для замера текста (авто-фит зовётся часто). */
const MEASURE_CTX = document.createElement('canvas').getContext('2d');
// Авто-ширина мерит по УНИКАЛЬНЫМ значениям колонки (см. computeAutoWidths).

/**
 * Авто-подгон ширины колонок по самому ШИРОКОМУ (в пикселях) содержимому, как
 * «autofit» в Excel. Берём несколько самых длинных по символам значений и меряем
 * их в ПИКСЕЛЯХ — максимум. «Самый длинный по символам» ≠ «самый широкий в пикселях»
 * (пропорциональный Inter: «Боярских Е.Н.» шире «Сидорова А.В.» при той же длине),
 * поэтому одного кандидата мало — иначе значение обрезается. Заголовку оставляем
 * место под значок меню/сортировки. Клампим [40, 420]. Пересчитывается при КАЖДОМ
 * изменении данных (всегда авто-фит) — ручного ресайза колонок нет.
 */
function computeAutoWidths(rows: readonly FlowSandboxRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const ctx = MEASURE_CTX;
  if (ctx) ctx.font = `${BASE_FONT}px ${GRID_FONT_FAMILY}`;
  const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * 7);
  for (const spec of FLOW_COLUMNS) {
    // По УНИКАЛЬНЫМ значениям (а не «самым длинным по символам»): у кодов все одной
    // длины, и «2004» с широкими цифрами иначе не попадал в выборку → резало.
    const seen = new Set<string>();
    for (const r of rows) {
      const v = flowDisplayText(spec, r);
      if (v.includes('\n')) for (const line of v.split('\n')) seen.add(line);
      else seen.add(v);
      if (seen.size >= 800) break;
    }
    let valuePx = 0;
    for (const s of seen) {
      const w = measure(s);
      if (w > valuePx) valuePx = w;
    }
    // У выпадашек справа значок ▾ — даём ему место, чтобы не наезжал на значение.
    const dropdownPad = 0; // стрелку выпадашки рисуем только на hover — место не резервируем
    const iconPad =
      spec.kind === 'mol' || spec.kind === 'time' || spec.kind === 'day' || spec.kind === 'mat'
        ? 16
        : 0;
    const valueW = valuePx + BASE_HPAD * 2 + 4 + dropdownPad + iconPad; // плотно: малый запас, но не режет
    const headerW = measure(spec.title) + BASE_HPAD * 2 + 6; // лёгкий запас под значок ▾/сортировки
    out[spec.id] = Math.round(Math.max(30, Math.min(420, Math.max(valueW, headerW))));
  }
  return out;
}
/** Потолок уникальных значений в чек-листе фильтра (защита от больших колонок). */
const MAX_DISTINCT = 2000;
const EMPTY_SET: ReadonlySet<string> = new Set();
/** Лимит ячеек для тяжёлых агрегатов (сумма/мин/макс) — защита от лагов на огромном выделении. */
const STAT_CAP = 50_000;
/** Лимит ПОКАЗЫВАЕМЫХ совпадений на колонку в поиске (полный счётчик считаем всё равно). */
const SEARCH_CAP_PER_COL = 50;
/** Потолок ПОДСВЕЧИВАЕМЫХ совпадений в гриде (защита от тысяч регионов). */
const SEARCH_HL_CAP = 4000;
/** Жёлтая подсветка совпадений (как «найти» в браузере). */
const SEARCH_HL_COLOR = 'rgba(250, 204, 21, 0.40)';
/** Активное (к которому перешли) — clay-заливка + сплошная рамка (наша, заметная). */
const SEARCH_ACTIVE_COLOR = 'rgba(217, 119, 87, 0.45)';
/** Буфер строк выше/ниже видимой зоны для подсветки (приём «не вижу — не гружу» + запас). */
const SEARCH_HL_BUFFER = 150;
/** Подсветка скопированного: чуть более тёмная clay-заливка БЕЗ обводки
 *  (`no-outline`). Показывается на выделении сразу после copy и СНИМАЕТСЯ при
 *  любой смене выделения (юзер: после ухода не должно оставаться помеченной области). */
const MARQUEE_COLOR = 'rgba(217,119,87,0.26)';

/** Пунктирная подсветка скопированного диапазона (Glide highlightRegions, style dashed). */
interface CopiedRegion {
  color: string;
  range: { x: number; y: number; width: number; height: number };
  style: 'no-outline' | 'solid' | 'dashed';
}

/** Собрать пунктирные регионы из текущего выделения (для рамки «скопировано»). */
function buildCopiedRegions(sel: GridSelection, rowCount: number): CopiedRegion[] {
  const out: CopiedRegion[] = [];
  const cur = sel.current;
  if (cur) {
    for (const r of [cur.range, ...cur.rangeStack]) {
      out.push({ color: MARQUEE_COLOR, range: { x: r.x, y: r.y, width: r.width, height: r.height }, style: 'no-outline' });
    }
  } else if (sel.columns.length > 0) {
    for (const c of sel.columns) {
      out.push({ color: MARQUEE_COLOR, range: { x: c, y: 0, width: 1, height: rowCount }, style: 'no-outline' });
    }
  } else if (sel.rows.length > 0) {
    for (const r of sel.rows) {
      out.push({ color: MARQUEE_COLOR, range: { x: 0, y: r, width: FLOW_COLUMNS.length, height: 1 }, style: 'no-outline' });
    }
  }
  return out;
}

/** Текущая сортировка (индекс колонки + направление) или её отсутствие. */
interface SortState {
  colIndex: number;
  dir: 'asc' | 'desc';
}

/** Фильтр показа одной колонки: текстовый поиск + снятые галочкой значения. */
interface ColumnFilter {
  search: string;
  excluded: Set<string>;
}

/** Глубина истории отмены/повтора (для песочницы с запасом). */
const UNDO_CAP = 200;

/**
 * Запись истории: либо изменения ячеек (правка/вставка/протяжка/очистка) —
 * карты id→изменённые поля «до» и «после»; либо удаление строк — снимок
 * удалённых вместе с ИХ позициями в источнике (чтобы вернуть на место).
 */
type FlowRowPatch = Partial<FlowSandboxRow>;
type FlowUndoEntry =
  | { kind: 'cells'; before: Map<number, FlowRowPatch>; after: Map<number, FlowRowPatch> }
  | { kind: 'delete'; removed: { index: number; row: FlowSandboxRow }[] };

/** Пустое выделение (строки/колонки/диапазон сброшены). */
function emptySelection(): GridSelection {
  return { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: undefined };
}

/** Glob-шаблон (с `*`) → анкоренный case-insensitive RegExp (для внутренних `*`). */
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
 * Матчер поиска с `*`-синтаксисом: БЕЗ `*` — ТОЧНОЕ совпадение (вся ячейка = запрос);
 * `42*` — начинается на; `*42` — заканчивается на; `*42*` — содержит. Быстрые строковые
 * операции для типовых случаев, regex — только при внутренних `*`. null = пустой запрос.
 */
function makeSearchMatcher(rawQuery: string): ((value: string) => boolean) | null {
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
  if (lead && tail) return (value) => value.toLowerCase().includes(lc);
  if (tail) return (value) => value.toLowerCase().startsWith(lc);
  if (lead) return (value) => value.toLowerCase().endsWith(lc);
  return (value) => value.toLowerCase() === lc;
}

/** Достать новое значение поля из отредактированной ячейки (с учётом типа колонки). */
function extractValue(
  spec: FlowColumnSpec,
  value: EditableGridCell,
  fallback: string | number | null,
): string | number | null {
  if (spec.kind === 'number') {
    if (value.kind === GridCellKind.Number) return value.data ?? 0;
    if (value.kind === GridCellKind.Text) {
      const n = Number(value.data.replace(',', '.'));
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }
  if (value.kind === GridCellKind.Text || value.kind === GridCellKind.Uri) return value.data;
  if (value.kind === GridCellKind.Number) return value.data != null ? String(value.data) : '';
  if (value.kind === GridCellKind.Custom) {
    const data = value.data as { kind?: string; value?: string | null };
    if (
      data.kind === 'flow-dropdown' ||
      data.kind === 'flow-mol' ||
      data.kind === 'flow-day' ||
      data.kind === 'flow-to'
    )
      return data.value ?? '';
    return fallback;
  }
  return fallback;
}

/** Сравнить две строки по колонке (число — численно, текст — по локали). */
function compareRows(
  a: FlowSandboxRow,
  b: FlowSandboxRow,
  spec: FlowColumnSpec,
  dir: 'asc' | 'desc',
): number {
  const av = a[spec.id];
  const bv = b[spec.id];
  let cmp: number;
  if (spec.kind === 'number') {
    cmp = (typeof av === 'number' ? av : Number(av)) - (typeof bv === 'number' ? bv : Number(bv));
  } else {
    cmp = String(av).localeCompare(String(bv), 'ru');
  }
  return dir === 'asc' ? cmp : -cmp;
}

/**
 * Песочница-грид раздела «Поток» (Фаза 0). Спайк движка glide-data-grid:
 * виртуализация на ~20к строк, правка ячеек, выделение строк/колонок/ячеек
 * вразнобой, удаление выбранных строк, копи+вставка диапазона, протяжка,
 * выпадашки, сортировка и ФИЛЬТР ПОКАЗА по колонке (поиск + чек-лист значений,
 * как в Google Таблицах), поиск ⌘F.
 *
 * Архитектура: `rows` — источник (со стабильным `id`); `viewRows` — производное
 * представление (фильтр + сортировка). Грид рисует `viewRows`; правки/удаление
 * пишутся в `rows` ПО id (порядок показа ≠ порядок данных). Фильтр — клиентский
 * «фильтр показа» (личный); общий (как filter-views Google) добавится на сервере.
 */
export function FlowSandboxGrid() {
  const [rows, setRows] = useState<FlowSandboxRow[]>(() => makeFlowRows(SANDBOX_ROW_COUNT));
  // Шрифт Inter мог не загрузиться к ПЕРВОМУ замеру авто-ширины → мерили системным
  // (он уже) и коды резались («6604»→«660»). Ждём шрифт и пересчитываем ширины.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.ready) {
      setFontsReady(true);
      return;
    }
    let alive = true;
    Promise.all([
      fonts.load('12px "Inter Variable"').catch(() => undefined),
      fonts.load('600 12px "Inter Variable"').catch(() => undefined),
    ]).finally(() => {
      fonts.ready.then(() => {
        if (alive) setFontsReady(true);
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  // Авто-ширина — ПРОИЗВОДНАЯ от данных: пересчитывается при изменении строк И после
  // загрузки шрифта (иначе мерили не тем шрифтом). Всегда плотно по содержимому.
  const colWidths = useMemo(() => computeAutoWidths(rows), [rows, fontsReady]);
  // Молы по складу-получателю (TO) из РЕАЛЬНОЙ базы МОЛ (useMolStore) — для выпадашки.
  const molRecords = useMolStore((s) => s.records);
  const molByWarehouse = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const map = new Map<string, FlowMolOption[]>();
    for (const r of molRecords) {
      const wid = (r.warehouseId || '').trim();
      if (!wid || !r.fio) continue;
      const phone = r.mobile || r.work || '';
      const opt: FlowMolOption = {
        fio: r.fio,
        color: COLOR[molStatusKind(r.status)],
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        until: r.warehouseUntil || '',
      };
      const arr = map.get(wid);
      if (arr) arr.push(opt);
      else map.set(wid, [opt]);
    }
    return map;
  }, [molRecords]);
  // Склады по цеху — для выпадашки TO «склады того же цеха» (из useWarehousesStore).
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const { whById, whByShop } = useMemo(() => {
    const byId = new Map<string, { shopCode: string | null; shopName: string }>();
    const byShop = new Map<string, FlowToOption[]>();
    for (const w of warehouses) {
      byId.set(w.id, { shopCode: w.shop_code, shopName: w.shop_name });
      if (w.shop_code) {
        const opt: FlowToOption = { id: w.id, desc: w.description ?? w.designation ?? '' };
        const arr = byShop.get(w.shop_code);
        if (arr) arr.push(opt);
        else byShop.set(w.shop_code, [opt]);
      }
    }
    return { whById: byId, whByShop: byShop };
  }, [warehouses]);
  const [selection, setSelection] = useState<GridSelection>(emptySelection);
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [menu, setMenu] = useState<FlowHeaderMenuAnchor | null>(null);
  const [copiedRegions, setCopiedRegions] = useState<CopiedRegion[]>([]);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const measureRef = useRef<HTMLDivElement | null>(null);
  // Всплывающая подсказка (полная дата / расчёт % / телефон-срок МОЛ / тех-имя).
  const [tooltip, setTooltip] = useState<{
    y: number;
    leftPx?: number;
    rightPx?: number;
    lines: FlowCardLine[];
  } | null>(null);
  const lastHoverRef = useRef<string>('');
  const hoverCellRef = useRef<[number, number] | null>(null);
  // Звонок по телефону МОЛ — через общий диалог-подтверждение (как в Цеха/МОЛ).
  const [contactReq, setContactReq] = useState<ContactActionRequest | null>(null);
  useEffect(() => {
    const onContact = (e: Event) => {
      const detail = (e as CustomEvent<ContactActionRequest>).detail;
      if (detail) setContactReq(detail);
    };
    window.addEventListener('flow:contact', onContact);
    return () => window.removeEventListener('flow:contact', onContact);
  }, []);
  // Поиск по таблице: ref грида (для перелёта scrollTo), открытость панели, запрос,
  // активное совпадение (подсвечивается в списке и в гриде).
  const gridRef = useRef<DataEditorRef>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState<{ colIndex: number; id: number } | null>(null);
  // «Окно поиска хочет погаснуть» — ставим после перелёта (чтобы не перекрывать результат);
  // снимаем при печати/открытии. Реально гаснет, только когда курсор не над окном.
  const [searchDimmed, setSearchDimmed] = useState(false);
  // Результат последней замены (сколько ячеек заменено) — показываем подтверждением.
  const [replaceResult, setReplaceResult] = useState<number | null>(null);
  // Окно видимых строк — подсветку поиска считаем только в нём (± буфер), как в игре:
  // «не вижу → не рисую». Ref пишем всегда (дёшево, без ре-рендера), state двигаем
  // (чанками) только при активном поиске — тогда подсветка следует за прокруткой.
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const visibleRef = useRef<{ start: number; end: number }>({ start: 0, end: 80 });
  const [visibleWindow, setVisibleWindow] = useState<{ start: number; end: number }>({ start: 0, end: 80 });
  const handleVisibleRegionChanged = useCallback((range: Rectangle) => {
    visibleRef.current = { start: range.y, end: range.y + range.height };
    if (!searchOpenRef.current) return;
    setVisibleWindow((prev) =>
      Math.abs(prev.start - range.y) >= 8 ? { start: range.y, end: range.y + range.height } : prev,
    );
  }, []);
  // При открытии поиска — синхронизируем окно с текущей зоной видимости (а не с нулём).
  useEffect(() => {
    if (searchOpen) setVisibleWindow(visibleRef.current);
  }, [searchOpen]);
  // anchor = неподвижный край выделения, focus = подвижный. Наша надстройка над
  // Glide для drag/Shift+стрелок по колонкам и строкам (движок сам так не тянет).
  const colAnchorRef = useRef<number | null>(null);
  const colFocusRef = useRef<number | null>(null);
  const rowAnchorRef = useRef<number | null>(null);
  const rowFocusRef = useRef<number | null>(null);
  // Зеркала состояния для глобального слушателя copy (читает актуальное без переподписки).
  const selectionRef = useRef<GridSelection>(selection);
  const viewRowsRef = useRef<FlowSandboxRow[]>([]);
  const rowsRef = useRef<FlowSandboxRow[]>(rows);
  // Активная сортировка по id колонки — drawHeader читает ref и рисует стрелку
  // (не дописываем стрелку в текст заголовка → ширина колонки не пухнет).
  const sortRef = useRef<{ colId: string; dir: 'asc' | 'desc' } | null>(null);
  // Колонки под активным фильтром — для согласованной (в тон заголовку) подсветки
  // значка в drawHeader.
  const filteredColsRef = useRef<Set<string>>(new Set());
  // История отмены/повтора. Стеки в ref (мутируем в обработчиках — без лишних
  // ре-рендеров грида); лёгкое состояние держит активность кнопок.
  const undoRef = useRef<FlowUndoEntry[]>([]);
  const redoRef = useRef<FlowUndoEntry[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  // Грид (canvas) требует пиксельные размеры — измеряем контейнер.
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // «Бегущая» пунктирная рамка скопированного (как Excel): на событие copy
  // фиксируем текущее выделение dashed-регионом; снимается сменой выделения.
  useEffect(() => {
    const onCopy = () => {
      setCopiedRegions(buildCopiedRegions(selectionRef.current, viewRowsRef.current.length));
    };
    window.addEventListener('copy', onCopy);
    return () => window.removeEventListener('copy', onCopy);
  }, []);

  // Представление = фильтр показа + сортировка поверх источника. Если ни фильтра,
  // ни сортировки — отдаём исходный массив без копий.
  const viewRows = useMemo<FlowSandboxRow[]>(() => {
    let out: FlowSandboxRow[] = rows;
    const active = Object.entries(filters).filter(
      ([, f]) => f.search.trim() !== '' || f.excluded.size > 0,
    );
    if (active.length > 0) {
      out = rows.filter((row) =>
        active.every(([colId, f]) => {
          const v = String(row[colId as keyof FlowSandboxRow] ?? '');
          const q = f.search.trim().toLowerCase();
          if (q && !v.toLowerCase().includes(q)) return false;
          if (f.excluded.has(v)) return false;
          return true;
        }),
      );
    }
    if (sort) {
      const spec = FLOW_COLUMNS[sort.colIndex];
      if (spec) {
        const base = out === rows ? out.slice() : out;
        base.sort((a, b) => compareRows(a, b, spec, sort.dir));
        out = base;
      }
    }
    return out;
  }, [rows, filters, sort]);

  // Зеркала для глобального слушателя copy (см. выше).
  selectionRef.current = selection;
  viewRowsRef.current = viewRows;
  rowsRef.current = rows;
  sortRef.current = sort ? { colId: FLOW_COLUMNS[sort.colIndex]?.id ?? '', dir: sort.dir } : null;
  filteredColsRef.current = new Set(
    Object.entries(filters)
      .filter(([, f]) => f.search.trim() !== '' || f.excluded.size > 0)
      .map(([id]) => id),
  );

  // Агрегаты выделения для строки-счётчика: кол-во / сумма / среднее / мин / макс.
  // Тяжёлые агрегаты считаем только до STAT_CAP ячеек (защита от лагов).
  const selStats = useMemo(() => {
    const colCount = FLOW_COLUMNS.length;
    const rowCount = viewRows.length;
    const cur = selection.current;
    let count = 0;
    if (cur) {
      count = cur.range.width * cur.range.height;
      for (const r of cur.rangeStack) count += r.width * r.height;
    } else if (selection.columns.length > 0) {
      count = selection.columns.length * rowCount;
    } else if (selection.rows.length > 0) {
      count = selection.rows.length * colCount;
    }
    if (count === 0) return null;

    let numCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    // Колонки, давшие числа: агрегаты осмысленны ТОЛЬКО если колонка одна
    // (нельзя складывать «Кол-во» с «Вес»/«Поз.» — разные величины).
    const numCols = new Set<number>();
    if (count <= STAT_CAP) {
      const add = (c: number, r: number) => {
        const spec = FLOW_COLUMNS[c];
        const row = viewRows[r];
        if (!spec || !row || spec.kind !== 'number') return;
        const v = row[spec.id];
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return;
        numCount++;
        numCols.add(c);
        sum += n;
        if (n < min) min = n;
        if (n > max) max = n;
      };
      if (cur) {
        for (const rect of [cur.range, ...cur.rangeStack]) {
          for (let r = rect.y; r < rect.y + rect.height; r++) {
            for (let c = rect.x; c < rect.x + rect.width; c++) add(c, r);
          }
        }
      } else if (selection.columns.length > 0) {
        for (const c of selection.columns) for (let r = 0; r < rowCount; r++) add(c, r);
      } else if (selection.rows.length > 0) {
        for (const r of selection.rows) for (let c = 0; c < colCount; c++) add(c, r);
      }
    }
    return {
      count,
      numCount,
      sum,
      avg: numCount ? sum / numCount : 0,
      min: numCount ? min : 0,
      max: numCount ? max : 0,
      singleNumCol: numCols.size === 1,
    };
  }, [selection, viewRows]);

  // Уникальные значения колонки открытого меню (для чек-листа фильтра).
  const menuValues = useMemo<string[]>(() => {
    if (!menu) return [];
    const spec = FLOW_COLUMNS[menu.colIndex];
    if (!spec) return [];
    const set = new Set<string>();
    for (const r of rows) {
      set.add(String(r[spec.id] ?? ''));
      if (set.size >= MAX_DISTINCT) break;
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [menu, rows]);

  // Колонки: ширина (resizable) + меню (▾) + индикаторы сортировки/фильтра в заголовке.
  const columns: GridColumn[] = useMemo(
    () =>
      FLOW_COLUMNS.map((c) => {
        const f = filters[c.id];
        const filtered = f ? f.search.trim() !== '' || f.excluded.size > 0 : false;
        // БЕЗ grow: колонка кончается ровно по содержимому (авто-ширина). Свободное
        // место справа — пустой лист (как в Excel), а не растянутые колонки.
        // Сортировка/фильтр НЕ дописываются в текст заголовка (иначе раздувают
        // ширину): стрелка сортировки рисуется в drawHeader, активный фильтр —
        // clay-подсветка заголовка через themeOverride (текст + лёгкая подложка).
        return {
          id: c.id,
          title: c.title,
          // Масштаб («лупа») множит ширину так же, как шрифт — значения не режутся.
          width: Math.round((colWidths[c.id] ?? c.width) * zoom),
          hasMenu: true,
          ...(filtered
            ? {
                themeOverride: {
                  // Непрозрачные clay-тона (clay поверх светлой шапки) — чтобы заливка
                  // значка в drawHeader НЕ накладывалась повторно и не давала тёмный «чип».
                  textHeader: '#B35E45',
                  bgHeader: '#EFE2DA',
                  bgHeaderHovered: '#EEDBD1',
                  bgHeaderHasFocus: '#EEDDD4',
                },
              }
            : {}),
        };
      }),
    [colWidths, filters, zoom],
  );

  const getCellContent = useCallback(
    (cellPos: Item): GridCell => {
      const [col, row] = cellPos;
      const spec = FLOW_COLUMNS[col];
      const rowData = viewRows[row];
      if (!spec || !rowData) return { kind: GridCellKind.Loading, allowOverlay: false };

      const raw = rowData[spec.id];
      if (spec.kind === 'number') {
        // Пусто (нет данных) → «—» (для КГ/V); РЕАЛЬНЫЙ 0 → «0,000» (Number(null)=0 не путаем).
        const empty = raw == null || raw === '';
        const num = empty ? NaN : typeof raw === 'number' ? raw : Number(raw);
        const valid = Number.isFinite(num);
        return {
          kind: GridCellKind.Number,
          data: valid ? num : undefined,
          displayData: valid ? fmtNum3(num) : spec.id === 'kg' || spec.id === 'v' ? '—' : '',
          allowOverlay: spec.editable === true,
          contentAlign: 'right',
        };
      }
      if (spec.kind === 'mol') {
        const rawMol = String(rowData.mol ?? '');
        const parsed = parseMol(rawMol);
        const curFio = parsed?.fio ?? rawMol;
        const opts = molByWarehouse.get(rowData.to_wh) ?? [];
        const matched = opts.find((o) => o.fio === curFio);
        const color = matched ? matched.color : parsed?.color ?? '#9AA0A6';
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: curFio,
          data: { kind: 'flow-mol', value: rawMol, fio: curFio, color, options: opts },
        } satisfies FlowMolCell;
      }
      if (spec.kind === 'day') {
        const s = dayState(rowData);
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: s.label,
          data: { kind: 'flow-day', value: rowData.day_wk ?? '', label: s.label, color: s.color },
        } satisfies FlowDayCell;
      }
      if (spec.kind === 'mat') {
        const by = (rowData.created_by || '').trim().toUpperCase();
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: rowData.mat ?? '',
          data: {
            kind: 'flow-mat',
            name: rowData.mat ?? '',
            warn: by !== '' && by !== 'GROKHOVSKIJ',
            lines: flowCard(spec, rowData) ?? [],
          },
        } satisfies FlowMatCell;
      }
      if (spec.kind === 'to') {
        const code = rowData.to_wh ?? '';
        const wh = whById.get(code);
        const opts = wh?.shopCode ? whByShop.get(wh.shopCode) ?? [] : [];
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: code,
          data: { kind: 'flow-to', value: code, shopName: wh?.shopName ?? '', options: opts },
        } satisfies FlowToCell;
      }
      if (spec.kind === 'dropdown') {
        const value = String(raw ?? '');
        return {
          kind: GridCellKind.Custom,
          allowOverlay: spec.editable === true,
          copyData: value,
          data: { kind: 'flow-dropdown', value, options: spec.options ?? [] },
        } satisfies FlowDropdownCell;
      }
      if (
        spec.kind === 'order' ||
        spec.kind === 'kgv' ||
        spec.kind === 'info' ||
        spec.kind === 'percent' ||
        spec.kind === 'time'
      ) {
        const parts = flowComposed(spec, rowData);
        return {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: flowDisplayText(spec, rowData),
          data: { kind: 'flow-two', ...parts },
        } satisfies FlowTwoCell;
      }
      const value = String(raw ?? '');
      // allowWrapping → перенос текста по строкам + многострочный редактор
      // (перенос строки в редакторе — Shift+Enter).
      return {
        kind: GridCellKind.Text,
        data: value,
        displayData: value,
        allowOverlay: spec.editable === true,
        allowWrapping: true,
      };
    },
    [viewRows, molByWarehouse, whById, whByShop],
  );

  // Обновить активность кнопок отмены/повтора по длине стеков.
  const syncHistory = useCallback(() => {
    setHistory({ canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0 });
  }, []);

  // Записать изменения ячеек в источник ПО id (порядок показа ≠ порядок данных).
  // Чистая запись без истории — общий путь для правки и для отмены/повтора.
  const writeCells = useCallback((changes: Map<number, FlowRowPatch>) => {
    if (changes.size === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        const u = changes.get(r.id);
        return u ? { ...r, ...u } : r;
      }),
    );
  }, []);

  // Положить запись в историю: новый шаг обнуляет «повтор» (как везде).
  const pushHistory = useCallback(
    (entry: FlowUndoEntry) => {
      undoRef.current.push(entry);
      if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
      redoRef.current = [];
      syncHistory();
    },
    [syncHistory],
  );

  // Правки (правка ячейки / протяжка / вставка диапазона / очистка) — одним
  // проходом: id → объединённые изменения полей. Параллельно копим «до»/«после»
  // для отмены; ячейки без реального изменения значения пропускаем (чистая история).
  const applyEdits = useCallback(
    (edits: readonly { location: Item; value: EditableGridCell }[]) => {
      const after = new Map<number, FlowRowPatch>();
      const before = new Map<number, FlowRowPatch>();
      for (const { location, value } of edits) {
        const [col, displayRow] = location;
        const spec = FLOW_COLUMNS[col];
        const viewRow = viewRows[displayRow];
        if (!spec || !viewRow) continue;
        const oldVal = viewRow[spec.id];
        const newVal = extractValue(spec, value, oldVal);
        if (newVal === oldVal) continue;
        after.set(viewRow.id, { ...(after.get(viewRow.id) ?? {}), [spec.id]: newVal });
        const prevBefore = before.get(viewRow.id) ?? {};
        if (!(spec.id in prevBefore)) before.set(viewRow.id, { ...prevBefore, [spec.id]: oldVal });
        // Авто-PR: смена склада-получателя → исходный склад в PR; вернули в исходный → PR очистить.
        if (spec.id === 'to_wh') {
          const oldTo = String(oldVal ?? '');
          const curPr = viewRow.pr ?? '';
          const nextPr = String(newVal) === curPr ? '' : curPr ? curPr : oldTo;
          if (nextPr !== curPr) {
            after.set(viewRow.id, { ...(after.get(viewRow.id) ?? {}), pr: nextPr });
            const pb = before.get(viewRow.id) ?? {};
            if (!('pr' in pb)) before.set(viewRow.id, { ...pb, pr: curPr });
          }
        }
      }
      if (after.size === 0) return;
      writeCells(after);
      pushHistory({ kind: 'cells', before, after });
    },
    [viewRows, writeCells, pushHistory],
  );

  const onCellEdited = useCallback(
    (cellPos: Item, value: EditableGridCell) => applyEdits([{ location: cellPos, value }]),
    [applyEdits],
  );

  const onCellsEdited = useCallback(
    (edits: readonly { location: Item; value: EditableGridCell }[]) => {
      applyEdits(edits);
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
            edits.push({
              location: [c, r],
              value: { kind: GridCellKind.Text, data: single, displayData: single, allowOverlay: true },
            });
          }
        }
        applyEdits(edits);
        return false;
      }
      return true;
    },
    [selection, applyEdits],
  );

  const selectedRowCount = selection.rows.length;

  // Удалить строки источника по id (чистая операция без истории — общий путь
  // для удаления и для повтора удаления).
  const removeRowsByIds = useCallback((ids: ReadonlySet<number>) => {
    if (ids.size === 0) return;
    setRows((prev) => prev.filter((r) => !ids.has(r.id)));
  }, []);

  // Вставить удалённые строки обратно НА ИХ места (отмена удаления). Вставляем по
  // возрастанию исходных индексов — позиции восстанавливаются точно (благодаря
  // LIFO к моменту отмены массив уже в состоянии «сразу после удаления»).
  const reinsertRows = useCallback((removed: { index: number; row: FlowSandboxRow }[]) => {
    if (removed.length === 0) return;
    setRows((prev) => {
      const next = prev.slice();
      for (const { index, row } of [...removed].sort((a, b) => a.index - b.index)) {
        next.splice(Math.min(index, next.length), 0, row);
      }
      return next;
    });
  }, []);

  // Удаление выбранных строк с записью в историю (снимаем их позиции в источнике).
  const deleteRows = useCallback(
    (ids: ReadonlySet<number>) => {
      if (ids.size === 0) return;
      const removed: { index: number; row: FlowSandboxRow }[] = [];
      rowsRef.current.forEach((r, index) => {
        if (ids.has(r.id)) removed.push({ index, row: r });
      });
      removeRowsByIds(ids);
      pushHistory({ kind: 'delete', removed });
      setSelection(emptySelection());
    },
    [removeRowsByIds, pushHistory],
  );

  const deleteSelectedRows = useCallback(() => {
    const ids = new Set<number>();
    for (const r of selection.rows) {
      const vr = viewRows[r];
      if (vr) ids.add(vr.id);
    }
    deleteRows(ids);
  }, [selection, viewRows, deleteRows]);

  // Клавиша Delete/Backspace: выделены СТРОКИ — удаляем их (с историей); иначе —
  // стандартная очистка ячеек Glide, которая идёт через applyEdits (тоже в истории).
  const handleDelete = useCallback(
    (sel: GridSelection): GridSelection | boolean => {
      if (sel.rows.length > 0) {
        const ids = new Set<number>();
        for (const r of sel.rows) {
          const vr = viewRows[r];
          if (vr) ids.add(vr.id);
        }
        deleteRows(ids);
        return false;
      }
      return true;
    },
    [viewRows, deleteRows],
  );

  // Отмена/повтор: применяем обратную/прямую сторону последней записи. Правка идёт
  // через тот же writeCells/remove — в Фазе 1 здесь же уйдёт серверный патч.
  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    if (entry.kind === 'cells') writeCells(entry.before);
    else reinsertRows(entry.removed);
    redoRef.current.push(entry);
    // Выделение НЕ сбрасываем — после «назад» отменённые ячейки остаются
    // выделенными (как в Google/Excel), панель снизу не слетает.
    syncHistory();
  }, [writeCells, reinsertRows, syncHistory]);

  const redo = useCallback(() => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    if (entry.kind === 'cells') writeCells(entry.after);
    else removeRowsByIds(new Set(entry.removed.map((x) => x.row.id)));
    undoRef.current.push(entry);
    syncHistory();
  }, [writeCells, removeRowsByIds, syncHistory]);

  // Glide шлёт сюда изменения выделения (клик/Shift/Ctrl). Запоминаем якорь+фокус
  // одиночно выбранной колонки/строки (для drag и Shift+стрелок) и снимаем рамку
  // «скопировано» при любой смене выделения.
  const handleSelectionChange = useCallback((sel: GridSelection) => {
    if (sel.columns.length === 1 && sel.rows.length === 0) {
      const c = sel.columns.first() ?? null;
      colAnchorRef.current = c;
      colFocusRef.current = c;
    } else if (sel.columns.length === 0) {
      colAnchorRef.current = null;
      colFocusRef.current = null;
    }
    if (sel.rows.length === 1 && sel.columns.length === 0) {
      const r = sel.rows.first() ?? null;
      rowAnchorRef.current = r;
      rowFocusRef.current = r;
    } else if (sel.rows.length === 0) {
      rowAnchorRef.current = null;
      rowFocusRef.current = null;
    }
    // Снимаем подсветку «скопировано» при ЛЮБОЙ смене выделения — после ухода
    // не должно оставаться помеченной области (правка юзера).
    setCopiedRegions([]);
    setSelection(sel);
  }, []);

  // Наша надстройка над Glide: перетаскивание курсором по ЗАГОЛОВКАМ выделяет
  // колонки (как строки слева). Glide сам колонки drag'ом не тянет — расширяем
  // выделение от якоря до текущей колонки, пока зажата кнопка.
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      // Подсказка (полная дата / расчёт % / телефон-срок МОЛ / тех-имя) — на ячейке.
      if (args.kind === 'cell') {
        const [hc, hr] = args.location;
        // Перерисовать прошлую/текущую ячейку, чтобы ▾ раскрытия чётко появлялась/гасла
        // на hover (Glide сам кастом-ячейку по уходу курсора не перерисовывает → залипала).
        const prev = hoverCellRef.current;
        if (!prev || prev[0] !== hc || prev[1] !== hr) {
          const dmg: { cell: [number, number] }[] = [{ cell: [hc, hr] }];
          if (prev) dmg.push({ cell: prev });
          gridRef.current?.updateCells(dmg);
          hoverCellRef.current = [hc, hr];
        }
        const hspec = FLOW_COLUMNS[hc];
        const hrow = viewRows[hr];
        // MAT — карточка по клику; МОЛ — выпадашка по двойному клику. На hover карточек НЕТ.
        const lines =
          hspec && hrow && hspec.id !== 'mat' && hspec.id !== 'mol' ? flowCard(hspec, hrow) : null;
        const key = lines ? `${hc}:${hr}` : '';
        if (key !== lastHoverRef.current) {
          lastHoverRef.current = key;
          if (lines) {
            // Карточку — СБОКУ от ячейки (не перекрывать колонку): вправо, а у правого
            // края листа — влево.
            const cw = measureRef.current?.clientWidth ?? 0;
            const toLeft = args.bounds.x + args.bounds.width / 2 > cw / 2;
            setTooltip({
              y: args.bounds.y,
              lines,
              ...(toLeft
                ? { rightPx: cw - args.bounds.x + 8 }
                : { leftPx: args.bounds.x + args.bounds.width + 8 }),
            });
          } else {
            setTooltip(null);
          }
        }
      } else {
        if (hoverCellRef.current) {
          gridRef.current?.updateCells([{ cell: hoverCellRef.current }]);
          hoverCellRef.current = null;
        }
        if (lastHoverRef.current !== '') {
          lastHoverRef.current = '';
          setTooltip(null);
        }
      }
      // Надстройка над Glide: перетаскивание по ЗАГОЛОВКАМ выделяет колонки.
      if (args.buttons === 0 || args.kind !== 'header') return;
      const col = args.location[0];
      const anchor = colAnchorRef.current;
      if (col < 0 || anchor === null) return;
      colFocusRef.current = col;
      setSelection({
        columns: CompactSelection.fromSingleSelection([
          Math.min(anchor, col),
          Math.max(anchor, col) + 1,
        ]),
        rows: CompactSelection.empty(),
        current: undefined,
      });
    },
    [viewRows],
  );

  // Shift+стрелки расширяют выделение КОЛОНОК (←/→) и СТРОК (↑/↓) от якоря.
  // Для ячеек Shift+стрелки работают нативно в Glide — туда не вмешиваемся.
  const handleKeyDown = useCallback((e: GridKeyEventArgs) => {
    if (e.key === 'Escape') {
      setCopiedRegions([]); // Escape снимает рамку «скопировано» (как в Excel)
      setSearchOpen(false); // и закрывает поиск
      return;
    }
    // Поиск по таблице — ⌘F / Ctrl+F (наша панель, не встроенный поиск Glide).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.cancel();
      setSearchOpen(true);
      return;
    }
    // Отмена/повтор: ⌘Z / Ctrl+Z, повтор — ⌘⇧Z / Ctrl+Y (как в редакторах).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.cancel();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.cancel();
      redo();
      return;
    }
    if (!e.shiftKey) return;
    if (
      colAnchorRef.current !== null &&
      colFocusRef.current !== null &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
    ) {
      e.cancel();
      const lastCol = FLOW_COLUMNS.length - 1;
      const focus = Math.max(0, Math.min(lastCol, colFocusRef.current + (e.key === 'ArrowRight' ? 1 : -1)));
      colFocusRef.current = focus;
      const a = colAnchorRef.current;
      setSelection({
        columns: CompactSelection.fromSingleSelection([Math.min(a, focus), Math.max(a, focus) + 1]),
        rows: CompactSelection.empty(),
        current: undefined,
      });
      return;
    }
    if (
      rowAnchorRef.current !== null &&
      rowFocusRef.current !== null &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp')
    ) {
      e.cancel();
      const lastRow = viewRowsRef.current.length - 1;
      const focus = Math.max(0, Math.min(lastRow, rowFocusRef.current + (e.key === 'ArrowDown' ? 1 : -1)));
      rowFocusRef.current = focus;
      const a = rowAnchorRef.current;
      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.fromSingleSelection([Math.min(a, focus), Math.max(a, focus) + 1]),
        current: undefined,
      });
    }
  }, [undo, redo]);

  // — меню колонки (сортировка + фильтр) —
  const handleHeaderMenuClick = useCallback(
    (colIndex: number, bounds: { x: number; y: number; width: number; height: number }) => {
      const spec = FLOW_COLUMNS[colIndex];
      if (!spec) return;
      setMenu({ colIndex, title: spec.title, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    },
    [],
  );

  const menuColId = menu ? FLOW_COLUMNS[menu.colIndex]?.id : undefined;
  const menuFilter = menuColId ? filters[menuColId] : undefined;

  const handleSort = useCallback(
    (dir: 'asc' | 'desc') => {
      if (!menu) return;
      setSort({ colIndex: menu.colIndex, dir });
      setSelection(emptySelection());
    },
    [menu],
  );

  const handleSortReset = useCallback(() => {
    setSort(null);
    setSelection(emptySelection());
  }, []);

  const updateColumnFilter = useCallback(
    (colId: string, updater: (cur: ColumnFilter) => ColumnFilter) => {
      setFilters((prev) => ({
        ...prev,
        [colId]: updater(prev[colId] ?? { search: '', excluded: new Set<string>() }),
      }));
      setSelection(emptySelection());
    },
    [],
  );

  const handleSearchChange = useCallback(
    (q: string) => {
      if (!menuColId) return;
      updateColumnFilter(menuColId, (cur) => ({ search: q, excluded: cur.excluded }));
    },
    [menuColId, updateColumnFilter],
  );

  const handleToggleValue = useCallback(
    (value: string) => {
      if (!menuColId) return;
      updateColumnFilter(menuColId, (cur) => {
        const excluded = new Set(cur.excluded);
        if (excluded.has(value)) excluded.delete(value);
        else excluded.add(value);
        return { search: cur.search, excluded };
      });
    },
    [menuColId, updateColumnFilter],
  );

  const handleCheckAll = useCallback(() => {
    if (!menuColId) return;
    updateColumnFilter(menuColId, (cur) => ({ search: cur.search, excluded: new Set<string>() }));
  }, [menuColId, updateColumnFilter]);

  const handleUncheckAll = useCallback(() => {
    if (!menuColId) return;
    updateColumnFilter(menuColId, (cur) => ({ search: cur.search, excluded: new Set(menuValues) }));
  }, [menuColId, menuValues, updateColumnFilter]);

  // Масштаб: единый множитель для шрифтов, отступов и высоты строки.
  const gridTheme = useMemo(
    () => ({
      ...FLOW_GRID_THEME,
      baseFontStyle: `${Math.round(BASE_FONT * zoom)}px`,
      headerFontStyle: `600 ${Math.round(BASE_FONT * zoom)}px`,
      editorFontSize: `${Math.round(BASE_FONT * zoom)}px`,
      cellHorizontalPadding: Math.max(4, Math.round(BASE_HPAD * zoom)),
      cellVerticalPadding: Math.max(2, Math.round(BASE_VPAD * zoom)),
    }),
    [zoom],
  );
  const rowH = Math.round(BASE_ROW_HEIGHT * zoom);
  // Переменная высота строки: растёт под ручные переносы (\n, Shift+Enter) в
  // текстовых ячейках, чтобы многострочный текст помещался.
  const getRowHeight = useCallback(
    (row: number): number => {
      const r = viewRows[row];
      if (!r) return rowH;
      let maxLines = 1;
      for (const spec of FLOW_COLUMNS) {
        if (spec.kind !== 'text') continue;
        const v = r[spec.id];
        if (typeof v === 'string' && v.includes('\n')) {
          const lines = v.split('\n').length;
          if (lines > maxLines) maxLines = lines;
        }
      }
      return maxLines <= 1 ? rowH : rowH + (maxLines - 1) * Math.round(BASE_FONT * zoom * 1.3);
    },
    [viewRows, rowH, zoom],
  );
  // Условное форматирование строки — мягкий фон по статусу (перенос из Google-листа,
  // адаптирован под светлый лист; clay-выделение читается поверх).
  const getRowThemeOverride = useCallback(
    (row: number) => {
      const r = viewRows[row];
      if (!r) return undefined;
      const t = rowTheme(r);
      if (!t) return undefined;
      const o: { bgCell?: string; bgCellMedium?: string; textDark?: string } = {};
      if (t.bg) {
        o.bgCell = t.bg;
        o.bgCellMedium = t.bg;
      }
      if (t.text) o.textDark = t.text;
      return o;
    },
    [viewRows],
  );
  // Индикаторы в шапке поверх дефолта Glide, в одной точке справа: стрелка МЕНЮ (▾)
  // на hover (приоритет) и стрелка СОРТИРОВКИ (↑/↓) — всегда, когда колонка
  // отсортирована. Рисуем на canvas (текст заголовка не трогаем → ширина плотная).
  // Затираем только узкий «чип» под значком, чтобы на тесных колонках не съесть текст.
  const drawHeader = useCallback<DrawHeaderCallback>((args, drawContent) => {
    drawContent();
    // Только для колонок с меню (не для гаттера-маркера строк — он тоже проходит сюда).
    if (args.column.hasMenu !== true) return;
    const { ctx, menuBounds, theme, isSelected, hasSelectedCell, isHovered } = args;
    const s = sortRef.current;
    const sortedDir = s && s.colId === args.column.id ? s.dir : null;
    if (!isHovered && !sortedDir) return; // ни меню (hover), ни сортировки — нечего рисовать
    const cx = menuBounds.x + menuBounds.width - 13;
    const cy = menuBounds.y + menuBounds.height / 2;
    ctx.save();
    // Узкий чип-подложка под значком фоном текущего состояния (выделен → accentColor;
    // фокус ячейки → bgHeaderHasFocus; hover → bgHeaderHovered; иначе bgHeader —
    // на отфильтрованной колонке это clay-тинт). Чтобы значок читался поверх текста.
    ctx.fillStyle = isSelected
      ? theme.accentColor
      : hasSelectedCell
        ? theme.bgHeaderHasFocus ?? theme.bgHeader ?? '#ECEBE5'
        : isHovered
          ? theme.bgHeaderHovered ?? theme.bgHeader ?? '#ECEBE5'
          : theme.bgHeader ?? '#ECEBE5';
    ctx.fillRect(cx - 8, menuBounds.y, 18, menuBounds.height);
    // Тонкая СТРЕЛКА (линия + наконечник, как у сортировки — НЕ «галка»-шеврон).
    // Белая на clay-выделении; на отфильтрованной колонке — в тон её clay-заголовку
    // (#B35E45), иначе — акцентный clay (#D97757).
    const filtered = filteredColsRef.current.has(args.column.id ?? '');
    ctx.strokeStyle = isSelected ? '#FFFFFF' : filtered ? '#B35E45' : '#D97757';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (isHovered || sortedDir === 'desc') {
      // ↓ вниз: меню (на hover) / сортировка по убыванию — линия + наконечник снизу
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx, cy + 4);
      ctx.moveTo(cx - 2.5, cy + 1.5);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx + 2.5, cy + 1.5);
    } else {
      // ↑ вверх: сортировка по возрастанию — линия + наконечник сверху
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx, cy - 4);
      ctx.moveTo(cx - 2.5, cy - 1.5);
      ctx.lineTo(cx, cy - 4);
      ctx.lineTo(cx + 2.5, cy - 1.5);
    }
    ctx.stroke();
    ctx.restore();
  }, []);

  const filtered = viewRows.length !== rows.length;

  // Ширина «листа» = колонка-№ + сумма колонок + место под вертикальную полосу
  // прокрутки и границу последней колонки. Если влезает в окно — рисуем РОВНО
  // столько: справа нет пустых «фантомных» колонок, но граница последней видна и
  // полоса прокрутки помещается. Шире окна → width = окно + горизонтальная полоса.
  const contentWidth = useMemo(() => {
    const marker = Math.round(ROW_MARKER_BASE * zoom);
    const cols = FLOW_COLUMNS.reduce(
      (sum, c) => sum + Math.round((colWidths[c.id] ?? c.width) * zoom),
      0,
    );
    return marker + cols + 12; // +12: полоса прокрутки (~10) + граница/зазор
  }, [colWidths, zoom]);

  // Матчер с `*`-синтаксисом (точное / начинается / заканчивается / содержит).
  const searchMatcher = useMemo(() => makeSearchMatcher(searchQuery), [searchQuery]);

  // Поиск по ВСЕЙ базе (rows), сгруппирован ПО КОЛОНКАМ — видно, где найдено
  // (заказ/склад/телефон). Показываемые усечены до лимита, полный счётчик — всё равно.
  const searchGroups = useMemo<FlowSearchGroup[]>(() => {
    if (!searchMatcher) return [];
    const groups: FlowSearchGroup[] = [];
    FLOW_COLUMNS.forEach((spec, colIndex) => {
      const matches: { id: number; value: string }[] = [];
      let total = 0;
      for (const row of rows) {
        const value = String(row[spec.id] ?? '');
        if (searchMatcher(value)) {
          total++;
          if (matches.length < SEARCH_CAP_PER_COL) matches.push({ id: row.id, value });
        }
      }
      if (total > 0) groups.push({ colIndex, title: spec.title, matches, total });
    });
    return groups;
  }, [searchMatcher, rows]);
  const totalMatches = useMemo(() => searchGroups.reduce((s, g) => s + g.total, 0), [searchGroups]);

  // id строки → индекс показа (viewRow): для перелёта/подсветки (порядок показа ≠ данных).
  const idToViewRow = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < viewRows.length; i++) {
      const vr = viewRows[i];
      if (vr) map.set(vr.id, i);
    }
    return map;
  }, [viewRows]);

  // Жёлтая подсветка совпадений ТОЛЬКО в видимой зоне ± буфер (а не по всей таблице) —
  // поэтому в видимой части отметки есть всегда и не упираются в общий лимит; пересчёт
  // идёт за прокруткой (visibleWindow). Скрытые фильтром строки не подсвечиваются.
  const searchMatchRegions = useMemo<CopiedRegion[]>(() => {
    if (!searchOpen || !searchMatcher) return [];
    const from = Math.max(0, visibleWindow.start - SEARCH_HL_BUFFER);
    const to = Math.min(viewRows.length, visibleWindow.end + SEARCH_HL_BUFFER);
    const out: CopiedRegion[] = [];
    for (let r = from; r < to && out.length < SEARCH_HL_CAP; r++) {
      const vr = viewRows[r];
      if (!vr) continue;
      for (let c = 0; c < FLOW_COLUMNS.length; c++) {
        const spec = FLOW_COLUMNS[c];
        if (spec && searchMatcher(String(vr[spec.id] ?? ''))) {
          out.push({ color: SEARCH_HL_COLOR, range: { x: c, y: r, width: 1, height: 1 }, style: 'no-outline' });
          if (out.length >= SEARCH_HL_CAP) break;
        }
      }
    }
    return out;
  }, [searchOpen, searchMatcher, viewRows, visibleWindow]);

  // Активное совпадение — clay-заливка + сплошная рамка (наша, заметная).
  const activeRegion = useMemo<CopiedRegion | null>(() => {
    if (!searchOpen || !activeMatch) return null;
    const vr = idToViewRow.get(activeMatch.id);
    if (vr === undefined) return null;
    return {
      color: SEARCH_ACTIVE_COLOR,
      range: { x: activeMatch.colIndex, y: vr, width: 1, height: 1 },
      style: 'solid',
    };
  }, [searchOpen, activeMatch, idToViewRow]);

  // Итоговые регионы грида: copy-метка + жёлтые совпадения + активное (поверх).
  const gridHighlights = useMemo<CopiedRegion[]>(
    () => [...copiedRegions, ...searchMatchRegions, ...(activeRegion ? [activeRegion] : [])],
    [copiedRegions, searchMatchRegions, activeRegion],
  );

  // Клик по совпадению: ЛЕТИМ СРАЗУ (scrollTo синхронно — на любую строку, с первого
  // клика). Фокус гриду НЕ передаём: при плавной прокрутке к ДАЛЬНИМ строкам он перебивал
  // анимацию (ближние работали, дальние — со второго клика). Метку даёт активный
  // clay-регион (activeRegion) — он не зависит от фокуса и рисуется на любой строке,
  // как только она въезжает в зону видимости.
  const goToMatch = useCallback(
    (colIndex: number, id: number) => {
      const vr = idToViewRow.get(id);
      if (vr === undefined) return;
      const fly = () =>
        gridRef.current?.scrollTo(colIndex, vr, 'both', 0, 0, { hAlign: 'center', vAlign: 'center' });
      // Дальние строки: один scrollTo «не доезжает» (грид ещё не перерисовался под новое
      // состояние) — отсюда «помогает второй клик». Повторяем прокрутку на следующих
      // кадрах, после перерисовки — точное приземление за один клик. Если уже на месте —
      // повторы безвредны (no-op).
      fly();
      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: { cell: [colIndex, vr], range: { x: colIndex, y: vr, width: 1, height: 1 }, rangeStack: [] },
      });
      setActiveMatch({ colIndex, id });
      setSearchDimmed(true); // перелетели — окно гаснет, чтобы не перекрывать результат
      requestAnimationFrame(() => {
        fly();
        requestAnimationFrame(fly);
      });
    },
    [idToViewRow],
  );

  // Заменить значение во ВСЕХ найденных ячейках (по всей базе) на новое — целиком.
  // Через writeCells + историю (Ctrl+Z отменит). Число-колонкам — только валидное число.
  const replaceAll = useCallback(
    (replacement: string) => {
      if (!searchMatcher) return;
      const before = new Map<number, FlowRowPatch>();
      const after = new Map<number, FlowRowPatch>();
      let changed = 0;
      for (const row of rows) {
        for (const spec of FLOW_COLUMNS) {
          const cur = row[spec.id];
          if (!searchMatcher(String(cur ?? ''))) continue;
          let next: string | number = replacement;
          if (spec.kind === 'number') {
            const n = Number(replacement.replace(',', '.'));
            if (!Number.isFinite(n)) continue; // нечисло в числовую колонку — пропускаем
            next = n;
          }
          if (next === cur) continue;
          const b = before.get(row.id) ?? {};
          if (!(spec.id in b)) before.set(row.id, { ...b, [spec.id]: cur });
          after.set(row.id, { ...(after.get(row.id) ?? {}), [spec.id]: next });
          changed++;
        }
      }
      if (after.size > 0) {
        writeCells(after);
        pushHistory({ kind: 'cells', before, after });
        setActiveMatch(null);
      }
      setReplaceResult(changed); // подтверждение «заменено N» (0 = ничего не подошло)
    },
    [searchMatcher, rows, writeCells, pushHistory],
  );

  return (
    // Светлый «лист»: вся док-зона раздела (инфо-строка + грид) светлая, всегда —
    // независимо от темы приложения (читабельность). Тёмный хром обрамляет её.
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      {/* Тонкий тулбар на светлом листе: отмена/повтор → масштаб; справа (контекстно) —
          удаление выбранных строк. Описательный текст убран (минимализм). */}
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-1.5">
        {/* Отмена / повтор. */}
        <div className="flex items-center rounded-md border border-black/10">
          <button
            type="button"
            onClick={undo}
            disabled={!history.canUndo}
            className="flex h-6 w-7 items-center justify-center text-[#6B6862] transition-colors hover:text-[#0A0A0A] disabled:opacity-30 disabled:hover:text-[#6B6862]"
            title="Отменить (⌘Z)"
          >
            <Undo2 size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.canRedo}
            className="flex h-6 w-7 items-center justify-center text-[#6B6862] transition-colors hover:text-[#0A0A0A] disabled:opacity-30 disabled:hover:text-[#6B6862]"
            title="Повторить (⌘⇧Z)"
          >
            <Redo2 size={14} strokeWidth={1.75} />
          </button>
        </div>
        {/* Масштаб «как в Google»: лупа+процент → ввод руками или пресет (лупа = увеличение,
            всё масштабируется пропорционально, значения не режутся). */}
        <FlowZoomControl zoom={zoom} onZoomChange={setZoom} />
        {/* Поиск — кнопка-пилюля разворачивает окно ПОД СОБОЙ (своя панель, по колонкам). */}
        <FlowSearchPanel
          open={searchOpen}
          onOpenChange={(o) => {
            setSearchOpen(o);
            if (o) {
              setSearchDimmed(false);
              setReplaceResult(null);
            }
          }}
          query={searchQuery}
          onQueryChange={(q) => {
            setSearchQuery(q);
            setActiveMatch(null);
            setSearchDimmed(false);
            setReplaceResult(null);
          }}
          groups={searchGroups}
          totalMatches={totalMatches}
          active={activeMatch}
          onGoTo={goToMatch}
          onReplace={replaceAll}
          replaceResult={replaceResult}
          dimmed={searchDimmed}
        />
        {selectedRowCount > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[12px] text-[#6B6862]">
            <span className="tabular-nums text-[#2A2925]">Выбрано строк: {selectedRowCount}</span>
            <button
              type="button"
              onClick={deleteSelectedRows}
              className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Удалить
            </button>
          </div>
        )}
      </div>

      <div
        ref={measureRef}
        className="flow-grid relative min-h-0 flex-1"
        onMouseLeave={() => {
          if (hoverCellRef.current) {
            gridRef.current?.updateCells([{ cell: hoverCellRef.current }]);
            hoverCellRef.current = null;
          }
          lastHoverRef.current = '';
          setTooltip(null);
        }}
      >
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
            onDelete={handleDelete}
            onHeaderMenuClick={handleHeaderMenuClick}
            drawHeader={drawHeader}
            gridSelection={selection}
            onGridSelectionChange={handleSelectionChange}
            onItemHovered={handleItemHovered}
            onKeyDown={handleKeyDown}
            onVisibleRegionChanged={handleVisibleRegionChanged}
            highlightRegions={gridHighlights}
            getRowThemeOverride={getRowThemeOverride}
            customRenderers={FLOW_RENDERERS}
            getCellsForSelection
            fillHandle
            rowMarkers="clickable-number"
            rowMarkerWidth={Math.round(ROW_MARKER_BASE * zoom)}
            rowSelect="multi"
            columnSelect="multi"
            rangeSelect="multi-rect"
            rowHeight={getRowHeight}
            headerHeight={rowH}
            smoothScrollX
            smoothScrollY
            keybindings={{ search: false }}
          />
        )}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-30 max-w-[300px] rounded-md border border-white/10 bg-[#302F2D] px-2.5 py-1.5 text-[12px] leading-relaxed shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            style={{ top: tooltip.y, left: tooltip.leftPx, right: tooltip.rightPx }}
          >
            <CardLines lines={tooltip.lines} />
          </div>
        )}
      </div>

      {/* Статус-строка снизу (Excel-style) — ВСЕГДА видна. Слева — агрегаты выделения
          (как было), справа — объём: «Показано X из Y» при фильтре, иначе «Y строк». */}
      <div className="flex shrink-0 items-center gap-3 border-t border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        {selStats && (
          <>
            <span>
              Выделено:{' '}
              <span className="tabular-nums text-[#2A2925]">{selStats.count.toLocaleString('ru-RU')}</span>
            </span>
            {selStats.numCount > 0 && selStats.singleNumCol && (
              <>
                <span className="text-black/25">·</span>
                <FlowStat label="Сумма" value={selStats.sum} />
                <FlowStat label="Среднее" value={selStats.avg} />
                <FlowStat label="Мин" value={selStats.min} />
                <FlowStat label="Макс" value={selStats.max} />
              </>
            )}
          </>
        )}
        {/* Объём — справа: «Показано X из Y» (фильтр) либо «Y строк». */}
        <span className="ml-auto">
          {filtered ? (
            <>
              Показано{' '}
              <span className="tabular-nums text-[#2A2925]">{viewRows.length.toLocaleString('ru-RU')}</span> из{' '}
              <span className="tabular-nums text-[#2A2925]">{rows.length.toLocaleString('ru-RU')}</span>
            </>
          ) : (
            <>
              <span className="tabular-nums text-[#2A2925]">{rows.length.toLocaleString('ru-RU')}</span> строк
            </>
          )}
        </span>
      </div>

      <FlowHeaderMenu
        state={menu}
        sortDir={menu && sort?.colIndex === menu.colIndex ? sort.dir : null}
        search={menuFilter?.search ?? ''}
        values={menuValues}
        excluded={menuFilter?.excluded ?? EMPTY_SET}
        onSort={handleSort}
        onSortReset={handleSortReset}
        onSearchChange={handleSearchChange}
        onToggleValue={handleToggleValue}
        onCheckAll={handleCheckAll}
        onUncheckAll={handleUncheckAll}
        onClose={() => setMenu(null)}
      />
      <ContactActionDialog request={contactReq} onClose={() => setContactReq(null)} />
    </div>
  );
}

/** Строки карточки/подсказки: пилюля МОЛ (статус) либо текст (тех-имя без переноса). */
function CardLines({ lines }: { lines: FlowCardLine[] }) {
  return (
    <>
      {lines.map((ln, i) =>
        ln.pill ? (
          <div key={i} className="mb-0.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-text-strong"
              style={{ backgroundColor: ln.pill + '2E' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ln.pill }} />
              {ln.t}
            </span>
          </div>
        ) : (
          <div
            key={i}
            className={`${ln.muted ? 'text-text-muted/80' : 'text-text-secondary'}${ln.nowrap ? ' whitespace-nowrap' : ''}`}
          >
            {ln.t}
          </div>
        ),
      )}
    </>
  );
}

/** Один агрегат строки-счётчика (подпись + число) на светлом листе. */
function FlowStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label}:{' '}
      <span className="tabular-nums text-[#2A2925]">
        {value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
      </span>
    </span>
  );
}
