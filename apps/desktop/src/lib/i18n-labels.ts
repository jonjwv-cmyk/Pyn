/**
 * Локализация для data-values (cluster codes + weekday abbreviations).
 *
 * Эти значения хранятся в БД/store как русские строки (НТМК, ВЫЕЗД, КХП, ПН-ВС
 * — типы `WarehouseCluster` / `WarehouseWeekday`). На display переводим в
 * текущую локаль через `t()`. Хелперы принимают TFunction и значение, возвращают
 * локализованный label.
 */

import type { TFunction } from 'i18next';
import type { WarehouseCluster, WarehouseWeekday } from '@pyn/core';

/**
 * День недели (короткое) → локализованная строка. Например для en/Mon, de/Mo,
 * es/Lun, uk/Пн, ru/ПН. Значения берутся из `common.weekday_short_*`.
 */
export function weekdayShortLabel(d: WarehouseWeekday, t: TFunction): string {
  switch (d) {
    case 'ПН': return t('common.weekday_short_mon');
    case 'ВТ': return t('common.weekday_short_tue');
    case 'СР': return t('common.weekday_short_wed');
    case 'ЧТ': return t('common.weekday_short_thu');
    case 'ПТ': return t('common.weekday_short_fri');
    case 'СБ': return t('common.weekday_short_sat');
    case 'ВС': return t('common.weekday_short_sun');
  }
}

/**
 * Кластер → локализованная строка. НТМК остаётся NTMK (transliterate),
 * ВЫЕЗД переводится (Visit / Besuch / Visita), КХП тоже (CCP / KCP / CCP / КХВ).
 */
export function clusterLabel(c: WarehouseCluster, t: TFunction): string {
  switch (c) {
    case 'НТМК': return t('common.cluster_ntmk');
    case 'ВЫЕЗД': return t('common.cluster_vyezd');
    case 'КХП': return t('common.cluster_khp');
  }
}

/** Полное название месяца (1..12) — `common.month_N`. */
export function monthLabel(month: number, t: TFunction): string {
  if (month < 1 || month > 12) return '';
  return t(`common.month_${month}`);
}
