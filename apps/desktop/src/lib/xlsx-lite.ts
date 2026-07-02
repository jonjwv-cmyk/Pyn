// ============================================================
// xlsx-lite.ts — минимальный генератор .xlsx БЕЗ зависимостей (юзер 2026-07-02).
// ============================================================
// Причина: exceljs ломал electron-typecheck через @types/node (проверено 2026-06-13),
// а юзеру нужен «эксель без макросов» с двумя листами, разрывами страниц и жирными
// заголовками. XLSX = zip из XML — собираем сами: ZIP пишем без сжатия (stored, CRC32),
// строки — inline (без sharedStrings). Этого достаточно для плана экспедиции.

export type XlsxValue = string | number | null | undefined;

export interface XlsxSheet {
  name: string;
  /** Строки листа. Значение ячейки: строка/число/пусто. */
  rows: XlsxValue[][];
  /** Ширины колонок (символы Excel). */
  colWidths?: number[];
  /** Индексы строк (1-based), ПОСЛЕ которых разрыв страницы. */
  rowBreaks?: number[];
  /** Слияния ячеек, например 'A1:T1' (титул). */
  merges?: string[];
  /** Строки (1-based) со стилем: 2 = титул (жирный 14), 1 = жирный заголовок. */
  boldRows?: number[];
  titleRows?: number[];
  /** Альбомная ориентация печати (по умолчанию да). */
  landscape?: boolean;
}

// ── CRC32 (стандартная таблица) ──────────────────────────────────────────────
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

// ── ZIP (stored, без сжатия) ─────────────────────────────────────────────────
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
      0x50, 0x4b, 0x03, 0x04, ...num2(20), ...num2(0x0800 /* UTF-8 names */), ...num2(0), ...num2(0), ...num2(0),
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
  const total = offset + centralLen + end.length;
  const out = new Uint8Array(total);
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
  const bold = new Set(sheet.boldRows ?? []);
  const title = new Set(sheet.titleRows ?? []);
  const cols = (sheet.colWidths ?? [])
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const rowsXml = sheet.rows
    .map((row, ri) => {
      const r = ri + 1;
      const style = title.has(r) ? 2 : bold.has(r) ? 1 : 0;
      const cells = row
        .map((v, ci) => {
          if (v == null || v === '') return '';
          const ref = `${colLetter(ci)}${r}`;
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
          return `<c r="${ref}" s="${style === 0 ? 3 : style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}"${title.has(r) ? ' ht="22" customHeight="1"' : ''}>${cells}</row>`;
    })
    .join('');
  const merges = (sheet.merges ?? []).length
    ? `<mergeCells count="${sheet.merges?.length}">${sheet.merges?.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const breaks = (sheet.rowBreaks ?? []).length
    ? `<rowBreaks count="${sheet.rowBreaks?.length}" manualBreakCount="${sheet.rowBreaks?.length}">${sheet.rowBreaks
        ?.map((b) => `<brk id="${b}" max="16383" man="1"/>`)
        .join('')}</rowBreaks>`
    : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rowsXml}</sheetData>` +
    merges +
    `<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.4" header="0.2" footer="0.2"/>` +
    `<pageSetup paperSize="9" orientation="${sheet.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    breaks +
    `</worksheet>`
  );
}

/** Собрать .xlsx (без макросов) из листов. Стили: 1=жирный, 2=титул(14, жирный), 3=перенос текста. */
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
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="3"><font><sz val="10"/><name val="Arial"/></font>` +
    `<font><b/><sz val="10"/><name val="Arial"/></font>` +
    `<font><b/><sz val="14"/><name val="Arial"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `</cellXfs>` +
    `</styleSheet>`;
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
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
