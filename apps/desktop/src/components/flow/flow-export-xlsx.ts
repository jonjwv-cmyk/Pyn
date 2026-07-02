// ============================================================
// flow-export-xlsx.ts — выгрузка Плана из ОТЧЁТА в .xlsx (юзер 2026-07-02/03).
// ============================================================
// По ЭТАЛОНУ «A. План экспедиции ….xlsm»: те же шрифты/жирность (Segoe UI 8-12), тонкие
// сетки, жирная шапка с заливкой и АВТОФИЛЬТРОМ, закреплённая строка 1, форматы чисел,
// разрыв страницы по смене склада-отправителя, сортировка APLAN. БЕЗ колонки «Дата» —
// дата плана В ЗАГОЛОВКЕ «Материала» («Июль 3, 26г. Материал», на обоих листах).
// Поставка+заказ — ОДНОЙ ячейкой в 2 строки: «поставка | поз» ЖИРНЫМ, ниже
// «заказ | поз» обычным (колонка П/П больше не нужна). CLST — только ВЫЕЗД/КХП.
// Показ сразу в СТРАНИЧНОМ режиме, масштаб 100% (иначе Excel игнорирует разрывы),
// ширины — АВТОПОДГОНКА по содержимому (кроме wrap-колонок). Остатки в «Месте
// хранения» — числа без SAP-точек (как Кол-во). Выпадашки: МОЛы склада-получателя
// (с сотовым) и экспедиторы (роль в потоке) — через скрытый лист «Списки».
// Примечание на материале — полное техническое наименование (база ВГХ).
// Раскладка (колонки/заголовки/стили/порядок складов) — СЕРВЕРНАЯ (layout).
// Имена: файл «План экспедиции на июль 3 2026.xlsx» / «Доп. 1 к плану экспедиции на …»;
// листы «План» / «Доп. N» и «Места хранения».

import type { FlowXlsxLayout, FlowXlsxColumn } from '@pyn/core';
import {
  XLSX_STYLE, colLetter,
  type XlsxSheet, type XlsxValue, type XlsxDefinedName,
} from '@/lib/xlsx-lite';
import { makePlanEtalonCompare, type PlanSortable } from './flow-plan-sort';

/** Подготовленная строка выгрузки (компонент собирает из строки отчёта + справочников). */
export interface PlanXlsxRow extends PlanSortable {
  request: string;
  pr: string; // «Был» (snap_pr)
  graph: string; // «ПТ 3»
  fix: string; // план / доп. 1 / …
  ord_pos: string; // позиция заказа (it)
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
  matNote: string; // полное тех-наименование (база ВГХ) → примечание на материале
}

/** Списки для выпадашек Excel (собирает компонент из живых справочников). */
export interface PlanXlsxLists {
  /** Экспедиторы (только роль в потоке: Экспедиторы / Водители-экспедиторы): «ФИО, +7 …». */
  expeditors: string[];
  /** МОЛы по складу-получателю (ключ = to_wh как в строках): «Фамилия И.О., +7 …». */
  molsByWh: Map<string, string[]>;
}

export interface PlanXlsxBook {
  sheets: XlsxSheet[];
  definedNames: XlsxDefinedName[];
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

/** Заголовок «Материала» с датой плана (юзер 2026-07-03): «Июль 3, 26г. Материал».
 *  Плейсхолдеры: {MONTH1}=Июль {D}=3 {YY}=26; легаси {DD}/{MONTH}/{YYYY} тоже понимаем. */
function matHeadOf(tpl: string, dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) return 'Материал';
  const mon = MONTHS_NOM[parseInt(m[2] ?? '1', 10) - 1] ?? '';
  return tpl
    .replace('{MONTH1}', mon ? mon.charAt(0).toUpperCase() + mon.slice(1) : '')
    .replace('{D}', String(parseInt(m[3] ?? '1', 10)))
    .replace('{YY}', (m[1] ?? '').slice(2))
    .replace('{DD}', m[3] ?? '')
    .replace('{MONTH}', mon.toUpperCase())
    .replace('{YYYY}', m[1] ?? '');
}

const MAT_HEAD_DEFAULT = '{MONTH1} {D}, {YY}г. Материал';

// Fallback-раскладка — зеркало серверного DEFAULT_XLSX_LAYOUT (сервер недоступен).
// ФОРМАТ правь на СЕРВЕРЕ (юзер: «не привязкой к приложению»).
const FALLBACK_LAYOUT: FlowXlsxLayout = {
  plan: {
    matHead: MAT_HEAD_DEFAULT,
    columns: [
      { id: 'request', head: 'Запросил', width: 13.5, style: 'text' },
      { id: 'fr', head: 'От', width: 7, style: 'bold12-r' },
      { id: 'to', head: 'СП', width: 6.5, style: 'bold12-r' },
      { id: 'pr', head: 'Был', width: 8, style: 'text12-r' },
      { id: 'clst', head: 'CLST', width: 8.5, style: 'text12-r' },
      { id: 'graph', head: 'ГРАФ', width: 8.5, style: 'text12-r' },
      { id: 'fix', head: 'FIX', width: 8, style: 'text12-r' },
      { id: 'dlvord', head: 'Поставка', width: 13.2, style: 'bold12-r-wrap' },
      { id: 'trz', head: 'ТЗ', width: 6, style: 'text-r' },
      { id: 'mol', head: 'МОЛ', width: 23.2, style: 'mol' },
      { id: 'q', head: 'Q', width: 5.2, style: 'bold10' },
      { id: 'no_num', head: 'Ном №', width: 11.6, style: 'text12-r' },
      { id: 'mat', head: 'Материал', width: 50.7, style: 'wrap12' },
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
      { id: 'mat', head: 'Материал', width: 50.7, style: 'wrap12' },
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

/** Число SAP-выгрузки (зеркало серверного zmNum): точка — ДЕСЯТИЧНЫЙ разделитель
 *  («22.400» = 22.4); есть и запятая и точка — последний по позиции десятичный. */
function zmNum(raw: string): number | null {
  let s = String(raw).replace(/\s+/g, '');
  if (!s || s === '-') return null;
  const hasC = s.includes(',');
  const hasD = s.includes('.');
  if (hasC && hasD) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const ruNum = (n: number): string =>
  n.toLocaleString('ru-RU', { maximumFractionDigits: 3 }).replace(/[\u00A0\u202F]/g, ' ');

/** «Место хранения» без SAP-точек в остатках (юзер 2026-07-03): «A01:22.400; B02:5.000»
 *  → «A01: 22,4; B02: 5» — числа как в колонке «Кол-во». */
function stockNoteClean(s: string): string {
  if (!s.trim()) return '';
  return s
    .split(';')
    .map((part) => {
      const p = part.trim();
      if (!p) return '';
      const i = p.lastIndexOf(':');
      if (i < 0) return p;
      const n = zmNum(p.slice(i + 1));
      return n == null ? p : `${p.slice(0, i)}: ${ruNum(n)}`;
    })
    .filter(Boolean)
    .join('; ');
}

/** Поставка+заказ одной ячейкой (юзер 2026-07-03): «поставка | поз» ЖИРНЫМ,
 *  ниже «заказ | поз» обычным. */
function dlvOrdCell(r: PlanXlsxRow): XlsxValue {
  const line1 = [r.dlv, r.dlv_pos].filter(Boolean).join(' | ');
  const line2 = [r.ord, r.ord_pos].filter(Boolean).join(' | ');
  if (!line1 && !line2) return '';
  if (line1 && line2) return { rich: [{ t: line1, bold: true, sz: 12 }, { t: `\n${line2}`, sz: 12 }] };
  if (line1) return { rich: [{ t: line1, bold: true, sz: 12 }] };
  return { rich: [{ t: line2, sz: 12 }] };
}

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
    case 'dlvord': return dlvOrdCell(r);
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
    case 'stock_note': return stockNoteClean(r.stockNote);
    default: return '';
  }
}

function styleNameOf(c: FlowXlsxColumn): string {
  return c.style && c.style in XLSX_STYLE ? c.style : DEFAULT_STYLE_BY_ID[c.id] ?? 'text';
}
function styleOf(c: FlowXlsxColumn): number {
  return XLSX_STYLE[styleNameOf(c)] ?? 0;
}

// ── Автоподгонка ширин (юзер 2026-07-03: «после масштаба 100%, чтобы вместилось всё») ──
// Единица ширины Excel ≈ цифра Calibri 11 ≈ цифра Segoe UI 10 → фактор = размер/10.
// Wrap-колонки (наименование/МОЛ/комментарий/экспедитор/место хранения) переносят
// текст по ДИЗАЙНУ — им остаётся серверная ширина; остальным ширина по содержимому.
const KEEP_WRAP = new Set(['wrap12', 'mol', 'wrap10']);
const STYLE_FONT: Record<string, { sz: number; bold: boolean }> = {
  text: { sz: 10, bold: false }, 'text-r': { sz: 10, bold: false },
  'text12-r': { sz: 12, bold: false }, 'bold12-r': { sz: 12, bold: true },
  'bold12-r-wrap': { sz: 12, bold: true }, wrap12: { sz: 12, bold: false },
  mol: { sz: 8, bold: true }, num3: { sz: 12, bold: false }, kgv: { sz: 8, bold: true },
  wrap10: { sz: 10, bold: false }, bold10: { sz: 10, bold: true },
};

const ruFixed = (n: number, dec: number): string =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Видимые символы ячейки (для rich/многострочных — самая длинная строка). */
function cellChars(v: XlsxValue, styleName: string): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') {
    const dec = styleName === 'num3' ? 3 : styleName === 'kgv' ? 2 : 0;
    return ruFixed(v, dec).length;
  }
  const text = typeof v === 'object' ? v.rich.map((r) => r.t).join('') : String(v);
  let max = 0;
  for (const line of text.split('\n')) max = Math.max(max, line.length);
  return max;
}

function autoWidth(col: FlowXlsxColumn, values: XlsxValue[], headText: string): number {
  const styleName = styleNameOf(col);
  if (KEEP_WRAP.has(styleName)) return col.width;
  const f = STYLE_FONT[styleName] ?? { sz: 10, bold: false };
  const factor = (f.sz / 10) * (f.bold ? 1.06 : 1);
  let chars = 0;
  for (const v of values) chars = Math.max(chars, cellChars(v, styleName));
  const dataW = chars * factor + 1.8;
  const headW = headText.length * 1.1 * 1.06 + 2.5; // шапка 11 bold + стрелка автофильтра
  return Math.min(Math.round(Math.max(dataW, headW, 5) * 10) / 10, 60);
}

/** Сжать 1-based номера строк в sqref одной колонки: «K2:K5 K8 K11:K12». */
function sqrefOf(colL: string, rowNums: number[]): string {
  const sorted = [...rowNums].sort((a, b) => a - b);
  const parts: string[] = [];
  let s = sorted[0] ?? 0;
  let e = s;
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n != null && n === e + 1) { e = n; continue; }
    if (s > 0) parts.push(s === e ? `${colL}${s}` : `${colL}${s}:${colL}${e}`);
    if (n != null) { s = n; e = n; }
  }
  return parts.join(' ');
}

/**
 * Собрать книгу: «План»/«Доп. N» + «Места хранения» (+ скрытые «Списки» выпадашек).
 * batch: 1=план, 2+=доп, 'all'=весь день. Раскладка серверная (layout, null → дефолт).
 * Сортировка APLAN здесь же. lists — живые МОЛы/экспедиторы для выпадашек.
 */
export function buildPlanXlsxSheets(
  dateIso: string,
  batch: number | 'all',
  rowsIn: PlanXlsxRow[],
  layout?: FlowXlsxLayout | null,
  lists?: PlanXlsxLists,
): PlanXlsxBook {
  const lay = layout ?? FALLBACK_LAYOUT;
  const rows = [...rowsIn].sort(makePlanEtalonCompare(lay.special_fr));
  const sheetName = batch !== 'all' && batch >= 2 ? `Доп. ${batch - 1}` : 'План';

  // Лист 1: шапка строкой 1 (дата — в заголовке «Материала»), автофильтр, freeze,
  // разрыв страницы по смене склада-отправителя, страничный режим 100%.
  // Колонка П/П (dlv_pos) больше не нужна — позиция теперь в ячейке поставки.
  const planCols = lay.plan.columns.filter((c) => c.id !== 'dlv_pos');
  const matTpl = lay.plan.matHead && lay.plan.matHead.includes('{MONTH1}')
    ? lay.plan.matHead
    : MAT_HEAD_DEFAULT; // старый серверный шаблон «{DD} {MONTH} …» → новый формат
  const matHead = matHeadOf(matTpl, dateIso);
  const head = planCols.map((c) => (c.id === 'mat' ? matHead : c.head));
  const sheetRows: XlsxValue[][] = [head];
  const breaks: number[] = [];
  const notes: Array<{ row: number; col: number; text: string }> = [];
  const matIdx = planCols.findIndex((c) => c.id === 'mat');
  const molIdx = planCols.findIndex((c) => c.id === 'mol');
  const expIdx = planCols.findIndex((c) => c.id === 'exp');
  const molRowsByWh = new Map<string, number[]>(); // to_wh → 1-based строки листа
  let prevFr: string | null = null;
  for (const r of rows) {
    if (prevFr !== null && r.fr !== prevFr) breaks.push(sheetRows.length);
    prevFr = r.fr;
    sheetRows.push(planCols.map((c) => cellValue(r, c.id)));
    const rowNum = sheetRows.length; // 1-based на листе
    if (matIdx >= 0 && r.matNote.trim() && r.matNote.trim() !== r.mat.trim()) {
      notes.push({ row: rowNum - 1, col: matIdx, text: r.matNote.trim() });
    }
    if (molIdx >= 0) {
      const arr = molRowsByWh.get(r.to_wh);
      if (arr) arr.push(rowNum);
      else molRowsByWh.set(r.to_wh, [rowNum]);
    }
  }

  // Выпадашки: списки уходят на скрытый лист «Списки», ячейки ссылаются через
  // именованные диапазоны (инлайн-список Excel режет на 255 символах).
  const definedNames: XlsxDefinedName[] = [];
  const listCols: string[][] = [];
  const dropdowns: Array<{ sqref: string; listName: string }> = [];
  const addList = (name: string, header: string, items: string[]): void => {
    const ci = listCols.length;
    listCols.push([header, ...items]);
    const L = colLetter(ci);
    definedNames.push({ name, ref: `'Списки'!$${L}$2:$${L}$${items.length + 1}` });
  };
  if (lists && sheetRows.length > 1) {
    const exp = lists.expeditors.filter(Boolean);
    if (expIdx >= 0 && exp.length > 0) {
      addList('_LEXP', 'Экспедиторы', exp);
      dropdowns.push({ sqref: `${colLetter(expIdx)}2:${colLetter(expIdx)}${sheetRows.length}`, listName: '_LEXP' });
    }
    if (molIdx >= 0) {
      let n = 0;
      for (const [wh, rowNums] of molRowsByWh) {
        const mols = (lists.molsByWh.get(wh) ?? []).filter(Boolean);
        if (mols.length === 0) continue;
        n += 1;
        const name = `_LM${n}`;
        addList(name, `МОЛ ${wh}`, mols);
        dropdowns.push({ sqref: sqrefOf(colLetter(molIdx), rowNums), listName: name });
      }
    }
  }

  const plan: XlsxSheet = {
    name: sheetName,
    rows: sheetRows,
    colWidths: planCols.map((c, ci) => autoWidth(c, sheetRows.slice(1).map((r) => r[ci]), String(head[ci] ?? ''))),
    colStyles: planCols.map(styleOf),
    autoFilter: true,
    freezeTop: true,
    pageBreakView: true,
    rowBreaks: breaks,
    dropdowns,
    notes,
  };

  // Лист 2 «Места хранения»: только строки с местами; пустая строка между отправителями;
  // заголовок «Материала» — тот же, с датой плана (юзер 2026-07-03).
  const restCols = lay.rest.columns.filter((c) => c.id !== 'dlv_pos');
  const restHead = restCols.map((c) => (c.id === 'mat' ? matHead : c.head));
  const restRows: XlsxValue[][] = [restHead];
  const restNotes: Array<{ row: number; col: number; text: string }> = [];
  const restMatIdx = restCols.findIndex((c) => c.id === 'mat');
  let prevFr2: string | null = null;
  for (const r of rows) {
    if (!r.stockNote.trim()) continue; // пустые места хранения убираем
    if (prevFr2 !== null && r.fr !== prevFr2) restRows.push([]);
    prevFr2 = r.fr;
    restRows.push(restCols.map((c) => cellValue(r, c.id)));
    if (restMatIdx >= 0 && r.matNote.trim() && r.matNote.trim() !== r.mat.trim()) {
      restNotes.push({ row: restRows.length - 1, col: restMatIdx, text: r.matNote.trim() });
    }
  }
  const rest: XlsxSheet = {
    name: 'Места хранения',
    rows: restRows,
    colWidths: restCols.map((c, ci) => autoWidth(c, restRows.slice(1).map((r) => r[ci]), String(restHead[ci] ?? ''))),
    colStyles: restCols.map(styleOf),
    autoFilter: true,
    freezeTop: true,
    pageBreakView: true,
    notes: restNotes,
  };

  const sheets: XlsxSheet[] = [plan, rest];
  if (listCols.length > 0) {
    const depth = Math.max(...listCols.map((c) => c.length));
    const listRows: XlsxValue[][] = [];
    for (let ri = 0; ri < depth; ri++) listRows.push(listCols.map((c) => c[ri] ?? ''));
    sheets.push({ name: 'Списки', rows: listRows, colWidths: listCols.map(() => 34), hidden: true });
  }
  return { sheets, definedNames };
}
