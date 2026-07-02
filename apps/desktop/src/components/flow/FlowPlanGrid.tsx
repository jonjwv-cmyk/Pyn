import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  type DataEditorRef,
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { Download, Redo2, Trash2, Undo2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { flowMolRenderer, type FlowMolCell, type FlowMolOption } from './flow-mol-cell';
import { flowMatRenderer, type FlowMatCell } from './flow-mat-cell';
import { flowHistoryRenderer, type FlowHistoryCell } from './flow-history-cell';
import { FlowAnchorHistoryCard, type FlowAnchorHistoryTarget } from './FlowAnchorHistoryCard';
import { VghEditCard } from '@/components/vgh/VghEditCard';
import { flowDriverRenderer, type FlowDriverCell, type FlowDriverOption } from './flow-driver-cell';
import { flowVehicleRenderer, type FlowVehicleCell, type FlowVehicleOption } from './flow-vehicle-cell';
import { colZeroRowSelection } from './flow-grid-selection';
import { FlowSearchPanel } from './FlowSearchPanel';
import { FlowDayPicker } from './FlowDayPicker';
import { useFlowGridSearch, type FlowSearchColumn } from './flow-grid-search';
import { FlowHeaderMenu } from './FlowHeaderMenu';
import { useFlowColumnFilters } from './flow-column-filter';
import { sedComputed, SED_LABEL } from './flow-signal';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { sessionStore } from '@/lib/token-store';
import {
  flowDeliveriesGet,
  flowDeliveryEventsGet,
  flowDeliveriesEdit,
  flowDeliveriesDelete,
  flowTransfer,
  flowWorkflowGet,
  flowWorkflowEdit,
  flowVehiclesGet,
  type FlowDeliveryRow,
  type FlowRow,
  type FlowChangedEvent,
  type FlowDeliveriesChangedEvent,
  type FlowVehicle,
  type FlowVehiclesChangedEvent,
  type VghChangedEvent,
  type VghRow,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { useMolStore } from '@/lib/stores';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons, savePerson } from '@/lib/persons-repo';
import { useVghStore, normVghKey } from '@/lib/vgh-store';
import { ensureVghLoaded, applyVghChanged } from '@/lib/vgh-repo';
import { whKey, whMapGet, whDisplay } from './flow-warehouse';
import {
  canUseLiveWarehouseScheduleForMonth,
  useScheduleMonthsMeta,
  monthKey,
} from '@/lib/schedule/use-schedule-sync';
import { molStatusKind, formatMobilePhone, molUntilStatus } from '@/lib/mol-format';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { fmtNum3, MONTH_ABBR_RU, parseMol, compactFio, matCardLines, needsWarn } from './flow-sandbox.fixtures';
import {
  exportPlanForExpeditors,
  exportPlanFull,
  exportWarehouseSheet,
  type ExportCtx,
  type FlowExportVariant,
} from './flow-export';

/**
 * Этап «План» — грид поставок (flow_deliveries). Модель «якорь + поставки»:
 * МОЛ / «кто согласовал» / комментарий показываются С ЯКОРЯ (строка формирования
 * по ключу заказ+позиция) — правка «кто согласовал» здесь пишет якорь и
 * отражается во всех видах (ТЗ §3.8). Транспорт/кол-во — поля самой поставки.
 *
 * Черновик = поставка без SAP-номера (создана «Сформировать план», ждёт
 * VL10D/zm_vl). Проверка ошибок (ТЗ §3.7, эталон buildPlanDupGh_/buildPlanAggByG_):
 * DUPLICATE — пара поставка+П/П встречается 2+ раз; ERROR — один номер поставки
 * привязан к >1 отправителю ИЛИ >1 получателю. Колонка-флаг + подсветка строки.
 */

interface PlanColSpec {
  id: string;
  title: string;
  width: number;
  editable?: boolean;
}

const PLAN_COLS: readonly PlanColSpec[] = [
  { id: 'date', title: 'DAY', width: 78 },
  { id: 'fix', title: 'FIX', width: 60 },
  // ПОСТАВКА·ЗАКАЗ — одна ячейка в 2 строки (П9): сверху поставка|П/П, снизу заказ|П/З.
  { id: 'dlvord', title: 'OBD · ORD', width: 132 },
  { id: 'trz', title: 'ТЗ', width: 86, editable: true },
  { id: 'fr', title: 'FR', width: 52 },
  { id: 'to', title: 'TO', width: 52 },
  { id: 'graph', title: 'ГРАФ', width: 56 },
  { id: 'clst', title: 'CLST', width: 64 },
  { id: 'mol', title: 'МОЛ', width: 150, editable: true },
  { id: 'approved', title: 'СОГЛ.', width: 130, editable: true },
  { id: 'no', title: 'NO. №', width: 96 },
  { id: 'mat', title: 'MAT', width: 280 },
  { id: 'uom', title: 'UoM', width: 42 },
  { id: 'qty', title: 'QTY', width: 86, editable: true },
  { id: 'kg', title: 'KG', width: 86 },
  { id: 'v', title: 'V', width: 64 },
  { id: 'exp', title: 'ЭКСПЕДИТОРЫ', width: 190, editable: true },
  { id: 'vehicleType', title: 'ТИП ТС', width: 130, editable: true },
  { id: 'vehicle', title: 'ГАРАЖНЫЙ', width: 170, editable: true },
  { id: 'note', title: 'NOTE', width: 230, editable: true },
  { id: 'flag', title: 'ПРОВЕРКА', width: 92 },
  { id: 'history', title: 'ИСТ', width: 56 },
];

/** Отчёт — те же поставки, но только зафиксированные + отметки выполнения.
 *  P4 (юзер 2026-06-14): «СТАТУС ВЫП.» и «ПРИЧИНА» — ОДНА колонка/редактор. P5: колонки
 *  «ПРОВЕРКА» (дубль/ERROR) в Отчёте нет — там одна и та же поставка, флаг ни к чему. */
const REPORT_COLS: readonly PlanColSpec[] = [
  { id: 'date', title: 'DAY', width: 78 },
  { id: 'fix', title: 'FIX', width: 60 },
  { id: 'dlvord', title: 'OBD · ORD', width: 132 },
  { id: 'fr', title: 'FR', width: 52 },
  { id: 'to', title: 'TO', width: 52 },
  { id: 'pr', title: 'PR', width: 64 },
  { id: 'graph', title: 'ГРАФ', width: 56 },
  { id: 'clst', title: 'CLST', width: 64 },
  { id: 'mol', title: 'МОЛ', width: 150 },
  { id: 'no', title: 'NO. №', width: 96 },
  { id: 'mat', title: 'MAT', width: 280 },
  { id: 'uom', title: 'UoM', width: 42 },
  { id: 'qty', title: 'QTY', width: 86 },
  { id: 'kg', title: 'KG', width: 86 },
  { id: 'v', title: 'V', width: 64 },
  { id: 'exp', title: 'ЭКСПЕДИТОРЫ', width: 190, editable: true },
  { id: 'vehicleType', title: 'ТИП ТС', width: 130, editable: true },
  { id: 'vehicle', title: 'ГАРАЖНЫЙ', width: 170, editable: true },
  { id: 'status', title: 'STAT', width: 210, editable: true },
  { id: 'note', title: 'NOTE', width: 230, editable: true },
  { id: 'request', title: 'ЗАПРОС', width: 130 },
  { id: 'history', title: 'ИСТ', width: 56 },
];

/** Причины невывоза (юзер 2026-06-14) — зеркало серверного списка (валидация). */
const FAIL_REASONS = ['нет на центральном складе', 'менее транспортной нормы', 'брак',
  'на приёмке', 'на входном контроле', 'отказ цеха', 'самовывоз', 'перенос на другой день',
  'нет МОЛа', 'иные причины'] as const;

/** ТИП ТС (юзер 2026-06-15) — НАШ маркер кузова, НЕ тянется из машины. До 3 на строку
 *  (соответствует до 3 гаражным). Хранится в поле `vehicle` (через `\n`). */
const BODY_TYPES = ['БОРТ', 'ПУЛЬМАН', 'ФУРГОН', 'ГАЗЕЛЬ'] as const;

/** Статус выполнения (юзер 2026-06-14): по умолчанию «ОЖИДАНИЕ» (пусто в БД), «выполнено»
 *  (зелёный в исходном отчёте) или ПРИЧИНА (серый, не увезено). Стереть ячейку → снова ожидание. */
const STATUS_WAIT = 'ожидание';
const STATUS_DONE = 'выполнено';
const TRANSFER_REASON = 'перенос на другой день';
/** Опции выпадашки: ожидание / выполнено / каждая причина (выбор причины = «не увезли»). */
const STATUS_OPTIONS: readonly string[] = [STATUS_WAIT, STATUS_DONE, ...FAIL_REASONS];
const EXPEDITOR_ROLE_GROUPS = new Set(['Экспедиторы', 'Водители-экспедиторы']);
const DRIVER_EXPEDITOR_ROLE = 'Водители-экспедиторы';

/** Отображаемое значение статуса из (done_stat, fail_reason). Пусто → «ожидание». */
function statusValue(r: FlowDeliveryRow): string {
  if (r.done_stat === STATUS_DONE || r.done_stat === 'увезли') return STATUS_DONE;
  if (r.fail_reason) return displayFailReason(r.fail_reason); // серый: не увезено, причина в ячейке
  if (r.done_stat === 'не увезли') return 'не увезли';
  return STATUS_WAIT; // по умолчанию — ожидание
}

/** Разбор выбранной опции статуса → поля поставки. «ожидание»/пусто → сброс в ноль. */
function decodeStatus(opt: string): { done_stat: string; fail_reason: string } {
  if (opt === STATUS_DONE) return { done_stat: STATUS_DONE, fail_reason: '' };
  if (opt === STATUS_WAIT || opt === '') return { done_stat: '', fail_reason: '' };
  return { done_stat: 'не увезли', fail_reason: opt }; // выбрана причина
}

const PLAN_RENDERERS = [flowDropdownRenderer, flowMolRenderer, flowMatRenderer, flowHistoryRenderer, flowDriverRenderer, flowVehicleRenderer];

/** Дата плана YYYY-MM-DD → «12 июня» (короткий показ в колонке). */
function fmtPlanDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

function displayFailReason(reason: string): string {
  const raw = reason.trim();
  if (!raw.startsWith(TRANSFER_REASON)) return raw;
  const m = /(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? `${TRANSFER_REASON}: ${fmtPlanDate(m[1] ?? '')}` : raw;
}

// Нормализация кода склада — единый helper для всего Потока: ./flow-warehouse
//   whKey (сравнение/ключи карт, zero-insensitive) · whMapGet (map.get) · whDisplay (показ).

/** Ключ сопоставления людей — первые два слова ФИО, как в Формировании. */
function personKey(fio: string): string {
  return fio.trim().toUpperCase().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

/** Ключ «Фамилия + первая буква имени» — для матча сокращённых имён отчёта («Черепанов Д.»)
 *  к полному ФИО роли («Черепанов Дмитрий …»). Опускаем точки/отчество. '' — нет второго слова. */
function surnameInitialKey(fio: string): string {
  const parts = fio.trim().toUpperCase().replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0]} ${(parts[1] ?? '').slice(0, 1)}`;
}

function splitMultiCell(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/\r?\n|;/)) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function deliveryExpeditors(r: FlowDeliveryRow): string[] {
  return splitMultiCell([r.exp1 || '', r.exp2 || ''].filter(Boolean).join('\n'));
}

/** Строка, созданная НАМИ руками в отчёте (перенос или ручная вставка) — её можно удалить.
 *  Строки, пришедшие автоматом при фиксации плана / сеяного импорта = «железная» база. */
function isManualRow(r: FlowDeliveryRow): boolean {
  const cb = String(r.created_by || '');
  return cb.startsWith('transfer:') || cb.startsWith('manual:');
}

function resolvePersonName(raw: string, byKey: ReadonlyMap<string, { fio: string }>): string {
  const fio = parseMol(raw)?.fio ?? raw;
  if (!fio.trim()) return '';
  return byKey.get(personKey(fio))?.fio ?? fio;
}

function parseRuDate(s: string): Date | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

function checkPersonDate(until: string | undefined, dayVal: string): 'expired' | 'not-covered' | null {
  if (!until) return null;
  if (molUntilStatus(until) === 'expired') return 'expired';
  const dd = parseIsoDate(dayVal);
  const ud = parseRuDate(until);
  return dd && ud && dd.getTime() > ud.getTime() ? 'not-covered' : null;
}

function monthOfDate(s: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return Number.isInteger(year) && Number.isInteger(month) ? { year, month } : null;
}

function frozenWeekdayOf(
  shops: ReadonlyArray<{ rows: ReadonlyArray<{ weekday: string; warehouses: ReadonlyArray<{ code: string }> }> }>,
  code: string,
): string | null {
  const target = whKey(code);
  if (!target) return null;
  for (const shop of shops) {
    for (const row of shop.rows) {
      if (row.warehouses.some((w) => whKey(w.code) === target)) return row.weekday;
    }
  }
  return null;
}

/** Число из редактора: запятая→точка, пробелы прочь. null — пусто/не число. */
function parseQty(raw: string): number | null {
  const s = raw.replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Авто-ширина + перенос по словам (П6, как в Формировании/Транспорте) ───────────
const GRID_FONT_FAMILY =
  '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MEASURE_CTX = document.createElement('canvas').getContext('2d');
const REPORT_FONT_PX = 10; // baseFontStyle грида
const REPORT_HPAD = 8; // горизонтальный padding ячейки (с запасом)
/** Колонки с мягким переносом по словам (растут в высоту, ширина клампится). */
const WRAP_COLS = new Set(['mat', 'note', 'vehicleType', 'sed']);
const PLAN_COL_FONT_PX: Record<string, number> = {
  graph: 7,
  clst: 7,
  date: 8,
  status: 8,
  kg: 8,
  v: 8,
  mol: 8,
  request: 8,
};
const PLAN_BOLD_COLS = new Set(['date', 'fr', 'to', 'pr', 'qty', 'kg', 'v', 'status']);
function planColFontPx(id: string): number {
  return PLAN_COL_FONT_PX[id] ?? REPORT_FONT_PX;
}
function isPlanBoldCol(id: string): boolean {
  return PLAN_BOLD_COLS.has(id);
}
function planCellTheme(id: string): Partial<Theme> {
  return {
    baseFontStyle: `${isPlanBoldCol(id) ? '600 ' : ''}${planColFontPx(id)}px`,
    editorFontSize: `${planColFontPx(id)}px`,
  };
}
function measurePx(s: string, font: string): number {
  if (!MEASURE_CTX) return s.length * 6;
  MEASURE_CTX.font = font;
  return MEASURE_CTX.measureText(s).width;
}
/** Сколько визуальных строк займёт text при мягком переносе по словам в ширине maxW. */
function reportWrapLines(text: string, maxW: number): number {
  if (!text) return 1;
  if (!MEASURE_CTX || maxW <= 0) return text.includes('\n') ? text.split('\n').length : 1;
  MEASURE_CTX.font = `${REPORT_FONT_PX}px ${GRID_FONT_FAMILY}`;
  let total = 0;
  for (const para of text.split('\n')) {
    if (para === '') { total += 1; continue; }
    let line = '';
    let lines = 1;
    for (const tok of para.split(/(\s+)/)) {
      const test = line + tok;
      if (MEASURE_CTX.measureText(test).width > maxW && line.trim() !== '') {
        lines += 1;
        line = tok.replace(/^\s+/, '');
      } else line = test;
    }
    total += lines;
  }
  return Math.max(1, total);
}
function wrapWordsMaxLines(text: string, maxW: number, maxLines: number): string {
  if (!text || !MEASURE_CTX || maxW <= 0) return text;
  MEASURE_CTX.font = `${REPORT_FONT_PX}px ${GRID_FONT_FAMILY}`;
  const result: string[] = [];
  const words = text.replace(/\n+/g, ' ').split(/\s+/).filter(Boolean);
  let line = '';
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const test = line ? `${line} ${word}` : word;
    const lastAllowedLine = result.length >= maxLines - 1;
    if (!lastAllowedLine && line && MEASURE_CTX.measureText(test).width > maxW) {
      result.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) result.push(line);
  return result.slice(0, maxLines).join('\n') || text;
}

// Кэш на сессию: мгновенный повторный вход (как у формирования), потом refetch.
let planDlvCache: FlowDeliveryRow[] | null = null;
let planAnchorsCache: FlowRow[] | null = null;
let planVehiclesCache: FlowVehicle[] | null = null;

type TransferTarget = 'plan' | 'report';
type PendingTransfer = {
  /** Строка-инициатор. */
  rowId: number;
  /** Номер поставки строки (для вопроса «вся поставка / позиция удалена»). */
  dlv: string;
  /** Все строки этой поставки этого дня (зафикс., не в резерве). */
  sameRowIds: number[];
  /** Что переносим (определяется после вопроса п.11). */
  ids: number[];
  /** Сохранить номер поставки (вся поставка) или очистить (позиция удалена). */
  keepDlv: boolean;
  label: string;
  /** ask — вопрос «позиция удалена из поставки?» (только если в поставке >1 строки);
   *  date — выбор дня переноса (календарь сразу, без выбора план/отчёт — он по дате). */
  step: 'ask' | 'date';
};

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FlowPlanGrid({ mode = 'plan' }: { mode?: 'plan' | 'report' }): JSX.Element {
  const COLS = mode === 'report' ? REPORT_COLS : PLAN_COLS;
  const [rows, setRows] = useState<FlowDeliveryRow[]>(() => planDlvCache ?? []);
  const [anchors, setAnchors] = useState<FlowRow[]>(() => planAnchorsCache ?? []);
  const [vehicles, setVehicles] = useState<FlowVehicle[]>(() => planVehiclesCache ?? []);
  const [loading, setLoading] = useState(() => planDlvCache === null);
  const [selection, setSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });
  const gridRef = useRef<DataEditorRef | null>(null);
  // §7-B: карточка ИЗМЕНЕНИЯ материала (вес/объём/норма) — двойной клик по NO.№ (как в
  // Формировании). Правка пересчитывает KG/V live (подписка vgh_changed). Для Плана действует
  // до фиксации; зафикс.строки/допы — снимок, не меняются.
  const [vghCard, setVghCard] = useState<{ noNum: string; mat: string; uom: string; note?: string } | null>(null);
  const openVghCard = useCallback((r: FlowDeliveryRow) => {
    setVghCard({ noNum: String(r.no_num ?? ''), mat: String(r.mat ?? ''), uom: String(r.uom ?? '') });
  }, []);
  // §5: карточка Истории движения позиции (с зоной СЭД по каждой поставке). Клик по колонке «История».
  const [historyCard, setHistoryCard] = useState<FlowAnchorHistoryTarget | null>(null);
  const openHistoryCard = useCallback((r: FlowDeliveryRow) => {
    const ord = String(r.ord ?? '').trim();
    if (!ord) return;
    setHistoryCard({ ord, it: String(r.it ?? '').trim(), mat: String(r.mat ?? ''), noNum: String(r.no_num ?? '') });
  }, []);
  // Контейнер DataEditor — также для проверки видимости вкладки в ⌘Z-хоткее.
  const measureRef = useRef<HTMLDivElement | null>(null);
  const autoDriverRoleSigRef = useRef('');
  const [msg, setMsg] = useState('');
  // Календарь выбора дня (P7): null — все дни; иначе фильтр по plan_date.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const transferMinDate = useMemo(() => isoTodayLocal(), []);

  // CLST: кластер/день доставки склада-получателя из живой базы складов.
  const whById = useWarehousesStore((st) => st.byId);
  // Стор ключует по сырому w.id — перекладываем на канон whKey (zero-insensitive), чтобы
  // поиск склада по to_wh совпадал так же, как в карте МОЛ (ТЗ §3, «нет МОЛа» одинаково).
  const whByKey = useMemo(
    () => new Map(Array.from(whById.values(), (w) => [whKey(w.id), w] as const)),
    [whById],
  );
  const scheduleMonths = useMemo(() => {
    const seen = new Set<string>();
    const out: { year: number; month: number }[] = [];
    for (const r of rows) {
      const m = monthOfDate(r.plan_date);
      if (!m) continue;
      const k = monthKey(m.year, m.month);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out;
  }, [rows]);
  const scheduleMetaMap = useScheduleMonthsMeta(scheduleMonths);
  // База ВГХ — живые КГ/V (КГ = кол-во × вес на 1 ЕИ; V = кол-во × объём).
  const vghByKey = useVghStore((s) => s.byKey);
  useEffect(() => {
    void ensureVghLoaded();
  }, []);
  // Реалтайм VGH (вес/объём/тех-имя MAT) — подписка живёт и в Плане/Отчёте, не только в
  // Формировании: правка карточки ВГХ обновляет КГ/V/MAT сразу, даже если Песочница не
  // смонтирована. Стор общий — applyVghChanged идемпотентно мержит по ключу (ТЗ §7/§1).
  useWsEvent<VghChangedEvent>('vgh_changed', (e) => {
    if (Array.isArray(e.rows)) applyVghChanged(e.rows as unknown as VghRow[]);
  });
  const molRecords = useMolStore((s) => s.records);
  const { molByWarehouse, molByKey } = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const byWh = new Map<string, FlowMolOption[]>();
    const byKey = new Map<string, { fio: string; color: string }>();
    for (const r of molRecords) {
      if (!r.fio) continue;
      const color = COLOR[molStatusKind(r.status)];
      const k = personKey(r.fio);
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
  const molsForWh = useCallback(
    (wh: string): readonly FlowMolOption[] => whMapGet(molByWarehouse, wh) ?? [],
    [molByWarehouse],
  );

  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);
  useEffect(() => {
    if (persons.length === 0 || vehicles.length === 0) return;
    const driverKeys = new Set(
      vehicles
        .map((v) => personKey(v.driver || ''))
        .filter(Boolean),
    );
    if (driverKeys.size === 0) return;
    const targets = persons.filter((p) =>
      p.isMol &&
      !p.isOrphan &&
      driverKeys.has(personKey(p.fio)) &&
      (p.broadcastGroup !== DRIVER_EXPEDITOR_ROLE || !p.broadcastEnabled),
    );
    if (targets.length === 0) return;
    const sig = targets.map((p) => `${p.id}:${p.broadcastEnabled ? 1 : 0}:${p.broadcastGroup}`).join('|');
    if (autoDriverRoleSigRef.current === sig) return;
    autoDriverRoleSigRef.current = sig;
    void Promise.allSettled(
      targets.map((p) =>
        savePerson(p.id, {
          broadcast_enabled: 1,
          broadcast_group: DRIVER_EXPEDITOR_ROLE,
          broadcast_purpose: '',
          broadcast_approval_warehouses: '[]',
        }),
      ),
    ).then((res) => {
      if (res.some((x) => x.status === 'rejected')) {
        setMsg('Не удалось автоматически назначить роль водитель-экспедитор части водителей');
      }
    });
  }, [persons, vehicles]);
  const { expeditorOptions, expeditorByKey, expeditorByInitial } = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const options: FlowDriverOption[] = [];
    const byKey = new Map<string, FlowDriverOption>();
    // Индекс «Фамилия + инициал» — матч сокращённых имён отчёта («Черепанов Д.») к роли.
    // Неоднозначные (две роли с одинаковым ключом) помечаем null → не подставляем вслепую.
    const byInitial = new Map<string, FlowDriverOption | null>();
    for (const p of persons) {
      // Роль потока = единственный квалификатор экспедитора (юзер 2026-06-14: «роль назначена,
      // но не тянет» — раньше отсекались НЕ-МОЛ экспедиторы; МОЛ для экспедитора не обязателен).
      if (!p.broadcastEnabled || !EXPEDITOR_ROLE_GROUPS.has(p.broadcastGroup)) continue;
      const phone = p.mobile || p.work || '';
      const color = COLOR[molStatusKind(p.status || '')];
      const opt: FlowDriverOption = {
        fio: p.fio,
        position: p.position || p.broadcastGroup,
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        status: p.status || '',
        color,
        isMol: p.isMol,
        until: '',
        roleGroup: p.broadcastGroup,
      };
      const k = personKey(p.fio);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, opt);
      options.push(opt);
      const ik = surnameInitialKey(p.fio);
      if (ik) byInitial.set(ik, byInitial.has(ik) ? null : opt); // дубль ключа → null (неоднозначно)
    }
    const roleRank = (o: FlowDriverOption): number => (o.roleGroup === 'Экспедиторы' ? 0 : 1);
    options.sort((a, b) => {
      const ra = roleRank(a);
      const rb = roleRank(b);
      return ra !== rb ? ra - rb : a.fio.localeCompare(b.fio, 'ru');
    });
    return { expeditorOptions: options, expeditorByKey: byKey, expeditorByInitial: byInitial };
  }, [persons]);
  // Полный справочник как опции выбора (юзер 2026-06-14: «вписать из справочника, поиск целиком
  // по ФИО или табельному; не обязан быть МОЛом/в роли — но возил»). Роль-люди сортируются ПЕРВЫМИ.
  const { allPersonOptions, allByKey } = useMemo(() => {
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const opts: FlowDriverOption[] = [];
    const byKey = new Map<string, FlowDriverOption>();
    for (const p of persons) {
      if (p.isOrphan) continue;
      const phone = p.mobile || p.work || '';
      const role = EXPEDITOR_ROLE_GROUPS.has(p.broadcastGroup) && p.broadcastEnabled ? p.broadcastGroup : '';
      const opt: FlowDriverOption = {
        fio: p.fio,
        position: p.position || role,
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        status: p.status || '',
        color: COLOR[molStatusKind(p.status || '')],
        isMol: p.isMol,
        until: '',
        roleGroup: role,
        tab: p.tab || '',
      };
      const k = personKey(p.fio);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, opt);
      opts.push(opt);
    }
    opts.sort((a, b) => {
      const ra = a.roleGroup ? 0 : 1; // роль-люди первыми
      const rb = b.roleGroup ? 0 : 1;
      return ra !== rb ? ra - rb : a.fio.localeCompare(b.fio, 'ru');
    });
    return { allPersonOptions: opts, allByKey: byKey };
  }, [persons]);
  /** Сопоставить имя экспедитора (полное ИЛИ сокращённое «Фамилия И.») с человеком справочника.
   *  Сначала роль-люди (точно/по фамилии+инициалу), затем любой из справочника по полному ФИО. */
  const resolveExpeditorOpt = useCallback(
    (name: string): FlowDriverOption | undefined => {
      const exact = expeditorByKey.get(personKey(name));
      if (exact) return exact;
      const byIni = expeditorByInitial.get(surnameInitialKey(name));
      if (byIni) return byIni;
      return allByKey.get(personKey(name)); // не роль, но из справочника (выбран вручную)
    },
    [expeditorByKey, expeditorByInitial, allByKey],
  );
  /** Имя для показа: если сокращённое имя резолвится в человека — полное ФИО, иначе как есть. */
  const expeditorDisplayName = useCallback(
    (name: string): string => resolveExpeditorOpt(name)?.fio ?? name,
    [resolveExpeditorOpt],
  );
  // Список выбора экспедитора = ВЕСЬ справочник (роль-люди сверху), поиск по ФИО/табельному.
  const expeditorsForWh = useCallback(
    (_wh: string): readonly FlowDriverOption[] => allPersonOptions,
    [allPersonOptions],
  );
  useEffect(() => {
    let alive = true;
    void flowVehiclesGet(api)
      .then((items) => {
        if (!alive) return;
        planVehiclesCache = items;
        setVehicles(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useWsEvent<FlowVehiclesChangedEvent>('flow_vehicles_changed', (e) => {
    const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowVehicle[]) : [];
    if (incoming.length === 0) return;
    setVehicles((prev) => {
      const byId = new Map(prev.map((v) => [v.garage_no, v] as const));
      for (const v of incoming) byId.set(v.garage_no, v);
      const next = [...byId.values()].sort((a, b) => (a.garage_no || '').localeCompare(b.garage_no || '', 'ru'));
      planVehiclesCache = next;
      return next;
    });
  });
  const vehicleOptions = useMemo<FlowVehicleOption[]>(
    () =>
      vehicles
        .filter((v) => (v.garage_no || '').trim())
        .map((v) => ({
          garageNo: v.garage_no,
          type: v.vtype || '',
          model: v.model || '',
          gosNo: v.gos_no || '',
          driver: v.driver || '',
        }))
        .sort((a, b) => a.garageNo.localeCompare(b.garageNo, 'ru')),
    [vehicles],
  );
  const vehicleByGarage = useMemo(() => {
    const m = new Map<string, FlowVehicleOption>();
    for (const v of vehicleOptions) m.set(v.garageNo.toUpperCase(), v);
    return m;
  }, [vehicleOptions]);

  // Загрузка: поставки + якоря (строки формирования — МОЛ/коммент/согласовал).
  useEffect(() => {
    let alive = true;
    void Promise.all([flowDeliveriesGet(api), flowWorkflowGet(api)])
      .then(([dlv, wf]) => {
        if (!alive) return;
        planDlvCache = dlv;
        planAnchorsCache = wf;
        setRows(dlv);
        setAnchors(wf);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setLoading(false);
        setMsg(`Ошибка загрузки: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Реалтайм: поставки (план сформирован / правка / резерв).
  useWsEvent<FlowDeliveriesChangedEvent>('flow_deliveries_changed', (e) => {
    setRows((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowDeliveryRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          if (Number(r.reserved) === 1) {
            byId.delete(r.id);
            continue;
          }
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      planDlvCache = next;
      return next;
    });
  });
  // Реалтайм якорей: правка МОЛ/коммента/согласовавшего в формировании видна тут.
  useWsEvent<FlowChangedEvent>('flow_changed', (e) => {
    setAnchors((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      planAnchorsCache = next;
      return next;
    });
  });

  const anchorByKey = useMemo(() => {
    const m = new Map<string, FlowRow>();
    for (const a of anchors) m.set(`${a.ord}|${a.it}`, a);
    return m;
  }, [anchors]);

  // Карта строк по id — для цепочки переноса (transfer_src) в колонке DAY (накопление дат).
  const rowById = useMemo(() => {
    const m = new Map<number, FlowDeliveryRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);
  // Цепочка дат переноса по transfer_src (старая → … → текущая). Одна дата — переноса не было.
  const transferChainDates = useCallback(
    (r: FlowDeliveryRow): string[] => {
      const dates: string[] = [];
      const seen = new Set<number>();
      let cur: FlowDeliveryRow | undefined = r;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        dates.unshift((cur.plan_date || '').slice(0, 10));
        const src: number = Number(cur.transfer_src) || 0;
        cur = src ? rowById.get(src) : undefined;
      }
      return dates;
    },
    [rowById],
  );

  // Отчёт: окно 7 дней — строки старше (сегодня−7 по дате плана) ЗАКРЫТЫ полностью
  // (ничего не правится; юзер 2026-06-12 п.2). В Плане замок не действует.
  const reportCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  // Замок 7 дней — ТОЛЬКО для admin. Разработчик (developer/superadmin) правит отчёт без ограничения
  // (юзер 2026-06-21). Роль читаем из сессии один раз.
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    let alive = true;
    void sessionStore.load().then((s) => {
      const role = String(s?.role ?? '').toLowerCase();
      if (alive) setIsDev(role === 'developer' || role === 'superadmin');
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const rowLocked = useCallback(
    (r: FlowDeliveryRow) => !isDev && mode === 'report' && (r.plan_date || '') < reportCutoff,
    [mode, reportCutoff, isDev],
  );
  const canEditMol = useCallback(
    (r: FlowDeliveryRow) => Number(r.fixation_id) === 0 || (mode === 'report' && isManualRow(r)),
    [mode],
  );
  // Удаление (юзер 2026-06-15): ПЛАН до фиксации — любой черновик (сняли поставку/пересоздали);
  // ОТЧЁТ — только руками вставленные/переносы, «железную» базу фиксации НЕ трогаем.
  const canDeleteRow = useCallback(
    (r: FlowDeliveryRow) => {
      if (rowLocked(r)) return false;
      if (mode === 'plan') return Number(r.fixation_id) === 0;
      return isManualRow(r);
    },
    [mode, rowLocked],
  );

  // База показа (порядок: день плана → группа сборки → номер поставки → материал).
  // Отчёт — только ЗАФИКСИРОВАННЫЕ строки, свежий день СВЕРХУ. Фильтры колонок и
  // колоночная сортировка накладываются ниже (viewRows).
  // Отчёт показывает ТЕКУЩИЙ месяц и будущее (переносы вперёд); прошлые месяцы
  // скрыты — «простыни» не копим (юзер 2026-07-02). Прошлое остаётся в БД/истории.
  const currentMonthPrefix = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const baseRows = useMemo(() => {
    // P3 (юзер 2026-06-14): ПЛАН = только НЕзафиксированные черновики (fixation_id===0 и не
    // в резерве). Зафиксированное и сеяный импорт отчёта (fixation_id>0) сюда не попадают.
    let out =
      mode === 'report'
        ? rows.filter(
            (r) => Number(r.fixation_id) > 0 && (r.plan_date || '').slice(0, 7) >= currentMonthPrefix,
          )
        : rows.filter((r) => Number(r.fixation_id) === 0 && Number(r.reserved) !== 1);
    // Календарь (P7): выбран день → показываем только его.
    if (selectedDay) out = out.filter((r) => (r.plan_date || '').slice(0, 10) === selectedDay);
    out.sort(
      (a, b) =>
        (mode === 'report'
          ? (b.plan_date || '').localeCompare(a.plan_date || '')
          : (a.plan_date || '').localeCompare(b.plan_date || '')) ||
        (a.grp || '').localeCompare(b.grp || '', 'ru') ||
        (a.dlv || '').localeCompare(b.dlv || '') ||
        (a.mat || '').localeCompare(b.mat || '', 'ru'),
    );
    return out;
  }, [rows, mode, selectedDay, currentMonthPrefix]);

  // Проверка ошибок (эталон buildPlanDupGh_ / buildPlanAggByG_): по SAP-номерам. Считаем
  // ТОЛЬКО по строкам ПЛАНА (fixation_id=0, не в резерве) — иначе строка-перенос в Плане и её
  // оригинал в Отчёте (тот же номер поставки) ложно светились дубликатом (юзер 2026-06-14).
  const planRowsForFlags = useMemo(
    () => rows.filter((r) => Number(r.fixation_id) === 0 && Number(r.reserved) !== 1),
    [rows],
  );
  const flagById = useMemo(() => {
    const cnt = new Map<string, number>();
    const agg = new Map<string, { fr: Set<string>; to: Set<string> }>();
    for (const r of planRowsForFlags) {
      const dlv = (r.dlv || '').trim();
      if (!dlv) continue;
      const k = `${dlv}|${(r.dlv_pos || '').trim()}`;
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
      let a = agg.get(dlv);
      if (!a) {
        a = { fr: new Set(), to: new Set() };
        agg.set(dlv, a);
      }
      if ((r.fr || '').trim()) a.fr.add((r.fr || '').trim());
      if ((r.to_wh || '').trim()) a.to.add((r.to_wh || '').trim());
    }
    const m = new Map<number, '' | 'DUPLICATE' | 'ERROR'>();
    for (const r of planRowsForFlags) {
      const dlv = (r.dlv || '').trim();
      if (!dlv) {
        m.set(r.id, '');
        continue;
      }
      const a = agg.get(dlv);
      if (a && (a.fr.size > 1 || a.to.size > 1)) m.set(r.id, 'ERROR');
      else if ((cnt.get(`${dlv}|${(r.dlv_pos || '').trim()}`) ?? 0) > 1) m.set(r.id, 'DUPLICATE');
      else m.set(r.id, '');
    }
    return m;
  }, [planRowsForFlags]);

  const draftCount = useMemo(() => rows.filter((r) => !(r.dlv || '').trim()).length, [rows]);
  const groupCount = useMemo(() => {
    const g = new Set<string>();
    for (const r of rows) g.add((r.dlv || '').trim() || `${r.plan_date}·${r.grp}`);
    return g.size;
  }, [rows]);
  const hasReportSnapshotOn = useCallback(
    (date: string): boolean =>
      rows.some((r) => Number(r.fixation_id) > 0 && Number(r.reserved) !== 1 && (r.plan_date || '').slice(0, 10) === date),
    [rows],
  );

  // Эффективное кол-во ДЛЯ ПОКАЗА: в Отчёте — фактическое из zm_vl (что реально провели), если есть;
  // иначе план. КГ/V и зависимые ячейки считаются от него. План-снимок остаётся в истории карточки.
  const effQty = useCallback(
    (r: FlowDeliveryRow): number | null => (mode === 'report' && r.fact_qty != null ? r.fact_qty : r.qty),
    [mode],
  );
  const cellText = useCallback(
    (spec: PlanColSpec, r: FlowDeliveryRow): string => {
      const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
      switch (spec.id) {
        case 'date': {
          // Накопление переноса (юзер 2026-06-15): «июн 12 → июн 15 → …» по цепочке transfer_src.
          const chain = transferChainDates(r);
          return chain.length > 1 ? chain.map(fmtPlanDate).join(' → ') : fmtPlanDate(r.plan_date);
        }
        case 'fix': {
          const b = Number(r.batch_seq) || 0;
          return b === 0 ? '' : b === 1 ? 'план' : `доп ${b}`;
        }
        case 'graph': {
          // День доставки склада из графика ТЕКУЩЕГО месяца (ТЗ §6). Нет в графике — так и пишем.
          const wh = whMapGet(whByKey, r.to_wh);
          const m = monthOfDate(r.plan_date);
          const meta = m ? scheduleMetaMap.get(monthKey(m.year, m.month)) : undefined;
          let day: string | null = null;
          if (meta?.shops.length) {
            day = frozenWeekdayOf(meta.shops, r.to_wh);
          } else if (m && canUseLiveWarehouseScheduleForMonth(m.year, m.month) && (!meta || meta.exists !== false)) {
            day = wh && Number(wh.in_schedule) === 1 ? wh.delivery_day : null;
          }
          return day || '—';
        }
        case 'clst': {
          // Только ВЫЕЗД/КХП (НТМК и прочие кластеры — пусто). День — в GRAPH (ТЗ §6).
          const c = (whMapGet(whByKey, r.to_wh)?.cluster ?? '').trim().toUpperCase();
          return c === 'ВЫЕЗД' || c === 'КХП' ? c : '';
        }
        case 'done':
          return r.done_stat || '';
        case 'reason':
          return r.fail_reason || '';
        case 'status':
          return statusValue(r);
        case 'dlv':
          return (r.dlv || '').trim() ? `${r.dlv}${(r.dlv_pos || '').trim() ? `|${r.dlv_pos}` : ''}` : 'черновик';
        case 'order':
          return `${r.ord}${r.it ? `|${r.it}` : ''}`;
        case 'dlvord': {
          // П9: одна ячейка в 2 строки — сверху поставка|П/П, снизу заказ|П/З.
          const dlv = (r.dlv || '').trim() ? `${r.dlv}${(r.dlv_pos || '').trim() ? `|${r.dlv_pos}` : ''}` : 'черновик';
          const ord = `${r.ord}${r.it ? `|${r.it}` : ''}`;
          return `${dlv}\n${ord}`;
        }
        case 'trz':
          return r.trz || '';
        case 'fr':
          return r.fr || '';
        case 'to':
          return whDisplay(r.to_wh);
        case 'pr': {
          // «Склад до» (Был/прежний получатель): зафикс. → snapshot, черновик → живьём с якоря.
          const raw = Number(r.fixation_id) > 0 ? r.snap_pr || '' : (anchor?.pr || '');
          return raw ? whDisplay(raw) : '';
        }
        case 'mol': {
          // Зафиксированное (ТЗ §3.8 / B) читает ЗАМОРОЖЕННЫЙ snapshot, черновик — живьём
          // с якоря (он мог уехать под новый заказ той же связки).
          if (Number(r.fixation_id) > 0) return resolvePersonName(r.snap_mol || '', molByKey);
          return resolvePersonName(anchor?.mol || '', molByKey);
        }
        case 'approved':
          return Number(r.fixation_id) > 0 ? r.snap_approved || '' : (anchor?.approved_by ?? '');
        case 'no':
          return r.no_num || '';
        case 'mat':
          return r.mat || '';
        case 'uom':
          // ЕИ из zm_vl/выгрузки НЕНАДЁЖНА (может писать Т вместо Л). Ориентир — БАЗА НОМЕНКЛАТУР
          // (ВГХ по no_num, как КГ/V); нет номенклатуры в базе → берём ЕИ с формирования/строки.
          return (vghByKey.get(normVghKey(r.no_num))?.uom || '').trim() || r.uom || '';
        case 'qty': {
          // Отчёт ПОДМЕНЯЕТ кол-во на ФАКТ из zm_vl (юзер 2026-06-22): что реально увезли/провели,
          // а не план. План остаётся снимком в истории карточки. Нет факта (не увезли) → план.
          const q = effQty(r);
          return q == null ? '' : fmtNum3(q);
        }
        case 'kg': {
          const q = effQty(r);
          const w = vghByKey.get(normVghKey(r.no_num))?.weight_kg;
          if (w != null && q != null) return fmtNum3(Math.round(q * w * 1000) / 1000);
          return '—';
        }
        case 'v': {
          const q = effQty(r);
          const vol = vghByKey.get(normVghKey(r.no_num))?.volume_m3;
          if (vol != null && q != null) return fmtSmart(q * vol, 3);
          return '—';
        }
        case 'exp':
          // Сокращённые имена отчёта («Черепанов Д.») резолвим в полное ФИО роли (П6/П5).
          return deliveryExpeditors(r).map(expeditorDisplayName).join('\n');
        case 'vehicleType':
          // НАШ маркер кузова (БОРТ/ПУЛЬМАН/…) из поля vehicle — НЕ тянем из машины (юзер 2026-06-15).
          return r.vehicle || '';
        case 'vehicle':
          return splitMultiCell(r.ride_id || r.vehicle || '').join('\n');
        case 'note':
          return Number(r.fixation_id) > 0 ? r.snap_note || '' : (anchor?.note ?? '');
        case 'sed': {
          // СЭД-движение документа: статус (подписан/на подписании/…) + на ком сейчас (ФИО подписанта).
          // «Нет проводки» показываем только по OPEN/ZM_VL-open (sap_open=1).
          const st = (r.sed_status || '').trim();
          const who = (r.sed_holder || '').trim();
          if (!st && !who) return '';
          const head = st ? SED_LABEL[sedComputed(st, Number(r.sap_open) === 1)] : '';
          return who ? `${head}\n${who}` : head;
        }
        case 'request':
          // ЗАПРОС (заявка) — с якоря формирования (R3.6). У сеяного импорта без якоря пусто.
          return anchor?.request ?? '';
        case 'flag':
          return flagById.get(r.id) ?? '';
        default:
          return '';
      }
    },
    [anchorByKey, vghByKey, flagById, whById, scheduleMetaMap, molByKey, vehicleByGarage, expeditorDisplayName, transferChainDates, effQty],
  );

  // ── Поиск как в Формировании (подсветка/перелёт, не фильтр) ───────────────────
  // cellText уже склеивает объединённые колонки (ПОСТАВКА = dlv|pos, ЗАКАЗ = ord|it),
  // поэтому годится и для матча, и для показа совпадения. Индексы колонок поиска = COLS.
  const specById = useMemo(() => {
    const m = new Map<string, PlanColSpec>();
    for (const c of COLS) m.set(c.id, c);
    return m;
  }, [COLS]);
  const searchRaw = useCallback(
    (r: FlowDeliveryRow, colId: string): string => {
      const spec = specById.get(colId);
      // Многострочные ячейки (ПОСТАВКА·ЗАКАЗ, экспедиторы) → одной строкой для фильтра/поиска,
      // чтобы чек-лист колонки и поиск в меню работали по поставке И заказу (П9, интерим).
      return spec ? cellText(spec, r).replace(/\n/g, ' · ') : '';
    },
    [specById, cellText],
  );
  const searchDisplay = useCallback(
    (col: FlowSearchColumn, r: FlowDeliveryRow): string => {
      const spec = specById.get(col.id);
      return spec ? cellText(spec, r) : '';
    },
    [specById, cellText],
  );
  const searchColumns = useMemo<FlowSearchColumn[]>(
    () => COLS.map((c) => ({ id: c.id, title: c.title })),
    [COLS],
  );

  // Фильтры/сортировка колонок — меню-чек-лист как в Формировании. getValue = cellText
  // (объединённые ПОСТАВКА=dlv|pos, ЗАКАЗ=ord|it уже склеены — фильтр по любому под-значению
  // через поиск в меню). Индексы searchColumns выровнены с COLS/DataEditor.columns.
  const colFilters = useFlowColumnFilters<FlowDeliveryRow>({
    columns: searchColumns,
    rows: baseRows,
    getValue: searchRaw,
  });

  // Показ = база → фильтры колонок → (колоночная сортировка перекрывает дефолтную).
  const viewRows = useMemo(
    () => colFilters.applySort(colFilters.applyFilters(baseRows)),
    [baseRows, colFilters.applyFilters, colFilters.applySort],
  );

  // hasMenu → ▾ меню колонки (фильтр/сорт). Активный фильтр — лёгкая clay-подложка.
  // Авто-ширина по содержимому (П6, как в Формировании): мерим уникальные значения
  // колонки в пикселях шрифтом грида. Колонки с переносом (МАТЕРИАЛ/КОММЕНТАРИЙ/ТИП ТС)
  // клампим, чтобы текст переносился, а не
  // раздувал колонку. Пересчёт при изменении видимых строк.
  const colWidths = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const c of COLS) {
      const fontPx = planColFontPx(c.id);
      const valFont = `${isPlanBoldCol(c.id) ? '600 ' : ''}${fontPx}px ${GRID_FONT_FAMILY}`;
      const hdrFont = `800 ${fontPx}px ${GRID_FONT_FAMILY}`;
      let px = measurePx(c.title, hdrFont) + 22; // заголовок + место под ▾
      const seen = new Set<string>();
      for (let i = 0; i < viewRows.length && seen.size < 500; i += 1) {
        const r = viewRows[i];
        if (!r) continue;
        for (const line of cellText(c, r).split('\n')) {
          if (!line) continue;
          // МОЛ в ячейке показывается КОМПАКТНО («Фамилия Имя О.»), а не полным ФИО —
          // меряем ширину по тому, что реально видно, иначе колонка раздувается (юзер 2026-06-15).
          seen.add(c.id === 'mol' ? compactFio(line) : line);
        }
      }
      for (const s of seen) px = Math.max(px, measurePx(s, valFont) + REPORT_HPAD * 2 + 4);
      // ТИП ТС/МОЛ — компактные колонки с верхним лимитом; перенос в 2 строки где нужно.
      const max =
        c.id === 'vehicleType' ? 150 : c.id === 'mol' ? 170 : WRAP_COLS.has(c.id) ? 300 : 460;
      out[c.id] = Math.round(Math.max(40, Math.min(max, px)));
    }
    return out;
  }, [COLS, viewRows, cellText]);

  const columns = useMemo<GridColumn[]>(
    () =>
      COLS.map((c) => {
        const fontPx = planColFontPx(c.id);
        const active = colFilters.activeFilterColIds.has(c.id);
        return {
          id: c.id,
          title: c.title,
          width: colWidths[c.id] ?? c.width,
          hasMenu: true,
          themeOverride: {
            headerFontStyle: `800 ${fontPx}px`,
            ...(active ? { bgHeader: '#F4E6DE', bgHeaderHovered: '#EFD9CE' } : {}),
          },
        };
      }),
    [COLS, colWidths, colFilters.activeFilterColIds],
  );

  // Переменная высота строки (П6): 2 строки для ПОСТАВКА·ЗАКАЗ / МОЛ+тел; перенос по словам
  // в МАТЕРИАЛ/КОММЕНТАРИЙ растит строку; несколько экспедиторов — строка под каждого.
  const getReportRowHeight = useCallback(
    (row: number): number => {
      const r = viewRows[row];
      if (!r) return 40;
      const LINE = 13;
      const matLines = reportWrapLines(r.mat || '', (colWidths.mat ?? 280) - REPORT_HPAD * 2);
      const noteText = Number(r.fixation_id) > 0 ? r.snap_note || '' : (anchorByKey.get(`${r.ord}|${r.it}`)?.note || '');
      const noteLines = reportWrapLines(noteText, (colWidths.note ?? 230) - REPORT_HPAD * 2);
      // ТИП ТС — наш маркер (поле vehicle, до 3 через \n); высота по числу выбранных типов.
      const vtypeLines = Math.max(1, splitMultiCell(r.vehicle || '').length);
      const expN = deliveryExpeditors(r).length;
      const cands = [
        32, // база: 2 строки ПОСТАВКА·ЗАКАЗ (телефон в ячейке убран — R3.1)
        16 + (matLines - 1) * LINE,
        16 + (noteLines - 1) * LINE,
        16 + (vtypeLines - 1) * LINE,
        expN > 1 ? expN * 16 + 4 : 0, // экспедиторы — по строке на каждого (без телефона)
      ];
      return Math.max(30, Math.min(150, Math.max(...cands)));
    },
    [viewRows, colWidths, anchorByKey, vehicleByGarage],
  );

  const gridSearch = useFlowGridSearch<FlowDeliveryRow>({
    columns: searchColumns,
    rows,
    viewRows,
    gridRef,
    getRaw: searchRaw,
    getDisplay: searchDisplay,
    setSelection,
  });

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      }
      const locked = rowLocked(r);
      if (spec.id === 'mol') {
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        const rawMol = Number(r.fixation_id) > 0 ? r.snap_mol || '' : anchor?.mol || '';
        const parsed = parseMol(rawMol);
        const rawFio = parsed?.fio ?? rawMol;
        const opts = molsForWh(r.to_wh);
        const key = personKey(rawFio);
        const selected = opts.find((o) => personKey(o.fio) === key);
        const resolved = key ? molByKey.get(key) : undefined;
        const fullFio = selected?.fio ?? resolved?.fio ?? rawFio;
        // «Нет МОЛа» ПО ФАКТУ (ТЗ §3): у склада нет валидных МОЛов → плашка на всех его живых
        // строках (как в Формировании). Зафиксированный Отчёт (snapshot) = история отправки:
        // его НЕ перекрашиваем по текущему складу — только явный текст «нет мол».
        const isSnapshot = Number(r.fixation_id) > 0;
        const hasValidMol = opts.some((o) => molUntilStatus(o.until) !== 'expired');
        const noMol =
          rawFio.toUpperCase().includes('НЕТ МОЛ') ||
          (!isSnapshot && !!String(r.to_wh ?? '').trim() && !hasValidMol);
        const cell: FlowMolCell = {
          kind: GridCellKind.Custom,
          // МОЛ в Отчёте — ВСЕГДА на ПРОСМОТР (юзер 2026-06-15: «молы просто смотрим»), даже на
          // строках старше 7 дней. Менять нельзя (onCellEdited отбивает — «только выгрузка/СЭД»);
          // 7-дневный замок к МОЛ не применяется, он не редактируется в принципе.
          allowOverlay: true,
          copyData: noMol ? 'Нет МОЛа' : fullFio,
          themeOverride: planCellTheme(spec.id),
          data: {
            kind: 'flow-mol',
            value: rawMol,
            // Показ «Фамилия Имя О.» (как просил юзер: «Черепанов Дмитрий М.»); copyData — полное.
            fio: noMol ? 'Нет МОЛа' : compactFio(fullFio),
            color: noMol ? '#E5484D' : selected?.color ?? resolved?.color ?? parsed?.color ?? '#9AA0A6',
            noMol,
            options: opts,
            // R3.1: телефон в ЯЧЕЙКЕ не показываем (только ФИО); телефон есть в выпадашке-карточке.
            phoneDisplay: '',
          },
        };
        return cell;
      }
      if (spec.id === 'mat') {
        // MAT-карточка (read-only) — те же данные, что в Формировании: Создал/Выгружен/Удалён/
        // Вывезено%/тех-имя. Источник — ЯКОРЬ (живой расчёт; до фиксации пересчёт виден везде).
        // Доступна на ВСЕХ строках (это просмотр, ограничение 7 дней не применяем). ТЗ §7.
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        const cell: FlowMatCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: r.mat ?? '',
          data: {
            kind: 'flow-mat',
            name: r.mat ?? '',
            warn: anchor ? needsWarn(anchor) : false,
            lines: anchor ? matCardLines(anchor) ?? [] : [],
          },
        };
        return cell;
      }
      if (spec.id === 'history') {
        // §5: значок Истории движения позиции (внутри — СЭД по каждой поставке). Показываем ТОЛЬКО
        // у ВЫПОЛНЕННЫХ (увезли/выполнено) — там есть движение/СЭД. У «не увезли»/без результата
        // истории-СЭД нет, значок не нужен (юзер 2026-06-21).
        const ds = String(r.done_stat || '').trim();
        if (!(r.ord || '').trim() || (ds !== 'выполнено' && ds !== 'увезли')) {
          return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
        }
        return {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: '',
          data: { kind: 'flow-history' },
        } satisfies FlowHistoryCell;
      }
      if (spec.id === 'status') {
        // P4: объединённая отметка отчёта — одна выпадашка «увезли / не увезли — <причина>».
        const v = statusValue(r);
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: v,
          themeOverride: planCellTheme(spec.id),
          data: { kind: 'flow-dropdown', value: v, options: STATUS_OPTIONS },
        };
        return cell;
      }
      if (spec.id === 'exp') {
        // Резолвим сокращённые имена отчёта в полное ФИО роли — тогда ячейка-водитель находит
        // опцию по ФИО и рисует телефон под ФИО (П5/П6). Неоднозначные остаются как есть.
        const names = deliveryExpeditors(r).map(expeditorDisplayName);
        const opt = names[0] ? resolveExpeditorOpt(names[0]) : undefined;
        const editable = !!spec.editable && !locked;
        const cell: FlowDriverCell = {
          kind: GridCellKind.Custom,
          allowOverlay: editable,
          copyData: names.join('\n'),
          themeOverride: planCellTheme(spec.id),
          data: {
            kind: 'flow-driver',
            driver: names.join('\n'),
            phone: opt?.phone ?? '',
            phoneDisplay: opt?.phoneDisplay ?? '',
            color: opt?.color ?? '#9AA0A6',
            isMol: !!opt?.isMol,
            until: opt?.until ?? '',
            drivers: expeditorsForWh(r.to_wh),
            searchPlaceholder: 'найти',
            emptyLabel: 'Нет экспедиторов',
            emptySearchLabel: 'Не найдено среди экспедиторов',
            showPhoneInCell: false,
            selectedDrivers: names,
            maxSelected: 3,
          },
        };
        return cell;
      }
      if (spec.id === 'vehicleType') {
        // ТИП ТС — наш мультимаркер кузова (до 3); правится/удаляется в окне 7 дней.
        const editable = !!spec.editable && !locked;
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: editable,
          copyData: (r.vehicle || '').replace(/\n/g, ', '),
          themeOverride: planCellTheme(spec.id),
          data: { kind: 'flow-dropdown', value: r.vehicle || '', options: BODY_TYPES as unknown as string[], multi: true, maxSelected: 3 },
        };
        return cell;
      }
      if (spec.id === 'vehicle') {
        const ids = splitMultiCell(r.ride_id || r.vehicle || '');
        const cell: FlowVehicleCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !!spec.editable && !locked,
          copyData: ids.join('\n'),
          themeOverride: planCellTheme(spec.id),
          data: {
            kind: 'flow-vehicle',
            value: ids.join('\n'),
            selected: ids,
            vehicles: vehicleOptions,
            maxSelected: 3,
          },
        };
        return cell;
      }
      const text = cellText(spec, r);
      const displayText =
        spec.id === 'vehicleType'
          ? wrapWordsMaxLines(text, (colWidths.vehicleType ?? 130) - REPORT_HPAD * 2, 2)
          : text;
      const editable = !!spec.editable && !locked;
      // Перенос по словам (П6) — МАТЕРИАЛ/КОММЕНТАРИЙ; ПОСТАВКА·ЗАКАЗ — 2 строки через \n.
      // ТИП ТС переносим сами по словам в 2 строки, чтобы Glide не резал буквы.
      const wrap = (WRAP_COLS.has(spec.id) && spec.id !== 'vehicleType') || spec.id === 'dlvord';
      return {
        kind: GridCellKind.Text,
        data: spec.id === 'qty' ? (r.qty == null ? '' : String(r.qty).replace('.', ',')) : displayText,
        displayData: displayText,
        allowOverlay: editable,
        readonly: !editable,
        allowWrapping: wrap,
        themeOverride: planCellTheme(spec.id),
        contentAlign: spec.id === 'qty' || spec.id === 'kg' || spec.id === 'v' ? 'right' : 'left',
      };
    },
    [viewRows, cellText, COLS, rowLocked, anchorByKey, molsForWh, molByKey, colWidths, expeditorsForWh, resolveExpeditorOpt, expeditorDisplayName, vehicleOptions, canEditMol],
  );

  /** Применить серверные строки поставок (ответ правки/конфликта). */
  const applyServerDlv = useCallback((serverRows: FlowDeliveryRow[]) => {
    if (serverRows.length === 0) return;
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r] as const));
      for (const r of serverRows) {
        if (Number(r.reserved) === 1) byId.delete(r.id);
        else byId.set(r.id, r);
      }
      const next = [...byId.values()];
      planDlvCache = next;
      return next;
    });
  }, []);

  // ── Отмена/повтор правок (⌘Z / ⌘⇧Z, кнопки) — как в Формировании/Транспорте ───
  // Покрывает ПРАВКИ ПОЛЕЙ ПОСТАВКИ (qty/trz/exp1/exp2/vehicle/ride/done/reason).
  // «Согласовал» — поле ЯКОРЯ (другая таблица) → в историю НЕ кладём (правится из всех
  // видов). Удаление (резерв) тоже отдельно. rowsRef — свежий row_version при применении.
  const rowsRef = useRef<FlowDeliveryRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  type PlanEdit = { id: number; before: Record<string, string | number | null>; after: Record<string, string | number | null> };
  const undoRef = useRef<PlanEdit[]>([]);
  const redoRef = useRef<PlanEdit[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const syncHistory = useCallback(() => {
    setHistory({ canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0 });
  }, []);

  // Применить набор полей к поставке (оптимистично + сервер) БЕЗ записи в историю — общий
  // путь для правки и для отмены/повтора. row_version берём актуальный из rowsRef.
  const applyDlvFields = useCallback(
    (id: number, fields: Record<string, string | number | null>) => {
      const cur = rowsRef.current.find((x) => x.id === id);
      if (!cur) return;
      if (rowLocked(cur)) {
        setMsg('Старше 7 дней — отчёт закрыт, правки заблокированы');
        return;
      }
      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) => (x.id === id ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
        planDlvCache = next;
        rowsRef.current = next;
        return next;
      });
      void flowDeliveriesEdit(api, [{ id, row_version: cur.row_version, fields }]).then((res) =>
        applyServerDlv(res.rows),
      );
    },
    [applyServerDlv, rowLocked],
  );

  // Снимок текущих значений изменяемых полей (ключи fields = имена колонок строки).
  const captureBefore = useCallback(
    (r: FlowDeliveryRow, fields: Record<string, string | number | null>) => {
      const before: Record<string, string | number | null> = {};
      const rec = r as unknown as Record<string, unknown>;
      for (const k of Object.keys(fields)) {
        const v = rec[k];
        before[k] = (v === undefined ? null : v) as string | number | null;
      }
      return before;
    },
    [],
  );
  const pushHistory = useCallback(
    (e: PlanEdit) => {
      undoRef.current.push(e);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = []; // новый шаг обнуляет «повтор»
      syncHistory();
    },
    [syncHistory],
  );
  const undo = useCallback(() => {
    const e = undoRef.current.pop();
    if (!e) return;
    applyDlvFields(e.id, e.before);
    redoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, syncHistory]);
  const redo = useCallback(() => {
    const e = redoRef.current.pop();
    if (!e) return;
    applyDlvFields(e.id, e.after);
    undoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, syncHistory]);

  const applyAnchorFields = useCallback(
    (anchor: FlowRow, fields: Record<string, string | number | null>) => {
      setAnchors((prev) => {
        const next = prev.map((a) => (a.id === anchor.id ? ({ ...a, ...fields } as FlowRow) : a));
        planAnchorsCache = next;
        return next;
      });
      void flowWorkflowEdit(api, [
        { id: anchor.id, row_version: anchor.row_version, fields },
      ]).then((res) => {
        if (res.rows.length > 0) {
          setAnchors((prev) => {
            const byId = new Map(prev.map((a) => [a.id, a] as const));
            for (const a of res.rows) byId.set(a.id, a);
            const next = [...byId.values()];
            planAnchorsCache = next;
            return next;
          });
        }
      });
    },
    [],
  );

  const resolveMolForRow = useCallback(
    (r: FlowDeliveryRow, raw: string): { value: string; error?: string } => {
      const fioStr = String(raw ?? '').trim();
      if (!fioStr) return { value: '' };
      const wantKey = personKey(parseMol(fioStr)?.fio ?? fioStr);
      const opts = molsForWh(r.to_wh);
      const opt = opts.find((o) => personKey(o.fio) === wantKey);
      if (!opt) {
        return {
          value: '',
          error: `${resolvePersonName(fioStr, molByKey) || fioStr} не может быть МОЛом на складе ${whDisplay(r.to_wh) || '(склад не задан)'}`,
        };
      }
      const contract = checkPersonDate(opt.until, r.plan_date || '');
      if (contract === 'expired') {
        return { value: '', error: `Срок ПМО для ${opt.fio} истёк${opt.until ? ` — ${opt.until}` : ''}` };
      }
      if (contract === 'not-covered') {
        return { value: '', error: `Срок ПМО для ${opt.fio} не покрывает дату доставки` };
      }
      return { value: opt.fio };
    },
    [molsForWh, molByKey],
  );

  const resolveExpeditorsForRow = useCallback(
    (r: FlowDeliveryRow, raw: string): { value: string; error?: string } => {
      const values = splitMultiCell(raw);
      if (values.length === 0) return { value: '' };
      if (values.length > 3) return { value: '', error: 'Можно выбрать не больше трёх экспедиторов' };
      const opts = expeditorsForWh(r.to_wh);
      const out: string[] = [];
      for (const fioStr of values) {
        const wantKey = personKey(fioStr);
        const opt = opts.find((o) => personKey(o.fio) === wantKey);
        if (!opt) {
          return {
            value: '',
            error: `${fioStr} не найден в справочнике контактов`,
          };
        }
        out.push(opt.fio);
      }
      return { value: out.join('\n') };
    },
    [expeditorsForWh],
  );

  // ⌘Z / ⌘⇧Z (Ctrl на Win) — кроме случая когда фокус в поле ввода (там Cmd+Z правит текст).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
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
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r || !spec.editable) return;
      if (rowLocked(r)) {
        setMsg('Старше 7 дней — отчёт закрыт, правки заблокированы');
        return;
      }
      // Объединённая отметка отчёта приходит из выпадашки (custom cell) — P4.
      if (newValue.kind === GridCellKind.Custom) {
        const data = newValue.data as { kind?: string; value?: string; driver?: string } | undefined;
        if (!data) return;
        if (spec.id === 'status' && data.kind === 'flow-dropdown') {
          const value = String(data.value ?? '');
          if (value === TRANSFER_REASON) {
            const dlv = (r.dlv || '').trim();
            const sameDeliveryRows = dlv
              ? rows.filter((x) =>
                  Number(x.fixation_id) > 0 &&
                  Number(x.reserved) !== 1 &&
                  (x.dlv || '').trim() === dlv &&
                  (x.plan_date || '').slice(0, 10) === (r.plan_date || '').slice(0, 10),
                )
              : [r];
            if (sameDeliveryRows.some((x) => rowLocked(x))) {
              setMsg('Поставка содержит закрытые строки отчёта — перенос заблокирован');
              return;
            }
            const sameRowIds = sameDeliveryRows.map((x) => x.id);
            // П.11: поставка из >1 строки → спросить «позиция удалена из поставки?». Иначе
            // (одна строка или черновик) — сразу к выбору дня (вся поставка, номер сохраняем).
            const multi = !!dlv && sameRowIds.length > 1;
            setPendingTransfer({
              rowId: r.id,
              dlv,
              sameRowIds,
              ids: multi ? sameRowIds : [r.id],
              keepDlv: true,
              label: dlv ? `поставка ${dlv}` : `1 строка · ${whDisplay(r.to_wh) || r.to_wh || ''}`,
              step: multi ? 'ask' : 'date',
            });
            setMsg('');
            return;
          }
          const { done_stat, fail_reason } = decodeStatus(value);
          const fields: Record<string, string | number | null> = { done_stat, fail_reason };
          // R3.8 ПРИНЦИП ЕДИНОГО ДОКУМЕНТА: поставка — один документ. Нельзя одну позицию отметить,
          // а другие нет → статус применяем КО ВСЕЙ поставке (все позиции dlv того дня). Частично =
          // сначала удали лишние позиции из поставки в Плане (перенос «позиция удалена»), потом отметь.
          const dlv = (r.dlv || '').trim();
          const day = (r.plan_date || '').slice(0, 10);
          const targets = dlv
            ? rows.filter(
                (x) =>
                  Number(x.fixation_id) > 0 &&
                  Number(x.reserved) !== 1 &&
                  (x.dlv || '').trim() === dlv &&
                  (x.plan_date || '').slice(0, 10) === day &&
                  !rowLocked(x),
              )
            : [r];
          const ts = targets.filter((t) => {
            const b = captureBefore(t, fields);
            return Object.keys(fields).some((k) => String(b[k] ?? '') !== String(fields[k] ?? ''));
          });
          if (ts.length === 0) return;
          setRows((prev) => {
            const ids = new Set(ts.map((t) => t.id));
            const next = prev.map((x) => (ids.has(x.id) ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
            planDlvCache = next;
            rowsRef.current = next;
            return next;
          });
          void flowDeliveriesEdit(
            api,
            ts.map((t) => ({ id: t.id, row_version: t.row_version, fields })),
          ).then((res) => applyServerDlv(res.rows));
          // История — на инициирующую строку (отмена статуса), остальные правятся тем же значением.
          pushHistory({ id: r.id, before: captureBefore(r, fields), after: fields });
          if (dlv && ts.length > 1) setMsg(`Статус применён ко всей поставке ${dlv} (${ts.length} поз.)`);
          return;
        }
        if (spec.id === 'mol' && data.kind === 'flow-mol') {
          if (Number(r.fixation_id) > 0) {
            if (!isManualRow(r)) {
              setMsg('МОЛ отчёта меняется только через СЭД или у строк, добавленных/перенесённых руками');
              return;
            }
            const resolved = resolveMolForRow(r, String(data.value ?? ''));
            if (resolved.error) {
              setMsg(resolved.error);
              return;
            }
            const fields: Record<string, string | number | null> = { snap_mol: resolved.value };
            const before = captureBefore(r, fields);
            const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
            if (!changed) return;
            setMsg('');
            applyDlvFields(r.id, fields);
            pushHistory({ id: r.id, before, after: fields });
            return;
          }
          const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
          if (!anchor) {
            setMsg('Не нашёл позицию формирования для этой поставки');
            return;
          }
          const resolved = resolveMolForRow(r, String(data.value ?? ''));
          if (resolved.error) {
            setMsg(resolved.error);
            return;
          }
          if (String(anchor.mol ?? '') === resolved.value) return;
          setMsg('');
          applyAnchorFields(anchor, { mol: resolved.value });
          return;
        }
        if (spec.id === 'exp' && data.kind === 'flow-driver') {
          const resolved = resolveExpeditorsForRow(r, String(data.driver ?? ''));
          if (resolved.error) {
            setMsg(resolved.error);
            return;
          }
          const fields: Record<string, string | number | null> = { exp1: resolved.value, exp2: '' };
          const before = captureBefore(r, fields);
          const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
          if (!changed) return;
          setMsg('');
          applyDlvFields(r.id, fields);
          pushHistory({ id: r.id, before, after: fields });
          return;
        }
        if (spec.id === 'vehicleType' && data.kind === 'flow-dropdown') {
          // ТИП ТС — наш маркер кузова (до 3), НЕ из машины. Пишем в vehicle, ride_id не трогаем.
          const types = splitMultiCell(String(data.value ?? ''));
          if (types.length > 3) {
            setMsg('Можно выбрать не больше трёх типов ТС');
            return;
          }
          const fields: Record<string, string | number | null> = { vehicle: types.join('\n') };
          const before = captureBefore(r, fields);
          if (String(before.vehicle ?? '') === fields.vehicle) return;
          setMsg('');
          applyDlvFields(r.id, fields);
          pushHistory({ id: r.id, before, after: fields });
          return;
        }
        if (spec.id === 'vehicle' && data.kind === 'flow-vehicle') {
          const ids = splitMultiCell(String(data.value ?? ''));
          if (ids.length > 3) {
            setMsg('Можно выбрать не больше трёх машин');
            return;
          }
          const known = new Set(vehicleOptions.map((v) => v.garageNo.toUpperCase()));
          const missing = ids.find((id) => !known.has(id.toUpperCase()));
          if (missing) {
            setMsg(`Машины ${missing} нет в базе транспорта`);
            return;
          }
          // ГАРАЖНЫЙ пишет ТОЛЬКО ride_id — ТИП ТС (vehicle) теперь НАШ независимый маркер.
          const fields: Record<string, string | number | null> = { ride_id: ids.join('\n') };
          const before = captureBefore(r, fields);
          const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
          if (!changed) return;
          setMsg('');
          applyDlvFields(r.id, fields);
          pushHistory({ id: r.id, before, after: fields });
          return;
        }
        return;
      }
      if (newValue.kind !== GridCellKind.Text) return;
      const raw = String(newValue.data ?? '').trim();

      if (spec.id === 'mol') {
        if (Number(r.fixation_id) > 0) {
          if (!isManualRow(r)) {
            setMsg('МОЛ отчёта меняется только через СЭД или у строк, добавленных/перенесённых руками');
            return;
          }
          const resolved = resolveMolForRow(r, raw);
          if (resolved.error) {
            setMsg(resolved.error);
            return;
          }
          const fields: Record<string, string | number | null> = { snap_mol: resolved.value };
          const before = captureBefore(r, fields);
          const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
          if (!changed) return;
          setMsg('');
          applyDlvFields(r.id, fields);
          pushHistory({ id: r.id, before, after: fields });
          return;
        }
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (!anchor) {
          setMsg('Не нашёл позицию формирования для этой поставки');
          return;
        }
        const resolved = resolveMolForRow(r, raw);
        if (resolved.error) {
          setMsg(resolved.error);
          return;
        }
        if (String(anchor.mol ?? '') === resolved.value) return;
        setMsg('');
        applyAnchorFields(anchor, { mol: resolved.value });
        return;
      }

      if (spec.id === 'approved') {
        // «Кто согласовал» — поле ЯКОРЯ: пишем строку формирования (отразится во всех видах).
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (!anchor) {
          setMsg('Не нашёл позицию формирования для этой поставки');
          return;
        }
        applyAnchorFields(anchor, { approved_by: raw });
        return;
      }

      if (spec.id === 'note') {
        // Комментарий (юзер 2026-06-15): ОТЧЁТ — правим snap_note строки в окне 7 дней (rowLocked
        // уже отбил старше; сервер пускает snap_note на зафикс. строку). ПЛАН — комментарий ЯКОРЯ.
        if (Number(r.fixation_id) > 0) {
          const fields: Record<string, string | number | null> = { snap_note: raw };
          const before = captureBefore(r, fields);
          if (String(before.snap_note ?? '') === raw) return;
          setMsg('');
          applyDlvFields(r.id, fields);
          pushHistory({ id: r.id, before, after: fields });
          return;
        }
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (!anchor) {
          setMsg('Не нашёл позицию формирования для этой поставки');
          return;
        }
        if (String(anchor.note ?? '') === raw) return;
        setMsg('');
        applyAnchorFields(anchor, { note: raw });
        return;
      }

      // Поля самой поставки. Кол-во валидируем ДО оптимистичного показа.
      const fields: Record<string, string | number | null> = {};
      if (spec.id === 'qty') {
        if (Number(r.fixation_id) > 0) {
          setMsg('Состав зафиксирован — кол-во не меняется (свободны машина/экспедиторы/ID)');
          return;
        }
        const n = raw === '' ? null : parseQty(raw);
        if (raw !== '' && (n == null || n < 0)) {
          setMsg(`«${raw}» — не число`);
          return;
        }
        fields.qty = n;
      } else if (spec.id === 'trz') fields.trz = raw;
      else if (spec.id === 'exp') {
        const resolved = resolveExpeditorsForRow(r, raw);
        if (resolved.error) {
          setMsg(resolved.error);
          return;
        }
        fields.exp1 = resolved.value;
        fields.exp2 = '';
      }
      else if (spec.id === 'vehicleType') {
        // ТИП ТС — наш маркер кузова (текстовая вставка/ввод): пишем в vehicle, до 3.
        const types = splitMultiCell(raw);
        if (types.length > 3) {
          setMsg('Можно выбрать не больше трёх типов ТС');
          return;
        }
        fields.vehicle = types.join('\n');
      }
      else if (spec.id === 'vehicle') {
        const ids = splitMultiCell(raw);
        if (ids.length > 3) {
          setMsg('Можно выбрать не больше трёх машин');
          return;
        }
        const known = new Set(vehicleOptions.map((v) => v.garageNo.toUpperCase()));
        const missing = ids.find((id) => !known.has(id.toUpperCase()));
        if (missing) {
          setMsg(`Машины ${missing} нет в базе транспорта`);
          return;
        }
        // ГАРАЖНЫЙ пишет только ride_id; ТИП ТС (vehicle) — отдельный маркер.
        fields.ride_id = ids.join('\n');
      }
      else return;

      const before = captureBefore(r, fields);
      const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
      if (!changed) return;
      applyDlvFields(r.id, fields);
      pushHistory({ id: r.id, before, after: fields });
    },
    [
      COLS,
      rows,
      viewRows,
      anchorByKey,
      applyDlvFields,
      applyAnchorFields,
      applyServerDlv,
      captureBefore,
      pushHistory,
      rowLocked,
      resolveMolForRow,
      resolveExpeditorsForRow,
      vehicleOptions,
      vehicleByGarage,
    ],
  );

  const onCellsEdited = useCallback(
    (edits: readonly { location: Item; value: EditableGridCell }[]) => {
      for (const e of edits) onCellEdited(e.location, e.value);
      return true;
    },
    [onCellEdited],
  );

  // §7-B: двойной клик (Enter) по НОМЕНКЛАТУРЕ (NO.№) → карточка изменения материала.
  const onCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (spec.id === 'no') openVghCard(r);
      else if (spec.id === 'history') openHistoryCard(r);
    },
    [COLS, viewRows, openVghCard, openHistoryCard],
  );

  // Подсветка строк: ERROR — красная, DUPLICATE — янтарная, черновик — чуть приглушён.
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      // P5: дубль/ERROR-подсветка — только в Плане (в Отчёте поставка одна и та же).
      if (mode === 'plan') {
        const flag = flagById.get(r.id) ?? '';
        if (flag === 'ERROR') return { bgCell: '#FBE3E0', textDark: '#8A1F11' };
        if (flag === 'DUPLICATE') return { bgCell: '#FCEFD9', textDark: '#7A4B0F' };
        // «Нет МОЛа» по факту (ТЗ §3): у склада нет валидных МОЛов → красим строку (живой план).
        const wh = String(r.to_wh ?? '').trim();
        if (wh && !molsForWh(wh).some((o) => molUntilStatus(o.until) !== 'expired')) {
          return { bgCell: '#FBE3E0', textDark: '#7C1812' };
        }
      }
      if (mode === 'report') {
        // Зеркало исходного отчёта: выполнено = зелёный, причина (не увезено) = серый,
        // ожидание (по умолчанию) = нейтральный.
        if (r.done_stat === STATUS_DONE || r.done_stat === 'увезли') return { bgCell: '#EAF5EA' };
        if (r.fail_reason || r.done_stat === 'не увезли') return { bgCell: '#F0F0EE', textDark: '#6B6862' };
        if (rowLocked(r)) return { textDark: '#8C8983' }; // закрытый отчёт (>7 дней) — приглушён
      }
      if (!(r.dlv || '').trim()) return { textDark: '#5A5752' };
      return undefined;
    },
    [viewRows, flagById, mode, rowLocked, molsForWh],
  );

  const selectedCount = selection.rows.length;
  /** Массовая отметка отчёта (ТЗ §5.1): одно значение на все выделенные строки,
   *  БЕЗ привязки к складу — выбрал → протянулось. Причина чистится при «увезли». */
  // Применить статус ко ВСЕМ выделенным строкам разом (массовая отметка + вставка значения
  // статуса из буфера). Замок 7 дней уважаем. `done_stat:''` = сброс в ожидание.
  const applyStatusToSelected = useCallback(
    (fields: { done_stat: string; fail_reason: string }) => {
      const targets: FlowDeliveryRow[] = [];
      let lockedHit = false;
      for (const idx of selection.rows) {
        const r = viewRows[idx];
        if (!r) continue;
        if (rowLocked(r)) {
          lockedHit = true;
          continue;
        }
        targets.push(r);
      }
      if (lockedHit) setMsg('Часть строк старше 7 дней — отчёт по ним закрыт');
      if (targets.length === 0) return;
      if (!lockedHit) setMsg('');
      setRows((prev) => {
        const ids = new Set(targets.map((t) => t.id));
        const next = prev.map((x) => (ids.has(x.id) ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
        planDlvCache = next;
        return next;
      });
      void flowDeliveriesEdit(
        api,
        targets.map((t) => ({ id: t.id, row_version: t.row_version, fields })),
      ).then((res) => applyServerDlv(res.rows));
    },
    [selection, viewRows, applyServerDlv, rowLocked],
  );
  const massMark = useCallback(
    (done: 'выполнено' | 'не увезли', reason: string) =>
      applyStatusToSelected({ done_stat: done, fail_reason: done === 'не увезли' ? reason : '' }),
    [applyStatusToSelected],
  );
  // Вставка из буфера в колонку СТАТУС: одно скопированное значение → на ВСЕ выделенные строки
  // (юзер 2026-06-15: «копирую, выделяю другие строки, вставляю — а идёт только на одну»). Перенос
  // вставкой не копируем (у него своя дата-логика через ячейку). Прочие колонки — стандартная Glide.
  const onPaste = useCallback(
    (target: readonly [number, number], values: readonly (readonly string[])[]): boolean => {
      const spec = COLS[target[0]];
      const pasted = String(values?.[0]?.[0] ?? '').trim();
      if (spec?.id === 'status' && selection.rows.length > 1 && pasted) {
        if (pasted.startsWith(TRANSFER_REASON)) {
          setMsg('Перенос вставкой не копируется — задайте через ячейку статуса');
          return false;
        }
        applyStatusToSelected(decodeStatus(pasted));
        return false; // обработали сами — Glide не вставляет
      }
      return true; // остальное — обычная вставка диапазона Glide
    },
    [COLS, selection, applyStatusToSelected],
  );
  const deleteSelected = useCallback(() => {
    const ids: number[] = [];
    let blocked = 0;
    for (const idx of selection.rows) {
      const r = viewRows[idx];
      if (!r) continue;
      if (canDeleteRow(r)) ids.push(r.id);
      else blocked++;
    }
    if (ids.length === 0) {
      setMsg(
        blocked > 0
          ? mode === 'report'
            ? 'Это база фиксации — удаляются только руками вставленные строки/переносы'
            : 'Старше 7 дней — отчёт закрыт, удаление заблокировано'
          : '',
      );
      return;
    }
    if (blocked > 0) {
      setMsg(`Удалено ${ids.length}; ${blocked} — база фиксации, пропущены`);
    }
    // Резерв (не стирание): позиции снова открыты → вернутся в формирование.
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      planDlvCache = next;
      return next;
    });
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    void flowDeliveriesDelete(api, ids).catch(() => undefined);
  }, [selection, viewRows, canDeleteRow, mode]);

  const transferIds = useCallback(
    (ids: readonly number[], toDate: string | null, target: TransferTarget = 'plan', keepDlv = true) => {
      if (!toDate || ids.length === 0) return;
      if (toDate < transferMinDate) {
        setMsg('Перенос в прошлую дату запрещён');
        return;
      }
      if (target === 'report' && !hasReportSnapshotOn(toDate)) {
        setMsg('В этот день ещё нет слепка отчёта — выберите день с отчётом или перенос в План');
        return;
      }
      setMsg('');
      void flowTransfer(api, [...ids], toDate, target, keepDlv)
        .then((res) => {
          applyServerDlv(res.rows);
          setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
          setPendingTransfer(null);
          if (mode === 'plan' || target === 'report') setSelectedDay(toDate);
          setMsg(
            target === 'report'
              ? `Перенесено строк: ${res.transferred}. Строка создана в Отчёте на ${fmtPlanDate(toDate)}`
              : mode === 'report'
                ? `Перенесено строк: ${res.transferred}. Черновик создан в Плане на ${fmtPlanDate(toDate)}`
              : `Перенесено строк: ${res.transferred}`,
          );
        })
        .catch((e) => {
          const text = e instanceof Error ? e.message : String(e);
          setMsg(`Не удалось перенести: ${text.slice(0, 90)}`);
        });
    },
    [applyServerDlv, hasReportSnapshotOn, mode, transferMinDate],
  );

  const commitPendingTransfer = useCallback(
    (toDate: string | null) => {
      if (!pendingTransfer || !toDate) return;
      // Цель — по дате (п.2): день с уже готовым слепком отчёта → в Отчёт, иначе → в План.
      const target: TransferTarget = hasReportSnapshotOn(toDate) ? 'report' : 'plan';
      transferIds(pendingTransfer.ids, toDate, target, pendingTransfer.keepDlv);
    },
    [pendingTransfer, transferIds, hasReportSnapshotOn],
  );

  // Размер контейнера для DataEditor.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridTheme = useMemo<Partial<Theme>>(
    () => ({
      ...FLOW_GRID_THEME,
      baseFontStyle: '10px',
      headerFontStyle: '800 10px',
      editorFontSize: '10px',
    }),
    [],
  );
  const exportCtx = useMemo<ExportCtx>(
    () => ({ anchorByKey, vghByKey, whById }),
    [anchorByKey, vghByKey, whById],
  );
  const runExport = useCallback(
    (variant: FlowExportVariant) => {
      if (viewRows.length === 0) {
        setMsg(mode === 'report' ? 'Отчёт пуст — нечего выгружать' : 'План пуст — нечего выгружать');
        return;
      }
      if (variant === 'full') exportPlanFull(viewRows, exportCtx, mode === 'report');
      else if (variant === 'expeditors') exportPlanForExpeditors(viewRows, exportCtx);
      else exportWarehouseSheet(viewRows, exportCtx);
      setMsg('');
    },
    [exportCtx, mode, viewRows],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        {/* Отмена / Повтор правок поставки (как в Формировании/Транспорте) — ⌘Z / ⌘⇧Z. */}
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
        {/* Календарь дня (P7): статусы дней — красный черновики / зелёный фиксация / смешанный.
            В Отчёте прошлые месяцы скрыты из вида → и в календаре недоступны (юзер 2026-07-02). */}
        <FlowDayPicker
          mode={mode}
          rows={rows}
          selected={selectedDay}
          onSelect={setSelectedDay}
          {...(mode === 'report'
            ? { minDate: `${currentMonthPrefix}-01`, disabledTitle: 'прошлый месяц скрыт из отчёта' }
            : {})}
        />
        <div className="flex items-center gap-1">
          <Download size={13} strokeWidth={1.75} />
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as FlowExportVariant | '';
              if (v) runExport(v);
              e.target.value = '';
            }}
            title="Выгрузить текущий вид в Excel-совместимый CSV"
            className="h-6 max-w-[168px] rounded-md border border-black/10 bg-transparent px-1 text-[12px] text-[#3F3D38] outline-none transition-colors hover:border-black/25"
          >
            <option value="" disabled>
              Экспорт…
            </option>
            <option value="expeditors">Экспедиторам</option>
            <option value="full">{mode === 'report' ? 'Отчёт полный' : 'План полный'}</option>
            <option value="warehouse">Кладовщикам</option>
          </select>
        </div>
        <span className="tabular-nums">
          {rows.length} строк · {groupCount} поставок
          {draftCount > 0 ? ` · черновиков ${draftCount}` : ''}
        </span>
        <span className="text-[#6B6862]/60">
          {mode === 'report'
            ? 'Отчёт — зафиксированные поставки: отметьте «увезли / не увезли» (+причина)'
            : 'МОЛ · согласовал · комментарий — с позиции формирования (общие для всех видов)'}
        </span>
        {msg && (
          <span className="max-w-[300px] truncate text-[11px] text-danger" title={msg}>
            {msg}
          </span>
        )}
        {/* Поиск как в Формировании: панель-поповер по колонкам, подсветка + перелёт (⌘F).
            Не фильтрует строки. Замена скрыта (живая серверная база). */}
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
        {!pendingTransfer && selectedCount > 0 && mode === 'report' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            <button
              type="button"
              onClick={() => massMark('выполнено', '')}
              className="rounded-md border border-black/10 px-2 py-0.5 text-[#1F7A33] transition-colors hover:border-[#1F7A33]/50"
            >
              Выполнено
            </button>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  if (e.target.value === TRANSFER_REASON) setMsg('Перенос делается через ячейку статуса конкретной строки');
                  else massMark('не увезли', e.target.value);
                  e.target.value = '';
                }
              }}
              className="h-6 rounded-md border border-black/10 bg-transparent px-1 text-[12px] text-[#8A1F11] outline-none"
              title="Причина (не увезено) — выбрать и протянуть на все выделенные"
            >
              <option value="" disabled>
                Причина…
              </option>
              {FAIL_REASONS.map((fr) => (
                <option key={fr} value={fr}>
                  {fr}
                </option>
              ))}
            </select>
            {/* П.4: «Удалить из отчёта» — убрать строку в резерв; позиция вернётся в
                формирование с данными, выгрузка заказов её актуализирует (OFF/новое кол-во/правка). */}
            <button
              type="button"
              onClick={deleteSelected}
              title="Удалить из отчёта (в резерв) — позиция вернётся в формирование, выгрузка актуализирует"
              className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Удалить из отчёта
            </button>
          </div>
        )}
        {!pendingTransfer && selectedCount > 0 && mode === 'plan' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            {/* Перенос — НЕ по выделению (п.2): через ячейку статуса «перенос на другой день»
                в Отчёте. Здесь только удаление в резерв. */}
            <button
              type="button"
              onClick={deleteSelected}
              title="Убрать в резерв (восстановимо до закрытия месяца) — позиции вернутся в формирование"
              className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Убрать из плана
            </button>
          </div>
        )}
      </div>
      {/* Обёртка relative + измеряемый слой `absolute inset-0` (как в Транспорте): абсолютный
          слой повторяет размер родителя независимо от ширины канваса → появляются полосы
          прокрутки, а flex-1 НЕ растягивается под широкий грид (был баг: много колонок, но не
          прокрутить). */}
      <div className="relative min-h-0 flex-1">
        <div ref={measureRef} className="flow-grid absolute inset-0">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
            Загрузка плана…
          </div>
        )}
        {!loading && viewRows.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
            <span className="text-[14px] font-medium text-[#2A2925]">
              {mode === 'report' ? 'Отчёт пуст' : 'План пуст'}
            </span>
            <span>
              {mode === 'report'
                ? 'Зафиксируйте план на день (кнопка «Зафиксировать» на этапе План).'
                : 'Проставьте даты в колонке DAY формирования и нажмите «Сформировать план».'}
            </span>
          </div>
        )}
        {size.width > 0 && size.height > 0 && (
          <DataEditor
            ref={gridRef}
            theme={gridTheme}
            width={size.width}
            height={size.height}
            columns={columns}
            rows={viewRows.length}
            getCellContent={getCellContent}
            onCellActivated={onCellActivated}
            onCellEdited={onCellEdited}
            onCellsEdited={onCellsEdited}
            onPaste={onPaste}
            gridSelection={selection}
            onGridSelectionChange={(sel) => {
              // Протяжка по первой колонке → выделение строк. СОХРАНЯЕМ current, иначе Glide
              // теряет активную протяжку и выделяется только одна строка (юзер 2026-06-15).
              const rowsSel = colZeroRowSelection(sel);
              setSelection(rowsSel ? { ...rowsSel, current: sel.current } : sel);
            }}
            getRowThemeOverride={getRowThemeOverride}
            customRenderers={PLAN_RENDERERS}
            getCellsForSelection
            rowMarkers="none"
            freezeColumns={2}
            rowSelect="multi"
            columnSelect="none"
            rangeSelect="multi-rect"
            rowHeight={getReportRowHeight}
            headerHeight={24}
            highlightRegions={gridSearch.highlightRegions}
            onVisibleRegionChanged={gridSearch.onVisibleRegionChanged}
            onHeaderMenuClick={colFilters.handleHeaderMenuClick}
            onKeyDown={(e) => {
              gridSearch.handleKey(e);
            }}
            smoothScrollX
            smoothScrollY
          />
        )}
        </div>
      </div>
      {/* Меню колонки (▾): сорт + поиск по колонке + чек-лист значений — как в Формировании.
          Объединённые ПОСТАВКА/ЗАКАЗ фильтруются по склейке (поиск в меню сужает по под-значению). */}
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
      {/* §7-B: карточка изменения материала (двойной клик по NO.№). Правка вес/объём/норма →
          пересчёт KG/V у всех живых строк (vgh_changed). */}
      <VghEditCard
        noNum={vghCard?.noNum ?? null}
        seed={vghCard ? { mat: vghCard.mat, uom: vghCard.uom } : null}
        note={vghCard?.note}
        onClose={() => setVghCard(null)}
      />
      {/* §5: карточка Истории (с зоной СЭД по каждой поставке) — клик по колонке «История». */}
      <FlowAnchorHistoryCard
        target={historyCard}
        load={(ord, it) => flowDeliveryEventsGet(api, ord, it)}
        onClose={() => setHistoryCard(null)}
      />
      {pendingTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-[360px] rounded-xl border border-black/10 bg-[#FDFDFB] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
            <div className="text-[13px] font-semibold text-[#2A2925]">Перенос на другой день</div>
            <div className="mt-1 text-[12px] tabular-nums text-[#6B6862]">{pendingTransfer.label}</div>
            {pendingTransfer.step === 'ask' ? (
              <div className="mt-3">
                {/* П.11: поставка живая и в ней ещё позиции — уточняем, удалена ли эта позиция. */}
                <div className="text-[12px] leading-relaxed text-[#2A2925]">
                  Позиция удалена из поставки {pendingTransfer.dlv}?
                  <div className="mt-0.5 text-[11px] text-[#6B6862]">
                    В поставке ещё {pendingTransfer.sameRowIds.length} {pendingTransfer.sameRowIds.length === 1 ? 'позиция' : 'позиций'}.
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPendingTransfer((p) =>
                        p ? { ...p, ids: [p.rowId], keepDlv: false, step: 'date' } : p,
                      )
                    }
                    className="rounded-md border border-black/10 px-3 py-2 text-left text-[12px] font-medium text-[#2A2925] transition-colors hover:border-accent-clay/60 hover:bg-accent-clay/10"
                  >
                    Да — переносим только эту позицию
                    <div className="text-[11px] font-normal text-[#6B6862]">без номера поставки; новая выгрузка подтянет данные</div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingTransfer((p) =>
                        p ? { ...p, ids: p.sameRowIds, keepDlv: true, step: 'date' } : p,
                      )
                    }
                    className="rounded-md border border-black/10 px-3 py-2 text-left text-[12px] font-medium text-[#2A2925] transition-colors hover:border-accent-clay/60 hover:bg-accent-clay/10"
                  >
                    Нет — переносим всю поставку ({pendingTransfer.sameRowIds.length})
                    <div className="text-[11px] font-normal text-[#6B6862]">все позиции, с номером поставки и П/П</div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-[12px] text-[#6B6862]">Дата переноса</span>
                <FlowDayPicker
                  mode="report"
                  rows={rows}
                  selected={null}
                  onSelect={commitPendingTransfer}
                  placeholder="Дата…"
                  title="Выберите день переноса (день со слепком отчёта → в Отчёт, иначе → в План)"
                  allowClear={false}
                  minDate={transferMinDate}
                  disabledTitle="перенос в прошлую дату запрещён"
                />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {pendingTransfer.step === 'date' && pendingTransfer.dlv && pendingTransfer.sameRowIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPendingTransfer((p) => (p ? { ...p, step: 'ask' } : p))}
                  className="rounded-md border border-black/10 px-3 py-1 text-[12px] text-[#6B6862] transition-colors hover:border-black/25"
                >
                  Назад
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPendingTransfer(null);
                  setMsg('');
                }}
                className="rounded-md border border-black/10 px-3 py-1 text-[12px] text-[#6B6862] transition-colors hover:border-black/25"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
