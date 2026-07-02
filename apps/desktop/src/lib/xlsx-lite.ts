// ============================================================
// xlsx-lite.ts — минимальный генератор .xlsx БЕЗ зависимостей (юзер 2026-07-02/03).
// ============================================================
// Причина: exceljs ломал electron-typecheck через @types/node (проверено 2026-06-13),
// а юзеру нужен «эксель без макросов» как ЭТАЛОН экспедиции: Segoe UI, тонкие сетки,
// жирная шапка с заливкой и автофильтром, закреплённая первая строка, форматы чисел
// (#,##0.000), переносы текста, разрывы страниц. XLSX = zip из XML — собираем сами:
// ZIP без сжатия (stored, CRC32), строки inline (без sharedStrings).
//
// Набор стилей ФИКСИРОВАННЫЙ (пресеты эталона, см. XLSX_STYLE):
//   0 text (Segoe 10 left) · 1 header (Segoe 11 bold, заливка) · 2 text-r · 3 text12-r ·
//   4 bold12-r · 5 bold12-r-wrap · 6 wrap12 · 7 mol (Segoe 8 bold wrap) · 8 num3
//   (#,##0.000, 12) · 9 kgv (0.00, 8 bold) · 10 wrap10 · 11 bold10.

export type XlsxValue = string | number | null | undefined;

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
};

export interface XlsxSheet {
  name: string;
  /** Строки листа: строка/число/пусто. Строка 1 — шапка (стиль header). */
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
}

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

function colLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(sheet: XlsxSheet): string {
  const styles = sheet.colStyles ?? [];
  const cols = (sheet.colWidths ?? [])
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const maxCols = Math.max(...sheet.rows.map((r) => r.length), 1);
  const rowsXml = sheet.rows
    .map((row, ri) => {
      const r = ri + 1;
      const isHeader = r === 1;
      const cells = row
        .map((v, ci) => {
          if (v == null || v === '') return '';
          const ref = `${colLetter(ci)}${r}`;
          const s = isHeader ? 1 : styles[ci] ?? 0;
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}"${isHeader ? ' ht="19" customHeight="1"' : ''}>${cells}</row>`;
    })
    .join('');
  const lastRef = `${colLetter(maxCols - 1)}${sheet.rows.length}`;
  const freeze = sheet.freezeTop
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '';
  const filter = sheet.autoFilter ? `<autoFilter ref="A1:${lastRef}"/>` : '';
  const breaks = (sheet.rowBreaks ?? []).length
    ? `<rowBreaks count="${sheet.rowBreaks?.length}" manualBreakCount="${sheet.rowBreaks?.length}">${sheet.rowBreaks
        ?.map((b) => `<brk id="${b}" max="16383" man="1"/>`)
        .join('')}</rowBreaks>`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    freeze +
    `<sheetFormatPr defaultRowHeight="17.25"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rowsXml}</sheetData>` +
    filter +
    `<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.4" header="0.2" footer="0.2"/>` +
    `<pageSetup paperSize="9" orientation="${sheet.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    breaks +
    `</worksheet>`
  );
}

// Шрифты эталона (Segoe UI): 0=10, 1=11 bold (шапка), 2=12, 3=12 bold, 4=8 bold, 5=10 bold.
const FONT = (sz: number, bold: boolean): string =>
  `<font>${bold ? '<b/>' : ''}<sz val="${sz}"/><color rgb="FF111827"/><name val="Segoe UI"/><family val="2"/><charset val="204"/></font>`;

function stylesXml(): string {
  const fonts = [FONT(10, false), FONT(11, true), FONT(12, false), FONT(12, true), FONT(8, true), FONT(10, true)];
  // xf(numFmt, font, align, wrap)
  const xf = (nf: number, f: number, h: 'left' | 'right', wrap: boolean, fill = 0): string =>
    `<xf numFmtId="${nf}" fontId="${f}" fillId="${fill}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"${fill ? ' applyFill="1"' : ''} applyAlignment="1">` +
    `<alignment horizontal="${h}" vertical="center"${wrap ? ' wrapText="1"' : ''}/></xf>`;
  const cellXfs = [
    xf(0, 0, 'left', false),        // 0 text
    xf(0, 1, 'left', false, 2),     // 1 header (заливка)
    xf(0, 0, 'right', false),       // 2 text-r
    xf(0, 2, 'right', false),       // 3 text12-r
    xf(49, 3, 'right', false),      // 4 bold12-r (текст-формат: «0103» не теряет ноль)
    xf(49, 3, 'right', true),       // 5 bold12-r-wrap (поставка+заказ 2 строки)
    xf(0, 2, 'left', true),         // 6 wrap12 (наименование)
    xf(0, 4, 'left', true),         // 7 mol (8 bold wrap)
    xf(164, 2, 'right', false),     // 8 num3 (#,##0.000)
    xf(4, 4, 'right', false),       // 9 kgv (#,##0.00, 8 bold)
    xf(0, 0, 'left', true),         // 10 wrap10
    xf(0, 5, 'left', false),        // 11 bold10
  ].join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>` +
    `<top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="12">${cellXfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/** Собрать .xlsx (без макросов) из листов. */
export function makeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const enc = new TextEncoder();
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
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
    { name: 'xl/styles.xml', data: enc.encode(stylesXml()) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return makeZip(entries);
}

/** Скачать xlsx в браузере/Electron. */
export function downloadXlsx(filename: string, sheets: XlsxSheet[]): void {
  const bytes = makeXlsx(sheets);
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
