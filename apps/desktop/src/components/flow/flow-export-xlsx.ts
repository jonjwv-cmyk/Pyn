// ============================================================
// flow-export-xlsx.ts — выгрузка Плана из ОТЧЁТА в .xlsx (юзер 2026-07-02/03).
// ============================================================
// По ЭТАЛОНУ «A. План экспедиции ….xlsm»: те же шрифты/жирность (Segoe UI 8-12), тонкие
// сетки, жирная шапка с заливкой и АВТОФИЛЬТРОМ, закреплённая строка 1, форматы чисел,
// разрыв страницы по смене склада-отправителя, сортировка APLAN. БЕЗ колонки «Дата» —
// дата плана В ЗАГОЛОВКЕ «Наименования» (как M1 эталона: «03 ИЮЛЬ Наименование 2026»),
// смайликов нет. Поставка+заказ — ОДНОЙ ячейкой в 2 строки. Наши колонки: ГРАФ, FIX, Q.
// Раскладка (колонки/заголовки/ширины/стили/порядок складов) — СЕРВЕРНАЯ (layout).
// Имена: файл «План экспедиции на июль 3 2026.xlsx» / «Доп. 1 к плану экспедиции на …»;
// листы «План» / «Доп. N» и «Места хранения».

import type { FlowXlsxLayout, FlowXlsxColumn } from '@pyn/core';
import { XLSX_STYLE, type XlsxSheet, type XlsxValue } from '@/lib/xlsx-lite';
import { makePlanEtalonCompare, type PlanSortable } from './flow-plan-sort';

/** Подготовленная строка выгрузки (компонент собирает из строки отчёта + справочников). */
export interface PlanXlsxRow extends PlanSortable {
  request: string;
  pr: string; // «Был» (snap_pr)
  graph: string; // «ПТ 3»
  fix: string; // план / доп. 1 / …
  trz: string;
  mol: string; // ФИО без телефона
  q: string; // аварийный/особый запас
  ord: string;
  uom: string;
  kg: number | null;
  v: number | null;
  note: string;
  exp: string;
  vehicleType: string;
  garage: string;
  stockNote: string;
}

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** Имя файла по правилу юзера: план → «План экспедиции на июль 3 2026.xlsx»,
 *  доп → «Доп. 1 к плану экспедиции на июль 3 2026.xlsx». batch 0/'all' → план. */
export function planXlsxFilename(dateIso: string, batch: number | 'all'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  const dateRu = m
    ? `${MONTHS_NOM[parseInt(m[2] ?? '1', 10) - 1] ?? ''} ${parseInt(m[3] ?? '1', 10)} ${m[1]}`
    : dateIso;
  if (batch !== 'all' && batch >= 2) return `Доп. ${batch - 1} к плану экспедиции на ${dateRu}.xlsx`;
  return `План экспедиции на ${dateRu}.xlsx`;
}

/** Заголовок «Наименования» с датой плана (эталон M1): «03 ИЮЛЬ Наименование 2026». */
function matHeadOf(tpl: string, dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) return 'Наименование';
  return tpl
    .replace('{DD}', m[3] ?? '')
    .replace('{MONTH}', (MONTHS_NOM[parseInt(m[2] ?? '1', 10) - 1] ?? '').toUpperCase())
    .replace('{YYYY}', m[1] ?? '');
}

// Fallback-раскладка — зеркало серверного DEFAULT_XLSX_LAYOUT (сервер недоступен).
// ФОРМАТ правь на СЕРВЕРЕ (юзер: «не привязкой к приложению»).
const FALLBACK_LAYOUT: FlowXlsxLayout = {
  plan: {
    matHead: '{DD} {MONTH} Наименование {YYYY}',
    columns: [
      { id: 'request', head: 'Запросил', width: 13.5, style: 'text' },
      { id: 'fr', head: 'От', width: 7, style: 'bold12-r' },
      { id: 'to', head: 'СП', width: 6.5, style: 'bold12-r' },
      { id: 'pr', head: 'Был', width: 8, style: 'text12-r' },
      { id: 'clst', head: 'CLST', width: 8.5, style: 'text12-r' },
      { id: 'graph', head: 'ГРАФ', width: 8.5, style: 'text12-r' },
      { id: 'fix', head: 'FIX', width: 8, style: 'text12-r' },
      { id: 'dlvord', head: 'Поставка', width: 13.2, style: 'bold12-r-wrap' },
      { id: 'dlv_pos', head: 'П/П', width: 7.7, style: 'text-r' },
      { id: 'trz', head: 'ТЗ', width: 6, style: 'text-r' },
      { id: 'mol', head: 'МОЛ', width: 23.2, style: 'mol' },
      { id: 'q', head: 'Q', width: 5.2, style: 'bold10' },
      { id: 'no_num', head: 'Ном №', width: 11.6, style: 'text12-r' },
      { id: 'mat', head: 'Наименование', width: 50.7, style: 'wrap12' },
      { id: 'uom', head: 'ЕИ', width: 6.5, style: 'text' },
      { id: 'qty', head: 'Кол-во', width: 12.6, style: 'num3' },
      { id: 'kg', head: 'КГ', width: 7, style: 'kgv' },
      { id: 'v', head: 'V', width: 5, style: 'kgv' },
      { id: 'note', head: 'Комментарий', width: 21.6, style: 'mol' },
      { id: 'exp', head: 'Экспедитор', width: 15.7, style: 'wrap10' },
      { id: 'vehicle_type', head: 'Машина', width: 12.3, style: 'text' },
      { id: 'garage', head: 'ID', width: 5.9, style: 'text-r' },
    ],
  },
  rest: {
    columns: [
      { id: 'fix', head: 'FIX', width: 8, style: 'text12-r' },
      { id: 'fr', head: 'От', width: 7, style: 'bold12-r' },
      { id: 'to', head: 'СП', width: 6.5, style: 'bold12-r' },
      { id: 'no_num', head: 'Ном №', width: 11.6, style: 'text12-r' },
      { id: 'mat', head: 'Наименование', width: 50.7, style: 'wrap12' },
      { id: 'uom', head: 'ЕИ', width: 6.5, style: 'text' },
      { id: 'qty', head: 'Кол-во', width: 12.6, style: 'num3' },
      { id: 'kg', head: 'КГ', width: 7, style: 'kgv' },
      { id: 'v', head: 'V', width: 5, style: 'kgv' },
      { id: 'stock_note', head: 'Место хранения', width: 40, style: 'wrap10' },
    ],
  },
};

/** Стиль по умолчанию для id (если сервер не прислал пресет). */
const DEFAULT_STYLE_BY_ID: Record<string, string> = {
  request: 'text', fr: 'bold12-r', to: 'bold12-r', pr: 'text12-r', clst: 'text12-r',
  graph: 'text12-r', fix: 'text12-r', dlvord: 'bold12-r-wrap', dlv: 'bold12-r', dlv_pos: 'text-r',
  trz: 'text-r', mol: 'mol', q: 'bold10', no_num: 'text12-r', mat: 'wrap12', uom: 'text',
  qty: 'num3', kg: 'kgv', v: 'kgv', note: 'mol', exp: 'wrap10', vehicle_type: 'text', garage: 'text-r',
  stock_note: 'wrap10',
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
    // Поставка + заказ одной ячейкой в 2 строки (юзер 2026-07-03).
    case 'dlvord': return [r.dlv, r.ord].filter(Boolean).join('\n');
    case 'dlv': return r.dlv || '';
    case 'dlv_pos': return r.dlv_pos || '';
    case 'trz': return r.trz;
    case 'mol': return r.mol;
    case 'q': return r.q;
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

function styleOf(c: FlowXlsxColumn): number {
  return XLSX_STYLE[c.style ?? DEFAULT_STYLE_BY_ID[c.id] ?? 'text'] ?? 0;
}

/**
 * Собрать листы «План»/«Доп. N» + «Места хранения». batch: 1=план, 2+=доп, 'all'=весь день.
 * Раскладка серверная (layout, null → дефолт). Сортировка APLAN здесь же.
 */
export function buildPlanXlsxSheets(
  dateIso: string,
  batch: number | 'all',
  rowsIn: PlanXlsxRow[],
  layout?: FlowXlsxLayout | null,
): XlsxSheet[] {
  const lay = layout ?? FALLBACK_LAYOUT;
  const rows = [...rowsIn].sort(makePlanEtalonCompare(lay.special_fr));
  const sheetName = batch !== 'all' && batch >= 2 ? `Доп. ${batch - 1}` : 'План';

  // Лист 1: шапка строкой 1 (дата — в заголовке «Наименования»), автофильтр, freeze,
  // разрыв страницы по смене склада-отправителя.
  const planCols = lay.plan.columns;
  const matTpl = lay.plan.matHead || '{DD} {MONTH} Наименование {YYYY}';
  const head = planCols.map((c) => (c.id === 'mat' ? matHeadOf(matTpl, dateIso) : c.head));
  const sheetRows: XlsxValue[][] = [head];
  const breaks: number[] = [];
  let prevFr: string | null = null;
  for (const r of rows) {
    if (prevFr !== null && r.fr !== prevFr) breaks.push(sheetRows.length);
    prevFr = r.fr;
    sheetRows.push(planCols.map((c) => cellValue(r, c.id)));
  }
  const plan: XlsxSheet = {
    name: sheetName,
    rows: sheetRows,
    colWidths: planCols.map((c) => c.width),
    colStyles: planCols.map(styleOf),
    autoFilter: true,
    freezeTop: true,
    rowBreaks: breaks,
  };

  // Лист 2 «Места хранения»: только строки с местами; пустая строка между отправителями.
  const restCols = lay.rest.columns;
  const restRows: XlsxValue[][] = [restCols.map((c) => c.head)];
  let prevFr2: string | null = null;
  for (const r of rows) {
    if (!r.stockNote.trim()) continue; // пустые места хранения убираем
    if (prevFr2 !== null && r.fr !== prevFr2) restRows.push([]);
    prevFr2 = r.fr;
    restRows.push(restCols.map((c) => cellValue(r, c.id)));
  }
  const rest: XlsxSheet = {
    name: 'Места хранения',
    rows: restRows,
    colWidths: restCols.map((c) => c.width),
    colStyles: restCols.map(styleOf),
    autoFilter: true,
    freezeTop: true,
  };

  return [plan, rest];
}
