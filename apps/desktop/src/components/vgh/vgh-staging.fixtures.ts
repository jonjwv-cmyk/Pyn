import type { VghStagingRow } from '@pyn/core';

/**
 * Модель промежуточного листа «ВГХ» (дозаполнение вес/габариты/объём/MIN QTY/
 * тех-имя). Колонки — как в Google-листе ВГХ, но БЕЗ LOG и ПОВТОРЫ (по ТЗ), и
 * тех-имя заполняется руками. Объём V считается на клиенте (Д×Ш×В/1e9), показ —
 * «умный» (хвостовые нули убираются). Чекбокс при наличии веса → перенос в базу.
 */

export type VghColKind = 'check' | 'text' | 'number' | 'volume';

export type VghColId =
  | 'marked'
  | 'fr'
  | 'no_num'
  | 'mat'
  | 'uom'
  | 'weight_kg'
  | 'len_mm'
  | 'wid_mm'
  | 'hgt_mm'
  | 'min_qty'
  | 'volume'
  | 'tech_name';

export interface VghColumnSpec {
  id: VghColId;
  title: string;
  kind: VghColKind;
  /** Базовая ширина (px) — стартовая, дальше авто-ширина по содержимому. */
  width: number;
  /** Правится ли руками (no_num — ключ, volume — производное → read-only). */
  editable: boolean;
  /** Сколько знаков после запятой при показе (для number/volume). */
  frac?: number;
}

// Редактируем РУКАМИ только вес/Д/Ш/В/MIN QTY (+ чекбокс переноса). FR/NO/MAT/ЕИ/
// тех-имя приходят из формирования/SAP — read-only (правка → каша). (Юзер 2026-06-08.)
export const VGH_COLUMNS: VghColumnSpec[] = [
  { id: 'marked', title: '✓', kind: 'check', width: 40, editable: true },
  { id: 'fr', title: 'FR', kind: 'text', width: 56, editable: false },
  { id: 'no_num', title: 'NO. №', kind: 'text', width: 92, editable: false },
  { id: 'mat', title: 'MAT', kind: 'text', width: 280, editable: false },
  { id: 'uom', title: 'ЕИ', kind: 'text', width: 48, editable: false },
  // Показ — РОВНО 4 знака после запятой (фикс, без обрезки хвостовых нулей), включая
  // авто-значения (вес Т/КГ/Г, MIN QTY штучных) — единообразно по столбцу. (Юзер 2026-06-07.)
  // Д/Ш/В — миллиметры (подпись «, мм», чтобы не путали с см). (Юзер 2026-06-07.)
  { id: 'weight_kg', title: 'КГ (1 ЕИ)', kind: 'number', width: 84, editable: true, frac: 4 },
  { id: 'len_mm', title: 'Д, мм', kind: 'number', width: 70, editable: true, frac: 4 },
  { id: 'wid_mm', title: 'Ш, мм', kind: 'number', width: 70, editable: true, frac: 4 },
  { id: 'hgt_mm', title: 'В, мм', kind: 'number', width: 70, editable: true, frac: 4 },
  { id: 'min_qty', title: 'MIN QTY', kind: 'number', width: 76, editable: true, frac: 4 },
  { id: 'volume', title: 'V, м³', kind: 'volume', width: 84, editable: false, frac: 6 },
  // ТЕХ-ИМЯ — «резиновая» колонка как NOTE (подгонка ширины + перенос ТОЛЬКО для показа),
  // но НЕ редактируемая: тех-имя меняется только автоматом. (Юзер 2026-06-07.)
  { id: 'tech_name', title: 'ТЕХ-ИМЯ', kind: 'text', width: 280, editable: false },
];

/** Штучные единицы — для них MIN QTY = 1 (минимум 1 шт на заказ); вводить нельзя. */
export const VGH_PIECE_UOMS = new Set(['ШТ', 'КМП', 'РУЛ', 'УПК', 'КОР']);

/** Весовые единицы — вес 1 ЕИ известен сам: Т=1000 кг, КГ=1, Г=0,001. Ставим
 *  автоматом и блокируем правку (чтобы не ошибиться). */
const VGH_WEIGHT_BY_UOM: Record<string, number> = { 'Т': 1000, 'ТН': 1000, 'КГ': 1, 'Г': 0.001 };

/** ЕИ → верхний регистр без пробелов (для сопоставления). */
function uomKey(uom: string | null | undefined): string {
  return String(uom ?? '').trim().toUpperCase();
}
/** Авто-вес на 1 ЕИ по единице измерения (Т/КГ/Г). null — ЕИ не весовая. */
export function autoWeightByUom(uom: string | null | undefined): number | null {
  const k = uomKey(uom);
  return k in VGH_WEIGHT_BY_UOM ? (VGH_WEIGHT_BY_UOM[k] as number) : null;
}
/** Штучная ЕИ? (для неё MIN QTY = 1, блокируем правку). */
export function isPieceUom(uom: string | null | undefined): boolean {
  return VGH_PIECE_UOMS.has(uomKey(uom));
}

/** Строка показа = серверная строка staging + стабильный _id + производный объём. */
export interface VghStagingView extends VghStagingRow {
  _id: number;
  volume: number | null;
}

/** Объём м³ = Д×Ш×В/1e9 (все три >0), иначе null. */
export function computeVolume(
  len: number | null,
  wid: number | null,
  hgt: number | null,
): number | null {
  if (len == null || wid == null || hgt == null) return null;
  if (!(len > 0) || !(wid > 0) || !(hgt > 0)) return null;
  return (len * wid * hgt) / 1e9;
}

/** «Умный» показ числа: запятая-десятич, разряды пробелом, хвостовые нули убраны
 *  (до maxFrac знаков). 0,5 / 0,000123 / 1 366 / 12,4. Пусто/нечисло → ''. */
export function fmtSmart(n: number | null | undefined, maxFrac = 6): string {
  if (n == null || !Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  let s = abs.toFixed(maxFrac);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const [int = '0', frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (frac ? ',' + frac : '');
}

/**
 * «Умный» показ ОБЪЁМА (м³): целая часть как есть, дробная ОБРЕЗАЕТСЯ до первой
 * значащей (ненулевой) цифры включительно — 0,00042→«0,0004», 0,0156→«0,01»,
 * 1,5→«1,5», 2→«2». Разряды пробелом, запятая-десятич. Пусто/нечисло → ''.
 * (Юзер 2026-06-08: объём показываем умно до первого ненулевого знака — так везде.)
 */
export function fmtVolume(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const [intPart = '0', fracRaw = ''] = abs.toFixed(12).split('.');
  let frac = '';
  for (let i = 0; i < fracRaw.length; i++) {
    const ch = fracRaw[i] as string;
    frac += ch;
    if (ch !== '0') break; // дошли до первой значащей цифры — на ней останавливаемся
  }
  if (/^0*$/.test(frac)) frac = ''; // целое число — без дробной части
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (frac ? ',' + frac : '');
}

/** ФИКСИРОВАННЫЙ показ числа: РОВНО `frac` знаков после запятой (хвостовые нули НЕ
 *  убираются — для листа ВГХ единообразно по столбцу, вкл. авто-значения), запятая-
 *  десятич, разряды пробелом. Пусто/нечисло → ''. */
export function fmtFixed(n: number | null | undefined, frac = 4): string {
  if (n == null || !Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const [int = '0', f = ''] = Math.abs(n).toFixed(frac).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (f ? ',' + f : '');
}

/** Число → «чистое» редактируемое представление: запятая-десятич, без разрядов-пробелов
 *  и хвостовых нулей (для инлайн-редактора число-ячейки, чтобы вводить запятой). */
export function numToEdit(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}

/** Текущее значение поля (для редактора/показа). */
export function vghRaw(row: VghStagingView, id: VghColId): string | number | boolean | null {
  if (id === 'marked') return Number(row.marked) === 1;
  if (id === 'volume') return row.volume;
  const v = (row as unknown as Record<string, unknown>)[id];
  return (v ?? null) as string | number | boolean | null;
}

/** Отформатированный текст значения (для фильтра/поиска/показа текстовых ячеек). */
export function vghText(row: VghStagingView, id: VghColId): string {
  if (id === 'marked') return Number(row.marked) === 1 ? '✓' : '';
  const spec = VGH_COLUMNS.find((c) => c.id === id);
  if (spec && (spec.kind === 'number' || spec.kind === 'volume')) {
    if (id === 'volume') return fmtVolume(row.volume); // объём — умно до первого значащего знака
    const v = (row as unknown as Record<string, unknown>)[id] as number | null;
    // Д/Ш/В — чисто мм (целые) → умный показ без принудительных 4 знаков; КГ/MIN QTY — фикс. 4.
    if (id === 'len_mm' || id === 'wid_mm' || id === 'hgt_mm') return fmtSmart(v);
    return fmtFixed(v, spec.frac ?? 4);
  }
  const v = (row as unknown as Record<string, unknown>)[id];
  return v == null ? '' : String(v);
}

/** «Готова к переносу» — есть вес (минимум для расчёта KG). Для весовых ЕИ (Т/КГ/Г)
 *  вес известен сам → всегда готова. Иначе нужен введённый вес. */
export function vghReady(row: VghStagingView): boolean {
  if (autoWeightByUom(row.uom) != null) return true;
  return row.weight_kg != null && Number.isFinite(Number(row.weight_kg));
}

/** Дефолтная сортировка листа ВГХ (юзер 2026-06-07): склад-отправитель FR → ЕИ (сначала
 *  НЕ штучные, потом штучные; внутри — алфавит ЕИ) → наименование MAT по алфавиту. */
export function vghDefaultCompare(a: VghStagingView, b: VghStagingView): number {
  const fr = String(a.fr ?? '').localeCompare(String(b.fr ?? ''), 'ru', { numeric: true });
  if (fr) return fr;
  const ap = isPieceUom(a.uom) ? 1 : 0;
  const bp = isPieceUom(b.uom) ? 1 : 0;
  if (ap !== bp) return ap - bp; // не штучное (0) — выше
  const uom = String(a.uom ?? '').localeCompare(String(b.uom ?? ''), 'ru', { numeric: true });
  if (uom) return uom;
  return String(a.mat ?? '').localeCompare(String(b.mat ?? ''), 'ru', { numeric: true });
}

/** Перенесена в базу за последние сутки → строка зелёная (потом скрывается сервером). */
export function vghTransferred(row: VghStagingView): boolean {
  return !!row.transferred_at;
}
