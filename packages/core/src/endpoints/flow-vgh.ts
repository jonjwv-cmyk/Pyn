import type { ApiClient } from '../api/client';

/**
 * ВГХ-пайплайн раздела «Поток»: база вес-габаритных характеристик (flow_vgh) +
 * промежуточный лист (flow_vgh_staging). Наша улучшенная замена Google-скрипта:
 * всё реалтайм по WS, оптимистичный row_version.
 *
 * Объём V = Д×Ш×В / 1e9 (м³). KG/V для формирования считаются на КЛИЕНТЕ из этой
 * базы реалтайм (вес/объём на 1 ЕИ × количество).
 */

/** Строка БАЗЫ ВГХ (одна номенклатура; габариты едины на товар). */
export interface VghRow {
  no_num: string;
  mat: string;
  uom: string;
  tech_name: string;
  weight_kg: number | null;
  len_mm: number | null;
  wid_mm: number | null;
  hgt_mm: number | null;
  volume_m3: number | null;
  min_qty: number | null;
  warehouses: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
  row_version: number;
}

/** Строка ПРОМЕЖУТОЧНОГО листа (дозаполнение + чекбокс-перенос в базу). */
export interface VghStagingRow {
  no_num: string;
  fr: string;
  mat: string;
  uom: string;
  tech_name: string;
  weight_kg: number | null;
  len_mm: number | null;
  wid_mm: number | null;
  hgt_mm: number | null;
  min_qty: number | null;
  /** Обратный счёт ΣKG/ΣQTY из формирования — подсказка веса на 1 ЕИ. */
  weight_hint: number | null;
  /** Чекбокс «перенести в базу» (0/1). */
  marked: number;
  /** Когда перенесено в базу (строка зеленеет; через сутки скрыта). Null — не перенесено. */
  transferred_at: string | null;
  source: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
  row_version: number;
}

/** Одна правка строки (базы или промежуточного листа): ключ no_num + версия + поля. */
export interface VghEdit {
  no_num: string;
  row_version: number;
  fields: Record<string, string | number | boolean | null>;
}

/** Прочитать всю базу ВГХ. */
export async function flowVghGet(client: ApiClient): Promise<VghRow[]> {
  const wire = await client.call<{ rows?: VghRow[] }>('flow_vgh_get', {});
  return Array.isArray(wire.rows) ? wire.rows : [];
}

/**
 * Правка номенклатуры базы ВГХ из карточки. Сервер пишет с проверкой row_version,
 * пересчитывает объём при смене Д/Ш/В, рассылает `vgh_changed` всем. Возвращает
 * применилось/конфликт + актуальную строку (клиент догоняет при конфликте).
 */
export async function flowVghEdit(
  client: ApiClient,
  edit: VghEdit,
): Promise<{ applied: boolean; conflict: boolean; row: VghRow | null }> {
  const wire = await client.call<{ applied?: boolean; conflict?: boolean; row?: VghRow | null }>(
    'flow_vgh_edit',
    { no_num: edit.no_num, row_version: edit.row_version, fields: edit.fields },
  );
  return {
    applied: !!wire.applied,
    conflict: !!wire.conflict,
    row: wire.row ?? null,
  };
}

/** Прочитать промежуточный лист (видимые строки: не перенесённые / зелёные <24ч). */
export async function flowVghStagingGet(client: ApiClient): Promise<VghStagingRow[]> {
  const wire = await client.call<{ rows?: VghStagingRow[] }>('flow_vgh_staging_get', {});
  return Array.isArray(wire.rows) ? wire.rows : [];
}

/**
 * Применить правки промежуточного грида (батч, реалтайм). Если marked→1 и есть
 * вес → сервер переносит строку в базу ВГХ (transferred_at). Рассылает
 * `vgh_staging_changed` + `vgh_changed`. Возвращает применённые/конфликтные/
 * перенесённые no_num + актуальные строки промежуточного листа.
 */
export async function flowVghStagingEdit(
  client: ApiClient,
  edits: VghEdit[],
): Promise<{ applied: string[]; conflicts: string[]; transferred: string[]; rows: VghStagingRow[] }> {
  const wire = await client.call<{
    applied?: string[];
    conflicts?: string[];
    transferred?: string[];
    rows?: VghStagingRow[];
  }>('flow_vgh_staging_edit', { edits });
  return {
    applied: Array.isArray(wire.applied) ? wire.applied : [],
    conflicts: Array.isArray(wire.conflicts) ? wire.conflicts : [],
    transferred: Array.isArray(wire.transferred) ? wire.transferred : [],
    rows: Array.isArray(wire.rows) ? wire.rows : [],
  };
}

/**
 * Пересобрать промежуточный лист из формирования (номенклатуры активных заказов
 * без веса в базе + вес-подсказка). Ручной ввод НЕ затирается. Сервер шлёт
 * `vgh_staging_changed`. (admin)
 */
export async function flowVghStagingRefresh(
  client: ApiClient,
): Promise<{ upserted: number; candidates: number }> {
  const wire = await client.call<{ upserted?: number; candidates?: number }>(
    'flow_vgh_staging_refresh',
    {},
  );
  return { upserted: Number(wire.upserted) || 0, candidates: Number(wire.candidates) || 0 };
}
