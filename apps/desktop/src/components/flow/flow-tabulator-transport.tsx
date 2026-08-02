import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { TabulatorFull as Tabulator, type ColumnDefinition, type CellComponent, type RowComponent } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import './flow-tabulator-themes.css';
import '@/components/pyn-table/pyn-table-theme.css';
import { pynStatusBadgeHtml, pynMonoHtml, type PynTableTheme } from '@/components/pyn-table';
import {
  flowTransportGet,
  flowVehiclesGet,
  flowTransportEdit,
  flowTransportAdd,
  flowTransportDelete,
  flowTransportPaste,
  flowTransportViewGet,
  flowTransportViewSet,
  flowTransportHistoryGet,
  isTransport1cPaste,
  parseTransport1cPaste,
  parseTransportPaste,
  type FlowTransportRow,
  type FlowVehicle,
  type FlowTransportHistoryEntry,
} from '@pyn/core';
import {
  workKey,
  printStatusGroup,
  vehicleBrand,
  fmtDaysSummary,
  fmtDay,
  fmtTimeRange,
  forceSummary,
  ForceMajorModal,
  TransportTimeModal,
  VehicleSpecCard,
} from './FlowTransportGrid';
import { FlowTransportPrint } from './FlowTransportPrint';
import { TransportMachineSheet } from './TransportMachineSheet';
import { PynCalendar } from '@/components/pyn-table/PynCalendar';
import { FlowDriverPickPopover } from './flow-driver-pick-popover';
import { shouldShowTimeBold } from './flow-transport-shift';
import { formatMonthRu, nearestDataDay, rowHasActivity } from './flow-transport-kpi';
import { BODY_TYPES } from './flow-body-types';
import * as Popover from '@radix-ui/react-popover';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/token-store';
import { useProdCalendarStore } from '@/lib/prod-calendar';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';
import { formatMobilePhone, molStatusKind } from '@/lib/mol-format';
import { FlowColumnsMenu, type FlowColumnToggle } from './FlowColumnsMenu';
import { FlowViewSwitch } from './FlowViewSwitch';
import type { FlowViewMode } from './flow-view';
import { VehicleCard } from './VehicleCard';
import {
  Bold,
  Italic,
  Palette,
  PaintBucket,
  Printer,
  FileDown,
  History,
  Truck,
  Plus,
  Trash2,
  ClipboardPaste,
  Search,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Copy,
  CalendarDays,
} from 'lucide-react';

/**
 * Tabulator-движок Транспорта (юзер 2026-08-01+). Данные/бэкенд — наши
 * (flowTransportGet/Edit/Paste/…); Tabulator — только рендер + фильтры/меню.
 *
 * theme:
 *  - classic — светлый лист 1:1 с Flow (сортировка зафиксирована как в glide)
 *  - grok — pyn-table HUD: сортировка по колонкам, header-фильтры, glass-меню,
 *    laser-hover. Дашборд — отдельная вкладка в FlowTransportGrok, не здесь.
 *
 * ⚠️ live WS flow_transport_changed — пока без подписки (рефреш вручную).
 */

export interface FlowTabulatorTransportProps {
  /** classic = светлый Flow; grok = dark glass HUD. */
  theme?: PynTableTheme;
  /**
   * Слот слева в chrome-строке (вкладки Разнарядка|Дашборд) — одна панель с тулбарами,
   * без второй полосы (юзер 2026-08-02).
   */
  chromeLeading?: ReactNode;
}

interface Row {
  id: number;
  row_version: number;
  tdate: string;
  order_no: string;
  status: string;
  work: string;
  vehicle_type: string;
  time_range: string;
  time_bold: number;
  fact_start: string;
  fact_end: string;
  /** Сводка для отображения. */
  force: string;
  /** JSON форс-мажоров (как в Glide). */
  force_json: string;
  brand: string;
  color: string;
  garage_no: string;
  gos_no: string;
  out_status: string;
  driver: string;
  driver_phone: string;
  no_exp: boolean;
  comment: string;
}

interface HistoryEntry {
  rowId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  at: string;
  who: string;
}

type CellStyle = { bold?: boolean; italic?: boolean; color?: string; bg?: string };

interface TabViewState {
  facets: Record<string, string[]>;
  search: string;
  /** Скрытые field'ы (toggleable). */
  hiddenCols: string[];
  /** Порядок field'ов слева направо (toggleable). */
  colOrder?: string[];
  days?: string[];
  monthScope?: string | null;
}

/** Колонки, которые юзер может скрыть/переставить (не id / rank). */
const TOGGLEABLE_COLS: FlowColumnToggle[] = [
  { id: 'tdate', title: 'Дата' },
  { id: 'order_no', title: 'Заказ' },
  { id: 'status', title: 'Статус' },
  { id: 'work', title: 'Работа' },
  { id: 'vehicle_type', title: 'Тип ТС' },
  { id: 'time_range', title: 'Время' },
  { id: 'fact_start', title: 'Факт нач' },
  { id: 'fact_end', title: 'Факт кон' },
  { id: 'force', title: 'Форс-мажор' },
  { id: 'brand', title: 'Марка' },
  { id: 'garage_no', title: '№ · ГОС' },
  { id: 'out_status', title: 'Выезд' },
  { id: 'driver', title: 'Водитель' },
  { id: 'no_exp', title: 'Без эксп.' },
  { id: 'comment', title: 'Комментарий' },
];
const TOGGLEABLE_IDS = new Set(TOGGLEABLE_COLS.map((c) => c.id));
/** Как Glide: «Заказ» скрыт по умолчанию, остальное видно. */
const DEFAULT_HIDDEN = new Set<string>(['order_no']);
const DEFAULT_VISIBLE = new Set(TOGGLEABLE_COLS.filter((c) => !DEFAULT_HIDDEN.has(c.id)).map((c) => c.id));
const DEFAULT_COL_ORDER = TOGGLEABLE_COLS.map((c) => c.id);

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

/** Выставить порядок toggleable-колонок (системные id/rank остаются слева скрытыми). */
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

interface FacetDef {
  field: 'status' | 'vehicle_type' | 'force' | 'out_status';
  title: string;
}
const FACET_DEFS: FacetDef[] = [
  { field: 'status', title: 'Статус' },
  { field: 'vehicle_type', title: 'Тип ТС' },
  { field: 'force', title: 'Форс-мажор' },
  { field: 'out_status', title: 'Выезд' },
];

const STATUS_OPTIONS = ['Размещен', 'Дополнение', 'Отклонен', 'Отмена', 'Не приехал', 'Новый', 'Открыт'];
const OUT_OPTIONS = ['', 'ДА', 'НЕТ'];
const PERSONAL_VIEW_KEY = 'pyn:flow-transport-tabulator:personal-view';

function styleKey(rowId: number, field: string): string {
  return `${rowId}:${field}`;
}
/** Серверная метка kind → коротко по-русски. */
function historyKindLabel(kind: string): string {
  if (kind === 'edit') return 'правка';
  if (kind === 'paste') return 'вставка';
  if (kind === 'paste_auto') return 'авто';
  if (kind === 'add') return 'добавлено';
  return '';
}

/** «2 авг · 14:30» — без технических id. */
function fmtHistWhen(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const dd = d.getDate();
  const mo = months[d.getMonth()] ?? '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${mo} · ${hh}:${mm}`;
}

function fmtHistValue(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return 'пусто';
  if (s.length > 80) return `${s.slice(0, 78)}…`;
  return s;
}

/** День недели ПН…ВС (для колонки Дата). */
const DOW_RU = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'] as const;

/** Дата в UI: «ПН · сентябрь 30» — день недели + месяц + число. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m?.[1] || !m[2] || !m[3]) return fmtDay(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return fmtDay(iso);
  const wd = DOW_RU[d.getDay()] ?? '';
  return `${wd} · ${fmtDay(iso)}`;
}

/** Поле → заголовок колонки для истории строки. */
function fieldTitle(field: string): string {
  if (field === '(строка)') return 'строка';
  if (field === 'no_exp_status' || field === 'no_exp') return 'Без эксп.';
  if (field === 'force_json' || field === 'force') return 'Форс-мажор';
  const hit = TOGGLEABLE_COLS.find((c) => c.id === field);
  if (hit) return hit.title;
  if (field === 'tdate') return 'Дата';
  return field;
}
function editCutoffIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Перерисовать формарттеры без полной пересборки DOM. `table.redraw(true)` ломал
 * активное выделение диапазона (Tabulator падал: "Cannot read properties of
 * undefined (reading 'remove')" — юзер 2026-08-01, «ничего нет»). `row.reformat()`
 * безопаснее — это официальный способ Tabulator перечитать formatter без пересборки. */
function safeReformatAll(table: Tabulator | null): void {
  if (!table) return;
  for (const row of table.getRows()) row.reformat();
}

/** Сохранить scroll tableholder на время setFilter/setSort — иначе при фильтре
 * и пересортировке «проваливаемся» не туда (юзер 2026-08-02). */
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

/** Поиск по всем колонкам таблицы (заказ, статус, работа, ТС, гараж, водитель…). */
function rowSearchHaystack(data: Row): string {
  return [
    data.tdate,
    fmtDate(data.tdate),
    data.order_no,
    data.status,
    data.work,
    data.vehicle_type,
    data.time_range,
    data.fact_start,
    data.fact_end,
    data.force,
    data.brand,
    data.color,
    data.garage_no,
    data.gos_no,
    data.out_status,
    data.driver,
    data.driver_phone,
    data.comment,
    data.no_exp ? 'без эксп да' : '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Поля, которые Del/Backspace очищает; после range-paste — batch save.
 * Copy/paste: SelectRange + Export/Clipboard Tabulator; в Electron/Mac OS-буфер
 * через navigator.clipboard (execCommand в ядре часто мёртв) — не «свой формат данных».
 * tdate: paste/календарь; Del дату не стирает. brand — clipboard:false (из машины).
 */
const CLEARABLE_FIELDS = new Set([
  'order_no',
  'status',
  'work',
  'vehicle_type',
  'time_range',
  'fact_start',
  'fact_end',
  'force',
  'out_status',
  'driver',
  'garage_no',
  'no_exp',
  'comment',
]);
/** Поля, которые пишем на API после paste. garage_no → сервер тянет 1С-хвост. */
const PASTE_SAVE_FIELDS = new Set([...CLEARABLE_FIELDS, 'tdate']);
/** Протяжка — кроме force (модалка) ; driver/garage — особый fill. */
const FILLABLE_FIELDS = new Set([
  'order_no',
  'status',
  'work',
  'vehicle_type',
  'time_range',
  'fact_start',
  'fact_end',
  'out_status',
  'driver',
  'garage_no',
  'no_exp',
  'comment',
  'tdate',
]);

/** Разделитель ФИО↔телефон / гараж↔гос в одной ячейке clipboard (невидим в TSV). */
const CLIP_UNIT = '\u001f';

/** Разбор даты из date-input / paste: ISO или DD.MM.YYYY / YYYY/MM/DD. */
function parseTdateInput(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1]!.padStart(2, '0');
    const mm = dmy[2]!.padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const ymd = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(s);
  if (ymd) {
    return `${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`;
  }
  return null;
}

/** ФИО + телефон из accessorClipboard / paste. */
function parseDriverClip(raw: string): { driver: string; phone: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { driver: '', phone: '' };
  if (s.includes(CLIP_UNIT)) {
    const [d, p] = s.split(CLIP_UNIT);
    return { driver: (d ?? '').trim(), phone: (p ?? '').trim() };
  }
  if (s.includes('||')) {
    const i = s.indexOf('||');
    return { driver: s.slice(0, i).trim(), phone: s.slice(i + 2).trim() };
  }
  // «Иванов +7 900…» / хвост с цифрами
  const m = s.match(/^(.*?)(\+?\d[\d\s\-()]{9,})\s*$/);
  if (m?.[1] != null && m[2]) {
    return { driver: m[1].trim(), phone: m[2].replace(/[^\d+]/g, '') };
  }
  return { driver: s, phone: '' };
}

/** Гаражный из paste (только номер; гос/марка с машины). */
function parseGarageClip(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.includes(CLIP_UNIT)) return (s.split(CLIP_UNIT)[0] ?? '').trim();
  // «366 A123BC77» → 366
  const head = s.split(/\s+/)[0] ?? '';
  return head.trim();
}

/** Wire-поля для очистки одной tabulator-колонки (force → force_json, no_exp → no_exp_status). */
function clearWireFields(field: string): Record<string, string | number | null> | null {
  if (!CLEARABLE_FIELDS.has(field)) return null;
  if (field === 'no_exp') return { no_exp_status: '' };
  if (field === 'force') return { force_json: '[]' };
  if (field === 'driver') return { driver: '', driver_phone: '' };
  if (field === 'garage_no') return { garage_no: '' };
  return { [field]: '' };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * Порядок строк 1:1 Glide baseRows + правило «пустая новая сверху»:
 * день свежий сверху → строки без РАБОТЫ (только что добавили) выше →
 * красные статусы → workKey → гараж → id.
 * После заполнения «Работа» строка встаёт в канон-порядок.
 */
function cmpTransportRows(a: Row, b: Row): number {
  const byDate = (b.tdate || '').localeCompare(a.tdate || '');
  if (byDate !== 0) return byDate;
  const aEmpty = !(a.work || '').trim();
  const bEmpty = !(b.work || '').trim();
  if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;
  // Несколько пустых: свежедобавленные (больший id) выше.
  if (aEmpty && bEmpty) return b.id - a.id;
  return (
    printStatusGroup(a.status) - printStatusGroup(b.status) ||
    workKey(a.work) - workKey(b.work) ||
    (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
    a.id - b.id
  );
}

/**
 * Дата для «+ строка»:
 * 1) день строки, на которой «сидим» (фокус);
 * 2) один выбранный день;
 * 3) multi / месяц — верх видимого списка (topVisibleTdate) или max day / конец месяца.
 */
function resolveAddDate(
  daySel: ReadonlySet<string>,
  monthScope: string | null,
  currentMonthPrefix: string,
  sitTdate: string | null,
  topVisibleTdate: string | null,
): string {
  if (sitTdate && /^\d{4}-\d{2}-\d{2}$/.test(sitTdate)) return sitTdate;
  if (daySel.size === 1) return [...daySel][0]!;
  if (topVisibleTdate && /^\d{4}-\d{2}-\d{2}$/.test(topVisibleTdate)) return topVisibleTdate;
  if (daySel.size > 1) {
    return [...daySel].sort((a, b) => b.localeCompare(a))[0]!;
  }
  const ym = monthScope ?? currentMonthPrefix;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (todayIso.slice(0, 7) === ym) return todayIso;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Смена ДАТЫ строки — наш календарь (PynCalendar), не нативный `<input type=date>`
 * (тот «проваливался», нужно было выбирать дважды — юзер 2026-08-02). Тот же
 * chrome-паттерн, что TransportTimeModal (FlowTransportGrid.tsx): backdrop +
 * центрированная карточка. Один клик по дню — сразу сохраняет и закрывает.
 */
function TransportDateModal({
  value,
  onClose,
  onSave,
}: {
  value: string;
  onClose: () => void;
  onSave: (iso: string) => void;
}): JSX.Element {
  const [sel, setSel] = useState<Set<string>>(() => new Set(value ? [value] : []));
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-2xl">
        <div className="mb-2 text-[13px] font-semibold text-text-strong">Дата</div>
        <PynCalendar
          selected={sel}
          onChange={(next) => {
            setSel(next);
            // Один день выбран (клик, не «Все дни») → сразу применяем.
            if (next.size === 1) {
              const iso = [...next][0];
              if (iso) onSave(iso);
            }
          }}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border-subtle px-3 text-[12px] text-text-secondary transition-colors hover:text-text-strong"
          >
            Отмена
          </button>
        </div>
      </div>
    </>
  );
}

export function FlowTabulatorTransport({
  theme = 'classic',
  chromeLeading,
}: FlowTabulatorTransportProps = {}): JSX.Element {
  const isGrok = theme === 'grok';
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<Tabulator | null>(null);
  const stylesRef = useRef<Map<string, CellStyle>>(new Map());
  const historyMapRef = useRef<Map<string, HistoryEntry[]>>(new Map());
  const loginRef = useRef<string>('');
  const isDevRef = useRef(false);
  const vehiclesRef = useRef<FlowVehicle[]>([]);
  const rowsByIdRef = useRef<Map<number, Row>>(new Map());
  const cutoffRef = useRef(editCutoffIso());
  /**
   * Последняя кликнутая/активная ячейка — для корзины «стою на строке» и Del
   * без range (selectableRows=false, range-only selection).
   */
  const lastFocusRef = useRef<{ rowId: number; field: string } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Лог сообщений (юзер 2026-08-02: инлайн-текст между панелями ломал раскладку кнопок) —
  // вместо растущего текста копим историю, кнопка открывает поповер со списком + копированием.
  const msgIdRef = useRef(0);
  const [msgLog, setMsgLog] = useState<{ id: number; text: string; ts: number }[]>([]);
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgFlash, setMsgFlash] = useState(false);
  const msgLogRef = useRef<HTMLDivElement | null>(null);
  const setMsg = useCallback((text: string) => {
    if (!text) return;
    msgIdRef.current += 1;
    setMsgLog((log) => [{ id: msgIdRef.current, text, ts: Date.now() }, ...log].slice(0, 40));
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
  const [historyPanel, setHistoryPanel] = useState<{ rowId: number; field: string } | 'all' | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  /** Серверная история конкретной ячейки (право-клик) — «как в Google», переживает рестарт/видна всем. */
  const [serverHistory, setServerHistory] = useState<{
    rowId: number;
    field: string;
    loading: boolean;
    entries: FlowTransportHistoryEntry[];
  } | null>(null);
  const [activeGarageCard, setActiveGarageCard] = useState<{ garageNo: string; veh: FlowVehicle | null } | null>(null);
  const [forceEdit, setForceEdit] = useState<Row | null>(null);
  /** Факт нач/кон — колесо времени как Glide TransportTimeModal. */
  const [timeEdit, setTimeEdit] = useState<{ row: Row; field: 'fact_start' | 'fact_end' } | null>(null);
  /** Смена ДАТЫ строки — наш календарь (TransportDateModal), не нативный date-picker. */
  const [dateEdit, setDateEdit] = useState<Row | null>(null);
  /** Карточка гаражного (как Glide VehicleSpecCard): замена + данные 1С. */
  const [garageSpec, setGarageSpec] = useState<Row | null>(null);
  /** Выбор водителя с поиском сверху (как Glide FlowDriverEditor). */
  const [driverPick, setDriverPick] = useState<Row | null>(null);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => new Set(DEFAULT_VISIBLE));
  const [colOrder, setColOrder] = useState<string[]>(() => [...DEFAULT_COL_ORDER]);
  const [reorderOn, setReorderOn] = useState(false);
  const [viewMode, setViewMode] = useState<FlowViewMode>('personal');
  const [sharedAuthor, setSharedAuthor] = useState({ updatedBy: '', updatedByName: '', updatedAt: '' });
  const [hasSharedView, setHasSharedView] = useState(false);
  const [hasPersonalView, setHasPersonalView] = useState(false);
  /** По умолчанию скрыта (юзер 2026-08-02). */
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [facetOptions, setFacetOptions] = useState<Record<string, string[]>>({});
  const [facetSelected, setFacetSelected] = useState<Record<string, Set<string>>>({});
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(FACET_DEFS.map((f) => f.field)));
  const [allRows, setAllRows] = useState<Row[]>([]);
  // Выбор дней: daySel (конкретные дни) ИЛИ monthScope (весь YYYY-MM).
  // Пусто + null scope → текущий месяц. Можно открыть любой месяц, где есть данные.
  const [daySel, setDaySel] = useState<Set<string>>(new Set());
  /** YYYY-MM или null (= текущий календарный месяц). */
  const [monthScope, setMonthScope] = useState<string | null>(null);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const currentMonthPrefix = useMemo(() => new Date().toISOString().slice(0, 7), []);
  // Только дни с реальным планом/фактом (юзер 2026-08-02: пустые строки без времени
  // не должны подсвечиваться как «есть машина»).
  const allDaysSet = useMemo(
    () => new Set(allRows.filter(rowHasActivity).map((r) => r.tdate).filter(Boolean)),
    [allRows],
  );
  // По умолчанию — самый актуальный день, а не весь текущий месяц (юзер 2026-08-02:
  // «если 2-е число, а машин нет, покажет 3-е»). Один раз, после первой загрузки строк;
  // выбор юзера дальше не трогаем.
  const smartDefaultRef = useRef(false);
  useEffect(() => {
    if (smartDefaultRef.current || allRows.length === 0) return;
    smartDefaultRef.current = true;
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    const d = nearestDataDay(allDaysSet, today);
    if (d) setDaySel(new Set([d]));
  }, [allRows.length, allDaysSet]);
  const prodCalByYear = useProdCalendarStore((st) => st.byYear);
  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);
  // is_mol по ФИО (ВСЕ МОЛы, не только с должностью «водитель» — ТЗ 17.07 п.14,
  // 1:1 с glide molFlagByFio в FlowTransportGrid.tsx) — источник бейджа «МОЛ».
  const molFlagByFio = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const m = new Map<string, { isMol: true; color: string }>();
    for (const p of persons) {
      if (!p.isMol || !p.fio.trim()) continue;
      const rec = { isMol: true as const, color: COLOR[molStatusKind(p.status || '')] };
      m.set(p.fio, rec);
      m.set(p.fio.toUpperCase(), rec);
    }
    return m;
  }, [persons]);
  // Кандидаты в водители — база контактов, должность содержит «водитель» (1:1 с glide
  // driverOptions/driverByFio). ПРЕЖДЕ список брался из уже введённых значений строк/
  // машин — не база, а «что когда-то напечатали» (юзер 2026-08-01: «берёт не тот»).
  const driverOptions = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const out: { fio: string; phone: string; color: string; isMol: boolean }[] = [];
    for (const p of persons) {
      if (!/(?:^|[^а-яёa-z])водител/i.test(p.position || '')) continue;
      out.push({ fio: p.fio, phone: p.mobile || p.work || '', color: COLOR[molStatusKind(p.status || '')], isMol: p.isMol });
    }
    out.sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    return out;
  }, [persons]);
  const driverByFio = useMemo(() => {
    const m = new Map<string, (typeof driverOptions)[number]>();
    for (const o of driverOptions) m.set(o.fio.toUpperCase(), o);
    for (const o of driverOptions) if (!m.has(o.fio)) m.set(o.fio, o);
    return m;
  }, [driverOptions]);
  // Рефы под формарттеры/editorParams Tabulator: колонки строятся один раз в
  // useEffect([]) при монтировании — если читать эти значения напрямую из замыкания,
  // попадём в ловушку «список пуст, пока не подгрузится» (юзер 2026-08-01).
  const prodCalRef = useRef(prodCalByYear);
  const molFlagByFioRef = useRef(molFlagByFio);
  const driverOptionsRef = useRef(driverOptions);
  const driverByFioRef = useRef(driverByFio);
  useEffect(() => {
    prodCalRef.current = prodCalByYear;
    molFlagByFioRef.current = molFlagByFio;
    driverOptionsRef.current = driverOptions;
    driverByFioRef.current = driverByFio;
    safeReformatAll(tableRef.current);
  }, [prodCalByYear, molFlagByFio, driverOptions, driverByFio]);

  const columnToggles = TOGGLEABLE_COLS;

  const rowLocked = useCallback((r: Row) => !isDevRef.current && r.tdate < cutoffRef.current, []);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const key = styleKey(entry.rowId, entry.field);
    const list = historyMapRef.current.get(key) ?? [];
    historyMapRef.current.set(key, [entry, ...list].slice(0, 50));
    setHistoryTick((t) => t + 1);
  }, []);

  /** Id строки из текущего range / фокуса (для кнопки «История» в панели). */
  const getFocusedRowId = useCallback((): number | null => {
    const table = tableRef.current;
    if (!table) return null;
    try {
      if (typeof table.getRanges === 'function') {
        for (const range of table.getRanges()) {
          const cells = range.getCells().flat() as CellComponent[];
          const first = cells[0];
          if (first) return (first.getData() as Row).id;
        }
      }
    } catch {
      /* range module */
    }
    // fallback: активная ячейка (если Tabulator держит)
    try {
      const active = (table as unknown as { getActiveCell?: () => CellComponent | false }).getActiveCell?.();
      if (active) return (active.getData() as Row).id;
    } catch {
      /* */
    }
    return lastFocusRef.current?.rowId ?? null;
  }, []);

  /**
   * История строки с тулбара: стоим на строке (range/focus) → «История».
   * field = '*' — вся строка, без id в UI.
   */
  const handleToolbarHistory = useCallback(() => {
    if (historyPanel && historyPanel !== 'all') {
      setHistoryPanel(null);
      setServerHistory(null);
      return;
    }
    const rowId = getFocusedRowId();
    if (rowId == null) {
      setMsg('Выделите ячейку строки, затем «История»');
      return;
    }
    setHistoryPanel({ rowId, field: '*' });
    setServerHistory({ rowId, field: '*', loading: true, entries: [] });
    void flowTransportHistoryGet(api, rowId)
      .then((entries) => setServerHistory({ rowId, field: '*', loading: false, entries }))
      .catch(() => setServerHistory({ rowId, field: '*', loading: false, entries: [] }));
  }, [getFocusedRowId, historyPanel]);

  const applyStyleToSelection = useCallback((patch: Partial<CellStyle>) => {
    const table = tableRef.current;
    if (!table) return;
    const ranges = table.getRanges();
    for (const range of ranges) {
      for (const cell of range.getCells().flat()) {
        const row = cell.getData() as Row;
        const key = styleKey(row.id, cell.getField());
        const prev = stylesRef.current.get(key) ?? {};
        stylesRef.current.set(key, { ...prev, ...patch });
      }
    }
    safeReformatAll(table);
  }, []);

  const promptColor = useCallback(
    (kind: 'color' | 'bg') => {
      // eslint-disable-next-line no-alert
      const value = window.prompt(kind === 'color' ? 'Цвет текста (hex):' : 'Цвет заливки (hex):');
      if (value) applyStyleToSelection(kind === 'color' ? { color: value } : { bg: value });
    },
    [applyStyleToSelection],
  );

  const styledFormatter = useCallback((field: string, render: (v: unknown, row: Row) => string) => {
    return (cell: CellComponent): string => {
      const row = cell.getData() as Row;
      const key = styleKey(row.id, field);
      const st = stylesRef.current.get(key);
      const text = render(cell.getValue(), row);
      const parts: string[] = [];
      if (st?.bold) parts.push('font-weight:700');
      if (st?.italic) parts.push('font-style:italic');
      if (st?.color) parts.push(`color:${st.color}`);
      if (st?.bg) parts.push(`background:${st.bg}`);
      return `<span style="${parts.join(';')}">${text}</span>`;
    };
  }, []);

    /**
   * Фикс-сортировка 1:1 Glide baseRows (FlowTransportGrid.tsx):
   * tdate↓ · printStatusGroup · workKey · garage_no · id.
   * Не multi setSort Tabulator (ломает порядок по месяцам) — один custom sorter.
   */
  const applyOurSort = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    withTableScrollPreserved(table, () => {
      // dir: 'asc' — comparator уже «как Glide»; desc инвертировал бы весь ключ.
      table.setSort([{ column: '_canonSort', dir: 'asc' }]);
    });
  }, []);

  // Счётчики для панели фасетов (как data-table-filter-checkbox.tsx у OpenStatus:
  // значение + количество совпадений). Считаем по ВСЕМ строкам, не по отфильтрованным.
  const facetCounts: Record<string, Record<string, number>> = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const def of FACET_DEFS) {
      const counts: Record<string, number> = {};
      for (const r of allRows) {
        const v = String((r as unknown as Record<string, unknown>)[def.field] ?? '');
        if (!v) continue;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      out[def.field] = counts;
    }
    return out;
  }, [allRows]);

  const applyFilters = useCallback(
    (s: string, facets: Record<string, Set<string>>, days: ReadonlySet<string>, month: string | null) => {
      const table = tableRef.current;
      if (!table) return;
      const q = s.trim().toLowerCase();
      // Glide: без выбора дней — «не старше текущего месяца» (≥ prefix), не ровно месяц.
      // monthScope — явный «весь месяц YYYY-MM»; иначе как baseRows glide.
      const monthPrefix = month ?? currentMonthPrefix;
      const exactMonth = month != null;
      withTableScrollPreserved(table, () => {
        table.setFilter((data: Row) => {
          if (days.size > 0) {
            if (!days.has(data.tdate)) return false;
          } else if (exactMonth) {
            if ((data.tdate || '').slice(0, 7) !== monthPrefix) return false;
          } else if ((data.tdate || '').slice(0, 7) < monthPrefix) {
            return false;
          }
          // Поиск слева = фильтр по ВСЕМ колонкам (заказ, статус, работа, ТП/ТС…).
          if (q && !rowSearchHaystack(data).includes(q)) return false;
          for (const def of FACET_DEFS) {
            const sel = facets[def.field];
            if (sel && sel.size > 0 && !sel.has((data as unknown as Record<string, string>)[def.field] ?? '')) return false;
          }
          return true;
        });
        // После фильтра — канон-порядок 1:1 Glide (custom sorter на _canonSort).
        table.setSort([{ column: '_canonSort', dir: 'asc' }]);
      });
    },
    [currentMonthPrefix],
  );

  useEffect(() => {
    applyFilters(search, facetSelected, daySel, monthScope);
  }, [search, facetSelected, daySel, monthScope, applyFilters]);

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

  const buildRows = useCallback((trRows: FlowTransportRow[], veh: FlowVehicle[]): Row[] => {
    const vehByGarage = new Map(veh.map((v) => [v.garage_no, v]));
    return trRows.map((r) => {
      const v = vehByGarage.get(r.garage_no);
      const force_json = r.force_json || '[]';
      return {
        id: r.id,
        row_version: r.row_version,
        tdate: r.tdate,
        order_no: r.order_no,
        status: r.status,
        work: r.work,
        vehicle_type: r.vehicle_type,
        time_range: r.time_range,
        time_bold: Number(r.time_bold ?? 0),
        fact_start: r.fact_start,
        fact_end: r.fact_end,
        force: forceSummary(force_json),
        force_json,
        brand: v?.model ? vehicleBrand(v.model) : '',
        color: v?.color ?? '',
        garage_no: r.garage_no,
        gos_no: v?.gos_no ?? '',
        out_status: r.out_status,
        driver: r.driver,
        driver_phone: r.driver_phone,
        no_exp: r.no_exp_status === 'ДА',
        comment: r.comment,
      };
    });
  }, []);

  const reload = useCallback(async () => {
    const [trRows, veh] = await Promise.all([
      flowTransportGet(api) as Promise<FlowTransportRow[]>,
      flowVehiclesGet(api) as Promise<FlowVehicle[]>,
    ]);
    vehiclesRef.current = veh;
    const rows = buildRows(trRows, veh);
    rowsByIdRef.current = new Map(rows.map((r) => [r.id, r]));
    return rows;
  }, [buildRows]);

  // ---- вид: фасеты + поиск + дни + колонки (видимость + порядок).
  const collectView = useCallback((): TabViewState => {
    const table = tableRef.current;
    const facets: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(facetSelected)) facets[k] = [...v];
    const order = table ? readTableColOrder(table) : colOrder;
    const hidden = table
      ? table
          .getColumns()
          .filter((c) => {
            const f = c.getField();
            return !!f && TOGGLEABLE_IDS.has(f) && !c.isVisible();
          })
          .map((c) => c.getField() as string)
      : TOGGLEABLE_COLS.filter((c) => !visibleCols.has(c.id)).map((c) => c.id);
    return {
      facets,
      search,
      hiddenCols: hidden,
      colOrder: order.length ? order : [...DEFAULT_COL_ORDER],
      days: [...daySel],
      monthScope,
    };
  }, [facetSelected, search, daySel, monthScope, colOrder, visibleCols]);

  const applyView = useCallback((v: TabViewState) => {
    const table = tableRef.current;
    setSearch(v.search ?? '');
    const facets: Record<string, Set<string>> = {};
    for (const [k, arr] of Object.entries(v.facets ?? {})) facets[k] = new Set(arr);
    setFacetSelected(facets);
    setDaySel(new Set(v.days ?? []));
    setMonthScope(v.monthScope ?? null);

    // Новый формат (есть colOrder): hiddenCols — истина. Legacy: дефолт «Заказ» скрыт.
    const isLegacy = !v.colOrder?.length;
    const hidden = new Set(v.hiddenCols ?? (isLegacy ? [...DEFAULT_HIDDEN] : []));
    if (isLegacy && Array.isArray(v.hiddenCols) && v.hiddenCols.length === 0) {
      hidden.add('order_no');
    }
    const nextVisible = new Set(TOGGLEABLE_COLS.map((c) => c.id).filter((id) => !hidden.has(id)));
    // Не даём скрыть всё.
    if (nextVisible.size === 0) for (const id of DEFAULT_VISIBLE) nextVisible.add(id);
    setVisibleCols(nextVisible);

    const orderRaw = v.colOrder?.length ? v.colOrder : [...DEFAULT_COL_ORDER];
    // Дополняем order полями, которых не было в сохранённом виде.
    const order = [...orderRaw.filter((f) => TOGGLEABLE_IDS.has(f))];
    for (const id of DEFAULT_COL_ORDER) if (!order.includes(id)) order.push(id);
    setColOrder(order);

    if (!table) return;
    applyColOrder(table, order);
    applyColVisibility(table, nextVisible);
  }, []);

  const saveView = useCallback(
    async (mode: FlowViewMode) => {
      const v = collectView();
      const json = JSON.stringify(v);
      if (mode === 'personal') {
        localStorage.setItem(PERSONAL_VIEW_KEY, json);
        setHasPersonalView(true);
      } else {
        setBusy(true);
        try {
          const res = await flowTransportViewSet(api, json);
          setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
          setHasSharedView(!!res.value);
        } finally {
          setBusy(false);
        }
      }
    },
    [collectView],
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
            /* corrupted personal view — ignore */
          }
        }
      } else {
        setBusy(true);
        try {
          const res = await flowTransportViewGet(api);
          setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
          setHasSharedView(!!res.value);
          if (res.value) applyView(JSON.parse(res.value) as TabViewState);
        } catch {
          /* сеть/парсинг — оставляем текущий вид */
        } finally {
          setBusy(false);
        }
      }
    },
    [applyView],
  );

  const handleResetView = useCallback(
    (target: FlowViewMode) => {
      setSearch('');
      setFacetSelected({});
      setDaySel(new Set());
      setMonthScope(null);
      setVisibleCols(new Set(DEFAULT_VISIBLE));
      setColOrder([...DEFAULT_COL_ORDER]);
      setReorderOn(false);
      const table = tableRef.current;
      if (table) {
        applyColOrder(table, DEFAULT_COL_ORDER);
        applyColVisibility(table, DEFAULT_VISIBLE);
      }
      applyOurSort();
      if (target === 'personal') {
        localStorage.removeItem(PERSONAL_VIEW_KEY);
        setHasPersonalView(false);
      } else {
        void flowTransportViewSet(api, '').then((res) => {
          setSharedAuthor({ updatedBy: res.updatedBy, updatedByName: res.updatedByName, updatedAt: res.updatedAt });
          setHasSharedView(false);
        });
      }
    },
    [applyOurSort],
  );

  /** Перестановка заголовков: Tabulator movableColumns. */
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    table.options.movableColumns = reorderOn;
  }, [reorderOn]);

  const doEditCell = useCallback(
    async (cell: CellComponent) => {
      const row = cell.getData() as Row;
      const field = cell.getField();
      const oldValue = cell.getOldValue();
      // Пустое после Delete/Backspace — норма (факт/время/текст).
      let newValue = cell.getValue();
      if (newValue == null) newValue = '';
      if (typeof newValue === 'string') newValue = newValue.trim();
      if (rowLocked(row)) {
        setMsg('Строка старше 7 дней — правка только для разработчика');
        cell.restoreOldValue();
        return;
      }
      // Не слать, если значение не изменилось (в т.ч. оба пустые).
      const oldNorm = oldValue == null ? '' : typeof oldValue === 'string' ? oldValue.trim() : oldValue;
      if (oldNorm === newValue) return;

      let wireField = field === 'no_exp' ? 'no_exp_status' : field;
      let wireValue: string | number | boolean = field === 'no_exp' ? (newValue ? 'ДА' : '') : newValue;
      if (field === 'tdate') {
        const iso = parseTdateInput(String(newValue));
        if (!iso) {
          setMsg('Дата: нужен формат ГГГГ-ММ-ДД');
          cell.restoreOldValue();
          return;
        }
        wireValue = iso;
        newValue = iso;
      }
      try {
        const res = await flowTransportEdit(api, [{ id: row.id, row_version: row.row_version, fields: { [wireField]: wireValue as never } }]);
        if (res.conflicts.length > 0) {
          setMsg(
            field === 'tdate'
              ? 'Дата не сохранилась (архив >7д или конфликт) — откатил'
              : 'Конфликт версий — строку обновили параллельно, откатил правку',
          );
          cell.restoreOldValue();
          return;
        }
        const saved = res.rows[0];
        if (saved) {
          const updated = rowsByIdRef.current.get(row.id);
          if (updated) {
            updated.row_version = saved.row_version;
            if (field === 'fact_start' || field === 'fact_end' || field === 'time_range') {
              (updated as unknown as Record<string, unknown>)[field] = newValue;
            }
            if (field === 'driver') {
              updated.driver = String(newValue ?? '');
            }
            if (field === 'tdate') {
              updated.tdate = String(newValue ?? '');
            }
            rowsByIdRef.current.set(row.id, updated);
          }
        }
        // Синхронизируем значение ячейки (пустая строка после clear).
        if (cell.getValue() !== newValue) cell.setValue(newValue, true);
        pushHistory({ rowId: row.id, field, oldValue, newValue, at: new Date().toLocaleString('ru-RU'), who: loginRef.current });
        if (FACET_DEFS.some((f) => f.field === field) || field === 'tdate') {
          setAllRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: newValue } : r)));
        }
        if (field === 'status' || field === 'work' || field === 'tdate') {
          const fresh = cell.getRow().getData() as Row;
          cell.getRow().update({
            ...fresh,
            tdate: field === 'tdate' ? String(newValue) : fresh.tdate,
            _statusRank: printStatusGroup(fresh.status),
            _workRank: workKey(fresh.work),
          });
          applyOurSort();
          // Перерисовать заливку строки (status) / жирное время (work) / дату.
          cell.getRow().reformat();
        }
      } catch (err) {
        setMsg(`Ошибка сохранения: ${String(err)}`);
        cell.restoreOldValue();
      }
    },
    [rowLocked, pushHistory, applyOurSort],
  );

  /** Очистить выделенные ячейки (Del/Backspace) — batch API, как Glide onDelete. */
  const clearSelectedCells = useCallback(
    async (cells: CellComponent[]) => {
      type Acc = { row_version: number; fields: Record<string, string | number | null>; cellOps: { cell: CellComponent; field: string; oldValue: unknown }[] };
      const byRow = new Map<number, Acc>();
      for (const cell of cells) {
        const field = cell.getField();
        const wire = clearWireFields(field);
        if (!wire) continue;
        const row = cell.getData() as Row;
        if (rowLocked(row)) continue;
        const oldValue = cell.getValue();
        const empty =
          field === 'no_exp'
            ? !oldValue
            : field === 'force'
              ? !String(oldValue ?? '').trim()
              : oldValue == null || String(oldValue).trim() === '';
        if (empty) continue;
        const acc = byRow.get(row.id) ?? { row_version: row.row_version, fields: {}, cellOps: [] };
        Object.assign(acc.fields, wire);
        acc.cellOps.push({ cell, field, oldValue });
        byRow.set(row.id, acc);
      }
      if (byRow.size === 0) return;
      const edits = [...byRow.entries()].map(([id, acc]) => ({
        id,
        row_version: acc.row_version,
        fields: acc.fields,
      }));
      try {
        const res = await flowTransportEdit(api, edits);
        if (res.conflicts.length > 0) {
          setMsg('Конфликт версий — часть строк не очистилась, обновите');
        }
        const savedById = new Map(res.rows.map((r) => [r.id, r]));
        let needResort = false;
        for (const [id, acc] of byRow) {
          if (res.conflicts.includes(id)) continue;
          const saved = savedById.get(id);
          const local = rowsByIdRef.current.get(id);
          if (local && saved) {
            local.row_version = saved.row_version;
            for (const k of Object.keys(acc.fields)) {
              if (k === 'force_json') {
                local.force_json = '[]';
                local.force = '';
              } else if (k === 'no_exp_status') {
                local.no_exp = false;
              } else if (k === 'driver_phone') {
                local.driver_phone = '';
              } else if (k in local) {
                (local as unknown as Record<string, unknown>)[k] = acc.fields[k] ?? '';
              }
            }
            rowsByIdRef.current.set(id, local);
          }
          for (const op of acc.cellOps) {
            const displayEmpty = op.field === 'no_exp' ? false : '';
            op.cell.setValue(displayEmpty, true);
            pushHistory({
              rowId: id,
              field: op.field,
              oldValue: op.oldValue,
              newValue: displayEmpty,
              at: new Date().toLocaleString('ru-RU'),
              who: loginRef.current,
            });
            if (op.field === 'status' || op.field === 'work') needResort = true;
          }
          const rowComp = cells.find((c) => (c.getData() as Row).id === id)?.getRow();
          if (rowComp && local) {
            rowComp.update({
              ...local,
              _statusRank: printStatusGroup(local.status),
              _workRank: workKey(local.work),
            });
            rowComp.reformat();
          }
        }
        if (needResort) applyOurSort();
        setAllRows((prev) =>
          prev.map((r) => {
            const loc = rowsByIdRef.current.get(r.id);
            return loc ?? r;
          }),
        );
      } catch (err) {
        setMsg(`Ошибка очистки: ${String(err)}`);
      }
    },
    [rowLocked, pushHistory, applyOurSort],
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
      /* range module not ready */
    }
    return out;
  }, []);

  /** Активная ячейка Tabulator (SelectRange) или lastFocus. */
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
      const row = table.getRow(focus.rowId);
      if (!row) return null;
      return row.getCell(focus.field) ?? null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Id строк для корзины: override → любые ячейки range (не обязательно целая строка)
   * → активная / lastFocus. selectableRows=false, getSelectedData всегда пуст.
   */
  const collectTargetRowIds = useCallback(
    (idsOverride?: number[]): number[] => {
      if (idsOverride && idsOverride.length > 0) return [...new Set(idsOverride)];
      const fromRange = collectRangeCells().map((c) => (c.getData() as Row).id);
      if (fromRange.length > 0) return [...new Set(fromRange)];
      const cell = getActiveOrFocusedCell();
      if (cell) return [(cell.getData() as Row).id];
      return [];
    },
    [collectRangeCells, getActiveOrFocusedCell],
  );

  /**
   * Ячейки для Del/Backspace: clearable из range, иначе одна active/focus clearable.
   * Строки клавишами НЕ удаляем — только корзина.
   */
  const collectCellsToClear = useCallback((): CellComponent[] => {
    const rangeCells = collectRangeCells();
    const clearable = rangeCells.filter((c) => CLEARABLE_FIELDS.has(c.getField()));
    if (clearable.length > 0) return clearable;
    if (rangeCells.length > 0) return []; // range есть, но не clearable — не трогаем
    const cell = getActiveOrFocusedCell();
    if (cell && CLEARABLE_FIELDS.has(cell.getField())) return [cell];
    return [];
  }, [collectRangeCells, getActiveOrFocusedCell]);

  /**
   * Batch save после range-paste / fill.
   * driver: ФИО+телефон из clip; garage_no: сервер + локально brand/gos с машины.
   */
  const persistRangePaste = useCallback(async () => {
    const cells = collectRangeCells();
    if (cells.length === 0) return;
    type Acc = { row_version: number; fields: Record<string, string | number | null> };
    const byRow = new Map<number, Acc>();
    for (const cell of cells) {
      const field = cell.getField();
      if (!PASTE_SAVE_FIELDS.has(field)) continue;
      const row = cell.getData() as Row;
      if (rowLocked(row)) continue;
      const local = rowsByIdRef.current.get(row.id);
      if (!local) continue;
      let newValue: string | boolean = cell.getValue() as string | boolean;
      if (newValue == null) newValue = field === 'no_exp' ? false : '';
      if (typeof newValue === 'string') newValue = newValue.trim();
      let wire: Record<string, string | number | null>;
      if (field === 'no_exp') {
        const on = Boolean(newValue);
        if (local.no_exp === on) continue;
        wire = { no_exp_status: on ? 'ДА' : '' };
      } else if (field === 'force') {
        if (String(newValue) === String(local.force ?? '')) continue;
        if (!String(newValue).trim()) wire = { force_json: '[]' };
        else continue;
      } else if (field === 'driver') {
        const { driver, phone } = parseDriverClip(String(newValue));
        if (driver === local.driver && phone === (local.driver_phone || '')) continue;
        wire = { driver, driver_phone: phone };
        if (cell.getValue() !== driver) cell.setValue(driver, true);
      } else if (field === 'garage_no') {
        const g = parseGarageClip(String(newValue));
        if (g === (local.garage_no || '')) continue;
        wire = { garage_no: g };
        if (cell.getValue() !== g) cell.setValue(g, true);
      } else if (field === 'tdate') {
        const iso = parseTdateInput(String(newValue));
        if (!iso || iso === local.tdate) continue;
        wire = { tdate: iso };
        if (cell.getValue() !== iso) cell.setValue(iso, true);
      } else {
        const prev = String((local as unknown as Record<string, unknown>)[field] ?? '');
        if (prev === String(newValue)) continue;
        wire = { [field]: String(newValue) };
      }
      const acc = byRow.get(row.id) ?? { row_version: local.row_version, fields: {} };
      Object.assign(acc.fields, wire);
      byRow.set(row.id, acc);
    }
    if (byRow.size === 0) return;
    try {
      const res = await flowTransportEdit(
        api,
        [...byRow.entries()].map(([id, acc]) => ({ id, row_version: acc.row_version, fields: acc.fields })),
      );
      for (const saved of res.rows) {
        const local = rowsByIdRef.current.get(saved.id);
        if (!local) continue;
        local.row_version = saved.row_version;
        const acc = byRow.get(saved.id);
        if (acc) {
          for (const [k, v] of Object.entries(acc.fields)) {
            if (k === 'force_json') {
              local.force_json = String(v ?? '[]');
              local.force = forceSummary(local.force_json);
            } else if (k === 'no_exp_status') local.no_exp = v === 'ДА';
            else if (k === 'driver') local.driver = String(v ?? '');
            else if (k === 'driver_phone') local.driver_phone = String(v ?? '');
            else if (k === 'tdate') local.tdate = String(v ?? '');
            else if (k === 'garage_no') {
              local.garage_no = String(v ?? '');
              const veh = vehiclesRef.current.find((x) => x.garage_no === local.garage_no);
              local.brand = veh?.model ? vehicleBrand(veh.model) : '';
              local.color = veh?.color ?? '';
              local.gos_no = veh?.gos_no ?? '';
              // сервер мог подтянуть driver/type/out — из saved row если есть
              if (saved.driver != null) local.driver = saved.driver;
              if (saved.driver_phone != null) local.driver_phone = saved.driver_phone;
              if (saved.vehicle_type != null) local.vehicle_type = saved.vehicle_type;
              if (saved.out_status != null) local.out_status = saved.out_status;
            } else if (k in local) (local as unknown as Record<string, unknown>)[k] = v ?? '';
          }
        }
        rowsByIdRef.current.set(saved.id, local);
        const rowComp = cells.find((c) => (c.getData() as Row).id === saved.id)?.getRow();
        rowComp?.update({
          ...local,
          _statusRank: printStatusGroup(local.status),
          _workRank: workKey(local.work),
        });
        rowComp?.reformat();
      }
      if (res.conflicts.length > 0) setMsg('Конфликт версий при вставке — обновите');
      applyOurSort();
      setAllRows((prev) => prev.map((r) => rowsByIdRef.current.get(r.id) ?? r));
    } catch (err) {
      setMsg(`Ошибка вставки в ячейки: ${String(err)}`);
    }
  }, [collectRangeCells, rowLocked, applyOurSort]);

  const persistRangePasteRef = useRef(persistRangePaste);
  persistRangePasteRef.current = persistRangePaste;

  /** Если range пуст — одноячеечный range на lastFocus (нужно ядру SelectRange/Export). */
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

  /**
   * Copy: TSV строит Export+accessorClipboard Tabulator (range),
   * в OS — navigator.clipboard (Electron: execCommand часто no-op).
   */
  const runTabulatorCopy = useCallback(async () => {
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
      await navigator.clipboard.writeText(plain);
      setMsg(plain ? 'Скопировано' : 'Пусто');
    } catch (err) {
      setMsg(`Копирование: ${String(err)}`);
    }
  }, [ensureRangeSelection]);

  /**
   * Paste: OS → pasteParser/pasteAction SelectRange ('range') → batch API.
   */
  const runTabulatorPaste = useCallback(async () => {
    const table = tableRef.current as Tabulator & {
      modules?: {
        clipboard?: {
          pasteParser: (data: string) => unknown[] | false;
          pasteAction: (data: unknown) => unknown;
        };
      };
    };
    if (!table?.modules?.clipboard) return;
    if (!ensureRangeSelection()) {
      setMsg('Встаньте на ячейку для вставки');
      return;
    }
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* */
    }
    if (!text?.trim()) {
      setMsg('Буфер пуст');
      return;
    }
    if (isTransport1cPaste(text)) {
      setMsg('1С/шаблон — кнопка «Вставить из буфера»');
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
    } catch (err) {
      setMsg(`Вставка: ${String(err)}`);
    }
  }, [ensureRangeSelection, persistRangePaste]);

  /**
   * Протяжка как Glide: значение верхней (первой) ячейки каждого столбца
   * заливает весь выделенный range → batch save.
   * driver — ФИО+телефон; garage_no — номер (марка/гос с машины после save).
   */
  const fillRangeFromFirst = useCallback(async () => {
    const cells = collectRangeCells();
    if (cells.length < 2) {
      setMsg('Выделите несколько ячеек для протяжки');
      return;
    }
    // Первая ячейка каждого field = источник (порядок getCells = top→bottom / L→R).
    const sourceByField = new Map<string, unknown>();
    const sourceRowByField = new Map<string, Row>();
    let changed = 0;
    for (const cell of cells) {
      const field = cell.getField();
      if (!FILLABLE_FIELDS.has(field)) continue;
      if (!sourceByField.has(field)) {
        sourceByField.set(field, cell.getValue());
        sourceRowByField.set(field, cell.getData() as Row);
        continue;
      }
      const src = sourceByField.get(field);
      const cur = cell.getValue();
      const row = cell.getData() as Row;
      if (rowLocked(row)) continue;
      if (field === 'driver') {
        const srcRow = sourceRowByField.get(field)!;
        const packed = `${srcRow.driver || ''}${CLIP_UNIT}${srcRow.driver_phone || ''}`;
        const curPacked = `${row.driver || ''}${CLIP_UNIT}${row.driver_phone || ''}`;
        if (packed === curPacked) continue;
        cell.setValue(packed, true);
      } else {
        const same =
          field === 'no_exp'
            ? Boolean(cur) === Boolean(src)
            : String(cur ?? '').trim() === String(src ?? '').trim();
        if (same) continue;
        cell.setValue(src as never, true);
      }
      changed += 1;
    }
    if (changed === 0) {
      setMsg('Нечего протягивать');
      return;
    }
    await persistRangePaste();
    setMsg(`Протянуто ячеек: ${changed}`);
  }, [collectRangeCells, rowLocked, persistRangePaste]);

  const fillRangeFromFirstRef = useRef(fillRangeFromFirst);
  fillRangeFromFirstRef.current = fillRangeFromFirst;

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const s = await sessionStore.load();
        loginRef.current = s?.user?.login ?? '';
        const role = String(s?.role ?? '').toLowerCase();
        isDevRef.current = role === 'developer' || role === 'superadmin';
      } catch {
        /* сессия недоступна — работаем без dev-прав */
      }
      const rows = await reload();
      if (!alive || !containerRef.current) return;
      setAllRows(rows);
      // ТИП ТС для фильтра — канон BODY_TYPES ПЛЮС любые значения, реально встреченные
      // в данных (легаси/свободный ввод до перехода на канон-список) — иначе строку с
      // таким значением нельзя было ни увидеть в панели, ни отфильтровать (юзер:
      // «список типов ТС неполный»). Редактор ячейки (что МОЖНО поставить) — строго
      // BODY_TYPES, как в глиде; это только про то, что МОЖНО отфильтровать.
      const seenVehicleTypes = new Set(rows.map((r) => r.vehicle_type).filter(Boolean));
      for (const t of BODY_TYPES) seenVehicleTypes.delete(t);
      setFacetOptions({
        status: STATUS_OPTIONS,
        vehicle_type: [...BODY_TYPES, ...[...seenVehicleTypes].sort((a, b) => a.localeCompare(b, 'ru'))],
        force: ['ожидание выгрузки', 'поломка ТС'],
        out_status: OUT_OPTIONS.filter(Boolean),
      });

      // Предсортировка 1:1 Glide (все месяцы одинаково).
      const dataWithRanks = rows
        .map((r) => ({
          ...r,
          _statusRank: printStatusGroup(r.status),
          _workRank: workKey(r.work),
          _canonSort: 0,
        }))
        .sort(cmpTransportRows);

      // Списки для выпадашек строим ПОСЛЕ загрузки данных (машины/водители уже есть) —
      // раньше это было component-level useMemo, вычислявшийся ДО загрузки → пустой
      // список в момент создания Tabulator (юзер 2026-08-01: «списка нет»).
      // Grok: без сортировки в шапке; фикс. высота строк (без variableHeight — иначе
      // при dblclick/редакторе «проваливаемся» и скролл уезжает, юзер 2026-08-02).
      const gs = themeRef.current === 'grok';
      const cellAlign = gs ? ({ hozAlign: 'left' as const, vertAlign: 'middle' as const } as const) : {};
      const columns: ColumnDefinition[] = [
        { title: '', field: 'id', visible: false, headerSort: false },
        { title: '', field: '_statusRank', visible: false, headerSort: false },
        { title: '', field: '_workRank', visible: false, headerSort: false },
        {
          // Невидимый ключ: один sorter = полный cmpTransportRows (как Glide).
          title: '',
          field: '_canonSort',
          visible: false,
          headerSort: false,
          sorter: (_a, _b, aRow, bRow) =>
            cmpTransportRows(aRow.getData() as Row, bRow.getData() as Row),
        },
        {
          title: 'Дата',
          field: 'tdate',
          // «ПН · сентябрь 30» — день недели + месяц + число.
          width: gs ? 148 : 128,
          minWidth: 120,
          headerSort: false,
          ...cellAlign,
          // Маркер строки; range-select по ячейкам (copy/paste), не multi-row select.
          cssClass: gs ? 'pyn-row-marker' : undefined,
          // Двойной клик → наш календарь (модалка), не нативный date-picker —
          // тот «проваливался» (нужно было выбирать дважды), юзер 2026-08-02.
          editor: false as unknown as undefined,
          formatter: (cell) => fmtDate(String(cell.getValue() ?? '')),
          // В буфер — ISO (чтобы вставка обратно работала), не «ПН · …».
          accessorClipboard: (v: unknown) => String(v ?? ''),
          cellDblClick: (_e, cell) => {
            const r = cell.getData() as Row;
            if (rowLocked(r)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setDateEdit(r);
          },
        },
        {
          title: gs ? 'ID' : 'Заказ',
          field: 'order_no',
          width: gs ? 120 : 110,
          minWidth: 100,
          // По умолчанию скрыта (как в Glide: order условно); показать — меню «Колонки».
          visible: false,
          editor: 'input',
          headerSort: false,
          ...cellAlign,
          formatter: (cell) => pynMonoHtml(cell.getValue()),
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Статус',
          field: 'status',
          width: 128,
          minWidth: 110,
          headerSort: false,
          ...cellAlign,
          editor: 'list',
          editorParams: { values: STATUS_OPTIONS, autocomplete: true, listOnEmpty: true },
          // Копирование — plain text статуса, не HTML бейджа.
          accessorClipboard: (v: unknown) => String(v ?? ''),
          formatter: gs
            ? styledFormatter('status', (v) => pynStatusBadgeHtml(String(v ?? '')))
            : styledFormatter('status', (v) => String(v ?? '')),
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Работа',
          field: 'work',
          // Шире + 3 строки + title=полный текст (не режем «3. …» на июль 10).
          width: gs ? 340 : 260,
          minWidth: gs ? 240 : 160,
          headerSort: false,
          ...cellAlign,
          cssClass: gs ? 'pyn-cell-wrap pyn-cell-work' : undefined,
          editor: 'input',
          accessorClipboard: (v: unknown) => String(v ?? ''),
          formatter: styledFormatter('work', (v) => {
            const t = String(v ?? '');
            if (!t) return '';
            return `<span class="pyn-work-text" title="${escapeAttr(t)}">${t.replace(/</g, '&lt;')}</span>`;
          }),
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Тип ТС',
          field: 'vehicle_type',
          width: 130,
          minWidth: 100,
          headerSort: false,
          ...cellAlign,
          editor: 'list',
          editorParams: { values: [...BODY_TYPES], autocomplete: true, allowEmpty: true, listOnEmpty: true },
          accessorClipboard: (v: unknown) => String(v ?? ''),
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Время',
          field: 'time_range',
          // minWidth под «8:15-15:45»; короткие «8-17» не режут длинные (fitData + nowrap CSS).
          width: 108,
          minWidth: 72,
          headerSort: false,
          ...cellAlign,
          cssClass: gs ? 'pyn-cell-time' : undefined,
          editor: 'input',
          editorParams: { selectContents: true, elementAttributes: { autocomplete: 'off' } },
          accessorClipboard: (v: unknown) => fmtTimeRange(String(v ?? '')),
          formatter: (cell) => {
            const row = cell.getData() as Row;
            const bold = shouldShowTimeBold(row.time_range, row.work, row.tdate, prodCalRef.current, row.time_bold);
            // «8-17» / «8:15-17:30» — минуты :00 скрыты.
            const text = fmtTimeRange(row.time_range || '');
            return bold ? `<b>${text}</b>` : text || '';
          },
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Факт нач',
          field: 'fact_start',
          width: 72,
          minWidth: 52,
          headerSort: false,
          ...cellAlign,
          cssClass: gs ? 'pyn-cell-time' : undefined,
          // Single-click = select (copy/Del/fill); dblclick = колесо времени (как Glide activate).
          editor: false as unknown as undefined,
          // Plain для Clipboard module (не HTML «—»).
          accessorClipboard: (v: unknown) => fmtTimeRange(String(v ?? '')),
          formatter: (cell) => {
            const t = fmtTimeRange(String(cell.getValue() ?? ''));
            return t || '<span class="pyn-force-empty">—</span>';
          },
          cellDblClick: (_e, cell) => {
            const r = cell.getData() as Row;
            if (rowLocked(r)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setTimeEdit({ row: r, field: 'fact_start' });
          },
        },
        {
          title: 'Факт кон',
          field: 'fact_end',
          width: 72,
          minWidth: 52,
          headerSort: false,
          ...cellAlign,
          cssClass: gs ? 'pyn-cell-time' : undefined,
          editor: false as unknown as undefined,
          accessorClipboard: (v: unknown) => fmtTimeRange(String(v ?? '')),
          formatter: (cell) => {
            const t = fmtTimeRange(String(cell.getValue() ?? ''));
            return t || '<span class="pyn-force-empty">—</span>';
          },
          cellDblClick: (_e, cell) => {
            const r = cell.getData() as Row;
            if (rowLocked(r)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setTimeEdit({ row: r, field: 'fact_end' });
          },
        },
        {
          title: 'Форс-мажор',
          field: 'force',
          width: 180,
          minWidth: 140,
          headerSort: false,
          ...cellAlign,
          ...(gs ? { cssClass: 'pyn-cell-wrap' } : {}),
          // Single-click = select; dblclick = модалка (как Glide).
          editor: false as unknown as undefined,
          formatter: (cell) => {
            const t = String(cell.getValue() ?? '').trim();
            if (!t) return '<span class="pyn-force-empty">—</span>';
            return `<span class="pyn-force-summary">${t.replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</span>`;
          },
          cellDblClick: (_e, cell) => {
            const r = cell.getData() as Row;
            if (rowLocked(r)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setForceEdit(r);
          },
        },
        {
          title: gs ? 'Марка' : 'Марка',
          field: 'brand',
          width: gs ? 120 : 100,
          minWidth: 90,
          headerSort: false,
          ...cellAlign,
          // Не копируется: марка/цвет из карточки машины по гаражному.
          clipboard: false,
          formatter: (cell) => {
            const row = cell.getData() as Row;
            return `<span class="flow-tab-garage-stack"><b>${row.brand || ''}</b>${row.color ? `<span>${row.color}</span>` : ''}</span>`;
          },
        },
        {
          title: gs ? '№ · ГОС' : '№ · ГОС',
          field: 'garage_no',
          width: 150,
          minWidth: 120,
          headerSort: false,
          ...cellAlign,
          // Single-click = select (copy); dblclick → VehicleSpecCard.
          // Copy: гаражный (+гос для человека); paste → garage_no, марка/гос с машины.
          editor: false as unknown as undefined,
          accessorClipboard: (value: unknown, data: unknown) => {
            const row = data as Row;
            const g = String(value ?? row.garage_no ?? '').trim();
            const gos = String(row.gos_no ?? '').trim();
            return gos ? `${g}${CLIP_UNIT}${gos}` : g;
          },
          formatter: (cell) => {
            const row = cell.getData() as Row;
            return `<span class="flow-tab-garage-stack"><b>${row.garage_no || ''}</b>${row.gos_no ? `<span>${row.gos_no}</span>` : ''}</span>`;
          },
          cellDblClick: (_e, cell) => {
            const row = cell.getData() as Row;
            if (rowLocked(row)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setGarageSpec(row);
          },
        },
        {
          title: 'Выезд',
          field: 'out_status',
          width: 80,
          minWidth: 72,
          headerSort: false,
          ...(gs ? cellAlign : { hozAlign: 'center' as const }),
          editor: 'list',
          editorParams: { values: OUT_OPTIONS, listOnEmpty: true },
          accessorClipboard: (v: unknown) => String(v ?? ''),
          cellEdited: (cell) => void doEditCell(cell),
        },
        {
          title: 'Водитель',
          field: 'driver',
          width: gs ? 260 : 190,
          minWidth: gs ? 220 : 140,
          headerSort: false,
          ...cellAlign,
          // Single-click = select (copy ФИО+телефон); dblclick = popover.
          editor: false as unknown as undefined,
          accessorClipboard: (value: unknown, data: unknown) => {
            const row = data as Row;
            const fio = String(value ?? row.driver ?? '').trim();
            const phone = String(row.driver_phone ?? '').trim();
            return phone ? `${fio}${CLIP_UNIT}${phone}` : fio;
          },
          formatter: (cell) => {
            const row = cell.getData() as Row;
            const veh = vehiclesRef.current.find((v) => v.garage_no === row.garage_no);
            const driver = row.driver || veh?.driver || '';
            const phoneRaw = row.driver_phone || veh?.driver_phone || '';
            const phone = phoneRaw ? formatMobilePhone(phoneRaw) : '';
            const fromDrv = driver ? driverByFioRef.current.get(driver) ?? driverByFioRef.current.get(driver.toUpperCase()) : undefined;
            const fromMol = driver ? molFlagByFioRef.current.get(driver) ?? molFlagByFioRef.current.get(driver.toUpperCase()) : undefined;
            const color = fromDrv?.color || fromMol?.color || '';
            const isMol = Boolean(fromDrv?.isMol || fromMol?.isMol);
            const nameStyle = color ? ` style="color:${color}"` : '';
            const badge = isMol ? `<span class="flow-tab-mol-badge">МОЛ</span>` : '';
            const phoneLine =
              phone || isMol
                ? `<span class="flow-tab-driver-phone-line">${phone ? `<span class="flow-tab-driver-sub">${phone}</span>` : ''}${badge}</span>`
                : '';
            return `<span class="flow-tab-driver-stack"><span class="flow-tab-driver-name"${nameStyle}>${driver}</span>${phoneLine}</span>`;
          },
          cellDblClick: (_e, cell) => {
            const row = cell.getData() as Row;
            if (rowLocked(row)) {
              setMsg('Строка старше 7 дней — правка только для разработчика');
              return;
            }
            setDriverPick(row);
          },
        },
        {
          title: 'Без эксп.',
          field: 'no_exp',
          width: 90,
          minWidth: 80,
          headerSort: false,
          ...(gs ? cellAlign : { hozAlign: 'center' as const, vertAlign: 'middle' as const }),
          formatter: gs
            ? (cell) => {
                const on = Boolean(cell.getValue());
                return on
                  ? '<span class="pyn-tick pyn-tick--on" title="Без экспедитора — клик снять">✓</span>'
                  : '<span class="pyn-tick pyn-tick--off" title="Клик — без экспедитора"></span>';
              }
            : 'tickCross',
          ...(gs
            ? {
                cellClick: (_e: unknown, cell: CellComponent) => {
                  const row = cell.getData() as Row;
                  if (rowLocked(row)) {
                    setMsg('Строка старше 7 дней — правка только для разработчика');
                    return;
                  }
                  const next = !Boolean(cell.getValue());
                  cell.setValue(next, true);
                  void doEditCell(cell);
                },
              }
            : {
                editor: true as const,
                cellEdited: (cell: CellComponent) => void doEditCell(cell),
              }),
        },
        {
          title: 'Комментарий',
          field: 'comment',
          width: 200,
          minWidth: 120,
          headerSort: false,
          ...cellAlign,
          cssClass: gs ? 'pyn-cell-wrap' : undefined,
          editor: 'input',
          accessorClipboard: (v: unknown) => String(v ?? ''),
          formatter: styledFormatter('comment', (v) => String(v ?? '')),
          cellEdited: (cell) => void doEditCell(cell),
        },
      ];

      setVisibleCols(new Set(DEFAULT_VISIBLE));
      setColOrder([...DEFAULT_COL_ORDER]);

      tableRef.current?.destroy();
      // popupContainer: root — glass-меню наследуют pyn-theme.
      const popupHost = rootRef.current ?? containerRef.current;
      tableRef.current = new Tabulator(containerRef.current, {
        data: dataWithRanks,
        columns,
        // fitData: колонки по контенту → гориз. скролл.
        layout: 'fitData',
        height: '100%',
        index: 'id',
        // Grok: фикс. высота — 3 строки «Работы» (64px); без variableHeight (scroll jump).
        rowHeight: gs ? 64 : 40,
        placeholder: gs ? '<div class="pyn-table-placeholder">Нет строк за выбранный период</div>' : undefined,
        // Grok: dblclick = правка текста/list; click на no_exp — toggle (см. cellClick).
        editTriggerEvent: gs ? 'dblclick' : 'click',
        // Перестановка колонок — включается тумблером «Перестановка» в меню Колонки.
        movableColumns: false,
        // Clipboard = ядро Tabulator + SelectRange (⌘C/⌘V / Ctrl+C/V).
        // Не свой буфер: keybindings Clipboard + range export/paste parsers.
        clipboard: true,
        clipboardCopyStyled: false,
        clipboardCopyConfig: { columnHeaders: false, columnGroups: false, rowHeaders: false },
        clipboardCopyRowRange: 'range',
        // Без parser 'range' paste вставляет строки таблицы, а не ячейки (баг конфига).
        clipboardPasteParser: 'range',
        clipboardPasteAction: 'range',
        // Только range-ячейки (copy/paste/Del). selectableRows + selectableRange
        // вместе ломают Tabulator («SelectRange cannot be used with row selection»).
        selectableRange: true,
        selectableRangeColumns: false,
        selectableRangeRows: false,
        selectableRangeAutoFocus: true,
        selectableRows: false,
        history: true,
        printAsHtml: true,
        printStyled: true,
        // Tabulator 6: popupContainer есть, в @types — нет → cast.
        popupContainer: popupHost,
        // Заливки строк НЕ делаем (юзер). Только opacity для архива >7д.
        // Сортировка по статусу/работе — applyOurSort; жирное время — formatter.
        rowFormatter: (row: RowComponent) => {
          const r = row.getData() as Row;
          const el = row.getElement();
          el.removeAttribute('data-status-kind');
          el.style.background = '';
          el.style.color = '';
          el.style.opacity = rowLocked(r) ? '0.55' : '';
        },
        // Контекстное меню строки (Grok): быстрая смена статуса / отмена разнарядки.
        ...(themeRef.current === 'grok'
          ? {
              rowContextMenu: [
                ...STATUS_OPTIONS.map((st) => ({
                  label: `Статус → ${st}`,
                  action: (_e: Event, row: RowComponent) => {
                    const cell = row.getCell('status');
                    if (!cell) return;
                    const old = cell.getValue();
                    if (old === st) return;
                    cell.setValue(st, true);
                    void doEditCell(cell);
                  },
                })),
                { separator: true },
                {
                  label: 'Отменить разнарядку',
                  action: (_e: Event, row: RowComponent) => {
                    const cell = row.getCell('status');
                    if (!cell) return;
                    cell.setValue('Отмена', true);
                    void doEditCell(cell);
                  },
                },
              ],
            }
          : {}),
      } as ConstructorParameters<typeof Tabulator>[1]);

      tableRef.current.on('tableBuilt', () => {
        applyOurSort();
        applyColVisibility(tableRef.current!, DEFAULT_VISIBLE);
        // Явный вызов на построении таблицы — эффект ниже (по search/facetSelected/
        // daySel) может сработать РАНЬШЕ, чем tableRef.current появится (гонка), и
        // тогда дефолтный фильтр «текущий месяц» тихо не применится при первой загрузке.
        applyFilters(search, facetSelected, daySel, monthScope);
        const raw = localStorage.getItem(PERSONAL_VIEW_KEY);
        setHasPersonalView(!!raw);
        if (raw) {
          try {
            applyView(JSON.parse(raw) as TabViewState);
          } catch {
            /* corrupted */
          }
        }
        setLoading(false);
      });
      // После drag-перестановки заголовка — запоминаем порядок (сохранится в «Сохранить вид»).
      tableRef.current.on('columnMoved', () => {
        const t = tableRef.current;
        if (!t) return;
        setColOrder(readTableColOrder(t));
      });
      // Cmd/Ctrl+V в range: Tabulator пишет значения → мы batch-save на API.
      tableRef.current.on('clipboardPasted', () => {
        void persistRangePasteRef.current();
      });
      // Фокус для корзины / Del: клик (range SelectRange тоже шлёт cellClick).
      tableRef.current.on('cellClick', (_e: unknown, cell: CellComponent) => {
        const row = cell.getData() as Row;
        lastFocusRef.current = { rowId: row.id, field: cell.getField() };
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      alive = false;
      tableRef.current?.destroy();
      tableRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Печать | PDF — отдельные поповеры календаря (без превью). */
  const [printOpen, setPrintOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [printSel, setPrintSel] = useState<Set<string>>(() => new Set());
  const [printDok, setPrintDok] = useState(false);
  const [printOkalina, setPrintOkalina] = useState(false);
  /** Silent print job: без превью — сразу dialog | save PDF. id = каждый запуск заново. */
  const [printJob, setPrintJob] = useState<{
    id: number;
    days: string[];
    mode: 'dialog' | 'save';
  } | null>(null);
  const printJobSeq = useRef(0);
  /** Сводка по машине (Блок 3-style) — не история правок. */
  const [machineSheet, setMachineSheet] = useState<FlowTransportRow | null>(null);

  const preparePrintSel = useCallback(() => {
    // Подхватить текущий фильтр дней; иначе дни таблицы / месяц-скоуп.
    if (daySel.size > 0) {
      setPrintSel(new Set(daySel));
      return;
    }
    const days = new Set<string>();
    for (const r of allRows) {
      if (r.tdate) days.add(r.tdate);
    }
    if (monthScope) {
      setPrintSel(new Set([...days].filter((d) => d.startsWith(monthScope))));
    } else {
      setPrintSel(days);
    }
  }, [daySel, allRows, monthScope]);

  const openPrintPicker = useCallback(() => {
    preparePrintSel();
    setPdfOpen(false);
    setPrintOpen(true);
  }, [preparePrintSel]);

  const openPdfPicker = useCallback(() => {
    preparePrintSel();
    setPrintOpen(false);
    setPdfOpen(true);
  }, [preparePrintSel]);

  const launchPrint = useCallback(
    (mode: 'dialog' | 'save') => {
      if (printSel.size === 0) {
        setMsg('Выберите дни');
        return;
      }
      setPrintOpen(false);
      setPdfOpen(false);
      // Сначала снять прошлый job (если завис), затем новый id → remount silent print.
      printJobSeq.current += 1;
      const id = printJobSeq.current;
      setPrintJob(null);
      requestAnimationFrame(() => {
        setPrintJob({ id, days: [...printSel].sort(), mode });
      });
    },
    [printSel],
  );

  const printFooter = (mode: 'dialog' | 'save') => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
      <button
        type="button"
        onClick={() => setPrintDok((v) => !v)}
        className={`rounded-md border px-2 py-1 text-[11px] ${
          printDok
            ? 'border-[#d97757]/50 bg-[#d97757]/15 text-[#e8a48a]'
            : 'border-white/15 text-zinc-400 hover:text-zinc-200'
        }`}
        title="Включить работы ДОК (6.x)"
      >
        ДОК
      </button>
      <button
        type="button"
        onClick={() => setPrintOkalina((v) => !v)}
        className={`rounded-md border px-2 py-1 text-[11px] ${
          printOkalina
            ? 'border-[#d97757]/50 bg-[#d97757]/15 text-[#e8a48a]'
            : 'border-white/15 text-zinc-400 hover:text-zinc-200'
        }`}
        title="Включить работы ОКАЛИНА (8.x)"
      >
        ОКАЛИНА
      </button>
      <button
        type="button"
        disabled={printSel.size === 0}
        onClick={() => launchPrint(mode)}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[#d97757]/50 bg-[#d97757]/20 px-2.5 text-[11.5px] font-medium text-[#e8a48a] disabled:opacity-40"
      >
        {mode === 'dialog' ? (
          <>
            <Printer size={12} strokeWidth={1.75} />
            Печать
          </>
        ) : (
          <>
            <FileDown size={12} strokeWidth={1.75} />
            Скачать
          </>
        )}
      </button>
    </div>
  );

  const rowToTransport = useCallback((r: Row): FlowTransportRow => {
    return {
      id: r.id,
      tdate: r.tdate,
      order_no: r.order_no,
      status: r.status,
      work: r.work,
      vehicle_type: r.vehicle_type,
      time_range: r.time_range,
      time_bold: r.time_bold,
      fact_start: r.fact_start,
      fact_end: r.fact_end,
      force_json: r.force_json || '[]',
      garage_no: r.garage_no,
      out_status: r.out_status,
      driver: r.driver,
      driver_phone: r.driver_phone,
      no_exp_status: r.no_exp ? 'ДА' : '',
      comment: r.comment,
      expeditors: '',
      ot: '',
      sp: '',
      row_version: r.row_version,
      created_by: '',
      created_at: '',
    } as FlowTransportRow;
  }, []);

  const handleMachineTrip = useCallback(() => {
    const rowId = getFocusedRowId();
    if (rowId == null) {
      setMsg('Встаньте на строку машины');
      return;
    }
    const row = rowsByIdRef.current.get(rowId);
    if (!row) {
      setMsg('Строка не найдена');
      return;
    }
    if (!(row.garage_no || '').trim()) {
      setMsg('У строки нет гаражного №');
      return;
    }
    setMachineSheet(rowToTransport(row));
  }, [getFocusedRowId, rowToTransport]);

  const handleAddRow = useCallback(async () => {
    // День «где сидим» (фокус) → иначе верх видимого списка (multi) / фильтр дня.
    const sitId = lastFocusRef.current?.rowId;
    const sitTdate = sitId != null ? rowsByIdRef.current.get(sitId)?.tdate ?? null : null;
    let topVisibleTdate: string | null = null;
    try {
      const top = tableRef.current?.getRows('active')?.[0]?.getData() as Row | undefined;
      topVisibleTdate = top?.tdate ?? null;
    } catch {
      /* */
    }
    const date = resolveAddDate(daySel, monthScope, currentMonthPrefix, sitTdate, topVisibleTdate);
    setBusy(true);
    try {
      const row = await flowTransportAdd(api, { date });
      if (row) {
        const newRow = buildRows([row], vehiclesRef.current)[0]!;
        rowsByIdRef.current.set(newRow.id, newRow);
        // true = впереди в начале видимого списка; пустая Работа → cmp держит сверху дня;
        // после заполнения — канон-сорт.
        tableRef.current?.addRow(
          {
            ...newRow,
            _statusRank: printStatusGroup(newRow.status),
            _workRank: workKey(newRow.work),
            _canonSort: 0,
          },
          true,
        );
        setAllRows((prev) => [newRow, ...prev]);
        applyOurSort();
        lastFocusRef.current = { rowId: newRow.id, field: 'status' };
        setMsg(`Строка на ${fmtDate(date)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [buildRows, applyOurSort, daySel, monthScope, currentMonthPrefix]);

  const handleDeleteSelected = useCallback(
    async (idsOverride?: number[]) => {
      const table = tableRef.current;
      if (!table) return;
      // Корзина: стою на ячейке / выделил хоть что-то в строках (не обязательно всю строку).
      let ids = collectTargetRowIds(idsOverride);
      // Архив >7д — не удаляем (как Glide), dev может.
      const filtered: number[] = [];
      let lockedHit = false;
      for (const id of ids) {
        const r = rowsByIdRef.current.get(id);
        if (r && rowLocked(r)) {
          lockedHit = true;
          continue;
        }
        filtered.push(id);
      }
      ids = filtered;
      if (ids.length === 0) {
        setMsg(lockedHit ? 'Строки старше 7 дней — архив, не удаляются' : 'Встаньте на строку или выделите ячейки');
        return;
      }
      if (lockedHit) setMsg('Часть строк старше 7 дней — они не удаляются (архив)');
      setBusy(true);
      try {
        const deleted = await flowTransportDelete(api, ids);
        // Батч, не цикл: deleteRow — Promise, по одной строке в цикле без await
        // даёт N наложенных перерисовок вместо одной (юзер 2026-08-02: «удаление медленно»).
        if (deleted.length > 0) await table.deleteRow(deleted);
        for (const id of deleted) {
          rowsByIdRef.current.delete(id);
          if (lastFocusRef.current?.rowId === id) lastFocusRef.current = null;
        }
        setAllRows((prev) => prev.filter((r) => !deleted.includes(r.id)));
        try {
          table.deselectRow();
        } catch {
          /* selectableRows off */
        }
      } finally {
        setBusy(false);
      }
    },
    [rowLocked, collectTargetRowIds],
  );

  /**
   * ⌘C/⌘V / Ctrl: Export+SelectRange Tabulator → navigator.clipboard (Electron).
   * ⌘D — fill; Del/Backspace — clear (не delete row).
   */
  const handleGridKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const root = rootRef.current;
      if (!root || root.offsetParent === null) return;
      if (root.closest('[aria-hidden="true"]')) return;
      if (getComputedStyle(root).visibility === 'hidden') return;

      const table = tableRef.current;
      if (!table) return;

      const t = e.target as Node | null;
      const ae = document.activeElement;
      const focusInGrid = (t != null && root.contains(t)) || (ae != null && root.contains(ae));
      if (!focusInGrid && collectRangeCells().length === 0 && !lastFocusRef.current) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Copy — не execCommand Tabulator (мёртв в Electron), а Export.range + clipboard API.
      if (mod && !e.altKey && !e.shiftKey && key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        void runTabulatorCopy();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key === 'v') {
        e.preventDefault();
        e.stopPropagation();
        void runTabulatorPaste();
        return;
      }
      if (mod && !e.altKey && key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        void fillRangeFromFirst();
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      // На Mac Backspace без range — clear ячейки фокуса.
      ensureRangeSelection();
      const clearable = collectCellsToClear();
      if (clearable.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void clearSelectedCells(clearable);
    },
    [
      collectCellsToClear,
      clearSelectedCells,
      fillRangeFromFirst,
      collectRangeCells,
      runTabulatorCopy,
      runTabulatorPaste,
      ensureRangeSelection,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleGridKeyDown, true);
    return () => window.removeEventListener('keydown', handleGridKeyDown, true);
  }, [handleGridKeyDown]);

  const handlePasteBuffer = useCallback(() => {
    setBusy(true);
    setMsg('');
    void navigator.clipboard
      .readText()
      .then(async (tsv) => {
        const mode1c = isTransport1cPaste(tsv);
        const parsed = mode1c ? parseTransport1cPaste(tsv) : parseTransportPaste(tsv);
        if (parsed.length === 0) {
          setMsg(mode1c ? 'В буфере 1С не нашёл строк' : 'В буфере не нашёл строк шаблона');
          return;
        }
        const res = await flowTransportPaste(api, parsed, { mode: mode1c ? '1c' : 'template' });
        const rows = await reload();
        setAllRows(rows);
        const dataWithRanks = rows
          .map((r) => ({
            ...r,
            _statusRank: printStatusGroup(r.status),
            _workRank: workKey(r.work),
            _canonSort: 0,
          }))
          .sort(cmpTransportRows);
        tableRef.current?.replaceData(dataWithRanks);
        applyOurSort();
        setMsg(`Вставлено строк: ${res.inserted ?? parsed.length}`);
      })
      .catch((err) => setMsg(`Ошибка вставки: ${String(err)}`))
      .finally(() => setBusy(false));
  }, [reload, applyOurSort]);

  const historyEntries: HistoryEntry[] = useMemo(() => {
    void historyTick;
    if (!historyPanel) return [];
    if (historyPanel === 'all') {
      return [...historyMapRef.current.values()].flat().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    }
    // Серверная история строки (иконка на строке).
    if (
      serverHistory &&
      serverHistory.rowId === historyPanel.rowId &&
      (historyPanel.field === '*' || serverHistory.field === historyPanel.field)
    ) {
      return serverHistory.entries
        .filter((e) =>
          historyPanel.field === '*'
            ? true
            : e.field === historyPanel.field || e.field === '(строка)',
        )
        .map((e) => {
          const who = (e.changedByName || e.changedBy || '').trim();
          const kind = historyKindLabel(e.kind);
          const meta = [who, kind, fmtHistWhen(e.changedAt)].filter(Boolean).join(' · ');
          return {
            rowId: e.rowId,
            field: fieldTitle(e.field),
            oldValue: e.oldValue,
            newValue: e.newValue,
            at: e.changedAt,
            who: meta,
          };
        });
    }
    return [];
  }, [historyPanel, historyTick, serverHistory]);

  const activeFacetCount = Object.values(facetSelected).reduce((n, s) => n + (s.size > 0 ? 1 : 0), 0);

  const rootClass = isGrok ? 'flow-tabulator-root pyn-table-root' : 'flow-tabulator-root';

  return (
    <div
      ref={rootRef}
      className={rootClass}
      data-pyn-table-theme={theme}
      data-col-reorder={reorderOn ? 'true' : undefined}
    >
      <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-1.5 ${isGrok ? 'pyn-table-chrome border-white/[0.06]' : 'border-black/[0.06]'}`}>
        {/* Вкладки + левый тулбар + правый — одна строка (не две полосы). */}
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
          <Popover.Root open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                title={
                  daySel.size > 0
                    ? daySel.size === 1
                      ? fmtDate([...daySel][0] ?? '')
                      : fmtDaysSummary([...daySel])
                    : monthScope
                      ? formatMonthRu(monthScope)
                      : 'Текущий месяц'
                }
                className="flow-tab-tool-btn px-2"
                data-active={daySel.size > 0 || monthScope ? 'true' : 'false'}
              >
                <CalendarDays size={14} strokeWidth={1.75} />
                Календарь
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={8} className="pyn-popover z-50 w-[300px] p-3">
                <PynCalendar
                  selected={daySel}
                  dataDays={allDaysSet}
                  resetEnabled={daySel.size > 0 || monthScope != null}
                  onChange={(next) => {
                    setDaySel(next);
                    setMonthScope(null);
                  }}
                  onReset={() => {
                    setDaySel(new Set());
                    setMonthScope(null);
                  }}
                  primaryActionLabel="Последнее"
                  onPrimaryAction={() => {
                    const n = new Date();
                    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
                    const d = nearestDataDay(allDaysSet, today) ?? today;
                    setDaySel(new Set([d]));
                    setMonthScope(null);
                  }}
                />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <FlowViewSwitch
            variant={isGrok ? 'grok' : 'default'}
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
            title="Запомнить фильтры/колонки в текущем виде (личный или общий)"
          >
            Сохранить
          </button>
          <FlowColumnsMenu
            variant={isGrok ? 'grok' : 'default'}
            columns={columnToggles}
            visible={visibleCols}
            onToggle={(id) => {
              const table = tableRef.current;
              if (!table) return;
              setVisibleCols((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  if (next.size <= 1) {
                    setMsg('Нужна хотя бы одна видимая колонка');
                    return prev;
                  }
                  next.delete(id);
                  table.hideColumn(id);
                } else {
                  next.add(id);
                  table.showColumn(id);
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
        </div>
        {/* Сообщения об операциях — не инлайн-текст (ломал раскладку кнопок, юзер 2026-08-02),
            а история в поповере: список + копирование по клику. */}
        <div className="relative flex shrink-0" ref={msgLogRef}>
          <button
            type="button"
            onClick={() => { setMsgOpen((o) => !o); setMsgFlash(false); }}
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
                  <div
                    key={m.id}
                    className="group flex items-start gap-1.5 rounded-md px-1.5 py-1 hover:bg-black/[0.03]"
                  >
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-[#3F3D38]">
                      {m.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(m.text)}
                      title="Скопировать"
                      className="shrink-0 rounded p-0.5 text-[#9B9890] opacity-0 transition-opacity hover:text-[#0A0A0A] group-hover:opacity-100"
                    >
                      <Copy size={12} strokeWidth={1.75} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div className="flow-tab-toolbar ml-auto flex shrink-0 items-center gap-0.5 p-0.5">
          <button type="button" title="Вставить из буфера (1С/шаблон)" className="flow-tab-tool-btn" disabled={busy} onClick={handlePasteBuffer}>
            <ClipboardPaste size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Добавить строку" className="flow-tab-tool-btn" disabled={busy} onClick={() => void handleAddRow()}>
            <Plus size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Удалить строку (курсор или выделение ячеек)"
            className="flow-tab-tool-btn"
            disabled={busy}
            onClick={() => void handleDeleteSelected()}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
          <span className={`mx-0.5 h-4 w-px ${isGrok ? 'bg-white/10' : 'bg-black/10'}`} />
          <button type="button" title="Жирный" className="flow-tab-tool-btn" onClick={() => applyStyleToSelection({ bold: true })}>
            <Bold size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Курсив" className="flow-tab-tool-btn" onClick={() => applyStyleToSelection({ italic: true })}>
            <Italic size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Цвет текста" className="flow-tab-tool-btn" onClick={() => promptColor('color')}>
            <Palette size={14} strokeWidth={1.75} />
          </button>
          <button type="button" title="Цвет заливки" className="flow-tab-tool-btn" onClick={() => promptColor('bg')}>
            <PaintBucket size={14} strokeWidth={1.75} />
          </button>
          <span className={`mx-0.5 h-4 w-px ${isGrok ? 'bg-white/10' : 'bg-black/10'}`} />
          {/* Печать: календарь → только «Печать» */}
          <Popover.Root
            open={printOpen}
            onOpenChange={(o) => {
              setPrintOpen(o);
              if (o) {
                setPdfOpen(false);
                preparePrintSel();
              }
            }}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                title="Печать разнарядки"
                className="flow-tab-tool-btn"
                data-active={printOpen ? 'true' : 'false'}
              >
                <Printer size={14} strokeWidth={1.75} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} className="pyn-popover z-50 w-[300px] p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Печать
                </div>
                <PynCalendar
                  selected={printSel}
                  onChange={setPrintSel}
                  dataDays={allDaysSet}
                  onReset={() => setPrintSel(new Set())}
                  resetEnabled={printSel.size > 0}
                  primaryActionLabel="Последнее"
                  onPrimaryAction={() => {
                    const n = new Date();
                    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
                    const d = nearestDataDay(allDaysSet, today) ?? today;
                    setPrintSel(new Set([d]));
                  }}
                />
                {printFooter('dialog')}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {/* PDF: календарь → ДОК · ОКАЛИНА · Скачать */}
          <Popover.Root
            open={pdfOpen}
            onOpenChange={(o) => {
              setPdfOpen(o);
              if (o) {
                setPrintOpen(false);
                preparePrintSel();
              }
            }}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                title="Скачать PDF"
                className="flow-tab-tool-btn"
                data-active={pdfOpen ? 'true' : 'false'}
              >
                <FileDown size={14} strokeWidth={1.75} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} className="pyn-popover z-50 w-[300px] p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Скачать PDF
                </div>
                <PynCalendar
                  selected={printSel}
                  onChange={setPrintSel}
                  dataDays={allDaysSet}
                  onReset={() => setPrintSel(new Set())}
                  resetEnabled={printSel.size > 0}
                  primaryActionLabel="Последнее"
                  onPrimaryAction={() => {
                    const n = new Date();
                    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
                    const d = nearestDataDay(allDaysSet, today) ?? today;
                    setPrintSel(new Set([d]));
                  }}
                />
                {printFooter('save')}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button
            type="button"
            title="Сводка по машине (рейс · склады · экспедиторы)"
            className="flow-tab-tool-btn"
            data-active={machineSheet ? 'true' : 'false'}
            onClick={handleMachineTrip}
          >
            <Truck size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="История правок ячейки / строки"
            className="flow-tab-tool-btn"
            data-active={historyPanel && historyPanel !== 'all' ? 'true' : 'false'}
            onClick={() => handleToolbarHistory()}
          >
            <History size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {panelOpen && (
          <div className="flow-tab-panel flex w-64 shrink-0 flex-col gap-3 overflow-y-auto p-2.5">
            {/* Печать / PDF / машина — боковая панель */}
            <div className="flex flex-col gap-1.5 rounded-lg border border-white/[0.08] p-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Печать
              </div>
              <button
                type="button"
                className="flow-tab-tool-btn w-full justify-start gap-2 px-2"
                onClick={() => openPrintPicker()}
              >
                <Printer size={14} strokeWidth={1.75} />
                Печать
              </button>
              <button
                type="button"
                className="flow-tab-tool-btn w-full justify-start gap-2 px-2"
                onClick={() => openPdfPicker()}
              >
                <FileDown size={14} strokeWidth={1.75} />
                Скачать PDF
              </button>
              <button
                type="button"
                className="flow-tab-tool-btn w-full justify-start gap-2 px-2"
                data-active={machineSheet ? 'true' : 'false'}
                onClick={handleMachineTrip}
              >
                <Truck size={14} strokeWidth={1.75} />
                Сводка по машине
              </button>
            </div>
            <div className="flow-tab-search flex items-center gap-1.5 rounded-md px-2 py-1.5">
              <Search size={13} className="opacity-50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Заказ, статус, работа, ТС…"
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
            {FACET_DEFS.map((def) => (
              <FacetSection
                key={def.field}
                title={def.title}
                options={facetOptions[def.field] ?? []}
                counts={facetCounts[def.field] ?? {}}
                selected={facetSelected[def.field] ?? new Set()}
                open={openSections.has(def.field)}
                onToggleOpen={() =>
                  setOpenSections((prev) => {
                    const next = new Set(prev);
                    if (next.has(def.field)) next.delete(def.field);
                    else next.add(def.field);
                    return next;
                  })
                }
                onToggleValue={(value, only) => toggleFacetValue(def.field, value, only)}
              />
            ))}
          </div>
        )}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {loading && <div className="absolute inset-0 z-20 flex items-center justify-center text-[13px] opacity-60">Загрузка Транспорта…</div>}
          <div ref={containerRef} className="h-full w-full min-w-0" />
          {historyPanel && historyPanel !== 'all' && (
            <div className="pyn-hist-sheet" role="dialog" aria-label="История">
              <div className="pyn-hist-sheet-head">
                <div className="pyn-hist-sheet-title">История</div>
                <button
                  type="button"
                  className="pyn-hist-sheet-close"
                  onClick={() => {
                    setHistoryPanel(null);
                    setServerHistory(null);
                  }}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>
              <div className="pyn-hist-sheet-body">
                {serverHistory?.loading ? (
                  <div className="pyn-hist-empty">Загрузка…</div>
                ) : historyEntries.length === 0 ? (
                  <div className="pyn-hist-empty">Пока без изменений</div>
                ) : (
                  historyEntries.map((h, i) => (
                    <div key={`${h.at}-${i}`} className="pyn-hist-item">
                      <div className="pyn-hist-col">{h.field}</div>
                      <div className="pyn-hist-change">
                        <span className="pyn-hist-old">{fmtHistValue(h.oldValue)}</span>
                        <span className="pyn-hist-arrow" aria-hidden>
                          →
                        </span>
                        <span className="pyn-hist-new">{fmtHistValue(h.newValue)}</span>
                      </div>
                      {h.who ? <div className="pyn-hist-meta">{h.who}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {garageSpec && (
            <VehicleSpecCard
              row={{
                id: garageSpec.id,
                tdate: garageSpec.tdate,
                garage_no: garageSpec.garage_no,
                work: garageSpec.work,
                time_range: garageSpec.time_range,
                status: garageSpec.status,
                comment: garageSpec.comment,
                driver: garageSpec.driver,
                driver_phone: garageSpec.driver_phone,
                expeditors: '',
                ot: '',
                sp: '',
                order_no: garageSpec.order_no,
                out_status: garageSpec.out_status,
                no_exp_status: garageSpec.no_exp ? 'ДА' : '',
                vehicle_type: garageSpec.vehicle_type,
                fact_start: garageSpec.fact_start,
                fact_end: garageSpec.fact_end,
                force_json: garageSpec.force_json || '[]',
                created_by: '',
                created_at: '',
                row_version: garageSpec.row_version,
              }}
              garage={garageSpec.garage_no}
              veh={vehiclesRef.current.find((v) => v.garage_no === garageSpec.garage_no) ?? null}
              onClose={() => setGarageSpec(null)}
              onGarageChange={(nextGarage) => {
                const r = garageSpec;
                const before = r.garage_no || '';
                const after = nextGarage.trim();
                if (!after || after === before) {
                  setGarageSpec(null);
                  return;
                }
                void (async () => {
                  try {
                    const res = await flowTransportEdit(api, [
                      { id: r.id, row_version: r.row_version, fields: { garage_no: after } as never },
                    ]);
                    if (res.conflicts.length > 0) {
                      setMsg('Конфликт версий — обновите строку');
                      return;
                    }
                    const saved = res.rows[0];
                    const veh = vehiclesRef.current.find((v) => v.garage_no === after) ?? null;
                    const patch = {
                      garage_no: after,
                      brand: veh?.model ? vehicleBrand(veh.model) : '',
                      color: veh?.color ?? '',
                      gos_no: veh?.gos_no ?? '',
                      row_version: saved?.row_version ?? r.row_version + 1,
                    };
                    rowsByIdRef.current.set(r.id, { ...r, ...patch });
                    setAllRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                    tableRef.current?.updateData([{ id: r.id, ...patch }]);
                    applyOurSort();
                    pushHistory({
                      rowId: r.id,
                      field: 'garage_no',
                      oldValue: before,
                      newValue: after,
                      at: new Date().toLocaleString('ru-RU'),
                      who: loginRef.current,
                    });
                  } catch (e) {
                    setMsg(`Ошибка гаражного: ${String(e)}`);
                  } finally {
                    setGarageSpec(null);
                  }
                })();
              }}
            />
          )}
          {driverPick && (
            <FlowDriverPickPopover
              current={driverPick.driver}
              options={driverOptionsRef.current}
              onClose={() => setDriverPick(null)}
              onPick={(o) => {
                const r = driverPick;
                void (async () => {
                  try {
                    const res = await flowTransportEdit(api, [
                      {
                        id: r.id,
                        row_version: r.row_version,
                        fields: { driver: o.fio, driver_phone: o.phone } as never,
                      },
                    ]);
                    if (res.conflicts.length > 0) {
                      setMsg('Конфликт версий — обновите строку');
                      return;
                    }
                    const saved = res.rows[0];
                    const patch = {
                      driver: o.fio,
                      driver_phone: o.phone,
                      row_version: saved?.row_version ?? r.row_version + 1,
                    };
                    rowsByIdRef.current.set(r.id, { ...r, ...patch });
                    setAllRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                    tableRef.current?.updateData([{ id: r.id, ...patch }]);
                    pushHistory({
                      rowId: r.id,
                      field: 'driver',
                      oldValue: r.driver,
                      newValue: o.fio,
                      at: new Date().toLocaleString('ru-RU'),
                      who: loginRef.current,
                    });
                  } catch (e) {
                    setMsg(`Ошибка водителя: ${String(e)}`);
                  } finally {
                    setDriverPick(null);
                  }
                })();
              }}
            />
          )}
          {forceEdit && (
            <ForceMajorModal
              row={{
                id: forceEdit.id,
                tdate: forceEdit.tdate,
                garage_no: forceEdit.garage_no,
                work: forceEdit.work,
                time_range: forceEdit.time_range,
                status: forceEdit.status,
                comment: forceEdit.comment,
                driver: forceEdit.driver,
                driver_phone: forceEdit.driver_phone,
                expeditors: '',
                ot: '',
                sp: '',
                order_no: forceEdit.order_no,
                out_status: forceEdit.out_status,
                no_exp_status: forceEdit.no_exp ? 'ДА' : '',
                vehicle_type: forceEdit.vehicle_type,
                fact_start: forceEdit.fact_start,
                fact_end: forceEdit.fact_end,
                force_json: forceEdit.force_json || '[]',
                created_by: '',
                created_at: '',
                row_version: forceEdit.row_version,
              }}
              onClose={() => setForceEdit(null)}
              onSave={(nextJson) => {
                const r = forceEdit;
                const prev = r.force_json || '[]';
                void (async () => {
                  try {
                    const res = await flowTransportEdit(api, [
                      { id: r.id, row_version: r.row_version, fields: { force_json: nextJson } as never },
                    ]);
                    if (res.conflicts.length > 0) {
                      setMsg('Конфликт версий — обновите строку');
                      return;
                    }
                    const saved = res.rows[0];
                    const summary = forceSummary(nextJson);
                    const patch = {
                      force_json: nextJson,
                      force: summary,
                      row_version: saved?.row_version ?? r.row_version + 1,
                    };
                    const updated = { ...r, ...patch };
                    rowsByIdRef.current.set(r.id, updated);
                    setAllRows((prevRows) => prevRows.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                    tableRef.current?.updateData([{ id: r.id, ...patch }]);
                    pushHistory({
                      rowId: r.id,
                      field: 'force_json',
                      oldValue: prev,
                      newValue: nextJson,
                      at: new Date().toLocaleString('ru-RU'),
                      who: loginRef.current,
                    });
                  } catch (e) {
                    setMsg(`Ошибка форс-мажора: ${String(e)}`);
                  } finally {
                    setForceEdit(null);
                  }
                })();
              }}
            />
          )}
          {timeEdit && (
            <TransportTimeModal
              title={timeEdit.field === 'fact_start' ? 'Факт начало' : 'Факт конец'}
              value={timeEdit.field === 'fact_start' ? timeEdit.row.fact_start : timeEdit.row.fact_end}
              allowClear
              onClose={() => setTimeEdit(null)}
              onSave={(value) => {
                const r = timeEdit.row;
                const field = timeEdit.field;
                const before = field === 'fact_start' ? r.fact_start : r.fact_end;
                if (value === before) {
                  setTimeEdit(null);
                  return;
                }
                void (async () => {
                  try {
                    const res = await flowTransportEdit(api, [
                      { id: r.id, row_version: r.row_version, fields: { [field]: value } as never },
                    ]);
                    if (res.conflicts.length > 0) {
                      setMsg('Конфликт версий — обновите строку');
                      return;
                    }
                    const saved = res.rows[0];
                    const patch = {
                      [field]: value,
                      row_version: saved?.row_version ?? r.row_version + 1,
                    } as Partial<Row> & { row_version: number };
                    const updated = { ...r, ...patch };
                    rowsByIdRef.current.set(r.id, updated);
                    setAllRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                    tableRef.current?.updateData([{ id: r.id, ...patch }]);
                    pushHistory({
                      rowId: r.id,
                      field,
                      oldValue: before,
                      newValue: value,
                      at: new Date().toLocaleString('ru-RU'),
                      who: loginRef.current,
                    });
                  } catch (e) {
                    setMsg(`Ошибка времени: ${String(e)}`);
                  } finally {
                    setTimeEdit(null);
                  }
                })();
              }}
            />
          )}
          {dateEdit && (
            <TransportDateModal
              value={dateEdit.tdate}
              onClose={() => setDateEdit(null)}
              onSave={(iso) => {
                const r = dateEdit;
                if (iso === r.tdate) {
                  setDateEdit(null);
                  return;
                }
                void (async () => {
                  try {
                    const res = await flowTransportEdit(api, [
                      { id: r.id, row_version: r.row_version, fields: { tdate: iso } },
                    ]);
                    if (res.conflicts.length > 0) {
                      setMsg('Конфликт версий — обновите строку');
                      return;
                    }
                    const saved = res.rows[0];
                    const patch = { tdate: iso, row_version: saved?.row_version ?? r.row_version + 1 };
                    const updated = { ...r, ...patch };
                    rowsByIdRef.current.set(r.id, updated);
                    setAllRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                    tableRef.current?.updateData([{ id: r.id, ...patch }]);
                    applyOurSort();
                    pushHistory({
                      rowId: r.id,
                      field: 'tdate',
                      oldValue: r.tdate,
                      newValue: iso,
                      at: new Date().toLocaleString('ru-RU'),
                      who: loginRef.current,
                    });
                  } catch (e) {
                    setMsg(`Ошибка даты: ${String(e)}`);
                  } finally {
                    setDateEdit(null);
                  }
                })();
              }}
            />
          )}
          {activeGarageCard && (
            <VehicleCard
              garageNo={activeGarageCard.garageNo}
              vehicle={activeGarageCard.veh}
              onClose={() => setActiveGarageCard(null)}
              onSaved={(veh) => {
                vehiclesRef.current = vehiclesRef.current.map((v) => (v.garage_no === veh.garage_no ? veh : v));
                safeReformatAll(tableRef.current);
                setActiveGarageCard(null);
              }}
            />
          )}
        </div>
      </div>

      {printJob && (
        <FlowTransportPrint
          key={printJob.id}
          days={printJob.days}
          autoMode={printJob.mode}
          rows={allRows
            .filter((r) => printJob.days.includes(r.tdate))
            .sort(
              (a, b) =>
                (a.tdate || '').localeCompare(b.tdate || '') ||
                printStatusGroup(a.status) - printStatusGroup(b.status) ||
                workKey(a.work) - workKey(b.work) ||
                (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
                a.id - b.id,
            )
            .map(rowToTransport)}
          vehByGarage={new Map(vehiclesRef.current.map((v) => [v.garage_no, v] as const))}
          driverByFio={
            new Map(
              [...driverByFio.entries()].map(([k, o]) => [
                k,
                {
                  fio: o.fio,
                  phone: o.phone,
                  phoneDisplay: formatMobilePhone(o.phone) || o.phone,
                  position: '',
                  status: '',
                  until: '',
                  color: o.color,
                  isMol: o.isMol,
                },
              ]),
            )
          }
          printDok={printDok}
          printOkalina={printOkalina}
          onClose={() => setPrintJob(null)}
          onAutoDone={(m) => {
            if (m) setMsg(m);
          }}
        />
      )}
      {machineSheet && (
        <TransportMachineSheet row={machineSheet} onClose={() => setMachineSheet(null)} />
      )}
    </div>
  );
}

/** Секция-фасет: заголовок сворачивает список; галочки в стиле pyn-tick (не native checkbox). */
function FacetSection({
  title,
  options,
  counts,
  selected,
  open,
  onToggleOpen,
  onToggleValue,
}: {
  title: string;
  options: readonly string[];
  counts: Record<string, number>;
  selected: ReadonlySet<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleValue: (value: string, only?: boolean) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="flow-tab-facet border-t pt-2 first:border-t-0 first:pt-0">
      <button type="button" onClick={onToggleOpen} className="flex w-full items-center justify-between py-1 text-left">
        <span className="text-[12px] font-medium">{title}</span>
        <span className="flex items-center gap-1">
          {selected.size > 0 && <span className="flow-tab-facet-badge rounded px-1 text-[10px]">{selected.size}</span>}
          {open ? <ChevronUp size={13} className="opacity-50" /> : <ChevronDown size={13} className="opacity-50" />}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pb-1 pt-1">
          {options.length > 4 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="flow-tab-facet-search rounded-md px-2 py-1 text-[11.5px] outline-none"
            />
          )}
          <div className="flow-tab-facet-list overflow-hidden rounded-md border">
            {filtered.map((opt, i) => {
              const on = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onToggleValue(opt)}
                  className={`group flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] ${
                    i !== filtered.length - 1 ? 'border-b' : ''
                  } ${on ? 'flow-tab-facet-item--on' : ''}`}
                >
                  <span className={`pyn-tick ${on ? 'pyn-tick--on' : 'pyn-tick--off'}`} aria-hidden>
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{opt || '—'}</span>
                  <span className="font-mono text-[10.5px] opacity-50 group-hover:hidden">{counts[opt] ?? 0}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleValue(opt, true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleValue(opt, true);
                      }
                    }}
                    className="hidden text-[10.5px] opacity-60 hover:opacity-100 group-hover:block"
                  >
                    только
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-2 py-1.5 text-[11px] opacity-50">Нет значений</div>}
          </div>
        </div>
      )}
    </div>
  );
}
