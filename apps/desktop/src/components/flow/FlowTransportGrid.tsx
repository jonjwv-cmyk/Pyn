import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CompactSelection,
  GridCellKind,
  type DataEditorRef,
  type DrawCellCallback,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { ChevronLeft, ChevronRight, ClipboardPaste, History, Plus, Printer, Redo2, RefreshCw, Trash2, Truck, Undo2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import * as Popover from '@radix-ui/react-popover';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { flowCheckRenderer, type FlowCheckCell } from './flow-check-cell';
import {
  flowDeliveriesGet,
  flowTransportAdd,
  flowTransportDelete,
  flowTransportEdit,
  flowTransportGet,
  flowTransportPaste,
  flowVehiclesGet,
  flowTransportViewGet,
  flowTransportViewSet,
  isTransport1cPaste,
  parseTransport1cPaste,
  parseTransportPaste,
  type FlowDeliveryRow,
  type FlowTransportChangedEvent,
  type FlowTransportRow,
  type FlowTransportViewChangedEvent,
  type FlowVehicle,
  type FlowVehiclesChangedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/lib/ws';
import { sessionStore } from '@/lib/token-store';
import { formatMobilePhone, molStatusKind } from '@/lib/mol-format';
import { loadFlowDiskCache, saveFlowDiskCacheDebounced } from '@/lib/flow-disk-cache';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { MONTH_ABBR_RU, MONTH_FULL_RU } from './flow-sandbox.fixtures';
import { flowDriverRenderer, type FlowDriverCell, type FlowDriverOption } from './flow-driver-cell';
import { flowStackRenderer, type FlowStackCell } from './flow-stack-cell';
import { flowHistoryRenderer, type FlowHistoryCell } from './flow-history-cell';
import { colRowSelection } from './flow-grid-selection';
import { FlowGridEditor, EMPTY_GRID_SELECTION, type FlowGridEditorHandle } from './FlowGridEditor';
import { createLiveValue, useLiveValue, type LiveValue } from './flow-live-value';
import { useProdCalendarStore } from '@/lib/prod-calendar';
import {
  isShiftUndershoot,
  isTimeBoldFlag,
  parseTimeRangeBounds,
  shouldShowTimeBold,
  workMajorPrefix,
} from './flow-transport-shift';
import { formatGosPlate } from '@/components/map/glonass-format';
import { FlowSearchPanel } from './FlowSearchPanel';
import { useFlowGridSearch, type FlowSearchColumn } from './flow-grid-search';
import { FlowHeaderMenu } from './FlowHeaderMenu';
import { useFlowColumnFilters } from './flow-column-filter';
import { VehicleCard } from './VehicleCard';
import { FlowTransportPrint } from './FlowTransportPrint';
import { FlowViewSwitch } from './FlowViewSwitch';
import { BODY_TYPES, adjustedBodyTypeCapacityKg } from './flow-body-types';
import type { FlowViewMode } from './flow-view';
import {
  EMPTY_TRANSPORT_VIEW,
  EMPTY_TRANSPORT_VIEW_JSON,
  canonicalTransportViewJson,
  isEmptyTransportViewJson,
  parseTransportView,
  readPersonalTransportView,
  writePersonalTransportView,
  clearPersonalTransportView,
  readTransportViewMode,
  writeTransportViewMode,
  type TransportView,
} from './flow-transport-view';

/**
 * Раздел «Транспорт» — реестр «машина на день» (эталон — лист 🚚). Показ «без
 * мусора»: машинные колонки считаются из БАЗЫ МАШИН (ключ — гаражный №).
 *
 * По слову юзера (2026-06-11): МАРКА (тип техники из модели, полная модель — по
 * двойному клику), время без ведущих нулей (8:00-20:00), СТАТУС без «(пусто)»
 * (снять = Delete; Размещен — зелёная строка, Отклонен/Отмена — красная), колонка
 * ЦВЕТ возвращена, ТИП переносится по словам, РАБОТА целиком по ширине,
 * РЕЙС — история из отчёта (кто возил, склады ОТ/СП план-факт). Правки/добавление
 * только в пределах 7 дней назад (старое — read-only архив, защита и на сервере).
 */

interface TrColSpec {
  id: string;
  title: string;
  editable?: boolean;
}

/** Шаг истории отмены/повтора (юзер 2026-06-12): правка полей одной строки. */
type TrEdit = { id: number; before: Record<string, string>; after: Record<string, string> };
/** Шаг «вставка из буфера» (юзер 2026-07-06): отмена = удалить вставленные новые строки,
 *  повтор = вставить те же строки заново (id обновятся). */
type TrPasteStep = {
  kind: 'paste';
  insertedIds: number[];
  rows: ReturnType<typeof parseTransportPaste>;
  mode?: 'template' | '1c';
};
/** Заливка диапазона одним значением (Excel): один Ctrl+Z отменяет всю заливку. */
type TrFillStep = { kind: 'fill'; edits: TrEdit[] };
type TrHistStep = TrEdit | TrPasteStep | TrFillStep;
const isPasteStep = (s: TrHistStep): s is TrPasteStep => 'kind' in s && s.kind === 'paste';
const isFillStep = (s: TrHistStep): s is TrFillStep => 'kind' in s && s.kind === 'fill';

// Порядок колонок (юзер 2026-06-12): дата · ИСТОРИЯ(рейс) · статус · работа · время · марка ·
// №·ГОС · выезд · водитель · комментарий. ТИП/ДОП.ТН/ТН/Д/Ш/В — НЕ колонки, а карточка машины
// по двойному клику на №·ГОС (как карточка MAT в формировании). Это ЧИСТО UI-показ: на сервере
// все поля хранятся отдельно (flow_vehicles), вставки приходят по колонкам — мы лишь красиво объединяем.
const TR_COLS: readonly TrColSpec[] = [
  { id: 'date', title: 'ДАТА' },
  { id: 'order', title: 'ЗАКАЗ', editable: true }, // № заказа (НТ000…) — скрыта, тумблер «Заказ» (как инфо-колонки Формирования)
  { id: 'trip', title: 'ИСТОРИЯ' }, // бывш. РЕЙС — двойной клик: история машины за день
  { id: 'status', title: 'СТАТУС', editable: true },
  { id: 'work', title: 'РАБОТА', editable: true },
  { id: 'vehicle_type', title: 'ТИП ТС', editable: true },
  { id: 'time', title: 'ВРЕМЯ', editable: true },
  { id: 'fact_start', title: 'ФАКТ НАЧ', editable: true },
  { id: 'fact_end', title: 'ФАКТ КОН', editable: true },
  { id: 'force', title: 'ФОРС М', editable: true },
  { id: 'brand', title: 'МАРКА' }, // стек: марка + цвет
  { id: 'garage', title: '№ · ГОС', editable: true }, // dropdown: №|гос|тип|водитель; двойной клик → карточка
  { id: 'out', title: 'ВЫЕЗД', editable: true },
  { id: 'driver', title: 'ВОДИТЕЛЬ', editable: true }, // ФИО + СОТ под ним
  { id: 'no_exp', title: 'БЕЗ ЭКСП.', editable: true },
  { id: 'comment', title: 'КОММЕНТАРИЙ', editable: true },
];

/** Порядок статусов в выпадашке — по слову юзера; «(пусто)» НЕТ (снять = Delete). */
const STATUS_ORDER = ['Размещен', 'Дополнение', 'Отклонен', 'Отмена', 'Не приехал', 'Новый', 'Открыт'] as const;
const OUT_STATUS_ORDER = ['ДА', 'НЕТ'] as const;

/** БЕЗ ЭКСП.: галочка → 'ДА', снят → ''. Совместимо со старыми ДА/НЕТ в базе. */
function isNoExpChecked(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim().toUpperCase();
  return s === 'ДА' || s === '1' || s === 'TRUE' || s === 'YES' || s === '✓' || s === '✔';
}
/**
 * В буфер: вкл → «ДА», выкл → «НЕТ» (не пустая строка — иначе clipboard/Glide
 * не копирует «пусто», и заливку снятия галочки сделать нельзя).
 * В базу: вкл → «ДА», выкл → ''.
 */
function noExpCopyData(checked: boolean): string {
  return checked ? 'ДА' : 'НЕТ';
}
/** Вставка/копирование: да/1/✓ → 'ДА'; нет/0/пусто → ''. */
function normalizeNoExpValue(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^(нет|no|0|false|off|-|☐|□)$/i.test(s)) return '';
  if (isNoExpChecked(s) || /^(да|yes|on|x|х|v|☑|✓|✔)$/i.test(s)) return 'ДА';
  return '';
}
const FORCE_REASONS = ['ожидание выгрузки', 'поломка ТС'] as const;

/** Шрифт как в Формировании: стандарт 10px на всю таблицу. Мелкие (8px) — только стек-ячейки
 *  МАРКА и №·ГОС (рисуют свой размер сами). Отдельных второстепенных текст-колонок не осталось
 *  (тип/тоннаж/габариты ушли в карточку машины). */
const SMALL_COLS = new Set<string>();
const STD_FONT = '10px';
const SMALL_FONT = '8px';

/** Известные марки техники (канонический регистр). Порядок не важен — матч по токену. */
const BRANDS = [
  'КамАЗ', 'ЗИЛ', 'МАЗ', 'КрАЗ', 'УРАЛ', 'ГАЗ', 'АМКОДОР', 'ЛТМ', 'SDLG', 'МТЗ',
  'UMG', 'JCB', 'HOWO', 'SHACMAN', 'MAN', 'VOLVO', 'SCANIA', 'ISUZU', 'HYUNDAI',
  'ПАЗ', 'КАВЗ', 'НЕФАЗ', 'FAW', 'DONGFENG',
];
const BRAND_BY_KEY = new Map(BRANDS.map((b) => [b.toUpperCase().replace(/-/g, ''), b] as const));

/**
 * МАРКА из полной модели: универсально — первый «словесный» токен без цифр,
 * сведённый к каноническому написанию по словарю (КамАЗ 6520-06 → КамАЗ,
 * «АМКОДОР-332С4-01» → АМКОДОР, «534С» → 534С как есть). Цифры юзеру не важны.
 */
export function vehicleBrand(model: string): string {
  const tokens = (model || '').trim().split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    // токен может быть «АМКОДОР-332С4» — берём буквенную голову до цифры
    const head = t.split(/(?=\d)/)[0]?.replace(/[-–—]+$/, '') ?? '';
    const key = head.toUpperCase().replace(/-/g, '');
    if (key.length >= 2) {
      const known = BRAND_BY_KEY.get(key);
      if (known) return known;
      if (!/\d/.test(head) && /^[A-ZА-ЯЁ]+$/i.test(head) && head.length >= 3) return head.toUpperCase();
    }
  }
  return tokens[0] ?? '';
}

/** Полные имена месяцев в именительном (дата в транспорте: «август 3»). */
const MONTH_NOM_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const;

/** YYYY-MM-DD → «август 3» (месяц целиком + число, без ведущего нуля). */
export function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${MONTH_NOM_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''} ${parseInt(m[3] ?? '1', 10)}`;
}

/** Полное имя дня недели (для заголовка печати одного дня). */
const WEEKDAYS_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export function weekdayRu(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return WEEKDAYS_RU[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] ?? '';
}

const dayNum = (iso: string): number => Number((iso || '').slice(8, 10));
/** [1,2,3,7,10,11] → «1-3,7,10-11» (подряд — диапазон через дефис, разрывы — через запятую). */
function collapseDays(days: number[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const flush = (): void => {
    if (start == null || prev == null) return;
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  };
  for (const d of ds) {
    if (prev != null && d === prev + 1) prev = d;
    else {
      flush();
      start = d;
      prev = d;
    }
  }
  flush();
  return parts.join(',');
}

/**
 * Сводка набора дней (чип фильтра / заголовок печати) — единый формат «месяц, потом число»
 * (юзер 2026-06-13):
 *  • подряд в одном месяце → «июнь 1-9»;
 *  • с разрывами внутри месяца → «июнь 1,19» (диапазоны и одиночки вперемешку: «июнь 1-3,7»);
 *  • разные месяцы → «май 30-31 июнь 1-2» (каждый месяц — своя группа, через пробел).
 * Год показываем у ПОСЛЕДНЕЙ группы каждого года, если год не текущий ИЛИ в наборе несколько
 * разных лет: заход на следующий год — обе части с годом; будущий год до наступления — с годом;
 * когда он наступил и стал текущим — без года.
 */
export function fmtDaysSummary(days: string[], opts?: { full?: boolean }): string {
  const sorted = [...new Set(days)].filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  if (sorted.length === 0) return '';
  const cur = new Date().getFullYear();
  const months = opts?.full ? MONTH_FULL_RU : MONTH_ABBR_RU;
  // Группируем подряд идущие даты по (год, месяц) — sorted уже по возрастанию.
  type Grp = { year: number; month: number; days: number[] };
  const groups: Grp[] = [];
  for (const d of sorted) {
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.month === month) last.days.push(day);
    else groups.push({ year, month, days: [day] });
  }
  const distinctYears = new Set(groups.map((g) => g.year)).size;
  // Год — один раз на год, у его последней группы (чтобы не дублировать на каждом месяце).
  const lastIdxOfYear = new Map<number, number>();
  groups.forEach((g, i) => lastIdxOfYear.set(g.year, i));
  return groups
    .map((g, i) => {
      const mo = months[g.month - 1] ?? '';
      const showYear = (g.year !== cur || distinctYears > 1) && lastIdxOfYear.get(g.year) === i;
      return `${mo} ${collapseDays(g.days)}${showYear ? ` ${g.year}` : ''}`;
    })
    .join(' ');
}

/** Заголовок печати: один день — «Пятница, 8 июня» (+год если не текущий), иначе — сводка.
 *  Месяц — целиком (не сокращение), юзер 2026-08-02. */
export function fmtDaysTitle(days: string[]): string {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 1) {
    const wd = weekdayRu(sorted[0] ?? '');
    return `${wd ? wd + ', ' : ''}${fmtDaysSummary(sorted, { full: true })}`;
  }
  return fmtDaysSummary(sorted, { full: true });
}

/** Одна метка «HH:MM» → «8» если :00, иначе «8:15» (без ведущего нуля часа). */
function fmtHmCompact(hm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim());
  if (!m) return (hm || '').trim();
  const h = String(Number(m[1]));
  const min = m[2] ?? '00';
  return min === '00' ? h : `${h}:${min}`;
}

/**
 * Время для показа: «08:00-20:00» → «8-20»; «08:15-17:00» → «8:15-17»;
 * «08:00» → «8»; «08:30» → «8:30». Минуты :00 не пишем.
 */
export function fmtTimeRange(s: string): string {
  const raw = (s || '').trim();
  if (!raw) return '';
  const range = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(raw);
  if (range) return `${fmtHmCompact(range[1]!)}-${fmtHmCompact(range[2]!)}`;
  const single = /^(\d{1,2}:\d{2})$/.exec(raw);
  if (single) return fmtHmCompact(single[1]!);
  // fallback: убрать ведущие нули часов, если формат нестандартный
  return raw.replace(/\b0(\d):/g, '$1:');
}

/** «20:00» → «8:00 pm» (24-часовое хранение → 12-часовой показ). */
function to12h(hm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return hm.trim();
  let h = Number(m[1]);
  const ampm = h < 12 ? 'am' : 'pm';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}
/** «08:00-20:00» (хранение 24ч) → ['8:00 am','8:00 pm']; оставлено для старых экспортов. */
export function timeRange12hLines(s: string): [string, string] | null {
  const m = /^\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/.exec(s || '');
  if (!m) return null;
  return [to12h(m[1] ?? ''), to12h(m[2] ?? '')];
}
/** Для ячейки грида: 24 часа без ведущих нулей. */
function fmtTimeTwoLine(s: string): string {
  return fmtTimeRange(s);
}

export function forceSummary(json: string): string {
  let rows: Array<{ reason?: string; start?: string; end?: string; comment?: string }> = [];
  try {
    const parsed = JSON.parse(json || '[]');
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    return json || '';
  }
  return rows
    .map((r) => [r.reason, [r.start, r.end].filter(Boolean).join('-'), r.comment].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n');
}

type ForceDraft = { reason: string; start: string; end: string; comment: string };
const TIME_WHEEL_HOURS = Array.from({ length: 13 }, (_, i) => i + 8);
const TIME_WHEEL_MINUTES = Array.from({ length: 60 }, (_, i) => i);

function normalizeForceReason(value: unknown): string {
  const s = String(value || '').trim();
  if (FORCE_REASONS.includes(s as (typeof FORCE_REASONS)[number])) return s;
  const low = s.toLowerCase();
  if (low.includes('полом')) return 'поломка ТС';
  if (low.includes('ожидан') || low.includes('выгруз') || low.includes('задерж')) return 'ожидание выгрузки';
  return 'ожидание выгрузки';
}

function parseHmValue(value: string, fallback = '8:00'): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback);
  const h = Math.max(8, Math.min(20, Number(m?.[1] ?? 8)));
  const minute = Math.max(0, Math.min(59, Number(m?.[2] ?? 0)));
  return { h, m: minute };
}

function hmValue(h: number, m: number): string {
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseForceDrafts(json: string): ForceDraft[] {
  try {
    const rows = JSON.parse(json || '[]');
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      reason: normalizeForceReason(r?.reason),
      start: String(r?.start || ''),
      end: String(r?.end || ''),
      comment: String(r?.comment || ''),
    }));
  } catch {
    return [];
  }
}

function forceDraftsToJson(rows: ForceDraft[]): string {
  return JSON.stringify(rows
    .map((r) => ({
      reason: normalizeForceReason(r.reason),
      start: r.start || '',
      end: r.end || '',
      comment: r.comment.trim(),
    }))
    .filter((r) => r.reason || r.start || r.end || r.comment));
}

/** Число строк переноса текста при ширине maxW (как в PlanGrid). */
function approxWrapLines(text: string, maxW: number, fontPx = 10): number {
  const s = (text || '').trim();
  if (!s) return 1;
  const avg = fontPx * 0.55;
  const per = Math.max(8, Math.floor(maxW / avg));
  let lines = 0;
  for (const part of s.split(/\n/)) {
    const len = part.trim().length;
    lines += len === 0 ? 1 : Math.max(1, Math.ceil(len / per));
  }
  return Math.max(1, lines);
}

/** Ключ сортировки РАБОТЫ по числовому префиксу. */
export function workKey(w: string): number {
  const m = /^(\d+)(?:\.(\d+))?/.exec((w || '').trim());
  if (!m) return 9_000_000;
  return Number(m[1]) * 1000 + Number(m[2] ?? 0);
}

const tons = (kg: number | null | undefined): string =>
  kg == null || !Number.isFinite(kg) ? '' : fmtSmart(kg / 1000, 3);
const meters = (mm: number | null | undefined): string =>
  mm == null || !Number.isFinite(mm) ? '' : fmtSmart(mm / 1000, 2);

const isoToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Граница правок: сегодня − 7 дней (старое — read-only архив; зеркало серверного guard). */
const editCutoff = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Ключ сортировки склада: Т-код перед обычным (824Т → 8024), как формирование. */
function whKey(code: string): string {
  const s = (code || '').trim().toUpperCase().replace(/T/g, 'Т');
  const m = /^(\d{3})Т$/.exec(s);
  return m ? `${m[1]}0` : s; // 824Т → «8240» < «8024»? нет: «8240» > «8024». Нужен спец-ключ:
}
/** Сравнение складов: по числу, Т-код раньше обычного того же куста (824Т → 8024). */
export function cmpWh(a: string, b: string): number {
  const norm = (x: string) => x.trim().toUpperCase().replace(/T/g, 'Т');
  const A = norm(a);
  const B = norm(b);
  // Пары «824Т ↔ 8024»: Т-код считаем тем же числом 8024, но с приоритетом (раньше).
  const baseOf = (x: string) => {
    const mT = /^(\d{3})Т$/.exec(x);
    if (mT) return Number(`80${(mT[1] ?? '').slice(1)}`);
    const mN = /^(\d{4})$/.exec(x);
    return mN ? Number(mN[1]) : Number.MAX_SAFE_INTEGER;
  };
  const tFirst = (x: string) => (/^\d{3}Т$/.test(x) ? 0 : 1);
  return baseOf(A) - baseOf(B) || tFirst(A) - tFirst(B) || A.localeCompare(B, 'ru');
}

const TR_RENDERERS = [
  flowDropdownRenderer,
  flowDriverRenderer,
  flowStackRenderer,
  flowHistoryRenderer,
  flowCheckRenderer,
];

/** Работа из «шестого» блока — ведущий пункт ≥ 6 (6.x, 7.x …). Внутри дня ЕДИНСТВЕННАЯ
 *  чёрная линия отделяет этот блок от всех пунктов выше (0,1,2,3,4,5) — юзер 2026-06-12:
 *  «отделять пункты начинающиеся на 6 от всех выше 0 1 2 3 4 5». */
/** Переход в блок 6+ (ДОК и выше) внутри дня — чёрная линия. */
export function workIsSixPlus(w: string): boolean {
  const m = /^(\d+)/.exec((w || '').trim());
  return m ? Number(m[1]) >= 6 : false;
}

/** Печать: блок 7.n — жирная линия перед входом в 7.x. */
export function workIsSeven(w: string): boolean {
  return workMajorPrefix(w) === 7;
}

/**
 * Сортировка печати: сначала «красные» статусы (Отклонен/Отмена/Новый/Открыт) —
 * серым блоком сверху, затем Размещен и прочие по РАБОТЕ.
 */
export function printStatusGroup(status: string): number {
  switch ((status || '').trim()) {
    case 'Отклонен':
    case 'Отмена':
    case 'Новый':
    case 'Открыт':
    case 'Не приехал':
      return 0;
    default:
      return 1;
  }
}

/** Статус «красный» → в печати серая заливка строки (как ДОК/ОКАЛИНА). */
export function isPrintGrayStatus(status: string): boolean {
  return printStatusGroup(status) === 0;
}

// Кэш на сессию (мгновенный повторный вход, потом refetch + реалтайм).
let trRowsCache: FlowTransportRow[] | null = null;
/** Имя дискового кэша строк Транспорта (pyn:cache, шифрованный). */
const FLOW_DISK_CACHE_TR = 'flow_rows_transport';
let trVehCache: FlowVehicle[] | null = null;
/** Позиция скролла грида + фильтр дней — восстанавливаем при возврате в раздел (ТЗ п.4).
 *  trScrollCache — ЖИВАЯ (обновляется onVisibleRegionChanged); trScrollSaved — закоммиченная
 *  на скрытие вкладки (до сброса display:none), из неё восстанавливаем на показ. */
let trScrollCache: { col: number; row: number } | null = null;
let trScrollSaved: { col: number; row: number } | null = null;
let trDaySelCache: Set<string> | null = null;

/** Колонка-маркер выбора строк: ДАТА (если видна) иначе ИСТОРИЯ (юзер 2026-07-14). */
function rowSelectColIndex(cols: readonly TrColSpec[]): number {
  const dateIdx = cols.findIndex((c) => c.id === 'date');
  if (dateIdx >= 0) return dateIdx;
  return cols.findIndex((c) => c.id === 'trip');
}

export function FlowTransportGrid(): JSX.Element {
  const [rows, setRows] = useState<FlowTransportRow[]>(() => trRowsCache ?? []);
  const [vehicles, setVehicles] = useState<FlowVehicle[]>(() => trVehCache ?? []);
  const [loading, setLoading] = useState(() => trRowsCache === null);
  // §8: машины с НАШИМИ зафикс. поставками (значок истории только им). Ключ `ГАРАЖ|ДАТА`.
  const [tripKeys, setTripKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void flowDeliveriesGet(api)
      .then((ds) => {
        if (!alive) return;
        const s = new Set<string>();
        for (const d of ds) {
          if (Number(d.fixation_id) <= 0) continue;
          const date = String(d.plan_date || '').slice(0, 10);
          for (const id of String(d.ride_id || '').split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean)) {
            s.add(`${id.toUpperCase()}|${date}`);
          }
        }
        setTripKeys(s);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Выделение живёт ВНУТРИ FlowGridEditor (анти-лаг, паттерн Плана/Формирования):
  // протяжка мыши не ре-рендерит этот монолит. Действия читают selectionRef,
  // счётчики «Выбрано» — мелкие компоненты на LiveValue.
  const editorRef = useRef<FlowGridEditorHandle | null>(null);
  const selLive = useRef(createLiveValue<GridSelection>(EMPTY_GRID_SELECTION)).current;
  const selectionRef = useRef<GridSelection>(EMPTY_GRID_SELECTION);
  const applySelection = useCallback((sel: GridSelection) => {
    editorRef.current?.setSelection(sel);
  }, []);
  const clearSelection = useCallback(() => {
    editorRef.current?.setSelection(EMPTY_GRID_SELECTION);
  }, []);
  const handleSelectionChange = useCallback((sel: GridSelection) => {
    selectionRef.current = sel;
    selLive.set(sel);
  }, [selLive]);
  // Фильтр дней. Статус — только колоночный фильтр грида. Поиск — отдельная панель.
  // Выбор дней — МНОЖЕСТВО (юзер 2026-06-12): клик-тогл + протяжка по дням (range).
  // Пусто = все дни. Ровно один день — колонку ДАТА прячем (она в фильтре).
  const [daySel, setDaySel] = useState<Set<string>>(() => new Set(trDaySelCache ?? []));
  const prodCalByYear = useProdCalendarStore((st) => st.byYear);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  // Вид «Общий / Личный» (filter-views, как в Формировании): фильтры поиска/статусов/дней.
  const [viewMode, setViewMode] = useState<FlowViewMode>('shared');
  const [sharedAuthor, setSharedAuthor] = useState({ updatedBy: '', updatedByName: '', updatedAt: '' });
  const [hasSharedView, setHasSharedView] = useState(false);
  const [hasPersonalView, setHasPersonalView] = useState(false);
  const myLoginRef = useRef('');
  const viewModeRef = useRef<FlowViewMode>('shared');
  const lastViewJsonRef = useRef(EMPTY_TRANSPORT_VIEW_JSON);
  const sharedValueRef = useRef('');
  const sharedSaveTimerRef = useRef<number | null>(null);
  const viewHydratedRef = useRef(false);
  // «Добавить машину»: дата (наш мини-календарь) + гаражный; карточка при отсутствии в базе.
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(isoToday);
  const [addGarage, setAddGarage] = useState('');
  const [cardGarage, setCardGarage] = useState<string | null>(null);
  const pendingAddRef = useRef<{ date: string; garage: string } | null>(null);
  // Печать (превью-окно) + РЕЙС-поповер. printDays — выбранные дни (или один).
  const [printDays, setPrintDays] = useState<string[] | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  // Свой выбор дней для печати (тот же календарь, что у фильтра) — при открытии
  // подхватывает текущий фильтр дней, дальше правится независимо.
  const [printSel, setPrintSel] = useState<Set<string>>(() => new Set());
  const [printDok, setPrintDok] = useState(false);
  const [printOkalina, setPrintOkalina] = useState(false);
  const [trip, setTrip] = useState<{ row: FlowTransportRow; x: number; y: number } | null>(null);
  // Карточка характеристик машины (по двойному клику на №·ГОС).
  const [specCard, setSpecCard] = useState<{ row: FlowTransportRow; garage: string; veh: FlowVehicle | null; x: number; y: number } | null>(null);
  const [forceEdit, setForceEdit] = useState<{ row: FlowTransportRow } | null>(null);
  const [timeEdit, setTimeEdit] = useState<{ row: FlowTransportRow; field: 'fact_start' | 'fact_end' } | null>(null);
  const gridRef = useRef<DataEditorRef | null>(null);
  // Ретрай восстановления прокрутки (glide после показа не сразу готов к scrollTo).
  const trPendingRef = useRef<{ col: number; row: number; tries: number } | null>(null);
  const trRestoringRef = useRef(false);
  // Контейнер грида — нужен и для замера размера, и чтобы понять, ВИДИМА ли вкладка
  // Транспорт (экран display-toggle, компонент остаётся монтирован) для ⌘Z-хоткея.
  const measureRef = useRef<HTMLDivElement | null>(null);
  // T8: developer/superadmin — без замка 7 дней и с правкой всех редактируемых колонок.
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    let alive = true;
    void sessionStore.load().then((s) => {
      const role = String(s?.role ?? '').toLowerCase();
      if (alive) setIsDev(role === 'developer' || role === 'superadmin');
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (trRowsCache === null) setLoading(true); // при живом кэше грид виден — без оверлея
      setMsg('');
      try {
        const veh = trVehCache ?? await flowVehiclesGet(api);
        if (!alive) return;
        trVehCache = veh;
        setVehicles(veh);
      } catch {
        /* машины вторичны — грузим строки дня в любом случае */
      }
      const backoff = [0, 2000, 5000];
      for (let i = 0; i < backoff.length; i++) {
        if (backoff[i]) await new Promise((r) => setTimeout(r, backoff[i]));
        if (!alive) return;
        try {
          const tr = await flowTransportGet(api);
          if (!alive) return;
          trRowsCache = tr;
          setRows(tr);
          setLoading(false);
          setMsg('');
          return;
        } catch (e) {
          if (i === backoff.length - 1) {
            setLoading(false);
            setMsg(`Ошибка загрузки: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
          }
        }
      }
    };
    void load();
    return () => { alive = false; };
  }, []);

  // Дисковый кэш строк (переживает перезапуск): гидрируемся мгновенно, сервер догоняет.
  useEffect(() => {
    if (trRowsCache !== null) return;
    let alive = true;
    void loadFlowDiskCache<FlowTransportRow[]>(FLOW_DISK_CACHE_TR).then((cached) => {
      if (!alive || !cached || cached.length === 0) return;
      if (trRowsCache !== null) return; // сервер/сессия успели раньше
      setRows((prev) => (prev.length > 0 ? prev : cached));
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Снимок для дискового кэша (правки/WS сыпятся часто — debounce, getter из ref).
  const trDiskRowsRef = useRef<FlowTransportRow[]>([]);
  useEffect(() => {
    trDiskRowsRef.current = rows;
    if (rows.length > 0) saveFlowDiskCacheDebounced(FLOW_DISK_CACHE_TR, () => trDiskRowsRef.current);
  }, [rows]);

  useWsEvent<FlowTransportChangedEvent>('flow_transport_changed', (e) => {
    setRows((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowTransportRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      trRowsCache = next;
      return next;
    });
  });
  useWsEvent<FlowVehiclesChangedEvent>('flow_vehicles_changed', (e) => {
    const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowVehicle[]) : [];
    if (incoming.length === 0) return;
    setVehicles((prev) => {
      const byKey = new Map(prev.map((v) => [v.garage_no, v] as const));
      for (const v of incoming) byKey.set(v.garage_no, v);
      const next = [...byKey.values()];
      trVehCache = next;
      return next;
    });
  });

  const vehByGarage = useMemo(() => {
    const m = new Map<string, FlowVehicle>();
    for (const v of vehicles) m.set(v.garage_no, v);
    return m;
  }, [vehicles]);

  // База контактов — кандидаты в водители (должность содержит «водитель»; юзер 2026-06-12 п.4).
  // Пилюля «МОЛ» — по is_mol (не только должность «водитель»): водитель-кладовщик/МОЛ
  // тоже помечается (ТЗ 17.07 п.14 — пропало после slim/фильтра по должности).
  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);
  const driverOptions = useMemo<FlowDriverOption[]>(() => {
    // Цвет статуса — как у МОЛ в формировании (зел/красн/серый).
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const out: FlowDriverOption[] = [];
    for (const p of persons) {
      // «водитель» как ОТДЕЛЬНОЕ слово (не часть «руководитель» и т.п.; юзер 2026-06-12):
      // совпадение «водител» только в начале токена (предыдущий символ — не буква).
      if (!/(?:^|[^а-яёa-z])водител/i.test(p.position || '')) continue;
      const phone = p.mobile || p.work || '';
      // Ближайший срок «по дату» из складов (если человек МОЛ).
      let until = '';
      for (const w of p.warehouses) if (w.until && !w.isWas && (!until || w.until < until)) until = w.until;
      out.push({
        fio: p.fio,
        position: p.position || '',
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        status: p.status || '',
        color: COLOR[molStatusKind(p.status || '')],
        isMol: p.isMol,
        until,
      });
    }
    out.sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    return out;
  }, [persons]);
  const driverByFio = useMemo(() => {
    const m = new Map<string, FlowDriverOption>();
    for (const o of driverOptions) m.set(o.fio.toUpperCase(), o);
    // Точное ФИО как ключ + UPPER — lookup нечувствителен к регистру.
    for (const o of driverOptions) if (!m.has(o.fio)) m.set(o.fio, o);
    return m;
  }, [driverOptions]);
  /** is_mol по ФИО (все МОЛы, не только с должностью «водитель»). */
  const molFlagByFio = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const m = new Map<string, { isMol: true; until: string; color: string }>();
    for (const p of persons) {
      if (!p.isMol || !p.fio.trim()) continue;
      let until = '';
      for (const w of p.warehouses) {
        if (w.isWas) continue;
        if (w.until && (!until || w.until < until)) until = w.until;
      }
      const rec = { isMol: true as const, until, color: COLOR[molStatusKind(p.status || '')] };
      m.set(p.fio, rec);
      m.set(p.fio.toUpperCase(), rec);
    }
    return m;
  }, [persons]);

  const cellText = useCallback(
    (specId: string, r: FlowTransportRow): string => {
      const veh = vehByGarage.get(r.garage_no);
      switch (specId) {
        case 'date':
          return fmtDay(r.tdate);
        case 'brand':
          return veh?.model ? vehicleBrand(veh.model) : '';
        case 'garage':
          return r.garage_no || '';
        case 'order':
          return r.order_no || '';
        case 'out':
          return r.out_status || '';
        case 'no_exp':
          return r.no_exp_status || '';
        case 'vehicle_type':
          return r.vehicle_type || '';
        case 'fact_start':
          return fmtTimeRange(r.fact_start || '');
        case 'fact_end':
          return fmtTimeRange(r.fact_end || '');
        case 'force':
          return forceSummary(r.force_json || '[]');
        case 'gos':
          return veh?.gos_no ?? '';
        case 'color':
          return veh?.color ?? '';
        case 'vtype':
          return veh?.vtype ?? '';
        case 'max':
          return tons(veh?.max_mass_kg);
        case 'cap':
          return tons(veh?.capacity_kg);
        case 'len':
          return meters(veh?.len_mm);
        case 'wid':
          return meters(veh?.wid_mm);
        case 'hei':
          return meters(veh?.hei_mm);
        case 'work':
          return r.work || '';
        case 'time':
          return fmtTimeRange(r.time_range);
        case 'status':
          return r.status || '';
        case 'comment':
          return r.comment || '';
        case 'driver':
          return r.driver || (veh?.driver ?? '');
        case 'phone': {
          const p = r.driver_phone || (veh?.driver_phone ?? '');
          return p ? formatMobilePhone(p) : '';
        }
        case 'trip':
          return '⟲';
        default:
          return '';
      }
    },
    [vehByGarage],
  );

  // Колонка ДАТА видна ТОЛЬКО в режиме «Все дни» (иначе дата — в шапке-фильтре).
  const showDate = daySel.size !== 1;
  // Колонка ЗАКАЗ (№ заказа) — по тумблеру «Заказ» (юзер 2026-07-06, как инфо-колонки Формирования);
  // по умолчанию скрыта. Стоит сразу после ДАТЫ.
  const [showOrder, setShowOrder] = useState(false);
  const cols = useMemo(
    () =>
      TR_COLS.filter((c) => (c.id === 'date' ? showDate : c.id === 'order' ? showOrder : true)),
    [showDate, showOrder],
  );
  const rowSelectCol = useMemo(() => rowSelectColIndex(cols), [cols]);
  // Зеркало для стабильного transformSelection (клик по колонке-«номеру» → строки).
  const rowSelectColRef = useRef(rowSelectCol);
  rowSelectColRef.current = rowSelectCol;
  const transformSelection = useCallback(
    (sel: GridSelection): GridSelection => colRowSelection(sel, rowSelectColRef.current) ?? sel,
    [],
  );

  // База показа: день (свободный поиск НЕ прячет строки — он подсвечивает).
  // Внутри дня — как печать: «не Размещен» (Отклонён/Отмена/Новый/Открыт) сверху,
  // затем Размещен и прочие по РАБОТЕ. Дни: свежий сверху; без фильтра — текущий месяц.
  const currentMonthPrefix = useMemo(() => isoToday().slice(0, 7), []);
  const baseRows = useMemo(() => {
    const out = rows.filter((r) => {
      if (daySel.size > 0) {
        if (!daySel.has(r.tdate)) return false;
      } else if ((r.tdate || '').slice(0, 7) < currentMonthPrefix) return false;
      return true;
    });
    out.sort(
      (a, b) =>
        (b.tdate || '').localeCompare(a.tdate || '') ||
        printStatusGroup(a.status) - printStatusGroup(b.status) ||
        workKey(a.work) - workKey(b.work) ||
        (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
        a.id - b.id,
    );
    return out;
  }, [rows, daySel, currentMonthPrefix]);

  // Значение ячейки для поиска/фильтра: объединённые колонки склеиваем «A · B» (№/ГОС,
  // Марка/Цвет, Водитель/тел) → чек-лист и поиск-сужение по любому под-значению.
  const colText = useCallback(
    (r: FlowTransportRow, colId: string): string => {
      switch (colId) {
        case 'brand':
          return [cellText('brand', r), cellText('color', r)].filter(Boolean).join(' · ');
        case 'garage':
          return [cellText('garage', r), cellText('gos', r)].filter(Boolean).join(' · ');
        case 'driver':
          return [cellText('driver', r), cellText('phone', r)].filter(Boolean).join(' · ');
        default:
          return cellText(colId, r);
      }
    },
    [cellText],
  );
  // Сырьё для матча поиска (объединённые — по обоим под-полям; ИСТОРИЯ — пусто).
  const searchRaw = useCallback(
    (r: FlowTransportRow, colId: string): string => {
      switch (colId) {
        case 'brand':
          return [cellText('brand', r), cellText('color', r)].filter(Boolean).join(' ');
        case 'garage':
          return [cellText('garage', r), cellText('gos', r)].filter(Boolean).join(' ');
        case 'driver':
          return [cellText('driver', r), cellText('phone', r)].filter(Boolean).join(' ');
        case 'trip':
          return '';
        default:
          return cellText(colId, r);
      }
    },
    [cellText],
  );
  const searchDisplay = useCallback(
    (col: FlowSearchColumn, r: FlowTransportRow): string => colText(r, col.id),
    [colText],
  );
  // Колонки поиска/фильтра ВЫРОВНЕНЫ по индексам с DataEditor.columns (cols) — иначе
  // подсветка/перелёт/меню колонки промахнутся по x.
  const searchColumns = useMemo<FlowSearchColumn[]>(
    () => cols.map((c) => ({ id: c.id, title: c.title })),
    [cols],
  );

  // Фильтры/сортировка колонок — меню-чек-лист как в Формировании (FlowHeaderMenu).
  const colFilters = useFlowColumnFilters<FlowTransportRow>({
    columns: searchColumns,
    rows: baseRows,
    getValue: colText,
  });

  // Показ = база → фильтры колонок → (колоночная сортировка перекрывает дефолтную).
  const viewRows = useMemo(
    () => colFilters.applySort(colFilters.applyFilters(baseRows)),
    [baseRows, colFilters.applyFilters, colFilters.applySort],
  );

  const dayCount = useMemo(() => new Set(rows.map((r) => r.tdate)).size, [rows]);
  // Машины показанного набора — по УНИКАЛЬНОМУ гаражному (юзер 2026-06-12).
  const shownVehicles = useMemo(
    () => new Set(viewRows.map((r) => r.garage_no).filter(Boolean)).size,
    [viewRows],
  );
  const shownDays = useMemo(() => new Set(viewRows.map((r) => r.tdate)).size, [viewRows]);
  const allDays = useMemo(() => [...new Set(rows.map((r) => r.tdate))].sort((a, b) => b.localeCompare(a)), [rows]);
  const allDaysSet = useMemo(() => new Set(allDays), [allDays]);

  /**
   * Выпадашка гаражного: «№ | гос | тип ТС | водитель на текущий день».
   * Водитель — из строки транспорта на выбранный/сегодняшний день, иначе из базы машин.
   */
  const garagePick = useMemo(() => {
    const day = daySel.size === 1 ? [...daySel][0]! : isoToday();
    const driverToday = new Map<string, string>();
    const typeToday = new Map<string, string>();
    for (const r of rows) {
      if (r.tdate !== day || !r.garage_no) continue;
      if (r.driver && !driverToday.has(r.garage_no)) driverToday.set(r.garage_no, r.driver);
      if (r.vehicle_type && !typeToday.has(r.garage_no)) typeToday.set(r.garage_no, r.vehicle_type);
    }
    const options: string[] = [];
    const labels: string[] = [];
    const sorted = [...vehicles].sort((a, b) =>
      (a.garage_no || '').localeCompare(b.garage_no || '', 'ru', { numeric: true }),
    );
    for (const v of sorted) {
      const g = (v.garage_no || '').trim();
      if (!g) continue;
      const gos = formatGosPlate(v.gos_no || '') || (v.gos_no || '').trim();
      const vtype = typeToday.get(g) || v.vtype || '';
      const driver = driverToday.get(g) || v.driver || '';
      options.push(g);
      labels.push([g, gos, vtype, driver].filter(Boolean).join(' | '));
    }
    return { options, labels, day };
  }, [vehicles, rows, daySel]);

  // Авто-ширина «как формирование»: замер уникальных значений колонок (12px Inter),
  // клампы; РАБОТА и ТИП вписываются целиком (ТИП дополнительно переносится).
  const colWidths = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const widths = new Map<string, number>();
    if (!ctx) return widths;
    const sample = viewRows.length > 0 ? viewRows : rows;
    for (const spec of TR_COLS) {
      // Заголовок меряем тем же шрифтом, что рисуется (600 10px — как весь текст листа);
      // значения — телом колонки 10px (стек/гос рисуются 10/9px, мерим по верхней 10px).
      ctx.font = '600 10px "Inter Variable", system-ui, sans-serif';
      let max = ctx.measureText(spec.title).width;
      ctx.font = `${STD_FONT} "Inter Variable", system-ui, sans-serif`;
      const uniq = new Set<string>();
      if (spec.id === 'time') {
        for (const r of sample) uniq.add(fmtTimeRange(r.time_range));
      } else {
        for (const r of sample) uniq.add(cellText(spec.id, r));
        // Объединённые ячейки — учесть и нижнюю строку (ГОС у гаражного, ЦВЕТ у марки).
        if (spec.id === 'garage') for (const r of sample) uniq.add(cellText('gos', r));
        else if (spec.id === 'brand') for (const r of sample) uniq.add(cellText('color', r));
      }
      // Водитель: ФИО + телефон (две строки) — меряем по самой длинной из них.
      if (spec.id === 'driver') {
        for (const r of sample) {
          const d = cellText('driver', r);
          const p = cellText('phone', r);
          if (d) uniq.add(d);
          if (p) uniq.add(p);
        }
      }
      // №·ГОС: стек/display «№ · ГОС» — меряем склейку, иначе гос обрезается.
      if (spec.id === 'garage') {
        for (const r of sample) {
          const g = cellText('garage', r);
          const gos = cellText('gos', r);
          if (g && gos) uniq.add(`${g} · ${gos}`);
          else if (gos) uniq.add(gos);
        }
      }
      for (const v of uniq) max = Math.max(max, ctx.measureText(v).width);
      // pad: 6 слева + правый запас (+▾ у dropdown). Водитель/гараж — целиком.
      // РАБОТА — умеренная ширина (текст переносится, высота строки растёт), как печать.
      const pad = spec.id === 'time' ? 16 : spec.id === 'driver' || spec.id === 'garage' ? 22 : 10;
      if (spec.id === 'work') {
        // 180–240: длинные «2.3. …» переносятся, не раздувают лист.
        widths.set(spec.id, Math.min(240, Math.max(180, Math.ceil(Math.min(max, 200) + pad))));
        continue;
      }
      if (spec.id === 'no_exp') {
        // Компактная колонка: заголовок + маленькая галочка.
        widths.set(spec.id, 58);
        continue;
      }
      const cap =
        spec.id === 'comment' ? 200
          : spec.id === 'driver' ? 320
            : spec.id === 'garage' ? 160
              : 240;
      widths.set(spec.id, Math.min(cap, Math.max(30, Math.ceil(max + pad))));
    }
    return widths;
  }, [viewRows, rows, cellText]);

  // Последняя колонка (КОММЕНТАРИЙ) растягивается (grow). hasMenu → ▾ меню колонки
  // (фильтр/сорт как в Формировании); ИСТОРИЯ — без меню (иконка, фильтровать нечего).
  // Активный фильтр колонки — лёгкая clay-подложка заголовка.
  const columns = useMemo<GridColumn[]>(
    () =>
      cols.map((c) => ({
        id: c.id,
        title: c.title,
        width: colWidths.get(c.id) ?? 80,
        ...(c.id === 'comment' ? { grow: 1 } : {}),
        ...(c.id !== 'trip' ? { hasMenu: true } : {}),
        ...(colFilters.activeFilterColIds.has(c.id)
          ? { themeOverride: { bgHeader: '#F4E6DE', bgHeaderHovered: '#EFD9CE' } }
          : {}),
      })),
    [cols, colWidths, colFilters.activeFilterColIds],
  );

  // Поиск как в Формировании (подсветка/перелёт, не фильтр). searchColumns/colText/
  // searchRaw/searchDisplay определены выше (рядом с фильтрами — общий источник значений).
  const gridSearch = useFlowGridSearch<FlowTransportRow>({
    columns: searchColumns,
    rows,
    viewRows,
    gridRef,
    getRaw: searchRaw,
    getDisplay: searchDisplay,
    setSelection: applySelection,
  });

  // Высота строки: минимум 36 (водитель+тел, стек №·ГОС); РАБОТА/коммент — перенос.
  const getRowHeight = useCallback(
    (row: number): number => {
      const r = viewRows[row];
      if (!r) return 36;
      const workW = (colWidths.get('work') ?? 200) - 12;
      const commentW = (colWidths.get('comment') ?? 160) - 12;
      const workLines = approxWrapLines(r.work || '', workW);
      const commentLines = approxWrapLines(r.comment || '', commentW);
      const lines = Math.max(2, workLines, commentLines);
      return Math.min(108, Math.max(36, 10 + lines * 13));
    },
    [viewRows, colWidths],
  );

  const cutoff = editCutoff();
  const rowLocked = useCallback(
    (r: FlowTransportRow) => !isDev && r.tdate < cutoff,
    [cutoff, isDev],
  );
  const colEditable = useCallback(
    (spec: TrColSpec, locked: boolean) => (isDev || !!spec.editable) && !locked,
    [isDev],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      const locked = rowLocked(r);
      if (spec.id === 'status') {
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: r.status || '',
          data: { kind: 'flow-dropdown', value: r.status || '', options: STATUS_ORDER },
        };
        return cell;
      }
      if (spec.id === 'work') {
        // Перенос текста как в печати (allowWrapping + динамическая высота строки).
        // Частые работы — подсказки не в canvas; правка текстом (allowCustom раньше).
        return {
          kind: GridCellKind.Text,
          data: r.work || '',
          displayData: r.work || '',
          allowOverlay: !locked,
          readonly: locked,
          allowWrapping: true,
        };
      }
      if (spec.id === 'vehicle_type') {
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: r.vehicle_type || '',
          data: { kind: 'flow-dropdown', value: r.vehicle_type || '', options: BODY_TYPES as unknown as string[] },
        };
        return cell;
      }
      if (spec.id === 'out') {
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: r.out_status || '',
          data: { kind: 'flow-dropdown', value: r.out_status || '', options: OUT_STATUS_ORDER },
        };
        return cell;
      }
      if (spec.id === 'no_exp') {
        // Компактная clay-галочка; copyData «ДА»/«НЕТ» — пустое тоже копируется и заливается.
        const on = isNoExpChecked(r.no_exp_status);
        const cell: FlowCheckCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          readonly: locked,
          copyData: noExpCopyData(on),
          data: { kind: 'flow-check', checked: on },
        };
        return cell;
      }
      if (spec.id === 'trip') {
        // §8: значок истории ТОЛЬКО где есть НАШИ зафикс. поставки на эту машину+день; иначе пусто
        // (отмена/отклонённые/открытые без поставок — без значка). Двойной клик → карточка.
        if (!tripKeys.has(`${(r.garage_no || '').toUpperCase()}|${r.tdate}`)) {
          return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
        }
        const cell: FlowHistoryCell = {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: '',
          data: { kind: 'flow-history' },
        };
        return cell;
      }
      const text = cellText(spec.id, r);
      // Шрифт значения: стандарт 10px, второстепенные — 8px (как в Формировании).
      const fontOverride = { baseFontStyle: SMALL_COLS.has(spec.id) ? SMALL_FONT : STD_FONT };
      if (spec.id === 'brand') {
        // МАРКА (сверху) + ЦВЕТ кузова (снизу) — одна ячейка (юзер 2026-06-12).
        const veh = vehByGarage.get(r.garage_no);
        const cell: FlowStackCell = {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: [text, veh?.color ?? ''].filter(Boolean).join(' · '),
          data: { kind: 'flow-stack', top: text, bottom: veh?.color ?? '', small: true },
        };
        return cell;
      }
      if (spec.id === 'garage') {
        // Dropdown: гаражный | гос | тип | водитель дня. На canvas — № + ГОС (стек-вид через display).
        const veh = vehByGarage.get(r.garage_no);
        const gos = veh?.gos_no ?? '';
        const display = [r.garage_no, gos].filter(Boolean).join(' · ');
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: display,
          data: {
            kind: 'flow-dropdown',
            value: r.garage_no || '',
            displayValue: display,
            options: garagePick.options,
            labels: garagePick.labels,
            allowCustom: true,
          },
        };
        return cell;
      }
      if (spec.id === 'driver') {
        // ВОДИТЕЛЬ: ФИО + СОТ под ним; двойной клик → поиск по базе водителей.
        // Пилюля МОЛ: lookup по должности-водителю ИЛИ по is_mol (ТЗ 17.07 п.14).
        const veh = vehByGarage.get(r.garage_no);
        const driver = r.driver || (veh?.driver ?? '');
        const phone = r.driver_phone || (veh?.driver_phone ?? '');
        const fromDrv =
          driverByFio.get(driver) || driverByFio.get(driver.toUpperCase());
        const fromMol =
          molFlagByFio.get(driver) || molFlagByFio.get(driver.toUpperCase());
        const cell: FlowDriverCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: driver,
          data: {
            kind: 'flow-driver',
            driver,
            phone,
            phoneDisplay: phone ? formatMobilePhone(phone) : '',
            color: fromDrv?.color || fromMol?.color || '',
            isMol: Boolean(fromDrv?.isMol || fromMol?.isMol),
            until: fromDrv?.until || fromMol?.until || '',
            drivers: driverOptions,
          },
        };
        return cell;
      }
      if (spec.id === 'force') {
        return {
          kind: GridCellKind.Text,
          data: r.force_json || '[]',
          displayData: forceSummary(r.force_json || '[]') || '',
          allowOverlay: false,
          readonly: true,
          allowWrapping: true,
        };
      }
      if (spec.id === 'fact_start' || spec.id === 'fact_end') {
        return {
          kind: GridCellKind.Text,
          data: spec.id === 'fact_start' ? (r.fact_start || '') : (r.fact_end || ''),
          displayData: spec.id === 'fact_start' ? fmtTimeRange(r.fact_start || '') : fmtTimeRange(r.fact_end || ''),
          allowOverlay: false,
          readonly: true,
        };
      }
      const editable = colEditable(spec, locked);
      if (spec.id === 'time') {
        // Жирное: авто, если время ≠ норма смены по работе; + ручной флаг «Жирный».
        const bold = shouldShowTimeBold(r.time_range, r.work, r.tdate, prodCalByYear, r.time_bold);
        return {
          kind: GridCellKind.Text,
          data: r.time_range,
          displayData: fmtTimeTwoLine(r.time_range),
          allowOverlay: editable,
          readonly: !editable,
          allowWrapping: false,
          themeOverride: bold ? { baseFontStyle: `700 ${STD_FONT}` } : fontOverride,
        };
      }
      const rawData = text;
      return {
        kind: GridCellKind.Text,
        data: rawData,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        allowWrapping: spec.id === 'comment', // КОМЕНТ. переносится по словам (строка 36px вмещает 2)
        contentAlign: ['max', 'cap', 'len', 'wid', 'hei'].includes(spec.id) ? 'right' : spec.id === 'trip' ? 'center' : 'left',
        themeOverride: fontOverride,
      };
    },
    [viewRows, cellText, vehByGarage, garagePick, rowLocked, colEditable, driverOptions, driverByFio, molFlagByFio, cols, tripKeys, prodCalByYear],
  );

  const applyServerRows = useCallback((serverRows: FlowTransportRow[]) => {
    if (serverRows.length === 0) return;
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r] as const));
      for (const r of serverRows) byId.set(r.id, r);
      const next = [...byId.values()];
      trRowsCache = next;
      return next;
    });
  }, []);

  // rowsRef — всегда актуальные строки (для row_version при undo/redo — без устаревшего замыкания).
  const rowsRef = useRef<FlowTransportRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // История отмены/повтора (юзер 2026-06-12, как в Формировании) — правки ячеек + вставка из буфера.
  const undoRef = useRef<TrHistStep[]>([]);
  const redoRef = useRef<TrHistStep[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const syncHistory = useCallback(() => {
    setHistory({ canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0 });
  }, []);

  // Применить набор полей к строке (оптимистично + сервер) БЕЗ записи в историю — общий путь
  // для правки и для отмены/повтора. row_version берём актуальный из rowsRef.
  const applyFields = useCallback(
    (id: number, fields: Record<string, string>) => {
      const cur = rowsRef.current.find((x) => x.id === id);
      if (!cur) return;
      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) => (x.id === id ? ({ ...x, ...fields } as FlowTransportRow) : x));
        trRowsCache = next;
        rowsRef.current = next;
        return next;
      });
      void flowTransportEdit(api, [{ id, row_version: cur.row_version, fields }]).then((res) =>
        applyServerRows(res.rows),
      );
    },
    [applyServerRows],
  );
  const applyFieldsBatch = useCallback(
    (edits: { id: number; fields: Record<string, string> }[]) => {
      if (edits.length === 0) return;
      const curRows = rowsRef.current;
      const byId = new Map(edits.map((e) => [e.id, e.fields]));
      const wire = edits
        .map((e) => {
          const cur = curRows.find((x) => x.id === e.id);
          return cur ? { id: e.id, row_version: cur.row_version, fields: e.fields } : null;
        })
        .filter((x): x is { id: number; row_version: number; fields: Record<string, string> } => x !== null);
      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) => {
          const f = byId.get(x.id);
          return f ? ({ ...x, ...f } as FlowTransportRow) : x;
        });
        trRowsCache = next;
        rowsRef.current = next;
        return next;
      });
      if (wire.length) void flowTransportEdit(api, wire).then((res) => applyServerRows(res.rows));
    },
    [applyServerRows],
  );

  const pushHistory = useCallback(
    (e: TrHistStep) => {
      undoRef.current.push(e);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = []; // новый шаг обнуляет «повтор»
      syncHistory();
    },
    [syncHistory],
  );
  // Отмена вставки — убрать вставленные новые строки (оптимистично + сервер).
  const undoPasteStep = useCallback((e: TrPasteStep) => {
    if (e.insertedIds.length === 0) return;
    const drop = new Set(e.insertedIds);
    setRows((prev) => {
      const next = prev.filter((r) => !drop.has(r.id));
      trRowsCache = next;
      rowsRef.current = next;
      return next;
    });
    setMsg(`Вставка отменена — убрано строк: ${e.insertedIds.length}`);
    void flowTransportDelete(api, e.insertedIds).catch(() => undefined);
  }, []);
  // Повтор вставки — вставить те же строки заново; id обновятся для следующей отмены.
  const redoPasteStep = useCallback((e: TrPasteStep) => {
    setMsg('Повтор вставки…');
    void flowTransportPaste(api, e.rows, { mode: e.mode === '1c' ? '1c' : 'template' })
      .then((res) => {
        e.insertedIds = res.insertedIds;
        setMsg(`Вставка повторена: +${res.inserted} · ${res.updated} обновлено`);
      })
      .catch((err) => setMsg(`Ошибка повтора: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`));
  }, []);
  const undoFillStep = useCallback(
    (e: TrFillStep) => {
      applyFieldsBatch(e.edits.map((x) => ({ id: x.id, fields: x.before })));
      setMsg(`Заливка отменена: ${e.edits.length} ячеек`);
    },
    [applyFieldsBatch],
  );
  const redoFillStep = useCallback(
    (e: TrFillStep) => {
      applyFieldsBatch(e.edits.map((x) => ({ id: x.id, fields: x.after })));
      setMsg(`Заливка повторена: ${e.edits.length} ячеек`);
    },
    [applyFieldsBatch],
  );
  const undo = useCallback(() => {
    const e = undoRef.current.pop();
    if (!e) return;
    if (isPasteStep(e)) undoPasteStep(e);
    else if (isFillStep(e)) undoFillStep(e);
    else applyFields(e.id, e.before);
    redoRef.current.push(e);
    syncHistory();
  }, [applyFields, syncHistory, undoPasteStep, undoFillStep]);
  const redo = useCallback(() => {
    const e = redoRef.current.pop();
    if (!e) return;
    if (isPasteStep(e)) redoPasteStep(e);
    else if (isFillStep(e)) redoFillStep(e);
    else applyFields(e.id, e.after);
    undoRef.current.push(e);
    syncHistory();
  }, [applyFields, syncHistory, redoPasteStep, redoFillStep]);

  // ⌘Z / ⌘⇧Z (Ctrl на Win) — отмена/повтор, кроме случая когда фокус в поле ввода
  // (там Cmd+Z правит текст). Грид монтируется только на активной вкладке Транспорт.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      // Только когда вкладка Транспорт ВИДИМА (offsetParent === null при display:none).
      if (!measureRef.current || measureRef.current.offsetParent === null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell;
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (rowLocked(r)) {
        setMsg('Старше 7 дней — архив, правки заблокированы');
        return;
      }
      // ВОДИТЕЛЬ — особый случай: ФИО + телефон ОДНОЙ правкой (телефон из базы водителей).
      if (spec.id === 'driver' && newValue.kind === GridCellKind.Custom) {
        const d = (newValue as FlowDriverCell).data;
        if (!d || d.kind !== 'flow-driver') return;
        const before = { driver: r.driver ?? '', driver_phone: r.driver_phone ?? '' };
        const after = { driver: d.driver, driver_phone: d.phone };
        if (before.driver === after.driver && before.driver_phone === after.driver_phone) return;
        applyFields(r.id, after);
        pushHistory({ id: r.id, before, after });
        return;
      }
      let value = '';
      if (newValue.kind === GridCellKind.Custom) {
        const raw = (newValue as FlowDropdownCell | FlowCheckCell).data;
        if (!raw) return;
        if (raw.kind === 'flow-check') {
          value = raw.checked ? 'ДА' : '';
        } else if (raw.kind === 'flow-dropdown') {
          value = raw.value;
        } else return;
      } else if (newValue.kind === GridCellKind.Text) {
        value = String(newValue.data ?? '').trim();
      } else return;

      const fieldByCol: Record<string, string> = {
        garage: 'garage_no',
        order: 'order_no',
        work: 'work',
        vehicle_type: 'vehicle_type',
        time: 'time_range',
        fact_start: 'fact_start',
        fact_end: 'fact_end',
        force: 'force_json',
        out: 'out_status',
        no_exp: 'no_exp_status',
        status: 'status',
        comment: 'comment',
      };
      const field = fieldByCol[spec.id];
      if (!field) return;
      if (field === 'no_exp_status') value = normalizeNoExpValue(value);
      const before = String((r as unknown as Record<string, unknown>)[field] ?? '');
      // Нормализуем старые «НЕТ»/пустые к одному виду для сравнения.
      const beforeNorm = field === 'no_exp_status' ? (isNoExpChecked(before) ? 'ДА' : '') : before;
      if (beforeNorm === value) return;
      // Пишем канон: 'ДА' или '' (не «НЕТ»).
      if (field === 'no_exp_status') {
        applyFields(r.id, { no_exp_status: value });
        pushHistory({ id: r.id, before: { no_exp_status: before }, after: { no_exp_status: value } });
        return;
      }

      // ВРЕМЯ (план): одновременно заполняет факт (план = факт, пока факт не правили отдельно).
      // Правка факта НЕ трогает time_range (сервер + клиент).
      if (field === 'time_range') {
        const bounds = parseTimeRangeBounds(value);
        const fs = bounds ? `${Math.floor(bounds.startMin / 60)}:${String(bounds.startMin % 60).padStart(2, '0')}` : '';
        const fe = bounds ? `${Math.floor(bounds.endMin / 60)}:${String(bounds.endMin % 60).padStart(2, '0')}` : '';
        // Убираем ведущий 0 у часов (как timeRangeParts на сервере).
        const normHm = (hm: string) => {
          const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
          return m ? `${Number(m[1])}:${m[2]}` : hm;
        };
        const after: Record<string, string> = { time_range: value };
        if (fs) after.fact_start = normHm(fs);
        if (fe) after.fact_end = normHm(fe);
        const beforeMap: Record<string, string> = {
          time_range: before,
          fact_start: r.fact_start || '',
          fact_end: r.fact_end || '',
        };
        applyFields(r.id, after);
        pushHistory({ id: r.id, before: beforeMap, after });
        return;
      }

      // Гаражный: сервер подтянет вес/марку/тип/водителя из последнего состояния.
      applyFields(r.id, { [field]: value });
      pushHistory({ id: r.id, before: { [field]: before }, after: { [field]: value } });
    },
    [viewRows, applyFields, pushHistory, rowLocked, cols],
  );

  // Вставка в выделенный диапазон (Excel: одно значение → все ячейки, ТЗ п.5).
  // Пустая строка — валидное значение (снять галочку БЕЗ ЭКСП. / очистить ячейку).
  const handlePaste = useCallback(
    (_target: Item, values: readonly (readonly string[])[]): boolean => {
      const single =
        values.length === 1 && values[0] != null && values[0].length === 1
          ? values[0][0]
          : undefined;
      const range = selectionRef.current.current?.range;
      // single может быть '' — это ок (пустое значение для заливки).
      if (single === undefined || !range || (range.width <= 1 && range.height <= 1)) return true;
      const fieldByCol: Record<string, string> = {
        garage: 'garage_no',
        order: 'order_no',
        work: 'work',
        vehicle_type: 'vehicle_type',
        time: 'time_range',
        out: 'out_status',
        no_exp: 'no_exp_status',
        status: 'status',
        comment: 'comment',
      };
      const fillByRow = new Map<number, TrEdit>();
      for (let ri = range.y; ri < range.y + range.height; ri++) {
        for (let c = range.x; c < range.x + range.width; c++) {
          const spec = cols[c];
          const r = viewRows[ri];
          if (!spec || !r || rowLocked(r) || !colEditable(spec, rowLocked(r))) continue;
          const field = fieldByCol[spec.id];
          if (!field) continue;
          const before = String((r as unknown as Record<string, unknown>)[field] ?? '');
          const value =
            field === 'no_exp_status' ? normalizeNoExpValue(single) : single.trim();
          const beforeCmp =
            field === 'no_exp_status' ? (isNoExpChecked(before) ? 'ДА' : '') : before;
          if (beforeCmp === value) continue;
          const acc = fillByRow.get(r.id) ?? { id: r.id, before: {}, after: {} };
          acc.before[field] = before;
          acc.after[field] = value;
          fillByRow.set(r.id, acc);
        }
      }
      const fillEdits = [...fillByRow.values()];
      if (fillEdits.length === 0) return false;
      applyFieldsBatch(fillEdits.map((e) => ({ id: e.id, fields: e.after })));
      pushHistory({ kind: 'fill', edits: fillEdits });
      return false;
    },
    [cols, viewRows, rowLocked, colEditable, applyFieldsBatch, pushHistory],
  );

  // Del/Backspace: ФАКТ НАЧ/ФАКТ КОН — readonly-ячейки (правятся поповером), штатное
  // глайдовское стирание их не берёт. Чистим руками в пусто: пустой факт = этой работы
  // у гаражного не было (юзер 2026-07-09). Правки одной строки — ОДНИМ запросом
  // (гонка row_version — грабли 2026-07-05). Остальные ячейки стирает сам глайд (true).
  const onGridDelete = useCallback(
    (sel: GridSelection): boolean => {
      const ranges = sel.current ? [sel.current.range, ...sel.current.rangeStack] : [];
      const byRow = new Map<number, { before: Record<string, string>; after: Record<string, string> }>();
      for (const range of ranges) {
        for (let c = range.x; c < range.x + range.width; c++) {
          const spec = cols[c];
          if (!spec || (spec.id !== 'fact_start' && spec.id !== 'fact_end')) continue;
          for (let ri = range.y; ri < range.y + range.height; ri++) {
            const r = viewRows[ri];
            if (!r || rowLocked(r)) continue;
            const before = String((r as unknown as Record<string, unknown>)[spec.id] ?? '');
            if (!before) continue;
            const acc = byRow.get(r.id) ?? { before: {}, after: {} };
            acc.before[spec.id] = before;
            acc.after[spec.id] = '';
            byRow.set(r.id, acc);
          }
        }
      }
      for (const [id, e] of byRow) {
        applyFields(id, e.after);
        pushHistory({ id, before: e.before, after: e.after });
      }
      return true;
    },
    [cols, viewRows, rowLocked, applyFields, pushHistory],
  );

  // Двойной клик/Enter: ИСТОРИЯ → поповер истории (план+факт из отчёта); №·ГОС → карточка
  // характеристик машины (тип/доп.тн/тн/Д/Ш/В — как карточка MAT в формировании).
  const onCellActivated = useCallback(
    ([col, row]: Item) => {
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (spec.id === 'force') {
        if (rowLocked(r)) {
          setMsg('Старше 7 дней — архив, правки заблокированы');
          return;
        }
        setForceEdit({ row: r });
        return;
      }
      if (spec.id === 'fact_start' || spec.id === 'fact_end') {
        if (rowLocked(r)) {
          setMsg('Старше 7 дней — архив, правки заблокированы');
          return;
        }
        setTimeEdit({ row: r, field: spec.id });
        return;
      }
      if (!r.garage_no) return;
      const b = gridRef.current?.getBounds(col, row);
      if (!b) return;
      if (spec.id === 'trip') {
        setTrip({ row: r, x: b.x + b.width / 2, y: b.y + b.height });
      } else if (spec.id === 'garage') {
        const veh = vehByGarage.get(r.garage_no) ?? null;
        setSpecCard({ row: r, garage: r.garage_no, veh, x: b.x + b.width / 2, y: b.y + b.height });
      }
    },
    [viewRows, cols, vehByGarage, rowLocked, applyFields, pushHistory],
  );

  // Подкраска по статусу (юзер): Размещен — зелёная; Отклонен/Отмена — красная;
  // Новый/Открыт — без подкраски. Архив (старше 7 дней) — слегка приглушён.
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      if (r.status === 'Размещен' || r.status === 'Дополнение') return { bgCell: '#EAF5EA' };
      if (r.status === 'Отклонен' || r.status === 'Отмена' || r.status === 'Не приехал' || r.status === 'Открыт') {
        return { bgCell: '#FBE7E4', textDark: '#7A2A1D' };
      }
      if (rowLocked(r)) return { textDark: '#8C8983' };
      return undefined;
    },
    [viewRows, rowLocked],
  );

  const pasteFromClipboard = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    void navigator.clipboard
      .readText()
      .then(async (tsv) => {
        // Сначала спец-режим 1С (шапка со «Статус»), иначе шаблон листа 🚚.
        const mode1c = isTransport1cPaste(tsv);
        const parsed = mode1c ? parseTransport1cPaste(tsv) : parseTransportPaste(tsv);
        if (parsed.length === 0) {
          setMsg(
            mode1c
              ? 'В буфере 1С не нашёл строк (нужны заголовки Номер/Статус/Отправление…)'
              : 'В буфере не нашёл строк шаблона (пришли образец — подгоню разбор)',
          );
          return;
        }
        // Авто-жирное ВРЕМЯ только при вставке (1.2 / 2.n / 3.n + неполная дневная).
        const withBold = parsed.map((r) => ({
          ...r,
          time_bold: isShiftUndershoot(r.time_range, r.work, r.tdate, prodCalByYear) ? 1 : 0,
        }));
        const res = await flowTransportPaste(api, withBold, { mode: mode1c ? '1c' : 'template' });
        // Вставка = один шаг Undo (юзер 2026-07-06): ⌘Z уберёт вставленные строки.
        if (res.insertedIds.length > 0) {
          pushHistory({
            kind: 'paste',
            insertedIds: res.insertedIds,
            rows: withBold,
            mode: mode1c ? '1c' : 'template',
          });
        }
        const parts = [`+${res.inserted} новых`, `${res.updated} обновлено`];
        if (res.autoAdded > 0) parts.push(`${res.autoAdded} авто 0.x`);
        if (res.vehicles > 0) parts.push(`машин: ${res.vehicles}`);
        if (res.insertedIds.length > 0) parts.push('⌘Z — отменить');
        setMsg(`${mode1c ? '1С' : 'Вставка'}: ${parts.join(' · ')}`);
      })
      .catch((e) => setMsg(`Ошибка вставки: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`))
      .finally(() => setBusy(false));
  }, [busy, pushHistory, prodCalByYear]);

  /** Кнопка: вручную жирнить / снять жирный у ВРЕМЯ в выделенных строках. */
  const toggleTimeBold = useCallback(() => {
    const sel = selectionRef.current;
    const rowIdxs = new Set<number>();
    if (sel.rows.length > 0) {
      for (const r of sel.rows) rowIdxs.add(r);
    } else if (sel.current?.range) {
      const { y, height } = sel.current.range;
      for (let i = y; i < y + height; i++) rowIdxs.add(i);
    }
    if (rowIdxs.size === 0) {
      setMsg('Выделите строки — кнопка «Жирное ВРЕМЯ» только для колонки ВРЕМЯ');
      return;
    }
    const targets = [...rowIdxs]
      .map((i) => viewRows[i])
      .filter((r): r is FlowTransportRow => !!r && !rowLocked(r));
    if (targets.length === 0) {
      setMsg('Нет доступных строк (архив >7 дней — read-only)');
      return;
    }
    // Если хоть одна без жирного — ставим; все жирные — снимаем.
    const allBold = targets.every((r) => isTimeBoldFlag(r.time_bold));
    const next = allBold ? 0 : 1;
    const edits = targets.map((r) => ({
      id: r.id,
      before: { time_bold: String(Number(r.time_bold) === 1 ? 1 : 0) },
      after: { time_bold: String(next) },
    }));
    applyFieldsBatch(edits.map((e) => ({ id: e.id, fields: e.after })));
    for (const e of edits) pushHistory(e);
    setMsg(next === 1
      ? `Жирное ВРЕМЯ: +${targets.length}`
      : `Жирное ВРЕМЯ снято: ${targets.length}`);
  }, [viewRows, rowLocked, applyFieldsBatch, pushHistory]);

  const runAdd = useCallback((date: string, garage: string) => {
    setBusy(true);
    setMsg('');
    void flowTransportAdd(api, { date, garageNo: garage })
      .then(() => {
        setAddOpen(false);
        setAddGarage('');
        setMsg(garage ? `Машина ${garage} добавлена на ${fmtDay(date)}` : `Пустая строка добавлена на ${fmtDay(date)}`);
      })
      .catch((e) => {
        const t = e instanceof Error ? e.message : String(e);
        if (t.includes('vehicle_not_found')) {
          pendingAddRef.current = { date, garage };
          setCardGarage(garage);
          setAddOpen(false);
        } else if (t.includes('date_too_old')) setMsg('Дата старше 7 дней — добавлять нельзя');
        else setMsg(`Ошибка: ${t.slice(0, 80)}`);
      })
      .finally(() => setBusy(false));
  }, []);

  const deleteSelected = useCallback(() => {
    const selRows = selectionRef.current.rows;
    const ids: number[] = [];
    let lockedHit = false;
    for (const idx of selRows.toArray()) {
      const r = viewRows[idx];
      if (!r) continue;
      if (rowLocked(r)) {
        lockedHit = true;
        continue;
      }
      ids.push(r.id);
    }
    if (lockedHit && !isDev) setMsg('Часть строк старше 7 дней — они не удаляются (архив)');
    if (ids.length === 0) {
      if (lockedHit && !isDev) return;
      if (selRows.length > 0) setMsg('Нет строк для удаления');
      return;
    }
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      trRowsCache = next;
      return next;
    });
    clearSelection();
    void flowTransportDelete(api, ids).catch(() => undefined);
  }, [viewRows, rowLocked, isDev, clearSelection]);

  const selectAllRows = useCallback(() => {
    if (viewRows.length === 0) return;
    applySelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.fromSingleSelection([0, viewRows.length]),
      current: undefined,
    });
  }, [viewRows.length, applySelection]);

  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // Замер слоя `absolute inset-0` для canvas-грида (см. JSX): абсолютный слой всегда
    // повторяет размер родителя, поэтому ResizeObserver надёжно срабатывает на ресайзе
    // окна (раньше мерили flex-1-контейнер — широкий канвас не давал ему сжаться, RO
    // молчал, скролл не пересчитывался до перехода по вкладкам, юзер 2026-06-12).
    // window 'resize' оставлен подстраховкой. Целые px + bail-on-equal.
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // ── Вид «Общий / Личный» (filter-views, как в Формировании) ───────────────────
  // Применить вид к фильтрам. lastViewJsonRef ставим ДО setState — тогда save-эффект
  // увидит «не изменилось» и не пере-сохранит (без эха).
  const applyView = useCallback((v: TransportView) => {
    // statuses/search — legacy в JSON; фильтр статуса только в колонке грида.
    const view = { search: '', statuses: [] as string[], days: v.days };
    lastViewJsonRef.current = canonicalTransportViewJson(view);
    setDaySel(new Set(v.days));
  }, []);

  // Сохранить общий вид на сервер (debounce — лишние записи на CF free tier дороги).
  const scheduleSharedSave = useCallback((json: string) => {
    if (sharedSaveTimerRef.current != null) window.clearTimeout(sharedSaveTimerRef.current);
    sharedSaveTimerRef.current = window.setTimeout(() => {
      sharedSaveTimerRef.current = null;
      const value = isEmptyTransportViewJson(json) ? '' : json;
      void flowTransportViewSet(api, value)
        .then((res) => {
          sharedValueRef.current = res.value;
          setHasSharedView(res.value !== '');
          setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
        })
        .catch(() => undefined);
    }, 600);
  }, []);

  // Гидрация: режим + личный вид (localStorage) + общий вид (сервер) → применяем активный.
  // ВАЖНО: выбор дней в ЭТОЙ сессии (trDaySelCache) не затираем пустым/чужим видом —
  // иначе при возврате в раздел «слетает» выбранный день (юзер 2026-07-18).
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
      const mode = readTransportViewMode(login);
      setViewMode(mode);
      viewModeRef.current = mode;
      const personal = readPersonalTransportView(login);
      setHasPersonalView(personal != null);
      let sharedState: TransportView | null = null;
      try {
        const sv = await flowTransportViewGet(api);
        if (!alive) return;
        sharedValueRef.current = sv.value;
        setHasSharedView(sv.value !== '');
        setSharedAuthor({ updatedBy: sv.updatedBy, updatedByName: sv.updatedByName, updatedAt: sv.updatedAt });
        sharedState = sv.value ? parseTransportView(sv.value) : null;
      } catch {
        /* сервер недоступен — общий вид пустой */
      }
      if (!alive) return;
      const sessionDays = trDaySelCache && trDaySelCache.size > 0 ? [...trDaySelCache] : null;
      const active = mode === 'personal' ? personal : sharedState;
      if (sessionDays) {
        // Сессия главнее: пользователь уже выбрал дни в этом запуске.
        const view: TransportView = {
          search: active?.search ?? '',
          statuses: active?.statuses ?? [],
          days: sessionDays,
        };
        applyView(view);
      } else if (active) {
        applyView(active);
      } else {
        lastViewJsonRef.current = EMPTY_TRANSPORT_VIEW_JSON;
      }
      viewHydratedRef.current = true;
    })();
    return () => {
      alive = false;
    };
  }, [applyView]);

  // Изменение фильтров → сохраняем в АКТИВНЫЙ источник (личный localStorage / общий сервер).
  useEffect(() => {
    if (!viewHydratedRef.current) return;
    const view: TransportView = { search: '', statuses: [], days: [...daySel] };
    const json = canonicalTransportViewJson(view);
    if (json === lastViewJsonRef.current) return;
    lastViewJsonRef.current = json;
    if (viewModeRef.current === 'personal') {
      const login = myLoginRef.current;
      if (isEmptyTransportViewJson(json)) {
        clearPersonalTransportView(login);
        setHasPersonalView(false);
      } else {
        writePersonalTransportView(login, view);
        setHasPersonalView(true);
      }
    } else {
      scheduleSharedSave(json);
    }
  }, [daySel, scheduleSharedSave]);

  useEffect(() => {
    trDaySelCache = new Set(daySel);
  }, [daySel]);

  // Восстановление прокрутки Транспорта. Вкладка — display-toggle (компонент НЕ
  // размонтируется), App не перерисовывает грид на показ → ловим видимость через
  // IntersectionObserver: на СКРЫТИЕ коммитим живую прокрутку (до сброса display:none),
  // на ПОКАЗ — восстанавливаем из закоммиченной (race-free, не затирается нулём).
  useEffect(() => {
    const el = measureRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) {
          if (trScrollCache) trScrollSaved = trScrollCache;
        } else if (gridRef.current && trScrollSaved) {
          // Ретрай через onVisibleRegionChanged (glide не сразу готов к scrollTo).
          trRestoringRef.current = true;
          trPendingRef.current = { col: trScrollSaved.col, row: trScrollSaved.row, tries: 0 };
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const p = trPendingRef.current;
              if (p) gridRef.current?.scrollTo(p.col, p.row, 'both', 0, 0);
            }),
          );
        }
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Реалтайм: кто-то изменил ОБЩИЙ вид. Автора/наличие обновляем всегда; ПРИМЕНЯЕМ только
  // если я в «Общем» и это не моё эхо. Дни чужого вида не сносят локальный выбор сессии
  // (trDaySelCache) — иначе «выбрал день → пришёл WS → слетел».
  useWsEvent<FlowTransportViewChangedEvent>('flow_transport_view_changed', (e) => {
    const value = String(e.value ?? '');
    const by = e.updated_by ?? '';
    sharedValueRef.current = value;
    setHasSharedView(value !== '');
    setSharedAuthor({ updatedBy: by, updatedByName: e.updated_by_name ?? '', updatedAt: e.updated_at ?? '' });
    if (viewModeRef.current !== 'shared' || by === myLoginRef.current) return;
    const v = value ? parseTransportView(value) : EMPTY_TRANSPORT_VIEW;
    if (canonicalTransportViewJson(v) === lastViewJsonRef.current) return;
    if (trDaySelCache && trDaySelCache.size > 0) {
      applyView({ ...v, days: [...trDaySelCache] });
      return;
    }
    applyView(v);
  });

  const handleViewModeChange = useCallback(
    (mode: FlowViewMode) => {
      const login = myLoginRef.current;
      writeTransportViewMode(login, mode);
      setViewMode(mode);
      viewModeRef.current = mode;
      if (mode === 'personal') {
        const personal = readPersonalTransportView(login);
        setHasPersonalView(personal != null);
        applyView(personal ?? EMPTY_TRANSPORT_VIEW);
      } else {
        applyView(sharedValueRef.current ? parseTransportView(sharedValueRef.current) : EMPTY_TRANSPORT_VIEW);
      }
    },
    [applyView],
  );

  const handleViewReset = useCallback(
    (target: FlowViewMode) => {
      const login = myLoginRef.current;
      if (target === 'personal') {
        clearPersonalTransportView(login);
        setHasPersonalView(false);
        if (viewModeRef.current === 'personal') applyView(EMPTY_TRANSPORT_VIEW);
      } else {
        if (sharedSaveTimerRef.current != null) {
          window.clearTimeout(sharedSaveTimerRef.current);
          sharedSaveTimerRef.current = null;
        }
        if (viewModeRef.current === 'shared') applyView(EMPTY_TRANSPORT_VIEW);
        void flowTransportViewSet(api, '')
          .then((res) => {
            sharedValueRef.current = res.value;
            setHasSharedView(false);
            setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
          })
          .catch(() => undefined);
      }
    },
    [applyView],
  );

  // Один размер 10px на ВЕСЬ лист — и шапка, и тело (юзер 2026-06-12). База темы 12px;
  // здесь жмём до 10, чтобы статус/работа (ячейки-выпадашки, рисуются базовым шрифтом)
  // совпадали с остальными текст-колонками, а заголовки не были крупнее текста.
  const gridTheme = useMemo<Partial<Theme>>(
    () => ({ ...FLOW_GRID_THEME, headerFontStyle: '600 10px', baseFontStyle: '10px' }),
    [],
  );

  // Линии-разделители по ВЕРХУ строки (юзер 2026-06-12 п.12), ОПАКОВО (идемпотентно на hover):
  //  • смена ДНЯ (режим «Все дни») — жирная ОРАНЖЕВАЯ (clay приложения);
  //  • переход в блок пунктов «6+» В ПРЕДЕЛАХ одного дня — ОДНА жирная ЧЁРНАЯ (отделяет 6.x
  //    от пунктов 0–5 выше).
  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent();
      const { ctx, rect, row } = args;
      if (row <= 0) return;
      const r = viewRows[row];
      const prev = viewRows[row - 1];
      if (!r || !prev) return;
      const dayChange = prev.tdate !== r.tdate;
      const sixBoundary = !workIsSixPlus(prev.work) && workIsSixPlus(r.work);
      if (dayChange) {
        ctx.save();
        ctx.fillStyle = '#D97757'; // accent-clay — разделитель ДНЕЙ
        ctx.fillRect(rect.x, rect.y, rect.width, 2.5);
        ctx.restore();
      } else if (sixBoundary) {
        ctx.save();
        ctx.fillStyle = '#1E1E1E'; // чёрный — отделяет блок «6+» от пунктов 0–5
        ctx.fillRect(rect.x, rect.y, rect.width, 2);
        ctx.restore();
      }
    },
    [viewRows],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        {/* Отмена / Повтор правок (как в Формировании, юзер 2026-06-12) — ⌘Z / ⌘⇧Z. */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!history.canUndo}
            title="Отменить (⌘Z)"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:cursor-default disabled:opacity-35"
          >
            <Undo2 size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.canRedo}
            title="Повторить (⌘⇧Z)"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:cursor-default disabled:opacity-35"
          >
            <Redo2 size={13} strokeWidth={1.75} />
          </button>
        </div>
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={busy}
          title="Вставить из буфера: шаблон 🚚 или спец-вставка 1С (шапка со Статус/Отправление)"
          className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <ClipboardPaste size={13} strokeWidth={1.75} />
          )}
          Вставить из буфера
        </button>
        <button
          type="button"
          onClick={toggleTimeBold}
          disabled={busy}
          title="Жирный: вручную поставить/снять жирное ВРЕМЯ у выделенных строк (авто — если время ≠ норма смены)"
          className="flex h-6 items-center rounded-md border border-black/10 px-2 font-bold text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
        >
          Жирный
        </button>
        <Popover.Root open={addOpen} onOpenChange={setAddOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              title="Добавить строку транспорта на дату; гаражный можно заполнить позже"
              className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
            >
              <Plus size={13} strokeWidth={1.75} />
              Добавить
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[248px] rounded-lg border border-border-subtle bg-bg-surface p-3 shadow-lg"
            >
              <div className="flex flex-col gap-2">
                <FlowMiniCalendar value={addDate} minDate={isDev ? '2000-01-01' : cutoff} onChange={setAddDate} />
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-text-muted/70">
                  Гаражный №
                  <input
                    value={addGarage}
                    onChange={(e) => setAddGarage(e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addDate) runAdd(addDate, addGarage);
                    }}
                    list="tr-garage-pick"
                    placeholder="№ | гос | тип | водитель"
                    autoFocus
                    className="h-7 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
                  />
                  <datalist id="tr-garage-pick">
                    {garagePick.labels.map((label, i) => (
                      <option key={garagePick.options[i] ?? label} value={garagePick.options[i] ?? ''} label={label}>
                        {label}
                      </option>
                    ))}
                  </datalist>
                </label>
                <button
                  type="button"
                  disabled={!addDate || busy}
                  onClick={() => runAdd(addDate, addGarage)}
                  className="h-7 rounded-md border border-accent-clay/60 text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15 disabled:opacity-40"
                >
                  {addGarage ? `Добавить на ${fmtDay(addDate)}` : `Добавить пустую строку`}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {/* Тумблер колонки «Заказ» (№ заказа НТ…) — показать/скрыть, как инфо-колонки
            Формирования (юзер 2026-07-06). Колонка встаёт сразу после ДАТЫ. */}
        <button
          type="button"
          onClick={() => setShowOrder((v) => !v)}
          title="Показать/скрыть колонку «Заказ» (№ заказа НТ…)"
          className={cn(
            'flex h-6 items-center rounded-md border px-2 text-[12px] outline-none transition-colors',
            showOrder
              ? 'border-accent-clay/70 text-[#0A0A0A]'
              : 'border-black/10 text-[#3F3D38] hover:border-black/25 hover:text-[#0A0A0A]',
          )}
        >
          Заказ
        </button>
        {/* Печать: поповер — ТОТ ЖЕ календарь выбора дней (несколько или один), внизу
            кнопка «Печать» → печать по выбранным дням (юзер 2026-06-12). */}
        <Popover.Root
          open={printOpen}
          onOpenChange={(o) => {
            setPrintOpen(o);
            if (o) setPrintSel(new Set(daySel)); // подхватываем текущий фильтр дней
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              title="Печать листа транспорта по выбранным дням"
              className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
            >
              <Printer size={13} strokeWidth={1.75} />
              Печать
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[248px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
            >
              <FlowDayMultiPicker selected={printSel} onChange={setPrintSel} dataDays={allDaysSet} />
              <div className="mt-2 flex items-center gap-1 border-t border-border-subtle pt-2">
                <button
                  type="button"
                  onClick={() => setPrintDok((v) => !v)}
                  title="Включить в печать работы ДОК (6.x)"
                  className={cn(
                    'flex h-6 flex-1 items-center justify-center rounded-md border text-[12px] outline-none transition-colors',
                    printDok
                      ? 'border-accent-clay/60 bg-accent-clay/15 font-medium text-text-strong'
                      : 'border-border-subtle text-text-secondary hover:border-border-default hover:bg-accent-clay/10 hover:text-text-strong',
                  )}
                >
                  ДОК
                </button>
                <button
                  type="button"
                  onClick={() => setPrintOkalina((v) => !v)}
                  title="Включить в печать работы ОКАЛИНА (8.x)"
                  className={cn(
                    'flex h-6 flex-1 items-center justify-center rounded-md border text-[12px] outline-none transition-colors',
                    printOkalina
                      ? 'border-accent-clay/60 bg-accent-clay/15 font-medium text-text-strong'
                      : 'border-border-subtle text-text-secondary hover:border-border-default hover:bg-accent-clay/10 hover:text-text-strong',
                  )}
                >
                  ОКАЛИНА
                </button>
              </div>
              <button
                type="button"
                disabled={printSel.size === 0}
                onClick={() => {
                  setPrintOpen(false);
                  setPrintDays([...printSel].sort());
                }}
                className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-accent-clay/60 text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15 disabled:opacity-40"
              >
                <Printer size={12} strokeWidth={1.75} />
                Печать{printSel.size > 0 ? ` (${printSel.size})` : ''}
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {/* Поиск как в Формировании: панель-поповер с результатами по колонкам, подсветка
            и перелёт к ячейке (⌘F). НЕ фильтрует строки. Замена пока скрыта (живая база). */}
        <FlowSearchPanel
          open={gridSearch.open}
          onOpenChange={gridSearch.onOpenChange}
          query={gridSearch.query}
          onQueryChange={gridSearch.onQueryChange}
          groups={gridSearch.groups}
          totalMatches={gridSearch.totalMatches}
          active={gridSearch.activeMatch}
          onGoTo={gridSearch.goToMatch}
          onReplace={gridSearch.replaceAll}
          replaceResult={gridSearch.replaceResult}
          dimmed={gridSearch.dimmed}
          allowReplace={false}
        />
        {/* Выбор дней — наш календарь с МНОЖЕСТВЕННЫМ выбором (клик-тогл + протяжка по
            дням, юзер 2026-06-12). «Все дни» сбрасывает фильтр. */}
        <Popover.Root open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              title={
                daySel.size > 1 ? fmtDaysSummary([...daySel]) : 'Выбрать день или несколько (клик + протяжка по дням)'
              }
              className={cn(
                'flex h-6 max-w-[180px] items-center gap-1 truncate rounded-md border px-2 text-[12px] outline-none transition-colors',
                daySel.size > 0
                  ? 'border-accent-clay/70 text-[#0A0A0A]'
                  : 'border-black/10 text-[#3F3D38] hover:border-black/25',
              )}
            >
              {daySel.size === 0
                ? 'Текущий месяц'
                : daySel.size === 1
                  ? fmtDay([...daySel][0] ?? '')
                  : daySel.size <= 4
                    ? fmtDaysSummary([...daySel])
                    : `${daySel.size} дней`}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[248px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
            >
              <button
                type="button"
                onClick={() => setDaySel(new Set())}
                className={cn(
                  'mb-2 h-7 w-full rounded-md border text-[12px] transition-colors',
                  daySel.size > 0
                    ? 'border-border-subtle text-text-secondary hover:border-border-default'
                    : 'border-accent-clay/60 text-text-strong',
                )}
              >
                Текущий месяц
              </button>
              <FlowDayMultiPicker selected={daySel} onChange={setDaySel} dataDays={allDaysSet} />
              <div className="mt-1.5 px-1 text-[10.5px] leading-tight text-text-muted/60">
                Клик — выбрать день. Зажми и веди по дням — выбрать диапазон.
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {/* Вид «Общий / Личный» (filter-views) — фильтр дней (юзер 2026-06-12). */}
        <FlowViewSwitch
          mode={viewMode}
          onModeChange={handleViewModeChange}
          sharedAuthor={sharedAuthor}
          hasSharedView={hasSharedView}
          hasPersonalView={hasPersonalView}
          onReset={handleViewReset}
        />
        {msg && (
          <span className="max-w-[300px] truncate text-[11px] text-[#6B6862]" title={msg}>
            {msg}
          </span>
        )}
        <TrSelRowsActions selLive={selLive} onDelete={deleteSelected} />
      </div>
      {/* Обёртка relative + измеряемый слой `absolute inset-0` (тот же приём, что у
          скролла сайдбара). КРИТИЧНО: канвас-грид меряется ResizeObserver'ом по этому
          слою. Если мерить прямо flex-1-контейнер, широкий канвас задаёт ему min-content
          ширину → flex-элемент упирается в ширину канваса и НЕ сжимается вслед за окном:
          RO не видит изменения размера, размер не пересчитывается, контент обрезается
          вместо появления полос прокрутки. `absolute inset-0` всегда повторяет размер
          родителя независимо от своего содержимого — поэтому RO срабатывает корректно. */}
      <div className="relative min-h-0 flex-1">
        <div ref={measureRef} className="flow-grid absolute inset-0">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
              Загрузка транспорта…
            </div>
          )}
          {!loading && viewRows.length === 0 && (
            // Задача 17 (юзер уточнил): оверлей НЕ перекрывает заголовок (pointer-events-none) —
            // сброс фильтра делается в самом ▾ колонки, куда клик теперь проходит.
            <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
              {colFilters.hasAnyFilter ? (
                <span className="text-[12px]">Все строки скрыты фильтром — сбросьте его в ▾ заголовка колонки</span>
              ) : (
                <>
                  <span className="text-[14px] font-medium text-[#2A2925]">Пусто</span>
                  <span>Вставьте выгрузку из буфера.</span>
                </>
              )}
            </div>
          )}
          {size.width > 0 && size.height > 0 && (
            <FlowGridEditor
              ref={editorRef}
              gridRef={gridRef}
              theme={gridTheme}
              width={size.width}
              height={size.height}
              columns={columns}
              rows={viewRows.length}
              getCellContent={getCellContent}
              onCellEdited={onCellEdited}
              onCellActivated={onCellActivated}
              onDelete={onGridDelete}
              transformSelection={transformSelection}
              onSelectionChange={handleSelectionChange}
              onPaste={handlePaste}
              getRowThemeOverride={getRowThemeOverride}
              drawCell={drawCell}
              customRenderers={TR_RENDERERS}
              getCellsForSelection
              rowMarkers="none"
              freezeColumns={showDate ? 2 : 1}
              rowSelect="multi"
              columnSelect="none"
              rangeSelect="multi-rect"
              rowHeight={getRowHeight}
              headerHeight={22}
              highlightRegions={gridSearch.highlightRegions}
              onVisibleRegionChanged={(region) => {
                const p = trPendingRef.current;
                if (p) {
                  if ((p.row > 0 || p.col > 0)
                    && (Math.abs(region.y - p.row) > 1 || Math.abs(region.x - p.col) > 1)
                    && p.tries < 14) {
                    p.tries += 1;
                    gridRef.current?.scrollTo(p.col, p.row, 'both', 0, 0);
                  } else {
                    trPendingRef.current = null;
                    trRestoringRef.current = false;
                  }
                } else if (!trRestoringRef.current) {
                  trScrollCache = { col: region.x, row: region.y };
                }
                gridSearch.onVisibleRegionChanged(region);
              }}
              onHeaderMenuClick={colFilters.handleHeaderMenuClick}
              onKeyDown={(e) => {
                if (gridSearch.handleKey(e)) return;
                if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                  e.cancel();
                  selectAllRows();
                  return;
                }
                if (
                  (e.key === 'Delete' || e.key === 'Backspace') &&
                  selectionRef.current.rows.length > 0 &&
                  selectionRef.current.columns.length === 0
                ) {
                  e.cancel();
                  deleteSelected();
                }
              }}
              keybindings={{ search: false, delete: 'Backspace|Delete' }}
              smoothScrollX
              smoothScrollY
            />
          )}
        </div>
      </div>
      {/* Меню колонки (▾): сорт + поиск по колонке + чек-лист значений — как в Формировании.
          Объединённые колонки фильтруются по склейке «A · B» (поиск в меню сужает по любому
          под-значению). Якорится по экранным координатам заголовка (Glide). */}
      <FlowHeaderMenu
        state={colFilters.menu}
        sortDir={colFilters.menuSortDir}
        search={colFilters.menuSearch}
        values={colFilters.menuValues}
        excluded={colFilters.menuExcluded}
        onSort={colFilters.onSort}
        onSortReset={colFilters.onSortReset}
        onSearchChange={colFilters.onMenuSearchChange}
        onToggleValue={colFilters.onToggleValue}
        onClear={colFilters.onClear}
        onDeselectAll={colFilters.onDeselectAll}
        onClose={colFilters.closeMenu}
      />
      {/* Нижняя строка-метрика (юзер 2026-06-12): по показанному набору — Работ (строк) и
          Машин (уникальный гаражный); справа — всего в базе работ и дней. flex-wrap, чтобы
          в узком окне переносилось, а не обрывалось. «Строка = заказ = работа». */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        <TrSelCountLabel selLive={selLive} />
        <span className="tabular-nums">
          Показано: работ <span className="text-[#2A2925]">{viewRows.length}</span> · машин{' '}
          <span className="text-[#2A2925]">{shownVehicles}</span>
          {shownDays > 1 && (
            <>
              {' '}
              · дней <span className="text-[#2A2925]">{shownDays}</span>
            </>
          )}
        </span>
        <span className="ml-auto tabular-nums text-[#8C8983]">
          В базе: работ <span className="text-[#2A2925]">{rows.length}</span> · дней{' '}
          <span className="text-[#2A2925]">{dayCount}</span> · машин{' '}
          <span className="text-[#2A2925]">{vehicles.length}</span>
        </span>
      </div>
      {trip && (
        <TransportTripCard
          row={trip.row}
          x={trip.x}
          y={trip.y}
          onClose={() => setTrip(null)}
        />
      )}
      {specCard && (
        <VehicleSpecCard
          row={specCard.row}
          garage={specCard.garage}
          veh={specCard.veh}
          x={specCard.x}
          y={specCard.y}
          onClose={() => setSpecCard(null)}
          onGarageChange={(nextGarage) => {
            const before = specCard.row.garage_no || '';
            const after = nextGarage.trim();
            if (!after || before === after) return;
            applyFields(specCard.row.id, { garage_no: after });
            pushHistory({ id: specCard.row.id, before: { garage_no: before }, after: { garage_no: after } });
            setSpecCard(null);
          }}
        />
      )}
      {forceEdit && (
        <ForceMajorModal
          row={forceEdit.row}
          onClose={() => setForceEdit(null)}
          onSave={(next) => {
            const prev = forceEdit.row.force_json || '[]';
            if (next !== prev) {
              applyFields(forceEdit.row.id, { force_json: next });
              pushHistory({ id: forceEdit.row.id, before: { force_json: prev }, after: { force_json: next } });
            }
            setForceEdit(null);
          }}
        />
      )}
      {timeEdit && (
        <TransportTimeModal
          title={timeEdit.field === 'fact_start' ? 'Факт начало' : 'Факт конец'}
          value={timeEdit.field === 'fact_start' ? timeEdit.row.fact_start : timeEdit.row.fact_end}
          onClose={() => setTimeEdit(null)}
          onSave={(value) => {
            const field = timeEdit.field;
            const before = String((timeEdit.row as unknown as Record<string, unknown>)[field] ?? '');
            if (value !== before) {
              applyFields(timeEdit.row.id, { [field]: value });
              pushHistory({ id: timeEdit.row.id, before: { [field]: before }, after: { [field]: value } });
            }
            setTimeEdit(null);
          }}
        />
      )}
      {printDays && (
        <FlowTransportPrint
          days={[...printDays].sort()}
          rows={rows
            .filter((r) => printDays.includes(r.tdate))
            .sort(
              (a, b) =>
                (a.tdate || '').localeCompare(b.tdate || '') ||
                printStatusGroup(a.status) - printStatusGroup(b.status) ||
                workKey(a.work) - workKey(b.work) ||
                (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
                a.id - b.id,
            )}
          vehByGarage={vehByGarage}
          driverByFio={driverByFio}
          printDok={printDok}
          printOkalina={printOkalina}
          onClose={() => setPrintDays(null)}
        />
      )}
      {cardGarage !== null && (
        <VehicleCard
          garageNo={cardGarage}
          vehicle={vehByGarage.get(cardGarage) ?? null}
          onClose={() => setCardGarage(null)}
          onSaved={(veh) => {
            setVehicles((prev) => {
              const byKey = new Map(prev.map((v) => [v.garage_no, v] as const));
              byKey.set(veh.garage_no, veh);
              const next = [...byKey.values()];
              trVehCache = next;
              return next;
            });
            setCardGarage(null);
            const pending = pendingAddRef.current;
            if (pending && pending.garage === veh.garage_no) {
              pendingAddRef.current = null;
              runAdd(pending.date, pending.garage);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Мини-календарь в стиле приложения (вместо нативного date-input): месяц листается,
 * даты раньше `minDate` задизейблены (защита 7 дней). Переиспользуемый.
 */
export function FlowMiniCalendar({
  value,
  minDate,
  onChange,
}: {
  value: string;
  minDate?: string;
  onChange: (iso: string) => void;
}): JSX.Element {
  const init = /^\d{4}-(\d{2})/.exec(value);
  const [ym, setYm] = useState(() => ({
    y: init ? Number(value.slice(0, 4)) : new Date().getFullYear(),
    m: init ? Number(value.slice(5, 7)) : new Date().getMonth() + 1,
  }));
  const first = new Date(ym.y, ym.m - 1, 1);
  const startWd = (first.getDay() + 6) % 7; // ПН=0
  const daysIn = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWd }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => i + 1),
  ];
  const iso = (d: number) => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return (
    <div className="rounded-md border border-border-subtle p-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-text-strong">
          {MONTH_ABBR_RU[ym.m - 1]} {ym.y}
        </span>
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[2px] text-center text-[10px] text-text-muted/60">
        {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-[2px]">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const dIso = iso(d);
          const disabled = !!minDate && dIso < minDate;
          const selected = dIso === value;
          return (
            <button
              key={dIso}
              type="button"
              disabled={disabled}
              onClick={() => onChange(dIso)}
              className={cn(
                'rounded py-[2px] text-[11px] tabular-nums transition-colors',
                selected
                  ? 'bg-accent-clay/25 font-semibold text-text-strong'
                  : disabled
                    ? 'cursor-default text-text-muted/30'
                    : 'text-text-secondary hover:bg-accent-clay/15 hover:text-text-strong',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Календарь с МНОЖЕСТВЕННЫМ выбором дней (юзер 2026-06-12): клик по дню — тогл;
 * зажать и вести по дням — выбрать ДИАПАЗОН (range от точки нажатия до текущего,
 * заполняя пропущенные при переходе на новую строку недели). Точка под числом —
 * день, по которому есть данные. «Применение» — сразу, по ходу протяжки.
 */
export function FlowDayMultiPicker({
  selected,
  onChange,
  dataDays,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  dataDays?: Set<string>;
}): JSX.Element {
  const firstSel = [...selected].sort()[0];
  const [ym, setYm] = useState(() => {
    const base = firstSel || isoToday();
    return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) };
  });
  // Состояние протяжки: база (выбор до жеста) + якорь + был ли сдвиг.
  const drag = useRef<{ base: Set<string>; anchor: string; moved: boolean } | null>(null);
  useEffect(() => {
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const pad2 = (n: number): string => String(n).padStart(2, '0');
  const iso = (d: number): string => `${ym.y}-${pad2(ym.m)}-${pad2(d)}`;
  const rangeOf = (a: string, b: string): string[] => {
    const lo = Math.min(dayNum(a), dayNum(b));
    const hi = Math.max(dayNum(a), dayNum(b));
    const out: string[] = [];
    for (let d = lo; d <= hi; d += 1) out.push(iso(d));
    return out;
  };
  const onDown = (dIso: string): void => {
    drag.current = { base: new Set(selected), anchor: dIso, moved: false };
  };
  const onEnter = (dIso: string): void => {
    const dr = drag.current;
    if (!dr) return;
    dr.moved = true;
    const next = new Set(dr.base);
    for (const r of rangeOf(dr.anchor, dIso)) next.add(r);
    onChange(next);
  };
  const onUp = (dIso: string): void => {
    const dr = drag.current;
    if (!dr) return;
    if (!dr.moved) {
      const next = new Set(dr.base);
      if (next.has(dIso)) next.delete(dIso);
      else next.add(dIso);
      onChange(next);
    }
    drag.current = null;
  };

  const first = new Date(ym.y, ym.m - 1, 1);
  const startWd = (first.getDay() + 6) % 7; // ПН=0
  const daysIn = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWd }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => i + 1),
  ];
  return (
    <div className="select-none rounded-md border border-border-subtle p-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-text-strong">
          {MONTH_ABBR_RU[ym.m - 1]} {ym.y}
        </span>
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[2px] text-center text-[10px] text-text-muted/60">
        {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-[2px]">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const dIso = iso(d);
          const sel = selected.has(dIso);
          const hasData = dataDays?.has(dIso);
          return (
            <button
              key={dIso}
              type="button"
              onPointerDown={() => onDown(dIso)}
              onPointerEnter={() => onEnter(dIso)}
              onPointerUp={() => onUp(dIso)}
              className={cn(
                'relative rounded py-[2px] text-[11px] tabular-nums transition-colors',
                sel
                  ? 'bg-accent-clay/30 font-semibold text-text-strong'
                  : 'text-text-secondary hover:bg-accent-clay/15 hover:text-text-strong',
              )}
            >
              {d}
              {hasData && !sel && (
                <span className="absolute bottom-[1px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-accent-clay/50" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * РЕЙС — история машины за день из ОТЧЁТА: по зафиксированным поставкам с
 * ID == гаражный №: экспедиторы + склады ОТ/СП (план и факт). Склад зелёный,
 * если ХОТЬ ОДНА его поставка «увезли»; серый — всё отменено/не увезено.
 * Экспорт: Grok-разнарядка (иконка машины, не история ячеек).
 */
export function TransportTripCard({
  row,
  x,
  y,
  onClose,
}: {
  row: FlowTransportRow;
  x: number;
  y: number;
  onClose: () => void;
}): JSX.Element {
  const [dlv, setDlv] = useState<FlowDeliveryRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void flowDeliveriesGet(api, { planDate: row.tdate })
      .then((rows) => {
        if (alive) {
          setDlv(rows.filter((d) => {
            if (Number(d.fixation_id) <= 0) return false;
            const ids = String(d.ride_id || '').split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
            return ids.some((id) => id.toUpperCase() === row.garage_no.toUpperCase());
          }));
        }
      })
      .catch(() => {
        if (alive) setDlv([]);
      });
    return () => {
      alive = false;
    };
  }, [row]);

  const { exps, fromWhs, toWhs, obdCount } = useMemo(() => {
    const e = new Set<string>();
    const from = new Map<string, boolean>(); // склад → есть «выполнено»
    const to = new Map<string, boolean>();
    const obd = new Set<string>(); // §8: кол-во поставок = уникальные OBD, не строки позиций
    for (const d of dlv ?? []) {
      for (const raw of [d.exp1, d.exp2]) {
        for (const part of String(raw || '').split(/\r?\n|;/)) {
          const fio = part.trim();
          if (fio) e.add(fio);
        }
      }
      // §8: «выполнено» считаем шире «увезли» — текущая принятая логика: увезли/выполнено/есть факт.
      const ok = d.done_stat === 'увезли' || d.done_stat === 'выполнено' || d.fact_qty != null || !!(d.fact_dt || '').trim();
      if ((d.fr || '').trim()) from.set(d.fr, (from.get(d.fr) ?? false) || ok);
      if ((d.to_wh || '').trim()) to.set(d.to_wh, (to.get(d.to_wh) ?? false) || ok);
      const num = String(d.dlv || '').trim();
      if (num) obd.add(num);
    }
    const sortEntries = (m: Map<string, boolean>) => [...m.entries()].sort((a, b) => cmpWh(a[0], b[0]));
    return { exps: [...e], fromWhs: sortEntries(from), toWhs: sortEntries(to), obdCount: obd.size };
  }, [dlv]);

  const pill = ([wh, ok]: [string, boolean]) => (
    <span
      key={wh}
      className={cn(
        'rounded-full border px-1.5 py-[1px] text-[11px] tabular-nums',
        ok ? 'border-[#1F7A33]/50 bg-[#EAF5EA] text-[#1F7A33]' : 'border-black/15 bg-black/[0.04] text-[#8C8983]',
      )}
    >
      {wh}
    </span>
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} />
      <div
        className="fixed z-50 w-[min(320px,calc(100vw-24px))] -translate-x-1/2 rounded-xl border border-border-subtle bg-bg-surface p-3.5 shadow-2xl"
        style={{ left: x, top: Math.max(12, y + 4) }}
        role="dialog"
        aria-label="Рейс машины"
      >
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-strong">
          <Truck size={14} strokeWidth={1.75} className="text-accent-clay" />
          Машина {row.garage_no} · {fmtDay(row.tdate)}
        </div>
        {(row.fact_start || row.fact_end) && (
          <div className="mt-2 rounded-md border border-accent-clay/25 bg-accent-clay/10 px-2 py-1.5 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-wide text-text-muted/60">Смена факт</div>
            <div className="mt-0.5 tabular-nums">{fmtTimeRange(row.fact_start || '—')} — {fmtTimeRange(row.fact_end || '—')}</div>
          </div>
        )}
        {dlv === null && <div className="mt-2 text-[12px] text-text-muted">Загрузка…</div>}
        {dlv !== null && dlv.length === 0 && (
          <div className="mt-2 text-[12px] text-text-muted">
            В отчёте нет зафиксированных поставок с ID {row.garage_no} на этот день.
          </div>
        )}
        {dlv !== null && dlv.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 text-[12px] text-text-secondary">
            {exps.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-text-muted/60">Экспедиторы</div>
                <div>{exps.join(', ')}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted/60">Склады отгрузки</div>
              <div className="mt-0.5 flex flex-wrap gap-1">{fromWhs.map(pill)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted/60">Склады выгрузки</div>
              <div className="mt-0.5 flex flex-wrap gap-1">{toWhs.map(pill)}</div>
            </div>
            <div className="text-[10px] text-text-muted/60">
              зелёный — выполнено · серый — нет · {obdCount} поставок (уникальные OBD)
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Колесо часа/минуты — общее для Glide и Tabulator (факт нач/кон, форс-м). */
export function TransportTimeModal({
  title,
  value,
  onClose,
  onSave,
  allowClear = false,
}: {
  title: string;
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
  allowClear?: boolean;
}): JSX.Element {
  const [current, setCurrent] = useState(value || '8:00');
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-2xl">
        <div className="text-[13px] font-semibold text-text-strong">{title}</div>
        <TimeWheel value={current} onChange={setCurrent} />
        <div className="mt-2 text-center text-[18px] font-semibold tabular-nums text-text-strong">{current}</div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {allowClear && (
            <button
              type="button"
              onClick={() => onSave('')}
              className="mr-auto h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-muted transition-colors hover:text-text-strong"
            >
              Очистить
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onSave(current)}
            className="h-8 rounded-md border border-accent-clay/60 px-3 text-[12px] font-medium text-text-strong transition-colors hover:bg-accent-clay/15"
          >
            Сохранить
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Плановое «Время» — то же колесо, что у Факта, но СРАЗУ два блока: начало и
 * конец (юзер 2026-08-04). Раньше диапазон правился текстом.
 */
export function TransportTimeRangeModal({
  value,
  onClose,
  onSave,
}: {
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
}): JSX.Element {
  const parts = String(value || '').split('-');
  const [from, setFrom] = useState(() => normalizeHm(parts[0], '8:00'));
  const [to, setTo] = useState(() => normalizeHm(parts[1], '17:00'));
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-2xl">
        <div className="text-[13px] font-semibold text-text-strong">Время работы</div>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Начало</div>
            <TimeWheel value={from} onChange={setFrom} />
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Конец</div>
            <TimeWheel value={to} onChange={setTo} />
          </div>
        </div>
        <div className="mt-2 text-center text-[18px] font-semibold tabular-nums text-text-strong">
          {from} – {to}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onSave('')}
            className="mr-auto h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-muted transition-colors hover:text-text-strong"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onSave(`${from}-${to}`)}
            className="h-8 rounded-md border border-accent-clay/60 px-3 text-[12px] font-medium text-text-strong transition-colors hover:bg-accent-clay/15"
          >
            Сохранить
          </button>
        </div>
      </div>
    </>
  );
}

/** «8», «8:5», «08:05» → «8:05»; мусор → fallback. */
function normalizeHm(raw: string | undefined, fallback: string): string {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return fallback;
  const { h, m: minute } = parseHmValue(`${m[1]}:${String(m[2] ?? '0').padStart(2, '0')}`, fallback);
  return hmValue(h, minute);
}

function TimeWheel({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  const { h, m } = parseHmValue(value);
  const hourRef = useRef<HTMLDivElement | null>(null);
  const minuteRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const center = (el: HTMLDivElement | null, selected: string): void => {
      const item = el?.querySelector<HTMLElement>(`[data-v="${selected}"]`);
      if (!el || !item) return;
      el.scrollTop = item.offsetTop - el.clientHeight / 2 + item.clientHeight / 2;
    };
    center(hourRef.current, String(h));
    center(minuteRef.current, String(m));
  }, [h, m]);
  const col = (items: number[], selected: number, unit: 'h' | 'm', ref: RefObject<HTMLDivElement>) => (
    <div className="relative flex-1">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-8 -translate-y-1/2 rounded-md border border-accent-clay/45 bg-accent-clay/10" />
      <div ref={ref} className="h-40 overflow-y-auto rounded-md border border-border-subtle bg-black/[0.02] py-16">
        {items.map((x) => {
          const active = x === selected;
          return (
            <button
              key={x}
              type="button"
              data-v={x}
              onClick={() => onChange(unit === 'h' ? hmValue(x, m) : hmValue(h, x))}
              className={`block h-8 w-full text-center text-[15px] tabular-nums transition-colors ${
                active ? 'font-semibold text-text-strong' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {unit === 'h' ? x : String(x).padStart(2, '0')}
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="mt-3">
      <div className="mb-1 grid grid-cols-[1fr_18px_1fr] px-1 text-center text-[10px] uppercase tracking-wide text-text-muted/70">
        <span>Час</span>
        <span />
        <span>Мин</span>
      </div>
      <div className="grid grid-cols-[1fr_18px_1fr] items-center">
        {col(TIME_WHEEL_HOURS, h, 'h', hourRef)}
        <div className="text-center text-[18px] font-semibold text-text-muted">:</div>
        {col(TIME_WHEEL_MINUTES, m, 'm', minuteRef)}
      </div>
    </div>
  );
}

/** Модалка ФОРС М (несколько записей + время) — общая для Glide и Tabulator. */
export function ForceMajorModal({
  row,
  onClose,
  onSave,
}: {
  row: FlowTransportRow;
  onClose: () => void;
  onSave: (json: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<ForceDraft[]>(() => {
    const parsed = parseForceDrafts(row.force_json || '[]');
    return parsed.length ? parsed : [{ reason: 'ожидание выгрузки', start: row.fact_start || '8:00', end: '', comment: '' }];
  });
  const [timePicker, setTimePicker] = useState<{ idx: number; field: 'start' | 'end'; title: string } | null>(null);
  const update = (idx: number, patch: Partial<ForceDraft>): void => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] flex max-h-[82vh] w-[620px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-subtle bg-bg-surface p-4 text-[12px] shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-text-strong">ФОРС М · машина {row.garage_no || '—'}</div>
            <div className="mt-0.5 text-[11px] text-text-muted/70">{fmtDay(row.tdate)} · {row.work || 'без работы'}</div>
          </div>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { reason: 'ожидание выгрузки', start: row.fact_start || '8:00', end: '', comment: '' }])}
            className="h-8 rounded-md border border-accent-clay/50 px-3 text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15"
          >
            Добавить
          </button>
        </div>
        <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
          {items.map((it, idx) => (
            <div key={idx} className="rounded-md border border-border-subtle p-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={it.reason}
                  onChange={(e) => update(idx, { reason: e.target.value })}
                  className="h-8 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
                >
                  {FORCE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setTimePicker({ idx, field: 'start', title: 'ФОРС М начало' })}
                  className="h-8 rounded-md border border-border-subtle px-2 text-[12px] tabular-nums text-text-primary transition-colors hover:border-accent-clay/60"
                >
                  с {it.start || '—'}
                </button>
                <button
                  type="button"
                  onClick={() => setTimePicker({ idx, field: 'end', title: 'ФОРС М окончание' })}
                  className="h-8 rounded-md border border-border-subtle px-2 text-[12px] tabular-nums text-text-primary transition-colors hover:border-accent-clay/60"
                >
                  по {it.end || '—'}
                </button>
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  className="ml-auto h-8 rounded-md border border-danger/35 px-2 text-[12px] text-danger transition-colors hover:bg-danger/10"
                >
                  Удалить
                </button>
              </div>
              <textarea
                value={it.comment}
                onChange={(e) => update(idx, { comment: e.target.value })}
                placeholder="Комментарий причины"
                className="mt-2 h-16 w-full resize-none rounded-md border border-border-subtle bg-transparent px-2 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
              />
            </div>
          ))}
          {items.length === 0 && <div className="rounded-md border border-border-subtle p-3 text-text-muted">Форс-мажоры не указаны.</div>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onSave(forceDraftsToJson(items))}
            className="h-8 rounded-md border border-accent-clay/60 px-3 text-[12px] font-medium text-text-strong transition-colors hover:bg-accent-clay/15"
          >
            Сохранить
          </button>
        </div>
      </div>
      {timePicker && (
        <TransportTimeModal
          title={timePicker.title}
          value={items[timePicker.idx]?.[timePicker.field] || '8:00'}
          allowClear={timePicker.field === 'end'}
          onClose={() => setTimePicker(null)}
          onSave={(value) => {
            update(timePicker.idx, { [timePicker.field]: value });
            setTimePicker(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Карточка характеристик машины (двойной клик по №·ГОС) — как карточка MAT в формировании.
 * Вверху: замена гаражного; ниже: данные 1С / ТС. Общая для Glide и Tabulator.
 */
export function VehicleSpecCard({
  row,
  garage,
  veh,
  x,
  y,
  onClose,
  onGarageChange,
}: {
  row: FlowTransportRow;
  garage: string;
  veh: FlowVehicle | null;
  /** Центр/якорь; если не заданы — по центру экрана. */
  x?: number;
  y?: number;
  onClose: () => void;
  onGarageChange: (garage: string) => void;
}): JSX.Element {
  const [nextGarage, setNextGarage] = useState(row.garage_no || garage);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ourCapacityKg = adjustedBodyTypeCapacityKg(row.vehicle_type || '', {
    capacityKg: veh?.capacity_kg ?? null,
    maxMassKg: veh?.max_mass_kg ?? null,
  });
  const centered = x == null || y == null;
  const tryCommit = (): void => {
    const after = nextGarage.trim();
    const before = (row.garage_no || garage).trim();
    if (!after || after === before) {
      onClose();
      return;
    }
    setConfirmOpen(true);
  };
  const Row = ({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }): JSX.Element => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-text-muted/60">{label}</span>
      <span className={cn('tabular-nums', strong ? 'font-semibold text-text-strong' : muted ? 'text-text-muted/80' : 'text-text-secondary')}>
        {value || '—'}
      </span>
    </div>
  );
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className={
          centered
            ? 'fixed left-1/2 top-1/2 z-50 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle bg-bg-elevated p-3.5 text-[12px] shadow-2xl'
            : 'fixed z-50 w-[252px] -translate-x-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-xl'
        }
        style={centered ? undefined : { left: x, top: (y ?? 0) + 4 }}
      >
        <div className="flex items-baseline gap-2 text-[12px] font-medium text-text-strong">
          Машина {garage}
          {veh?.gos_no && <span className="tabular-nums text-text-muted">{veh.gos_no}</span>}
        </div>
        <label className="mt-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-muted/60">
          Заменить гаражный
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={nextGarage}
            onChange={(e) => setNextGarage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                tryCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            className="h-8 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] normal-case tabular-nums text-text-primary outline-none focus:border-accent-clay/60"
          />
        </label>
        {!veh ? (
          <div className="mt-2 text-[12px] text-text-muted">Машины {garage} нет в базе.</div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            <Row label="Тип ТС" value={row.vehicle_type ?? ''} />
            <Row label="Категория 1С" value={veh.vtype ?? ''} muted />
            {veh.model && <Row label="Модель" value={veh.model} />}
            <Row label="Грузоподъёмность" value={ourCapacityKg != null ? `${tons(ourCapacityKg)} т` : ''} strong />
            <Row label="Тн (грузоп.)" value={veh.capacity_kg != null ? `${tons(veh.capacity_kg)} т` : ''} muted />
            <Row label="Доп. тн" value={veh.max_mass_kg != null ? `${tons(veh.max_mass_kg)} т` : ''} muted />
            <Row label="Длина" value={veh.len_mm != null ? `${meters(veh.len_mm)} м` : ''} />
            <Row label="Ширина" value={veh.wid_mm != null ? `${meters(veh.wid_mm)} м` : ''} />
            <Row label="Высота от площадки" value={veh.hei_mm != null ? `${meters(veh.hei_mm)} м` : ''} />
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-border-subtle px-2.5 text-[11.5px] text-text-secondary hover:text-text-strong"
          >
            Закрыть
          </button>
          <button
            type="button"
            onClick={tryCommit}
            className="h-7 rounded-md border border-accent-clay/50 bg-accent-clay/15 px-2.5 text-[11.5px] font-medium text-text-strong hover:bg-accent-clay/25"
          >
            Применить
          </button>
        </div>
      </div>
      {confirmOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50" onClick={() => setConfirmOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-[70] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle bg-bg-elevated p-4 shadow-2xl">
            <div className="text-[13px] font-semibold text-text-strong">Заменить гаражный?</div>
            <div className="mt-2 text-[12.5px] tabular-nums text-text-secondary">
              <span className="text-text-muted">{(row.garage_no || garage).trim() || '—'}</span>
              <span className="mx-2 text-text-muted">→</span>
              <span className="font-semibold text-accent-clay">{nextGarage.trim()}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary hover:text-text-strong"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  onGarageChange(nextGarage.trim());
                }}
                className="h-8 rounded-md border border-accent-clay/50 bg-accent-clay/20 px-3 text-[12px] font-medium text-text-strong hover:bg-accent-clay/30"
              >
                Да, заменить
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

void whKey; // (резерв: ключ склада для будущих сортировок)

// ── Анти-лаг: счётчики выделения — мелкие подписчики LiveValue (tick протяжки
// ре-рендерит только их, монолит Транспорта стоит неподвижно). ──

/** Тулбар: «Выбрано: N» + кнопка удаления выделенных строк. */
const TrSelRowsActions = memo(function TrSelRowsActions({
  selLive,
  onDelete,
}: {
  selLive: LiveValue<GridSelection>;
  onDelete: () => void;
}) {
  const selection = useLiveValue(selLive);
  const n = selection.rows.length;
  if (n === 0) return null;
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="tabular-nums text-[#2A2925]">Выбрано: {n}</span>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
      >
        <Trash2 size={13} strokeWidth={1.75} />
        Удалить
      </button>
    </div>
  );
});

/** Нижняя строка-метрика: «Выбрано: N» (слева от «Показано»). */
const TrSelCountLabel = memo(function TrSelCountLabel({ selLive }: { selLive: LiveValue<GridSelection> }) {
  const selection = useLiveValue(selLive);
  const n = selection.rows.length;
  if (n === 0) return null;
  return (
    <span>
      Выбрано: <span className="tabular-nums text-[#2A2925]">{n}</span>
    </span>
  );
});
