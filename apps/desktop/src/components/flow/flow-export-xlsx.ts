// ============================================================
// flow-export-xlsx.ts — выгрузка Плана из ОТЧЁТА в .xlsx (юзер 2026-07-02).
// ============================================================
// По эталону «A. План экспедиции ….xlsm» (APLAN/BTEL), но БЕЗ макросов и «красиво»:
//  • колонки A..U без первой «Даты» (титул с датой сверху), без смайликов в заголовках;
//  • наши колонки ГРАФ (день по графику) и FIX (план/доп.N) включены; CLST остаётся;
//  • МОЛ — только ФИО (телефоны убраны, как BTEL);
//  • сортировка эталона (flow-plan-sort) + разрыв страницы по смене склада-отправителя;
//  • лист 2 «Остаток»: FIX·От·СП·Ном№·Наименование·ЕИ·Кол-во·КГ·V·Место хранения —
//    только строки с местами хранения, отправители разделены пустой строкой.

import type { FlowXlsxLayout } from '@pyn/core';
import type { XlsxSheet, XlsxValue } from '@/lib/xlsx-lite';
import { makePlanEtalonCompare, type PlanSortable } from './flow-plan-sort';

/** Подготовленная строка выгрузки (компонент собирает из строки отчёта + справочников). */
export interface PlanXlsxRow extends PlanSortable {
  request: string;
  pr: string; // «Был» (snap_pr)
  graph: string; // «ПТ 3»
  fix: string; // план / доп.1 / …
  trz: string;
  mol: string; // ФИО без телефона
  uom: string;
  kg: number | null;
  v: number | null;
  note: string;
  exp: string;
  vehicleType: string;
  garage: string;
  stockNote: string;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «2026-07-05» → «5 ИЮЛЯ 2026». */
function titleDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${parseInt(m[3] ?? '1', 10)} ${(MONTHS_GEN[parseInt(m[2] ?? '1', 10) - 1] ?? '').toUpperCase()} ${m[1]}`;
}

// Встроенный ДЕФОЛТ раскладки — зеркало серверного DEFAULT_XLSX_LAYOUT (fallback,
// если сервер недоступен). Правь ФОРМАТ на СЕРВЕРЕ (юзер 2026-07-02: «не привязкой
// к приложению, а к серверу — менять без обновления приложения»).
const FALLBACK_LAYOUT: FlowXlsxLayout = {
  plan: {
    title: 'ПЛАН НА {DATE}{BATCH}',
    columns: [
      { id: 'request', head: 'Запросил', width: 12 },
      { id: 'fr', head: 'От', width: 7 },
      { id: 'to', head: 'СП', width: 7 },
      { id: 'pr', head: 'Был', width: 7 },
      { id: 'clst', head: 'CLST', width: 8 },
      { id: 'graph', head: 'ГРАФ', width: 8 },
      { id: 'fix', head: 'FIX', width: 8 },
      { id: 'dlv', head: 'Поставка', width: 11 },
      { id: 'dlv_pos', head: 'П/П', width: 6 },
      { id: 'trz', head: 'ТЗ', width: 9 },
      { id: 'mol', head: 'МОЛ', width: 20 },
      { id: 'no_num', head: 'Ном №', width: 11 },
      { id: 'mat', head: 'Наименование', width: 42 },
      { id: 'uom', head: 'ЕИ', width: 5 },
      { id: 'qty', head: 'Кол-во', width: 9 },
      { id: 'kg', head: 'КГ', width: 9 },
      { id: 'v', head: 'V', width: 8 },
      { id: 'note', head: 'Комментарий', width: 30 },
      { id: 'exp', head: 'Экспедитор', width: 18 },
      { id: 'vehicle_type', head: 'Машина', width: 14 },
      { id: 'garage', head: 'ID', width: 10 },
    ],
  },
  rest: {
    title: 'ОСТАТОК НА {DATE}{BATCH}',
    columns: [
      { id: 'fix', head: 'FIX', width: 8 },
      { id: 'fr', head: 'От', width: 7 },
      { id: 'to', head: 'СП', width: 7 },
      { id: 'no_num', head: 'Ном №', width: 11 },
      { id: 'mat', head: 'Наименование', width: 42 },
      { id: 'uom', head: 'ЕИ', width: 5 },
      { id: 'qty', head: 'Кол-во', width: 9 },
      { id: 'kg', head: 'КГ', width: 9 },
      { id: 'v', head: 'V', width: 8 },
      { id: 'stock_note', head: 'Место хранения', width: 40 },
    ],
  },
};

const num = (v: number | null | undefined): XlsxValue =>
  v == null || !Number.isFinite(v) ? '' : Math.round(v * 1000) / 1000;

/** Значение колонки по её серверному id. */
function cellValue(r: PlanXlsxRow, id: string): XlsxValue {
  switch (id) {
    case 'request': return r.request;
    case 'fr': return r.fr;
    case 'to': return r.to_wh;
    case 'pr': return r.pr;
    case 'clst': return r.clst;
    case 'graph': return r.graph;
    case 'fix': return r.fix;
    case 'dlv': return r.dlv || '';
    case 'dlv_pos': return r.dlv_pos || '';
    case 'trz': return r.trz;
    case 'mol': return r.mol;
    case 'no_num': return r.no_num;
    case 'mat': return r.mat;
    case 'uom': return r.uom;
    case 'qty': return num(r.qty);
    case 'kg': return num(r.kg);
    case 'v': return num(r.v);
    case 'note': return r.note;
    case 'exp': return r.exp;
    case 'vehicle_type': return r.vehicleType;
    case 'garage': return r.garage;
    case 'stock_note': return r.stockNote;
    default: return '';
  }
}

function colLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function fillTitle(tpl: string, dateIso: string, batchLabel: string): string {
  return tpl
    .replace('{DATE}', titleDate(dateIso))
    .replace('{BATCH}', batchLabel ? ` · ${batchLabel.toUpperCase()}` : '');
}

/**
 * Собрать листы «План …» + «Остаток» для .xlsx. batchLabel: '' = весь день.
 * Раскладка (колонки/титулы/порядок складов сортировки) — СЕРВЕРНАЯ (layout);
 * null → встроенный дефолт. Строки сортируются эталоном APLAN здесь же.
 */
export function buildPlanXlsxSheets(
  dateIso: string,
  batchLabel: string,
  rowsIn: PlanXlsxRow[],
  layout?: FlowXlsxLayout | null,
): XlsxSheet[] {
  const lay = layout ?? FALLBACK_LAYOUT;
  const rows = [...rowsIn].sort(makePlanEtalonCompare(lay.special_fr));

  // Лист 1 — план. Разрыв страницы по смене склада-отправителя (как APLAN).
  const planCols = lay.plan.columns;
  const sheetRows: XlsxValue[][] = [
    [fillTitle(lay.plan.title, dateIso, batchLabel)],
    planCols.map((c) => c.head),
  ];
  const breaks: number[] = [];
  let prevFr: string | null = null;
  for (const r of rows) {
    if (prevFr !== null && r.fr !== prevFr) breaks.push(sheetRows.length); // после последней строки группы
    prevFr = r.fr;
    sheetRows.push(planCols.map((c) => cellValue(r, c.id)));
  }
  const plan: XlsxSheet = {
    name: 'ПЛАН',
    rows: sheetRows,
    colWidths: planCols.map((c) => c.width),
    merges: [`A1:${colLetter(planCols.length - 1)}1`],
    titleRows: [1],
    boldRows: [2],
    rowBreaks: breaks,
  };

  // Лист 2 — «Остаток»: только строки с местами хранения; пустая строка между отправителями.
  const restCols = lay.rest.columns;
  const restRows: XlsxValue[][] = [
    [fillTitle(lay.rest.title, dateIso, batchLabel)],
    restCols.map((c) => c.head),
  ];
  let prevFr2: string | null = null;
  for (const r of rows) {
    if (!r.stockNote.trim()) continue; // пустые места хранения убираем
    if (prevFr2 !== null && r.fr !== prevFr2) restRows.push([]);
    prevFr2 = r.fr;
    restRows.push(restCols.map((c) => cellValue(r, c.id)));
  }
  const rest: XlsxSheet = {
    name: 'Остаток',
    rows: restRows,
    colWidths: restCols.map((c) => c.width),
    merges: [`A1:${colLetter(restCols.length - 1)}1`],
    titleRows: [1],
    boldRows: [2],
  };

  return [plan, rest];
}
