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

export const VGH_COLUMNS: VghColumnSpec[] = [
  { id: 'marked', title: '✓', kind: 'check', width: 40, editable: true },
  { id: 'fr', title: 'FR', kind: 'text', width: 56, editable: true },
  { id: 'no_num', title: 'NO. №', kind: 'text', width: 92, editable: false },
  { id: 'mat', title: 'MAT', kind: 'text', width: 280, editable: true },
  { id: 'uom', title: 'ЕИ', kind: 'text', width: 48, editable: true },
  { id: 'weight_kg', title: 'КГ (1 ЕИ)', kind: 'number', width: 84, editable: true, frac: 3 },
  { id: 'len_mm', title: 'Д', kind: 'number', width: 64, editable: true, frac: 1 },
  { id: 'wid_mm', title: 'Ш', kind: 'number', width: 64, editable: true, frac: 1 },
  { id: 'hgt_mm', title: 'В', kind: 'number', width: 64, editable: true, frac: 1 },
  { id: 'min_qty', title: 'MIN QTY', kind: 'number', width: 76, editable: true, frac: 3 },
  { id: 'volume', title: 'V, м³', kind: 'volume', width: 84, editable: false, frac: 6 },
  { id: 'tech_name', title: 'ТЕХ-ИМЯ', kind: 'text', width: 280, editable: true },
];

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
    const v = id === 'volume' ? row.volume : ((row as unknown as Record<string, unknown>)[id] as number | null);
    return fmtSmart(v, spec.frac ?? 3);
  }
  const v = (row as unknown as Record<string, unknown>)[id];
  return v == null ? '' : String(v);
}

/** «Готова к переносу» — есть вес (минимум для расчёта KG). Без веса чекбокс заблокирован. */
export function vghReady(row: VghStagingView): boolean {
  return row.weight_kg != null && Number.isFinite(Number(row.weight_kg));
}

/** Перенесена в базу за последние сутки → строка зелёная (потом скрывается сервером). */
export function vghTransferred(row: VghStagingView): boolean {
  return !!row.transferred_at;
}
