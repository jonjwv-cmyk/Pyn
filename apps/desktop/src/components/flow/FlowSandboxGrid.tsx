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
  type GridKeyEventArgs,
  type GridMouseEventArgs,
  type GridSelection,
  type Item,
  type Rectangle,
  type Theme,
} from '@glideapps/glide-data-grid';
import { AlertTriangle, CalendarDays, ChevronDown, Redo2, Trash2, Undo2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
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
import { MonthYearPicker } from '@/components/schedule/MonthYearPicker';
import { MONTH_NAMES_RU } from '@/lib/schedule/compute';
import {
  FLOW_COLUMNS,
  makeFlowRows,
  fmtNum3,
  flowComposed,
  flowDisplayText,
  flowCard,
  needsWarn,
  parseMol,
  rowTheme,
  dayState,
  colFontPx,
  isBoldCol,
  compactFio,
  molInitials,
  FLOW_FONT_PX_DEFAULT,
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
/** Минимальная ширина «резиновой» колонки NOTE — ýже не даём (дальше горизонт. скролл). */
const NOTE_MIN_WIDTH = 160;
/** Шрифт ЗНАЧЕНИЙ по умолчанию (px при 100%) — мельче колонки задаёт colFontPx. */
const BASE_FONT = FLOW_FONT_PX_DEFAULT;
/** Шрифт ЗАГОЛОВКОВ колонок — оставляем 12 (значения уменьшили, шапку нет). */
const HEADER_FONT = 12;
/** Горизонтальный отступ контента в ячейке — компактно (юзер: меньше пустоты у границ). */
const BASE_HPAD = 4;
const BASE_VPAD = 2;
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
/** ПОЛНОЕ ФИО МОЛ: из живой базы по ключу «фамилия имя», иначе как в снимке. В ЯЧЕЙКЕ
 *  показываем его компактно (compactFio), в выпадашке-списке — целиком. */
function resolveMolFull(
  rawMol: string,
  molByKey?: ReadonlyMap<string, { fio: string; color: string }>,
): string {
  const f = parseMol(rawMol)?.fio ?? rawMol;
  if (!f) return '';
  return molByKey?.get(molKey(f))?.fio ?? f;
}

function computeAutoWidths(
  rows: readonly FlowSandboxRow[],
  molByKey?: ReadonlyMap<string, { fio: string; color: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const ctx = MEASURE_CTX;
  const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * 7);
  for (const spec of FLOW_COLUMNS) {
    // Меряем РОВНО тем, чем рисуем: значения — кеглем колонки + её жирностью (жирный
    // текст шире!), заголовок (ниже) — кеглем колонки и весом 600. Иначе подгонка врёт.
    const boldVal = isBoldCol(spec.id) || spec.id === 'pct'; // % жирнит своя ячейка
    if (ctx) ctx.font = `${boldVal ? '600 ' : ''}${colFontPx(spec.id)}px ${GRID_FONT_FAMILY}`;
    // По УНИКАЛЬНЫМ значениям (а не «самым длинным по символам»): у кодов все одной
    // длины, и «2004» с широкими цифрами иначе не попадал в выборку → резало.
    const seen = new Set<string>();
    for (const r of rows) {
      // МОЛ — по КОМПАКТНОМУ ФИО (его и рисует ячейка), прочее — как обычно.
      const v =
        spec.kind === 'mol'
          ? compactFio(resolveMolFull(String(r.mol ?? ''), molByKey))
          : flowDisplayText(spec, r);
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
    // Заголовок рисуется кеглем СВОЕЙ колонки, жирным (700) — мерим так же, иначе у
    // мелких колонок шапка считалась шире и колонка раздувалась впустую.
    if (ctx) ctx.font = `800 ${colFontPx(spec.id)}px ${GRID_FONT_FAMILY}`;
    const headerW = measure(spec.title) + BASE_HPAD * 2 + 6; // лёгкий запас под значок ▾/сортировки
    out[spec.id] = Math.round(Math.max(30, Math.min(420, Math.max(valueW, headerW))));
  }
  return out;
}
/** Кэш числа строк переноса (ключ: шрифт+ширина+текст) — чтобы getRowHeight не мерил
 *  одно и то же повторно при прокрутке. Растёт ограниченно. */
const WRAP_CACHE = new Map<string, number>();
/** Сколько визуальных строк займёт текст в колонке шириной maxWidth (учёт явных \n +
 *  мягкий перенос по словам). Для «резиновой» колонки NOTE — строка растёт под текст. */
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
    if (para === '') {
      total += 1;
      continue;
    }
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
  const result = Math.max(1, total);
  if (WRAP_CACHE.size < 40000) WRAP_CACHE.set(key, result);
  return result;
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
const MARQUEE_COLOR = 'rgba(217,119,87,0.42)';

/** Перелив по NEW-строкам (day_wk='new'): ПОСТОЯННЫЙ плавный оранжевый градиент —
 *  мягкие волны медленно текут вдоль строки (всегда видно, что строка новая). */
const SWEEP_CYCLE_MS = 3000; // период дрейфа (медленно, плавно)
const SWEEP_WAVES = 2; // сколько мягких волн по ширине строки
// Цвета «живого» переливающегося фона по типу строки (сочные, не бледные): NEW —
// оранжевый, STAT «вопрос» — насыщенный янтарь. base = фон в провале волны, peak = пик.
const SWEEP_NEW = { rgb: '247,130,22', base: 0.18, peak: 0.52 };
const SWEEP_VOPROS = { rgb: '233,176,30', base: 0.16, peak: 0.48 };

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
 * Матчер поиска с `*`-синтаксисом (юзер 2026-06-04): БЕЗ `*` — СОДЕРЖИТ (ищет везде,
 * по умолчанию); `42*` — начинается на; `*42` — заканчивается на; `*42*` — ТОЧНОЕ
 * совпадение (вся ячейка = запрос). Быстрые строковые операции; regex — только при
 * внутренних `*`. null = пустой запрос.
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
  if (lead && tail) return (value) => value.toLowerCase() === lc; // *x* — точное совпадение
  if (tail) return (value) => value.toLowerCase().startsWith(lc); // x* — начинается на
  if (lead) return (value) => value.toLowerCase().endsWith(lc); // *x — заканчивается на
  return (value) => value.toLowerCase().includes(lc); // x — содержит (по умолчанию)
}

/** Ключ сопоставления МОЛ — «ФАМИЛИЯ ИМЯ» (первые 2 токена, верхний регистр). Снимок
 *  Google хранит сокращённое «ЛЕБЕДЬ АНДРЕЙ Н.», живая база — полное «…НИКОЛАЕВИЧ»; по
 *  этому ключу они сходятся → показываем полное ФИО + актуальный статус из базы. */
function molKey(fio: string): string {
  return fio.trim().toUpperCase().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

/** Текст окна-предупреждения: «<ФИО> не может быть МОЛом на складе <номера>». Группируем
 *  по человеку (одной протяжкой обычно один мол на несколько чужих складов). */
function buildMolErrorMessage(rejects: ReadonlyArray<{ fio: string; wh: string }>): string {
  const byFio = new Map<string, Set<string>>();
  for (const r of rejects) {
    let set = byFio.get(r.fio);
    if (!set) {
      set = new Set();
      byFio.set(r.fio, set);
    }
    set.add(r.wh);
  }
  return [...byFio.entries()]
    .map(([fio, whs]) => `${fio} не может быть МОЛом на складе ${[...whs].join(', ')}.`)
    .join('\n');
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
      fonts.load('700 12px "Inter Variable"').catch(() => undefined),
      fonts.load('800 12px "Inter Variable"').catch(() => undefined),
    ]).finally(() => {
      fonts.ready.then(() => {
        if (alive) setFontsReady(true);
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  // Молы по складу-получателю (TO) из РЕАЛЬНОЙ базы МОЛ (useMolStore) — для выпадашки.
  const molRecords = useMolStore((s) => s.records);
  const { molByWarehouse, molByKey } = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const byWh = new Map<string, FlowMolOption[]>();
    // Глобально по ключу «ФАМИЛИЯ ИМЯ» → полное ФИО + цвет статуса. Нужен, чтобы
    // показывать полное имя и ВЕРНЫЙ цвет даже у скопированных/протянутых ячеек (где
    // эмодзи статуса потерян) и у снимка с сокращённым ФИО.
    const byKey = new Map<string, { fio: string; color: string }>();
    for (const r of molRecords) {
      if (!r.fio) continue;
      const color = COLOR[molStatusKind(r.status)];
      const k = molKey(r.fio);
      if (k && !byKey.has(k)) byKey.set(k, { fio: r.fio, color });
      const wid = (r.warehouseId || '').trim();
      if (!wid) continue;
      const phone = r.mobile || r.work || '';
      const opt: FlowMolOption = {
        fio: r.fio,
        color,
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        until: r.warehouseUntil || '',
        status: (r.status || '').trim(),
      };
      const arr = byWh.get(wid);
      if (arr) arr.push(opt);
      else byWh.set(wid, [opt]);
    }
    // Порядок опций склада — как в разделе МОЛ: работающие (зелёные) → красные → серые,
    // внутри группы по алфавиту ФИО. Выпадашка показывает их без поиска.
    const RANK = { ok: 0, error: 1, neutral: 2 } as const;
    for (const arr of byWh.values()) {
      arr.sort((a, b) => {
        const ra = RANK[molStatusKind(a.status)];
        const rb = RANK[molStatusKind(b.status)];
        return ra !== rb ? ra - rb : a.fio.localeCompare(b.fio, 'ru');
      });
    }
    return { molByWarehouse: byWh, molByKey: byKey };
  }, [molRecords]);
  // Авто-ширина — ПРОИЗВОДНАЯ от данных: пересчитывается при изменении строк, после
  // загрузки шрифта И при смене базы МОЛ (мол-колонку мерим по РЕЗОЛВНУТОМУ полному
  // ФИО из базы — оно длиннее снимка, иначе режется). Всегда плотно по содержимому.
  const colWidths = useMemo(
    () => computeAutoWidths(rows, molByKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fontsReady, molByKey],
  );
  // Ширина колонки-№ — ПОД содержимое (кол-во строк), а не фикс: меряем самый широкий
  // номер (все «8») + малый отступ. Компактно, без пустоты вокруг (юзер 2026-06-04).
  const markerWidth = useMemo(() => {
    const ctx = MEASURE_CTX;
    const digits = String(Math.max(1, rows.length)).length;
    if (ctx) ctx.font = `700 ${BASE_FONT}px ${GRID_FONT_FAMILY}`; // номера жирные — мерим жирным
    const w = ctx ? ctx.measureText('8'.repeat(digits)).width : digits * 7;
    return Math.max(26, Math.round(w + 16));
  }, [rows.length]);
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
  // Месяц графика, по которому считается кластер CLST (ВЫЕЗД/КХП/день доставки)
  // у складов-получателей TO. Default — текущий месяц; переключатель в тулбаре.
  // Живой пересчёт CLST из этого месяца — следующий шаг очереди.
  const [planYear, setPlanYear] = useState(() => new Date().getFullYear());
  const [planMonth, setPlanMonth] = useState(() => new Date().getMonth() + 1);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // Ширина для РАСКЛАДКИ колонок (резиновый NOTE) — обновляется с задержкой: при движении
  // сайдбара live `size` двигает канвас (прокрутка), а переразметку колонок делаем ОДИН
  // раз, когда движение остановилось — без непрерывного «прыжка».
  const [layoutWidth, setLayoutWidth] = useState(0);
  const measureRef = useRef<HTMLDivElement | null>(null);
  // Колонка NOTE — «резиновая»: добивает таблицу до ширины окна. Остаток после колонки-№
  // и остальных колонок; мал → текст переносится (строка растёт), широко → показ как есть.
  const noteWidth = useMemo(() => {
    const marker = Math.round(markerWidth * zoom);
    const others = FLOW_COLUMNS.reduce(
      (sum, c) => (c.id === 'note' ? sum : sum + Math.round((colWidths[c.id] ?? c.width) * zoom)),
      0,
    );
    return Math.max(NOTE_MIN_WIDTH, layoutWidth - marker - others - 12); // -12: полоса/зазор
  }, [layoutWidth, colWidths, markerWidth, zoom]);
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
  // Окно «нельзя назначить МОЛ» — когда мол протянули/вставили на чужой склад.
  const [molError, setMolError] = useState<{ message: string } | null>(null);
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
  // Перелив по NEW-строкам (day_wk='new') рисуется в drawCell; анимацию гоняет ШТАТНЫЙ
  // механизм Glide (args.requestAnimationFrame из drawCell) — он надёжно перерисовывает
  // ячейку каждый кадр (тот же путь, что у встроенных анимаций Glide) и сам встаёт, когда
  // NEW-строки уходят из обзора. gridPxWidthRef — диапазон волн (ширина видимого листа).
  const gridPxWidthRef = useRef(0);
  const handleVisibleRegionChanged = useCallback((range: Rectangle) => {
    visibleRef.current = { start: range.y, end: range.y + range.height };
    // Подсветка поиска следует за прокруткой (только при открытом поиске).
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      setSize({ width: w, height: h }); // live — канвас следует за окном (прокрутка без прыжка)
      // Раскладка (резиновый NOTE) — первый раз сразу, дальше после паузы движения.
      setLayoutWidth((prev) => (prev === 0 ? w : prev));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLayoutWidth(w), 160);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
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
  gridPxWidthRef.current = size.width; // диапазон «вжуха» = ширина видимого листа
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

    // Агрегаты ГРУППИРУЕМ ПО ЕДИНИЦЕ ИЗМЕРЕНИЯ — нельзя складывать тонны со штуками или
    // комплектами! QTY → ЕИ строки (шт/т/кмп/…); КГ → «кг»; V → «м³». Каждая ЕИ — свой счёт.
    const byUnit = new Map<string, { count: number; sum: number; min: number; max: number }>();
    if (count <= STAT_CAP) {
      const add = (c: number, r: number) => {
        const spec = FLOW_COLUMNS[c];
        const row = viewRows[r];
        if (!spec || !row || spec.kind !== 'number') return;
        const v = row[spec.id];
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) return;
        const unit =
          spec.id === 'qty'
            ? (row.uom || '').trim() || '—'
            : spec.id === 'kg'
              ? 'кг'
              : spec.id === 'v'
                ? 'м³'
                : '—';
        let g = byUnit.get(unit);
        if (!g) {
          g = { count: 0, sum: 0, min: Infinity, max: -Infinity };
          byUnit.set(unit, g);
        }
        g.count++;
        g.sum += n;
        if (n < g.min) g.min = n;
        if (n > g.max) g.max = n;
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
    const units = [...byUnit.entries()]
      .map(([unit, g]) => ({ unit, count: g.count, sum: g.sum, avg: g.sum / g.count, min: g.min, max: g.max }))
      .sort((a, b) => b.count - a.count);
    return { count, units };
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
          // NOTE — резиновая (остаток до края окна), прочие — по авто-ширине.
          width: c.id === 'note' ? noteWidth : Math.round((colWidths[c.id] ?? c.width) * zoom),
          hasMenu: true,
          themeOverride: {
            // Заголовок колонки — ТЕМ ЖЕ кеглем, что и её значения (юзер 2026-06-04);
            // жирный (700). Размер множится зумом.
            headerFontStyle: `800 ${Math.round(colFontPx(c.id) * zoom)}px`,
            // Активный фильтр — непрозрачные clay-тона (clay поверх светлой шапки), чтобы
            // заливка значка в drawHeader НЕ накладывалась повторно (без тёмного «чипа»).
            ...(filtered
              ? {
                  textHeader: '#B35E45',
                  bgHeader: '#EFE2DA',
                  bgHeaderHovered: '#EEDBD1',
                  bgHeaderHasFocus: '#EEDDD4',
                }
              : {}),
          },
        };
      }),
    [colWidths, filters, zoom, noteWidth],
  );

  const getCellContentRaw = useCallback(
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
        const opts = molByWarehouse.get(rowData.to_wh) ?? [];
        // «Нет мола» — без ⚠, акцентная красная пилюля «Нет МОЛа» жирным тёмным текстом,
        // чтобы сразу было понятно. Двойной клик всё равно открывает список (назначить).
        if (rawMol.toUpperCase().includes('НЕТ МОЛ')) {
          return {
            kind: GridCellKind.Custom,
            allowOverlay: true,
            copyData: 'Нет МОЛа',
            data: { kind: 'flow-mol', value: rawMol, fio: 'Нет МОЛа', color: '#E5484D', noMol: true, options: opts },
          } satisfies FlowMolCell;
        }
        const parsed = parseMol(rawMol);
        const rawFio = parsed?.fio ?? rawMol;
        // Резолвим из ЖИВОЙ базы по ключу «фамилия имя»: полное ФИО + актуальный цвет
        // статуса. Так копия/протяжка зелёные (цвет из базы, не из потерянного эмодзи),
        // а сокращённое ФИО снимка показывается полным.
        const resolved = rawFio ? molByKey.get(molKey(rawFio)) : undefined;
        const fullFio = resolved?.fio ?? rawFio;
        const color = resolved?.color ?? parsed?.color ?? '#9AA0A6';
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          // Копирование в обычную ячейку — компактно «Фамилия И.О.». В ЯЧЕЙКЕ показываем
          // «Фамилия Имя О.», полное ФИО — в выпадашке-списке.
          copyData: molInitials(fullFio),
          data: { kind: 'flow-mol', value: rawMol, fio: compactFio(fullFio), color, options: opts },
        } satisfies FlowMolCell;
      }
      if (spec.kind === 'day') {
        const s = dayState(rowData);
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          // Копируем СЫРОЕ значение (ISO-дата / OFF / пусто), а не подпись — тогда при
          // вставке в другую DAY-ячейку условная заливка (зелёная YES) тянется за датой.
          copyData: rowData.day_wk ?? '',
          data: { kind: 'flow-day', value: rowData.day_wk ?? '', label: s.label, color: s.color },
        } satisfies FlowDayCell;
      }
      if (spec.kind === 'mat') {
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: rowData.mat ?? '',
          data: {
            kind: 'flow-mat',
            name: rowData.mat ?? '',
            warn: needsWarn(rowData),
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
    [viewRows, molByWarehouse, molByKey, whById, whByShop],
  );

  // Шрифт ЗНАЧЕНИЯ per-колонке (clst 7 / day·stat·kg·v·mol·request 8 / прочее 10) +
  // ЖИРНОСТЬ для части колонок — через per-cell themeOverride с учётом зума.
  const getCellContent = useCallback(
    (cellPos: Item): GridCell => {
      const cell = getCellContentRaw(cellPos);
      const spec = FLOW_COLUMNS[cellPos[0]];
      if (!spec) return cell;
      const fontPx = colFontPx(spec.id);
      const bold = isBoldCol(spec.id);
      if (fontPx === BASE_FONT && !bold) return cell;
      const px = Math.round(fontPx * zoom);
      const prev = (cell as { themeOverride?: Partial<Theme> }).themeOverride;
      return {
        ...cell,
        themeOverride: {
          ...prev,
          baseFontStyle: `${bold ? '600 ' : ''}${px}px`,
          editorFontSize: `${px}px`,
        },
      } as GridCell;
    },
    [getCellContentRaw, zoom],
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
      // МОЛ, заехавший протяжкой/вставкой на склад, где человек не МОЛ — НЕ пишем,
      // копим для окна-предупреждения (проверка раньше оптимистики).
      const molRejects: { fio: string; wh: string }[] = [];
      for (const { location, value } of edits) {
        const [col, displayRow] = location;
        const spec = FLOW_COLUMNS[col];
        const viewRow = viewRows[displayRow];
        if (!spec || !viewRow) continue;
        const oldVal = viewRow[spec.id];
        const newVal = extractValue(spec, value, oldVal);
        if (newVal === oldVal) continue;
        // Read-only колонки (PR / Q / % / коды / числа выгрузки) — НЕ писать ни вставкой,
        // ни протяжкой. Авто-PR (внутренняя запись при смене TO) идёт мимо этого пути.
        if (spec.editable !== true) continue;
        // Выпадашки принимают ТОЛЬКО валидные значения — нельзя «впихнуть» мола в STAT
        // или мусор в DAY вставкой/протяжкой: STAT из своего списка, DAY — пусто/OFF/дата.
        if (spec.kind === 'dropdown') {
          const v = String(newVal ?? '');
          if (v !== '' && !(spec.options ?? []).includes(v)) continue;
        } else if (spec.kind === 'day') {
          const v = String(newVal ?? '');
          if (v !== '' && v !== 'new' && v !== 'OFF' && !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
        }
        // МОЛ можно поставить только если человек — МОЛ склада-получателя ЭТОЙ строки.
        if (spec.id === 'mol') {
          const fioStr = String(newVal ?? '').trim();
          if (fioStr) {
            const wantKey = molKey(parseMol(fioStr)?.fio ?? fioStr);
            const opts = molByWarehouse.get(viewRow.to_wh) ?? [];
            if (!opts.some((o) => molKey(o.fio) === wantKey)) {
              molRejects.push({
                fio: resolveMolFull(fioStr, molByKey),
                wh: viewRow.to_wh || '(склад не задан)',
              });
              continue; // на этот склад вставлять нельзя
            }
          }
        }
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
      if (molRejects.length > 0) setMolError({ message: buildMolErrorMessage(molRejects) });
      if (after.size === 0) return;
      writeCells(after);
      pushHistory({ kind: 'cells', before, after });
    },
    [viewRows, writeCells, pushHistory, molByWarehouse, molByKey],
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
      headerFontStyle: `800 ${Math.round(HEADER_FONT * zoom)}px`,
      // Колонка-№ — жирная (заметнее), кеглем значений.
      markerFontStyle: `700 ${Math.round(BASE_FONT * zoom)}px`,
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
      const noteFontPx = Math.round(colFontPx('note') * zoom);
      const noteInnerW = noteWidth - 2 * Math.max(4, Math.round(BASE_HPAD * zoom));
      let maxLines = 1;
      for (const spec of FLOW_COLUMNS) {
        if (spec.kind !== 'text') continue;
        const v = r[spec.id];
        if (typeof v !== 'string' || !v) continue;
        // NOTE — резиновая, переносится по ширине → считаем визуальные строки (\n + wrap);
        // прочие текст-колонки фикс-ширины — только явные переносы.
        const lines =
          spec.id === 'note'
            ? countWrapLines(v, noteInnerW, noteFontPx)
            : v.includes('\n')
              ? v.split('\n').length
              : 1;
        if (lines > maxLines) maxLines = lines;
      }
      return maxLines <= 1 ? rowH : rowH + (maxLines - 1) * Math.round(noteFontPx * 1.3);
    },
    [viewRows, rowH, zoom, noteWidth],
  );
  // Условное форматирование строки — мягкий фон по статусу (перенос из Google-листа,
  // адаптирован под светлый лист; clay-выделение читается поверх).
  const getRowThemeOverride = useCallback(
    (row: number) => {
      const r = viewRows[row];
      if (!r) return undefined;
      const o: { bgCell?: string; bgCellMedium?: string; textDark?: string } = {};
      const t = rowTheme(r);
      if (t?.bg) {
        o.bgCell = t.bg;
        o.bgCellMedium = t.bg;
      }
      if (t?.text) o.textDark = t.text;
      // Линии-разделители КЛАСТЕРА и СКЛАДА (TO) рисуются в drawCell (опаково, по данным,
      // ДО колонки номера) — строковый horizontalBorderColor здесь НЕ используем (он
      // заходил на колонку номера). Тут только фон/текст условного форматирования.
      return Object.keys(o).length > 0 ? o : undefined;
    },
    [viewRows],
  );
  // Граница КЛАСТЕРА — ТОЛСТАЯ (2.5px) ОПАКОВАЯ линия (без alpha!) по верху первой строки
  // кластера. Опаковая = идемпотентна: перерисовка на hover не накапливает цвет (это и
  // было «корявостью» полупрозрачной версии). Рисуется в синхроне с прокруткой (canvas).
  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      const { ctx, rect, row, col } = args;
      const r = viewRows[row];
      // «Живой» переливающийся фон — ПОДЛОЖКОЙ под контентом, инсет 1px (как Glide для
      // своих подложек, см. drawLastUpdateUnderlay) → линии/текст не задеваются. NEW
      // (оранжевый) ИЛИ STAT «вопрос» (янтарь); NEW в приоритете, если строка и то, и то.
      // ⚠️ save/restore ОБЯЗАТЕЛЕН: Glide кеширует fillStyle между ячейками (drawPrep), и
      // без восстановления градиент утекал в текст этой и СОСЕДНИХ ячеек.
      const sweep = r ? (r.day_wk === 'new' ? SWEEP_NEW : r.stat === 'вопрос' ? SWEEP_VOPROS : null) : null;
      if (sweep) {
        const W = gridPxWidthRef.current || rect.x + rect.width * 4;
        // Фаза — по времени (одинаковая для всех ячеек кадра → полоса непрерывна по строке).
        const phase = (performance.now() / SWEEP_CYCLE_MS) % 1;
        const g = ctx.createLinearGradient(0, 0, W, 0);
        const N = 16;
        for (let i = 0; i <= N; i++) {
          const p = i / N;
          const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (p * SWEEP_WAVES - phase));
          const a = sweep.base + (sweep.peak - sweep.base) * wave;
          g.addColorStop(p, `rgba(${sweep.rgb},${a.toFixed(3)})`);
        }
        const lastCol = col === FLOW_COLUMNS.length - 1;
        const lastRow = row === viewRows.length - 1;
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(rect.x + 1, rect.y + 1, rect.width - (lastCol ? 2 : 1), rect.height - (lastRow ? 2 : 1));
        ctx.restore();
        // Двигаем анимацию ШТАТНЫМ механизмом Glide: просим следующий кадр — Glide
        // перерисует эту ячейку (как у встроенного last-updated flash). Надёжнее внешнего
        // updateCells, который покадрово не перерисовывал. (requestAnimationFrame есть в
        // рантайм-args, но не в публичном типе DrawCellCallback — отсюда узкий каст.)
        (args as unknown as { requestAnimationFrame?: () => void }).requestAnimationFrame?.();
      }
      drawContent();
      // Разделители по ВЕРХУ строки — ОПАКОВЫЕ (иначе на hover накапливают альфу) и рисуются
      // в drawCell → идут ТОЛЬКО по данным, ДО колонки номера (не заходят на неё, в отличие
      // от строкового horizontalBorderColor). Кластер — толстая 2.5px; склад (TO) — тонкая 1px.
      // save/restore — чтобы цвет линии не утёк в следующие ячейки (как у подложки выше).
      if (row <= 0) return;
      const prev = viewRows[row - 1];
      if (!r || !prev) return;
      if (prev.clst !== r.clst) {
        ctx.save();
        ctx.fillStyle = '#1E1E1E';
        ctx.fillRect(rect.x, rect.y, rect.width, 2.5);
        ctx.restore();
      } else if (prev.to_wh !== r.to_wh) {
        ctx.save();
        ctx.fillStyle = '#656564'; // опаковый ≈ прежняя граница склада rgba(0,0,0,0.6) на листе
        ctx.fillRect(rect.x, rect.y, rect.width, 1);
        ctx.restore();
      }
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
    const marker = Math.round(markerWidth * zoom);
    const cols = FLOW_COLUMNS.reduce(
      (sum, c) => sum + (c.id === 'note' ? noteWidth : Math.round((colWidths[c.id] ?? c.width) * zoom)),
      0,
    );
    return marker + cols + 12; // +12: полоса прокрутки (~10) + граница/зазор
  }, [colWidths, zoom, markerWidth, noteWidth]);

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
        {/* Месяц графика — задаёт, по какому месяцу считается кластер CLST
            (ВЫЕЗД/КХП/день доставки) у складов-получателей. Переиспользуем
            пикер месяца из Графика; поповер на z-30 (как остальные в «Потоке»). */}
        <div className="h-5 w-px bg-black/[0.08]" />
        <MonthYearPicker
          year={planYear}
          month={planMonth}
          onChangeYear={setPlanYear}
          onChangeMonth={setPlanMonth}
          contentZIndex="z-30"
        >
          <button
            type="button"
            title="Месяц графика — по нему считается кластер CLST"
            className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[12px] tabular-nums text-[#6B6862] outline-none transition-colors hover:text-[#0A0A0A] data-[state=open]:text-[#0A0A0A]"
          >
            <CalendarDays size={13} strokeWidth={1.75} />
            <span>
              {MONTH_NAMES_RU[planMonth - 1]} {planYear}
            </span>
          </button>
        </MonthYearPicker>
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
            drawCell={drawCell}
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
            rowMarkerWidth={Math.round(markerWidth * zoom)}
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
        {/* Фон колонки-номеров — лёгкий серый «gutter», как в Google Sheets. У Glide нет
            ключа темы для фона маркеров (их фон = bgCell, белый), а через drawCell колонка
            не проходит — поэтому полупрозрачная подложка ПОВЕРХ canvas (тёмные цифры почти
            не тинтуются). От низа шапки (top = rowH) до низа листа; не ловит клики. */}
        {size.width > 0 && size.height > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 z-[1]"
            style={{ top: rowH, width: Math.round(markerWidth * zoom), background: 'rgba(0,0,0,0.05)' }}
          />
        )}
        {/* Тёмная линия-разделитель между колонкой-№ (слева) и данными. Колонка-№ липкая,
            поэтому x границы фиксирован = её ширине, при горизонт. прокрутке не плывёт. */}
        {size.width > 0 && size.height > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-0 z-[1] w-px bg-black/45"
            style={{ left: Math.round(markerWidth * zoom) }}
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
            {/* Одна ЕИ — агрегаты в строку; несколько ЕИ — стрелка → табличка по каждой ЕИ
                (как в Google), чтобы тонны/штуки/комплекты не смешивались и всё влезло. */}
            {selStats.units.length === 1 && (
              <>
                <span className="text-black/25">·</span>
                <span className="rounded bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-[#2A2925]">
                  {selStats.units[0]!.unit}
                </span>
                <FlowStat label="Сумма" value={selStats.units[0]!.sum} />
                <FlowStat label="Среднее" value={selStats.units[0]!.avg} />
                <FlowStat label="Мин" value={selStats.units[0]!.min} />
                <FlowStat label="Макс" value={selStats.units[0]!.max} />
              </>
            )}
            {selStats.units.length >= 2 && (
              <>
                <span className="text-black/25">·</span>
                <FlowUnitStatsPopover units={selStats.units} />
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

      {/* «Нельзя назначить МОЛ» — мол протянули/вставили на чужой склад. */}
      <Dialog.Root open={molError !== null} onOpenChange={(o) => { if (!o) setMolError(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                <AlertTriangle size={16} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
                  Нельзя назначить МОЛ
                </Dialog.Title>
                <Dialog.Description className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-text-secondary">
                  {molError?.message}
                </Dialog.Description>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setMolError(null)}
                className="rounded-md bg-accent-clay px-3 py-1.5 text-[13px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim"
              >
                Понятно
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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

interface FlowUnitStat {
  unit: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/** Несколько единиц измерения в выделении → стрелка-раскрытие с табличкой агрегатов
 *  ПО КАЖДОЙ ЕИ (тонны/штуки/комплекты не смешиваем). Как разворот итогов в Google. */
function FlowUnitStatsPopover({ units }: { units: FlowUnitStat[] }) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[12px] text-[#2A2925] outline-none transition-colors hover:border-black/30 data-[state=open]:border-black/30"
        >
          Итоги по ЕИ: {units.length}
          <ChevronDown
            size={12}
            strokeWidth={1.75}
            className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-30 overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
          <table className="text-[12px] tabular-nums">
            <thead>
              <tr className="text-[11px] text-text-muted/70">
                <th className="px-2.5 py-1.5 text-left font-medium">ЕИ</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Кол-во</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Сумма</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Среднее</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Мин</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Макс</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.unit} className="border-t border-white/[0.06]">
                  <td className="px-2.5 py-1.5 text-left font-semibold text-text-strong">{u.unit}</td>
                  <td className="px-2.5 py-1.5 text-right">{u.count.toLocaleString('ru-RU')}</td>
                  <td className="px-2.5 py-1.5 text-right text-text-primary">{fmt(u.sum)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmt(u.avg)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmt(u.min)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmt(u.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
