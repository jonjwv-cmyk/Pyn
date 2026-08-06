// ============================================================
// flow-tabulator-form.tsx — вкладка «Формирование» на Tabulator (ТЗ 2026-08-06).
// ============================================================
// Полная замена glide-грида FlowSandboxGrid для этапа «Формирование»:
//  • вкладка САМОСТОЯТЕЛЬНАЯ — никаких переносов в План/Отчёт (ТЗ п.2, п.3);
//  • внешний вид — светлый «как Транспорт», плотнее + вертикальные разделители (п.5);
//  • колонки 1:1 с эталонным файлом «1. Формирование.xlsx» (п.9):
//      зелёные — всегда видны, скрыть нельзя; жёлтые — скрыты по умолчанию;
//  • строка со ЗАПОЛНЕННЫМ днём доставки (DAY) заливается RGB 102/255/153 (п.1);
//  • OFF/NEW вынесены в отдельную колонку, в DAY остаётся только дата (п.10);
//  • фильтры сбоку фасетами, скрытие/перестановка колонок, история по ячейке (п.6–8);
//  • подвал агрегатов — строго по ОДНОЙ колонке + транспортная норма (п.11).
// Шаблон поведения (range copy/paste, вид личный/общий, фасеты) — flow-tabulator-transport.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  TabulatorFull as Tabulator,
  type CellComponent,
  type ColumnDefinition,
  type RowComponent,
} from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './flow-tabulator-themes.css';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowDownUp,
  Bell,
  ClipboardPaste,
  Copy,
  FileDown,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  flowPlanMonthGet,
  flowStatDropdownGroups,
  flowViewGet,
  flowViewSet,
  flowWorkflowEdit,
  flowWorkflowGet,
  type FlowChangedEvent,
  type FlowRow,
  type VghChangedEvent,
  type VghRow,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { copyText, readClipboardText } from '@/lib/clipboard';
import { loadFlowDiskCache, saveFlowDiskCacheDebounced } from '@/lib/flow-disk-cache';
import { sessionStore } from '@/lib/token-store';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { useMolStore } from '@/lib/stores';
import { molStatusKind, formatMobilePhone, isMolAssignableUntil } from '@/lib/mol-format';
import { useVghStore, normVghKey } from '@/lib/vgh-store';
import { ensureVghLoaded, applyVghChanged } from '@/lib/vgh-repo';
import { useMapStore } from '@/lib/map-store';
import { initMap } from '@/lib/map-repo';
import {
  canUseLiveWarehouseScheduleForMonth,
  monthKey,
  useScheduleMonthsMeta,
} from '@/lib/schedule/use-schedule-sync';
import { PynCalendar } from '@/components/pyn-table/PynCalendar';
import '@/components/pyn-table/pyn-table-theme.css';
import { FlowColumnsMenu, type FlowColumnToggle } from './FlowColumnsMenu';
import { FlowViewSwitch } from './FlowViewSwitch';
import type { FlowViewMode } from './flow-view';
import { FacetSection } from './flow-tab-facet';
import { makeStatEditor } from './flow-tab-stat-editor';
import { FlowTabStats, type StatsCell } from './flow-tabulator-stats';
import { FlowMolPickPopover, type MolPickOption } from './flow-mol-pick-popover';
import { PRIORITY_OPTIONS, priorityDisplay } from './flow-eps';
import { whKey, whMapGet } from './flow-warehouse';
import { pointCellDisplay, FLOW_WAREHOUSE_POINT_PURPOSE } from './flow-map-points';
import {
  MONTH_ABBR_RU,
  fmtPct,
  graphDateSoon,
  isoAddDays,
  livePct,
  makeGraphHolidayPredicate,
  nearestGraphDate,
  todayIsoLocal,
} from './flow-sandbox.fixtures';
import { exportFormXlsx } from './flow-form-xlsx';

/** Заливка строки, у которой назначен день доставки (ТЗ п.1: RGB 102/255/153). */
const DAY_SET_BG = 'rgb(102, 255, 153)';

/** Строка грида: поля FlowRow + ЖИВЫЕ производные (пересчитываются от справочников). */
export interface FormRow extends FlowRow {
  /**
   * ГРАФ — «день недели · кластер · ближайшее число» («ЧТ КХП 9»), как в старом
   * гриде: следующий день поставки по графику ВЫБРАННОГО месяца формирования.
   * Склада нет в графике → «Нет» (такие строки идут ВВЕРХУ).
   */
  graf: string;
  /** Дата ГРАФа «без перескока недель» (≤ сегодня+7) — подпись зелёная. */
  graf_soon: boolean;
  /** Ключ группировки по дню для разделительных линий. */
  graf_key: string;
  /** OFF/NEW — отдельная колонка-индикатор (ТЗ п.10), day_wk держит только дату. */
  offnew: string;
  /** DAY — только дата доставки (ISO), без 'new'/'OFF'. */
  day: string;
  /** ORD name, date — «кто создал · когда» одной ячейкой. */
  ord_info: string;
  /** % + HY — доля вывезенного (livePct: (chg − qty)/chg), как в старом гриде. */
  pct: number | null;
  /** Согл — галочка 0/1 как boolean. */
  sogl_on: boolean;
  /** ЖИВОЙ вес = кол-во × вес 1 ЕИ из базы ВГХ (нет в базе — значение строки). */
  kg_live: number | null;
  /** ЖИВОЙ объём = кол-во × объём 1 ЕИ из базы ВГХ. */
  v_live: number | null;
  /** ЖИВОЕ тех-наименование из базы ВГХ (иначе — снимок строки). */
  tech_name: string;
  /** Цвет статуса МОЛ (яркая точка в попапе). */
  mol_color: string;
  /** Вид статуса для пилы: ok / error / neutral (мягкая заливка в ячейке). */
  mol_kind: 'ok' | 'error' | 'neutral' | '';
  /** Телефон МОЛ из живой базы. */
  mol_phone: string;
}

/** Склада нет в графике месяца — день/кластер не определить (как в старом гриде). */
const CLST_NONE = 'Нет';
/** Склада нет в базе / помечен удалённым (юзер 2026-08-06) — выше «Нет». */
const CLST_REMOVED = 'склад удалён';
/** Порядок дней недели для сортировки ГРАФ. */
const WD_RANK: Record<string, number> = { ПН: 1, ВТ: 2, СР: 3, ЧТ: 4, ПТ: 5, СБ: 6, ВС: 7 };
/**
 * Сортировка ГРАФ: «склад удалён» → «Нет» → дни (ПН…), внутри дня ВЫЕЗД → КХП → НТМК.
 */
function grafSortKey(graf: string): number {
  if (!graf || graf === CLST_REMOVED) return -2;
  if (graf === CLST_NONE) return -1;
  const parts = graf.split(' ');
  const wd = parts[0] ?? '';
  const second = parts[1] ?? '';
  const cl = second && !/^\d+$/.test(second) ? second : '';
  const w = WD_RANK[wd] ?? 8;
  const c = cl === 'ВЫЕЗД' ? 0 : cl === 'КХП' ? 1 : 2;
  return w * 10 + c;
}

/** Иконка трубки перед телефоном (inline SVG, без React в formatter). */
const PHONE_ICO =
  '<svg class="flow-form-mol-phone-ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

/**
 * ФИО МОЛ: пробелы сжать + ВЕРХНИЙ РЕГИСТР (юзер: ДОЛМАТОВ, не Долматов).
 * Если есть запись в базе — берём её канон, потом upper.
 */
function molFioUpper(raw: string, resolve?: (key: string) => string | undefined): string {
  let s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s || /нет\s*мол/i.test(s)) return '';
  if (resolve) {
    const hit = resolve(s.toUpperCase());
    if (hit) s = hit.trim().replace(/\s+/g, ' ');
  }
  return s.toLocaleUpperCase('ru-RU');
}

/** Правый край колонки — жирная вертикальная граница блока (cssClass). */
const COL_BLOCK_END = 'flow-form-block-end';

/** День недели склада в снапшоте графика месяца (как frozenWeekdayOf старого грида). */
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

interface HistoryEntry {
  rowId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  at: string;
  who: string;
}

interface TabViewState {
  facets: Record<string, string[]>;
  search: string;
  hiddenCols: string[];
  colOrder?: string[];
}

/**
 * Раскрывающийся выбор STAT — РОВНО как в Отчёте (`flowStatDropdownGroups`
 * с includePlanReportOnly), но БЕЗ пункта «выполнено»: он про факт вывоза,
 * в Формировании ему не место (юзер 2026-08-06).
 */
const STAT_GROUPS = flowStatDropdownGroups({ includePlanReportOnly: true }).filter(
  (g) => g.id !== 'выполнено',
);

/**
 * Локальное ХРАНЕНИЕ выгруженного списка формирования (юзер 2026-08-06).
 * Пишем через `pyn:cache` IPC — main process шифрует Electron safeStorage
 * (Mac Keychain / Windows DPAPI) и кладёт в `userData/cache/<name>.bin`.
 * Ключ принадлежит ОС-пользователю: файл читаем ТОЛЬКО нашим приложением на
 * этой машине, скопированный на другую — бесполезен. Тот же механизм, что у
 * базы персон и прежнего грида, поэтому имя кэша сохраняем.
 */
const DISK_CACHE_ROWS = 'flow_rows_workflow';

const PERSONAL_VIEW_KEY = 'pyn:flow-form-tabulator:personal-view';

/**
 * ЗЕЛЁНЫЕ колонки эталона (ТЗ п.9) — всегда видны, скрыть нельзя: их нет в списке
 * переключаемых, поэтому меню «Колонки» их просто не показывает.
 * fr · to_wh · pr · stat · q · no_num · mat · uom · qty · kg · v.
 */

/** Переключаемые колонки — порядок = порядок эталонного файла. */
const TOGGLEABLE_COLS: FlowColumnToggle[] = [
  { id: 'graf', title: 'ГРАФ' },
  { id: 'ord', title: 'ORD' },
  { id: 'point', title: 'ТОЧКА' },
  { id: 'day', title: 'DAY' },
  { id: 'time_at', title: 'Выгружен' },
  { id: 'ord_info', title: 'ORD name, date' },
  { id: 'offnew', title: 'OFF/NEW' },
  { id: 'pct', title: '% + HY' },
  { id: 'tech_name', title: 'TECH NAME' },
  { id: 'priority', title: 'ПРИОР.' },
  { id: 'note', title: 'NOTE' },
  { id: 'delivery', title: 'ОКНО' },
  { id: 'mol', title: 'МОЛ' },
  { id: 'sogl_on', title: 'СОГЛ.' },
  { id: 'request', title: 'ЗАПРОС' },
];
const TOGGLEABLE_IDS = new Set(TOGGLEABLE_COLS.map((c) => c.id));

/**
 * ЖЁЛТЫЕ колонки эталона — скрыты по умолчанию (ТЗ п.9). ЗАПРОС в эталонном файле
 * колонки не имеет, но участвует в правиле удаления заказов (п.10) — держим её
 * доступной, тоже скрытой.
 */
const DEFAULT_HIDDEN = new Set(['time_at', 'ord_info', 'tech_name', 'request']);
const DEFAULT_VISIBLE = new Set(TOGGLEABLE_COLS.filter((c) => !DEFAULT_HIDDEN.has(c.id)).map((c) => c.id));
const DEFAULT_COL_ORDER = TOGGLEABLE_COLS.map((c) => c.id);

/** Поля, которые правятся руками. Всё остальное — данные выгрузки, read-only. */
const EDITABLE_FIELDS = new Set([
  'to_wh',
  'pr',
  'day',
  'offnew',
  'stat',
  'point',
  'priority',
  'note',
  'delivery',
  'mol',
  'sogl_on',
  'request',
]);
/** Поля, которые Del/Backspace очищает (галочка снимается отдельно). */
const CLEARABLE_FIELDS = new Set([
  'day',
  'offnew',
  'stat',
  'point',
  'priority',
  'note',
  'delivery',
  'mol',
  'request',
]);

/** OFF/NEW — значения выпадающего списка (в UI UPPER, в day_wk: OFF | new). */
const OFFNEW_OPTIONS = ['OFF', 'NEW'] as const;

/** Колонки с числами — для подвала агрегатов (ТЗ п.11). */
const NUMERIC_FIELDS = new Set(['qty', 'kg_live', 'v_live', 'pct']);

/** UI-поле → поле БД (что реально шлём на сервер). */
function wireFieldOf(field: string): string {
  if (field === 'day' || field === 'offnew') return 'day_wk';
  if (field === 'sogl_on') return 'sogl';
  return field;
}

/**
 * OFF/NEW → wire day_wk. Канон БД: 'OFF' | 'new' | '' (как import/handlers-flow).
 * Пустое — снять метку. Иное — null (отклонить).
 */
function parseOffNewInput(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const up = s.toUpperCase();
  if (up === 'OFF') return 'OFF';
  if (up === 'NEW') return 'new';
  return null;
}

/**
 * Маркер «свободный» МОЛ в буфере (поиск/ручной ввод, не из списка склада).
 * Такой можно вставлять на любую строку; МОЛ из доступных — только на свой склад.
 */
const MOL_CLIP_FREE = '\u001e';

function packMolClip(fio: string, free: boolean): string {
  const s = fio.trim();
  if (!s) return '';
  return free ? `${MOL_CLIP_FREE}${s}` : s;
}

/** Разбор вставки: ФИО + free-флаг (без телефона из «ФИО\\u001fтел»). */
function unpackMolClip(raw: unknown): { fio: string; free: boolean } {
  let s = String(raw ?? '').trim();
  if (!s) return { fio: '', free: false };
  let free = false;
  if (s.startsWith(MOL_CLIP_FREE)) {
    free = true;
    s = s.slice(MOL_CLIP_FREE.length);
  }
  if (s.includes('\u001f')) s = (s.split('\u001f')[0] ?? '').trim();
  s = (s.split(/\r?\n/)[0] ?? '').trim();
  const sep = s.search(/\s[·—–-]\s*\+?\d/);
  if (sep > 0) s = s.slice(0, sep).trim();
  // маркер мог оказаться после trim-обрезки телефона
  if (s.startsWith(MOL_CLIP_FREE)) {
    free = true;
    s = s.slice(MOL_CLIP_FREE.length);
  }
  return { fio: s, free };
}

const DOW_RU = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'] as const;
/**
 * Месяцы — ОБЩИЙ канон раздела «Поток» (MONTH_ABBR_RU в flow-sandbox.fixtures).
 * Свой список тут был причиной разнобоя: «6 авг · 14:30» в одной колонке и
 * «6 авг 25» в другой. Формат один на все даты вкладки:
 *   дата          → «6 авг.»            (год добавляем, только если НЕ текущий)
 *   дата + время  → «6 авг. · 14:30»
 *   день недели   → «ПН · 6 авг.»
 * Разделитель между смысловыми частями везде « · ».
 */
function fmtFlowDate(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  const mon = MONTH_ABBR_RU[d.getMonth()] ?? '';
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${String(d.getFullYear()).slice(-2)}`;
  return `${d.getDate()} ${mon}${year}`;
}

/** «ПН · 6 авг» — компактно, как в Транспорте. */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m?.[1] || !m[2] || !m[3]) return String(iso ?? '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  return `${DOW_RU[d.getDay()] ?? ''} · ${Number(m[3])} ${MONTH_ABBR_RU[Number(m[2]) - 1] ?? ''}`;
}

/** ISO или ДД.ММ.ГГГГ → ISO. */
function parseDayInput(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  return null;
}

/** day_wk из БД: 'new' | 'OFF' | ISO-дата → раскладываем по двум колонкам (ТЗ п.10). */
function splitDayWk(dayWk: string): { day: string; offnew: string } {
  const s = String(dayWk ?? '').trim();
  if (!s) return { day: '', offnew: '' };
  const up = s.toUpperCase();
  if (up === 'OFF') return { day: '', offnew: 'OFF' };
  if (up === 'NEW') return { day: '', offnew: 'NEW' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { day: s, offnew: '' };
  return { day: '', offnew: s };
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Тысячи пробелом, десятичные «,» (3 000,125). */
function fmtRuNum(n: number, minFrac: number, maxFrac: number): string {
  return n
    .toLocaleString('ru-RU', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
      useGrouping: true,
    })
    .replace(/\u00a0/g, ' ')
    .replace(/\u202f/g, ' ');
}

/**
 * QTY / KG: до 3 знаков после запятой; тысячи пробелом (3 000,125).
 * Хвостовые нули дроби не жмём принудительно — max 3, min 0.
 */
function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return fmtRuNum(r, 0, digits);
}

/**
 * V: до первой ненулевой цифры после запятой (включительно);
 * если дробная часть вся 0 — только целая (без «,000»).
 * 1,05 → 1,05; 0,003 → 0,003; 12 → 12; 3 000,4 → 3 000,4.
 */
function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n === 0) return '0';
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const intPart = Math.floor(abs + 1e-12);
  let frac = abs - intPart;
  if (frac < 1e-12) return fmtRuNum(sign * intPart, 0, 0);
  // позиция первой ненулевой цифры после запятой (1…12)
  let pos = 0;
  let f = frac;
  while (pos < 12) {
    pos += 1;
    f *= 10;
    const digit = Math.floor(f + 1e-9);
    if (digit > 0) break;
    f -= digit;
  }
  const r = (Math.round(abs * 10 ** pos) / 10 ** pos) * sign;
  return fmtRuNum(r, 0, pos);
}

/** «2 авг · 14:30». */
function fmtWhen(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtFlowDate(raw)} · ${hh}:${mm}`;
}

/** Дата для ORD name, date: «6 авг 25» (год двумя цифрами, не 2025). */
function fmtOrdInfoDate(raw: string): string {
  return fmtFlowDate(raw);
}

/** «Имя · 6 авг 25». */
function fmtOrdInfo(name: string, when: string): string {
  const n = String(name ?? '').trim();
  const dt = fmtOrdInfoDate(when);
  return [n, dt].filter(Boolean).join(' · ');
}

/** Canvas-измерение ширины текста (для MAT / TECH NAME). */
const _textPxCanvas: { el: HTMLCanvasElement | null } = { el: null };
function textPx(text: string, font = '600 11.5px Inter, system-ui, -apple-system, sans-serif'): number {
  const s = String(text ?? '');
  if (!s) return 0;
  if (typeof document === 'undefined') return s.length * 7;
  const c = (_textPxCanvas.el ??= document.createElement('canvas'));
  const ctx = c.getContext('2d');
  if (!ctx) return s.length * 7;
  ctx.font = font;
  return ctx.measureText(s).width;
}

/**
 * Перенос по словам (как CSS break-word): ширины строк при colInner px.
 * Нужен, чтобы не оставлять «хвост» из 2 символов на 2-й строке.
 */
function wrapLineWidths(text: string, colInner: number): number[] {
  const full = textPx(text);
  if (full <= colInner) return [full];
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const lines: string[] = [];
  let cur = '';
  const flush = (): void => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (cur) cur += tok;
      continue;
    }
    // Слишком длинный токен — режем по символам.
    if (textPx(tok) > colInner) {
      flush();
      let rest = tok;
      while (rest && textPx(rest) > colInner) {
        let lo = 1;
        let hi = rest.length;
        let fit = 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (textPx(rest.slice(0, mid)) <= colInner) {
            fit = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        lines.push(rest.slice(0, fit));
        rest = rest.slice(fit);
      }
      cur = rest;
      continue;
    }
    const trial = cur + tok;
    if (!cur || textPx(trial) <= colInner) cur = trial;
    else {
      flush();
      cur = tok;
    }
  }
  flush();
  return lines.map((l) => textPx(l.replace(/\s+$/g, '')));
}

/**
 * Ширина MAT/TECH:
 *  1) база ~P70 (большинство в 1 строку, не «на максимум»);
 *  2) если перенос даёт хвост < 50% первой строки → расширяем (часто до 1 строки);
 *  3) длинные — wrap + variableHeight, без обрезки по высоте.
 */
function optimalTextColWidth(
  texts: readonly string[],
  opts: { min: number; max: number; pad?: number; pct?: number },
): number {
  const { min, max, pad = 16, pct = 0.7 } = opts;
  const list = texts.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (list.length === 0) return min;

  const fulls = list.map((t) => textPx(t) + pad).sort((a, b) => a - b);
  const at = (p: number) =>
    fulls[Math.min(fulls.length - 1, Math.max(0, Math.round((fulls.length - 1) * p)))]!;

  let w = Math.round(Math.min(max, Math.max(min, at(pct))));

  const expandOnce = (width: number): number => {
    let next = width;
    for (const t of list) {
      const inner = Math.max(48, next - pad);
      const widths = wrapLineWidths(t, inner);
      if (widths.length < 2) continue;
      const first = widths[0] ?? 0;
      const last = widths[widths.length - 1] ?? 0;
      // Хвост короче половины первой строки — глупый перенос → расширяем.
      if (first > 0 && last < first * 0.5) {
        const oneLine = textPx(t) + pad;
        if (oneLine <= max) {
          next = Math.max(next, oneLine);
          continue;
        }
        // Не влезает в max одной строкой — ищем min ширину, где last ≥ 50% first.
        let lo = next;
        let hi = max;
        let best = max;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const ws = wrapLineWidths(t, Math.max(48, mid - pad));
          if (ws.length <= 1) {
            best = mid;
            hi = mid - 1;
          } else {
            const f = ws[0] ?? 0;
            const l = ws[ws.length - 1] ?? 0;
            if (f > 0 && l >= f * 0.5) {
              best = mid;
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          }
        }
        next = Math.max(next, best);
      }
    }
    return Math.round(Math.min(max, Math.max(min, next)));
  };

  // Два прохода — после расширения другие строки тоже могут «разжаться».
  w = expandOnce(w);
  w = expandOnce(w);
  return w;
}

/** Иконка «ввод» в пустой NOTE — как пустой комментарий/ячейка ввода в Транспорте. */
const NOTE_EMPTY_ICO =
  '<svg class="flow-form-note-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

/** Ширина колонки Tabulator (API колонки, не table.setColumnWidth). */
function setColWidth(table: Tabulator, field: string, width: number): void {
  try {
    table.getColumn(field)?.setWidth(width);
  } catch {
    /* колонка скрыта / ещё нет */
  }
}

/**
 * Границы групп (смена дня графика / склада TO) — ОДНИМ проходом по видимым
 * строкам. Пишем прямо в данные, без row.update(): update дёргает перерисовку
 * строки, а нам нужен только флаг для rowFormatter.
 */
function markGroupSeparators(table: Tabulator | null): void {
  if (!table) return;
  try {
    let prev: FormRow | null = null;
    for (const row of table.getRows('active')) {
      const d = row.getData() as FormRow & { _sepDay?: boolean; _sepWh?: boolean };
      d._sepDay = !!prev && prev.graf_key !== d.graf_key;
      d._sepWh = !!prev && !d._sepDay && (prev.to_wh || '') !== (d.to_wh || '');
      prev = d;
    }
  } catch {
    /* таблица ещё строится */
  }
}

function reflowFormLayout(
  table: Tabulator | null,
  rows: readonly FormRow[],
  _visibleHint?: ReadonlySet<string>,
): void {
  if (!table || rows.length === 0) return;
  const { matW, techW } = matTechWidths(rows);
  setColWidth(table, 'mat', matW);
  setColWidth(table, 'tech_name', techW);
  try {
    for (const row of table.getRows()) row.reformat();
    // Родной пересчёт раскладки: без него модуль FrozenColumns держит старые
    // смещения, и закреплённые колонки наезжают друг на друга.
    table.redraw();
  } catch {
    /* строки ещё не построены */
  }
}

/** MAT / TECH NAME ширины из текущего набора строк. */
function matTechWidths(rows: readonly { mat?: string; tech_name?: string }[]): {
  matW: number;
  techW: number;
} {
  return {
    // MAT: чаще короче; max 340 — если хвост <50% — раздвинем до 1 строки.
    matW: optimalTextColWidth(
      rows.map((r) => r.mat ?? ''),
      { min: 140, max: 340, pad: 16, pct: 0.7 },
    ),
    // TECH NAME: длинные допустимы; без потолка 260 — иначе обрезка по высоте/хвосты.
    techW: optimalTextColWidth(
      rows.map((r) => r.tech_name ?? ''),
      { min: 150, max: 420, pad: 16, pct: 0.7 },
    ),
  };
}

function fmtHistValue(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return 'пусто';
  return s.length > 80 ? `${s.slice(0, 78)}…` : s;
}

function fieldTitle(field: string): string {
  const hit = TOGGLEABLE_COLS.find((c) => c.id === field);
  if (hit) return hit.title;
  const locked: Record<string, string> = {
    fr: 'FR',
    to_wh: 'TO',
    pr: 'FR (был)',
    stat: 'STAT',
    q: 'Q',
    no_num: 'NO. №',
    mat: 'MAT',
    uom: 'UoM',
    qty: 'QTY',
    kg_live: 'KG',
    v_live: 'V',
  };
  return locked[field] ?? field;
}

function styleKey(rowId: number, field: string): string {
  return `${rowId}:${field}`;
}

/** Сохранить scroll на время setFilter/setSort (как в Транспорте). */
function withTableScrollPreserved(table: Tabulator | null, fn: () => void): void {
  if (!table) {
    fn();
    return;
  }
  const holder = table.element?.querySelector('.tabulator-tableholder') as HTMLElement | null;
  const top = holder?.scrollTop ?? 0;
  const left = holder?.scrollLeft ?? 0;
  fn();
  if (holder) {
    holder.scrollTop = top;
    holder.scrollLeft = left;
  }
}

function readTableColOrder(table: Tabulator): string[] {
  return table
    .getColumns()
    .map((c) => c.getField())
    .filter((f): f is string => !!f && TOGGLEABLE_IDS.has(f));
}

function applyColVisibility(table: Tabulator, visible: ReadonlySet<string>): void {
  for (const c of TOGGLEABLE_COLS) {
    try {
      if (visible.has(c.id)) table.showColumn(c.id);
      else table.hideColumn(c.id);
    } catch {
      /* колонка ещё не создана */
    }
  }
}

function applyColOrder(table: Tabulator, order: readonly string[]): void {
  const fields = order.filter((f) => {
    try {
      return !!table.getColumn(f);
    } catch {
      return false;
    }
  });
  for (let i = 1; i < fields.length; i++) {
    try {
      table.moveColumn(fields[i]!, fields[i - 1]!, true);
    } catch {
      /* ignore */
    }
  }
}

/** Поиск по всей строке (панель слева). */
function rowHaystack(r: FormRow): string {
  return [
    r.graf, r.ord, r.it, r.fr, r.to_wh, r.pr, r.point, r.day, fmtDay(r.day), r.offnew,
    r.stat, r.no_num, r.mat, r.tech_name, r.uom, r.note, r.mol, r.request, r.priority, r.delivery, r.q,
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Канон-порядок Формирования: отправитель → получатель → номенклатура → заказ/позиция.
 * АВТО-сортировки нет (ТЗ п.9) — запускается только кнопкой «Сортировка» и после
 * выгрузки заказов.
 */
function cmpFormRows(a: FormRow, b: FormRow): number {
  return (
    grafSortKey(a.graf) - grafSortKey(b.graf) ||
    (a.to_wh || '').localeCompare(b.to_wh || '', 'ru') ||
    (a.fr || '').localeCompare(b.fr || '', 'ru') ||
    (a.no_num || '').localeCompare(b.no_num || '', 'ru') ||
    (a.ord || '').localeCompare(b.ord || '', 'ru') ||
    (a.it || '').localeCompare(b.it || '', 'ru') ||
    a.id - b.id
  );
}

/** Снимок для диска — только НЕПУСТОЙ, иначе затрём хороший кэш пустотой. */
function diskSnapshot(map: ReadonlyMap<number, FormRow>): FormRow[] | null {
  const rows = [...map.values()];
  return rows.length > 0 ? rows : null;
}

export function FlowTabulatorForm({
  active,
  chromeLeading,
}: {
  active: boolean;
  /** Как в Транспорте: вкладки этапов слева в chrome-строке (pyn-segment). */
  chromeLeading?: ReactNode;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<Tabulator | null>(null);
  const rowsByIdRef = useRef<Map<number, FormRow>>(new Map());
  const historyMapRef = useRef<Map<string, HistoryEntry[]>>(new Map());
  const loginRef = useRef('');
  const lastFocusRef = useRef<{ rowId: number; field: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  /** Диагностика «где потерялись строки»: пришло с сервера / видно после фильтров. */
  const [rowCounts, setRowCounts] = useState({ total: 0, shown: 0 });
  const [busy, setBusy] = useState(false);
  const [allRows, setAllRows] = useState<FormRow[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [facetSelected, setFacetSelected] = useState<Record<string, Set<string>>>({});
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['stat', 'fr', 'to_wh', 'offnew']));
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => new Set(DEFAULT_VISIBLE));
  const [colOrder, setColOrder] = useState<string[]>(() => [...DEFAULT_COL_ORDER]);
  const [reorderOn, setReorderOn] = useState(false);
  const [viewMode, setViewMode] = useState<FlowViewMode>('personal');
  const [sharedAuthor, setSharedAuthor] = useState({ updatedBy: '', updatedByName: '', updatedAt: '' });
  const [hasSharedView, setHasSharedView] = useState(false);
  const [hasPersonalView, setHasPersonalView] = useState(false);
  const [historyPanel, setHistoryPanel] = useState<{ rowId: number; field: string } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [statsCells, setStatsCells] = useState<StatsCell[]>([]);
  const [dayEdit, setDayEdit] = useState<FormRow | null>(null);
  const [molEdit, setMolEdit] = useState<FormRow | null>(null);

  // Лог сообщений — как в Транспорте (поповер, не инлайн-текст).
  const msgIdRef = useRef(0);
  const [msgLog, setMsgLog] = useState<{ id: number; text: string }[]>([]);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgFlash, setMsgFlash] = useState(false);
  const msgLogRef = useRef<HTMLDivElement | null>(null);
  const setMsg = useCallback((text: string) => {
    if (!text) return;
    msgIdRef.current += 1;
    setMsgLog((log) => [{ id: msgIdRef.current, text }, ...log].slice(0, 40));
    setMsgFlash(true);
  }, []);
  useEffect(() => {
    if (!msgOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (msgLogRef.current && !msgLogRef.current.contains(e.target as Node)) setMsgOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [msgOpen]);

  // ---- справочник складов: ГРАФ (кластер) + список TO по цеху (ТЗ п.9).
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const { whById, whByShop } = useMemo(() => {
    const byId = new Map<
      string,
      {
        shopCode: string | null;
        cluster: string;
        desc: string;
        inSchedule: boolean;
        deliveryDay: string | null;
        removed: boolean;
      }
    >();
    const byShop = new Map<string, string[]>();
    for (const w of warehouses) {
      byId.set(w.id, {
        shopCode: w.shop_code,
        cluster: String(w.cluster ?? ''),
        desc: w.description ?? w.designation ?? '',
        inSchedule: w.in_schedule === 1,
        deliveryDay: w.delivery_day ?? null,
        removed: w.is_removed === 1,
      });
      if (w.shop_code && w.is_removed !== 1) {
        const arr = byShop.get(w.shop_code);
        if (arr) arr.push(w.id);
        else byShop.set(w.shop_code, [w.id]);
      }
    }
    return { whById: byId, whByShop: byShop };
  }, [warehouses]);
  const whByIdRef = useRef(whById);
  const whByShopRef = useRef(whByShop);
  whByIdRef.current = whById;
  whByShopRef.current = whByShop;

  /** Склады ТОГО ЖЕ цеха, что и текущий получатель — варианты замены (ТЗ п.9). */
  const toOptionsFor = useCallback((code: string): string[] => {
    const wh = whMapGet(whByIdRef.current, whKey(code)) ?? whByIdRef.current.get(code);
    const shop = wh?.shopCode;
    if (!shop) return [];
    return whByShopRef.current.get(shop) ?? [];
  }, []);

  // ---- база ВГХ: живые KG / V / тех-имя (юзер 2026-08-06: «нужен живой пересчёт»).
  const vghByKey = useVghStore((s) => s.byKey);
  useEffect(() => {
    void ensureVghLoaded();
  }, []);
  useWsEvent<VghChangedEvent>('vgh_changed', (e) => {
    if (Array.isArray(e.rows)) applyVghChanged(e.rows as unknown as VghRow[]);
  });
  const vghRef = useRef(vghByKey);
  vghRef.current = vghByKey;

  // ---- база МОЛ: ФИО + цвет статуса + телефон (как водители в Транспорте).
  // Точки в попапе — чуть ярче; пила в ячейке — мягкая (CSS --ok/--error/--neutral).
  const molRecords = useMolStore((s) => s.records);
  const { molByWarehouse, molByFio, molAll } = useMemo(() => {
    const COLOR = { ok: '#5a9e6f', error: '#c45c5c', neutral: '#9AA0A6' } as const;
    const RANK = { ok: 0, error: 1, neutral: 2 } as const;
    const byWh = new Map<string, MolPickOption[]>();
    const byFio = new Map<string, MolPickOption>();
    const all: MolPickOption[] = [];
    for (const r of molRecords) {
      if (!r.fio) continue;
      const phone = r.mobile || r.work || '';
      const kind = molStatusKind(r.status || '');
      const opt: MolPickOption = {
        fio: r.fio,
        phone,
        color: COLOR[kind],
        status: (r.status || '').trim(),
        until: r.warehouseUntil || '',
      };
      if (!byFio.has(r.fio.trim().toUpperCase())) {
        byFio.set(r.fio.trim().toUpperCase(), opt);
        all.push(opt);
      }
      const wid = whKey(r.warehouseId);
      if (!wid) continue;
      const arr = byWh.get(wid);
      if (arr) arr.push({ ...opt, onWarehouse: true });
      else byWh.set(wid, [{ ...opt, onWarehouse: true }]);
    }
    for (const arr of byWh.values()) {
      arr.sort((a, b) => {
        const ra = RANK[molStatusKind(a.status)];
        const rb = RANK[molStatusKind(b.status)];
        return ra !== rb ? ra - rb : a.fio.localeCompare(b.fio, 'ru');
      });
    }
    all.sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    return { molByWarehouse: byWh, molByFio: byFio, molAll: all };
  }, [molRecords]);
  const molByWhRef = useRef(molByWarehouse);
  const molByFioRef = useRef(molByFio);
  const molAllRef = useRef(molAll);
  molByWhRef.current = molByWarehouse;
  molByFioRef.current = molByFio;
  molAllRef.current = molAll;

  /** МОЛ закреплён за складом-получателем строки? (для вставки/протяжки — нельзя чужих). */
  const isMolOnToWh = useCallback((fio: string, toWh: string): boolean => {
    const key = fio.trim().toUpperCase();
    if (!key) return true; // очистка — всегда ок
    const list = whMapGet(molByWhRef.current, whKey(toWh)) ?? molByWhRef.current.get(toWh) ?? [];
    return list.some((o) => o.fio.trim().toUpperCase() === key);
  }, []);

  // ---- точки выгрузки с карты (выпадашка колонки ТОЧКА).
  const mapPoints = useMapStore((s) => s.doc.points);
  useEffect(() => {
    void initMap();
  }, []);
  const mapPointsRef = useRef(mapPoints);
  mapPointsRef.current = mapPoints;

  // ---- месяц формирования + график месяца → колонка ГРАФ.
  const [planYear, setPlanYear] = useState(() => new Date().getFullYear());
  const [planMonth, setPlanMonth] = useState(() => new Date().getMonth() + 1);
  useEffect(() => {
    void flowPlanMonthGet(api)
      .then((m) => {
        if (m?.year) setPlanYear(m.year);
        if (m?.month) setPlanMonth(m.month);
      })
      .catch(() => {});
  }, []);
  const planMonths = useMemo(
    () => [
      { year: planYear, month: planMonth },
      planMonth === 12 ? { year: planYear + 1, month: 1 } : { year: planYear, month: planMonth + 1 },
    ],
    [planYear, planMonth],
  );
  const planMetaMap = useScheduleMonthsMeta(planMonths);
  const planMeta = planMetaMap.get(monthKey(planYear, planMonth));
  const graphHoliday = useMemo(
    () => makeGraphHolidayPredicate((y, mo) => planMetaMap.get(monthKey(y, mo))?.holidays),
    [planMetaMap],
  );
  const graphCtxRef = useRef({ planYear, planMonth, planMeta, graphHoliday });
  graphCtxRef.current = { planYear, planMonth, planMeta, graphHoliday };

  /** Живой ГРАФ склада-получателя: «ЧТ КХП 9» / «Нет» / «склад удалён». */
  const grafOf = useCallback((toWh: string): { graf: string; soon: boolean } => {
    const { planYear: py, planMonth: pm, planMeta: meta, graphHoliday: hol } = graphCtxRef.current;
    if (!meta || whByIdRef.current.size === 0) return { graf: '', soon: false };
    const code = String(toWh ?? '').trim();
    const wh = code
      ? whMapGet(whByIdRef.current, whKey(code)) ?? whByIdRef.current.get(code)
      : undefined;
    // Нет в базе или is_removed — «склад удалён» (выше «Нет» в сортировке).
    if (!code || !wh || wh.removed) return { graf: CLST_REMOVED, soon: false };
    const shops = meta.shops ?? [];
    const weekday = shops.length
      ? frozenWeekdayOf(shops, toWh)
      : canUseLiveWarehouseScheduleForMonth(py, pm) && wh.inSchedule
        ? wh.deliveryDay
        : null;
    if (!weekday) return { graf: CLST_NONE, soon: false };
    const todayIso = todayIsoLocal();
    const tomorrow = isoAddDays(todayIso, 1);
    const monthStart = `${py}-${String(pm).padStart(2, '0')}-01`;
    const graphRef = monthStart > tomorrow ? monthStart : tomorrow;
    const near = nearestGraphDate(weekday, graphRef, meta.holidays ?? [], hol);
    const num = near ? String(parseInt(near.slice(8, 10), 10)) : '';
    const cluster = wh.cluster === 'ВЫЕЗД' || wh.cluster === 'КХП' ? wh.cluster : '';
    return {
      graf: [weekday, cluster, num].filter(Boolean).join(' '),
      soon: graphDateSoon(near, todayIso),
    };
  }, []);

  const buildRow = useCallback(
    (r: FlowRow): FormRow => {
      const { day, offnew } = splitDayWk(r.day_wk);
      const { graf, soon } = grafOf(r.to_wh);
      // ЖИВОЙ пересчёт по базе ВГХ: KG = кол-во × вес 1 ЕИ, V = кол-во × объём 1 ЕИ,
      // тех-имя — из базы. Нет записи/значения — оставляем снимок строки.
      const base = vghRef.current.get(normVghKey(r.no_num));
      const qtyNum = typeof r.qty === 'number' ? r.qty : Number(r.qty);
      const hasQty = Number.isFinite(qtyNum);
      const kgLive =
        base?.weight_kg != null && hasQty ? Math.round(qtyNum * base.weight_kg * 1000) / 1000 : r.kg;
      const vLive =
        base?.volume_m3 != null && hasQty ? Math.round(qtyNum * base.volume_m3 * 1000) / 1000 : r.v;
      const molFio = String(r.mol ?? '').trim();
      const molInfo = molByFioRef.current.get(molFio.toUpperCase());
      const molKind: FormRow['mol_kind'] = molInfo
        ? molStatusKind(molInfo.status || '')
        : molFio
          ? 'neutral'
          : '';
      return {
        ...r,
        graf,
        graf_soon: soon,
        graf_key: graf || CLST_NONE,
        day,
        offnew,
        ord_info: fmtOrdInfo(String(r.created_by ?? ''), String(r.load_dt ?? '')),
        pct: livePct({ qty: r.qty, chg: r.chg }),
        sogl_on: Number(r.sogl ?? 0) === 1,
        kg_live: kgLive,
        v_live: vLive,
        tech_name: base?.tech_name || r.mat_full || '',
        mol_color: molInfo?.color ?? '',
        mol_kind: molKind,
        mol_phone: molInfo?.phone ?? '',
      };
    },
    [grafOf],
  );

  const buildRows = useCallback((rows: FlowRow[]): FormRow[] => rows.map(buildRow), [buildRow]);

  /** Перечитать базу формирования (кнопка «повторить» в плашке ошибки). */
  const reloadRows = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try {
      const raw = await flowWorkflowGet(api);
      if (raw.length === 0 && rowsByIdRef.current.size > 0) {
        setMsg('Сервер вернул 0 строк — оставил то, что уже загружено');
        return;
      }
      const rows = buildRows(raw).sort(cmpFormRows);
      rowsByIdRef.current = new Map(rows.map((r) => [r.id, r]));
      setAllRows(rows);
      setRowCounts({ total: rows.length, shown: rows.length });
      saveFlowDiskCacheDebounced(DISK_CACHE_ROWS, () => diskSnapshot(rowsByIdRef.current), 500);
      const table = tableRef.current;
      if (table) {
        await table.replaceData(rows.map((r) => ({ ...r, _canonSort: 0 })));
        reflowFormLayout(table, rows);
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [buildRows, setMsg]);

  /** Справочник обновился (ВГХ / МОЛ / склады / график) → пересобрать живые поля. */
  const rebuildLive = useCallback(() => {
    const table = tableRef.current;
    if (rowsByIdRef.current.size === 0) return;
    const next = new Map<number, FormRow>();
    for (const [id, row] of rowsByIdRef.current) next.set(id, buildRow(row));
    rowsByIdRef.current = next;
    const rows = [...next.values()];
    setAllRows(rows);
    if (table) {
      try {
        // Пересчёт ширины MAT/TECH + единой высоты после живого tech_name из ВГХ.
        void table
          .updateData(rows.map((r) => ({ ...r, _canonSort: 0 })))
          .then(() => reflowFormLayout(table, rows))
          .catch(() => {});
      } catch {
        /* таблица ещё строится */
      }
    }
  }, [buildRow]);
  // Deps — ПРИМИТИВНЫЙ ключ: planMeta/planMetaMap отдают новый объект на каждый
  // рендер, и на ссылках эффект зацикливался (setAllRows → рендер → новый planMeta →
  // снова эффект) — вкладка «не грузилась».
  const liveKey = `${vghByKey.size}|${molByFio.size}|${whById.size}|${planYear}-${planMonth}|${
    planMeta?.shops?.length ?? -1
  }|${(planMeta?.holidays ?? []).join(',')}`;
  useEffect(() => {
    rebuildLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  /**
   * Авто-МОЛ: пусто / «нет МОЛа» + ровно один назначаемый МОЛ на складе → подставить.
   * Debounce 400ms — как в FlowSandboxGrid (волны загрузки базы).
   */
  useEffect(() => {
    if (molByWarehouse.size === 0 || rowsByIdRef.current.size === 0) return;
    const t = window.setTimeout(() => {
      type Acc = { id: number; row_version: number; fields: { mol: string } };
      const edits: Acc[] = [];
      for (const r of rowsByIdRef.current.values()) {
        if (String(r.day_wk ?? '').toUpperCase() === 'OFF') continue;
        const list = whMapGet(molByWhRef.current, whKey(r.to_wh)) ?? [];
        const valid = list.filter((o) => isMolAssignableUntil(o.until));
        const only = valid.length === 1 ? valid[0] : undefined;
        if (!only) continue;
        const trimmed = String(r.mol ?? '').trim();
        const empty = !trimmed || /нет\s*мол/i.test(trimmed);
        if (!empty) continue;
        if (trimmed === only.fio) continue;
        edits.push({
          id: r.id,
          row_version: r.row_version,
          fields: { mol: molFioUpper(only.fio) },
        });
      }
      if (edits.length === 0) return;
      void (async () => {
        try {
          const res = await flowWorkflowEdit(api, edits);
          for (const saved of res.rows) {
            const prev = rowsByIdRef.current.get(saved.id);
            if (!prev) continue;
            const rebuilt = buildRow({ ...prev, ...saved } as FlowRow);
            rowsByIdRef.current.set(saved.id, rebuilt);
            try {
              tableRef.current?.getRow(saved.id)?.update({ ...rebuilt, _canonSort: 0 });
              tableRef.current?.getRow(saved.id)?.reformat();
            } catch {
              /* row not in table */
            }
          }
          setAllRows((prev) => prev.map((x) => rowsByIdRef.current.get(x.id) ?? x));
          saveFlowDiskCacheDebounced(DISK_CACHE_ROWS, () => diskSnapshot(rowsByIdRef.current), 500);
          if (edits.length > 0) setMsg(`Авто-МОЛ: подставлено строк — ${edits.length}`);
        } catch {
          /* сеть — молча, юзер впишет руками */
        }
      })();
    }, 400);
    return () => window.clearTimeout(t);
  }, [molByWarehouse, allRows, buildRow, setMsg]);

  // ---- фасеты: по видимым переключаемым + зелёным колонкам.
  const facetDefs = useMemo(() => {
    const locked = [
      { id: 'fr', title: 'FR' },
      { id: 'to_wh', title: 'TO' },
      { id: 'stat', title: 'STAT' },
      { id: 'uom', title: 'UoM' },
    ];
    const toggles = TOGGLEABLE_COLS.filter((c) => visibleCols.has(c.id) && c.id !== 'pct' && c.id !== 'ord_info');
    return [...locked, ...toggles.map((c) => ({ id: c.id, title: c.title }))];
  }, [visibleCols]);

  const facetValue = useCallback((row: FormRow, field: string): string => {
    const v = (row as unknown as Record<string, unknown>)[field];
    if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
    if (field === 'priority') return priorityDisplay(String(v ?? ''));
    return String(v ?? '');
  }, []);

  const facetOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const def of facetDefs) {
      const seen = new Set<string>();
      for (const r of allRows) {
        const v = facetValue(r, def.id);
        if (v) seen.add(v);
      }
      out[def.id] = [...seen].sort((a, b) => a.localeCompare(b, 'ru'));
    }
    return out;
  }, [facetDefs, allRows, facetValue]);

  const facetCounts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const def of facetDefs) {
      const counts: Record<string, number> = {};
      for (const r of allRows) {
        const v = facetValue(r, def.id);
        if (!v) continue;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      out[def.id] = counts;
    }
    return out;
  }, [facetDefs, allRows, facetValue]);

  const activeFacetCount = useMemo(
    () => Object.values(facetSelected).reduce((n, s) => n + (s?.size ? 1 : 0), 0),
    [facetSelected],
  );

  const applyFilters = useCallback(
    (q: string, facets: Record<string, Set<string>>) => {
      const table = tableRef.current;
      if (!table) return;
      const needle = q.trim().toLowerCase();
      withTableScrollPreserved(table, () => {
        table.setFilter((data: FormRow) => {
          if (needle && !rowHaystack(data).includes(needle)) return false;
          for (const [field, sel] of Object.entries(facets)) {
            if (!sel || sel.size === 0) continue;
            if (!sel.has(facetValue(data, field))) return false;
          }
          return true;
        });
        markGroupSeparators(table);
      });
    },
    [facetValue],
  );

  useEffect(() => {
    applyFilters(search, facetSelected);
    // Считаем ПОСЛЕ применения фильтра — иначе «пусто» не отличить от «всё отфильтровано».
    const t = window.setTimeout(() => {
      const table = tableRef.current;
      if (!table) return;
      try {
        setRowCounts({ total: rowsByIdRef.current.size, shown: table.getRows('active').length });
      } catch {
        /* таблица ещё строится */
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [search, facetSelected, applyFilters, allRows]);

  const toggleFacetValue = useCallback((field: string, value: string, only = false) => {
    setFacetSelected((prev) => {
      const next: Record<string, Set<string>> = { ...prev };
      if (only) {
        next[field] = new Set([value]);
        return next;
      }
      const cur = new Set(prev[field] ?? []);
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      next[field] = cur;
      return next;
    });
  }, []);

  /** Ручная сортировка — кнопкой (ТЗ п.9: авто-сортировки нет). */
  const applyOurSort = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    withTableScrollPreserved(table, () => {
      table.setSort([{ column: '_canonSort', dir: 'asc' }]);
      markGroupSeparators(table);
    });
  }, []);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const key = styleKey(entry.rowId, entry.field);
    const list = historyMapRef.current.get(key) ?? [];
    historyMapRef.current.set(key, [entry, ...list].slice(0, 50));
    setHistoryTick((t) => t + 1);
  }, []);

  /** Одна правка ячейки → сервер (row_version из локальной копии — она всегда свежая). */
  const doEditCell = useCallback(
    async (cell: CellComponent) => {
      const row = cell.getData() as FormRow;
      const field = cell.getField();
      if (!EDITABLE_FIELDS.has(field)) return;
      const oldValue = cell.getOldValue();
      let newValue: unknown = cell.getValue();
      if (newValue == null) newValue = field === 'sogl_on' ? false : '';
      if (typeof newValue === 'string') newValue = newValue.trim();
      const oldNorm = oldValue == null ? '' : typeof oldValue === 'string' ? oldValue.trim() : oldValue;
      if (oldNorm === newValue) return;

      let wireValue: string | number = '';
      if (field === 'sogl_on') {
        wireValue = newValue ? 1 : 0;
      } else if (field === 'day') {
        const iso = parseDayInput(String(newValue));
        if (iso == null) {
          setMsg('День доставки: нужен формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ');
          cell.restoreOldValue();
          return;
        }
        wireValue = iso;
        newValue = iso;
      } else if (field === 'offnew') {
        const wire = parseOffNewInput(newValue);
        if (wire == null) {
          setMsg('OFF/NEW: выберите OFF, NEW или очистите');
          cell.restoreOldValue();
          return;
        }
        wireValue = wire;
        // В ячейке показываем канон UI (OFF/NEW/пусто), не wire 'new'.
        newValue = wire === 'new' ? 'NEW' : wire;
        if (cell.getValue() !== newValue) cell.setValue(newValue, true);
      } else if (field === 'mol') {
        // Полное ФИО ВЕРХНИМ РЕГИСТРОМ (ДОЛМАТОВ ИВАН …).
        const fio = molFioUpper(String(newValue), (k) => molByFioRef.current.get(k)?.fio);
        wireValue = fio;
        newValue = fio;
        if (cell.getValue() !== fio) cell.setValue(fio, true);
      } else {
        wireValue = String(newValue);
      }

      const local = rowsByIdRef.current.get(row.id);
      const version = local?.row_version ?? row.row_version;
      try {
        const res = await flowWorkflowEdit(api, [
          { id: row.id, row_version: version, fields: { [wireFieldOf(field)]: wireValue } },
        ]);
        if (res.conflicts.length > 0) {
          setMsg('Конфликт версий — строку изменили параллельно, откатил правку');
          cell.restoreOldValue();
          return;
        }
        const saved = res.rows[0];
        if (saved && local) {
          // Ответ может содержать не все поля — мержим поверх локальной строки.
          const rebuilt = buildRow({ ...local, ...saved } as FlowRow);
          rowsByIdRef.current.set(row.id, rebuilt);
          cell.getRow().update({ ...rebuilt, _canonSort: 0 });
          setAllRows((prev) => prev.map((x) => (x.id === row.id ? rebuilt : x)));
        }
        // День / OFF/NEW меняют day_wk → перекраска строки и соседние колонки.
        if (field === 'day' || field === 'offnew') cell.getRow().reformat();
        pushHistory({
          rowId: row.id,
          field,
          oldValue,
          newValue,
          at: new Date().toLocaleString('ru-RU'),
          who: loginRef.current,
        });
      } catch (e) {
        setMsg(`Ошибка сохранения: ${String(e)}`);
        cell.restoreOldValue();
      }
    },
    [buildRow, pushHistory, setMsg],
  );

  const collectRangeCells = useCallback((): CellComponent[] => {
    const table = tableRef.current;
    if (!table || typeof table.getRanges !== 'function') return [];
    const out: CellComponent[] = [];
    try {
      for (const range of table.getRanges()) {
        for (const cell of range.getCells().flat()) out.push(cell);
      }
    } catch {
      /* range module */
    }
    return out;
  }, []);

  const getActiveOrFocusedCell = useCallback((): CellComponent | null => {
    const table = tableRef.current;
    if (!table) return null;
    try {
      const active = (table as unknown as { getActiveCell?: () => CellComponent | false }).getActiveCell?.();
      if (active) return active;
    } catch {
      /* */
    }
    const focus = lastFocusRef.current;
    if (!focus) return null;
    try {
      return table.getRow(focus.rowId)?.getCell(focus.field) ?? null;
    } catch {
      return null;
    }
  }, []);

  const ensureRangeSelection = useCallback((): boolean => {
    const table = tableRef.current;
    if (!table) return false;
    if (collectRangeCells().length > 0) return true;
    const cell = getActiveOrFocusedCell();
    if (!cell) return false;
    try {
      if (typeof table.addRange === 'function') {
        table.addRange(cell, cell);
        return collectRangeCells().length > 0;
      }
    } catch {
      /* */
    }
    return false;
  }, [collectRangeCells, getActiveOrFocusedCell]);

  /** Batch-сохранение после вставки/протяжки диапазона. */
  const persistRangePaste = useCallback(async () => {
    const cells = collectRangeCells();
    if (cells.length === 0) return;
    type Acc = { row_version: number; fields: Record<string, string | number | null> };
    const byRow = new Map<number, Acc>();
    let molPasteRejected = 0;
    for (const cell of cells) {
      const field = cell.getField();
      if (!EDITABLE_FIELDS.has(field)) continue;
      const row = cell.getData() as FormRow;
      const local = rowsByIdRef.current.get(row.id);
      if (!local) continue;
      let value = cell.getValue() as unknown;
      if (value == null) value = field === 'sogl_on' ? false : '';
      if (typeof value === 'string') value = value.trim();
      let wire: string | number;
      if (field === 'sogl_on') {
        const on = Boolean(value);
        if (local.sogl_on === on) continue;
        wire = on ? 1 : 0;
      } else if (field === 'day') {
        const iso = parseDayInput(String(value));
        if (iso == null || iso === local.day) continue;
        wire = iso;
        if (cell.getValue() !== iso) cell.setValue(iso, true);
      } else if (field === 'offnew') {
        const parsed = parseOffNewInput(value);
        if (parsed == null) continue;
        const ui = parsed === 'new' ? 'NEW' : parsed;
        if (local.offnew === ui) continue;
        wire = parsed;
        if (cell.getValue() !== ui) cell.setValue(ui, true);
      } else if (field === 'mol') {
        // Доступный (из списка склада) — только на строки, где он МОЛ склада-получателя.
        // Свободный (поиск/ручной, маркер в буфере) — можно на любую строку.
        const unpacked = unpackMolClip(value);
        const fio = molFioUpper(unpacked.fio, (k) => molByFioRef.current.get(k)?.fio);
        if (fio && !unpacked.free && !isMolOnToWh(fio, local.to_wh)) {
          cell.restoreOldValue();
          molPasteRejected += 1;
          continue;
        }
        if (local.mol === fio) continue;
        wire = fio;
        if (cell.getValue() !== fio) cell.setValue(fio, true);
      } else {
        const prev = String((local as unknown as Record<string, unknown>)[field] ?? '');
        if (prev === String(value)) continue;
        wire = String(value);
      }
      const acc = byRow.get(row.id) ?? { row_version: local.row_version, fields: {} };
      acc.fields[wireFieldOf(field)] = wire;
      byRow.set(row.id, acc);
    }
    if (molPasteRejected > 0) {
      setMsg(
        molPasteRejected === 1
          ? 'МОЛ из списка склада — только на строки своего склада (чужого впишите через поиск)'
          : `МОЛ из списка склада: отклонено строк — ${molPasteRejected}`,
      );
    }
    if (byRow.size === 0) return;
    try {
      const res = await flowWorkflowEdit(
        api,
        [...byRow.entries()].map(([id, acc]) => ({ id, row_version: acc.row_version, fields: acc.fields })),
      );
      for (const saved of res.rows) {
        const prevRow = rowsByIdRef.current.get(saved.id);
        const rebuilt = buildRow({ ...(prevRow as FlowRow | undefined), ...saved } as FlowRow);
        rowsByIdRef.current.set(saved.id, rebuilt);
        const rowComp = cells.find((c) => (c.getData() as FormRow).id === saved.id)?.getRow();
        rowComp?.update({ ...rebuilt, _canonSort: 0 });
        rowComp?.reformat();
      }
      if (res.conflicts.length > 0) setMsg('Конфликт версий при вставке — обновите вкладку');
      setAllRows((prev) => prev.map((r) => rowsByIdRef.current.get(r.id) ?? r));
    } catch (e) {
      setMsg(`Ошибка вставки: ${String(e)}`);
    }
  }, [collectRangeCells, buildRow, setMsg, isMolOnToWh]);
  const persistRangePasteRef = useRef(persistRangePaste);
  persistRangePasteRef.current = persistRangePaste;

  const clearSelectedCells = useCallback(async () => {
    const cells = collectRangeCells().filter((c) => CLEARABLE_FIELDS.has(c.getField()));
    const target = cells.length > 0 ? cells : [];
    if (target.length === 0) {
      const cell = getActiveOrFocusedCell();
      if (cell && CLEARABLE_FIELDS.has(cell.getField())) target.push(cell);
    }
    if (target.length === 0) return;
    for (const cell of target) cell.setValue('', true);
    await persistRangePaste();
  }, [collectRangeCells, getActiveOrFocusedCell, persistRangePaste]);

  const runCopy = useCallback(async () => {
    const table = tableRef.current as Tabulator & {
      modules?: {
        export?: { generateExportList: (c: unknown, s: boolean, r: string, p: string) => unknown };
        clipboard?: { generatePlainContent: (list: unknown) => string };
      };
      options: { clipboardCopyConfig?: unknown };
    };
    if (!table?.modules?.export || !table.modules.clipboard) return;
    if (!ensureRangeSelection()) {
      setMsg('Выделите ячейку');
      return;
    }
    try {
      const list = table.modules.export.generateExportList(
        table.options.clipboardCopyConfig ?? { columnHeaders: false, columnGroups: false, rowHeaders: false },
        false,
        'range',
        'clipboard',
      );
      const plain = table.modules.clipboard.generatePlainContent(list) ?? '';
      await copyText(plain);
      setMsg(plain ? 'Скопировано' : 'Пусто');
    } catch (e) {
      setMsg(`Копирование: ${String(e)}`);
    }
  }, [ensureRangeSelection, setMsg]);

  const runPaste = useCallback(async () => {
    const table = tableRef.current as Tabulator & {
      modules?: { clipboard?: { pasteParser: (d: string) => unknown[] | false; pasteAction: (d: unknown) => unknown } };
    };
    if (!table?.modules?.clipboard) return;
    if (!ensureRangeSelection()) {
      setMsg('Встаньте на ячейку для вставки');
      return;
    }
    let text = '';
    try {
      text = await readClipboardText();
    } catch {
      /* */
    }
    if (!text?.trim()) {
      setMsg('Буфер пуст');
      return;
    }
    const clip = table.modules.clipboard;
    try {
      const rowData = clip.pasteParser.call(clip, text);
      if (!rowData) {
        setMsg('Не разобрал вставку');
        return;
      }
      clip.pasteAction.call(clip, rowData);
      await persistRangePaste();
      setMsg('Вставлено');
    } catch (e) {
      setMsg(`Вставка: ${String(e)}`);
    }
  }, [ensureRangeSelection, persistRangePaste, setMsg]);

  // ---- подвал агрегатов: собираем выделение (ТЗ п.11).
  const refreshStats = useCallback(() => {
    const cells = collectRangeCells();
    if (cells.length === 0) {
      setStatsCells([]);
      return;
    }
    const out: StatsCell[] = [];
    for (const cell of cells) {
      const row = cell.getData() as FormRow;
      const field = cell.getField();
      out.push({
        field,
        numeric: NUMERIC_FIELDS.has(field),
        value: Number(cell.getValue()),
        unit: field === 'kg_live' ? 'КГ' : field === 'v_live' ? 'М3' : field === 'pct' ? '%' : String(row.uom ?? ''),
        rowId: row.id,
        qty: Number(row.qty ?? NaN),
        noKey: String(row.no_num ?? ''),
        toKey: String(row.to_wh ?? ''),
        groupKey: `${row.fr}|${row.to_wh}`,
        uom: String(row.uom ?? ''),
      });
    }
    setStatsCells(out);
  }, [collectRangeCells]);

  // ---- вид (личный / общий).
  const collectView = useCallback((): TabViewState => {
    const table = tableRef.current;
    const facets: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(facetSelected)) facets[k] = [...v];
    const order = table ? readTableColOrder(table) : colOrder;
    const hidden = TOGGLEABLE_COLS.filter((c) => !visibleCols.has(c.id)).map((c) => c.id);
    return { facets, search, hiddenCols: hidden, colOrder: order.length ? order : [...DEFAULT_COL_ORDER] };
  }, [facetSelected, search, colOrder, visibleCols]);

  const applyView = useCallback((v: TabViewState) => {
    const table = tableRef.current;
    setSearch(v.search ?? '');
    const facets: Record<string, Set<string>> = {};
    for (const [k, arr] of Object.entries(v.facets ?? {})) facets[k] = new Set(arr);
    setFacetSelected(facets);
    const hidden = new Set(v.hiddenCols ?? [...DEFAULT_HIDDEN]);
    const nextVisible = new Set(TOGGLEABLE_COLS.map((c) => c.id).filter((id) => !hidden.has(id)));
    setVisibleCols(nextVisible);
    const orderRaw = v.colOrder?.length ? v.colOrder : [...DEFAULT_COL_ORDER];
    const order = orderRaw.filter((f) => TOGGLEABLE_IDS.has(f));
    for (const id of DEFAULT_COL_ORDER) if (!order.includes(id)) order.push(id);
    setColOrder(order);
    if (!table) return;
    applyColOrder(table, order);
    applyColVisibility(table, nextVisible);
  }, []);

  const saveView = useCallback(
    async (mode: FlowViewMode) => {
      const json = JSON.stringify(collectView());
      if (mode === 'personal') {
        localStorage.setItem(PERSONAL_VIEW_KEY, json);
        setHasPersonalView(true);
        setMsg('Личный вид сохранён');
        return;
      }
      setBusy(true);
      try {
        const res = await flowViewSet(api, json);
        setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
        setHasSharedView(!!res.value);
        setMsg('Общий вид сохранён');
      } finally {
        setBusy(false);
      }
    },
    [collectView, setMsg],
  );

  const handleModeChange = useCallback(
    async (m: FlowViewMode) => {
      setViewMode(m);
      if (m === 'personal') {
        const raw = localStorage.getItem(PERSONAL_VIEW_KEY);
        if (raw) {
          try {
            applyView(JSON.parse(raw) as TabViewState);
          } catch {
            /* corrupted */
          }
        }
        return;
      }
      setBusy(true);
      try {
        const res = await flowViewGet(api);
        setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
        setHasSharedView(!!res.value);
        if (res.value) applyView(JSON.parse(res.value) as TabViewState);
      } catch {
        /* сеть — оставляем текущий вид */
      } finally {
        setBusy(false);
      }
    },
    [applyView],
  );

  const handleResetView = useCallback(() => {
    setSearch('');
    setFacetSelected({});
    setVisibleCols(new Set(DEFAULT_VISIBLE));
    setColOrder([...DEFAULT_COL_ORDER]);
    setReorderOn(false);
    const table = tableRef.current;
    if (table) {
      applyColOrder(table, DEFAULT_COL_ORDER);
      applyColVisibility(table, DEFAULT_VISIBLE);
    }
    localStorage.removeItem(PERSONAL_VIEW_KEY);
    setHasPersonalView(false);
  }, []);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    table.options.movableColumns = reorderOn;
  }, [reorderOn]);

  // ---- реалтайм: чужие правки/выгрузка заказов.
  useWsEvent<FlowChangedEvent>('flow_changed', (e) => {
    const rows = Array.isArray((e as unknown as { rows?: FlowRow[] }).rows)
      ? ((e as unknown as { rows?: FlowRow[] }).rows as FlowRow[])
      : [];
    const deleted = Array.isArray((e as unknown as { deleted?: number[] }).deleted)
      ? ((e as unknown as { deleted?: number[] }).deleted as number[])
      : [];
    if (rows.length === 0 && deleted.length === 0) return;
    const table = tableRef.current;
    for (const r of rows) {
      const rebuilt = buildRow(r);
      rowsByIdRef.current.set(rebuilt.id, rebuilt);
      try {
        if (table?.getRow(rebuilt.id)) {
          void table.updateData([{ ...rebuilt, _canonSort: 0 }]);
          table.getRow(rebuilt.id)?.reformat();
        } else {
          void table?.addRow({ ...rebuilt, _canonSort: 0 });
        }
      } catch {
        /* строка ещё не в гриде */
      }
    }
    for (const id of deleted) {
      rowsByIdRef.current.delete(id);
      try {
        table?.getRow(id)?.delete();
      } catch {
        /* */
      }
    }
    setAllRows(() => [...rowsByIdRef.current.values()]);
    saveFlowDiskCacheDebounced(DISK_CACHE_ROWS, () => diskSnapshot(rowsByIdRef.current));
  });

  // ---- построение таблицы (один раз).
  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const s = await sessionStore.load();
        loginRef.current = s?.user?.login ?? '';
      } catch {
        /* без сессии — читаем как есть */
      }
      // 1) Мгновенный старт с зашифрованного диска (переживает перезапуск).
      const cached = await loadFlowDiskCache<FormRow[]>(DISK_CACHE_ROWS);
      if (alive && cached && cached.length > 0 && rowsByIdRef.current.size === 0) {
        const cachedRows = buildRows(cached).sort(cmpFormRows);
        rowsByIdRef.current = new Map(cachedRows.map((r) => [r.id, r]));
        setAllRows(cachedRows);
        setRowCounts({ total: cachedRows.length, shown: cachedRows.length });
        setMsg(`Из локального хранилища: ${cachedRows.length} строк — обновляю с сервера…`);
      }
      // 2) Сервер догоняет.
      let raw: FlowRow[];
      try {
        raw = await flowWorkflowGet(api);
      } catch (e) {
        // Один повтор: на старте окна сессия/сокет могли ещё не подняться.
        await new Promise((r) => setTimeout(r, 1200));
        try {
          raw = await flowWorkflowGet(api);
        } catch (e2) {
          if (!alive) return;
          setLoadError(String(e2 ?? e));
          setLoading(false);
          return;
        }
      }
      if (!alive || !containerRef.current) return;
      if (raw.length === 0 && rowsByIdRef.current.size > 0) {
        // Сервер ответил пусто, а на экране уже есть данные (диск/прошлый ответ) —
        // не стираем их: пустой ответ почти всегда сбой, а не «база опустела».
        setMsg('Сервер вернул 0 строк — оставил данные из локального хранилища');
        setLoading(false);
        return;
      }
      const rows = buildRows(raw).sort(cmpFormRows);
      rowsByIdRef.current = new Map(rows.map((r) => [r.id, r]));
      setAllRows(rows);
      setRowCounts({ total: rows.length, shown: rows.length });
      setMsg(`Формирование: с сервера пришло строк — ${rows.length}`);
      saveFlowDiskCacheDebounced(DISK_CACHE_ROWS, () => diskSnapshot(rowsByIdRef.current), 500);

      // MAT / TECH NAME: P70 + расширение при «хвосте» <50% первой строки.
      const { matW, techW } = matTechWidths(rows);

      const text = (field: string, title: string, width: number, extra: Partial<ColumnDefinition> = {}): ColumnDefinition => ({
        title,
        field,
        width,
        minWidth: Math.min(width, 56),
        headerSort: false,
        vertAlign: 'middle',
        accessorClipboard: (v: unknown) => String(v ?? ''),
        ...extra,
      });

      const columns: ColumnDefinition[] = [
        { title: '', field: 'id', visible: false, headerSort: false, frozen: true },
        {
          title: '',
          field: '_canonSort',
          visible: false,
          headerSort: false,
          frozen: true,
          sorter: (_a, _b, aRow, bRow) => cmpFormRows(aRow.getData() as FormRow, bRow.getData() as FormRow),
        },
        text('graf', 'ГРАФ', 92, {
          frozen: true,
          cssClass: `flow-form-col-graf ${COL_BLOCK_END}`,
          // «ЧТ КХП 9» / «Нет» / «склад удалён». Близкая дата — зелёная.
          formatter: (cell) => {
            const r = cell.getData() as FormRow;
            const t = String(cell.getValue() ?? '');
            if (!t) return '';
            if (t === CLST_REMOVED) {
              return `<span class="flow-form-graf-removed">${escapeHtml(t)}</span>`;
            }
            if (t === CLST_NONE) return `<span class="flow-form-graf-none">${escapeHtml(t)}</span>`;
            return `<span class="${r.graf_soon ? 'flow-form-graf-soon' : ''}">${escapeHtml(t)}</span>`;
          },
        }),
        text('ord', 'ORD', 116, {
          frozen: true,
          formatter: (cell) => {
            const r = cell.getData() as FormRow;
            const it = String(r.it ?? '').trim();
            const ord = String(cell.getValue() ?? '');
            return escapeHtml(it ? `${ord} | ${it}` : ord);
          },
        }),
        text('fr', 'FR', 56, { frozen: true }),
        text('to_wh', 'TO', 62, {
          frozen: true,
          editor: 'list',
          // Список = склады ТОГО ЖЕ цеха, что и текущий получатель (ТЗ п.9).
          // Колбэк, а не готовый объект: варианты зависят от конкретной строки.
          editorParams: ((cell: CellComponent) => ({
            values: toOptionsFor(String((cell.getData() as FormRow).to_wh ?? '')),
            autocomplete: true,
            freetext: true,
            listOnEmpty: true,
          })) as unknown as ColumnDefinition['editorParams'],
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('pr', 'FR', 56, { editor: 'input', cellEdited: (cell) => void doEditCell(cell) }),
        text('point', 'ТОЧКА', 110, {
          cssClass: `flow-form-wrap ${COL_BLOCK_END}`,
          // Раскрытие списка точек выгрузки склада-получателя (с карты).
          editor: 'list',
          editorParams: ((cell: CellComponent) => {
            const r = cell.getData() as FormRow;
            const pd = pointCellDisplay(r.point, mapPointsRef.current, r.to_wh, FLOW_WAREHOUSE_POINT_PURPOSE);
            return { values: [...pd.options], autocomplete: true, freetext: true, allowEmpty: true, listOnEmpty: true };
          }) as unknown as ColumnDefinition['editorParams'],
          formatter: (cell) => {
            const r = cell.getData() as FormRow;
            const pd = pointCellDisplay(r.point, mapPointsRef.current, r.to_wh, FLOW_WAREHOUSE_POINT_PURPOSE);
            return escapeHtml(pd.label || pd.value || '');
          },
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('day', 'DAY', 96, {
          formatter: (cell) => fmtDay(String(cell.getValue() ?? '')),
          cellDblClick: (_e, cell) => setDayEdit(cell.getData() as FormRow),
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('time_at', 'Выгружен', 116, { visible: false, formatter: (cell) => fmtWhen(String(cell.getValue() ?? '')) }),
        text('ord_info', 'ORD name, date', 160, {
          visible: false,
          cssClass: `flow-form-wrap ${COL_BLOCK_END}`,
          // Имя · день месяц гг (25/26, не 2025).
          formatter: (cell) => escapeHtml(String(cell.getValue() ?? '')),
        }),
        text('offnew', 'OFF/NEW', 86, {
          // Юзер 2026-08-06: сами ставят OFF / NEW из списка (пишет day_wk).
          editor: 'list',
          editorParams: {
            values: [...OFFNEW_OPTIONS],
            autocomplete: false,
            allowEmpty: true,
            listOnEmpty: true,
          },
          formatter: (cell) => {
            const v = String(cell.getValue() ?? '');
            if (!v) return '';
            const kind = v.toUpperCase() === 'OFF' ? 'off' : 'new';
            const label = v.toUpperCase() === 'OFF' ? 'OFF' : 'NEW';
            return `<span class="flow-form-tag flow-form-tag--${kind}">${escapeHtml(label)}</span>`;
          },
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('stat', 'STAT', 120, {
          // Раскрывающийся выбор 1:1 с Отчётом (ветки АТУ/склад/цех/экспедиция),
          // а не плоский список Tabulator — см. flow-tab-stat-editor.ts.
          editor: makeStatEditor(STAT_GROUPS, () => rootRef.current) as unknown as 'input',
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('pct', '% + HY', 76, {
          cssClass: `flow-form-col-bold ${COL_BLOCK_END}`,
          // Доля вывезенного: (было − стало)/было. Целое; 0% не показываем.
          formatter: (cell) => fmtPct(cell.getValue() as number | null),
          accessorClipboard: (v: unknown) => fmtPct(v as number | null),
        }),
        text('q', 'Q', 44, { cssClass: 'flow-form-col-bold' }),
        text('no_num', 'NO. №', 92),
        text('mat', 'MAT', matW, {
          // Wrap; высота ВСЕХ строк единая (reflowFormLayout) — selection/границы стабильны.
          cssClass: 'flow-form-text-wrap',
          minWidth: 120,
          width: matW,
          formatter: (cell) => {
            const r = cell.getData() as FormRow;
            const t = String(cell.getValue() ?? '');
            return `<span class="flow-form-text-wrap-inner" title="${escapeAttr(r.tech_name || t)}">${escapeHtml(t)}</span>`;
          },
        }),
        // ЖИВОЕ тех-наименование из базы ВГХ (не снимок строки).
        text('tech_name', 'TECH NAME', techW, {
          visible: false,
          cssClass: 'flow-form-text-wrap',
          minWidth: 120,
          width: techW,
          formatter: (cell) => {
            const t = String(cell.getValue() ?? '');
            return `<span class="flow-form-text-wrap-inner" title="${escapeAttr(t)}">${escapeHtml(t)}</span>`;
          },
        }),
        text('uom', 'UoM', 56, {}),
        text('qty', 'QTY', 92, {
          // До 3 знаков; тысячи пробелом (3 000,125).
          formatter: (cell) => fmtNum(cell.getValue() as number, 3),
          accessorClipboard: (v: unknown) => fmtNum(v as number, 3),
        }),
        // KG / V — ЖИВОЙ пересчёт по базе ВГХ (кол-во × норма на 1 ЕИ).
        text('kg_live', 'KG', 92, {
          cssClass: 'flow-form-col-bold',
          formatter: (cell) => fmtNum(cell.getValue() as number, 3),
          accessorClipboard: (v: unknown) => fmtNum(v as number, 3),
        }),
        text('v_live', 'V', 80, {
          cssClass: COL_BLOCK_END,
          // До первой ненулевой цифры после запятой; «,000» не показываем.
          formatter: (cell) => fmtVol(cell.getValue() as number),
          accessorClipboard: (v: unknown) => fmtVol(v as number),
        }),
        text('priority', 'ПРИОР.', 104, {
          editor: 'list',
          editorParams: { values: [...PRIORITY_OPTIONS], autocomplete: true, allowEmpty: true, listOnEmpty: true },
          formatter: (cell) => escapeHtml(priorityDisplay(String(cell.getValue() ?? ''))),
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('note', 'NOTE', 200, {
          // РОДНОЙ textarea Tabulator: перенос по строкам и рост поля под текст,
          // как в Excel. Shift+Enter — новая строка, Enter — сохранить.
          cssClass: 'flow-form-note',
          minWidth: 120,
          editor: 'textarea',
          editorParams: { shiftEnterSubmit: false, verticalNavigation: 'editor' },
          formatter: (cell) => {
            const t = String(cell.getValue() ?? '').trim();
            if (!t) {
              return `<span class="flow-form-note-empty" title="Двойной клик — заметка">${NOTE_EMPTY_ICO}</span>`;
            }
            // Полный текст — в подсказке; целиком читается и правится в редакторе.
            return `<span class="flow-form-note-text" title="${escapeAttr(t)}">${escapeHtml(t)}</span>`;
          },
          cellEdited: (cell) => {
            void doEditCell(cell);
            const rows = [...rowsByIdRef.current.values()];
            reflowFormLayout(tableRef.current, rows);
          },
        }),
        text('delivery', 'ОКНО', 104, {
          cssClass: COL_BLOCK_END,
          editor: 'input',
          cellEdited: (cell) => void doEditCell(cell),
        }),
        text('mol', 'МОЛ', 280, {
          cssClass: 'flow-form-mol',
          // Пила вокруг ФИО (pad по бокам); телефон с 📞 под НАЧАЛОМ текста ФИО.
          // Пусто → «нет МОЛа» только если на TO 0 МОЛов. Copy: free-маркер.
          accessorClipboard: (v: unknown, data: unknown) => {
            const fio = molFioUpper(String(v ?? ''));
            if (!fio) return '';
            const row = data as FormRow;
            const free = !isMolOnToWh(fio, row.to_wh ?? '');
            return packMolClip(fio, free);
          },
          formatter: (cell) => {
            const r = cell.getData() as FormRow;
            const raw = String(cell.getValue() ?? '').trim();
            const whMols =
              whMapGet(molByWhRef.current, whKey(r.to_wh)) ?? molByWhRef.current.get(r.to_wh) ?? [];
            // «нет МОЛа» — только если на TO вообще нет МОЛов в нашей базе.
            // Если несколько — пустая ячейка, ждём выбора / ввода (юзер 2026-08-06).
            if (!raw || /нет\s*мол/i.test(raw)) {
              if (whMols.length === 0) {
                return '<span class="flow-form-mol-pill flow-form-mol-pill--nomol">нет МОЛа</span>';
              }
              return '';
            }
            // Полное ФИО одной строкой, ВЕРХНИЙ РЕГИСТР (ДОЛМАТОВ …).
            const fio = molFioUpper(raw, (k) => molByFioRef.current.get(k)?.fio);
            const kind = r.mol_kind || 'neutral';
            const fromBase = molByFioRef.current.get(raw.toUpperCase()) ?? molByFioRef.current.get(fio);
            const phoneRaw = r.mol_phone || fromBase?.phone || '';
            const pill = `<span class="flow-form-mol-pill flow-form-mol-pill--${kind}">${escapeHtml(fio)}</span>`;
            const phone = phoneRaw
              ? `<span class="flow-form-mol-phone">${PHONE_ICO}${escapeHtml(formatMobilePhone(phoneRaw))}</span>`
              : '';
            return `<span class="flow-form-mol-stack" title="${escapeAttr(
              [fio, phoneRaw ? formatMobilePhone(phoneRaw) : ''].filter(Boolean).join(' · '),
            )}">${pill}${phone}</span>`;
          },
          cellDblClick: (_e, cell) => setMolEdit(cell.getData() as FormRow),
          cellEdited: (cell) => void doEditCell(cell),
        }),
        {
          title: 'СОГЛ.',
          field: 'sogl_on',
          width: 72,
          minWidth: 60,
          headerSort: false,
          vertAlign: 'middle',
          accessorClipboard: (v: unknown) => (v ? 'Да' : ''),
          // Аккуратная галочка pyn-tick — один размер с Транспортом (ТЗ п.9).
          formatter: (cell) => {
            const on = Boolean(cell.getValue());
            return on
              ? '<span class="pyn-tick pyn-tick--on" title="Согласовано — клик снять">✓</span>'
              : '<span class="pyn-tick pyn-tick--off" title="Клик — согласовать"></span>';
          },
          cellClick: (_e, cell) => {
            cell.setValue(!Boolean(cell.getValue()), true);
            void doEditCell(cell);
          },
        },
        text('request', 'ЗАПРОС', 140, {
          visible: false,
          cssClass: 'flow-form-wrap',
          editor: 'textarea',
          cellEdited: (cell) => void doEditCell(cell),
        }),
      ];

      tableRef.current?.destroy();
      tableRef.current = new Tabulator(containerRef.current, {
        data: rows.map((r) => ({ ...r, _canonSort: 0 })),
        columns,
        // fitData + гориз. скролл; высота строк — родная, под содержимое.
        layout: 'fitData',
        height: '100%',
        index: 'id',
        // ФИКСИРОВАННАЯ высота строки — та же модель, что в Транспорте.
        // variableHeight убран сознательно: он заставляет Tabulator мерить каждую
        // ячейку на каждом рендере, строки получаются разной высоты, а
        // закреплённые колонки (отдельный слой) визуально не поспевают за телом
        // при прокрутке. Длинный текст живёт в подсказке и в редакторе, а для
        // NOTE — полноценный многострочный ввод с прокруткой.
        rowHeight: 30,
        placeholder: '<div class="flow-form-placeholder">Нет строк</div>',
        editTriggerEvent: 'dblclick',
        movableColumns: false,
        clipboard: true,
        clipboardCopyStyled: false,
        clipboardCopyConfig: { columnHeaders: false, columnGroups: false, rowHeaders: false },
        clipboardCopyRowRange: 'range',
        clipboardPasteParser: 'range',
        clipboardPasteAction: 'range',
        selectableRange: true,
        selectableRangeColumns: false,
        selectableRangeRows: false,
        // false: при true модуль выделения ПРОГРАММНО возвращает фокус в таблицу
        // на каждый клик — открытая textarea получала blur, Tabulator по blur
        // коммитил правку и закрывал редактор («клик внутри ячейки выкидывает из
        // неё»). Выход из правки остаётся по Enter или клику за пределами ячейки.
        selectableRangeAutoFocus: false,
        selectableRows: false,
        popupContainer: rootRef.current ?? containerRef.current,
        // ТЗ п.1: строка с DAY — RGB 102/255/153.
        // Горизонталь: жирно — смена блока ГРАФ (склад удалён / Нет / день);
        // полужирно — смена TO внутри блока.
        // Только чтение уже посчитанных признаков — O(1) на строку.
        // Границы групп считает markGroupSeparators() ОДНИМ проходом после
        // фильтра/сортировки: прежний getPrevRow() искал соседа в списке, то есть
        // на каждую отрисовку строки шёл поиск по всем строкам — на 3 тыс. записей
        // это давало фризы прокрутки.
        rowFormatter: (row: RowComponent) => {
          const r = row.getData() as FormRow & { _sepDay?: boolean; _sepWh?: boolean };
          const el = row.getElement();
          el.style.background = r.day ? DAY_SET_BG : '';
          el.classList.toggle('flow-form-day-set', !!r.day);
          el.classList.toggle('flow-form-sep-day', !!r._sepDay);
          el.classList.toggle('flow-form-sep-wh', !!r._sepWh);
        },
      } as ConstructorParameters<typeof Tabulator>[1]);

      tableRef.current.on('tableBuilt', () => {
        applyColVisibility(tableRef.current!, DEFAULT_VISIBLE);
        reflowFormLayout(tableRef.current, rows, DEFAULT_VISIBLE);
        applyFilters(search, facetSelected);
        markGroupSeparators(tableRef.current);
        const stored = localStorage.getItem(PERSONAL_VIEW_KEY);
        setHasPersonalView(!!stored);
        if (stored) {
          try {
            applyView(JSON.parse(stored) as TabViewState);
          } catch {
            /* corrupted */
          }
        }
        setLoading(false);
      });
      // Страховка: если событие построения не придёт (сбой модулей/нулевая высота),
      // не оставляем экран под вечной «Загрузкой».
      window.setTimeout(() => {
        if (!alive) return;
        setLoading(false);
      }, 4000);
      // Клик ВНУТРИ открытого редактора не должен его закрывать: модуль
      // range-selection ловит mousedown на уровне таблицы, снимает фокус с поля
      // и Tabulator коммитит правку. Юзер 2026-08-06: «повторный клик выкидывает
      // из ячейки». Гасим всплытие внутри самого редактора — выход остаётся по
      // Enter или клику ЗА пределами ячейки.
      tableRef.current.on('cellEditing', (cell: CellComponent) => {
        const host = cell.getElement() as HTMLElement | undefined;
        const field = host?.querySelector('textarea, input') as HTMLElement | null;
        if (!field) return;
        const stop = (e: Event): void => e.stopPropagation();
        field.addEventListener('mousedown', stop);
        field.addEventListener('click', stop);
        field.addEventListener('dblclick', stop);
        // Выделение текста мышью с выходом за границы поля тоже не должно
        // передаваться range-выделению таблицы.
        field.addEventListener('mouseup', stop);
      });
      tableRef.current.on('columnMoved', () => {
        const t = tableRef.current;
        if (t) setColOrder(readTableColOrder(t));
      });
      tableRef.current.on('clipboardPasted', () => {
        void persistRangePasteRef.current();
      });
      tableRef.current.on('cellClick', (_e: unknown, cell: CellComponent) => {
        const row = cell.getData() as FormRow;
        lastFocusRef.current = { rowId: row.id, field: cell.getField() };
        refreshStats();
      });
      tableRef.current.on('rangeChanged', () => refreshStats());
    })();
    return () => {
      alive = false;
      tableRef.current?.destroy();
      tableRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Del / Backspace — очистка правимых ячеек.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      void clearSelectedCells();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, clearSelectedCells]);

  const historyEntries = useMemo(() => {
    void historyTick;
    if (!historyPanel) return [] as HistoryEntry[];
    if (historyPanel.field === '*') {
      const out: HistoryEntry[] = [];
      for (const [key, list] of historyMapRef.current) {
        if (!key.startsWith(`${historyPanel.rowId}:`)) continue;
        out.push(...list);
      }
      return out.sort((a, b) => b.at.localeCompare(a.at));
    }
    return historyMapRef.current.get(styleKey(historyPanel.rowId, historyPanel.field)) ?? [];
  }, [historyPanel, historyTick]);

  const openHistory = useCallback(
    (whole: boolean) => {
      const focus = lastFocusRef.current;
      if (!focus) {
        setMsg('Встаньте на ячейку, затем «История»');
        return;
      }
      setHistoryPanel({ rowId: focus.rowId, field: whole ? '*' : focus.field });
    },
    [setMsg],
  );

  const handleExport = useCallback(() => {
    const table = tableRef.current;
    const visible = table
      ? (table.getRows('active').map((r) => r.getData() as FormRow) as FormRow[])
      : allRows;
    try {
      exportFormXlsx(visible);
      setMsg(`Выгружено строк: ${visible.length}`);
    } catch (e) {
      setMsg(`Выгрузка: ${String(e)}`);
    }
  }, [allRows, setMsg]);

  return (
    <div
      ref={rootRef}
      className="flow-tabulator-root pyn-table-root flow-form-root flex h-full min-h-0 flex-col"
      data-pyn-table-theme="grok"
      data-col-reorder={reorderOn ? 'true' : undefined}
    >
      {/* Chrome 1:1 с Транспортом: segment-вкладки + toolbar | ml-auto toolbar */}
      <div className="pyn-table-chrome flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        {chromeLeading ? <div className="flex shrink-0 items-center">{chromeLeading}</div> : null}
        <div className="flow-tab-toolbar flex min-w-0 items-center gap-0.5 p-0.5">
          <button
            type="button"
            title={panelOpen ? 'Скрыть панель фильтров' : 'Показать панель фильтров'}
            className="flow-tab-tool-btn"
            data-active={panelOpen ? 'true' : 'false'}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? <PanelLeftClose size={14} strokeWidth={1.75} /> : <PanelLeftOpen size={14} strokeWidth={1.75} />}
          </button>
          <FlowViewSwitch
            variant="grok"
            mode={viewMode}
            onModeChange={(m) => void handleModeChange(m)}
            sharedAuthor={sharedAuthor}
            hasSharedView={hasSharedView}
            hasPersonalView={hasPersonalView}
          />
          <button
            type="button"
            onClick={() => void saveView(viewMode)}
            className="flow-tab-tool-btn px-2"
            disabled={busy}
            title="Запомнить фильтры и колонки в текущем виде"
          >
            Сохранить
          </button>
          <button type="button" onClick={handleResetView} className="flow-tab-tool-btn px-2" title="Сбросить вид">
            Сброс
          </button>
          <FlowColumnsMenu
            variant="grok"
            columns={TOGGLEABLE_COLS}
            visible={visibleCols}
            onToggle={(id) => {
              const table = tableRef.current;
              if (!table) return;
              setVisibleCols((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                  table.hideColumn(id);
                } else {
                  next.add(id);
                  table.showColumn(id);
                }
                // TECH NAME / MAT: при показе — строка растёт под полный текст;
                // при скрытии — высота снова по оставшимся видимым колонкам.
                // TECH NAME вкл → все строки выше под полный текст; выкл → снова ниже.
                if (id === 'tech_name' || id === 'mat' || id === 'note') {
                  reflowFormLayout(table, [...rowsByIdRef.current.values()], next);
                }
                return next;
              });
            }}
            reorderOn={reorderOn}
            onToggleReorder={() => {
              setReorderOn((v) => {
                const next = !v;
                setMsg(next ? 'Перетаскивайте заголовки колонок' : 'Перестановка выкл');
                return next;
              });
            }}
          />
          <div className="relative flex shrink-0" ref={msgLogRef}>
            <button
              type="button"
              onClick={() => {
                setMsgOpen((o) => !o);
                setMsgFlash(false);
              }}
              title="История сообщений"
              className={`flow-tab-tool-btn ${msgFlash ? 'border-danger/50 text-danger' : ''}`}
            >
              <Bell size={14} strokeWidth={1.75} />
              {msgLog.length > 0 && <span className="tabular-nums">{msgLog.length}</span>}
            </button>
            {msgOpen && (
              <div className="absolute left-0 top-7 z-50 max-h-[320px] w-[340px] overflow-y-auto rounded-lg border border-border-subtle bg-bg-surface p-1.5 shadow-lg">
                {msgLog.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[11px] text-zinc-500">Пока пусто</div>
                ) : (
                  msgLog.map((m) => (
                    <div key={m.id} className="group flex items-start gap-1.5 rounded-md px-1.5 py-1 hover:bg-white/[0.05]">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-text-secondary">
                        {m.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyText(m.text)}
                        title="Скопировать"
                        className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:text-text-strong group-hover:opacity-100"
                      >
                        <Copy size={12} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flow-tab-toolbar ml-auto flex shrink-0 items-center gap-0.5 p-0.5">
          <button
            type="button"
            title="Перечитать базу формирования"
            className="flow-tab-tool-btn"
            disabled={loading}
            onClick={() => void reloadRows()}
          >
            <RefreshCw size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Сортировать (авто-сортировки нет)" className="flow-tab-tool-btn" onClick={applyOurSort}>
            <ArrowDownUp size={14} strokeWidth={1.75} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <button type="button" title="Скопировать выделение" className="flow-tab-tool-btn" onClick={() => void runCopy()}>
            <Copy size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Вставить в выделение" className="flow-tab-tool-btn" onClick={() => void runPaste()}>
            <ClipboardPaste size={14} strokeWidth={1.75} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <button type="button" title="Выгрузить в .xlsx" className="flow-tab-tool-btn" onClick={handleExport}>
            <FileDown size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="История правок ячейки (Shift — по всей строке)"
            className="flow-tab-tool-btn"
            onClick={(e) => openHistory(e.shiftKey)}
          >
            <History size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {panelOpen && (
          <div className="flow-tab-panel flex w-64 shrink-0 flex-col gap-3 overflow-y-auto p-2.5">
            <div className="flow-tab-search flex items-center gap-1.5 rounded-md px-2 py-1.5">
              <Search size={13} className="opacity-50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Заказ, склад, материал, МОЛ…"
                className="w-full bg-transparent text-[12.5px] outline-none"
              />
            </div>
            {activeFacetCount > 0 && (
              <button
                type="button"
                onClick={() => setFacetSelected({})}
                className="self-start text-[11px] opacity-60 hover:opacity-100"
              >
                Сбросить фильтры ({activeFacetCount})
              </button>
            )}
            {facetDefs.map((def) => (
              <FacetSection
                key={def.id}
                title={def.title}
                options={facetOptions[def.id] ?? []}
                counts={facetCounts[def.id] ?? {}}
                selected={facetSelected[def.id] ?? new Set()}
                open={openSections.has(def.id)}
                onToggleOpen={() =>
                  setOpenSections((prev) => {
                    const next = new Set(prev);
                    if (next.has(def.id)) next.delete(def.id);
                    else next.add(def.id);
                    return next;
                  })
                }
                onToggleValue={(value, only) => toggleFacetValue(def.id, value, only)}
              />
            ))}
          </div>
        )}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-[13px] opacity-60">
              Загрузка Формирования…
            </div>
          )}
          {loadError && (
            <div className="absolute inset-x-0 top-0 z-20 m-2 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              <span className="min-w-0 flex-1 break-words">Не удалось загрузить формирование: {loadError}</span>
              <button type="button" className="shrink-0 underline" onClick={() => void copyText(loadError)}>
                копировать
              </button>
              <button type="button" className="shrink-0 underline" onClick={() => void reloadRows()}>
                повторить
              </button>
              <button type="button" className="shrink-0 underline" onClick={() => setLoadError('')}>
                скрыть
              </button>
            </div>
          )}
          <div ref={containerRef} className="h-full w-full min-w-0" />
          {historyPanel && (
            <div className="pyn-hist-sheet" role="dialog" aria-label="История">
              <div className="pyn-hist-sheet-head">
                <div className="pyn-hist-sheet-title">
                  История{historyPanel.field !== '*' ? ` · ${fieldTitle(historyPanel.field)}` : ''}
                </div>
                <button type="button" className="pyn-hist-sheet-close" onClick={() => setHistoryPanel(null)} aria-label="Закрыть">
                  ✕
                </button>
              </div>
              <div className="pyn-hist-sheet-body">
                {historyEntries.length === 0 ? (
                  <div className="pyn-hist-empty">Пока без изменений</div>
                ) : (
                  historyEntries.map((h, i) => (
                    <div key={`${h.at}-${i}`} className="pyn-hist-item">
                      <div className="pyn-hist-col">{fieldTitle(h.field)}</div>
                      <div className="pyn-hist-change">
                        <span className="pyn-hist-old">{fmtHistValue(h.oldValue)}</span>
                        <span className="pyn-hist-arrow" aria-hidden>
                          →
                        </span>
                        <span className="pyn-hist-new">{fmtHistValue(h.newValue)}</span>
                      </div>
                      <div className="pyn-hist-meta">
                        {h.at}
                        {h.who ? ` · ${h.who}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Подвал — тот же chrome-стиль, что верхняя панель Транспорта (ТЗ п.11). */}
      <div className="pyn-table-chrome flow-form-footer flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-3 py-1.5">
        <div className="flow-tab-toolbar flex min-w-0 items-center gap-0.5 p-0.5">
          <span className="px-2 text-[11.5px] font-medium tabular-nums text-[var(--pyn-text-muted)]">
            Строк: {rowCounts.shown.toLocaleString('ru-RU')}
            {rowCounts.shown !== rowCounts.total ? ` из ${rowCounts.total.toLocaleString('ru-RU')}` : ''}
          </span>
        </div>
        <div className="flow-tab-toolbar ml-auto flex min-w-0 items-center gap-0.5 p-0.5">
          <div className="px-1.5 py-0.5">
            <FlowTabStats cells={statsCells} />
          </div>
        </div>
      </div>
      {molEdit && (
        <FlowMolPickPopover
          current={molEdit.mol ?? ''}
          warehouseOptions={(() => {
            const onWh = whMapGet(molByWhRef.current, whKey(molEdit.to_wh)) ?? [];
            return onWh.map((o) => ({ ...o, onWarehouse: true }));
          })()}
          searchOptions={(() => {
            // Вся база; onWarehouse=true только для МОЛов текущего склада (для маркера copy).
            const whKeys = new Set(
              (whMapGet(molByWhRef.current, whKey(molEdit.to_wh)) ?? []).map((o) =>
                o.fio.trim().toUpperCase(),
              ),
            );
            return molAllRef.current.map((o) => ({
              ...o,
              onWarehouse: whKeys.has(o.fio.trim().toUpperCase()),
            }));
          })()}
          onPick={(o) => {
            // free/не free при copy: isMolOnToWh(fio, to_wh) в accessorClipboard
            const cell = tableRef.current?.getRow(molEdit.id)?.getCell('mol');
            setMolEdit(null);
            if (!cell) return;
            cell.setValue(molFioUpper(o.fio, (k) => molByFioRef.current.get(k)?.fio), true);
            void doEditCell(cell);
          }}
          onFree={(fio) => {
            const cell = tableRef.current?.getRow(molEdit.id)?.getCell('mol');
            setMolEdit(null);
            if (!cell) return;
            cell.setValue(molFioUpper(fio, (k) => molByFioRef.current.get(k)?.fio), true);
            void doEditCell(cell);
          }}
          onClear={() => {
            const cell = tableRef.current?.getRow(molEdit.id)?.getCell('mol');
            setMolEdit(null);
            if (!cell) return;
            cell.setValue('', true);
            void doEditCell(cell);
          }}
          onClose={() => setMolEdit(null)}
        />
      )}
      {dayEdit && (
        <>
          <div className="fixed inset-0 z-50 bg-black/35" onClick={() => setDayEdit(null)} />
          <div className="fixed left-1/2 top-1/2 z-[60] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-2xl">
            <div className="mb-2 text-[13px] font-semibold text-text-strong">День доставки</div>
            <PynCalendar
              selected={new Set(dayEdit.day ? [dayEdit.day] : [])}
              onChange={(next) => {
                if (next.size !== 1) return;
                const iso = [...next][0];
                const cell = tableRef.current?.getRow(dayEdit.id)?.getCell('day');
                setDayEdit(null);
                if (!cell || !iso) return;
                cell.setValue(iso, true);
                void doEditCell(cell);
              }}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const cell = tableRef.current?.getRow(dayEdit.id)?.getCell('day');
                  setDayEdit(null);
                  if (!cell) return;
                  cell.setValue('', true);
                  void doEditCell(cell);
                }}
                className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={() => setDayEdit(null)}
                className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
              >
                Отмена
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
