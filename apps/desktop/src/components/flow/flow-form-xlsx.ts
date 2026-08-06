// ============================================================
// flow-form-xlsx.ts — выгрузка вкладки «Формирование» в .xlsx (ТЗ 2026-08-06 п.9).
// ============================================================
// Колонки, их порядок и ширины — 1:1 с эталонным файлом «1. Формирование.xlsx»,
// чтобы выгруженный файл открывался в привычном виде. Выгружаем то, что реально
// видно в гриде (после фильтров), в текущем порядке строк.
// Заливка ШАПКИ по колонкам в xlsx-lite не поддерживается — цвета шапки эталона
// здесь не воспроизводятся, структура и ширины совпадают.
import { downloadXlsx, XLSX_STYLE, type XlsxSheet, type XlsxValue } from '@/lib/xlsx-lite';
import { priorityDisplay } from './flow-eps';
import type { FormRow } from './flow-tabulator-form';

/** Заголовки эталона по порядку (A…Y). */
const HEADERS = [
  'ГРАФ', 'ORD', 'FR', 'TO', 'FR', 'ТОЧКА', 'DAY', 'Выгружен', 'ORD name, date', 'OFF/NEW',
  'STAT', '% + HY', 'Q', 'NO. №', 'MAT', 'TECH NAME', 'UoM', 'QTY', 'KG', 'V',
  'ПРИОР.', 'NOTE', 'ОКНО', 'МОЛ', 'СОГЛ.',
];

/** Ширины колонок эталона (символы Excel). */
const WIDTHS = [
  13.14, 15.14, 5.71, 5.86, 5.71, 9.57, 7, 12.71, 18.29, 11.86,
  10.43, 9.43, 4.71, 9.14, 46.71, 14, 7.29, 9.14, 9.14, 12,
  10.43, 16, 10.71, 22.14, 22.14,
];

/** Стили данных по колонкам: числа — числовые, длинные тексты — с переносом. */
const COL_STYLES = [
  XLSX_STYLE.text, XLSX_STYLE.text, XLSX_STYLE.text, XLSX_STYLE.text, XLSX_STYLE.text,
  XLSX_STYLE.wrap10, XLSX_STYLE.text, XLSX_STYLE.text8, XLSX_STYLE.text8, XLSX_STYLE.text,
  XLSX_STYLE.text, XLSX_STYLE['text-r'], XLSX_STYLE.text, XLSX_STYLE.text, XLSX_STYLE.wrap10,
  XLSX_STYLE.wrap8, XLSX_STYLE.text, XLSX_STYLE.num3, XLSX_STYLE.kgv, XLSX_STYLE.kgv,
  XLSX_STYLE.text, XLSX_STYLE.wrap10, XLSX_STYLE.text, XLSX_STYLE.mol, XLSX_STYLE.text,
].map((v) => v ?? 0);

function rowToCells(r: FormRow): XlsxValue[] {
  return [
    r.graf ?? '',
    [r.ord, r.it].filter(Boolean).join(' | '),
    r.fr ?? '',
    r.to_wh ?? '',
    r.pr ?? '',
    r.point ?? '',
    r.day ?? '',
    r.time_at ?? '',
    r.ord_info ?? '',
    r.offnew ?? '',
    r.stat ?? '',
    // % целым; 0% не пишем (тот же канон, что fmtPct / livePct).
    r.pct == null || !Number.isFinite(r.pct) || Math.round(r.pct * 100) === 0
      ? ''
      : Math.round(r.pct * 100),
    r.q ?? '',
    r.no_num ?? '',
    r.mat ?? '',
    r.tech_name ?? '',
    r.uom ?? '',
    r.qty ?? '',
    r.kg_live ?? '',
    r.v_live ?? '',
    priorityDisplay(r.priority ?? ''),
    r.note ?? '',
    r.delivery ?? '',
    r.mol ?? '',
    r.sogl_on ? 'ДА' : '',
  ];
}

/** Имя файла: «Формирование 2026-08-06.xlsx». */
function fileName(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `Формирование ${iso}.xlsx`;
}

/** Выгрузить переданные строки в .xlsx формата эталона. */
export function exportFormXlsx(rows: readonly FormRow[]): void {
  const sheet: XlsxSheet = {
    name: 'Формирование',
    rows: [HEADERS, ...rows.map(rowToCells)],
    colWidths: WIDTHS,
    colStyles: COL_STYLES,
    autoFilter: true,
    freezeTop: true,
    landscape: true,
    printScale: 100,
  };
  downloadXlsx(fileName(), [sheet]);
}
