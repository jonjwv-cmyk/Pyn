// ============================================================
// xlsx-lite.ts — минимальный генератор .xlsx БЕЗ зависимостей (юзер 2026-07-02/03).
// ============================================================
// Причина: exceljs ломал electron-typecheck через @types/node (проверено 2026-06-13),
// а юзеру нужен «эксель без макросов» как ЭТАЛОН экспедиции: Inter (шрифт юзера 2026-07-03, раньше Segoe UI), тонкие сетки,
// жирная шапка с заливкой и автофильтром, закреплённая первая строка, форматы чисел
// (#,##0.000), переносы текста, разрывы страниц. XLSX = zip из XML — собираем сами:
// ZIP без сжатия (stored, CRC32), строки inline (без sharedStrings).
//
// Дополнено 2026-07-03 (юзер): rich-текст в ячейке (поставка жирным, заказ обычным),
// показ сразу в СТРАНИЧНОМ режиме с зумом 100%, печать масштабом 100% (НЕ fitToPage —
// иначе Excel игнорирует ручные разрывы страниц), пустые ячейки СО стилем (сетка до
// последней колонки/строки), выпадающие списки (data validation по именованным
// диапазонам скрытого листа), примечания к ячейкам (comments + VML).
//
// Дополнено для файла «Экспедиторам»/кладовщикам (юзер 2026-07-03): заливка строк
// цветом машины (динамические клоны стилей с fill), объединённые ячейки (шапка машины),
// высота строки, стиль всей строки (mhead).
//
// Набор стилей ФИКСИРОВАННЫЙ (пресеты эталона, см. XLSX_STYLE):
//   0 text (Inter 10 left) · 1 header (Inter 11 bold, заливка) · 2 text-r · 3 text12-r ·
//   4 bold12-r · 5 bold12-r-wrap · 6 wrap12 · 7 mol (Inter 8 bold wrap) · 8 num3
//   (#,##0.000, 12) · 9 kgv (0.00, 8 bold) · 10 wrap10 · 11 bold10 · 12 mhead
//   (10 bold wrap, шапка машины) · 13 text8 · 14 num8 · 15 wrap8 (Inter 8 НЕжирный —
//   хвост плана после ID + Экспедитор, эталон 📦ТМЦ) · 16 wrap10-r (10 право+перенос —
//   гаражные в 2 строки, юзер 2026-07-05). + клоны с заливкой (по rowFills).

/** Прогон rich-текста: свой шрифт/жирность внутри одной ячейки. */
export interface XlsxRichRun {
  t: string;
  bold?: boolean;
  /** Размер шрифта прогона (Inter), по умолчанию 12. */
  sz?: number;
}
export type XlsxValue = string | number | null | undefined | { rich: XlsxRichRun[] };

/** Пресет оформления → styleId (серверный layout шлёт имя пресета). */
export const XLSX_STYLE: Record<string, number> = {
  text: 0,
  'text-r': 2,
  'text12-r': 3,
  'bold12-r': 4,
  'bold12-r-wrap': 5,
  wrap12: 6,
  mol: 7,
  num3: 8,
  kgv: 9,
  wrap10: 10,
  bold10: 11,
  mhead: 12,
  text8: 13,
  num8: 14,
  wrap8: 15,
  'wrap10-r': 16,
};

export interface XlsxSheet {
  name: string;
  /** Строки листа: строка/число/rich/пусто. Строка 1 — шапка (стиль header). */
  rows: XlsxValue[][];
  /** Ширины колонок (символы Excel). */
  colWidths?: number[];
  /** styleId данных per-колонке (XLSX_STYLE); нет — 0. */
  colStyles?: number[];
  /** Индексы строк (1-based), ПОСЛЕ которых разрыв страницы. */
  rowBreaks?: number[];
  /** Автофильтр по шапке (строка 1) до последней строки/колонки. */
  autoFilter?: boolean;
  /** Закрепить первую строку. */
  freezeTop?: boolean;
  landscape?: boolean;
  /** Открывать лист сразу в СТРАНИЧНОМ режиме (Page Break Preview), зум 100%. */
  pageBreakView?: boolean;
  /** Область печати (ref «A1:U220») — определяет ПРАВУЮ границу листа: вертикальная
   *  пунктирная разбивка идёт по концу области (после последней печатной колонки). */
  printArea?: string;
  /** ФИКСИРОВАННЫЙ масштаб печати % (не fitToPage — ручные разрывы строк живут). */
  printScale?: number;
  /** Скрытый лист (перечни для выпадашек). */
  hidden?: boolean;
  /** Выпадающие списки: ячейки sqref («K2:K9 K14») → имя именованного диапазона. */
  dropdowns?: Array<{ sqref: string; listName: string }>;
  /** Примечания к ячейкам (row/col — 0-based индексы в rows). */
  notes?: Array<{ row: number; col: number; text: string }>;
  /** Заливка строк (1-based строка → ARGB «FFRRGGBB») — цвет машины кладовщикам. */
  rowFills?: Record<number, string>;
  /** Своя высота строк (1-based строка → пункты) — шапки машин. */
  rowHeights?: Record<number, number>;
  /** Стиль ВСЕХ ячеек строки (1-based строка → styleId) — напр. mhead шапки машины. */
  rowStyles?: Record<number, number>;
  /** Объединённые диапазоны («A5:L5») — шапки машин. */
  merges?: string[];
  /** Строки (1-based) с ЗАМЕТНОЙ верхней границей — разделители групп складов
   *  в файле «Экспедиторам» (юзер 2026-07-04). */
  rowTopBorders?: number[];
}

/** Именованный диапазон книги (для выпадашек): ref вида «'Списки'!$A$2:$A$9». */
export interface XlsxDefinedName { name: string; ref: string }
export interface XlsxBookOpts { definedNames?: XlsxDefinedName[] }

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── ZIP (stored) ─────────────────────────────────────────────────────────────
interface ZipEntry { name: string; data: Uint8Array }
function makeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const num2 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
  const num4 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, ...num2(20), ...num2(0x0800), ...num2(0), ...num2(0), ...num2(0),
      ...num4(crc), ...num4(e.data.length), ...num4(e.data.length), ...num2(nameB.length), ...num2(0),
    ]);
    chunks.push(local, nameB, e.data);
    central.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, ...num2(20), ...num2(20), ...num2(0x0800), ...num2(0), ...num2(0), ...num2(0),
      ...num4(crc), ...num4(e.data.length), ...num4(e.data.length), ...num2(nameB.length), ...num2(0), ...num2(0),
      ...num2(0), ...num2(0), ...num4(0), ...num4(offset),
    ]), nameB);
    offset += local.length + nameB.length + e.data.length;
  }
  const centralStart = offset;
  let centralLen = 0;
  for (const c of central) centralLen += c.length;
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, ...num2(0), ...num2(0), ...num2(entries.length), ...num2(entries.length),
    ...num4(centralLen), ...num4(centralStart), ...num2(0),
  ]);
  const out = new Uint8Array(offset + centralLen + end.length);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}

// ── XLSX XML ─────────────────────────────────────────────────────────────────
const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const isRich = (v: XlsxValue): v is { rich: XlsxRichRun[] } =>
  typeof v === 'object' && v !== null && Array.isArray((v as { rich?: unknown }).rich);
const isEmpty = (v: XlsxValue): boolean =>
  v == null || v === '' || (isRich(v) && v.rich.every((r) => !r.t));

const RUN_FONT = (sz: number, bold: boolean): string =>
  `${bold ? '<b/>' : ''}<sz val="${sz}"/><color rgb="FF111827"/><rFont val="Inter"/><family val="2"/><charset val="204"/>`;

/** styleId ячейки с учётом стиля строки, заливки машины и верхней границы-разделителя
 *  (клоны считает makeXlsx). */
type StyleResolver = (base: number, fill: string, topBorder: boolean) => number;

function sheetXml(sheet: XlsxSheet, styleOf: StyleResolver): string {
  const topSet = new Set(sheet.rowTopBorders ?? []);
  const styles = sheet.colStyles ?? [];
  const colsCount = Math.max(
    sheet.colWidths?.length ?? 0,
    sheet.colStyles?.length ?? 0,
    ...sheet.rows.map((r) => r.length),
    1,
  );
  const cols = (sheet.colWidths ?? [])
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const rowsXml = sheet.rows
    .map((row, ri) => {
      const r = ri + 1;
      const isHeader = r === 1;
      // Пустые ячейки — СО стилем (границы сетки до последней колонки/строки, юзер
      // 2026-07-03); полностью пустая строка (разделитель) остаётся голой.
      if (row.every(isEmpty)) return `<row r="${r}"/>`;
      const fill = isHeader ? '' : sheet.rowFills?.[r] ?? '';
      const rowStyle = isHeader ? undefined : sheet.rowStyles?.[r];
      const topBorder = !isHeader && topSet.has(r);
      const ht = sheet.rowHeights?.[r];
      const cells: string[] = [];
      for (let ci = 0; ci < colsCount; ci++) {
        const v = row[ci];
        const ref = `${colLetter(ci)}${r}`;
        const s = isHeader ? 1 : styleOf(rowStyle ?? styles[ci] ?? 0, fill, topBorder);
        if (isEmpty(v)) {
          cells.push(`<c r="${ref}" s="${s}"/>`);
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          cells.push(`<c r="${ref}" s="${s}"><v>${v}</v></c>`);
        } else if (isRich(v)) {
          const runs = v.rich
            .filter((run) => run.t)
            .map((run) => `<r><rPr>${RUN_FONT(run.sz ?? 12, !!run.bold)}</rPr><t xml:space="preserve">${xmlEsc(run.t)}</t></r>`)
            .join('');
          cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is>${runs}</is></c>`);
        } else {
          cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`);
        }
      }
      const htAttr = isHeader ? ' ht="19" customHeight="1"' : ht ? ` ht="${ht}" customHeight="1"` : '';
      return `<row r="${r}"${htAttr}>${cells.join('')}</row>`;
    })
    .join('');
  const lastRef = `${colLetter(colsCount - 1)}${sheet.rows.length}`;
  // Страничный режим (Page Break Preview) + зум 100% сразу при открытии (юзер 2026-07-03).
  const viewAttrs = sheet.pageBreakView
    ? ' view="pageBreakPreview" zoomScale="100" zoomScaleNormal="100" zoomScaleSheetLayoutView="100"'
    : '';
  const pane = sheet.freezeTop
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    : '';
  const views = viewAttrs || pane
    ? `<sheetViews><sheetView workbookViewId="0"${viewAttrs}>${pane}</sheetView></sheetViews>`
    : '';
  const filter = sheet.autoFilter ? `<autoFilter ref="A1:${lastRef}"/>` : '';
  const merges = (sheet.merges ?? []).length
    ? `<mergeCells count="${sheet.merges?.length}">${sheet.merges?.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const dds = sheet.dropdowns ?? [];
  const validations = dds.length
    ? `<dataValidations count="${dds.length}">${dds
        .map((d) => `<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="0" sqref="${d.sqref}"><formula1>${xmlEsc(d.listName)}</formula1></dataValidation>`)
        .join('')}</dataValidations>`
    : '';
  const breaks = (sheet.rowBreaks ?? []).length
    ? `<rowBreaks count="${sheet.rowBreaks?.length}" manualBreakCount="${sheet.rowBreaks?.length}">${sheet.rowBreaks
        ?.map((b) => `<brk id="${b}" max="16383" man="1"/>`)
        .join('')}</rowBreaks>`
    : '';
  // Печать масштабом 100% БЕЗ fitToPage: с «вписать в страницу» Excel игнорирует
  // ручные разрывы страниц (юзер 2026-07-03: «где разрывы?» — вот где они были).
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    views +
    `<sheetFormatPr defaultRowHeight="17.25"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rowsXml}</sheetData>` +
    filter +
    merges +
    validations +
    // Узкие поля как в эталоне (0.197"); ФИКСИРОВАННЫЙ масштаб (не fitToPage — иначе
    // Excel игнорирует ручные разрывы строк по отправителю). Вертикальная разбивка
    // идёт по правой границе области печати (printArea) — т.е. после последней колонки.
    `<pageMargins left="0.2" right="0.2" top="0.2" bottom="0.2" header="0" footer="0"/>` +
    `<pageSetup paperSize="9" scale="${Math.round(sheet.printScale ?? 100)}" fitToHeight="0" orientation="${sheet.landscape === false ? 'portrait' : 'landscape'}"/>` +
    breaks +
    ((sheet.notes ?? []).length ? `<legacyDrawing r:id="rId2"/>` : '') +
    `</worksheet>`
  );
}

// ── Примечания (comments + VML: классические «заметки» Excel) ────────────────
function commentsXml(sheet: XlsxSheet): string {
  const items = (sheet.notes ?? [])
    .map((n) => {
      const ref = `${colLetter(n.col)}${n.row + 1}`;
      return `<comment ref="${ref}" authorId="0"><text><r><rPr><sz val="9"/><color rgb="FF111827"/><rFont val="Inter"/><family val="2"/><charset val="204"/></rPr><t xml:space="preserve">${xmlEsc(n.text)}</t></r></text></comment>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<authors><author></author></authors><commentList>${items}</commentList></comments>`
  );
}

function vmlXml(sheet: XlsxSheet): string {
  const shapes = (sheet.notes ?? [])
    .map((n, k) => {
      const anchor = `${n.col + 1},15,${Math.max(0, n.row - 1)},10,${n.col + 4},15,${n.row + 4},4`;
      return (
        `<v:shape id="_x0000_s${1025 + k}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:2pt;width:260pt;height:52pt;z-index:${k + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
        `<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>` +
        `<v:textbox style="mso-direction-alt:auto"/>` +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${anchor}</x:Anchor>` +
        `<x:AutoFill>False</x:AutoFill><x:Row>${n.row}</x:Row><x:Column>${n.col}</x:Column></x:ClientData>` +
        `</v:shape>`
      );
    })
    .join('');
  return (
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>` +
    `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">` +
    `<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>` +
    shapes +
    `</xml>`
  );
}

// Шрифты эталона (Inter): 0=10, 1=11 bold (шапка), 2=12, 3=12 bold, 4=8 bold, 5=10 bold, 6=8.
const FONT = (sz: number, bold: boolean): string =>
  `<font>${bold ? '<b/>' : ''}<sz val="${sz}"/><color rgb="FF111827"/><name val="Inter"/><family val="2"/><charset val="204"/></font>`;

// Базовые пресеты xf: numFmt / шрифт / выравнивание / перенос / заливка (id → XLSX_STYLE).
const BASE_XFS: Array<{ nf: number; f: number; h: 'left' | 'right'; wrap: boolean; fill?: number }> = [
  { nf: 0, f: 0, h: 'left', wrap: false },          // 0 text
  { nf: 0, f: 1, h: 'left', wrap: false, fill: 2 }, // 1 header (заливка)
  { nf: 0, f: 0, h: 'right', wrap: false },         // 2 text-r
  { nf: 0, f: 2, h: 'right', wrap: false },         // 3 text12-r
  { nf: 49, f: 3, h: 'right', wrap: false },        // 4 bold12-r (текст-формат: «0103» не теряет ноль)
  { nf: 49, f: 3, h: 'right', wrap: true },         // 5 bold12-r-wrap (поставка+заказ 2 строки)
  { nf: 0, f: 2, h: 'left', wrap: true },           // 6 wrap12 (наименование)
  { nf: 0, f: 4, h: 'left', wrap: true },           // 7 mol (8 bold wrap)
  { nf: 164, f: 2, h: 'right', wrap: false },       // 8 num3 (#,##0.000)
  { nf: 4, f: 4, h: 'right', wrap: false },         // 9 kgv (#,##0.00, 8 bold)
  { nf: 0, f: 0, h: 'left', wrap: true },           // 10 wrap10
  { nf: 0, f: 5, h: 'left', wrap: false },          // 11 bold10
  { nf: 0, f: 5, h: 'left', wrap: true },           // 12 mhead (шапка машины: 10 bold wrap)
  { nf: 0, f: 6, h: 'left', wrap: false },          // 13 text8 (хвост плана после ID)
  { nf: 164, f: 6, h: 'right', wrap: false },       // 14 num8 (остатки хвоста, 3 знака — юзер 2026-07-04)
  { nf: 0, f: 6, h: 'left', wrap: true },           // 15 wrap8 (Экспедитор / поставка+заказ хвоста)
  { nf: 49, f: 0, h: 'right', wrap: true },         // 16 wrap10-r (гаражные №№ по строкам)
];

/** Клоны базовых стилей: заливка строки (цвет машины/ручная) и/или верхняя граница-
 *  разделитель — '<base>|<argb>|<top>' → новый styleId. */
function stylesXml(clones: Array<{ base: number; argb: string; top: boolean }>): string {
  const fonts = [FONT(10, false), FONT(11, true), FONT(12, false), FONT(12, true), FONT(8, true), FONT(10, true), FONT(8, false)];
  const xf = (p: { nf: number; f: number; h: 'left' | 'right'; wrap: boolean; fill?: number; border?: number }): string =>
    `<xf numFmtId="${p.nf}" fontId="${p.f}" fillId="${p.fill ?? 0}" borderId="${p.border ?? 1}" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"${p.fill ? ' applyFill="1"' : ''} applyAlignment="1">` +
    `<alignment horizontal="${p.h}" vertical="center"${p.wrap ? ' wrapText="1"' : ''}/></xf>`;
  const argbs = [...new Set(clones.map((c) => c.argb).filter(Boolean))];
  const fillIdOf = new Map(argbs.map((a, i) => [a, 3 + i] as const));
  const extraFills = argbs
    .map((a) => `<fill><patternFill patternType="solid"><fgColor rgb="${a}"/><bgColor indexed="64"/></patternFill></fill>`)
    .join('');
  const cellXfs = [
    ...BASE_XFS.map(xf),
    ...clones.map((c) => xf({
      ...(BASE_XFS[c.base] ?? BASE_XFS[0]!),
      fill: c.argb ? fillIdOf.get(c.argb) ?? 0 : 0,
      border: c.top ? 2 : 1,
    })),
  ].join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${3 + argbs.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>${extraFills}</fills>` +
    // border 2 — разделитель групп складов: заметная (medium) верхняя граница.
    `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>` +
    `<top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>` +
    `<top style="medium"><color rgb="FF8A8F98"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${BASE_XFS.length + clones.length}">${cellXfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/** Собрать .xlsx (без макросов) из листов. opts.definedNames — диапазоны выпадашек. */
export function makeXlsx(sheets: XlsxSheet[], opts?: XlsxBookOpts): Uint8Array {
  const enc = new TextEncoder();
  const withNotes = sheets.map((s, i) => ({ s, i })).filter(({ s }) => (s.notes ?? []).length > 0);
  // Клоны стилей под заливку строк (цвет машины/ручная) и верхние границы-разделители:
  // собираем реально используемые комбинации (базовый стиль × цвет × граница) по всем
  // листам → styleId выдаёт styleOf.
  const cloneId = new Map<string, number>();
  const clones: Array<{ base: number; argb: string; top: boolean }> = [];
  for (const s of sheets) {
    const tops = new Set(s.rowTopBorders ?? []);
    if (!s.rowFills && tops.size === 0) continue;
    const styles = s.colStyles ?? [];
    const colsCount = Math.max(s.colWidths?.length ?? 0, styles.length, ...s.rows.map((r) => r.length), 1);
    const rowNums = new Set<number>([
      ...Object.keys(s.rowFills ?? {}).map(Number),
      ...tops,
    ]);
    for (const rowNum of rowNums) {
      const argb = s.rowFills?.[rowNum] ?? '';
      const top = tops.has(rowNum);
      if (!argb && !top) continue;
      const rowStyle = s.rowStyles?.[rowNum];
      for (let ci = 0; ci < colsCount; ci++) {
        const base = rowStyle ?? styles[ci] ?? 0;
        const key = `${base}|${argb}|${top ? 1 : 0}`;
        if (!cloneId.has(key)) {
          cloneId.set(key, BASE_XFS.length + clones.length);
          clones.push({ base, argb, top });
        }
      }
    }
  }
  const styleOf: StyleResolver = (base, fill, top) =>
    (fill || top ? cloneId.get(`${base}|${fill}|${top ? 1 : 0}`) ?? base : base);
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (withNotes.length ? `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>` : '') +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    withNotes.map(({ i }) => `<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`).join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  // Область печати листа = локальное имя _xlnm.Print_Area (localSheetId); вместе с
  // выпадашками-диапазонами идёт в один <definedNames>.
  const printAreas = sheets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !!s.printArea)
    .map(({ s, i }) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${s.name.replace(/'/g, "''")}'!${s.printArea}</definedName>`)
    .join('');
  const bookNames = (opts?.definedNames ?? [])
    .map((d) => `<definedName name="${xmlEsc(d.name)}">${xmlEsc(d.ref)}</definedName>`)
    .join('');
  const definedNames = printAreas || bookNames ? `<definedNames>${printAreas}${bookNames}</definedNames>` : '';
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    definedNames +
    `</workbook>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(stylesXml(clones)) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, styleOf)) })),
  ];
  for (const { s, i } of withNotes) {
    const sheetRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${i + 1}.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${i + 1}.vml"/>` +
      `</Relationships>`;
    entries.push(
      { name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: enc.encode(sheetRels) },
      { name: `xl/comments${i + 1}.xml`, data: enc.encode(commentsXml(s)) },
      { name: `xl/drawings/vmlDrawing${i + 1}.vml`, data: enc.encode(vmlXml(s)) },
    );
  }
  return makeZip(entries);
}

/** Скачать xlsx в браузере/Electron. */
export function downloadXlsx(filename: string, sheets: XlsxSheet[], opts?: XlsxBookOpts): void {
  const bytes = makeXlsx(sheets, opts);
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
