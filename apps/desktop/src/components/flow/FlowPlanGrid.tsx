import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DataEditorRef,
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { ClipboardPaste, Redo2, Trash2, Undo2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { BODY_TYPES } from './flow-body-types';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { flowDayRenderer, type FlowDayCell } from './flow-day-cell';
import { planEtalonCompare } from './flow-plan-sort';
import { garageRowColor, garageFillArgb, softenRowFill, FLOW_FILL_PALETTE } from './flow-garage-color';
import {
  buildPlanXlsxSheets, planXlsxFilename, buildExpedXlsxBook, expedXlsxFilename, kladExpedFilename,
  numberedFioLines,
  type PlanXlsxRow, type PlanXlsxLists, type ExpedXlsxRow,
} from './flow-export-xlsx';
import { downloadXlsx } from '@/lib/xlsx-lite';
import { flowMolRenderer, type FlowMolCell, type FlowMolOption } from './flow-mol-cell';
import { flowMatRenderer, type FlowMatCell } from './flow-mat-cell';
import { flowTwoToneRenderer, type FlowTwoCell } from './flow-composed-cells';
import { flowHistoryRenderer, type FlowHistoryCell } from './flow-history-cell';
import { FlowAnchorHistoryCard, type FlowAnchorHistoryTarget } from './FlowAnchorHistoryCard';
import { VghEditCard } from '@/components/vgh/VghEditCard';
import { flowDriverRenderer, type FlowDriverCell, type FlowDriverOption } from './flow-driver-cell';
import { flowVehicleRenderer, type FlowVehicleCell, type FlowVehicleOption } from './flow-vehicle-cell';
import { FlowGridEditor, EMPTY_GRID_SELECTION, type FlowGridEditorHandle } from './FlowGridEditor';
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
  flowPlanRowsApply,
  parsePlanPasteTsv,
  flowDeliveryAdd,
  flowXlsxLayoutGet,
  type FlowXlsxLayout,
  type FlowPlanPasteRow,
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
import {
  fmtNum3, MONTH_ABBR_RU, parseMol, compactFio, matCardLines, needsWarn,
  nearestGraphDate, graphDayLabel, graphDateSoon, todayIsoLocal, formatUploadDay, formatUploadDayParts, flowDate,
} from './flow-sandbox.fixtures';
// CSV-экспорт (flow-export) убран (юзер 2026-07-03) — только «План .xlsx» из Отчёта.

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
  { id: 'q', title: 'Q', width: 46, editable: true },
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
  { id: 'mol', title: 'МОЛ', width: 150, editable: true }, // §13: МОЛ правится в Отчёте
  { id: 'q', title: 'Q', width: 46, editable: true },
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

/** §4 — служебные инфо-колонки Плана/Отчёта (скрыты, тумблеры). Значения — с ЯКОРЯ
 *  формирования (когда заказ выгружен/создан, кем) + тех-имя из базы ВГХ. В печать/xlsx
 *  НЕ идут (экспорт собирает свой набор). id совпадают с формированием — тот же тумблер. */
const PLAN_INFO_COLS: readonly PlanColSpec[] = [
  { id: 'time_at', title: 'DAY выг.', width: 132 },
  { id: 'load_dt', title: 'Дата ORD', width: 92 },
  { id: 'created_by', title: 'ORD созд.', width: 132 },
  { id: 'mat_full', title: 'TECH NAME', width: 220 },
];
/** id инфо-колонок Плана — для быстрых проверок. */
const PLAN_INFO_IDS: ReadonlySet<string> = new Set(PLAN_INFO_COLS.map((c) => c.id));

/** Причины невывоза: в БД — канонический текст (сервер матчит по ключевым словам),
 *  юзеру — ПРОСТЫЕ названия (юзер 2026-07-03). Отказ (цеха)/самовывоз возвращают позицию
 *  в Формирование со STAT; остальные (в т.ч. «отказ водителя», «нет машины» …) — журналом
 *  в комментарий якоря. Легаси-каноны разворачиваем в короткие для показа старых данных. */
const REASON_SHORT: Record<string, string> = {
  'перенос на другой день': 'перенос',
  'отказ цеха': 'отказ',
  'менее транспортной нормы': 'мало',
  'на приёмке': 'приемка',
  'на входном контроле': 'вх. контроль',
  'нет на центральном складе': 'нет',
  'самовывоз': 'самовывоз',
};
const REASON_CANON: Record<string, string> = Object.fromEntries(
  Object.entries(REASON_SHORT).map(([canon, short]) => [short, canon]),
);
/** Порядок пунктов причины в выпадашке (короткие имена). Новые (юзер 2026-07-03):
 *  нет машины/водителя/погрузчика/крана/людей/МОЛа, отказ водителя, запрет снабжения —
 *  хранятся как есть (canonical=short, сервер их в STAT «отказ» НЕ превращает). */
const FAIL_REASONS = [
  'перенос', 'отказ', 'отказ водителя', 'мало', 'приемка', 'вх. контроль',
  'нет', 'нет машины', 'нет водителя', 'нет погрузчика', 'нет крана', 'нет людей',
  'нет МОЛа', 'самовывоз', 'запрет снабжения',
] as const;

/** ТИП ТС (юзер 2026-06-15) — НАШ маркер кузова, НЕ тянется из машины. До 3 на строку
 *  (соответствует до 3 гаражным). Хранится в поле `vehicle` (через `\n`).
 *  Список имён единый с картой — см. flow-body-types.ts. */

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

/** Разбор выбранной опции статуса → поля поставки. «ожидание»/пусто → сброс в ноль.
 *  Короткое имя причины разворачиваем в канонический текст для БД. */
function decodeStatus(opt: string): { done_stat: string; fail_reason: string } {
  if (opt === STATUS_DONE) return { done_stat: STATUS_DONE, fail_reason: '' };
  if (opt === STATUS_WAIT || opt === '') return { done_stat: '', fail_reason: '' };
  return { done_stat: 'не увезли', fail_reason: REASON_CANON[opt] ?? opt }; // выбрана причина
}

const PLAN_RENDERERS = [flowDropdownRenderer, flowMolRenderer, flowMatRenderer, flowHistoryRenderer, flowDriverRenderer, flowVehicleRenderer, flowDayRenderer, flowTwoToneRenderer];

/** Дата плана YYYY-MM-DD → «12 июня» (короткий показ в колонке). */
function fmtPlanDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

function displayFailReason(reason: string): string {
  const raw = reason.trim();
  if (raw.startsWith(TRANSFER_REASON)) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(raw);
    return m ? `перенос: ${fmtPlanDate(m[1] ?? '')}` : 'перенос';
  }
  return REASON_SHORT[raw] ?? raw; // канон → короткое имя; свободный текст как есть
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

/** Строка, созданная НАМИ руками в отчёте (перенос / ручная вставка / вставка из буфера) —
 *  её можно удалить и править МОЛ. Пришедшие автоматом при фиксации плана = «железная» база. */
function isManualRow(r: FlowDeliveryRow): boolean {
  const cb = String(r.created_by || '');
  return cb.startsWith('transfer:') || cb.startsWith('manual:') || cb.startsWith('paste:');
}

/** Строка, НАПИСАННАЯ руками с нуля (trailing-строка) — правятся ВСЕ видимые колонки
 *  (юзер 2026-07-04). Вставленные из буфера в САПОВСКОМ формате (paste:) и перенесённые
 *  (transfer:) — данные SAP: редактируется только стандартный набор (машина/экспедиторы/
 *  статусы/МОЛ/коммент), как у строк выгрузки. */
function isFreeEditRow(r: FlowDeliveryRow): boolean {
  return String(r.created_by || '').startsWith('manual:');
}

/** Колонки, которые у РУЧНЫХ строк пишутся прямо в таблице (юзер 2026-07-03). */
const MANUAL_EDIT_IDS = new Set(['date', 'qty', 'q', 'fr', 'to', 'no', 'mat', 'uom', 'dlvord']);

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
// 'vehicle' (ГАРАЖНЫЙ) — чтобы «363 под 331» было ВИДНО и после выхода из ячейки
// (юзер 2026-07-05), не только в редакторе.
const WRAP_COLS = new Set(['mat', 'note', 'vehicleType', 'sed', 'vehicle']);
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

type PendingTransfer = {
  /** Строка-инициатор. */
  rowId: number;
  /** Номер поставки строки (для вопроса «вся поставка / позиция удалена»). */
  dlv: string;
  /** Все строки этой поставки этого дня (зафикс., не в резерве). */
  sameRowIds: number[];
  /** Что переносим (определяется после вопроса п.11). */
  ids: number[];
  /** Вся поставка жива (наследуем номер при формировании) или позиция удалена из неё. */
  keepDlv: boolean;
  label: string;
  /** ask — вопрос «позиция удалена из поставки?» (только если в поставке >1 строки);
   *  date — выбор дня переноса (позиция вернётся в Формирование на эту дату, В1). */
  step: 'ask' | 'date';
};

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FlowPlanGrid({
  mode = 'plan',
  onSelectedDayChange,
}: {
  mode?: 'plan' | 'report';
  /** Выбранный день календаря — наружу (кнопка «Создание поставок» этапа План). */
  onSelectedDayChange?: (day: string | null) => void;
}): JSX.Element {
  // §4 (юзер 2026-07-03): служебные инфо-колонки (DAY выг./Дата ORD/ORD созд./TECH NAME)
  // — скрыты по умолчанию, тумблеры в панели; в xlsx/печать НЕ идут. COLS = базовые +
  // видимые инфо (после MAT); вся индексация грида уже идёт по COLS.
  const [visibleInfo, setVisibleInfo] = useState<ReadonlySet<string>>(() => new Set());
  const toggleInfoCol = useCallback((id: string) => {
    setVisibleInfo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const COLS = useMemo(() => {
    const base = mode === 'report' ? REPORT_COLS : PLAN_COLS;
    if (visibleInfo.size === 0) return base as readonly PlanColSpec[];
    const out: PlanColSpec[] = [];
    for (const c of base) {
      out.push(c);
      if (c.id === 'mat') {
        for (const info of PLAN_INFO_COLS) if (visibleInfo.has(info.id)) out.push(info);
      }
    }
    return out;
  }, [mode, visibleInfo]);
  const [rows, setRows] = useState<FlowDeliveryRow[]>(() => planDlvCache ?? []);
  const [anchors, setAnchors] = useState<FlowRow[]>(() => planAnchorsCache ?? []);
  const [vehicles, setVehicles] = useState<FlowVehicle[]>(() => planVehiclesCache ?? []);
  const [loading, setLoading] = useState(() => planDlvCache === null);
  // Выделение живёт ВНУТРИ FlowGridEditor (Фаза 1: протяжка не ре-рендерит этот
  // 3000-строчный компонент). Здесь — только лёгкий счётчик для тулбара «Выбрано: N»
  // и императивный handle, чтобы задавать выделение извне (поиск/очистка).
  const [selectedCount, setSelectedCount] = useState(0);
  const editorRef = useRef<FlowGridEditorHandle | null>(null);
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
  // ПЛАН — всегда КОНКРЕТНЫЙ день (юзер 2026-07-02): «все дни» не показываем и не редактируем.
  // Дефолт = ближайший день с черновиками (не прошлый), иначе сегодня. Прошлые дни в календаре
  // Плана недоступны (сегодня — можно).
  useEffect(() => {
    if (mode !== 'plan' || selectedDay) return;
    const today = isoTodayLocal();
    const days = rows
      .filter((r) => Number(r.fixation_id) === 0 && Number(r.reserved) !== 1)
      .map((r) => (r.plan_date || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
      .sort();
    setSelectedDay(days[0] ?? today);
  }, [mode, selectedDay, rows]);
  useEffect(() => {
    onSelectedDayChange?.(selectedDay);
  }, [selectedDay, onSelectedDayChange]);
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
  // Статус склада строки против базы (юзер 2026-07-02): кода нет → «склада нет в SAP»,
  // помечен удалённым → «склад удалён». Показывается ПОСЛЕ плашки в ячейке МОЛ.
  const whStatusNote = useCallback(
    (code: string): string => {
      const c = String(code ?? '').trim();
      if (!c) return '';
      const wh = whMapGet(whByKey, c);
      if (!wh) return 'склада нет в SAP';
      return Number(wh.is_removed) === 1 ? 'склад удалён' : '';
    },
    [whByKey],
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
    // Порядок ролей (юзер 2026-07-03): сначала «Экспедиторы», потом «Водители-экспедиторы»,
    // затем остальной справочник по алфавиту.
    const roleRank2 = (o: FlowDriverOption): number =>
      o.roleGroup === 'Экспедиторы' ? 0 : o.roleGroup === DRIVER_EXPEDITOR_ROLE ? 1 : 2;
    opts.sort((a, b) => {
      const ra = roleRank2(a);
      const rb = roleRank2(b);
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
  // ПЛАН: зафиксированные строки ВИДНЫ, но недоступны изменению (юзер 2026-07-04 —
  // «слепок остался неизменный»); правки/скачивание фиксированного — в Отчёте.
  const rowLocked = useCallback(
    (r: FlowDeliveryRow) =>
      (mode === 'plan' && Number(r.fixation_id) > 0) ||
      (!isDev && mode === 'report' && (r.plan_date || '') < reportCutoff),
    [mode, reportCutoff, isDev],
  );
  const canEditMol = useCallback(
    (r: FlowDeliveryRow) => Number(r.fixation_id) === 0 || (mode === 'report' && isManualRow(r)),
    [mode],
  );
  // ПЛАН = СЛЕПОК (юзер 2026-07-05): машина/экспедиторы/гаражный/заливка у зафикс.
  // строк показываются КАК НА МОМЕНТ ФИКСАЦИИ (snap_* пишет сервер при фиксации),
  // а не живые значения из Отчёта. Отчёт (и черновики Плана) — живьём.
  const isSnapRow = useCallback(
    (r: FlowDeliveryRow) => mode === 'plan' && Number(r.fixation_id) > 0,
    [mode],
  );
  const rowExpeditors = useCallback(
    (r: FlowDeliveryRow): string[] =>
      isSnapRow(r)
        ? splitMultiCell([r.snap_exp1 || '', r.snap_exp2 || ''].filter(Boolean).join('\n'))
        : deliveryExpeditors(r),
    [isSnapRow],
  );
  const rowVehicle = useCallback(
    (r: FlowDeliveryRow): string => (isSnapRow(r) ? r.snap_vehicle || '' : r.vehicle || ''),
    [isSnapRow],
  );
  const rowRide = useCallback(
    (r: FlowDeliveryRow): string => (isSnapRow(r) ? r.snap_ride || '' : r.ride_id || ''),
    [isSnapRow],
  );
  // Удаление (юзер 2026-07-03): «сброс — начинаем сначала». ПЛАН — любой черновик;
  // ОТЧЁТ — ЛЮБАЯ строка (в резерв, восстановимо): позиция возвращается в Формирование,
  // выгрузка заказов/открытых потом уточнит, жива ли поставка. Закрытый архив (>7 дней) — нет.
  const canDeleteRow = useCallback(
    (r: FlowDeliveryRow) => {
      if (rowLocked(r)) return false;
      if (mode === 'plan') return Number(r.fixation_id) === 0;
      return true;
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
    // ПЛАН = черновики (fixation_id===0) + ЗАФИКСИРОВАННЫЕ строки текущего месяца
    // (юзер 2026-07-04: при фиксации строки НЕ исчезают — видны слепком, read-only
    // через rowLocked). Контрольные zmvl-эпизоды (fixation_id=-1) не показываем.
    let out =
      mode === 'report'
        ? rows.filter(
            (r) => Number(r.fixation_id) > 0 && (r.plan_date || '').slice(0, 7) >= currentMonthPrefix,
          )
        : rows.filter(
            (r) =>
              Number(r.reserved) !== 1 &&
              (Number(r.fixation_id) === 0 ||
                (Number(r.fixation_id) > 0 && (r.plan_date || '').slice(0, 7) >= currentMonthPrefix)),
          );
    // Календарь (P7): выбран день → показываем только его.
    if (selectedDay) out = out.filter((r) => (r.plan_date || '').slice(0, 10) === selectedDay);
    // Сортировка ЭТАЛОНА экспедиции (юзер 2026-07-02, скрипт APLAN): внутри дня —
    // отправитель (спец-порядок) → кластер ВЫЕЗД/КХП → получатель (Т-пары) → поставка →
    // П/П → наименование → номенклатура → кол-во. Единая для грида и xlsx-экспорта.
    const clstOf = (r: FlowDeliveryRow): string => whMapGet(whByKey, r.to_wh)?.cluster ?? '';
    out.sort(
      (a, b) =>
        (mode === 'report'
          ? (b.plan_date || '').localeCompare(a.plan_date || '')
          : (a.plan_date || '').localeCompare(b.plan_date || '')) ||
        planEtalonCompare(
          { fr: a.fr, clst: clstOf(a), to_wh: a.to_wh, dlv: a.dlv, dlv_pos: a.dlv_pos, mat: a.mat, no_num: a.no_num, qty: a.qty },
          { fr: b.fr, clst: clstOf(b), to_wh: b.to_wh, dlv: b.dlv, dlv_pos: b.dlv_pos, mat: b.mat, no_num: b.no_num, qty: b.qty },
        ),
    );
    return out;
  }, [rows, mode, selectedDay, currentMonthPrefix, whByKey]);

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

  // §2 (юзер 2026-07-03): «первая ФИКСАЦИЯ дня = план, дальше доп. 1, 2…». Считаем ЖИВЫЕ
  // фиксации (у которых остались НЕ в резерве строки): если ранние батчи целиком удалены,
  // текущий живой батч становится «планом», а не «доп. N». Ключ plan_date → (batch_seq →
  // порядковый номер среди живых). Предварительные/пустые фиксации в счёт не идут.
  const batchRankByDate = useMemo(() => {
    const byDate = new Map<string, Set<number>>();
    for (const r of rows) {
      if (Number(r.fixation_id) <= 0 || Number(r.reserved) === 1) continue;
      const b = Number(r.batch_seq) || 0;
      if (b <= 0) continue;
      const d = (r.plan_date || '').slice(0, 10);
      const set = byDate.get(d) ?? new Set<number>();
      set.add(b);
      byDate.set(d, set);
    }
    const out = new Map<string, Map<number, number>>();
    for (const [d, set] of byDate) {
      const ranked = [...set].sort((a, b) => a - b);
      out.set(d, new Map(ranked.map((b, i) => [b, i + 1])));
    }
    return out;
  }, [rows]);
  /** Ярлык FIX по ЖИВОМУ порядку фиксаций дня (1=план, 2=доп.1…). */
  const fixLabelOf = useCallback(
    (r: FlowDeliveryRow): string => {
      if (Number(r.fixation_id) <= 0) return '';
      const rank = batchRankByDate.get((r.plan_date || '').slice(0, 10))?.get(Number(r.batch_seq) || 0) ?? 0;
      return rank <= 0 ? '' : rank === 1 ? 'план' : `доп. ${rank - 1}`;
    },
    [batchRankByDate],
  );

  // Эффективное кол-во ДЛЯ ПОКАЗА: в Отчёте — фактическое из zm_vl (что реально провели), если есть;
  // иначе план. КГ/V и зависимые ячейки считаются от него. План-снимок остаётся в истории карточки.
  const effQty = useCallback(
    (r: FlowDeliveryRow): number | null => (mode === 'report' && r.fact_qty != null ? r.fact_qty : r.qty),
    [mode],
  );
  // ГРАФ строки (В4, юзер 2026-07-02): день недели склада из графика месяца строки +
  // ближайшее вхождение ≥ даты плана («ПТ.3»). soon = «без перескока недель» (зелёный).
  const graphInfo = useCallback(
    (r: FlowDeliveryRow): { label: string; soon: boolean } | null => {
      const wh = whMapGet(whByKey, r.to_wh);
      const m = monthOfDate(r.plan_date);
      const meta = m ? scheduleMetaMap.get(monthKey(m.year, m.month)) : undefined;
      let day: string | null = null;
      if (meta?.shops.length) {
        day = frozenWeekdayOf(meta.shops, r.to_wh);
      } else if (m && canUseLiveWarehouseScheduleForMonth(m.year, m.month) && (!meta || meta.exists !== false)) {
        day = wh && Number(wh.in_schedule) === 1 ? wh.delivery_day : null;
      }
      if (!day) return null;
      const todayIso = todayIsoLocal();
      const ref = /^\d{4}-\d{2}-\d{2}/.test(r.plan_date || '') ? (r.plan_date || '').slice(0, 10) : todayIso;
      const near = nearestGraphDate(day, ref);
      return { label: graphDayLabel(day, near), soon: graphDateSoon(near, todayIso) };
    },
    [whByKey, scheduleMetaMap],
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
        case 'fix':
          // Первый ЖИВОЙ блок дня = «план», дальше «доп. 1»… (по порядку живых фиксаций).
          return fixLabelOf(r);
        case 'q':
          // Q — аварийный/особый запас («Особый запас» из SAP-вставки, юзер 2026-07-03).
          return r.q_spec ?? '';
        case 'graph': {
          // День доставки склада из графика месяца + ЧИСЛО ближайшего вхождения ≥ даты
          // плана строки: «ПТ.3» (юзер 2026-07-02, В4). Нет в графике — «—».
          const g = graphInfo(r);
          return g ? g.label : '—';
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
          // Зафиксированное (ТЗ §3.8 / B) читает ЗАМОРОЖЕННЫЙ snapshot. Черновик — сначала
          // выбранный НА СТРОКЕ МОЛ (snap_mol, юзер 2026-07-03: план не подменяет МОЛ
          // остатка в Формировании), иначе живьём с якоря.
          if (Number(r.fixation_id) > 0) return resolvePersonName(r.snap_mol || '', molByKey);
          return resolvePersonName(r.snap_mol || anchor?.mol || '', molByKey);
        }
        case 'approved':
          // Ручная строка без якоря — «согласовал» со строки (snap_approved).
          return Number(r.fixation_id) > 0 ? r.snap_approved || '' : (anchor?.approved_by ?? r.snap_approved ?? '');
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
          // В Плане у зафикс. строк — СЛЕПОК (snap_exp*), не живые из Отчёта.
          return rowExpeditors(r).map(expeditorDisplayName).join('\n');
        case 'vehicleType':
          // НАШ маркер кузова (БОРТ/ПУЛЬМАН/…) из поля vehicle — НЕ тянем из машины (юзер 2026-06-15).
          return rowVehicle(r);
        case 'vehicle':
          // ID (гаражный) — ТОЛЬКО ride_id, руками; тип ТС сюда НЕ подставляем
          // (юзер 2026-07-04: «выбор типа ТС не должен появляться в колонке ID»).
          return splitMultiCell(rowRide(r)).join('\n');
        case 'note':
          // Черновик с якорем — живой коммент якоря; ручная строка БЕЗ якоря — со строки.
          return Number(r.fixation_id) > 0 ? r.snap_note || '' : anchor ? anchor.note ?? '' : r.snap_note || '';
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
        // §4 инфо-колонки (read-only) — с ЯКОРЯ формирования + тех-имя из базы ВГХ.
        case 'time_at':
          return formatUploadDay(anchor?.time_at ?? '');
        case 'load_dt':
          // Дата создания заказа — «июнь 6, 2026» (месяц день, год целиком; юзер 2026-07-04).
          return anchor?.load_dt ? flowDate(anchor.load_dt, { year: true }) : '';
        case 'created_by':
          return anchor?.created_by ?? '';
        case 'mat_full':
          return (vghByKey.get(normVghKey(r.no_num))?.tech_name || '').trim() || anchor?.mat_full || '';
        case 'flag':
          return flagById.get(r.id) ?? '';
        default:
          return '';
      }
    },
    [anchorByKey, vghByKey, flagById, whById, scheduleMetaMap, molByKey, vehicleByGarage, expeditorDisplayName, transferChainDates, effQty, graphInfo, fixLabelOf, rowExpeditors, rowVehicle, rowRide],
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
  // Дат-колонки (DAY выг./Дата ORD) сортируются по СЫРОМУ ISO якоря — хронологически,
  // а не по алфавиту ярлыков («июль июнь 2 вместе», юзер 2026-07-04).
  const filterSortKey = useCallback(
    (r: FlowDeliveryRow, colId: string): string | null => {
      if (colId !== 'time_at' && colId !== 'load_dt') return null;
      const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
      return String((colId === 'time_at' ? anchor?.time_at : anchor?.load_dt) ?? '');
    },
    [anchorByKey],
  );
  const colFilters = useFlowColumnFilters<FlowDeliveryRow>({
    columns: searchColumns,
    rows: baseRows,
    getValue: searchRaw,
    sortKeyOf: filterSortKey,
  });

  // Показ = база → фильтры колонок → (колоночная сортировка перекрывает дефолтную).
  const viewRows = useMemo(
    () => colFilters.applySort(colFilters.applyFilters(baseRows)),
    [baseRows, colFilters.applyFilters, colFilters.applySort],
  );
  // Живое выделение из FlowGridEditor (обновляется его колбэком). Все действия
  // (заливка/копирование/удаление/вставка/статус) читают ОТСЮДА — без ре-рендера.
  const selectionRef = useRef<GridSelection>(EMPTY_GRID_SELECTION);
  // Стабильный (deps []) колбэк: пишем свежее выделение в ref + двигаем лёгкий
  // счётчик. setSelectedCount с тем же числом — no-op (React бейлит), поэтому
  // протяжка внутри одной строки родителя не трогает.
  const handleSelectionChange = useCallback((sel: GridSelection) => {
    selectionRef.current = sel;
    setSelectedCount(sel.rows.length);
  }, []);
  // Задать выделение извне (поиск-переход) и очистить (после удаления/переноса).
  const applyGridSelection = useCallback((sel: GridSelection) => {
    editorRef.current?.setSelection(sel);
  }, []);
  const clearSelection = useCallback(() => {
    editorRef.current?.setSelection(EMPTY_GRID_SELECTION);
  }, []);
  const viewRowsRef = useRef(viewRows);
  viewRowsRef.current = viewRows;
  const colsRef = useRef(COLS);
  colsRef.current = COLS;

  // §5 (юзер 2026-07-03): копирование по колонке «Поставка·Заказ» (dlvord) → окно выбора
  // ЧТО класть в буфер (заказ/поставка, с позициями или без) — каждое РАЗНОЙ колонкой.
  const [dlvCopyDialog, setDlvCopyDialog] = useState<FlowDeliveryRow[] | null>(null);
  const [copyOpts, setCopyOpts] = useState({ ord: true, ordPos: true, dlv: false, dlvPos: false });
  useEffect(() => {
    const onCopyCapture = (e: ClipboardEvent) => {
      const cols = colsRef.current;
      const dlvCol = cols.findIndex((c) => c.id === 'dlvord');
      if (dlvCol < 0) return;
      const sel = selectionRef.current;
      const colOnly = sel.columns.length === 1 && sel.columns.hasIndex(dlvCol) && !sel.current;
      const cur = sel.current;
      const rangeOnly = !!cur && cur.range.x === dlvCol && cur.range.width === 1 &&
        cur.rangeStack.every((r) => r.x === dlvCol && r.width === 1) && sel.columns.length === 0;
      if (!colOnly && !rangeOnly) return;
      const vr = viewRowsRef.current;
      const rowIdx = new Set<number>();
      if (colOnly) for (let i = 0; i < vr.length; i++) rowIdx.add(i);
      else if (cur) for (const rg of [cur.range, ...cur.rangeStack]) {
        for (let y = rg.y; y < rg.y + rg.height; y++) rowIdx.add(y);
      }
      const picked = [...rowIdx].sort((a, b) => a - b).map((i) => vr[i]).filter((r): r is FlowDeliveryRow => !!r);
      if (picked.length === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setDlvCopyDialog(picked);
    };
    window.addEventListener('copy', onCopyCapture, true);
    return () => window.removeEventListener('copy', onCopyCapture, true);
  }, []);
  const doDlvCopy = useCallback(
    (opts: { ord: boolean; ordPos: boolean; dlv: boolean; dlvPos: boolean }) => {
      const rows = dlvCopyDialog;
      setDlvCopyDialog(null);
      if (!rows) return;
      // Каждое выбранное поле — ОТДЕЛЬНАЯ колонка буфера (tab), в порядке заказ|поз, поставка|поз.
      const tsv = rows
        .map((r) => {
          const cells: string[] = [];
          if (opts.ord) cells.push(r.ord ?? '');
          if (opts.ordPos) cells.push(r.it ?? '');
          if (opts.dlv) cells.push(r.dlv ?? '');
          if (opts.dlvPos) cells.push(r.dlv_pos ?? '');
          return cells.join('\t');
        })
        .join('\n');
      void navigator.clipboard?.writeText?.(tsv).catch(() => undefined);
    },
    [dlvCopyDialog],
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
      const vtypeLines = Math.max(1, splitMultiCell(rowVehicle(r)).length);
      // ГАРАЖНЫЙ — тоже до 3 через \n: строки видны в ячейке (юзер 2026-07-05).
      const rideLines = Math.max(1, splitMultiCell(rowRide(r)).length);
      const expN = rowExpeditors(r).length;
      const cands = [
        32, // база: 2 строки ПОСТАВКА·ЗАКАЗ (телефон в ячейке убран — R3.1)
        16 + (matLines - 1) * LINE,
        16 + (noteLines - 1) * LINE,
        16 + (vtypeLines - 1) * LINE,
        16 + (rideLines - 1) * LINE,
        expN > 1 ? expN * 16 + 4 : 0, // экспедиторы — по строке на каждого (без телефона)
      ];
      return Math.max(30, Math.min(150, Math.max(...cands)));
    },
    [viewRows, colWidths, anchorByKey, vehicleByGarage, rowVehicle, rowRide, rowExpeditors],
  );

  const gridSearch = useFlowGridSearch<FlowDeliveryRow>({
    columns: searchColumns,
    rows,
    viewRows,
    gridRef,
    getRaw: searchRaw,
    getDisplay: searchDisplay,
    setSelection: applyGridSelection,
  });

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      }
      const locked = rowLocked(r);
      if (spec.id === 'date' && isManualRow(r)) {
        // Ручные строки (юзер 2026-07-02/03): день выбирается ПРОВАЛОМ в ячейку даты
        // (календарь, как DAY формирования) — и в Отчёте, и в Плане; дату можно
        // копировать/протягивать. В Отчёте сервер перецепит строку к фиксации нового дня.
        const iso = (r.plan_date || '').slice(0, 10);
        const cell: FlowDayCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: iso,
          themeOverride: planCellTheme(spec.id),
          data: { kind: 'flow-day', value: iso, label: iso ? fmtPlanDate(iso) : 'дата?' },
        };
        return cell;
      }
      if (spec.id === 'mol') {
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        // Черновик — сначала выбранный НА СТРОКЕ МОЛ (snap_mol), иначе живьём с якоря
        // (юзер 2026-07-03: МОЛ плана не подменяет остаток в Формировании).
        const rawMol = Number(r.fixation_id) > 0
          ? r.snap_mol || ''
          : r.snap_mol || anchor?.mol || '';
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
            // Статус склада против базы — рядом, после плашки (юзер 2026-07-02).
            suffix: whStatusNote(r.to_wh) || undefined,
          },
        };
        return cell;
      }
      if (spec.id === 'time_at') {
        // DAY выг.: дата ЖИРНЫМ + время обычным (юзер 2026-07-04) — составная ячейка.
        const p = formatUploadDayParts(anchorByKey.get(`${r.ord}|${r.it}`)?.time_at ?? '');
        return {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: [p.date, p.time].filter(Boolean).join(' '),
          data: { kind: 'flow-two', primary: p.date, secondary: p.time, bold: true },
        } satisfies FlowTwoCell;
      }
      if (spec.id === 'mat' && !isFreeEditRow(r)) {
        // MAT-карточка (read-only) — те же данные, что в Формировании: Создал/Выгружен/Удалён/
        // Вывезено%/тех-имя. Источник — ЯКОРЬ (живой расчёт; до фиксации пересчёт виден везде).
        // Доступна на ВСЕХ строках (это просмотр, ограничение 7 дней не применяем). ТЗ §7.
        // Ручные строки — наименование пишется прямо в ячейке (юзер 2026-07-03).
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        const cell: FlowMatCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: r.mat ?? '',
          data: {
            kind: 'flow-mat',
            name: r.mat ?? '',
            warn: anchor ? needsWarn(anchor) : false,
            // Как в Формировании (юзер 2026-07-04): только «Вывезено % — X из Y» —
            // Создал/Выгружен/тех-имя уже разнесены по инфо-колонкам.
            lines: anchor ? matCardLines(anchor, { pctOnly: true }) ?? [] : [],
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
        // В Плане у зафикс. строк — слепок фиксации.
        const names = rowExpeditors(r).map(expeditorDisplayName);
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
            maxSelected: 5, // юзер 2026-07-04: экспедиторов до пяти
          },
        };
        return cell;
      }
      if (spec.id === 'vehicleType') {
        // ТИП ТС — наш мультимаркер кузова (до 3); правится/удаляется в окне 7 дней.
        // В Плане у зафикс. строк — слепок фиксации (snap_vehicle).
        const editable = !!spec.editable && !locked;
        const v = rowVehicle(r);
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: editable,
          copyData: v.replace(/\n/g, ', '),
          themeOverride: planCellTheme(spec.id),
          data: { kind: 'flow-dropdown', value: v, options: BODY_TYPES as unknown as string[], multi: true, maxSelected: 3 },
        };
        return cell;
      }
      // ГАРАЖНЫЙ — обычный текст, пишем РУКАМИ (юзер 2026-07-03): выпадашка машин убрана,
      // ячейка идёт генерик-веткой ниже (editable, multi через перенос строки).
      const text = cellText(spec, r);
      const displayText =
        spec.id === 'vehicleType'
          // До 3 строк, чтобы тип влезал ЦЕЛИКОМ («ПУЛЬМАН 9М» резался на 2 — юзер 2026-07-04).
          ? wrapWordsMaxLines(text, (colWidths.vehicleType ?? 130) - REPORT_HPAD * 2, 3)
          : text;
      // Ручные строки (написанные с нуля): поля пишутся прямо в таблице — сверх editable.
      // Буферные/SAP-строки сюда не попадают (юзер 2026-07-04: у них стандартный набор).
      const manualCell = isFreeEditRow(r) && spec.id !== 'date' && MANUAL_EDIT_IDS.has(spec.id);
      const editable = (!!spec.editable || manualCell) && !locked;
      // Перенос по словам (П6) — МАТЕРИАЛ/КОММЕНТАРИЙ; ПОСТАВКА·ЗАКАЗ — 2 строки через \n.
      // ТИП ТС переносим сами по словам в 2 строки, чтобы Glide не резал буквы.
      const wrap = (WRAP_COLS.has(spec.id) && spec.id !== 'vehicleType') || spec.id === 'dlvord';
      // ГРАФ: дата «без перескока недель» — зелёная подпись (В4, юзер 2026-07-02).
      const graphGreen = spec.id === 'graph' ? graphInfo(r)?.soon === true : false;
      return {
        kind: GridCellKind.Text,
        data: spec.id === 'qty' ? (r.qty == null ? '' : String(r.qty).replace('.', ',')) : displayText,
        displayData: displayText,
        allowOverlay: editable,
        readonly: !editable,
        allowWrapping: wrap,
        themeOverride: graphGreen
          ? { ...planCellTheme(spec.id), textDark: '#1F7A3D' }
          : planCellTheme(spec.id),
        contentAlign: spec.id === 'qty' || spec.id === 'kg' || spec.id === 'v' ? 'right' : 'left',
      };
    },
    [viewRows, cellText, COLS, rowLocked, anchorByKey, molsForWh, molByKey, colWidths, expeditorsForWh, resolveExpeditorOpt, expeditorDisplayName, vehicleOptions, canEditMol, graphInfo, whStatusNote, rowExpeditors, rowVehicle],
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
      rowsRef.current = next;
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
  // Вставка из буфера — тоже отменяемое действие (юзер 2026-07-02): undo убирает
  // вставленные строки (в резерв), redo вставляет их заново (новые id).
  type PasteAction = { kind: 'paste'; ids: number[]; rows: FlowPlanPasteRow[]; planDate?: string; target: 'plan' | 'report' };
  // Заливка выделенных строк — ОДНО действие истории (юзер 2026-07-04: «отмена как в
  // экселе» снимает всю заливку разом). label — подпись отмены («Вставка» и т.п.).
  type FillAction = { kind: 'fill'; items: PlanEdit[]; label?: string };
  type HistoryEntry = PlanEdit | PasteAction | FillAction;
  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
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
    (e: HistoryEntry) => {
      undoRef.current.push(e);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = []; // новый шаг обнуляет «повтор»
      syncHistory();
    },
    [syncHistory],
  );
  // Применить пачку правок заливки (одно действие: оптимистично + один запрос серверу).
  const applyFillItems = useCallback(
    (items: PlanEdit[], side: 'before' | 'after') => {
      const cur = new Map(rowsRef.current.map((x) => [x.id, x] as const));
      setRows((prev) => {
        const byId = new Map(items.map((it) => [it.id, it[side]] as const));
        const next = prev.map((x) => (byId.has(x.id) ? ({ ...x, ...byId.get(x.id) } as FlowDeliveryRow) : x));
        planDlvCache = next;
        rowsRef.current = next;
        return next;
      });
      void flowDeliveriesEdit(
        api,
        items.map((it) => ({ id: it.id, row_version: cur.get(it.id)?.row_version ?? 0, fields: it[side] })),
      ).then((res) => applyServerDlv(res.rows));
    },
    [applyServerDlv],
  );

  const undo = useCallback(() => {
    const e = undoRef.current.pop();
    if (!e) return;
    if ('kind' in e) {
      if (e.kind === 'fill') {
        applyFillItems(e.items, 'before');
        setMsg(`${e.label ?? 'Заливка'} отменена`);
        redoRef.current.push(e);
        syncHistory();
        return;
      }
      // Отмена вставки: вставленные строки в резерв (повтор вставит заново).
      if (e.ids.length > 0) {
        setRows((prev) => {
          const drop = new Set(e.ids);
          const next = prev.filter((r) => !drop.has(r.id));
          planDlvCache = next;
          rowsRef.current = next;
          return next;
        });
        void flowDeliveriesDelete(api, e.ids).catch(() => undefined);
      }
      setMsg(`Вставка отменена: ${e.ids.length} строк убрано`);
      redoRef.current.push(e);
      syncHistory();
      return;
    }
    applyDlvFields(e.id, e.before);
    redoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, applyFillItems, syncHistory]);
  const redo = useCallback(() => {
    const e = redoRef.current.pop();
    if (!e) return;
    if ('kind' in e) {
      if (e.kind === 'fill') {
        applyFillItems(e.items, 'after');
        undoRef.current.push(e);
        syncHistory();
        return;
      }
      // Повтор вставки: те же строки заново (сервер выдаст новые id — обновляем в записи).
      void flowPlanRowsApply(api, e.rows, { planDate: e.planDate, source: 'paste', target: e.target })
        .then((r) => {
          e.ids = r.insertedIds;
          setMsg(`Вставка повторена: ${r.inserted} строк`);
        })
        .catch((err) => setMsg(`Повтор вставки не прошёл: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`));
      undoRef.current.push(e);
      syncHistory();
      return;
    }
    applyDlvFields(e.id, e.after);
    undoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, applyFillItems, syncHistory]);

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

  /** Смена МОЛа строки: пишем snap_mol на строку; в ОТЧЁТЕ (§13) — обратная связь
   *  с Формированием (mol на якорь), чтобы отчёт и исходная таблица не расходились.
   *  В Плане якорь не трогаем (частичный план не должен подменять МОЛ остатка). */
  const applyMolChange = useCallback(
    (r: FlowDeliveryRow, value: string) => {
      const fields: Record<string, string | number | null> = { snap_mol: value };
      const before = captureBefore(r, fields);
      if (String(before.snap_mol ?? '') === value) return;
      setMsg('');
      applyDlvFields(r.id, fields);
      pushHistory({ id: r.id, before, after: fields });
      // Обратная связь с формированием только в Отчёте (юзер 2026-07-03, §13).
      if (mode === 'report') {
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (anchor && String(anchor.mol ?? '') !== value) applyAnchorFields(anchor, { mol: value });
      }
    },
    [mode, anchorByKey, applyDlvFields, applyAnchorFields, captureBefore, pushHistory],
  );

  const resolveMolForRow = useCallback(
    (r: FlowDeliveryRow, raw: string, opts2?: { allowFree?: boolean }): { value: string; error?: string } => {
      const fioStr = String(raw ?? '').trim();
      if (!fioStr) return { value: '' };
      const wantKey = personKey(parseMol(fioStr)?.fio ?? fioStr);
      const opts = molsForWh(r.to_wh);
      const opt = opts.find((o) => personKey(o.fio) === wantKey);
      if (!opt) {
        // Ручные строки (юзер 2026-07-02): «своего ввести руками можем — это не даст ошибку».
        if (opts2?.allowFree) return { value: fioStr };
        return {
          value: '',
          error: `${resolvePersonName(fioStr, molByKey) || fioStr} не может быть МОЛом на складе ${whDisplay(r.to_wh) || '(склад не задан)'}`,
        };
      }
      const contract = checkPersonDate(opt.until, r.plan_date || '');
      if (contract === 'expired' && !opts2?.allowFree) {
        return { value: '', error: `Срок ПМО для ${opt.fio} истёк${opt.until ? ` — ${opt.until}` : ''}` };
      }
      if (contract === 'not-covered' && !opts2?.allowFree) {
        return { value: '', error: `Срок ПМО для ${opt.fio} не покрывает дату доставки` };
      }
      return { value: opt.fio };
    },
    [molsForWh, molByKey],
  );

  const resolveExpeditorsForRow = useCallback(
    (r: FlowDeliveryRow, raw: string): { value: string; error?: string } => {
      // Вставка из Excel/наших файлов может нести нумерацию «1. Фамилия…» — срезаем.
      const values = splitMultiCell(raw).map((s) => s.replace(/^\d+[.)]\s*/, ''));
      if (values.length === 0) return { value: '' };
      if (values.length > 5) return { value: '', error: 'Можно выбрать не больше пяти экспедиторов' };
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
      if (!spec || !r) return;
      // Ручные строки (юзер 2026-07-03): «пишем прямо в таблице по видимым колонкам» —
      // дата (календарь, отчёт), кол-во, Q, склады, номенклатура, наименование, ЕИ,
      // поставка+заказ — сверх обычных editable-колонок.
      const manualExtra = isManualRow(r) && MANUAL_EDIT_IDS.has(spec.id);
      if (!spec.editable && !manualExtra) return;
      if (rowLocked(r)) {
        setMsg('Старше 7 дней — отчёт закрыт, правки заблокированы');
        return;
      }
      // Объединённая отметка отчёта приходит из выпадашки (custom cell) — P4.
      if (newValue.kind === GridCellKind.Custom) {
        const data = newValue.data as { kind?: string; value?: string; driver?: string } | undefined;
        if (!data) return;
        if (spec.id === 'date' && data.kind === 'flow-day') {
          // Смена дня ручной строки Отчёта: сервер перецепит её к фиксации нового дня.
          const nd = String(data.value ?? '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(nd) || nd === (r.plan_date || '').slice(0, 10)) return;
          const fields: Record<string, string | number | null> = { plan_date: nd };
          pushHistory({ id: r.id, before: captureBefore(r, fields), after: fields });
          applyDlvFields(r.id, fields);
          return;
        }
        if (spec.id === 'status' && data.kind === 'flow-dropdown') {
          const value = String(data.value ?? '');
          if (value === 'перенос' || value === TRANSFER_REASON) {
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
          // §13 (юзер 2026-07-03): МОЛ в ОТЧЁТЕ меняется как в Плане (СЭД-замок снят —
          // настроим позже). allowFree на ручных; на обычных — валидируем по складу.
          const resolved = resolveMolForRow(r, String(data.value ?? ''), { allowFree: isManualRow(r) });
          if (resolved.error) {
            setMsg(resolved.error);
            return;
          }
          applyMolChange(r, resolved.value);
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
          // Вставка скопированной ячейки «БОРТ, ПУЛЬМАН» (copyData через запятую) — тоже понимаем.
          const types = splitMultiCell(String(data.value ?? '').replace(/,\s*/g, '\n'));
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
        // ГАРАЖНЫЙ — теперь обычный текст (руками), кастомной ветки машин нет (юзер 2026-07-03).
        return;
      }
      if (newValue.kind !== GridCellKind.Text) return;
      const raw = String(newValue.data ?? '').trim();

      if (spec.id === 'mol') {
        // §13: МОЛ правится в Плане и Отчёте (СЭД-замок снят). Отчёт пишет и на якорь.
        const resolved = resolveMolForRow(r, raw, { allowFree: isManualRow(r) });
        if (resolved.error) {
          setMsg(resolved.error);
          return;
        }
        applyMolChange(r, resolved.value);
        return;
      }

      if (spec.id === 'approved') {
        // «Кто согласовал» — поле ЯКОРЯ: пишем строку формирования (отразится во всех видах).
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (!anchor) {
          // Ручная строка без якоря — «согласовал» живёт на самой строке (snap_approved).
          if (isManualRow(r)) {
            const fields: Record<string, string | number | null> = { snap_approved: raw };
            const before = captureBefore(r, fields);
            if (String(before.snap_approved ?? '') === raw) return;
            setMsg('');
            applyDlvFields(r.id, fields);
            pushHistory({ id: r.id, before, after: fields });
            return;
          }
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
          // Ручная строка без якоря — комментарий живёт на самой строке (snap_note).
          if (isManualRow(r)) {
            const fields: Record<string, string | number | null> = { snap_note: raw };
            const before = captureBefore(r, fields);
            if (String(before.snap_note ?? '') === raw) return;
            setMsg('');
            applyDlvFields(r.id, fields);
            pushHistory({ id: r.id, before, after: fields });
            return;
          }
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
        // Ручные (написанные с нуля) строки — кол-во правится и после фиксации; буферные/
        // SAP-строки после фиксации неизменны (юзер 2026-07-04: «слепок»).
        if (Number(r.fixation_id) > 0 && !isFreeEditRow(r)) {
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
        // ГАРАЖНЫЙ пишем РУКАМИ (юзер 2026-07-03) — свободный текст, без сверки с базой
        // транспорта. Пишет только ride_id; ТИП ТС (vehicle) — отдельный маркер.
        const ids = splitMultiCell(raw);
        if (ids.length > 3) {
          setMsg('Не больше трёх гаражных');
          return;
        }
        fields.ride_id = ids.join('\n');
      }
      else if (spec.id === 'q') fields.q_spec = raw;
      // Ручные (написанные с нуля) строки: остальные поля пишутся прямо в таблице.
      // Буферные (paste:)/SAP — эти поля НЕ правятся (юзер 2026-07-04: саповский формат).
      else if (isFreeEditRow(r) && spec.id === 'fr') fields.fr = raw.trim();
      else if (isFreeEditRow(r) && spec.id === 'to') fields.to_wh = raw.trim();
      else if (isFreeEditRow(r) && spec.id === 'no') fields.no_num = raw.trim();
      else if (isFreeEditRow(r) && spec.id === 'mat') fields.mat = raw;
      else if (isFreeEditRow(r) && spec.id === 'uom') fields.uom = raw.trim();
      else if (isFreeEditRow(r) && spec.id === 'dlvord') {
        // «Поставка|П/П» первой строкой, «заказ|позиция» второй (как показ ячейки).
        const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim());
        const [dlvLine = '', ordLine = ''] = lines;
        const [dlv = '', dlvPos = ''] = dlvLine.split('|').map((s) => s.trim());
        const [ordV = '', itV = ''] = ordLine.split('|').map((s) => s.trim());
        fields.dlv = dlv === 'черновик' ? '' : dlv;
        fields.dlv_pos = dlvPos;
        fields.ord = ordV;
        fields.it = itV;
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
      applyMolChange,
      resolveExpeditorsForRow,
      vehicleOptions,
      vehicleByGarage,
    ],
  );

  /** Поля СТРОКИ для вставки значения в колонку (общая часть текстовых правок).
   *  null — колонка не «поле строки» (статус/якорные и т.п.) → одиночный путь. */
  const fieldsForPaste = useCallback(
    (r: FlowDeliveryRow, spec: PlanColSpec, rawIn: string): { fields?: Record<string, string | number | null>; error?: string } | null => {
      const raw = rawIn.trim();
      const manualExtra = isManualRow(r) && MANUAL_EDIT_IDS.has(spec.id);
      if ((!spec.editable && !manualExtra) || rowLocked(r)) return null;
      switch (spec.id) {
        case 'exp': {
          const resolved = resolveExpeditorsForRow(r, raw);
          if (resolved.error) return { error: resolved.error };
          return { fields: { exp1: resolved.value, exp2: '' } };
        }
        case 'vehicleType': {
          // «БОРТ, ПУЛЬМАН» через запятую (копия нашей ячейки) тоже понимаем.
          const types = splitMultiCell(raw.replace(/,\s*/g, '\n'));
          if (types.length > 3) return { error: 'Можно выбрать не больше трёх типов ТС' };
          return { fields: { vehicle: types.join('\n') } };
        }
        case 'vehicle': {
          const ids = splitMultiCell(raw.replace(/,\s*/g, '\n'));
          if (ids.length > 3) return { error: 'Не больше трёх гаражных' };
          return { fields: { ride_id: ids.join('\n') } };
        }
        case 'trz':
          return { fields: { trz: raw } };
        case 'q':
          return { fields: { q_spec: raw } };
        case 'mol': {
          const resolved = resolveMolForRow(r, raw, { allowFree: isManualRow(r) });
          if (resolved.error) return { error: resolved.error };
          return { fields: { snap_mol: resolved.value } };
        }
        case 'qty': {
          if (Number(r.fixation_id) > 0 && !isFreeEditRow(r)) {
            return { error: 'Состав зафиксирован — кол-во не меняется (свободны машина/экспедиторы/ID)' };
          }
          const n = raw === '' ? null : parseQty(raw);
          if (raw !== '' && (n == null || n < 0)) return { error: `«${raw}» — не число` };
          return { fields: { qty: n } };
        }
        case 'note':
          // Комментарий НА СТРОКЕ (зафикс./ручная без якоря); якорный — одиночный путь.
          if (Number(r.fixation_id) > 0 || (isManualRow(r) && !anchorByKey.get(`${r.ord}|${r.it}`))) {
            return { fields: { snap_note: raw } };
          }
          return null;
        default:
          return null;
      }
    },
    [rowLocked, resolveExpeditorsForRow, resolveMolForRow, anchorByKey],
  );

  // Пачка правок вставки: ВСЕ поля одной строки — ОДНИМ элементом запроса. Раньше каждая
  // ячейка шла отдельным запросом с ОДНИМ row_version строки — второй (гаражный после
  // типа ТС) падал конфликтом, и эхо первого стирало вторую колонку: «вставилось и
  // сбросилось» (юзер 2026-07-05). Заодно вся вставка — одно действие истории.
  const applyFieldsBatch = useCallback(
    (batch: Array<{ id: number; fields: Record<string, string | number | null> }>) => {
      const merged = new Map<number, Record<string, string | number | null>>();
      for (const b of batch) merged.set(b.id, { ...(merged.get(b.id) ?? {}), ...b.fields });
      const items: PlanEdit[] = [];
      for (const [id, fields] of merged) {
        const cur = rowsRef.current.find((x) => x.id === id);
        if (!cur || rowLocked(cur)) continue;
        const before = captureBefore(cur, fields);
        if (!Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''))) continue;
        items.push({ id, before, after: fields });
      }
      if (items.length === 0) return;
      applyFillItems(items, 'after');
      pushHistory({ kind: 'fill', items, label: 'Вставка' });
    },
    [rowLocked, captureBefore, applyFillItems, pushHistory],
  );

  const onCellsEdited = useCallback(
    (edits: readonly { location: Item; value: EditableGridCell }[]) => {
      // Одиночная правка — прежний путь (свои сообщения/история). Пачка (вставка
      // диапазоном) — собираем поля по строкам и шлём одним запросом (см. applyFieldsBatch).
      if (edits.length <= 1) {
        for (const e of edits) onCellEdited(e.location, e.value);
        return true;
      }
      const batch: Array<{ id: number; fields: Record<string, string | number | null> }> = [];
      const molAnchors: Array<{ anchor: FlowRow; mol: string }> = [];
      let lastError = '';
      for (const e of edits) {
        const spec = COLS[e.location[0]];
        const r = viewRows[e.location[1]];
        if (!spec || !r) continue;
        let raw: string | undefined;
        if (e.value.kind === GridCellKind.Text) raw = String(e.value.data ?? '');
        else if (e.value.kind === GridCellKind.Custom) {
          const d = e.value.data as { kind?: string; value?: string; driver?: string } | undefined;
          if (d?.kind === 'flow-driver' && spec.id === 'exp') raw = String(d.driver ?? '');
          else if (d?.kind === 'flow-dropdown' && spec.id === 'vehicleType') raw = String(d.value ?? '');
        }
        const res = raw === undefined ? null : fieldsForPaste(r, spec, raw);
        if (res === null) {
          onCellEdited(e.location, e.value);
          continue;
        }
        if (res.error) {
          lastError = res.error;
          continue;
        }
        if (res.fields) {
          batch.push({ id: r.id, fields: res.fields });
          // §13: МОЛ в Отчёте — обратная связь с формированием (как одиночная правка).
          if (spec.id === 'mol' && mode === 'report') {
            const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
            const mol = String(res.fields.snap_mol ?? '');
            if (anchor && String(anchor.mol ?? '') !== mol) molAnchors.push({ anchor, mol });
          }
        }
      }
      if (batch.length > 0) applyFieldsBatch(batch);
      for (const a of molAnchors) applyAnchorFields(a.anchor, { mol: a.mol });
      if (lastError) setMsg(lastError);
      return true;
    },
    [COLS, viewRows, onCellEdited, fieldsForPaste, applyFieldsBatch, applyAnchorFields, anchorByKey, mode],
  );

  // §7-B: двойной клик (Enter) по НОМЕНКЛАТУРЕ (NO.№) → карточка изменения материала.
  // Ручные строки — НЕ карточка, а прямое редактирование ячейки (юзер 2026-07-03).
  const onCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (spec.id === 'no' && !isManualRow(r)) openVghCard(r);
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
        // Зафиксированный слепок в Плане — СЕРОВАТАЯ ЗАЛИВКА, не только текст (юзер
        // 2026-07-04): видно, что строки не активны и там ничего не выбрать.
        if (Number(r.fixation_id) > 0) return { bgCell: '#EFEEE9', textDark: '#8C8983' };
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
        // Ручная пастельная ЗАЛИВКА (кисть, юзер 2026-07-04) — раскидка по машинам ДО
        // отметок; приоритетнее авто-тона по гаражному. В гриде — смягчённый тон
        // (пиллы контрастнее, юзер 2026-07-05); в xlsx — полный цвет.
        if ((r.row_fill || '').trim()) return { bgCell: softenRowFill(`#${r.row_fill}`) };
        // Ожидание + выбран гаражный → свой пастельный тон машины (юзер 2026-07-03:
        // «каждый гаражный получит свой уникальный цвет — визуально группировать машины»).
        const garage = splitMultiCell(r.ride_id || '')[0];
        if (garage) return { bgCell: garageRowColor(garage) };
      }
      if (!(r.dlv || '').trim()) return { textDark: '#5A5752' };
      return undefined;
    },
    [viewRows, flagById, mode, rowLocked, molsForWh],
  );

  // ── «Заливка» как в Excel (юзер 2026-07-04): выделил ячейки → кнопка красит ВСЮ
  // строку выбранным цветом. Цвет выбирается в палитре (квадрат в кнопке его показывает),
  // окно палитры закрывается после выбора. Ластика нет: отмена = Undo (одно действие);
  // повторная заливка тем же цветом по тем же строкам — снимает. Палитра единая с
  // авто-цветом машин (FLOW_FILL_PALETTE).
  const [paintColor, setPaintColor] = useState<string>(FLOW_FILL_PALETTE[0]);
  const [paintOpen, setPaintOpen] = useState(false);
  /** Индексы строк из выделения Glide (строки + текущий прямоугольник). */
  const selectionRowIdxs = (sel: GridSelection): number[] => {
    const out = new Set<number>();
    for (const i of sel.rows) out.add(i);
    const range = sel.current?.range;
    if (range) for (let y = range.y; y < range.y + range.height; y++) out.add(y);
    return [...out];
  };
  const applyFillToSelection = useCallback(() => {
    const targets: FlowDeliveryRow[] = [];
    for (const i of selectionRowIdxs(selectionRef.current)) {
      const r = viewRows[i];
      if (r && !rowLocked(r)) targets.push(r);
    }
    if (targets.length === 0) {
      setMsg('Выделите ячейки строк — заливка красит строки целиком');
      return;
    }
    // Все выбранные уже этого цвета → снимаем (повторное нажатие = убрать заливку).
    const allSame = targets.every((t) => (t.row_fill || '') === paintColor);
    const next = allSame ? '' : paintColor;
    const items = targets.map((t) => ({
      id: t.id,
      before: { row_fill: t.row_fill || '' } as Record<string, string | number | null>,
      after: { row_fill: next } as Record<string, string | number | null>,
    }));
    applyFillItems(items, 'after');
    pushHistory({ kind: 'fill', items });
    setMsg(next ? `Залито строк: ${targets.length}` : `Заливка снята: ${targets.length}`);
  }, [viewRows, rowLocked, paintColor, applyFillItems, pushHistory]);

  /** Массовая отметка отчёта (ТЗ §5.1): одно значение на все выделенные строки,
   *  БЕЗ привязки к складу — выбрал → протянулось. Причина чистится при «увезли». */
  // Применить статус ко ВСЕМ выделенным строкам разом (массовая отметка + вставка значения
  // статуса из буфера). Замок 7 дней уважаем. `done_stat:''` = сброс в ожидание.
  const applyStatusToSelected = useCallback(
    (fields: { done_stat: string; fail_reason: string }) => {
      const targets: FlowDeliveryRow[] = [];
      let lockedHit = false;
      for (const idx of selectionRef.current.rows) {
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
    [viewRows, applyServerDlv, rowLocked],
  );
  const massMark = useCallback(
    (done: 'выполнено' | 'не увезли', reason: string) =>
      applyStatusToSelected({ done_stat: done, fail_reason: done === 'не увезли' ? reason : '' }),
    [applyStatusToSelected],
  );
  // Вставка из буфера в колонку СТАТУС: одно скопированное значение → на ВСЕ выделенные строки
  // (юзер 2026-06-15: «копирую, выделяю другие строки, вставляю — а идёт только на одну»). Перенос
  // вставкой не копируем (у него своя дата-логика через ячейку). Прочие колонки — стандартная Glide.
  // ШИРОКАЯ вставка «до AL» (В7, юзер 2026-07-02): скопированные из SAP/Excel строки формата
  // ZM_VL (~38 колонок, ≥24) в ПЛАНЕ разносятся по нашим полям сервером (номера на черновики /
  // новые строки НИЖЕ текущих) — не по видимым колонкам грида. Числа нормализует сервер
  // («2.000,000» = 2000, «22.400» = 22.4).
  // Общий приём строк «до AL» (кнопка «Вставить из буфера» и Cmd/Ctrl+V по гриду).
  // План: номера на черновики + новые черновики; Отчёт: строки сразу в отчёт своей даты
  // (МОЛ/коммент/согласовал подтягиваются с якоря формирования на сервере).
  const applyPastedRows = useCallback(
    (text: string): boolean => {
      const totalLines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).length;
      const parsed = parsePlanPasteTsv(text);
      if (parsed.length === 0) return false;
      // План — только на КОНКРЕТНЫЙ выбранный день (юзер 2026-07-02, раунд 4): без выбранного
      // дня вставка не идёт. Отчёт — на выбранный день, иначе на сегодня (день потом меняется
      // в ячейке даты и протягивается).
      if (mode === 'plan' && !selectedDay) {
        setMsg('Выберите день в календаре — вставка в План идёт на конкретный день');
        return true;
      }
      const skipped = Math.max(0, totalLines - parsed.length);
      setMsg(`Вставка: разбираю ${parsed.length} строк…`);
      const planDate = selectedDay ?? (mode === 'report' ? isoTodayLocal() : undefined);
      void flowPlanRowsApply(api, parsed, { planDate, source: 'paste', target: mode })
        .then((r) => {
          // В историю — как одно действие: ⌘Z убирает вставленные строки, ⌘⇧Z вернёт.
          pushHistory({ kind: 'paste', ids: r.insertedIds, rows: parsed, planDate, target: mode });
          setMsg(
            `Вставлено: ${r.inserted} нов · ${r.assigned} на черновики · ${r.updated} обновлено` +
              (skipped > 0 ? ` · ${skipped} строк без ключа пропущено` : ''),
          );
        })
        .catch((e) => setMsg(`Вставка не прошла: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`));
      return true;
    },
    [mode, selectedDay, pushHistory],
  );
  // Выгрузка .xlsx на выбранную дату — план / доп.N / весь день / экспедиторам.
  // Доступна и из ОТЧЁТА, и из ПЛАНА (юзер 2026-07-04): в Плане качается тот же
  // зафиксированный слепок, формат одинаковый.
  const reportBatches = useMemo(() => {
    if (!selectedDay) return [] as { batch: number; rank: number }[];
    const ranks = batchRankByDate.get(selectedDay);
    const s = new Set<number>();
    for (const r of rows) {
      if (Number(r.fixation_id) > 0 && Number(r.reserved) !== 1 && (r.plan_date || '').slice(0, 10) === selectedDay) {
        s.add(Number(r.batch_seq) || 0);
      }
    }
    return [...s]
      .filter((b) => b > 0)
      .map((batch) => ({ batch, rank: ranks?.get(batch) ?? batch }))
      .sort((a, b) => a.rank - b.rank);
  }, [mode, selectedDay, rows, batchRankByDate]);
  // Раскладка выгрузки — СЕРВЕРНАЯ (кэш на сессию): формат правится без обновления
  // приложения; сервер недоступен → встроенный дефолт.
  const xlsxLayoutRef = useRef<FlowXlsxLayout | null | undefined>(undefined);
  const runXlsxExport = useCallback(
    async (batch: number | 'all' | 'exped') => {
      if (!selectedDay) {
        setMsg('Выберите день отчёта в календаре');
        return;
      }
      // «Выполнено» (зелёные) в печать не попадает — ни кладовщикам, ни экспедиторам
      // (юзер 2026-07-03): такие уже увезены, файлы — про оставшуюся работу дня.
      const isDone = (x: FlowDeliveryRow): boolean =>
        x.done_stat === STATUS_DONE || x.done_stat === 'увезли';
      const dayRows = rows.filter(
        (x) =>
          Number(x.fixation_id) > 0 &&
          Number(x.reserved) !== 1 &&
          (x.plan_date || '').slice(0, 10) === selectedDay &&
          (batch === 'all' || batch === 'exped' || Number(x.batch_seq) === batch) &&
          !isDone(x),
      );
      if (dayRows.length === 0) {
        setMsg('Нет строк для выгрузки на этот день (выполненные в файл не идут)');
        return;
      }
      if (xlsxLayoutRef.current === undefined) {
        xlsxLayoutRef.current = await flowXlsxLayoutGet(api);
      }
      // Файл «Экспедиторам» (юзер 2026-07-03/04, печать из приложения УБРАНА — только
      // скачка): раскидка по машинам (гаражный), схлопывание одинаковых получатель+
      // отправитель+материал (МОЛ тот же, комменты не отличаются), разрыв по машине.
      if (batch === 'exped') {
        const expInputs: ExpedXlsxRow[] = dayRows.map((x) => {
          const vgh = vghByKey.get(normVghKey(x.no_num));
          const q = effQty(x);
          const molFio = parseMol(x.snap_mol || '')?.fio ?? (x.snap_mol || '');
          const clstRaw = (whMapGet(whByKey, x.to_wh)?.cluster ?? '').trim();
          const garage = splitMultiCell(x.ride_id || '')[0] ?? '';
          return {
            fr: x.fr, to_wh: x.to_wh, dlv: x.dlv, dlv_pos: x.dlv_pos, mat: x.mat,
            no_num: x.no_num, qty: q,
            clst: clstRaw === 'ВЫЕЗД' || clstRaw === 'КХП' ? clstRaw : '',
            garage,
            vehicleType: splitMultiCell(x.vehicle || '').join(', '),
            // ПОЛНЫЕ ФИО выбранных экспедиторов машины (юзер 2026-07-04) — в шапку группы.
            expeditors: deliveryExpeditors(x).map((n) => resolveExpeditorOpt(n)?.fio ?? expeditorDisplayName(n)),
            mol: compactFio(molFio),
            // Сотовый МОЛа «8 901 438 8831» — в ячейку МОЛ файла (юзер 2026-07-04).
            molPhone: formatMobilePhone(parseMol(x.snap_mol || '')?.phone ?? ''),
            uom: x.uom || '',
            kg: vgh?.weight_kg != null && q != null ? q * vgh.weight_kg : null,
            v: vgh?.volume_m3 != null && q != null ? q * vgh.volume_m3 : null,
            note: x.snap_note || '',
            matNote: (vgh?.tech_name || '').trim(),
            fillArgb: garage ? garageFillArgb(garage) : '',
          };
        });
        const book = buildExpedXlsxBook(selectedDay, expInputs, xlsxLayoutRef.current);
        downloadXlsx(expedXlsxFilename(selectedDay), book.sheets, { definedNames: book.definedNames });
        setMsg(`Экспедиторам: ${dayRows.length} строк выгружено`);
        return;
      }
      const inputs: PlanXlsxRow[] = dayRows.map((x) => {
        const anchor = anchorByKey.get(`${x.ord}|${x.it}`);
        const vgh = vghByKey.get(normVghKey(x.no_num));
        const q = effQty(x);
        const molFio = parseMol(x.snap_mol || '')?.fio ?? (x.snap_mol || '');
        // CLST — только ВЫЕЗД/КХП, кластер НТМК и прочие не указываем (юзер 2026-07-03,
        // как в гриде).
        const clstRaw = (whMapGet(whByKey, x.to_wh)?.cluster ?? '').trim();
        return {
          fr: x.fr, to_wh: x.to_wh, dlv: x.dlv, dlv_pos: x.dlv_pos, mat: x.mat, no_num: x.no_num, qty: q,
          ord: x.ord || '',
          ord_pos: x.it || '',
          clst: clstRaw === 'ВЫЕЗД' || clstRaw === 'КХП' ? clstRaw : '',
          request: anchor?.request ?? '',
          pr: x.snap_pr || '',
          graph: graphInfo(x)?.label ?? '',
          fix: fixLabelOf(x),
          trz: x.trz || '',
          mol: compactFio(molFio),
          q: x.q_spec || '',
          uom: x.uom || '',
          kg: vgh?.weight_kg != null && q != null ? q * vgh.weight_kg : null,
          v: vgh?.volume_m3 != null && q != null ? q * vgh.volume_m3 : null,
          note: x.snap_note || '',
          // Как в гриде (юзер 2026-07-05): экспедиторы «1. Фамилия Имя О.» по строкам,
          // типы ТС и гаражные — друг под другом. Из Плана — СЛЕПОК фиксации (rowExpeditors
          // и др. сами читают snap_* в режиме плана).
          exp: numberedFioLines(rowExpeditors(x).map(expeditorDisplayName)),
          vehicleType: splitMultiCell(rowVehicle(x)).join('\n'),
          garage: splitMultiCell(rowRide(x)).join('\n'),
          stockNote: x.stock_note || '',
          stockSus: x.stock_sus ?? null,
          stockMm: x.stock_mm ?? null,
          // Хвост после ID (юзер 2026-07-04): АВТОР/ДАТА/ВРЕМЯ создания поставки в SAP,
          // ОСТАТ (СвОстЦС) / СПП Ост ЦС / «Складское место» — из буфера/zm_vl-сверки.
          // Дата может быть ISO (вставка) или DD.MM.YYYY (zm_vl) — в файл единообразно DD.MM.YYYY.
          sapAuthor: x.sap_created_by || '',
          sapDate: (() => {
            const d = (x.sap_created_at || '').split(/\s+/)[0] ?? '';
            return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d;
          })(),
          sapTime: (x.sap_created_at || '').split(/\s+/)[1] ?? '',
          ostat: x.stock_cs ?? null,
          sppCs: x.spp_cs ?? null,
          stockPlace: x.stock_place || '',
          matNote: (vgh?.tech_name || '').trim(),
          // Кладовщикам — «вместе с цветом»: ручная пастельная заливка (кисть, юзер
          // 2026-07-04) приоритетнее авто-тона машины по гаражному. Из Плана — слепок
          // (snap_fill/snap_ride): цвета Отчёта в исторический план не тянем.
          fillArgb: (() => {
            const fill = (isSnapRow(x) ? x.snap_fill || '' : x.row_fill || '').trim();
            if (fill) return `FF${fill}`;
            const g = splitMultiCell(rowRide(x))[0] ?? '';
            return g ? garageFillArgb(g) : '';
          })(),
        };
      });
      // Выпадашка МОЛ склада — ЧИСТО ФИО без сотового (юзер 2026-07-04). Экспедитор —
      // без выпадашки вовсе.
      const molsByWh = new Map<string, string[]>();
      for (const x of dayRows) {
        if (molsByWh.has(x.to_wh)) continue;
        molsByWh.set(x.to_wh, molsForWh(x.to_wh).map((o) => compactFio(o.fio)));
      }
      const lists: PlanXlsxLists = { expeditors: [], molsByWh };
      // Имена (юзер 2026-07-03): «План экспедиции на июль 3 2026.xlsx» /
      // «Доп. 1 к плану экспедиции на …» — по ЖИВОМУ рангу фиксации, не по сырому batch_seq.
      const nameBatch = typeof batch === 'number'
        ? batchRankByDate.get(selectedDay)?.get(batch) ?? batch
        : batch;
      const book = buildPlanXlsxSheets(selectedDay, nameBatch, inputs, xlsxLayoutRef.current, lists);
      // «Кладовщикам экспедиторы» из Отчёта (batch='all') — своё имя файла (юзер 2026-07-04).
      const fileName = mode === 'report' && batch === 'all'
        ? kladExpedFilename(selectedDay)
        : planXlsxFilename(selectedDay, nameBatch);
      downloadXlsx(fileName, book.sheets, { definedNames: book.definedNames });
      setMsg(`Выгружено в Excel: ${dayRows.length} строк`);
    },
    [selectedDay, rows, anchorByKey, vghByKey, whByKey, effQty, graphInfo, expeditorDisplayName, resolveExpeditorOpt, molsForWh, fixLabelOf, batchRankByDate, mode, isSnapRow, rowExpeditors, rowVehicle, rowRide],
  );

  // Пустая ручная строка «как в обычной таблице» (юзер 2026-07-03): клик по хвостовой
  // строке грида — данные пишутся прямо в ячейки (склады/номенклатура/наименование/ЕИ/
  // кол-во/МОЛ/коммент/поставка+заказ — MANUAL_EDIT_IDS), или вставка SAP из буфера.
  const addEmptyRow = useCallback(() => {
    const planDate = mode === 'plan' ? selectedDay : selectedDay ?? isoTodayLocal();
    if (!planDate) {
      setMsg('Выберите день в календаре — строка добавляется на конкретный день');
      return;
    }
    void flowDeliveryAdd(api, { target: mode, planDate })
      .then(() => setMsg(`Пустая строка добавлена на ${fmtPlanDate(planDate)} — заполните ячейки`))
      .catch((e) => setMsg(`Не удалось добавить: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`));
  }, [mode, selectedDay]);

  // Кнопка «Вставить из буфера» (юзер 2026-07-02): явная вставка без фокуса в гриде.
  const pasteFromBuffer = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setMsg('Буфер пуст');
        return;
      }
      if (!applyPastedRows(text)) {
        setMsg('В буфере нет строк формата SAP (скопируйте строки целиком, до колонки AL)');
      }
    } catch (e) {
      setMsg(`Не удалось прочитать буфер: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    }
  }, [applyPastedRows]);
  const onPaste = useCallback(
    (target: readonly [number, number], values: readonly (readonly string[])[]): boolean => {
      if (Array.isArray(values) && values.some((row) => row.length >= 24)) {
        const tsv = values.map((row) => row.join('\t')).join('\n');
        if (applyPastedRows(tsv)) return false; // обработали сами — Glide не вставляет
      }
      const spec = COLS[target[0]];
      const pasted = String(values?.[0]?.[0] ?? '').trim();
      if (spec?.id === 'status' && selectionRef.current.rows.length > 1 && pasted) {
        if (pasted.startsWith(TRANSFER_REASON) || pasted.startsWith('перенос')) {
          setMsg('Перенос вставкой не копируется — задайте через ячейку статуса');
          return false;
        }
        applyStatusToSelected(decodeStatus(pasted));
        return false; // обработали сами — Glide не вставляет
      }
      // «Как в Excel» (юзер 2026-07-04): скопировал ячейку (или блок 2 колонок — тип ТС +
      // гаражный), выделил диапазон → вставка ТИРАЖИРУЕТСЯ на всё выделение, а не только
      // на первую ячейку. Правки идут ПАЧКОЙ через onCellsEdited: одна строка = один
      // элемент запроса (иначе гонка row_version — «вставилось и сбросилось»).
      const range = selectionRef.current.current?.range;
      const H = Array.isArray(values) ? values.length : 0;
      const W = H > 0 ? Math.max(...values.map((row) => row.length)) : 0;
      if (range && H > 0 && W > 0 && (range.height > H || range.width > W)) {
        const list: Array<{ location: Item; value: EditableGridCell }> = [];
        for (let dy = 0; dy < range.height; dy++) {
          for (let dx = 0; dx < range.width; dx++) {
            const v = String(values[dy % H]?.[dx % W] ?? '');
            list.push({
              location: [range.x + dx, range.y + dy] as Item,
              value: { kind: GridCellKind.Text, data: v, displayData: v, allowOverlay: true },
            });
          }
        }
        onCellsEdited(list);
        return false; // обработали сами — растянули на всё выделение
      }
      return true; // остальное — обычная вставка диапазона Glide (придёт в onCellsEdited)
    },
    [COLS, applyStatusToSelected, applyPastedRows, onCellsEdited],
  );
  const deleteSelected = useCallback(() => {
    const ids: number[] = [];
    let blocked = 0;
    for (const idx of selectionRef.current.rows) {
      const r = viewRows[idx];
      if (!r) continue;
      if (canDeleteRow(r)) ids.push(r.id);
      else blocked++;
    }
    if (ids.length === 0) {
      setMsg(blocked > 0 ? 'Старше 7 дней — отчёт закрыт, удаление заблокировано' : '');
      return;
    }
    if (blocked > 0) {
      setMsg(`Удалено ${ids.length}; ${blocked} — закрытый архив, пропущены`);
    }
    // Резерв (не стирание): позиции снова открыты → вернутся в формирование.
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      planDlvCache = next;
      return next;
    });
    clearSelection();
    void flowDeliveriesDelete(api, ids).catch(() => undefined);
  }, [viewRows, canDeleteRow, mode, clearSelection]);

  // Перенос — ЧЕРЕЗ ФОРМИРОВАНИЕ (В1, юзер 2026-07-02): копий в Плане/Отчёте не создаём.
  // Источник сереет «перенос: дата», позиция возвращается в Формирование на дату переноса;
  // в План уйдёт по «Сформировать план» (наследуя живую поставку) — сервер делает всё сам.
  const transferIds = useCallback(
    (ids: readonly number[], toDate: string | null, keepDlv = true) => {
      if (!toDate || ids.length === 0) return;
      if (toDate < transferMinDate) {
        setMsg('Перенос в прошлую дату запрещён');
        return;
      }
      setMsg('');
      void flowTransfer(api, [...ids], toDate, keepDlv)
        .then((res) => {
          applyServerDlv(res.rows);
          clearSelection();
          setPendingTransfer(null);
          setMsg(
            mode === 'report'
              ? `Перенесено строк: ${res.transferred}. Позиция вернулась в Формирование на ${fmtPlanDate(toDate)}`
              : `Перенесено строк: ${res.transferred}`,
          );
        })
        .catch((e) => {
          const text = e instanceof Error ? e.message : String(e);
          setMsg(`Не удалось перенести: ${text.slice(0, 90)}`);
        });
    },
    [applyServerDlv, mode, transferMinDate, clearSelection],
  );

  const commitPendingTransfer = useCallback(
    (toDate: string | null) => {
      if (!pendingTransfer || !toDate) return;
      transferIds(pendingTransfer.ids, toDate, pendingTransfer.keepDlv);
    },
    [pendingTransfer, transferIds],
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
            План — всегда конкретный день, без «Все дни», прошлое недоступно (юзер 2026-07-02).
            В Отчёте прошлые месяцы скрыты из вида → и в календаре недоступны. */}
        <FlowDayPicker
          mode={mode}
          rows={rows}
          selected={selectedDay}
          onSelect={(d) => { if (mode !== 'plan' || d) setSelectedDay(d); }}
          {...(mode === 'report'
            ? { minDate: `${currentMonthPrefix}-01`, disabledTitle: 'прошлый месяц скрыт из отчёта' }
            : { allowClear: false, minDate: isoTodayLocal(), disabledTitle: 'прошлый день — план только вперёд' })}
        />
        {/* CSV-экспорт убран (юзер 2026-07-03: «нам эксель подойдёт обычный») — только .xlsx. */}
        {/* «Буфер» (юзер 2026-07-02): вставка строк SAP из буфера. План — номера на черновики /
            новые черновики; Отчёт — строки сразу в отчёт (+МОЛ/коммент с формирования). */}
        <button
          type="button"
          onClick={() => void pasteFromBuffer()}
          title={mode === 'report'
            ? 'Вставить строки из буфера в Отчёт; МОЛ/комментарий подтянутся с формирования'
            : 'Вставить строки из буфера в План'}
          className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-black/10 px-1.5 text-[12px] text-[#3F3D38] outline-none transition-colors hover:border-black/25 hover:text-[#0A0A0A]"
        >
          <ClipboardPaste size={13} strokeWidth={1.75} />
          Буфер
        </button>
        {/* §4 инфо-колонки (юзер 2026-07-03): тумблеры служебных колонок (с якоря
            формирования); в xlsx/печать не идут. */}
        {PLAN_INFO_COLS.map((c) => {
          const on = visibleInfo.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleInfoCol(c.id)}
              title={on ? `Скрыть колонку «${c.title}»` : `Показать колонку «${c.title}»`}
              className={`flex h-6 shrink-0 items-center rounded-md border px-1.5 text-[11px] transition-colors ${
                on ? 'border-accent-clay/70 text-[#0A0A0A]' : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]'
              }`}
            >
              {c.title}
            </button>
          );
        })}
        {/* «Заливка» как в Excel (юзер 2026-07-04): квадрат в кнопке показывает выбранный
            цвет; выделил ячейки строк → кнопка красит строки целиком. ▾ — палитра (выбор
            закрывает окно). Отмена — Undo; повтор той же заливки — снимает. */}
        {mode === 'report' && (
          <div className="relative flex shrink-0">
            <button
              type="button"
              onClick={applyFillToSelection}
              title="Залить выделенные строки выбранным цветом (повторно тем же цветом — снять). Отмена — ⌘Z"
              className="flex h-6 items-center gap-1.5 rounded-l-md border border-black/10 px-1.5 text-[12px] text-[#3F3D38] outline-none transition-colors hover:border-black/25 hover:text-[#0A0A0A]"
            >
              <span
                className="h-3.5 w-3.5 rounded-sm border border-black/15"
                style={{ background: `#${paintColor}` }}
              />
              Заливка
            </button>
            <button
              type="button"
              onClick={() => setPaintOpen((o) => !o)}
              title="Выбрать цвет заливки"
              className="flex h-6 w-5 items-center justify-center rounded-r-md border border-l-0 border-black/10 text-[10px] text-[#6B6862] outline-none transition-colors hover:border-black/25 hover:text-[#0A0A0A]"
            >
              ▾
            </button>
            {paintOpen && (
              <div className="absolute left-0 top-7 z-50 w-[168px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg">
                <div className="grid grid-cols-5 gap-1.5">
                  {FLOW_FILL_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setPaintColor(c); setPaintOpen(false); }}
                      title={`Цвет #${c}`}
                      className={`h-6 w-6 rounded-md border transition-transform hover:scale-110 ${
                        paintColor === c ? 'border-accent-clay ring-1 ring-accent-clay/50' : 'border-black/10'
                      }`}
                      style={{ background: `#${c}` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* «Скачать» (юзер 2026-07-04): раздельно по вкладкам. ПЛАН (день зафиксирован,
            качается слепок): Кладовщикам план / доп. N / Кладовщиков общий. ОТЧЁТ:
            Экспедиторам (по машинам) + «Кладовщикам экспедиторы» (общий с цветами машин/
            заливкой). Выполненные (зелёные) строки в файлы не идут. */}
        {(mode === 'report' || reportBatches.length > 0) && (
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) void runXlsxExport(v === 'all' || v === 'exped' ? v : Number(v));
              e.target.value = '';
            }}
            title={mode === 'plan'
              ? 'Скачать зафиксированный план дня в Excel (кладовщикам)'
              : 'Скачать файлы дня в Excel: экспедиторам (по машинам) или кладовщикам с раскидкой'}
            className="h-6 max-w-[190px] shrink-0 rounded-md border border-black/10 bg-transparent px-1 text-[12px] text-[#3F3D38] outline-none transition-colors hover:border-black/25"
          >
            <option value="" disabled hidden>
              Скачать…
            </option>
            {mode === 'plan' ? (
              <>
                {reportBatches.map(({ batch, rank }) => (
                  <option key={batch} value={batch}>
                    {rank === 1 ? 'Кладовщикам план' : `Кладовщикам доп. ${rank - 1}`}
                  </option>
                ))}
                <option value="all">Кладовщиков общий</option>
              </>
            ) : (
              <>
                <option value="exped">Экспедиторам</option>
                <option value="all">Кладовщикам экспедиторы</option>
              </>
            )}
          </select>
        )}
        {/* Кнопка «+ Строка» УБРАНА (юзер 2026-07-03): пустая ручная строка добавляется
            «как в обычной таблице» — клик по хвостовой строке грида (trailing row). */}
        {/* Счётчики/подсказки убраны (юзер 2026-07-02: «лишний текстовый мусор — барахло»).
            Остаются только сообщения об операциях (msg). */}
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
                  if (e.target.value === 'перенос') setMsg('Перенос делается через ячейку статуса конкретной строки');
                  else massMark('не увезли', REASON_CANON[e.target.value] ?? e.target.value);
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
            {/* П.4 «Корзина» (юзер 2026-07-02): строка в резерв; позиция вернётся в
                формирование с данными, выгрузка заказов её актуализирует. */}
            <button
              type="button"
              onClick={deleteSelected}
              title="Удалить выделенные из отчёта (в резерв) — позиция вернётся в формирование, выгрузка актуализирует"
              className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-black/10 px-1.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Корзина
            </button>
          </div>
        )}
        {!pendingTransfer && selectedCount > 0 && mode === 'plan' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            {/* Перенос — НЕ по выделению (п.2): через ячейку статуса «перенос на другой день»
                в Отчёте. Здесь только «Корзина» (резерв). */}
            <button
              type="button"
              onClick={deleteSelected}
              title="Убрать выделенные из плана в резерв — позиции вернутся в формирование"
              className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-black/10 px-1.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Корзина
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
          <FlowGridEditor
            ref={editorRef}
            gridRef={gridRef}
            onSelectionChange={handleSelectionChange}
            colZeroRowSelect
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
            // «Как обычная таблица» (юзер 2026-07-03): хвостовая строка добавляет пустую
            // ручную строку на выбранный день — данные пишутся прямо в ячейки.
            onRowAppended={addEmptyRow}
            trailingRowOptions={{ tint: true, sticky: false }}
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
            // Backspace = Delete и на Windows (дефолт Glide даёт Backspace только на Mac).
            keybindings={{ search: false, delete: 'Backspace|Delete' }}
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
                  title="Выберите день переноса — позиция вернётся в Формирование на эту дату"
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
      {/* Форма «+ Строка» УБРАНА (юзер 2026-07-03): пустая строка добавляется сразу,
          данные пишутся прямо в таблице по видимым колонкам. */}
      {/* §5: выбор что копировать из колонки «Поставка·Заказ» (каждое — своей колонкой). */}
      {dlvCopyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
             onClick={() => setDlvCopyDialog(null)}>
          <div className="w-[320px] rounded-xl border border-black/10 bg-[#FDFDFB] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-semibold text-[#2A2925]">Копировать</div>
            <div className="mt-1 text-[12px] text-[#6B6862]">Выделено: {dlvCopyDialog.length}. Каждое поле — отдельной колонкой.</div>
            <div className="mt-3 space-y-1.5 text-[12px] text-[#2A2925]">
              {([
                ['ord', 'Заказ'], ['ordPos', 'Позиция заказа'],
                ['dlv', 'Поставка'], ['dlvPos', 'Позиция поставки'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={copyOpts[key]}
                    onChange={(e) => setCopyOpts((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDlvCopyDialog(null)}
                className="rounded-md border border-black/10 px-3 py-1 text-[12px] text-[#6B6862] transition-colors hover:border-black/25"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!copyOpts.ord && !copyOpts.ordPos && !copyOpts.dlv && !copyOpts.dlvPos}
                onClick={() => doDlvCopy(copyOpts)}
                className="rounded-md bg-accent-clay px-3 py-1 text-[12px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim disabled:opacity-40"
              >
                Копировать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
