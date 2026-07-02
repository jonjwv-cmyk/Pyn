import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { AlertTriangle, ArrowDownUp, ChevronDown, Redo2, Trash2, Undo2 } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { flowTwoToneRenderer, type FlowTwoCell } from './flow-composed-cells';
import { flowMolRenderer, type FlowMolCell, type FlowMolOption } from './flow-mol-cell';
import { flowDayRenderer, type FlowDayCell } from './flow-day-cell';
import { whKey, whMapGet } from './flow-warehouse';
import { sedComputed, SED_LABEL, flowSignalKind, SIGNAL_SWEEP } from './flow-signal';
import { flowMatRenderer, type FlowMatCell } from './flow-mat-cell';
import { flowToRenderer, type FlowToCell, type FlowToOption } from './flow-to-cell';
import { flowHistoryRenderer, type FlowHistoryCell } from './flow-history-cell';
import { FlowAnchorHistoryCard, type FlowAnchorHistoryTarget } from './FlowAnchorHistoryCard';
import { FlowHeaderMenu, type FlowHeaderMenuAnchor } from './FlowHeaderMenu';
import { FlowMatFilterMenu, type FlowMatSubState } from './FlowMatFilterMenu';
import { FlowOrdFilterMenu, type FlowOrdEntry } from './FlowOrdFilterMenu';
import { useBlockingModal, blockingDialogContentProps } from '@/lib/modal-guard';
import {
  flowWorkflowGet,
  flowWorkflowEdit,
  flowWorkflowDelete,
  flowDeliveriesGet,
  flowDeliveryEventsGet,
  flowPlanMonthGet,
  flowPlanMonthSet,
  flowViewGet,
  flowViewSet,
  type FlowChangedEvent,
  type FlowDeliveryRow,
  type FlowDeliveryEvent,
  type FlowDeliveriesChangedEvent,
  type FlowPlanMonth,
  type FlowPlanMonthChangedEvent,
  type FlowViewChangedEvent,
  type VghChangedEvent,
  type VghRow,
  type WarehouseCluster,
  type WarehouseWeekday,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { useVghStore, normVghKey } from '@/lib/vgh-store';
import { ensureVghLoaded, applyVghChanged } from '@/lib/vgh-repo';
import { VghEditCard } from '@/components/vgh/VghEditCard';
import { fmtSmart, fmtVolume } from '@/components/vgh/vgh-staging.fixtures';
import { FlowZoomControl } from './FlowZoomControl';
import { FlowSearchPanel, type FlowSearchGroup } from './FlowSearchPanel';
import { ContactActionDialog, type ContactActionRequest } from '@/components/mol/ContactActionDialog';
import { useMolStore } from '@/lib/stores';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { molStatusKind, formatMobilePhone, molUntilStatus } from '@/lib/mol-format';
import { FlowMonthPicker } from './FlowMonthPicker';
import { FlowViewSwitch } from './FlowViewSwitch';
import {
  serializeFlowView,
  deserializeFlowView,
  canonicalFlowViewJson,
  parseFlowView,
  isEmptyFlowViewJson,
  readPersonalView,
  writePersonalView,
  clearPersonalView,
  readViewMode,
  writeViewMode,
  EMPTY_FLOW_VIEW,
  EMPTY_FLOW_VIEW_JSON,
  type FlowViewMode,
  type FlowViewState,
} from './flow-view';
import { sessionStore } from '@/lib/token-store';
import {
  canUseLiveWarehouseScheduleForMonth,
  useScheduleMonthsMeta,
  monthKey,
} from '@/lib/schedule/use-schedule-sync';
import {
  FLOW_COLUMNS,
  FLOW_STAT_OPTIONS,
  MASLOVOZ_NOS,
  PRECURSOR_NO,
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
  formatUntilDate,
  flowFilterText,
  flowMatSubText,
  FLOW_MAT_SUBFIELDS,
  FLOW_FONT_PX_DEFAULT,
  nearestGraphDate,
  graphDateSoon,
  todayIsoLocal,
  isoAddDays,
  type FlowCardLine,
  type FlowColumnSpec,
  type FlowSandboxRow,
  type FlowMatSubId,
} from './flow-sandbox.fixtures';

/** Объём тестового набора — проверяем грид на «рабочем» масштабе (база). */
/** Кастомные рендереры ячеек (своя выпадашка в стиле меню колонки). */
const FLOW_RENDERERS = [
  flowDropdownRenderer,
  flowTwoToneRenderer,
  flowMolRenderer,
  flowDayRenderer,
  flowMatRenderer,
  flowToRenderer,
  flowHistoryRenderer,
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
    if (spec.id === 'clst') {
      // CLST — ЖИВОЙ формат («ПН КХП 6», «СР ВЫЕЗД 30», «ПН 6», «Нет»). День рисуется
      // ЖИРНЫМ (700) — меряем жирным целиком (чуть с запасом), плюс число до 2 цифр.
      if (ctx) ctx.font = `700 ${colFontPx('clst')}px ${GRID_FONT_FAMILY}`;
      let valuePx = measure('Нет');
      for (const wd of ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ']) {
        for (const suf of ['', ' ВЫЕЗД', ' КХП']) valuePx = Math.max(valuePx, measure(`${wd}${suf} 30`));
      }
      if (ctx) ctx.font = `800 ${colFontPx('clst')}px ${GRID_FONT_FAMILY}`;
      const headerW = measure(spec.title) + BASE_HPAD * 2 + 6;
      out.clst = Math.round(Math.max(30, Math.min(420, Math.max(valuePx + BASE_HPAD * 2 + 4, headerW))));
      continue;
    }
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

/** Штучные ЕИ — при кол-ве <1 заказ всегда «мало» (как в гугл-скрипте minqty). */
const PIECE_UOMS = new Set(['ШТ', 'КМП', 'РУЛ', 'УПК', 'КОР']);
/** Толеранс транспортной нормы: проходим, если Σкол-ва × 1.5 ≥ MIN QTY (≈66.7%). */
const MIN_QTY_TOLERANCE = 1.5;

/** Получатель «заявки» для отправителя 9002: куст КХП ИЛИ склад 8006/806Т ИЛИ код на «06…»
 *  (правило гугл-скрипта NEW_ZAYAVKA). При норме-ок 9002 в такой склад → «заявка» (авто). */
function is9002ZayavkaDest(to: string, cluster?: string | null): boolean {
  const t = String(to ?? '').trim();
  return cluster === 'КХП' || t === '8006' || t === '806Т' || t === '806T' || t.startsWith('06');
}

/** Строка подчиняется АВТО-правилу STAT (отправитель 9002 → заявка/мет_ок, либо номенклатура
 *  масловоз/прекурсор)? На таких ярлык расчётный (руками не ставится): ручной выбор — только
 *  отказ/самовывоз + маркеры вопрос/неликвиды; снял → ярлык вернётся. На строках БЕЗ авто-правила
 *  заявку можно ставить руками. */
function hasAutoRule(row: FlowSandboxRow): boolean {
  const fr = String(row.fr ?? '').trim();
  const noKey = normVghKey(row.no_num);
  return fr === '9002' || MASLOVOZ_NOS.has(noKey) || noKey === PRECURSOR_NO;
}


/** Перелив по NEW-строкам (day_wk='new'): ПОСТОЯННЫЙ плавный оранжевый градиент —
 *  мягкие волны медленно текут вдоль строки (всегда видно, что строка новая). */
const SWEEP_CYCLE_MS = 3000; // период дрейфа (медленно, плавно)
const SWEEP_WAVES = 2; // сколько мягких волн по ширине строки
// Цвета «живого» переливающегося фона по типу строки (сочные, не бледные): NEW —
// оранжевый, STAT «вопрос» — насыщенный янтарь. base = фон в провале волны, peak = пик.
const SWEEP_NEW = { rgb: '247,130,22', base: 0.18, peak: 0.52 };
const SWEEP_VOPROS = { rgb: '233,176,30', base: 0.16, peak: 0.48 };
// «Нет» (склад вне графика выбранного месяца) — СИНИЙ перелив (как NEW, но синий):
// кластер/день по графику не определить, строку нужно видеть и доформировать.
const SWEEP_NET = { rgb: '56,124,222', base: 0.18, peak: 0.52 };
// «Обманка отчёта» — СОЧНЫЙ РАДУЖНЫЙ перелив (RGB по всему спектру): отчёт говорит «увезли»
// ровно столько же по ЕИ, сколько снова открыто в формировании → сигнал «поставка жива у нас»
// (юзер 2026-06-15). Расхождение кол-ва (отчёт 30 / формирование 50) = остаток, НЕ обманка.
const RAINBOW_CYCLE_MS = 2600; // полный оборот спектра (живо, но не мельтешит)
const RAINBOW_ALPHA = 0.34; // насыщенность подложки (текст поверх читается)

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

/**
 * Умная (многоуровневая) сортировка: список уровней в ПОРЯДКЕ ВЫБОРА пользователем.
 * Первый уровень — главный ключ, следующие — вторичные (заказ↑ → потом статус↑ и т.д.).
 * Каждый уровень = колонка (`colId`) + направление. Кнопка «Сортировка» в панели светится,
 * пока список не пуст, и сбрасывает его (возврат к исходному порядку).
 */
interface SortLevel {
  colId: string;
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

/** «DD.MM.YYYY» → полночь Date (или null). */
function parseRuDate(s: string): Date | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  return d;
}
/** «YYYY-MM-DD…» → полночь Date (или null). */
function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}
/** Сообщение окна по договору МОЛ — ДВЕ строки (юзер). Для истёкшего: строка 1
 *  «Срок действия ПМО для», строка 2 «{ФИО} истёк — {дата окончания}.» — читается
 *  как одно предложение («истёк» согласуется со «Срок»). Для «не покрывает дату»:
 *  ФИО на первой строке, вердикт на второй. ФИО всегда жирным. */
function buildContractError(kind: 'expired' | 'not-covered', fio: string, until?: string): ReactNode {
  if (kind === 'expired') {
    return (
      <>
        Срок действия ПМО для
        <br />
        <span className="font-semibold text-text-strong">{fio}</span> истёк
        {until ? ` — ${formatUntilDate(until, { comma: false })}` : ''}.
      </>
    );
  }
  return (
    <>
      Срок действия ПМО для <span className="font-semibold text-text-strong">{fio}</span>
      <br />
      не покрывает дату доставки.
    </>
  );
}

/** МОЛ строки «отсутствует» = в данных «Нет МОЛа» ЛИБО выбранный МОЛ просрочен (договор
 *  истёк по живой базе). Тогда строка показывает «Нет МОЛа» и светится красным —
 *  автоматически, руками снимать не нужно (просрочка вычисляется относительно сегодня). */
/** Поставка → инфо для расчёта доступного остатка (якорь, кол-во, проведена ли).
 *  Проведена = есть факт прихода (zm_vl) ИЛИ отмечена «увезли» — такая уже отражена в
 *  уменьшенном кол-ве выгрузки, в «занято планом» НЕ вычитается. */
/** Причины возврата, требующие внимания → авто-«вопрос» в Формировании (если иного статуса нет). */
const RETURN_Q_REASONS = new Set(['приемка', 'приёмка', 'входной контроль', 'брак', 'нет на складе', 'нет в наличии',
  // Сверка выяснила, что поставку удалили из SAP (В3): позиция снова доступна — внимание.
  'поставка удалена в sap']);

function dlvInfoOf(d: FlowDeliveryRow): { a: string; qty: number; uom: string; factQty: number | null; claimed: boolean; proved: boolean; returnQuestion: boolean; posted: boolean; delivered: boolean; occupies: boolean; reserved: boolean; real: boolean; sedStatus: string; sedHolder: string; sapOpen: boolean; transferNoDay: boolean; transferDate: string } {
  // РЕЗЕРВ (удалена/снята) держим в карте — но ТОЛЬКО ради значка истории (anchorsWithHistory):
  // все «рабочие» флаги гасим, чтобы резерв не занимал позицию и не считался доставленным.
  const reserved = Number(d.reserved) === 1;
  // «Реальная» история (значок ИСТОРИЯ): есть номер поставки / статус отчёта / факт / фиксация.
  // Брошенные черновики плана (резерв без всего) — НЕ история (юзеру не нужны попытки включить в план).
  const real = !!(String(d.dlv ?? '').trim() || String(d.done_stat ?? '').trim() || d.fact_qty != null || Number(d.fixation_id) > 0);
  const posted = !reserved && (d.fact_qty != null || String(d.fact_dt ?? '').trim() !== '' || d.done_stat === 'увезли');
  // «Реально отгружено» для ОБМАНКИ (юзер 2026-06-15): нужен ФАКТ отгрузки — приход из zm_vl
  // (fact_qty) ИЛИ статус «увезли», а НЕ цвет «выполнено» из импорта отчёта (он без факта и красил
  // бы формирование зря). Обманка = реально увезли + заказ снова открыт тем же кол-вом.
  const delivered = !reserved && Number(d.fixation_id) > 0 && posted;
  // ЗАНИМАЕТ позицию (вычитает кол-во из формирования) по ФАКТУ НАЛИЧИЯ поставки (юзер 2026-06-16):
  // подписано/не подписано в СЭД, есть проводка или нет, «увезли» — РОЛИ НЕ ИГРАЕТ. Раз поставка
  // создана и не удалена — её кол-во из формирования ушло. Освобождает ТОЛЬКО удаление (reserved)
  // и «не увезли» (возврат груза). Зеркало серверного OCCUPIES_SQL.
  const done = String(d.done_stat ?? '');
  const occupies = !reserved && done !== 'не увезли';
  // ОБМАНКА (юзер 2026-06-22, переосмыслено): «claimed» = МЫ пометили «выполнено/увезли»; «proved» =
  // zm_vl подтвердил проводку (есть КолПрихода=fact_qty). Обманка = claimed БЕЗ proved (сказали что
  // увезли, а по факту нет). Над-/недовоз/остаток с фактом — РЕАЛЬНО возили, НЕ обманка.
  const claimed = !reserved && (done === 'выполнено' || done === 'увезли');
  // «proved» = доказательство, что РЕАЛЬНО возили: проводка (КолПрихода) ЛИБО СЭД-документ дошёл до
  // подписания/подписан (груз поехал, оформляется). «ожидает отгрузки»/пусто = ещё не возили. Без
  // этого «на подписании»-поставки ложно краснели как обманка (4200017755|10, 4300642970|20).
  const sedLow = String(d.sed_status ?? '').trim().toLowerCase();
  const sedInFlow = sedLow === 'на подписании' || sedLow === 'подписан';
  const proved = !reserved && (d.fact_qty != null || sedInFlow);
  // «Вопрос» (юзер 2026-06-22): вернулось с причиной, требующей внимания (приёмка/входной контроль/
  // брак/нет на складе/нет в наличии), и не разрешено (нет факта) → авто-метка «вопрос» в Формировании,
  // ЕСЛИ иного статуса нет (см. statMetaById). Снимается ручным статусом.
  const returnQuestion = !reserved && done === 'не увезли' && d.fact_qty == null &&
    RETURN_Q_REASONS.has(String(d.fail_reason ?? '').trim().toLowerCase());
  // «Перенос-без-дня» (юзер 2026-06-22): отмечен «перенос на другой день» БЕЗ даты (импорт/ручная
  // заливка пишет голую причину; настоящий перенос — «…: YYYY-MM-DD» + строка-получатель), поставка
  // ещё открыта в SAP (sap_open=1, нет факта). Сигнал «нужно назначить день» в Формировании.
  const transferNoDay = !reserved && d.fact_qty == null && Number(d.sap_open) === 1 &&
    String(d.fail_reason ?? '').trim() === 'перенос на другой день';
  // Висящий ПЕРЕНОС с датой (В1, юзер 2026-07-02): «перенос на другой день: YYYY-MM-DD».
  // Позиция показывается в Формировании на эту дату (даже если якорь ушёл в OFF).
  const trm = !reserved && done === 'не увезли'
    ? /^перенос на другой день: (\d{4}-\d{2}-\d{2})/.exec(String(d.fail_reason ?? '').trim())
    : null;
  return {
    a: `${d.ord}|${d.it}`, qty: d.qty == null ? 0 : Number(d.qty), uom: String(d.uom ?? ''),
    factQty: d.fact_qty == null ? null : Number(d.fact_qty), claimed, proved, returnQuestion,
    posted, delivered, occupies, reserved, real,
    sedStatus: String(d.sed_status ?? ''), sedHolder: String(d.sed_holder ?? ''),
    sapOpen: Number(d.sap_open) === 1, transferNoDay,
    transferDate: trm ? trm[1] ?? '' : '',
  };
}

// «Нет МОЛа» — ПО ФАКТУ (ТЗ §3): склад есть, но валидных (не просроченных) МОЛов у него нет
// → плашка на ВСЕХ строках склада, независимо от текста в ячейке (пусто/истёк/«нет мол»).
// Если валидные МОЛы есть — не красим: есть кого выбрать (авто-эффект подставит/снимет).
// Работает и для НОВЫХ строк (макрос/скрипт): вердикт от склада, а не от содержимого ячейки.
function molIsGone(
  row: FlowSandboxRow,
  molByWarehouse: ReadonlyMap<string, readonly FlowMolOption[]>,
): boolean {
  const wh = String(row.to_wh ?? '').trim();
  if (!wh) return false; // нет склада-получателя — не наш кейс
  if (String(row.mol ?? '').toUpperCase().includes('НЕТ МОЛ')) return true;
  const opts = whMapGet(molByWarehouse, wh) ?? [];
  return !opts.some((o) => molUntilStatus(o.until) !== 'expired');
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
/** Числовое сравнение «по сути»: вытаскиваем цифры (коды/номера с ведущими нулями,
 *  заказы), нечисловое/пустое — в конец. Для ORD/складов/количества. */
function numCmp(a: unknown, b: unknown): number {
  const x = parseInt(String(a ?? '').replace(/\D/g, ''), 10);
  const y = parseInt(String(b ?? '').replace(/\D/g, ''), 10);
  const xn = Number.isNaN(x);
  const yn = Number.isNaN(y);
  if (xn && yn) return 0;
  if (xn) return 1;
  if (yn) return -1;
  return x - y;
}

/** Сравнение строк с пустыми В КОНЦЕ (как WF_SORT для материала); A-Я, числа естественно. */
function blankLastCmp(a: unknown, b: unknown): number {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, 'ru', { numeric: true });
}

/** T-карта складов-получателей (как WF_SORT гугл-скрипта): код «825Т» сортируется как
 *  8025, но СТРОГО ПЕРЕД обычным «8025» (вторичный признак 0<1). Кириллица и латиница «Т». */
const TO_T_SORT_MAP: Record<string, number> = {
  '821Т': 8021, '825Т': 8025, '824Т': 8024, '823Т': 8023, '806Т': 8006,
  '821T': 8021, '825T': 8025, '824T': 8024, '823T': 8023, '806T': 8006,
};
/** Ключ сортировки склада (TO/FR): [число, 0=Т-код / 1=обычный, норм-строка]. Порт `toKey_`. */
function whSortKey(raw: string): [number, number, string] {
  const norm = String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const mapped = TO_T_SORT_MAP[norm];
  if (mapped != null) return [mapped, 0, norm];
  const m = norm.match(/-?\d+/);
  if (m) return [parseInt(m[0], 10), 1, norm];
  return [1e15, 1, norm];
}
/** Сравнение складов по WF_SORT-ключу (число → Т-код перед обычным → строка). */
function cmpWh(a: string, b: string): number {
  const ka = whSortKey(a);
  const kb = whSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2], 'ru');
}
/** Кол-во по ВОЗРАСТАНИЮ; пустые/нечисло — в конец. */
function cmpQtyAsc(a: number | null, b: number | null): number {
  const av = a == null || !Number.isFinite(a) ? Infinity : a;
  const bv = b == null || !Number.isFinite(b) ? Infinity : b;
  return av - bv;
}

/** Сортировка по ОДНОЙ колонке (из меню заголовка). «Умно» для составных:
 *  ORD — иерархия заказ→позиция (числом); MAT — по названию, пустые в конец;
 *  числа — числом; прочее — естественное сравнение (числа в тексте по значению). */
function compareRows(
  a: FlowSandboxRow,
  b: FlowSandboxRow,
  spec: FlowColumnSpec,
  dir: 'asc' | 'desc',
): number {
  let cmp: number;
  if (spec.kind === 'order') {
    cmp = numCmp(a.ord, b.ord) || numCmp(a.it, b.it);
  } else if (spec.kind === 'mat') {
    cmp = blankLastCmp(a.mat, b.mat);
  } else if (spec.kind === 'number') {
    const av = a[spec.id];
    const bv = b[spec.id];
    cmp = (typeof av === 'number' ? av : Number(av)) - (typeof bv === 'number' ? bv : Number(bv));
  } else {
    cmp = String(a[spec.id] ?? '').localeCompare(String(b[spec.id] ?? ''), 'ru', { numeric: true });
  }
  return dir === 'asc' ? cmp : -cmp;
}

/** День недели склада в снапшоте графика месяца (из его цехов). null — нет.
 *  Тот же приём, что у Цеха (`frozenWeekday`) — день недели НТМК-склада за месяц. */
function frozenWeekdayOf(
  shops: ReadonlyArray<{ rows: ReadonlyArray<{ weekday: string; warehouses: ReadonlyArray<{ code: string }> }> }>,
  code: string,
): string | null {
  const lc = code.trim().toLowerCase();
  if (!lc) return null;
  for (const shop of shops) {
    for (const row of shop.rows) {
      if (row.warehouses.some((w) => w.code.toLowerCase() === lc)) return row.weekday;
    }
  }
  return null;
}

/** CLST склада, которого НЕТ в графике выбранного месяца — день/кластер не определить. */
const CLST_NONE = 'Нет';

/** Порядок дней недели CLST. */
const WD_RANK: Record<string, number> = { ПН: 1, ВТ: 2, СР: 3, ЧТ: 4, ПТ: 5, СБ: 6, ВС: 7 };

/**
 * Ключ сортировки CLST для группировки по умолчанию: «Нет» ВВЕРХУ, далее ПО ДНЯМ
 * недели (ПН→ПТ), а ВНУТРИ дня — ВЫЕЗД → КХП → НТМК. Значение колонки = «день» /
 * «день ВЫЕЗД» / «день КХП» / «Нет».
 */
function clstSortKey(clst: string): number {
  if (clst === CLST_NONE) return -1; // «Нет» — перед всеми днями
  // Формат «ПН [ВЫЕЗД|КХП] [число]» (юзер 2026-07-02): день · кластер · ближайшая дата.
  const parts = clst.split(' ');
  const wd = parts[0] ?? '';
  const second = parts[1] ?? '';
  const cl = second && !/^\d+$/.test(second) ? second : '';
  const w = WD_RANK[wd] ?? 8;
  const c = cl === 'ВЫЕЗД' ? 0 : cl === 'КХП' ? 1 : 2; // НТМК (без суффикса) — последним в дне
  return w * 10 + c;
}

/**
 * Порядок формирования ПО УМОЛЧАНИЮ (без ручной сортировки колонкой) — полный WF_SORT:
 * CLST → получатель TO (T-карта: 825Т перед 8025) → материал MAT (пустые в конец, A-Я) →
 * ОТПРАВИТЕЛЬ FR → кол-во QTY по возрастанию. FR добавлен (юзер 2026-06): чтобы один
 * материал от ОДНОГО склада-отправителя шёл подряд, а не вперемешку по qty с разных
 * складов (упор на получатель+материал, но без потери группировки источника).
 */
function defaultSortCompare(a: FlowSandboxRow, b: FlowSandboxRow): number {
  return (
    clstSortKey(a.clst) - clstSortKey(b.clst) ||
    cmpWh(a.to_wh, b.to_wh) ||
    blankLastCmp(a.mat, b.mat) ||
    cmpWh(a.fr, b.fr) ||
    cmpQtyAsc(a.qty, b.qty)
  );
}

/** Порядок значений DAY в фильтре: пусто → off → new → даты ХРОНОЛОГИЧЕСКИ (как в календаре). */
function dayFilterRank(dayWk: string): number {
  const d = (dayWk || '').trim();
  if (d === '') return 0;
  if (d === 'OFF') return 1;
  if (d === 'new') return 2;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return 3 + Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return Number.MAX_SAFE_INTEGER; // прочее — в конец
}

/** Порядок значений STAT в фильтре = порядок пунктов выпадашки (как в ячейке); пусто первым. */
function statFilterRank(stat: string): number {
  const s = (stat || '').trim();
  if (s === '') return -1;
  const i = (FLOW_STAT_OPTIONS as readonly string[]).indexOf(s);
  return i >= 0 ? i : 999;
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
/**
 * Модульный кэш строк формирования — переживает уход/возврат в раздел (компонент
 * размонтируется). При ПОВТОРНОМ входе грид показывается мгновенно из кэша (без
 * спиннера), затем фоновый refetch + реалтайм догоняют. Живёт на время сессии.
 */
let flowRowsCache: FlowSandboxRow[] | null = null;
// Кэш карты поставок (id→инфо) на время сессии: без него dlvInfoById на каждом входе пуст →
// «занято-планом» ещё не посчитано → строки-якоря с уже созданной поставкой ПОКАЗЫВАЮТСЯ, а
// через миг (поставки загрузились) ПРЯЧУТСЯ — видимый прыжок. С кэшем на повторных входах
// расчёт сразу верный, мигания нет.
let flowDlvInfoCache: Map<number, ReturnType<typeof dlvInfoOf>> | null = null;

export function FlowSandboxGrid(): JSX.Element {
  // Стартуем из кэша (мгновенно) если он есть; иначе пусто + спиннер до первой загрузки.
  const [rows, setRows] = useState<FlowSandboxRow[]>(() => flowRowsCache ?? []);
  const [loading, setLoading] = useState(() => flowRowsCache === null);
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
      const wid = whKey(r.warehouseId);
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
  // Опции МОЛ по складу — зеро-нечувствительно через единый whKey (карта собрана им же),
  // закрывает расхождение ведущих нулей «0122»/«122», «4801»/«04801» (ТЗ §3).
  const molsForWh = useCallback(
    (wh: string): readonly FlowMolOption[] => whMapGet(molByWarehouse, wh) ?? [],
    [molByWarehouse],
  );
  // Авто-МОЛ (P1) — эффект ниже, ПОСЛЕ writeCells/syncEdits (он персистит правки): пустой
  // МОЛ + единственный валидный на складе → подставить; просроченный → авто-обработать.
  // Авто-ширина — ПРОИЗВОДНАЯ от данных: пересчитывается при изменении строк, после
  // загрузки шрифта И при смене базы МОЛ (мол-колонку мерим по РЕЗОЛВНУТОМУ полному
  // ФИО из базы — оно длиннее снимка, иначе режется). Всегда плотно по содержимому.
  const colWidths = useMemo(
    () => computeAutoWidths(rows, molByKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, fontsReady, molByKey],
  );
  // Колонку-номеров строк УБРАЛИ (юзер 2026-06-05: колонок-номеров сверху тоже нет, так
  // больше колонок данных влезает). Ширина гаттера = 0; rowMarkers='none' у DataEditor.
  const markerWidth = 0;
  // Склады по цеху — для выпадашки TO «склады того же цеха» (из useWarehousesStore).
  // По id храним также cluster + delivery_day — для ЖИВОГО CLST (см. liveRows).
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const { whById, whByShop, shippingOptions } = useMemo(() => {
    const byId = new Map<
      string,
      {
        shopCode: string | null;
        shopName: string;
        cluster: WarehouseCluster | null;
        deliveryDay: WarehouseWeekday | null;
        inSchedule: boolean;
        removed: boolean;
      }
    >();
    const byShop = new Map<string, FlowToOption[]>();
    const shipping: FlowToOption[] = [];
    for (const w of warehouses) {
      byId.set(w.id, {
        shopCode: w.shop_code,
        shopName: w.shop_name,
        cluster: w.cluster,
        deliveryDay: w.delivery_day,
        inSchedule: w.in_schedule === 1,
        removed: w.is_removed === 1,
      });
      if (w.shop_code) {
        const opt: FlowToOption = { id: w.id, desc: w.description ?? w.designation ?? '' };
        const arr = byShop.get(w.shop_code);
        if (arr) arr.push(opt);
        else byShop.set(w.shop_code, [opt]);
      }
      if (w.is_shipping === 1 && w.is_removed !== 1) {
        shipping.push({ id: w.id, desc: w.description ?? w.designation ?? '' });
      }
    }
    return { whById: byId, whByShop: byShop, shippingOptions: shipping };
  }, [warehouses]);
  // Статус склада строки против базы (юзер 2026-07-02): кода нет в базе → «склада нет в SAP»,
  // помечен удалённым → «склад удалён». Показывается в выпадашке ячейки FR/TO.
  const whStatusNote = useCallback(
    (code: string): string => {
      const c = String(code ?? '').trim();
      if (!c) return '';
      const wh = whById.get(c) ?? whMapGet(whById, c);
      if (!wh) return 'склада нет в SAP';
      return wh.removed ? 'склад удалён' : '';
    },
    [whById],
  );
  // База ВГХ — источник KG/V и тех-имени для формирования (РЕАЛТАЙМ): KG = кол-во ×
  // вес на 1 ЕИ, V = кол-во × объём на 1 ЕИ, тех-имя (MAT-карточка) — из базы по
  // номенклатуре. Грузим лениво при входе, обновляем по WS `vgh_changed` (правка
  // карточки / перенос из промежуточного листа сразу пересчитывают всем).
  const vghByKey = useVghStore((s) => s.byKey);
  useEffect(() => { void ensureVghLoaded(); }, []);
  useWsEvent<VghChangedEvent>('vgh_changed', (e) => {
    if (Array.isArray(e.rows)) applyVghChanged(e.rows as unknown as VghRow[]);
  });
  const [selection, setSelection] = useState<GridSelection>(emptySelection);
  const [sortLevels, setSortLevels] = useState<SortLevel[]>([]);
  // «Замороженный» порядок показа: правка строки (смена склада/даты/статуса) НЕ
  // пересортировывает таблицу сразу — строка остаётся на месте, с ней можно работать
  // дальше. Пересортировка — явная: кнопка «Сортировка» (или смена уровней сортировки
  // в меню колонки / применение вида). null — порядок не зафиксирован (захватим из
  // ближайшего полного сорта). Новые строки (выгрузка/чужие вставки) встают в СВОЙ
  // блок (рядом с тем же соседом, что и при живом сорте), не дёргая остальных.
  const orderMapRef = useRef<Map<number, number> | null>(null);
  const [orderEpoch, setOrderEpoch] = useState(0);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  // «Умный» фильтр MAT: отдельные под-фильтры по скрытым полям материала (название/
  // создал/даты/тех-имя), условия объединяются И. Вне общего `filters` — там свой UI.
  const [matFilter, setMatFilter] = useState<Partial<Record<FlowMatSubId, FlowMatSubState>>>({});
  // «Умный» фильтр ORD: заказы целиком (orders) + отдельные позиции (positions, ключ
  // `ord|it`). Свой UI (две колонки пилюль), вне общего `filters`.
  const [ordFilter, setOrdFilter] = useState<{ orders: Set<string>; positions: Set<string> }>(() => ({
    orders: new Set(),
    positions: new Set(),
  }));
  const [ordSearch, setOrdSearch] = useState('');
  const [menu, setMenu] = useState<FlowHeaderMenuAnchor | null>(null);
  const [copiedRegions, setCopiedRegions] = useState<CopiedRegion[]>([]);
  const [zoom, setZoom] = useState(1);
  // Месяц формирования — ОБЩИЙ для всех (сервер помнит, рассылает реалтайм). По
  // нему считается CLST (кластер/день доставки) у складов-получателей TO. Грузим
  // с сервера на маунте, обновляем по WS `flow_plan_month_changed`. `planMonthInfo`
  // — кто выбрал месяц (для аватара рядом с кнопкой). Default до ответа — текущий.
  const [planYear, setPlanYear] = useState(() => new Date().getFullYear());
  const [planMonth, setPlanMonth] = useState(() => new Date().getMonth() + 1);
  const [planMonthInfo, setPlanMonthInfo] = useState<{ updatedBy: string; updatedByName: string; updatedAt: string }>({
    updatedBy: '',
    updatedByName: '',
    updatedAt: '',
  });
  const applyPlanMonth = useCallback((p: FlowPlanMonth) => {
    if (p.year > 0 && p.month >= 1 && p.month <= 12) {
      setPlanYear(p.year);
      setPlanMonth(p.month);
    }
    setPlanMonthInfo({ updatedBy: p.updatedBy, updatedByName: p.updatedByName, updatedAt: p.updatedAt });
  }, []);
  // Загрузка общего месяца формирования на маунте.
  useEffect(() => {
    let alive = true;
    void flowPlanMonthGet(api)
      .then((p) => {
        if (alive) applyPlanMonth(p);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [applyPlanMonth]);
  // Реалтайм: кто-то сменил месяц формирования → у всех обновляем месяц + автора
  // (CLST пересчитается через planMeta → liveRows).
  useWsEvent<FlowPlanMonthChangedEvent>('flow_plan_month_changed', (event) => {
    applyPlanMonth({
      year: Number(event.year) || 0,
      month: Number(event.month) || 0,
      updatedBy: event.updated_by ?? '',
      updatedByName: event.updated_by_name ?? '',
      updatedAt: event.updated_at ?? '',
    });
  });

  // ── Виды «Общий / Личный» (filter-views, как в Google-таблицах) ────────────
  // Состояние вида (filters/matFilter/ordFilter/sortLevels/zoom выше) можно держать в
  // ДВУХ источниках: ЛИЧНЫЙ (localStorage, приватно) и ОБЩИЙ (сервер, синхронно всем,
  // с аватаром автора). Переключатель меняет только ИСТОЧНИК; движок фильтрации/сортировки
  // (rowsFiltered/viewRows) — один и тот же. По умолчанию — Общий. Данные таблицы вид НЕ трогает.
  const [viewMode, setViewMode] = useState<FlowViewMode>('shared');
  const viewModeRef = useRef<FlowViewMode>('shared');
  viewModeRef.current = viewMode;
  const [sharedAuthor, setSharedAuthor] = useState<{ updatedBy: string; updatedByName: string; updatedAt: string }>({
    updatedBy: '',
    updatedByName: '',
    updatedAt: '',
  });
  const [hasSharedView, setHasSharedView] = useState(false);
  const [hasPersonalView, setHasPersonalView] = useState(false);
  const myLoginRef = useRef('');
  // Канонический JSON последнего применённого/сохранённого вида — чтобы не пере-сохранять
  // на каждый ре-рендер и не зациклить (эхо собственного сохранения, приходящее по WS).
  const lastViewJsonRef = useRef(EMPTY_FLOW_VIEW_JSON);
  const viewHydratedRef = useRef(false);
  const sharedValueRef = useRef(''); // JSON-строка общего вида ('' — не задан)
  const sharedSaveTimerRef = useRef<number | null>(null);

  // Применить вид к живому состоянию грида (Общий/Личный — один движок). lastViewJsonRef
  // ставим ДО setState — тогда последующий save-эффект увидит «не изменилось» и не пере-сохранит.
  const applyFlowView = useCallback((state: FlowViewState) => {
    const live = deserializeFlowView(state);
    lastViewJsonRef.current = canonicalFlowViewJson(serializeFlowView(live));
    // Порядок НЕ сбрасываем: вид (Общий/Личный, чужие обновления по WS, гидрация)
    // не должен пересортировывать таблицу под руками — иначе правка склада «улетает»
    // при первом же чужом изменении вида. Пересорт ТОЛЬКО кнопкой «Сортировка» и
    // явным кликом сортировки в меню колонки; кнопка лишь загорается янтарным.
    setFilters(live.filters);
    setMatFilter(live.matFilter);
    setOrdFilter(live.ordFilter);
    setSortLevels(live.sortLevels);
    setZoom(live.zoom);
    setSelection(emptySelection());
  }, []);

  // Сохранить общий вид на сервер (debounce — лишние записи на CF free tier дороги). На
  // ответе обновляем автора (становлюсь я). Best-effort: вид уже применён локально.
  const scheduleSharedSave = useCallback((json: string) => {
    if (sharedSaveTimerRef.current != null) window.clearTimeout(sharedSaveTimerRef.current);
    sharedSaveTimerRef.current = window.setTimeout(() => {
      sharedSaveTimerRef.current = null;
      const value = isEmptyFlowViewJson(json) ? '' : json;
      void flowViewSet(api, value)
        .then((res) => {
          sharedValueRef.current = res.value;
          setHasSharedView(res.value !== '');
          setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
        })
        .catch(() => undefined);
    }, 600);
  }, []);

  // Гидрация на маунте: режим + личный вид (localStorage) + общий вид (сервер) → применяем активный.
  useEffect(() => {
    let alive = true;
    void (async () => {
      let login = '';
      try {
        const s = await sessionStore.load();
        login = s?.user?.login ?? '';
      } catch {
        /* нет сессии — личный вид недоступен, остаётся общий */
      }
      if (!alive) return;
      myLoginRef.current = login;
      const mode = readViewMode(login);
      setViewMode(mode);
      viewModeRef.current = mode;
      const personal = readPersonalView(login);
      setHasPersonalView(personal != null);
      // Общий вид грузим всегда (нужен для аватара + переключения); применяем — если активен он.
      let sharedState: FlowViewState | null = null;
      try {
        const sv = await flowViewGet(api);
        if (!alive) return;
        sharedValueRef.current = sv.value;
        setHasSharedView(sv.value !== '');
        setSharedAuthor({ updatedBy: sv.updatedBy, updatedByName: sv.updatedByName, updatedAt: sv.updatedAt });
        sharedState = sv.value ? parseFlowView(sv.value) : null;
      } catch {
        /* сервер недоступен — общий вид пустой */
      }
      if (!alive) return;
      const active = mode === 'personal' ? personal : sharedState;
      if (active) applyFlowView(active);
      else lastViewJsonRef.current = EMPTY_FLOW_VIEW_JSON;
      viewHydratedRef.current = true;
    })();
    return () => {
      alive = false;
    };
  }, [applyFlowView]);

  // Любое изменение вида (фильтр/сорт/масштаб) → сохраняем в АКТИВНЫЙ источник. Гидрацию и
  // собственное применение пропускаем (json совпадёт с lastViewJsonRef → no-op).
  useEffect(() => {
    if (!viewHydratedRef.current) return;
    const state = serializeFlowView({ filters, matFilter, ordFilter, sortLevels, zoom });
    const json = canonicalFlowViewJson(state);
    if (json === lastViewJsonRef.current) return;
    lastViewJsonRef.current = json;
    if (viewModeRef.current === 'personal') {
      const login = myLoginRef.current;
      if (isEmptyFlowViewJson(json)) {
        clearPersonalView(login);
        setHasPersonalView(false);
      } else {
        writePersonalView(login, state);
        setHasPersonalView(true);
      }
    } else {
      scheduleSharedSave(json);
    }
  }, [filters, matFilter, ordFilter, sortLevels, zoom, scheduleSharedSave]);

  // Реалтайм: кто-то изменил ОБЩИЙ вид. Всегда обновляем автора/наличие; ПРИМЕНЯЕМ только
  // если я сейчас в режиме «Общий» и это НЕ моё эхо (свои изменения уже применены локально —
  // не «прыгаем» и не сбрасываем выделение).
  useWsEvent<FlowViewChangedEvent>('flow_view_changed', (e) => {
    const value = String(e.value ?? '');
    const by = e.updated_by ?? '';
    sharedValueRef.current = value;
    setHasSharedView(value !== '');
    setSharedAuthor({ updatedBy: by, updatedByName: e.updated_by_name ?? '', updatedAt: e.updated_at ?? '' });
    if (viewModeRef.current !== 'shared' || by === myLoginRef.current) return;
    const state = value ? parseFlowView(value) : EMPTY_FLOW_VIEW;
    const incomingJson = canonicalFlowViewJson(serializeFlowView(deserializeFlowView(state)));
    if (incomingJson === lastViewJsonRef.current) return; // уже ровно такой — выделение не трогаем
    applyFlowView(state);
  });

  // Переключить режим вида (Общий ↔ Личный) — применяем вид целевого источника + помним выбор.
  const handleViewModeChange = useCallback(
    (mode: FlowViewMode) => {
      const login = myLoginRef.current;
      writeViewMode(login, mode);
      setViewMode(mode);
      viewModeRef.current = mode;
      if (mode === 'personal') {
        const personal = readPersonalView(login);
        setHasPersonalView(personal != null);
        applyFlowView(personal ?? EMPTY_FLOW_VIEW);
      } else {
        applyFlowView(sharedValueRef.current ? parseFlowView(sharedValueRef.current) : EMPTY_FLOW_VIEW);
      }
    },
    [applyFlowView],
  );

  // Сбросить вид к стандарту (снять все фильтры/сортировку/масштаб) — отдельно для СЕБЯ
  // (личный) и для ВСЕХ (общий, broadcast). Если сбрасываемый режим сейчас активен —
  // применяем пустой вид сразу; иначе только чистим источник (свой/серверный).
  const handleViewReset = useCallback(
    (target: FlowViewMode) => {
      const login = myLoginRef.current;
      if (target === 'personal') {
        clearPersonalView(login);
        setHasPersonalView(false);
        if (viewModeRef.current === 'personal') applyFlowView(EMPTY_FLOW_VIEW);
      } else {
        if (sharedSaveTimerRef.current != null) {
          window.clearTimeout(sharedSaveTimerRef.current);
          sharedSaveTimerRef.current = null;
        }
        if (viewModeRef.current === 'shared') applyFlowView(EMPTY_FLOW_VIEW);
        void flowViewSet(api, '')
          .then((res) => {
            sharedValueRef.current = res.value;
            setHasSharedView(false);
            setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
          })
          .catch(() => undefined);
      }
    },
    [applyFlowView],
  );

  // Чистим debounce-таймер общего вида при размонтировании.
  useEffect(
    () => () => {
      if (sharedSaveTimerRef.current != null) window.clearTimeout(sharedSaveTimerRef.current);
    },
    [],
  );

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
  const [molError, setMolError] = useState<{ body: ReactNode } | null>(null);
  // Карточка ВГХ для правки MIN QTY — открывается при попытке снять/сменить расчётный
  // STAT (мало/мет_ок/масловоз/прекурсор): статус меняется только через норму в базе ВГХ.
  // Карточка номенклатуры (ЕДИНАЯ): открывается двойным кликом по номенклатуре (NO.№/MAT)
  // — без плашки; ИЛИ при конфликте расчётного статуса (снять/сменить мет_ок/мало) — с жёлтой
  // плашкой про транспортную норму. Правится норма/вес/габариты; наименование/тех-имя — показ.
  const [vghCard, setVghCard] = useState<{
    noNum: string;
    mat: string;
    uom: string;
    note?: string;
  } | null>(null);

  // Карточка ИЗМЕНЕНИЯ материала (ТМЦ): чисто правка вес/габариты/норма — БЕЗ деталей
  // Создал/Выгружен/Удалён (они показываются в оверлее колонки MAT — её «свои данные»).
  // note — жёлтая плашка только при конфликте расчётного статуса.
  const openVghCard = useCallback((r: FlowSandboxRow, note?: string) => {
    setVghCard({ noNum: String(r.no_num ?? ''), mat: String(r.mat ?? ''), uom: String(r.uom ?? ''), note });
  }, []);

  // Карточка ИСТОРИИ движения позиции по якорю (заказ+позиция): таймлайн эпизодов поставок +
  // дискретных событий (план/фиксация/статус/перенос/удаление/факт zm_vl). Грузится по клику.
  const [historyCard, setHistoryCard] = useState<FlowAnchorHistoryTarget | null>(null);
  const openHistoryCard = useCallback((r: FlowSandboxRow) => {
    const ord = String(r.ord ?? '').trim();
    const it = String(r.it ?? '').trim();
    if (!ord) return; // без заказа якоря нет — истории нет
    setHistoryCard({ ord, it, mat: String(r.mat ?? ''), noNum: String(r.no_num ?? '') });
  }, []);
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
  // Якорь/фокус ВЫДЕЛЕНИЯ ЯЧЕЕК — для Shift+стрелок по ячейкам (расширяем сами, чтобы
  // нативное поведение Glide не «прыгало»; контролируемый scrollTo без рывка).
  const cellAnchorRef = useRef<[number, number] | null>(null);
  const cellFocusRef = useRef<[number, number] | null>(null);
  // Зеркала состояния для глобального слушателя copy (читает актуальное без переподписки).
  const selectionRef = useRef<GridSelection>(selection);
  const viewRowsRef = useRef<FlowSandboxRow[]>([]);
  const rowsRef = useRef<FlowSandboxRow[]>(rows);
  // Активная сортировка по id колонки — drawHeader читает ref и рисует стрелку
  // (не дописываем стрелку в текст заголовка → ширина колонки не пухнет).
  const sortRef = useRef<Map<string, 'asc' | 'desc'>>(new Map());
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

  // Месяц формирования → мета графика выбранного месяца (для ЖИВОГО CLST). Сам
  // holidays-контроль делает пикер; здесь нужны frozen-дни недели НТМК-складов.
  const planMonths = useMemo(() => [{ year: planYear, month: planMonth }], [planYear, planMonth]);
  const planMetaMap = useScheduleMonthsMeta(planMonths);
  const planMeta = planMetaMap.get(monthKey(planYear, planMonth));

  // Якоря с АКТИВНОЙ поставкой (позиция «ушла в план») — в формировании её нет, и в
  // транспортную норму (доступный остаток) такие НЕ считаем. Источник — flow_deliveries
  // (карта id→`ord|it` обновляется реалтаймом ниже). Объявлено здесь, т.к. нужно норме.
  // id поставки → { якорь ord|it, кол-во, проведена ли (отгружена/факт) }. Проведённая
  // поставка УЖЕ отражена в уменьшенном кол-ве выгрузки (SAP списал), потому в «доступный
  // остаток» НЕ вычитается; незакрытая (черновик/план без факта) — вычитается (юзер 2026-06-14).
  type DlvInfo = {
    a: string; qty: number; uom: string; factQty: number | null; claimed: boolean; proved: boolean;
    returnQuestion: boolean; posted: boolean; delivered: boolean; occupies: boolean; reserved: boolean;
    real: boolean; sedStatus: string; sedHolder: string; sapOpen: boolean; transferNoDay: boolean;
    /** Дата висящего переноса «перенос на другой день: YYYY-MM-DD» ('' — нет). */
    transferDate: string;
  };
  const [dlvInfoById, setDlvInfoById] = useState<Map<number, DlvInfo>>(() => flowDlvInfoCache ?? new Map());
  // СЭД по якорю — статус движения документа + на ком (с активной поставки позиции). Для колонки СЭД
  // в Формировании (казусы: возили, а 2 дня не подписано / кто отклонил). Незакрытая = sapOpen.
  const sedByAnchor = useMemo(() => {
    const m = new Map<string, { status: string; holder: string; open: boolean }>();
    for (const v of dlvInfoById.values()) {
      if (v.reserved) continue; // снятая поставка не несёт актуального СЭД-сигнала формирования
      if (!v.sedStatus && !v.sedHolder && !v.sapOpen) continue;
      const cur = m.get(v.a);
      // приоритет — у кого есть статус; OPEN важнее спокойного подписанного статуса.
      if (!cur || (v.sapOpen && !cur.open)) {
        m.set(v.a, { status: v.sedStatus, holder: v.sedHolder, open: v.sapOpen });
      }
    }
    return m;
  }, [dlvInfoById]);
  // Σ кол-ва ОТКРЫТЫХ (незакрытых) поставок по якорю — сколько уже «занято планом». Якорь с открытой
  // попыткой держит позицию вне Формирования ровно на это кол-во; закрытые эпизоды (не увезли+причина/
  // выполнено/перенос) поставку ОТПУСКАЮТ (occupies=false) → остаток позиции снова доступен (R3.7).
  const plannedOpenByAnchor = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of dlvInfoById.values()) {
      if (!v.occupies) continue;
      m.set(v.a, (m.get(v.a) ?? 0) + (Number.isFinite(v.qty) ? v.qty : 0));
    }
    return m;
  }, [dlvInfoById]);
  // Якоря, ДОСТАВЛЕННЫЕ по отчёту (выполнено/увезли) → кол-во+ЕИ доставленного (сумма эпизодов).
  // «Обманка отчёта» (юзер 2026-06-15): отчёт говорит «увезли» РОВНО столько же по ЕИ, сколько
  // снова открыто в формировании → сигнал «поставка жива у нас». Если в формировании БОЛЬШЕ
  // (отчёт 30 / формирование 50) — это законный ОСТАТОК (ещё 20), НЕ обманка.
  // ОБМАНКА = «сказали увезли, а по факту нет» (юзер 2026-06-22). Два множества якорей:
  //  • claimedAnchors — мы пометили «выполнено/увезли» (наша отметка отчёта);
  //  • provedAnchors  — zm_vl подтвердил проводку (есть КолПрихода=fact) хоть по одной поставке.
  // Обманка = claimed И НЕ proved (см. isCheatRow). Над-/недовоз/остаток с фактом = реально возили.
  const claimedAnchors = useMemo(() => {
    const s = new Set<string>();
    for (const v of dlvInfoById.values()) if (v.claimed) s.add(v.a);
    return s;
  }, [dlvInfoById]);
  const provedAnchors = useMemo(() => {
    const s = new Set<string>();
    for (const v of dlvInfoById.values()) if (v.proved) s.add(v.a);
    return s;
  }, [dlvInfoById]);
  // Якоря с «переносом-без-дня» (юзер 2026-06-22): живая поставка отмечена «перенос на другой день»,
  // но день так и не назначили → сигнал внимания в Формировании (см. flowSignalKind/SIGNAL_SWEEP).
  const transferNoDayByAnchor = useMemo(() => {
    const s = new Set<string>();
    for (const v of dlvInfoById.values()) if (v.transferNoDay) s.add(v.a);
    return s;
  }, [dlvInfoById]);
  // Висящий ПЕРЕНОС с датой по якорю (В1, юзер 2026-07-02): позиция показывается в
  // Формировании на дату переноса, даже если якорь ушёл в OFF (заказ не в выгрузке).
  // Последний эпизод (максимальный id поставки) побеждает.
  const transferPendingByAnchor = useMemo(() => {
    const m = new Map<string, { id: number; date: string }>();
    for (const [id, v] of dlvInfoById) {
      if (!v.transferDate) continue;
      const cur = m.get(v.a);
      if (!cur || Number(id) > cur.id) m.set(v.a, { id: Number(id), date: v.transferDate });
    }
    return m;
  }, [dlvInfoById]);
  // Якоря с возвратом «требует внимания» (приёмка/входной контроль/брак/нет в наличии, не разрешено) →
  // авто-«вопрос» в STAT, если иного ярлыка нет (юзер 2026-06-22).
  const returnQuestionByAnchor = useMemo(() => {
    const s = new Set<string>();
    for (const v of dlvInfoById.values()) if (v.returnQuestion && !v.proved) s.add(v.a);
    return s;
  }, [dlvInfoById]);
  // ОБМАНКА (юзер 2026-06-22, переосмыслено по реальным данным): «пометили увезли, а по факту НЕ
  // возили». Срабатывает когда: мы отметили выполнено/увезли (claimed), НО zm_vl не подтвердил
  // проводку (нет КолПрихода ни по одной поставке якоря, !proved), И по SAP реально НИЧЕГО не ушло
  // (открытое кол-во ≥ изначального заказа: «вообще не возили»). Над-/недовоз, остаток, любое кол-во
  // С ФАКТОМ — реально возили → НЕ обманка (раньше ошибочно краснело: 4400903675/4400910512/…). Частичная
  // отгрузка (open < ordered_init) — что-то ушло → не «вообще не возили».
  const isCheatRow = useCallback(
    (r: FlowSandboxRow): boolean => {
      const a = `${r.ord}|${r.it}`;
      if (!claimedAnchors.has(a) || provedAnchors.has(a)) return false;
      const init = r.ordered_init;
      const open = typeof r.qty === 'number' ? r.qty : Number(r.qty);
      if (init != null && Number.isFinite(open) && open < Number(init) - 1e-6) return false; // что-то ушло
      return true;
    },
    [claimedAnchors, provedAnchors],
  );

  // Якоря с РЕАЛЬНОЙ историей движения (поставка с номером / статус отчёта / факт / фиксация —
  // включая снятые после этого): только им значок ИСТОРИЯ (юзер: «значок если история есть»). Резерв
  // учитываем (позиция, у которой все поставки сняты, не теряет историю), а вот брошенные черновики
  // плана (резерв без результата) историей НЕ считаем — они юзеру не нужны. Ключ ord|it переживает
  // смену месяца формирования.
  const anchorsWithHistory = useMemo(
    () => new Set([...dlvInfoById.values()].filter((v) => v.real).map((v) => v.a)),
    [dlvInfoById],
  );

  // РАСЧЁТНЫЙ STAT по строке (id → { auto, undershoot }) — ЕДИНЫЙ источник вердикта для
  // показа (liveRows), пунктов выпадашки (statOptionsForRow) и валидации (applyEdits).
  // Транспортная норма: Σкол-ва не-OFF по связке отправитель|получатель|номенклатура|ЕИ|MAT
  // × 1.5 < MIN QTY → недобор (штучные при кол-ве <1 — всегда недобор). АВТО-ярлык:
  // масловоз/прекурсор (по номенклатуре) · мало (недобор) · заявка (9002 + куст КХП/8006,
  // норма ок) · мет_ок (9002 прочие, норма ок) · пусто. Нет нормы → ПУСТО (статус «нет ВГХ»
  // убран — сигнал «новый/без нормы» несёт стадия NEW). Производное от базы ВГХ — вписал
  // норму в карточке → ярлык оживает у всех.
  const statMetaById = useMemo(() => {
    const map = new Map<number, { auto: string; undershoot: boolean }>();
    if (vghByKey.size === 0) return map; // нет базы ВГХ → нормы неизвестны, вердикт не считаем
    const sumByGroup = new Map<string, number>();
    // В1: OFF-якорь с висящим переносом считается АКТИВНЫМ (позиция видна в Формировании
    // на дату переноса) — участвует в норме/ярлыках как обычная строка.
    const isOffRow = (r: FlowSandboxRow): boolean =>
      String(r.day_wk ?? '').toUpperCase() === 'OFF' && !transferPendingByAnchor.has(`${r.ord}|${r.it}`);
    for (const r of rows) {
      if (isOffRow(r)) continue;
      // Норма = доступный к транспорту ОСТАТОК (юзер 2026-06-16). Из кол-ва выгрузки вычитаем
      // Σ НЕЗАКРЫТЫХ поставок по якорю: полностью покрытая планом позиция (остаток ≤ 0) в формировании
      // не показана и в норму НЕ идёт; частичная (создали поставку 400 из 500) идёт ОСТАТКОМ (100) —
      // норма транспортная считается ровно на остаток, как видит юзер. Проведённые поставки уже
      // отражены в кол-ве выгрузки (occupies=false) → не вычитаем.
      const q = typeof r.qty === 'number' ? r.qty : Number(r.qty);
      if (!Number.isFinite(q)) continue;
      const open = plannedOpenByAnchor.get(`${r.ord}|${r.it}`) ?? 0;
      const eff = open > 0 ? q - open : q;
      if (eff <= 1e-6) continue;
      const g = `${r.fr}|${r.to_wh}|${normVghKey(r.no_num)}|${r.uom}|${r.mat}`;
      sumByGroup.set(g, (sumByGroup.get(g) ?? 0) + eff);
    }
    for (const r of rows) {
      if (isOffRow(r)) {
        map.set(r.id, { auto: '', undershoot: false });
        continue;
      }
      const noKey = normVghKey(r.no_num);
      const fr = String(r.fr ?? '').trim();
      const q0 = typeof r.qty === 'number' ? r.qty : Number(r.qty);
      const open = plannedOpenByAnchor.get(`${r.ord}|${r.it}`) ?? 0;
      // Штучный недобор (<1 ШТ) — тоже по ОСТАТКУ: поставка частично закрыла позицию.
      const qtyNum = open > 0 ? q0 - open : q0;
      const hasQty = Number.isFinite(qtyNum);
      const minQty = vghByKey.get(noKey)?.min_qty;
      const hasNorm = minQty != null && Number.isFinite(minQty);
      const masloLabel = MASLOVOZ_NOS.has(noKey) ? 'масловоз' : noKey === PRECURSOR_NO ? 'прекурсор' : '';
      let undershoot = false;
      if (PIECE_UOMS.has(String(r.uom ?? '').trim().toUpperCase()) && hasQty && qtyNum < 1) undershoot = true;
      else if (hasNorm) {
        const g = `${r.fr}|${r.to_wh}|${noKey}|${r.uom}|${r.mat}`;
        undershoot = (sumByGroup.get(g) ?? 0) * MIN_QTY_TOLERANCE < (minQty as number);
      }
      let auto = masloLabel
        ? hasNorm && undershoot
          ? 'мало'
          : masloLabel
        : undershoot
          ? 'мало'
          : hasNorm && fr === '9002'
            ? is9002ZayavkaDest(r.to_wh, whById.get(r.to_wh)?.cluster)
              ? 'заявка'
              : 'мет_ок'
            : '';
      // «Вопрос» — САМЫЙ НИЗКИЙ приоритет (юзер 2026-06-22: «лишь если нет иного»): ставим только когда
      // иначе было бы пусто/мет_ок, а позиция вернулась с проблемной причиной (приёмка/брак/…). Жёлтым
      // обращает внимание; снимается ручным статусом (stat_manual перекрывает).
      if ((auto === '' || auto === 'мет_ок') && returnQuestionByAnchor.has(`${r.ord}|${r.it}`)) auto = 'вопрос';
      map.set(r.id, { auto, undershoot });
    }
    return map;
  }, [rows, vghByKey, whById, plannedOpenByAnchor, returnQuestionByAnchor, transferPendingByAnchor]);

  // CLST — ЖИВОЙ из нашего графика. Колонка ПО ДНЯМ НЕДЕЛИ (ПН-ПТ) из графика
  // ВЫБРАННОГО месяца; внутри дня кластер выводим суффиксом: ВЫЕЗД/КХП («ПН КХП»,
  // «СР ВЫЕЗД»), НТМК — только день («ПН»). День берём ТОЛЬКО из графика месяца:
  // frozen-снапшот (committed) → иначе текущий delivery_day склада (черновой месяц =
  // его график). Склад не в графике (не scheduled и не во frozen) → «Нет» (синий
  // перелив строки). CLST (кластер+день графика) и DAY (дата доставки) — РАЗНОЕ.
  // Пока мета месяца НЕ загружена — снимок до загрузки (без мигания). Производное от
  // rows: смена TO / месяца сразу пересчитывает CLST у всех.
  const liveRows = useMemo<FlowSandboxRow[]>(() => {
    if (rows.length === 0) return rows;
    const haveWh = whById.size > 0 && !!planMeta; // ЖИВОЙ CLST (нужны склады + месяц)
    const haveVgh = vghByKey.size > 0; // ЖИВЫЕ KG/V/тех-имя из базы ВГХ
    const haveTransfers = transferPendingByAnchor.size > 0; // В1: показ перенесённых позиций
    if (!haveWh && !haveVgh && !haveTransfers) return rows;
    const shops = planMeta?.shops ?? [];
    const canUseLiveSchedule = canUseLiveWarehouseScheduleForMonth(planYear, planMonth);
    let changed = false;
    const next = rows.map((r) => {
      const patch: Partial<FlowSandboxRow> = {};
      // В1 (юзер 2026-07-02): OFF-якорь с висящим переносом ВИДЕН в Формировании с датой
      // переноса в DAY (слой показа; правка DAY пишет day_wk в БД и синхронизирует Отчёт).
      const tr = transferPendingByAnchor.get(`${r.ord}|${r.it}`);
      const effDay = tr && String(r.day_wk ?? '').toUpperCase() === 'OFF' ? tr.date : String(r.day_wk ?? '');
      if (effDay !== String(r.day_wk ?? '')) patch.day_wk = effDay;
      if (haveWh) {
        const wh = whById.get(r.to_wh);
        const weekday = shops.length
          ? frozenWeekdayOf(shops, r.to_wh)
          : (canUseLiveSchedule && wh?.inSchedule ? wh.deliveryDay : null);
        // ГРАФ с датой (В4 + правка юзера 2026-07-02): число = СЛЕДУЮЩИЙ день поставки по
        // графику — сегодняшний день НЕ берём (сегодня уже не спланировать: стоит ЧТ 2 —
        // показываем ЧТ 9). Связь дня — график ВЫБРАННОГО месяца формирования: будущий
        // месяц → счёт от его 1-го числа. Формат «ПН КХП 6» (день · кластер · число).
        const todayIso = todayIsoLocal();
        const tomorrow = isoAddDays(todayIso, 1);
        const monthStart = `${planYear}-${String(planMonth).padStart(2, '0')}-01`;
        const graphRef = monthStart > tomorrow ? monthStart : tomorrow;
        const near = weekday ? nearestGraphDate(weekday, graphRef) : null;
        const num = near ? String(parseInt(near.slice(8, 10), 10)) : '';
        const clst = !weekday
          ? CLST_NONE
          : [weekday, wh && (wh.cluster === 'ВЫЕЗД' || wh.cluster === 'КХП') ? wh.cluster : '', num]
              .filter(Boolean)
              .join(' ');
        if (clst !== r.clst) patch.clst = clst;
      }
      if (haveVgh) {
        const qtyNum = typeof r.qty === 'number' ? r.qty : Number(r.qty);
        const hasQty = Number.isFinite(qtyNum);
        const base = vghByKey.get(normVghKey(r.no_num));
        if (base) {
          // KG = кол-во × вес на 1 ЕИ; V = кол-во × объём на 1 ЕИ; тех-имя — из базы.
          // Перекрываем ТОЛЬКО когда база даёт значение (иначе оставляем снимок).
          if (base.weight_kg != null && hasQty) {
            const kg = Math.round(qtyNum * base.weight_kg * 1000) / 1000;
            if (kg !== r.kg) patch.kg = kg;
          }
          if (base.volume_m3 != null && hasQty) {
            const v = qtyNum * base.volume_m3;
            if (v !== r.v) patch.v = v;
          }
          const tech = base.tech_name || r.mat_full;
          if (tech !== r.mat_full) patch.mat_full = tech;
        }
      }
      // STAT: ручной-липкий (stat_manual=1, непустой) держим как есть; иначе показываем
      // РАСЧЁТНЫЙ ярлык (statMetaById — реалтайм от нормы/связки/номенклатуры). Снял липкий
      // (manual=0) → ярлык вернётся (заявка/мало/мет_ок/масловоз/пусто). OFF не трогаем.
      {
        const meta = statMetaById.get(r.id);
        if (meta && effDay !== 'OFF') {
          const stored = String(r.stat ?? '').trim();
          const statManual = Number(r.stat_manual) === 1;
          const display = statManual && stored !== '' ? stored : meta.auto;
          if (display !== stored) patch.stat = display;
        }
      }
      if (Object.keys(patch).length === 0) return r;
      changed = true;
      return { ...r, ...patch };
    });
    return changed ? next : rows;
  }, [rows, whById, planMeta, planYear, planMonth, vghByKey, statMetaById, transferPendingByAnchor]);

  // «Формирование = только позиции БЕЗ активной поставки» (модель якорь+поставки):
  // позиция, попавшая в план («Сформировать план» / ручная вставка), из формирования
  // исчезает — это ВИД, строка-якорь не удаляется. Удалили поставку (резерв) →
  // позиция возвращается. Держим карту id поставки → якорь `ord|it` (реалтайм; стейт объявлен выше).
  useEffect(() => {
    let alive = true;
    // includeReserved: резервные нужны для значка ИСТОРИЯ (anchorsWithHistory) — иначе позиция,
    // у которой все поставки сняты, теряет историю в Формировании. Флаги резерва погашены в dlvInfoOf,
    // поэтому в расчёт остатка/доставки/СЭД они не попадают.
    void flowDeliveriesGet(api, { includeReserved: true })
      .then((dlv) => {
        if (!alive) return;
        setDlvInfoById(new Map(dlv.map((d) => [d.id, dlvInfoOf(d)] as const)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useWsEvent<FlowDeliveriesChangedEvent>('flow_deliveries_changed', (e) => {
    setDlvInfoById((prev) => {
      const next = new Map(prev);
      // «deleted» = ушедшие в РЕЗЕРВ (id без данных). Не выкидываем из карты, а помечаем снятыми
      // (флаги гасим) — позиция освобождается, но значок истории остаётся.
      for (const id of Array.isArray(e.deleted) ? e.deleted : []) {
        const cur = next.get(Number(id));
        if (cur) next.set(Number(id), { ...cur, reserved: true, occupies: false, delivered: false, posted: false, claimed: false, proved: false, returnQuestion: false, transferNoDay: false, transferDate: '' });
      }
      for (const r of Array.isArray(e.rows) ? e.rows : []) {
        next.set(Number(r.id), dlvInfoOf(r as unknown as FlowDeliveryRow));
      }
      return next;
    });
  });
  // Кэшируем карту поставок на сессию (мгновенный верный расчёт «занято-планом» на повторных входах).
  useEffect(() => { if (dlvInfoById.size > 0) flowDlvInfoCache = dlvInfoById; }, [dlvInfoById]);
  // Служебный тумблер «показать OFF/фантомы» (P2) — по умолчанию OFF скрыты.
  const [showOff, setShowOff] = useState(false);
  const offCount = useMemo(
    () => liveRows.reduce((n, r) => (String(r.day_wk ?? '').toUpperCase() === 'OFF' ? n + 1 : n), 0),
    [liveRows],
  );
  // Активные (не-OFF) строки — нижний счётчик считает ИХ (юзер 2026-06-14: «из — это активные
  // не OFF»; OFF-счётчик отдельно вверху на тумблере).
  const nonOffCount = useMemo(() => liveRows.length - offCount, [liveRows.length, offCount]);
  // Видимые строки формирования: без позиций с активной поставкой (они в Плане) и БЕЗ
  // OFF (P2, юзер 2026-06-14): OFF — фантом (хранится в БД для переноса коммент/МОЛ §2.4),
  // но из РАБОЧЕГО вида формирования скрыт. Служебный тумблер «OFF» в тулбаре показывает
  // их для ручной чистки.
  // Частичная отгрузка (B, юзер 2026-06-14): позицию скрываем НЕ при любой поставке, а только
  // когда НЕЗАКРЫТЫЕ поставки покрыли всё доступное кол-во. Остаток (qty − Σнезакрытых) > 0 →
  // позиция ОСТАЁТСЯ в формировании (раньше любая поставка прятала её целиком — терялся остаток).
  // Проведённые поставки уже отражены в qty выгрузки → не вычитаем.
  const visibleRows = useMemo<FlowSandboxRow[]>(() => {
    const out: FlowSandboxRow[] = [];
    for (const r of liveRows) {
      if (String(r.day_wk ?? '').toUpperCase() === 'OFF') {
        if (showOff) out.push(r); // OFF — фантом, остаток не считаем
        continue;
      }
      const open = plannedOpenByAnchor.get(`${r.ord}|${r.it}`) ?? 0;
      if (open <= 0) {
        out.push(r); // незакрытых поставок нет — позиция доступна целиком
        continue;
      }
      const q0 = typeof r.qty === 'number' ? r.qty : Number(r.qty);
      const avail = (Number.isFinite(q0) ? q0 : 0) - open;
      if (avail <= 1e-6) {
        // Контрольная строка: OBD уже забрала всё количество, но по ней есть СЭД/RGB-проблема
        // (нет в СЭД, не запущен, на подписании, отклонён, подписан при открытой OBD). Показываем
        // её в Формировании как сигнал, но серверная сборка плана всё равно пропустит занятый якорь.
        if (flowSignalKind(isCheatRow(r), sedByAnchor.get(`${r.ord}|${r.it}`), transferNoDayByAnchor.has(`${r.ord}|${r.it}`))) out.push(r);
        continue; // полностью покрыта планом → в Плане/контроле, повторно не собираем
      }
      // Частичная отгрузка (юзер 2026-06-16): создали поставку 400 из 500 → в формировании остаётся
      // ОСТАТОК 100. Показываем QTY = остаток; КГ/V масштабируем пропорционально (liveRows посчитал их
      // от полного кол-ва). Норма транспортная (statMetaById) и добор по выделению (selNorm) считают по
      // этому же остатку — всё идёт от viewRows. Якорь-строка в БД не меняется (qty=кол-во выгрузки),
      // это слой показа. Удалили поставку → open уходит, остаток снова = полному кол-ву.
      const f = q0 > 0 ? avail / q0 : 0;
      const kg =
        typeof r.kg === 'number' && Number.isFinite(r.kg) ? Math.round(r.kg * f * 1000) / 1000 : r.kg;
      const v = typeof r.v === 'number' && Number.isFinite(r.v) ? r.v * f : r.v;
      out.push({ ...r, qty: Math.round(avail * 1000) / 1000, kg, v });
    }
    return out;
  }, [liveRows, plannedOpenByAnchor, showOff, isCheatRow, sedByAnchor, transferNoDayByAnchor]);

  // Допустимые РУЧНЫЕ значения STAT по строке (для пунктов выпадашки И валидации в applyEdits).
  // Универсальные маркеры (вопрос/самовывоз/отказ/неликвиды) — на любой строке. «заявка» руками —
  // только на строках БЕЗ авто-правила (не 9002 / не масловоз/прекурсор): на авто-строках ярлык
  // расчётный (снять → вернётся), руками заявку там не ставим. «мало» — валидируемый возврат:
  // предлагаем только при реальном недоборе и если строка ещё не показывает «мало».
  // мет_ок/масловоз/прекурсор НЕ предлагаем НИГДЕ (только авто).
  const statOptionsForRow = useCallback(
    (row: FlowSandboxRow): string[] => {
      const opts = ['вопрос', 'самовывоз', 'отказ', 'неликвиды'];
      if (!hasAutoRule(row)) opts.unshift('заявка');
      const meta = statMetaById.get(row.id);
      if (meta?.undershoot && String(row.stat ?? '').trim() !== 'мало') opts.unshift('мало');
      return opts;
    },
    [statMetaById],
  );

  // Представление = фильтр показа + сортировка поверх источника (с ЖИВЫМ CLST).
  // Если ни фильтра, ни сортировки — отдаём массив liveRows без копий.
  // Каскадные фильтры (как Гугл-таблицы): применяет ВСЕ активные фильтры, опц. ИСКЛЮЧАЯ
  // фильтр одной колонки (exceptCol) / MAT-подполей (exceptMat) / ORD (exceptOrd) — чтобы
  // список значений ЕЁ меню считался по строкам, прошедшим ОСТАЛЬНЫЕ фильтры, а не по всей
  // таблице. Без исключений = обычный фильтр показа (для viewRows). Фильтр сверяет
  // ОТФОРМАТИРОВАННОЕ значение (как в таблице), а не сырьё: «что видишь, то и фильтруешь».
  const rowsFiltered = useCallback(
    (opts?: { exceptCol?: string; exceptMat?: boolean; exceptOrd?: boolean }): FlowSandboxRow[] => {
      const active = Object.entries(filters)
        .filter(([colId, f]) => colId !== opts?.exceptCol && (f.search.trim() !== '' || f.excluded.size > 0))
        .map(([colId, f]) => ({ spec: FLOW_COLUMNS.find((c) => c.id === colId), f }))
        .filter((x): x is { spec: FlowColumnSpec; f: ColumnFilter } => x.spec !== undefined);
      const matActive = opts?.exceptMat
        ? []
        : FLOW_MAT_SUBFIELDS.map((sf) => ({ sf, f: matFilter[sf.id] })).filter(
            (x): x is { sf: (typeof FLOW_MAT_SUBFIELDS)[number]; f: FlowMatSubState } =>
              x.f !== undefined && (x.f.search.trim() !== '' || x.f.excluded.size > 0),
          );
      const ordActive = !opts?.exceptOrd && ordFilter.orders.size > 0;
      const ordRestricted = new Set<string>();
      if (ordActive) {
        for (const k of ordFilter.positions) {
          const i = k.indexOf('|');
          if (i >= 0) ordRestricted.add(k.slice(0, i));
        }
      }
      if (active.length === 0 && matActive.length === 0 && !ordActive) return visibleRows;
      return visibleRows.filter(
        (row) =>
          active.every(({ spec, f }) => {
            const v = flowFilterText(spec, row);
            const q = f.search.trim().toLowerCase();
            if (q && !v.toLowerCase().includes(q)) return false;
            if (f.excluded.has(v)) return false;
            return true;
          }) &&
          matActive.every(({ sf, f }) => {
            const v = flowMatSubText(sf.id, row);
            const q = f.search.trim().toLowerCase();
            if (q && !v.toLowerCase().includes(q)) return false;
            if (f.excluded.has(v)) return false;
            return true;
          }) &&
          (!ordActive ||
            (ordFilter.orders.has(String(row.ord ?? '')) &&
              (!ordRestricted.has(String(row.ord ?? '')) ||
                ordFilter.positions.has(`${row.ord ?? ''}|${row.it ?? ''}`)))),
      );
    },
    [visibleRows, filters, matFilter, ordFilter],
  );

  // АКТУАЛЬНЫЙ порядок (живой пересорт на каждое изменение) — эталон для кнопки
  // «Сортировка» и вставки новых строк. Показ идёт через viewRows (замороженный
  // порядок) ниже — чтобы правка не «уносила» строку из-под рук.
  const sortedRows = useMemo<FlowSandboxRow[]>(() => {
    let out: FlowSandboxRow[] = rowsFiltered();
    // Умная сортировка: уровни в порядке выбора (первый — главный ключ, далее вторичные).
    if (sortLevels.length > 0) {
      const levels = sortLevels
        .map((lv) => ({ spec: FLOW_COLUMNS.find((c) => c.id === lv.colId), dir: lv.dir }))
        .filter((x): x is { spec: FlowColumnSpec; dir: 'asc' | 'desc' } => x.spec !== undefined);
      if (levels.length > 0) {
        const base = out === visibleRows ? out.slice() : out;
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
      // Без пользовательской сортировки — ПОЛНЫЙ порядок WF_SORT (CLST → получатель TO →
      // материал MAT → ОТПРАВИТЕЛЬ FR → кол-во QTY), см. defaultSortCompare. «Нет» и каждый
      // (день·кластер) — отдельный блок (разделитель по смене clst). Детерминирован, не
      // зависит от снимочного под-порядка — новые заказы встают на своё место.
      const base = out === visibleRows ? out.slice() : out;
      base.sort(defaultSortCompare);
      out = base;
    }
    return out;
  }, [rowsFiltered, sortLevels, visibleRows]);

  // ПОКАЗАННЫЙ порядок — замороженный: строки держат места, где были на момент
  // последней пересортировки; правки их не двигают. Новые id (нет в карте порядка)
  // встают рядом с тем же «соседом сверху-снизу», что и при живом сорте — выгрузка
  // раскладывает новые заказы по своим блокам, не трогая остальных.
  const viewRows = useMemo<FlowSandboxRow[]>(() => {
    void orderEpoch; // зависимость: «Сортировка» сбрасывает карту и форсит пересбор
    const om = orderMapRef.current;
    if (!om) {
      orderMapRef.current = new Map(sortedRows.map((r, i) => [r.id, i]));
      return sortedRows;
    }
    const known: FlowSandboxRow[] = [];
    // Новые строки группируем по якорю — ИЗВЕСТНОМУ соседу, идущему сразу ПОСЛЕ них
    // в актуальном порядке; хвост без якоря — в конец.
    const beforeAnchor = new Map<number, FlowSandboxRow[]>();
    const tail: FlowSandboxRow[] = [];
    let pending: FlowSandboxRow[] = [];
    for (const r of sortedRows) {
      if (om.has(r.id)) {
        known.push(r);
        if (pending.length > 0) {
          beforeAnchor.set(r.id, pending);
          pending = [];
        }
      } else pending.push(r);
    }
    if (pending.length > 0) tail.push(...pending);
    known.sort((a, b) => (om.get(a.id) ?? 0) - (om.get(b.id) ?? 0));
    if (beforeAnchor.size === 0 && tail.length === 0) return known;
    const out: FlowSandboxRow[] = [];
    for (const r of known) {
      const pre = beforeAnchor.get(r.id);
      if (pre) out.push(...pre);
      out.push(r);
    }
    out.push(...tail);
    return out;
  }, [sortedRows, orderEpoch]);

  // Порядок «устарел» (показ ≠ актуальный сорт) → кнопка «Сортировка» подсвечивается.
  const orderStale = useMemo(() => {
    if (viewRows === sortedRows || viewRows.length !== sortedRows.length) return viewRows !== sortedRows;
    for (let i = 0; i < viewRows.length; i++) {
      if (viewRows[i]?.id !== sortedRows[i]?.id) return true;
    }
    return false;
  }, [viewRows, sortedRows]);

  /** Явная пересортировка (кнопка «Сортировка»): применить актуальный порядок и
   *  зафиксировать его как новый замороженный. */
  const applySortNow = useCallback(() => {
    orderMapRef.current = null;
    setOrderEpoch((e) => e + 1);
    setSelection(emptySelection());
  }, []);

  // Активен ли «умный» фильтр MAT (любое под-поле) — для индикатора заголовка + funnel.
  const matFilterActive = useMemo(
    () =>
      FLOW_MAT_SUBFIELDS.some((sf) => {
        const f = matFilter[sf.id];
        return !!f && (f.search.trim() !== '' || f.excluded.size > 0);
      }),
    [matFilter],
  );
  const ordFilterActive = ordFilter.orders.size > 0 || ordFilter.positions.size > 0;

  // Окно-предупреждение МОЛ — блокирующее: пока открыто, клик мимо не закрывает его
  // и не сбивает фильтр/выделение в гриде (общее правило, см. modal-guard).
  useBlockingModal(molError !== null);

  // Зеркала для глобального слушателя copy (см. выше).
  selectionRef.current = selection;
  viewRowsRef.current = viewRows;
  rowsRef.current = rows;
  gridPxWidthRef.current = size.width; // диапазон «вжуха» = ширина видимого листа
  sortRef.current = new Map(sortLevels.map((lv) => [lv.colId, lv.dir]));
  filteredColsRef.current = new Set([
    ...Object.entries(filters)
      .filter(([, f]) => f.search.trim() !== '' || f.excluded.size > 0)
      .map(([id]) => id),
    ...(matFilterActive ? ['mat'] : []),
    ...(ordFilterActive ? ['ord'] : []),
  ]);

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

  // Транспортная норма по выделению: если выделены ячейки колонки QTY строк ОДНОЙ
  // номенклатуры в рамках ОДНОГО отправителя+получателя — сколько кол-ва НЕ ХВАТАЕТ до
  // нормы (просто = MIN QTY − Σ) и с учётом толеранса (MIN QTY/1.5 − Σ, порог снятия «мало»).
  const selNorm = useMemo(() => {
    const cur = selection.current;
    if (!cur) return null;
    const qtyCol = FLOW_COLUMNS.findIndex((c) => c.id === 'qty');
    if (qtyCol < 0) return null;
    const rowsSet = new Set<number>();
    for (const rect of [cur.range, ...cur.rangeStack]) {
      if (qtyCol < rect.x || qtyCol >= rect.x + rect.width) continue;
      for (let r = rect.y; r < rect.y + rect.height; r++) rowsSet.add(r);
    }
    if (rowsSet.size === 0) return null;
    let fr = '', to = '', noKey = '', uom = '', sum = 0, n = 0;
    for (const r of rowsSet) {
      const row = viewRows[r];
      if (!row || String(row.day_wk ?? '').toUpperCase() === 'OFF') continue;
      const q = typeof row.qty === 'number' ? row.qty : Number(row.qty);
      if (!Number.isFinite(q)) continue;
      const k = normVghKey(row.no_num);
      if (n === 0) { fr = row.fr; to = row.to_wh; noKey = k; uom = (row.uom || '').trim(); }
      else if (row.fr !== fr || row.to_wh !== to || k !== noKey) return null; // разные связки — норма не применима
      sum += q; n++;
    }
    if (n === 0 || !noKey) return null;
    const minQty = vghByKey.get(noKey)?.min_qty;
    if (minQty == null || !Number.isFinite(minQty)) return null;
    // needPlain — добрать до MIN QTY напрямую; needTol — добрать так, чтобы (Σ+need)×1.5 = MIN QTY
    // (порог снятия «мало»): need = MIN QTY/1.5 − Σ. Юзер 2026-06-07.
    return {
      uom: uom || '—',
      minQty,
      needPlain: Math.max(0, minQty - sum),
      needTol: Math.max(0, minQty / MIN_QTY_TOLERANCE - sum),
    };
  }, [selection, viewRows, vghByKey]);

  // Уникальные значения колонки открытого меню (для чек-листа фильтра). Порядок чек-листа
  // = порядок В ТАБЛИЦЕ, а не алфавит, для семантических колонок: CLST (Нет→дни→кластер
  // внутри дня), DAY (пусто→off→new→даты по календарю), STAT (как пункты выпадашки). Иначе
  // алфавит/числа. Считаем РАНГ по первому ряду с этим значением (label→rank), сортируем им.
  const menuValues = useMemo<string[]>(() => {
    if (!menu) return [];
    const spec = FLOW_COLUMNS[menu.colIndex];
    if (!spec) return [];
    const rankOf = (r: FlowSandboxRow): number | null => {
      if (spec.id === 'clst') return clstSortKey(String(r.clst ?? ''));
      if (spec.kind === 'day') return dayFilterRank(String(r.day_wk ?? ''));
      if (spec.id === 'stat') return statFilterRank(String(r.stat ?? ''));
      return null; // прочие колонки — по алфавиту
    };
    const ranks = new Map<string, number>();
    // Каскад: значения ЭТОЙ колонки считаем по строкам, прошедшим ОСТАЛЬНЫЕ фильтры
    // (исключая её собственный) — а не по всей таблице. Как в Гугл-таблицах.
    for (const r of rowsFiltered({ exceptCol: spec.id })) {
      const label = flowFilterText(spec, r);
      if (!ranks.has(label)) ranks.set(label, rankOf(r) ?? 0);
      if (ranks.size >= MAX_DISTINCT) break;
    }
    const semantic = spec.id === 'clst' || spec.kind === 'day' || spec.id === 'stat';
    return [...ranks.keys()].sort((a, b) => {
      if (semantic) {
        const d = (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0);
        if (d !== 0) return d;
      }
      return a.localeCompare(b, 'ru', { numeric: true });
    });
  }, [menu, rowsFiltered]);

  // Уникальные значения каждого под-поля MAT — чек-листы «умного» фильтра (считаем только
  // когда открыто меню MAT). Значения отформатированы (даты по-русски); даты сортируем
  // ХРОНОЛОГИЧЕСКИ (по исходному ISO), остальное — по алфавиту/числам.
  const matSubValues = useMemo<Record<FlowMatSubId, string[]>>(() => {
    const empty = { mat: [], created_by: [], load_dt: [], time_at: [], mat_full: [] } as Record<FlowMatSubId, string[]>;
    if (!menu || FLOW_COLUMNS[menu.colIndex]?.kind !== 'mat') return empty;
    const maps: Record<FlowMatSubId, Map<string, string>> = {
      mat: new Map(), created_by: new Map(), load_dt: new Map(), time_at: new Map(), mat_full: new Map(),
    };
    for (const r of rowsFiltered({ exceptMat: true })) {
      for (const sf of FLOW_MAT_SUBFIELDS) {
        const m = maps[sf.id];
        if (m.size >= MAX_DISTINCT) continue;
        const label = flowMatSubText(sf.id, r);
        if (!m.has(label)) {
          const sortKey =
            sf.id === 'load_dt' ? String(r.load_dt ?? '') : sf.id === 'time_at' ? String(r.time_at ?? '') : label;
          m.set(label, sortKey);
        }
      }
    }
    const out = {} as Record<FlowMatSubId, string[]>;
    for (const sf of FLOW_MAT_SUBFIELDS) {
      out[sf.id] = [...maps[sf.id].entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'ru', { numeric: true }))
        .map(([label]) => label);
    }
    return out;
  }, [menu, rowsFiltered]);

  // Заказы и их позиции для «умного» фильтра ORD (когда открыто меню ORD): заказы по
  // номеру (числом), позиции каждого — тоже по номеру.
  const ordData = useMemo<FlowOrdEntry[]>(() => {
    if (!menu || FLOW_COLUMNS[menu.colIndex]?.kind !== 'order') return [];
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const o = String(r.ord ?? '');
      if (!o) continue;
      let s = map.get(o);
      if (!s) {
        s = new Set();
        map.set(o, s);
      }
      s.add(String(r.it ?? ''));
    }
    return [...map.entries()]
      .sort((a, b) => numCmp(a[0], b[0]))
      .map(([ord, set]) => ({ ord, positions: [...set].sort((x, y) => numCmp(x, y)) }));
  }, [menu, rows]);

  // Колонки: ширина (resizable) + меню (▾) + индикаторы сортировки/фильтра в заголовке.
  const columns: GridColumn[] = useMemo(
    () =>
      FLOW_COLUMNS.map((c) => {
        const f = filters[c.id];
        const filtered =
          c.kind === 'mat'
            ? matFilterActive
            : c.kind === 'order'
              ? ordFilterActive
              : f
                ? f.search.trim() !== '' || f.excluded.size > 0
                : false;
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
    [colWidths, filters, matFilterActive, ordFilterActive, zoom, noteWidth],
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
          // V — «умный» показ (до первого значащего знака); KG/прочее — 3 знака.
          displayData: valid
            ? spec.id === 'v'
              ? fmtVolume(num)
              : fmtNum3(num)
            : spec.id === 'kg' || spec.id === 'v'
              ? '—'
              : '',
          allowOverlay: spec.editable === true,
          contentAlign: 'right',
        };
      }
      if (spec.kind === 'mol') {
        const rawMol = String(rowData.mol ?? '');
        const opts = whMapGet(molByWarehouse, rowData.to_wh) ?? [];
        // Статус склада против базы (юзер 2026-07-02): «склада нет в SAP» / «склад удалён»
        // — РЯДОМ, ПОСЛЕ плашки «Нет МОЛа»/ФИО. Работает и для строк выгрузки заказов.
        const suffix = whStatusNote(rowData.to_wh) || undefined;
        // «Нет МОЛа» (красная пилюля + красная строка) если в данных явно «нет мола» ЛИБО
        // выбранный МОЛ ПРОСРОЧЕН (договор истёк по живой базе) — автоматически. В выпадашке
        // он всё равно виден (но с красной пилюлей «по дату» = неактивен, выбрать нельзя).
        if (molIsGone(rowData, molByWarehouse)) {
          return {
            kind: GridCellKind.Custom,
            allowOverlay: true,
            copyData: 'Нет МОЛа',
            data: { kind: 'flow-mol', value: rawMol, fio: 'Нет МОЛа', color: '#E5484D', noMol: true, options: opts, suffix },
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
          data: { kind: 'flow-mol', value: rawMol, fio: compactFio(fullFio), color, options: opts, suffix },
        } satisfies FlowMolCell;
      }
      if (spec.kind === 'day') {
        // Авто-сброс ПРОШЕДШЕЙ даты DAY (юзер 2026-06-22: «дата ушла → сброс по Екб»). Дата строго
        // раньше сегодня (Екатеринбург, UTC+5) показывается ПУСТОЙ — новую ставим вручную (руками
        // прошлую дату и так нельзя). DB не трогаем: «Сформировать план» прошлые даты не берёт.
        let rawDay = (rowData.day_wk ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(rawDay)) {
          const todayYek = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
          if (rawDay < todayYek) rawDay = '';
        }
        const s = dayState({ ...rowData, day_wk: rawDay });
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          // Копируем СЫРОЕ значение (ISO-дата / OFF / пусто), а не подпись — тогда при
          // вставке в другую DAY-ячейку условная заливка (зелёная YES) тянется за датой.
          copyData: rawDay,
          data: { kind: 'flow-day', value: rawDay, label: s.label, color: s.color },
        } satisfies FlowDayCell;
      }
      if (spec.kind === 'mat') {
        // MAT — «свои данные» (Создал/Выгружен/Удалён/Вывезено) в read-only оверлее (FlowMatEditor),
        // как было. Карточка ИЗМЕНЕНИЯ материала открывается двойным кликом на НОМЕНКЛАТУРЕ (NO.№), не тут.
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
          data: {
            kind: 'flow-to', value: code, shopName: wh?.shopName ?? '', options: opts,
            statusNote: whStatusNote(code),
          },
        } satisfies FlowToCell;
      }
      if (spec.id === 'fr') {
        // FR (склад-отправитель): та же выпадашка со статусом склада против базы
        // («склада нет в SAP» / «склад удалён», юзер 2026-07-02) + выбор из отгрузочных.
        const code = rowData.fr ?? '';
        return {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: code,
          data: {
            kind: 'flow-to', value: code, shopName: '', title: 'Склад-отправитель',
            options: shippingOptions, statusNote: whStatusNote(code),
          },
        } satisfies FlowToCell;
      }
      if (spec.id === 'sed') {
        // СЭД движение документа по активной поставке позиции: ЕДИНЫЙ computed-статус
        // (ТЗ §9: сводит sed_status + открытость OBD) + на ком. «подписан · OBD открыта» =
        // контрольный случай (документ есть, проводки нет).
        const s = sedByAnchor.get(`${rowData.ord}|${rowData.it}`);
        const head = s ? SED_LABEL[sedComputed(s.status, s.open)] : '';
        const txt = s ? (s.holder ? `${head}\n${s.holder}` : head) : '';
        return {
          kind: GridCellKind.Text,
          data: txt, displayData: txt, allowOverlay: false, allowWrapping: true,
        };
      }
      if (spec.kind === 'history') {
        // ИСТОРИЯ движения позиции — иконка-часы ТОЛЬКО если у позиции есть история (эпизоды);
        // иначе пустая ячейка (не путаем). Клик → карточка-таймлайн по якорю.
        if (!anchorsWithHistory.has(`${rowData.ord}|${rowData.it}`)) {
          return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
        }
        return {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: '',
          data: { kind: 'flow-history' },
        } satisfies FlowHistoryCell;
      }
      if (spec.kind === 'dropdown') {
        // УР: 0 — основная поставка, показываем ПУСТО (выбрать «0» нельзя — это дефолт).
        const value = spec.id === 'split_level' ? (Number(raw) > 0 ? String(raw) : '') : String(raw ?? '');
        // STAT — пункты ПО СТРОКЕ (statOptionsForRow): авто-ярлык не предлагаем руками.
        const options = spec.id === 'stat' ? statOptionsForRow(rowData) : (spec.options ?? []);
        // УР: в списке «уровень N», в ячейке — чистая цифра; пустого пункта нет
        // (снять уровень = Delete по ячейке → 0).
        const labels = spec.id === 'split_level' ? options.map((o) => `уровень ${o}`) : undefined;
        return {
          kind: GridCellKind.Custom,
          allowOverlay: spec.editable === true,
          copyData: value,
          data: { kind: 'flow-dropdown', value, options, labels },
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
    [viewRows, molByWarehouse, molByKey, whById, whByShop, shippingOptions, whStatusNote, statOptionsForRow, anchorsWithHistory, sedByAnchor],
  );

  // Шрифт ЗНАЧЕНИЯ per-колонке (clst 7 / day·stat·kg·v·mol·request 8 / прочее 10) +
  // ЖИРНОСТЬ для части колонок — через per-cell themeOverride с учётом зума.
  const getCellContent = useCallback(
    (cellPos: Item): GridCell => {
      const cell = getCellContentRaw(cellPos);
      const spec = FLOW_COLUMNS[cellPos[0]];
      if (!spec) return cell;
      // ГРАФ (В4): дата «без перескока недель» (≤ сегодня+7) — зелёная подпись.
      // Опора — как в liveRows: СЛЕДУЮЩИЙ день (строго после сегодня) в месяце формирования.
      let graphGreen = false;
      if (spec.id === 'clst') {
        const r = viewRows[cellPos[1]];
        const clst = String(r?.clst ?? '');
        if (r && clst && clst !== CLST_NONE) {
          const todayIso = todayIsoLocal();
          const tomorrow = isoAddDays(todayIso, 1);
          const monthStart = `${planYear}-${String(planMonth).padStart(2, '0')}-01`;
          const graphRef = monthStart > tomorrow ? monthStart : tomorrow;
          const wd = clst.split(' ')[0] ?? '';
          graphGreen = graphDateSoon(nearestGraphDate(wd, graphRef), todayIso);
        }
      }
      const fontPx = colFontPx(spec.id);
      const bold = isBoldCol(spec.id);
      if (fontPx === BASE_FONT && !bold && !graphGreen) return cell;
      const px = Math.round(fontPx * zoom);
      const prev = (cell as { themeOverride?: Partial<Theme> }).themeOverride;
      return {
        ...cell,
        themeOverride: {
          ...prev,
          baseFontStyle: `${bold ? '600 ' : ''}${px}px`,
          editorFontSize: `${px}px`,
          ...(graphGreen ? { textDark: '#1F7A3D' } : {}),
        },
      } as GridCell;
    },
    [getCellContentRaw, zoom, viewRows, planYear, planMonth],
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

  // Применить серверные строки (ответ на правку / реалтайм flow_changed): заменяем
  // строку по id, если серверная версия не старее (идемпотентно к собственному эху).
  const applyServerRows = useCallback((serverRows: readonly FlowSandboxRow[]) => {
    if (serverRows.length === 0) return;
    const byId = new Map(serverRows.map((s) => [s.id, s]));
    setRows((prev) =>
      prev.map((r) => {
        const s = byId.get(r.id);
        if (!s) return r;
        // CLST/% в БД нет — сохраняем текущие виртуальные поля строки (liveRows/livePct пересчитают).
        return (s.row_version ?? 0) >= (r.row_version ?? 0) ? { ...s, clst: r.clst, pct: r.pct } : r;
      }),
    );
  }, []);

  // Отправить правки на сервер (реалтайм всем). Конфликт по row_version: если версия
  // устарела — сервер вернёт актуальную строку, применяем её (наша оптимистичная
  // правка откатывается к серверной правде, без ошибки — «последняя запись побеждает»).
  const syncEdits = useCallback(
    (after: Map<number, FlowRowPatch>) => {
      if (after.size === 0) return;
      const verById = new Map(rowsRef.current.map((r) => [r.id, r.row_version ?? 1]));
      const edits = [...after.entries()].map(([id, fields]) => ({
        id,
        row_version: verById.get(id) ?? 1,
        fields: fields as Record<string, string | number | null>,
      }));
      // Оптимистично бампим локальную row_version СРАЗУ при отправке (предсказываем,
      // что сервер примет → version+1). Без этого несколько правок/undo подряд по
      // одной строке (быстрее ответа сервера ~160мс) уходят со СТАРОЙ версией →
      // сервер отклоняет (WHERE row_version=?) и эхо откатывает → ломается откат.
      // Эхо с актуальной версией (>=) всё равно догоняет и поправит (last-write-wins).
      setRows((prev) =>
        prev.map((r) => (after.has(r.id) ? { ...r, row_version: (r.row_version ?? 1) + 1 } : r)),
      );
      void flowWorkflowEdit(api, edits)
        .then((res) => applyServerRows(res.rows as FlowSandboxRow[]))
        .catch(() => {
          /* офлайн/сеть — локально уже применено, WS/перезагрузка догонит */
        });
    },
    [applyServerRows],
  );

  // Авто-обработка МОЛ по живой базе (P1, юзер 2026-06-14). Относительно сегодня:
  //  • пустой МОЛ + ровно ОДИН валидный на складе → подставляем его (авто-выбор);
  //  • выбранный ПРОСРОЧЕН: остался один валидный → меняем на него; валидных 2+ → снимаем
  //    (нужен ручной выбор); валидных нет → оставляем (покажется «Нет МОЛа»).
  // OFF-фантомы НЕ трогаем. Изменения ПЕРСИСТЯТСЯ (writeCells+syncEdits) — иначе авто-МОЛ
  // не дошёл бы до Плана/Отчёта (они читают МОЛ с якоря). Идемпотентно: повторный проход
  // ничего не находит → changes пуст → стоп. Был баг: эффект пропускал пустые ячейки, и
  // единственный МОЛ не вставал на новые/сеяные строки.
  useEffect(() => {
    const changes = new Map<number, FlowRowPatch>();
    for (const r of rowsRef.current) {
      if (String(r.day_wk ?? '').toUpperCase() === 'OFF') continue;
      const opts = molsForWh(r.to_wh);
      const valid = opts.filter((o) => molUntilStatus(o.until) !== 'expired');
      const only = valid.length === 1 ? valid[0] : undefined;
      const raw = String(r.mol ?? '');
      const trimmed = raw.trim();
      if (trimmed === '') {
        if (only) changes.set(r.id, { mol: only.fio });
        continue;
      }
      if (trimmed.toUpperCase().includes('НЕТ МОЛ')) continue;
      const sel = opts.find((o) => molKey(o.fio) === molKey(parseMol(raw)?.fio ?? raw));
      if (!sel || molUntilStatus(sel.until) !== 'expired') continue;
      if (only) changes.set(r.id, { mol: only.fio });
      else if (valid.length >= 2) changes.set(r.id, { mol: '' });
    }
    if (changes.size === 0) return;
    writeCells(changes);
    syncEdits(changes);
  }, [molByWarehouse, rows, molsForWh, writeCells, syncEdits]);

  // Живое чтение базы формирования при монтировании. Если кэш есть — грид уже
  // показан из него, спиннера нет; всё равно тянем свежее в фоне (refetch догоняет
  // правки, пропущенные пока раздел был закрыт), затем реалтайм.
  useEffect(() => {
    let alive = true;
    void flowWorkflowGet(api)
      .then((serverRows) => {
        // CLST и % в БД нет — виртуальные поля-ключи колонок: clst посчитает liveRows из
        // графика, % считается livePct из qty/chg (значение pct не используется).
        if (alive) setRows(serverRows.map((r) => ({ ...r, clst: '', pct: null }) as FlowSandboxRow));
      })
      .catch(() => {
        /* ошибка сети — остаёмся на кэше (или пусто) */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Держим модульный кэш в актуальном состоянии (fetch / правки / WS) — для мгновенного
  // повторного входа в раздел.
  useEffect(() => {
    if (rows.length > 0) flowRowsCache = rows;
  }, [rows]);

  // Реалтайм: правки других клиентов прилетают строками — применяем по версии; + удалённые
  // (мусорные/перенесённые OFF при подгрузке) убираем у всех.
  useWsEvent<FlowChangedEvent>('flow_changed', (event) => {
    applyServerRows((event.rows ?? []) as unknown as FlowSandboxRow[]);
    const del = event.deleted;
    if (Array.isArray(del) && del.length > 0) {
      const gone = new Set(del);
      setRows((prev) => prev.filter((r) => !gone.has(r.id)));
    }
  });

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
      // Договор МОЛ: первая ошибка срока (истёк / дата вне срока) — для окна-предупреждения.
      // `until` (дата окончания договора, DD.MM.YYYY) — чтобы показать «истёк — май 12 2026».
      let contractErr: { kind: 'expired' | 'not-covered'; fio: string; until?: string } | null = null;
      const molUntilFor = (toWh: string, molRaw: string): string | undefined => {
        const key = molKey(parseMol(molRaw)?.fio ?? molRaw);
        return (whMapGet(molByWarehouse, toWh) ?? []).find((o) => molKey(o.fio) === key)?.until;
      };
      // Срок договора МОЛ vs дата доставки: 'expired' (истёк) / 'not-covered' (дата позже
      // конца договора) / null (срока нет, даты нет, либо дата покрывается — дедлайн включителен).
      const checkContract = (until: string | undefined, dayVal: string): 'expired' | 'not-covered' | null => {
        if (!until) return null;
        if (molUntilStatus(until) === 'expired') return 'expired';
        const dd = parseIsoDate(dayVal);
        const ud = parseRuDate(until);
        return dd && ud && dd.getTime() > ud.getTime() ? 'not-covered' : null;
      };
      for (const { location, value } of edits) {
        const [col, displayRow] = location;
        const spec = FLOW_COLUMNS[col];
        const viewRow = viewRows[displayRow];
        if (!spec || !viewRow) continue;
        const oldVal = viewRow[spec.id] ?? null; // spec.id — колонка данных, не row_version
        let newVal = extractValue(spec, value, oldVal);
        if (newVal === oldVal) continue;
        // Read-only колонки (PR / Q / % / коды / числа выгрузки) — НЕ писать ни вставкой,
        // ни протяжкой. Авто-PR (внутренняя запись при смене TO) идёт мимо этого пути.
        if (spec.editable !== true) continue;
        // Выпадашки принимают ТОЛЬКО валидные значения — нельзя «впихнуть» мола в STAT
        // или мусор в DAY вставкой/протяжкой: STAT — из допустимых ПО СТРОКЕ, DAY — пусто/OFF/дата.
        let statManualNext: number | null = null; // !=null → правка stat: 0 возврат к авто / 1 липкий
        if (spec.kind === 'dropdown') {
          const v = String(newVal ?? '');
          if (spec.id === 'stat') {
            // ФИНАЛЬНАЯ модель STAT (юзер 2026-06-07):
            //  • снятие/Delete ('') → stat_manual=0 → возврат к АВТО-ярлыку (заявка/мало/мет_ок/
            //    масловоз/пусто). Заявку-9002+КХП и любой авто-ярлык «в пусто» так не убрать — авто
            //    мгновенно вернёт его (то самое «снял → снова заявка/масловоз»).
            //  • значение НЕ из допустимых по строке (мет_ок/масловоз/прекурсор + заявка на авто-
            //    строке) — руками не ставится (отсекаем).
            //  • «мало» = валидируемый возврат: только при реальном недоборе → возврат к расчёту;
            //    иначе карточка ВГХ (поправить транспортную норму).
            //  • прочее допустимое (заявка на обычной / вопрос / самовывоз / отказ / неликвиды) —
            //    липкий ручной (stat_manual=1, перекрывает расчёт).
            const cur = String(viewRow.stat ?? '').trim();
            const allowed = statOptionsForRow(viewRow);
            if (v === '') {
              statManualNext = 0;
            } else if (v === 'мало') {
              // «мало» проверяем РАНЬШЕ списка: при реальном недоборе → возврат к расчёту;
              // иначе подсказка-карточка (в т.ч. при вставке мало на строку с пройденной нормой).
              if (cur === 'мало') continue; // уже «мало»
              if (statMetaById.get(viewRow.id)?.undershoot) {
                newVal = ''; // недобор подтверждён → снять липкий, показать расчётное «мало»
                statManualNext = 0;
              } else {
                openVghCard(viewRow, 'Норма пройдена — «мало» поставить нельзя. Поправьте транспортную норму.');
                continue;
              }
            } else if (!allowed.includes(v)) {
              continue;
            } else {
              statManualNext = 1;
            }
          } else if (spec.id === 'split_level') {
            // УР хранится ЧИСЛОМ (0=пусто; Delete снимает). Допустимо 1..10.
            const n = v === '' ? 0 : Number(v);
            if (!Number.isInteger(n) || n < 0 || n > 10) continue;
            newVal = n;
            if (newVal === (Number(viewRow.split_level) || 0)) continue;
          } else if (v !== '' && !(spec.options ?? []).includes(v)) {
            continue;
          }
        } else if (spec.kind === 'day') {
          const v = String(newVal ?? '');
          // «new» ставить нельзя (авто-состояние) — допустимо только пусто / OFF / дата.
          if (v !== '' && v !== 'OFF' && !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
          // Дата доставки должна укладываться в срок договора выбранного МОЛ строки.
          if (/^\d{4}-\d{2}-\d{2}/.test(v) && viewRow.mol) {
            const until = molUntilFor(viewRow.to_wh, viewRow.mol);
            const ce = checkContract(until, v);
            if (ce) {
              if (!contractErr) contractErr = { kind: ce, fio: resolveMolFull(viewRow.mol, molByKey), until };
              continue;
            }
          }
        }
        // МОЛ можно поставить только если человек — МОЛ склада-получателя ЭТОЙ строки.
        if (spec.id === 'mol') {
          const fioStr = String(newVal ?? '').trim();
          if (fioStr) {
            const wantKey = molKey(parseMol(fioStr)?.fio ?? fioStr);
            const opts = whMapGet(molByWarehouse, viewRow.to_wh) ?? [];
            const opt = opts.find((o) => molKey(o.fio) === wantKey);
            if (!opt) {
              molRejects.push({
                fio: resolveMolFull(fioStr, molByKey),
                wh: viewRow.to_wh || '(склад не задан)',
              });
              continue; // на этот склад вставлять нельзя
            }
            // Договор этого МОЛ: истёк → нельзя назначить; не покрывает дату строки → нельзя.
            const ce = checkContract(opt.until, String(viewRow.day_wk ?? ''));
            if (ce) {
              if (!contractErr) contractErr = { kind: ce, fio: resolveMolFull(fioStr, molByKey), until: opt.until };
              continue;
            }
          }
        }
        after.set(viewRow.id, { ...(after.get(viewRow.id) ?? {}), [spec.id]: newVal });
        const prevBefore = before.get(viewRow.id) ?? {};
        if (!(spec.id in prevBefore)) before.set(viewRow.id, { ...prevBefore, [spec.id]: oldVal });
        // Правка статуса → stat_manual = statManualNext (1 — липкий держим поверх расчёта;
        // 0 — возврат к авто-ярлыку). Снял липкий → авто-расчёт снова ведёт строку.
        if (spec.id === 'stat' && statManualNext != null) {
          after.set(viewRow.id, { ...(after.get(viewRow.id) ?? {}), stat_manual: statManualNext });
          const pb = before.get(viewRow.id) ?? {};
          if (!('stat_manual' in pb)) before.set(viewRow.id, { ...pb, stat_manual: viewRow.stat_manual ?? 0 });
        }
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
      if (molRejects.length > 0) {
        setMolError({ body: <span className="whitespace-pre-line">{buildMolErrorMessage(molRejects)}</span> });
      } else if (contractErr) {
        setMolError({ body: buildContractError(contractErr.kind, contractErr.fio, contractErr.until) });
      }
      if (after.size === 0) return;
      writeCells(after);
      pushHistory({ kind: 'cells', before, after });
      syncEdits(after); // → сервер + реалтайм всем
    },
    [viewRows, writeCells, pushHistory, syncEdits, molByWarehouse, molByKey, openVghCard, statMetaById, statOptionsForRow],
  );

  // Двойной клик (Enter) по НОМЕНКЛАТУРЕ (NO.№) → карточка изменения материала (без плашки).
  // MAT — НЕ здесь: у неё свой read-only оверлей со «своими данными» (Создал/Выгружен/…).
  const onCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      const spec = FLOW_COLUMNS[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (spec.id === 'no_num') openVghCard(r);
      else if (spec.kind === 'history') openHistoryCard(r);
    },
    [viewRows, openVghCard, openHistoryCard],
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

  // Удаление выделенных строк — ТОЛЬКО OFF (день='OFF'), НАВСЕГДА: сервер удаляет
  // (`flow_workflow_delete`, активные строки защищены) и рассылает `deleted` всем. Не-OFF
  // в выделении игнорируем. Без истории — необратимо (юзер: «удалил OFF → стирается совсем»).
  // Выделять OFF удобно кликом/протяжкой по колонке КЛАСТЕРА (работает как «номера строк»).
  const deleteOffRows = useCallback(
    (displayRows: Iterable<number>): boolean => {
      const ids: number[] = [];
      for (const r of displayRows) {
        const vr = viewRows[r];
        if (vr && String(vr.day_wk ?? '').toUpperCase() === 'OFF') ids.push(vr.id);
      }
      if (ids.length === 0) return false;
      const gone = new Set(ids);
      setRows((prev) => prev.filter((row) => !gone.has(row.id))); // оптимистично
      setSelection(emptySelection());
      void flowWorkflowDelete(api, ids).catch(() => { /* офлайн — WS/перезагрузка догонит */ });
      return true;
    },
    [viewRows],
  );

  const deleteSelectedRows = useCallback(() => { deleteOffRows(selection.rows); }, [selection, deleteOffRows]);

  // Клавиша Delete/Backspace: выделены СТРОКИ — удаляем OFF на сервере; иначе —
  // стандартная очистка ячеек Glide, которая идёт через applyEdits (в истории).
  const handleDelete = useCallback(
    (sel: GridSelection): GridSelection | boolean => {
      if (sel.rows.length > 0) {
        deleteOffRows(sel.rows);
        return false;
      }
      // STAT снимаем ЯВНО: дефолтная очистка кастомной ячейки-выпадашки Glide до
      // applyEdits не доходит → ручной «вопрос» клавишей Delete не снимался. Чистим
      // сами через applyEdits (v='' → stat_manual=0 → возврат к авто-ярлыку по правилам).
      // Срабатывает, когда выделение целиком в колонке STAT (одна ячейка / верт. диапазон).
      const cur = sel.current;
      // DAY — та же беда (юзер 2026-07-03: «дату выбрали, а удалить клавишей не выходит»):
      // выделение целиком в колонке DAY → чистим дату явно через applyEdits.
      const dayCol = FLOW_COLUMNS.findIndex((c) => c.kind === 'day');
      if (cur && dayCol >= 0 && cur.range.x === dayCol && cur.range.width === 1) {
        const edits: { location: Item; value: EditableGridCell }[] = [];
        for (let y = cur.range.y; y < cur.range.y + cur.range.height; y++) {
          edits.push({
            location: [dayCol, y] as Item,
            value: {
              kind: GridCellKind.Custom,
              allowOverlay: true,
              copyData: '',
              data: { kind: 'flow-day', value: '', label: '' },
            } satisfies FlowDayCell,
          });
        }
        if (edits.length > 0) {
          applyEdits(edits);
          return false;
        }
      }
      const statCol = FLOW_COLUMNS.findIndex((c) => c.id === 'stat');
      if (cur && statCol >= 0 && cur.range.x === statCol && cur.range.width === 1) {
        const edits: { location: Item; value: EditableGridCell }[] = [];
        for (let y = cur.range.y; y < cur.range.y + cur.range.height; y++) {
          edits.push({
            location: [statCol, y] as Item,
            value: {
              kind: GridCellKind.Custom,
              allowOverlay: true,
              copyData: '',
              data: { kind: 'flow-dropdown', value: '', options: [] },
            } satisfies FlowDropdownCell,
          });
        }
        if (edits.length > 0) {
          applyEdits(edits);
          return false;
        }
      }
      return true;
    },
    [deleteOffRows, applyEdits],
  );

  // Отмена/повтор: применяем обратную/прямую сторону последней записи. Правка идёт
  // через тот же writeCells/remove — в Фазе 1 здесь же уйдёт серверный патч.
  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    if (entry.kind === 'cells') {
      writeCells(entry.before);
      syncEdits(entry.before); // отмена = тоже правка → на сервер
    } else reinsertRows(entry.removed);
    redoRef.current.push(entry);
    // Выделение НЕ сбрасываем — после «назад» отменённые ячейки остаются
    // выделенными (как в Google/Excel), панель снизу не слетает.
    syncHistory();
  }, [writeCells, syncEdits, reinsertRows, syncHistory]);

  const redo = useCallback(() => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    if (entry.kind === 'cells') {
      writeCells(entry.after);
      syncEdits(entry.after);
    } else removeRowsByIds(new Set(entry.removed.map((x) => x.row.id)));
    undoRef.current.push(entry);
    syncHistory();
  }, [writeCells, syncEdits, removeRowsByIds, syncHistory]);

  // Glide шлёт сюда изменения выделения (клик/Shift/Ctrl). Запоминаем якорь+фокус
  // одиночно выбранной колонки/строки/ячейки (для drag и Shift+стрелок) и снимаем рамку
  // «скопировано» при любой смене выделения.
  const handleSelectionChange = useCallback((sel: GridSelection) => {
    // Клик/протяжка по колонке КЛАСТЕРА (col 0) → выделяем ЦЕЛЫЕ строки, но ТОЛЬКО OFF
    // (их можно удалить с сервера). Не-OFF в диапазоне игнорируем → колонка CLST работает
    // как «номера строк» для удаления OFF. (Выделение строго в col 0: width 1, x 0.)
    const cur = sel.current;
    if (cur && sel.columns.length === 0 && sel.rows.length === 0 && cur.range.x === 0 && cur.range.width === 1) {
      const y = cur.range.y;
      const h = cur.range.height;
      let rowsSel = CompactSelection.empty();
      let any = false;
      for (let r = y; r < y + h; r++) {
        const vr = viewRowsRef.current[r];
        if (vr && String(vr.day_wk ?? '').toUpperCase() === 'OFF') { rowsSel = rowsSel.add(r); any = true; }
      }
      if (any) {
        colAnchorRef.current = null; colFocusRef.current = null;
        cellAnchorRef.current = null; cellFocusRef.current = null;
        const first = rowsSel.first();
        rowAnchorRef.current = h === 1 && first != null ? first : null;
        rowFocusRef.current = rowAnchorRef.current;
        setCopiedRegions([]);
        setSelection({ columns: CompactSelection.empty(), rows: rowsSel, current: undefined });
        return;
      }
      // нет OFF в выделении кластера → обычное выделение ячейки (ниже).
    }
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
    // Якорь ВЫДЕЛЕНИЯ ЯЧЕЕК: ставим на ОДИНОЧНОЙ ячейке (клик); диапазон (наш Shift+
    // стрелки) якорь не сбрасывает; строка/колонка — сбрасывает.
    if (cur && sel.columns.length === 0 && sel.rows.length === 0) {
      if (cur.range.width === 1 && cur.range.height === 1) {
        cellAnchorRef.current = [cur.cell[0], cur.cell[1]];
        cellFocusRef.current = [cur.cell[0], cur.cell[1]];
      }
    } else if (!cur) {
      cellAnchorRef.current = null;
      cellFocusRef.current = null;
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
      return;
    }
    // Shift+стрелки по ЯЧЕЙКАМ — расширяем ВЫДЕЛЕНИЕ-ДИАПАЗОН САМИ (нативное поведение Glide
    // «прыгало» без выделения). Якорь = ячейка клика; фокус двигаем; контролируемый scrollTo.
    if (
      cellAnchorRef.current !== null &&
      cellFocusRef.current !== null &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.cancel();
      const lastRow = viewRowsRef.current.length - 1;
      const lastCol = FLOW_COLUMNS.length - 1;
      const [ac, ar] = cellAnchorRef.current;
      let [fc, fr] = cellFocusRef.current;
      if (e.key === 'ArrowDown') fr = Math.min(lastRow, fr + 1);
      else if (e.key === 'ArrowUp') fr = Math.max(0, fr - 1);
      else if (e.key === 'ArrowRight') fc = Math.min(lastCol, fc + 1);
      else fc = Math.max(0, fc - 1);
      cellFocusRef.current = [fc, fr];
      setSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
        current: {
          cell: [fc, fr],
          range: { x: Math.min(ac, fc), y: Math.min(ar, fr), width: Math.abs(fc - ac) + 1, height: Math.abs(fr - ar) + 1 },
          rangeStack: [],
        },
      });
      gridRef.current?.scrollTo(fc, fr, 'both', 0, 0);
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

  // — умная (многоуровневая) сортировка: уровни копятся в порядке выбора —
  /** Задать сортировку колонки: если колонка уже в списке — меняем её направление
   *  (позиция/приоритет сохраняется), иначе добавляем В КОНЕЦ (станет следующим ключом). */
  const applyColumnSort = useCallback((colId: string, dir: 'asc' | 'desc') => {
    orderMapRef.current = null; // явная смена сортировки → свежий порядок сразу
    setSortLevels((prev) => {
      const idx = prev.findIndex((l) => l.colId === colId);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { colId, dir };
        return next;
      }
      return [...prev, { colId, dir }];
    });
    setSelection(emptySelection());
  }, []);
  /** Убрать сортировку конкретной колонки (остальные уровни сохраняются). */
  const clearColumnSort = useCallback((colId: string) => {
    orderMapRef.current = null;
    setSortLevels((prev) => prev.filter((l) => l.colId !== colId));
    setSelection(emptySelection());
  }, []);
  /** Сбросить ВСЮ умную сортировку — возврат к порядку WF_SORT (кнопка «×» в панели). */
  const clearAllSorts = useCallback(() => {
    orderMapRef.current = null;
    setSortLevels([]);
    setSelection(emptySelection());
  }, []);

  const handleSort = useCallback(
    (dir: 'asc' | 'desc') => {
      if (!menuColId) return;
      applyColumnSort(menuColId, dir);
    },
    [menuColId, applyColumnSort],
  );

  const handleSortReset = useCallback(() => {
    if (!menuColId) return;
    clearColumnSort(menuColId);
  }, [menuColId, clearColumnSort]);

  // Человекочитаемая последовательность сортировки — для подсказки кнопки «Сортировка».
  const sortSummary = useMemo(
    () =>
      sortLevels
        .map((l) => `${FLOW_COLUMNS.find((c) => c.id === l.colId)?.title ?? l.colId} ${l.dir === 'asc' ? '↑' : '↓'}`)
        .join(' → '),
    [sortLevels],
  );

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

  // «Очистить» фильтр колонки = полный сброс (снять поиск + вернуть все галочки) → показать
  // всё. Единообразно с фильтром заказов (интуитивно: очистить = убрать фильтр, не «спрятать всё»).
  const handleClearColumnFilter = useCallback(() => {
    if (!menuColId) return;
    updateColumnFilter(menuColId, () => ({ search: '', excluded: new Set<string>() }));
  }, [menuColId, updateColumnFilter]);

  // «Сбросить» = СНЯТЬ все галочки (исключить все значения колонки) → ничего не показано,
  // дальше юзер отмечает только нужные. («Очистить» — наоборот, возвращает все галочки.)
  const handleDeselectAllColumn = useCallback(() => {
    if (!menuColId) return;
    updateColumnFilter(menuColId, (cur) => ({ search: cur.search, excluded: new Set(menuValues) }));
  }, [menuColId, updateColumnFilter, menuValues]);

  // — «умный» фильтр MAT (под-фильтры по скрытым полям материала) —
  const updateMatSub = useCallback(
    (sub: FlowMatSubId, updater: (cur: FlowMatSubState) => FlowMatSubState) => {
      setMatFilter((prev) => ({
        ...prev,
        [sub]: updater(prev[sub] ?? { search: '', excluded: new Set<string>() }),
      }));
      setSelection(emptySelection());
    },
    [],
  );
  const handleMatSearch = useCallback(
    (sub: FlowMatSubId, q: string) => updateMatSub(sub, (cur) => ({ search: q, excluded: cur.excluded })),
    [updateMatSub],
  );
  const handleMatToggle = useCallback(
    (sub: FlowMatSubId, value: string) =>
      updateMatSub(sub, (cur) => {
        const excluded = new Set(cur.excluded);
        if (excluded.has(value)) excluded.delete(value);
        else excluded.add(value);
        return { search: cur.search, excluded };
      }),
    [updateMatSub],
  );
  const handleMatClear = useCallback(
    (sub: FlowMatSubId) => updateMatSub(sub, () => ({ search: '', excluded: new Set<string>() })),
    [updateMatSub],
  );
  // «Сбросить» под-поле = снять все галочки (исключить все значения под-поля).
  const handleMatDeselectAll = useCallback(
    (sub: FlowMatSubId) =>
      updateMatSub(sub, (cur) => ({ search: cur.search, excluded: new Set(matSubValues[sub] ?? []) })),
    [updateMatSub, matSubValues],
  );
  const handleMatClearAll = useCallback(() => {
    setMatFilter({});
    setSelection(emptySelection());
  }, []);

  // — «умный» фильтр ORD (заказы целиком + отдельные позиции) —
  const handleOrdToggleOrder = useCallback((ord: string) => {
    setOrdFilter((prev) => {
      const orders = new Set(prev.orders);
      const positions = new Set(prev.positions);
      if (orders.has(ord)) {
        orders.delete(ord);
        // Сняли заказ → убираем и его ограничения по позициям (ключи `ord|...`).
        for (const k of positions) if (k.startsWith(`${ord}|`)) positions.delete(k);
      } else {
        orders.add(ord);
      }
      return { orders, positions };
    });
    setSelection(emptySelection());
  }, []);
  const handleOrdTogglePosition = useCallback((ord: string, it: string) => {
    const key = `${ord}|${it}`;
    setOrdFilter((prev) => {
      const positions = new Set(prev.positions);
      if (positions.has(key)) positions.delete(key);
      else positions.add(key);
      return { orders: prev.orders, positions };
    });
    setSelection(emptySelection());
  }, []);
  const handleOrdClearAll = useCallback(() => {
    setOrdFilter({ orders: new Set(), positions: new Set() });
    setSelection(emptySelection());
  }, []);
  const handleOrdSelectAllPositions = useCallback((ord: string) => {
    // «Все» позиции заказа = весь заказ: убираем точечные ограничения, заказ выбран.
    setOrdFilter((prev) => {
      const positions = new Set(prev.positions);
      for (const k of positions) if (k.startsWith(`${ord}|`)) positions.delete(k);
      const orders = new Set(prev.orders);
      orders.add(ord);
      return { orders, positions };
    });
    setSelection(emptySelection());
  }, []);

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
      const t = rowTheme(r, molIsGone(r, molByWarehouse));
      if (t?.bg) {
        o.bgCell = t.bg;
        o.bgCellMedium = t.bg;
      }
      if (t?.text) o.textDark = t.text;
      // «Обманка отчёта» рисуется РАДУЖНЫМ переливом в drawCell (не статичным фоном здесь) —
      // только при СОВПАДЕНИИ кол-ва по ЕИ (isCheatRow). Тут фон/текст под неё не трогаем.
      // Линии-разделители КЛАСТЕРА и СКЛАДА (TO) рисуются в drawCell (опаково, по данным,
      // ДО колонки номера) — строковый horizontalBorderColor здесь НЕ используем (он
      // заходил на колонку номера). Тут только фон/текст условного форматирования.
      return Object.keys(o).length > 0 ? o : undefined;
    },
    [viewRows, molByWarehouse],
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
      // Приоритет подсветки: OFF (нет заказа) → «Нет» (склад вне графика, синий) → NEW →
      // STAT «вопрос». OFF НИКОГДА не перебиваем анимацией (он краснее и важнее); «Нет»
      // важнее NEW — без кластера строку нельзя сформировать.
      // «Обманка отчёта» (увезли = открыто снова, кол-во по ЕИ совпадает) — РАДУЖНЫЙ перелив,
      // ВЫСШИЙ приоритет (важнее OFF/NEW): это ошибка-сигнал, её надо видеть сразу. Расхождение
      // кол-ва (остаток) обманкой НЕ считается (isCheatRow). Иначе — обычный sweep по типу строки.
      // ТЗ §4: RGB по реальной причине. flowSignalKind — единый вердикт сигнала строки:
      // repeat_done (повторяшка → радуга), signed_open (СЭД подписан, OBD открыта → кислотный
      // пурпур), sed_pending (СЭД не подписан/отклонён → приглушённый красный). Сигнал поставки/
      // СЭД важнее стадии строки; нет сигнала → обычный sweep по типу строки (OFF/нет/new/вопрос).
      const sig = r && r.day_wk !== 'OFF' ? flowSignalKind(isCheatRow(r), sedByAnchor.get(`${r.ord}|${r.it}`), transferNoDayByAnchor.has(`${r.ord}|${r.it}`)) : null;
      const rainbow = sig === 'repeat_done';
      const sigSweep = sig === 'signed_open' || sig === 'sed_pending' || sig === 'transfer_no_day' ? SIGNAL_SWEEP[sig] : null;
      const sweep = rainbow || sigSweep
        ? sigSweep
        : r
          ? r.day_wk === 'OFF'
            ? null
            : r.clst === CLST_NONE
              ? SWEEP_NET
              : r.day_wk === 'new'
                ? SWEEP_NEW
                : r.stat === 'вопрос'
                  ? SWEEP_VOPROS
                  : null
          : null;
      const lastColUnderlay = col === FLOW_COLUMNS.length - 1;
      const lastRowUnderlay = row === viewRows.length - 1;
      if (rainbow) {
        const W = gridPxWidthRef.current || rect.x + rect.width * 4;
        const phase = (performance.now() / RAINBOW_CYCLE_MS) % 1;
        const g = ctx.createLinearGradient(0, 0, W, 0);
        const N = 24;
        for (let i = 0; i <= N; i++) {
          const p = i / N;
          const hue = (((p - phase) * 360) % 360 + 360) % 360;
          g.addColorStop(p, `hsla(${hue.toFixed(0)},90%,58%,${RAINBOW_ALPHA})`);
        }
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(rect.x + 1, rect.y + 1, rect.width - (lastColUnderlay ? 2 : 1), rect.height - (lastRowUnderlay ? 2 : 1));
        ctx.restore();
        (args as unknown as { requestAnimationFrame?: () => void }).requestAnimationFrame?.();
      } else if (sweep) {
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
        ctx.save();
        ctx.fillStyle = g;
        ctx.fillRect(rect.x + 1, rect.y + 1, rect.width - (lastColUnderlay ? 2 : 1), rect.height - (lastRowUnderlay ? 2 : 1));
        ctx.restore();
        // Двигаем анимацию ШТАТНЫМ механизмом Glide: просим следующий кадр — Glide
        // перерисует эту ячейку (как у встроенного last-updated flash). Надёжнее внешнего
        // updateCells, который покадрово не перерисовывал. (requestAnimationFrame есть в
        // рантайм-args, но не в публичном типе DrawCellCallback — отсюда узкий каст.)
        (args as unknown as { requestAnimationFrame?: () => void }).requestAnimationFrame?.();
      }
      // CLST «ПН КХП 6» (юзер 2026-07-02): ДЕНЬ недели ЖИРНЫМ, кластер и число — обычным.
      // Рисуем текст сами (частичная жирность в одной ячейке); фоновые слои выше не задеты.
      const clstSpec = FLOW_COLUMNS[col];
      if (clstSpec?.id === 'clst' && r && r.clst && r.clst !== CLST_NONE) {
        const parts = String(r.clst).split(' ');
        const wd = parts[0] ?? '';
        const rest = parts.slice(1).join(' ');
        const px = Math.round(colFontPx('clst') * zoom);
        const pad = args.theme.cellHorizontalPadding ?? Math.max(4, Math.round(BASE_HPAD * zoom));
        ctx.save();
        ctx.fillStyle = args.theme.textDark;
        ctx.textBaseline = 'middle';
        const tx = rect.x + pad;
        const ty = rect.y + rect.height / 2 + 0.5;
        ctx.font = `700 ${px}px ${GRID_FONT_FAMILY}`;
        ctx.fillText(wd, tx, ty);
        if (rest) {
          const wdW = ctx.measureText(`${wd} `).width;
          ctx.font = `${px}px ${GRID_FONT_FAMILY}`;
          ctx.fillText(rest, tx + wdW, ty);
        }
        ctx.restore();
      } else {
        drawContent();
      }
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
    [viewRows, isCheatRow, sedByAnchor, transferNoDayByAnchor, zoom],
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
    const sortedDir = sortRef.current.get(args.column.id ?? '') ?? null;
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
        // Сопоставляем по сырому значению (как хранится), но ПОКАЗЫВАЕМ — отформатированным
        // как в таблице/фильтре (МОЛ без смайлика-статуса, даты «июн. 4», числа с пробелами).
        if (searchMatcher(String(row[spec.id] ?? ''))) {
          total++;
          if (matches.length < SEARCH_CAP_PER_COL) {
            matches.push({ id: row.id, value: flowFilterText(spec, row) });
          }
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
        syncEdits(after); // → сервер + реалтайм
        setActiveMatch(null);
      }
      setReplaceResult(changed); // подтверждение «заменено N» (0 = ничего не подошло)
    },
    [searchMatcher, rows, writeCells, pushHistory, syncEdits],
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
        {/* «Сортировка» = применить актуальный порядок. Правки строк таблицу НЕ
            пересортировывают (строка остаётся под руками); когда показ разошёлся с
            актуальным сортом — кнопка горит янтарным. «×» рядом — сброс умной
            сортировки (уровни из меню колонок) к порядку WF_SORT. */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={applySortNow}
            title={
              orderStale
                ? `Есть строки не на своих местах — нажмите, чтобы пересортировать${
                    sortLevels.length > 0 ? `\nСортировка: ${sortSummary}` : ''
                  }`
                : sortLevels.length > 0
                  ? `Порядок актуален. Сортировка: ${sortSummary}`
                  : 'Порядок актуален (WF_SORT). Правки не двигают строки до нажатия'
            }
            className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] transition-all ${
              orderStale
                ? 'border-[#C2620E]/70 text-[#0A0A0A] shadow-[0_0_8px_rgba(194,98,14,0.5)]'
                : sortLevels.length > 0
                  ? 'border-accent-clay/70 text-[#0A0A0A]'
                  : 'border-black/10 text-[#6B6862]'
            } ${sortLevels.length > 0 ? 'rounded-r-none border-r-0' : ''}`}
          >
            <ArrowDownUp size={13} strokeWidth={1.75} />
            Сортировка
          </button>
          {sortLevels.length > 0 && (
            <button
              type="button"
              onClick={clearAllSorts}
              title={`Сбросить умную сортировку (${sortSummary}) — вернуть порядок WF_SORT`}
              className={`flex h-6 w-5 items-center justify-center rounded-r-md border text-[12px] text-[#6B6862] transition-colors hover:text-danger ${
                orderStale ? 'border-[#C2620E]/70' : 'border-accent-clay/70'
              }`}
            >
              ×
            </button>
          )}
        </div>
        {/* Месяц ФОРМИРОВАНИЯ — общий для всех (сервер помнит, реалтайм). По нему
            считается CLST. Смена под паролем (как «скрипты»); рядом аватар того,
            кто выбрал; нельзя прошлый месяц и месяц без «дней без доставки». */}
        <div className="h-5 w-px bg-black/[0.08]" />
        <FlowMonthPicker year={planYear} month={planMonth} info={planMonthInfo} onChanged={applyPlanMonth} />
        {/* Вид «Общий / Личный» (filter-views): Общий — серверный, виден всем, с аватаром
            автора; Личный — приватный (localStorage). Меняет только источник состояния вида. */}
        <FlowViewSwitch
          mode={viewMode}
          onModeChange={handleViewModeChange}
          sharedAuthor={sharedAuthor}
          hasSharedView={hasSharedView}
          hasPersonalView={hasPersonalView}
          onReset={handleViewReset}
        />
        {/* Служебный тумблер «OFF» (P2): OFF-фантомы скрыты из рабочего вида; нажми, чтобы
            показать для ручной чистки. Бейдж — сколько их сейчас. */}
        {(offCount > 0 || showOff) && (
          <button
            type="button"
            onClick={() => setShowOff((v) => !v)}
            title={
              showOff
                ? 'OFF-фантомы показаны — нажмите, чтобы скрыть'
                : 'Показать OFF-фантомы (скрытые позиции для переноса/чистки)'
            }
            className={`flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] transition-colors ${
              showOff
                ? 'border-accent-clay/70 text-[#0A0A0A]'
                : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]'
            }`}
          >
            OFF
            {offCount > 0 && <span className="tabular-nums opacity-70">{offCount}</span>}
          </button>
        )}
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
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
            Загрузка формирования…
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
            onCellActivated={onCellActivated}
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
            rowMarkers="none"
            freezeColumns={8}
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
            {/* Одна ЕИ — агрегаты в строку; несколько ЕИ — стрелка → табличка по каждой ЕИ
                (как в Google), чтобы тонны/штуки/комплекты не смешивались и всё влезло. */}
            {selStats.units.length === 1 && (
              <>
                <span className="text-black/25">·</span>
                <span className="rounded bg-black/[0.06] px-1.5 py-px text-[11px] font-semibold text-[#2A2925]">
                  {selStats.units[0]!.unit}
                </span>
                <FlowStat label="Сумма" value={selStats.units[0]!.sum} unit={selStats.units[0]!.unit} />
                <FlowStat label="Среднее" value={selStats.units[0]!.avg} unit={selStats.units[0]!.unit} />
                <FlowStat label="Мин" value={selStats.units[0]!.min} unit={selStats.units[0]!.unit} />
                <FlowStat label="Макс" value={selStats.units[0]!.max} unit={selStats.units[0]!.unit} />
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
        {/* Транспортная норма по выделению (одна номенклатура + один отправитель/получатель):
            сколько кол-ва не хватает до нормы — просто и с толерансом ×1.5. */}
        {selNorm && (
          <>
            <span className="text-black/25">·</span>
            <span className="rounded bg-accent-clay/15 px-1.5 py-px text-[11px] font-semibold text-[#8A4B2E]">
              норма {selNorm.minQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
            </span>
            <span>
              не хватает{' '}
              <span className="tabular-nums font-semibold text-[#2A2925]">
                {selNorm.needPlain.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
              </span>
            </span>
            <span className="text-black/25">·</span>
            <span>
              с толерансом{' '}
              <span className="tabular-nums font-semibold text-[#2A2925]">
                {selNorm.needTol.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {selNorm.uom}
              </span>
            </span>
          </>
        )}
        {/* Объём — справа: «Показано X из Y» где Y = АКТИВНЫЕ (не-OFF) строки (юзер 2026-06-14).
            OFF не входят (их счётчик — на тумблере «OFF» вверху). */}
        <span className="ml-auto">
          {viewRows.length < nonOffCount ? (
            <>
              Показано{' '}
              <span className="tabular-nums text-[#2A2925]">{viewRows.length.toLocaleString('ru-RU')}</span> из{' '}
              <span className="tabular-nums text-[#2A2925]">{nonOffCount.toLocaleString('ru-RU')}</span>
            </>
          ) : (
            <>
              <span className="tabular-nums text-[#2A2925]">{nonOffCount.toLocaleString('ru-RU')}</span> строк
            </>
          )}
        </span>
      </div>

      <FlowHeaderMenu
        state={
          menu && FLOW_COLUMNS[menu.colIndex]?.kind !== 'mat' && FLOW_COLUMNS[menu.colIndex]?.kind !== 'order'
            ? menu
            : null
        }
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
      {/* «Умный» фильтр MAT — несколько под-фильтров по скрытым полям материала. */}
      <FlowMatFilterMenu
        state={menu && FLOW_COLUMNS[menu.colIndex]?.kind === 'mat' ? menu : null}
        filters={matFilter}
        values={matSubValues}
        onSearch={handleMatSearch}
        onToggleValue={handleMatToggle}
        onClear={handleMatClear}
        onDeselectAll={handleMatDeselectAll}
        onClearAll={handleMatClearAll}
        onClose={() => setMenu(null)}
      />
      {/* «Умный» фильтр ORD — заказы в две колонки, у каждого его позиции пилюлями. */}
      <FlowOrdFilterMenu
        state={menu && FLOW_COLUMNS[menu.colIndex]?.kind === 'order' ? menu : null}
        orders={ordData}
        search={ordSearch}
        sortDir={sortLevels.find((l) => l.colId === 'ord')?.dir ?? null}
        onSort={(dir) => applyColumnSort('ord', dir)}
        onSortReset={() => clearColumnSort('ord')}
        selectedOrders={ordFilter.orders}
        selectedPositions={ordFilter.positions}
        onSearch={setOrdSearch}
        onToggleOrder={handleOrdToggleOrder}
        onTogglePosition={handleOrdTogglePosition}
        onSelectAllPositions={handleOrdSelectAllPositions}
        onClearAll={handleOrdClearAll}
        onClose={() => setMenu(null)}
      />
      <ContactActionDialog request={contactReq} onClose={() => setContactReq(null)} />

      {/* Единая карточка номенклатуры: двойной клик по номенклатуре (без плашки) ИЛИ конфликт
          расчётного статуса (с жёлтой плашкой). Правка нормы (MIN QTY) → пересчёт статуса у всех. */}
      <VghEditCard
        noNum={vghCard?.noNum ?? null}
        seed={vghCard ? { mat: vghCard.mat, uom: vghCard.uom } : null}
        note={vghCard?.note}
        onClose={() => setVghCard(null)}
      />

      {/* Карточка ИСТОРИИ движения позиции по якорю (клик по колонке ИСТОРИЯ). */}
      <FlowAnchorHistoryCard
        target={historyCard}
        load={(ord, it) => flowDeliveryEventsGet(api, ord, it)}
        onClose={() => setHistoryCard(null)}
      />

      {/* Окно-предупреждение по МОЛ: чужой склад / договор истёк / дата вне срока договора. */}
      <Dialog.Root open={molError !== null} onOpenChange={(o) => { if (!o) setMolError(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            {...blockingDialogContentProps}
            className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
                <AlertTriangle size={16} strokeWidth={2} />
              </span>
              <Dialog.Title className="min-w-0 flex-1 self-center text-[13.5px] font-normal leading-relaxed tracking-[-0.005em] text-text-secondary [text-wrap:pretty]">
                {molError?.body}
              </Dialog.Title>
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

/** ЕИ-меры (вес/объём/длина/площадь) — 3 знака если есть дробь, иначе целым. Штучные
 *  (ШТ/КМП/РУЛ/КОР/АМП/ПАР/УПК…) — всегда целым (юзер 2026-06-06). */
const MEASURE_UNITS = new Set(['КГ', 'Т', 'Г', 'Л', 'М', 'М2', 'М3', 'М³', 'ПМ', 'КМ', 'ММ', 'СМ', 'ГА']);
/** Число итога: мерная ЕИ → 3 знака при наличии дроби (иначе целым); штучная → целым. */
function fmtStatNum(n: number, unit: string): string {
  if (!MEASURE_UNITS.has(unit.trim().toUpperCase())) return Math.round(n).toLocaleString('ru-RU');
  const r = Math.round(n * 1000) / 1000;
  const hasFrac = Math.abs(r - Math.round(r)) > 1e-9;
  return r.toLocaleString(
    'ru-RU',
    hasFrac ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : { maximumFractionDigits: 0 },
  );
}

/** Один агрегат строки-счётчика (подпись + число) на светлом листе. */
function FlowStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <span>
      {label}: <span className="tabular-nums text-[#2A2925]">{fmtStatNum(value, unit)}</span>
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
                  <td className="px-2.5 py-1.5 text-right text-text-primary">{fmtStatNum(u.sum, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.avg, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.min, u.unit)}</td>
                  <td className="px-2.5 py-1.5 text-right">{fmtStatNum(u.max, u.unit)}</td>
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
