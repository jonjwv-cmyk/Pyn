// ============================================================
// flow-export-xlsx.ts — выгрузка Плана из ОТЧЁТА в .xlsx (юзер 2026-07-02/03/04).
// ============================================================
// По ЭТАЛОНУ «A. План экспедиции ….xlsm» (лист 📦ТМЦ). Ключевое (юзер 2026-07-04):
//  • ОБЛАСТЬ ПЕЧАТИ = A1:<ID> → вертикальная пунктирная разбивка идёт ПО ПРАВОЙ границе
//    после колонки ID (а не по центру); фиксированный масштаб печати (не fitToPage —
//    ручные разрывы строк по отправителю живут), узкие поля 0.2" как в эталоне;
//  • колонки ОСТАТКОВ (остаток СУС/ММ + места хранения) — ТУТ ЖЕ, ПОСЛЕ ID (вне области
//    печати); ВТОРОГО листа «Места хранения» больше НЕТ;
//  • колонка «Был» (pr) убрана;
//  • МОЛ-выпадашка — ЧИСТО ФИО (без сотового); у Экспедитора выпадашки НЕТ;
//  • «поставка | поз» ЖИРНЫМ 12, «заказ | поз» — МЕНЬШЕ (8, как КГ) той же ячейкой.
// Дата плана — в заголовке «Материала» («Июль 3, 26г. Материал»). CLST — только
// ВЫЕЗД/КХП. Примечание на материале — полное тех-наименование (база ВГХ). Раскладка
// печатных колонок — СЕРВЕРНАЯ (layout). Имена: «План экспедиции на июль 3 2026.xlsx» /
// «Доп. 1 к плану экспедиции на …»; один лист «План» / «Доп. N».

import type { FlowXlsxLayout, FlowXlsxColumn } from '@pyn/core';
import {
  XLSX_STYLE, colLetter,
  type XlsxSheet, type XlsxValue, type XlsxDefinedName,
} from '@/lib/xlsx-lite';
import {
  makePlanEtalonCompare, normalizeRusLat, planSortKeyFr, planSortKeyClst, planSortKeyTo,
  type PlanSortable,
} from './flow-plan-sort';

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
  stockNote: string; // «PLACE(qty); PLACE2(qty2)» — места хранения с остатком
  stockSus: number | null; // остаток СУС (Запас СУС из zm_vl)
  stockMm: number | null; // остаток ММ (Запас ММ из zm_vl)
  matNote: string; // полное тех-наименование (база ВГХ) → примечание на материале
  /** Заливка строки ARGB (цвет машины по гаражному — кладовщикам «с цветом»). */
  fillArgb?: string;
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
    // FIX первой, ГРАФ второй (юзер 2026-07-03), остальное как было.
    columns: [
      { id: 'fix', head: 'FIX', width: 8, style: 'text12-r' },
      { id: 'graph', head: 'ГРАФ', width: 8.5, style: 'text12-r' },
      { id: 'request', head: 'Запросил', width: 13.5, style: 'text' },
      { id: 'fr', head: 'От', width: 7, style: 'bold12-r' },
      { id: 'to', head: 'СП', width: 6.5, style: 'bold12-r' },
      { id: 'clst', head: 'CLST', width: 8.5, style: 'text12-r' },
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

/** Разобрать stock_note «PLACE(qty); PLACE2(qty2)» → пары место/остаток (до 4). */
function parseStockPairs(s: string): Array<{ place: string; qty: number | null }> {
  if (!s.trim()) return [];
  const out: Array<{ place: string; qty: number | null }> = [];
  for (const part of s.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(.*?)[\s(：:]*\(?([\d.,\s]+)\)?\s*$/.exec(p);
    if (m && m[1]) out.push({ place: m[1].trim(), qty: zmNum(m[2] ?? '') });
    else out.push({ place: p, qty: null });
  }
  return out.slice(0, 4);
}

/** Колонки СЕКЦИИ ОСТАТКОВ (после ID, ВНЕ области печати — юзер 2026-07-04): остаток
 *  СУС/ММ + до 4 пар «Складское место»/«Остаток». Ширины — из эталона (лист 📦ТМЦ). */
const STOCK_SECTION: Array<{ head: string; width: number; style: string; get: (r: PlanXlsxRow) => XlsxValue }> = [
  { head: 'Остаток СУС', width: 13.7, style: 'num3', get: (r) => num(r.stockSus) },
  { head: 'Остаток ММ', width: 13.9, style: 'num3', get: (r) => num(r.stockMm) },
  ...[0, 1, 2, 3].flatMap((i) => [
    { head: i === 0 ? 'Складское место' : `Складское место${i}`, width: i === 0 ? 16.6 : 17.9, style: 'text',
      get: (r: PlanXlsxRow) => parseStockPairs(r.stockNote)[i]?.place ?? '' },
    { head: i === 0 ? 'Мест хран' : `Запас СМ${i}`, width: 14.2, style: 'num3',
      get: (r: PlanXlsxRow) => num(parseStockPairs(r.stockNote)[i]?.qty ?? null) },
  ]),
];

/** Поставка+заказ одной ячейкой: «поставка | поз» ЖИРНЫМ 12, ниже «заказ | поз»
 *  МЕНЬШЕ (8, как КГ — юзер 2026-07-04): поставка крупно, заказ компактно. */
function dlvOrdCell(r: PlanXlsxRow): XlsxValue {
  const line1 = [r.dlv, r.dlv_pos].filter(Boolean).join(' | ');
  const line2 = [r.ord, r.ord_pos].filter(Boolean).join(' | ');
  if (!line1 && !line2) return '';
  if (line1 && line2) return { rich: [{ t: line1, bold: true, sz: 12 }, { t: `\n${line2}`, sz: 8 }] };
  if (line1) return { rich: [{ t: line1, bold: true, sz: 12 }] };
  return { rich: [{ t: line2, sz: 8 }] };
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

/** Фикс-масштаб печати, чтобы печатные колонки (сумма ширин) влезли в ЛАНДШАФТ A4 по
 *  ширине (одна страница), не трогая ручные разрывы строк. Ширина Excel-юнита ≈ 7px;
 *  useful ≈ 11.29" при полях 0.2" → ~1084px @96dpi. Не увеличиваем (cap 100), пол 40. */
function fitPrintScale(widths: number[]): number {
  const totalPx = widths.reduce((s, w) => s + w * 7 + 5, 0);
  if (totalPx <= 0) return 100;
  const usablePx = 1084;
  return Math.max(40, Math.min(100, Math.floor((usablePx / totalPx) * 100)));
}

/**
 * Собрать книгу: ОДИН лист «План»/«Доп. N» (печатные колонки A:ID + секция остатков
 * после ID вне области печати) + скрытый лист «Списки» для выпадашек МОЛ. batch:
 * 1=план, 2+=доп, 'all'=весь день. Раскладка печатных колонок серверная (layout).
 * lists — живые МОЛы склада (ЧИСТО ФИО, без сотового); у экспедитора выпадашки НЕТ.
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

  // Печатные колонки (без П/П и без «Был»); за ними — секция ОСТАТКОВ (вне печати).
  const planCols = lay.plan.columns.filter((c) => c.id !== 'dlv_pos' && c.id !== 'pr');
  const matTpl = lay.plan.matHead && lay.plan.matHead.includes('{MONTH1}')
    ? lay.plan.matHead
    : MAT_HEAD_DEFAULT;
  const matHead = matHeadOf(matTpl, dateIso);
  const head = [
    ...planCols.map((c) => (c.id === 'mat' ? matHead : c.head)),
    ...STOCK_SECTION.map((c) => c.head),
  ];
  const sheetRows: XlsxValue[][] = [head];
  const breaks: number[] = [];
  const notes: Array<{ row: number; col: number; text: string }> = [];
  const rowFills: Record<number, string> = {};
  const matIdx = planCols.findIndex((c) => c.id === 'mat');
  const molIdx = planCols.findIndex((c) => c.id === 'mol');
  const molRowsByWh = new Map<string, number[]>();
  let prevFr: string | null = null;
  for (const r of rows) {
    if (prevFr !== null && r.fr !== prevFr) breaks.push(sheetRows.length);
    prevFr = r.fr;
    sheetRows.push([...planCols.map((c) => cellValue(r, c.id)), ...STOCK_SECTION.map((c) => c.get(r))]);
    const rowNum = sheetRows.length; // 1-based
    if (r.fillArgb) rowFills[rowNum] = r.fillArgb;
    if (matIdx >= 0 && r.matNote.trim() && r.matNote.trim() !== r.mat.trim()) {
      notes.push({ row: rowNum - 1, col: matIdx, text: r.matNote.trim() });
    }
    if (molIdx >= 0) {
      const arr = molRowsByWh.get(r.to_wh);
      if (arr) arr.push(rowNum);
      else molRowsByWh.set(r.to_wh, [rowNum]);
    }
  }

  // Выпадашки: ТОЛЬКО МОЛ склада (чисто ФИО — список готовит компонент). Экспедитор —
  // без выпадашки (юзер 2026-07-04). Диапазоны на скрытом листе «Списки».
  const definedNames: XlsxDefinedName[] = [];
  const listCols: string[][] = [];
  const dropdowns: Array<{ sqref: string; listName: string }> = [];
  if (lists && molIdx >= 0 && sheetRows.length > 1) {
    let n = 0;
    for (const [wh, rowNums] of molRowsByWh) {
      const mols = (lists.molsByWh.get(wh) ?? []).filter(Boolean);
      if (mols.length === 0) continue;
      n += 1;
      const name = `_LM${n}`;
      const ci = listCols.length;
      listCols.push([`МОЛ ${wh}`, ...mols]);
      const L = colLetter(ci);
      definedNames.push({ name, ref: `'Списки'!$${L}$2:$${L}$${mols.length + 1}` });
      dropdowns.push({ sqref: sqrefOf(colLetter(molIdx), rowNums), listName: name });
    }
  }

  // Ширины: печатные — автоподгонка, секция остатков — фикс из эталона. Область печати
  // = A1:<последняя ПЕЧАТНАЯ колонка> → вертикальная разбивка ПОСЛЕ ID. Масштаб фиксируем
  // под ширину печатных колонок (ручные разрывы по отправителю живут — не fitToPage).
  const planWidths = planCols.map((c, ci) =>
    autoWidth(c, sheetRows.slice(1).map((r) => r[ci]), String(head[ci] ?? '')));
  const colWidths = [...planWidths, ...STOCK_SECTION.map((c) => c.width)];
  const lastPrintCol = colLetter(planCols.length - 1);
  const plan: XlsxSheet = {
    name: sheetName,
    rows: sheetRows,
    colWidths,
    colStyles: [...planCols.map(styleOf), ...STOCK_SECTION.map((c) => XLSX_STYLE[c.style] ?? 0)],
    autoFilter: true,
    freezeTop: true,
    pageBreakView: true,
    rowBreaks: breaks,
    dropdowns,
    notes,
    rowFills,
    printArea: `$A$1:$${lastPrintCol}$${sheetRows.length}`,
    printScale: fitPrintScale(planWidths),
  };

  const sheets: XlsxSheet[] = [plan];
  if (listCols.length > 0) {
    const depth = Math.max(...listCols.map((c) => c.length));
    const listRows: XlsxValue[][] = [];
    for (let ri = 0; ri < depth; ri++) listRows.push(listCols.map((c) => c[ri] ?? ''));
    sheets.push({ name: 'Списки', rows: listRows, colWidths: listCols.map(() => 34), hidden: true });
  }
  return { sheets, definedNames };
}

// ============================================================
// Файл «ЭКСПЕДИТОРАМ» (юзер 2026-07-03, по наработке макроса CPRINT из эталона).
// ============================================================
// Отчёт дня, раскиданный по МАШИНАМ (гаражный): перед каждой машиной строка-шапка
// «гр. № 7.1   ПУЛЬМАН 9М   Иванов И.» + «От: …» + «СП: …» (merged, тон машины),
// разрыв страницы между машинами. Внутри машины сортировка НЕ по поставке, а
// От → CLST → СП → МОЛ → МАТЕРИАЛ. СХЛОПЫВАНИЕ: одинаковые получатель+отправитель+
// материал (+ ЕИ) при ТОМ ЖЕ МОЛе и НЕотличающихся комментах — одна строка, сумма
// кол-ва/КГ/V, поставки списком. Выполненные (зелёные) строки сюда не попадают
// (фильтрует вызывающий). Колонки: От СП CLST Поставка МОЛ Ном№ Материал ЕИ Кол-во КГ V Комментарий.

/** Строка для файла экспедиторам (компонент собирает из строк отчёта). */
export interface ExpedXlsxRow extends PlanSortable {
  garage: string; // гаражный № (группа-машина); '' — машина не выбрана
  vehicleType: string;
  expeditors: string;
  mol: string;
  uom: string;
  kg: number | null;
  v: number | null;
  note: string;
  matNote: string;
  fillArgb: string; // тон машины (шапка группы)
}

export function expedXlsxFilename(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  const dateRu = m
    ? `${MONTHS_NOM[parseInt(m[2] ?? '1', 10) - 1] ?? ''} ${parseInt(m[3] ?? '1', 10)} ${m[1]}`
    : dateIso;
  return `Экспедиторам на ${dateRu}.xlsx`;
}

/** ЕИ-канон для ключа схлопывания (PRN_EICanon эталона): ШТ/КГ/Т/Л без точек и пробелов. */
function uomCanon(raw: string): string {
  let t = raw.toUpperCase().replace(/[\s., ]/g, '');
  t = normalizeRusLat(t);
  if (t.startsWith('ШТ')) return 'ШТ';
  if (t.startsWith('КГ')) return 'КГ';
  if (t.startsWith('Т')) return 'Т';
  if (t.startsWith('Л')) return 'Л';
  return t;
}

const EXPED_COLS: FlowXlsxColumn[] = [
  { id: 'fr', head: 'От', width: 7, style: 'bold12-r' },
  { id: 'to', head: 'СП', width: 6.5, style: 'bold12-r' },
  { id: 'clst', head: 'CLST', width: 8.5, style: 'text12-r' },
  { id: 'dlv', head: 'Поставка', width: 13.2, style: 'bold12-r-wrap' },
  { id: 'mol', head: 'МОЛ', width: 23.2, style: 'mol' },
  { id: 'no_num', head: 'Ном №', width: 11.6, style: 'text12-r' },
  { id: 'mat', head: 'Материал', width: 50.7, style: 'wrap12' },
  { id: 'uom', head: 'ЕИ', width: 6.5, style: 'text' },
  { id: 'qty', head: 'Кол-во', width: 12.6, style: 'num3' },
  { id: 'kg', head: 'КГ', width: 7, style: 'kgv' },
  { id: 'v', head: 'V', width: 5, style: 'kgv' },
  { id: 'note', head: 'Комментарий', width: 21.6, style: 'mol' },
];

/** Собрать книгу «Экспедиторам»: группы-машины, схлопывание, разрывы по машине. */
export function buildExpedXlsxBook(
  dateIso: string,
  rowsIn: ExpedXlsxRow[],
  layout?: FlowXlsxLayout | null,
): PlanXlsxBook {
  const lay = layout ?? FALLBACK_LAYOUT;
  const matHead = matHeadOf(
    lay.plan.matHead && lay.plan.matHead.includes('{MONTH1}') ? lay.plan.matHead : MAT_HEAD_DEFAULT,
    dateIso,
  );

  // 1) Группы по машине (гаражный №, натуральный порядок; «без машины» — в конец).
  const byGarage = new Map<string, ExpedXlsxRow[]>();
  for (const r of rowsIn) {
    const g = r.garage.trim();
    const arr = byGarage.get(g);
    if (arr) arr.push(r);
    else byGarage.set(g, [r]);
  }
  const garages = [...byGarage.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, 'ru', { numeric: true });
  });

  // 2) Внутри машины: СХЛОПЫВАНИЕ (От|СП|МОЛ|Ном№|ЕИ|Материал|Коммент → Σ кол-ва/КГ/V,
  //    поставки уникальным списком), затем сортировка От → CLST → СП → МОЛ → материал.
  interface Grp { r: ExpedXlsxRow; qty: number | null; kg: number | null; v: number | null; dlvs: string[] }
  const cmp = (a: Grp, b: Grp): number =>
    planSortKeyFr(a.r.fr).localeCompare(planSortKeyFr(b.r.fr), 'ru') ||
    planSortKeyClst(a.r.clst).localeCompare(planSortKeyClst(b.r.clst), 'ru') ||
    planSortKeyTo(a.r.to_wh).localeCompare(planSortKeyTo(b.r.to_wh), 'ru') ||
    (a.r.mol ? 0 : 1) - (b.r.mol ? 0 : 1) || // пустой МОЛ — в конец
    a.r.mol.localeCompare(b.r.mol, 'ru') ||
    a.r.mat.localeCompare(b.r.mat, 'ru') ||
    (Number(a.qty ?? 0) - Number(b.qty ?? 0));

  const head = EXPED_COLS.map((c) => (c.id === 'mat' ? matHead : c.head));
  const sheetRows: XlsxValue[][] = [head];
  const merges: string[] = [];
  const breaks: number[] = [];
  const rowStyles: Record<number, number> = {};
  const rowHeights: Record<number, number> = {};
  const rowFills: Record<number, string> = {};
  const notes: Array<{ row: number; col: number; text: string }> = [];
  const matIdx = EXPED_COLS.findIndex((c) => c.id === 'mat');
  const lastCol = colLetter(EXPED_COLS.length - 1);

  for (const g of garages) {
    const src = byGarage.get(g) ?? [];
    const grouped = new Map<string, Grp>();
    for (const r of src) {
      const key = [r.fr, r.to_wh, r.mol ? '0' : '1', r.mol, r.no_num, uomCanon(r.uom), r.mat, r.note.trim()]
        .map((s) => String(s).trim().toUpperCase())
        .join('|');
      const dlvLine = [r.dlv, r.dlv_pos].filter(Boolean).join(' | ');
      const cur = grouped.get(key);
      if (!cur) {
        grouped.set(key, {
          r,
          qty: r.qty,
          kg: r.kg,
          v: r.v,
          dlvs: dlvLine ? [dlvLine] : [],
        });
      } else {
        cur.qty = (cur.qty ?? 0) + (r.qty ?? 0);
        cur.kg = cur.kg != null || r.kg != null ? (cur.kg ?? 0) + (r.kg ?? 0) : null;
        cur.v = cur.v != null || r.v != null ? (cur.v ?? 0) + (r.v ?? 0) : null;
        if (dlvLine && !cur.dlvs.includes(dlvLine)) cur.dlvs.push(dlvLine);
      }
    }
    const items = [...grouped.values()].sort(cmp);
    if (items.length === 0) continue;

    // Шапка машины: «гр. № …  машина  экспедиторы» + уникальные От/СП группы.
    const first = items[0]?.r;
    const uniq = (vals: string[]): string => [...new Set(vals.filter(Boolean))].join(' | ');
    const line1 = g
      ? ['гр. №', g, first?.vehicleType || '', first?.expeditors || ''].filter(Boolean).join('   ')
      : 'Без машины';
    const headText = `${line1}\nОт: ${uniq(items.map((x) => x.r.fr))}\nСП: ${uniq(items.map((x) => x.r.to_wh))}`;
    if (sheetRows.length > 1) breaks.push(sheetRows.length); // разрыв ПЕРЕД шапкой машины
    sheetRows.push([headText]);
    const hr = sheetRows.length; // 1-based
    merges.push(`A${hr}:${lastCol}${hr}`);
    rowStyles[hr] = XLSX_STYLE.mhead ?? 12;
    rowHeights[hr] = 45;
    if (g && first?.fillArgb) rowFills[hr] = first.fillArgb;

    for (const it of items) {
      const r = it.r;
      sheetRows.push([
        r.fr,
        r.to_wh,
        r.clst,
        it.dlvs.join('\n'),
        r.mol,
        r.no_num,
        r.mat,
        r.uom,
        num(it.qty),
        it.kg != null && it.kg !== 0 ? num(it.kg) : '',
        it.v != null && it.v !== 0 ? num(it.v) : '',
        r.note,
      ]);
      if (matIdx >= 0 && r.matNote.trim() && r.matNote.trim() !== r.mat.trim()) {
        notes.push({ row: sheetRows.length - 1, col: matIdx, text: r.matNote.trim() });
      }
    }
  }

  const dataRows = sheetRows.filter((_, i) => i > 0 && rowStyles[i + 1] == null);
  const sheet: XlsxSheet = {
    name: 'Экспедиторам',
    rows: sheetRows,
    colWidths: EXPED_COLS.map((c, ci) => autoWidth(c, dataRows.map((r) => r[ci]), String(head[ci] ?? ''))),
    colStyles: EXPED_COLS.map(styleOf),
    freezeTop: true,
    pageBreakView: true,
    rowBreaks: breaks,
    merges,
    rowStyles,
    rowHeights,
    rowFills,
    notes,
  };
  return { sheets: [sheet], definedNames: [] };
}
