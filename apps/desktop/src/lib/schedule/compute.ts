/**
 * Расчёт дат + валидация warehouse-кодов для раздела «График».
 *
 * Портирован из Google Sheets ARRAYFORMULA из листа `📊schedule` (cell D6):
 * для каждой строки берёт {год, месяц, день_недели, праздники, override} и
 * возвращает массив чисел месяца. Override берёт верх над weekly schedule:
 * если warehouse-код строки матчит правило, даты строки = именно
 * `rule.days` (праздники игнорируются — это уже явный список).
 */

import {
  WEEKDAY_TO_JS,
  type ScheduleOverrideRule,
  type WarehouseCode,
  type Weekday,
} from './types';

/**
 * Формат warehouse-кода: 4 символа = 3 цифры + (цифра ИЛИ буква любой
 * раскладки). Примеры: `2803`, `0001`, `824T`, `824Т`. **Лидирующие нули
 * сохраняются**: `0001` валидный.
 */
const WAREHOUSE_PATTERN = /^\d{3}[\dA-Za-zА-Яа-яёЁ]$/;

/**
 * Разобрать сырую строку из E-колонки Excel в массив {code, isKhp, isVyezd}.
 * Разделитель — любой пробельный символ или перевод строки. Префиксы `*`/`#`
 * срезаются и попадают в флаги.
 */
export function parseWarehouseCell(raw: string): WarehouseCode[] {
  const tokens = raw.split(/[\s\n\r]+/).filter((t) => t.length > 0);
  const out: WarehouseCode[] = [];
  for (const tok of tokens) {
    let s = tok;
    let isKhp = false;
    let isVyezd = false;
    // Префиксы могут идти в любом порядке (на практике один из двух).
    while (s.length > 0 && (s[0] === '*' || s[0] === '#')) {
      if (s[0] === '*') isKhp = true;
      if (s[0] === '#') isVyezd = true;
      s = s.slice(1);
    }
    if (s.length === 0) continue;
    out.push({ code: s, isKhp: isKhp || undefined, isVyezd: isVyezd || undefined });
  }
  return out;
}

/** Сериализация обратно в строку формата Excel (для экспорта/copy-paste). */
export function serializeWarehouses(codes: WarehouseCode[]): string {
  return codes
    .map((w) => `${w.isKhp ? '*' : ''}${w.isVyezd ? '#' : ''}${w.code}`)
    .join('  ');
}

/** Соответствует ли строка формату 4-символьного склада. */
export function isValidWarehouseFormat(code: string): boolean {
  return WAREHOUSE_PATTERN.test(code);
}

/**
 * Найти подходящее override-правило для warehouse-кода. Сравнение
 * case-insensitive по очищенному коду (без `*`/`#`).
 *
 * ВАЖНО: override с `days.length === 0` ИГНОРИРУЕТСЯ — это значит «склад
 * есть в списке исключений, но дни не выбраны → нет фильтра, склад идёт
 * по natural-дням». Юзер кликает в Исключения какие дни ИМЕННО показывать;
 * пустой выбор = по умолчанию (все natural-дни).
 */
export function findOverride(
  code: string,
  overrides: readonly ScheduleOverrideRule[],
): ScheduleOverrideRule | undefined {
  const norm = code.toLowerCase();
  const found = overrides.find((r) => r.codes.some((c) => c.toLowerCase() === norm));
  if (!found || found.days.length === 0) return undefined;
  return found;
}

/**
 * Натуральные даты для weekday в месяце (без override, минус праздники).
 * Та же логика что в weekly-ветке `computeRowDates`, но вынесена отдельно —
 * нужна для UI: «Исключения» показывает natural-дни как toggle-кнопки.
 */
export function computeNaturalDays(
  year: number,
  month: number,
  weekday: Weekday,
  holidays: readonly number[],
): number[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const targetJsDay = WEEKDAY_TO_JS[weekday];
  const holidaysSet = new Set(holidays);
  const out: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getDay() === targetJsDay && !holidaysSet.has(d)) {
      out.push(d);
    }
  }
  return out;
}

/**
 * Разбить warehouses одной строки (одного weekday) на под-группы по
 * **эффективным дням**. Склад с override → даты = `rule.days`. Без override
 * → даты = natural-дни. Совпадающие подписи группируются в одну строку.
 *
 * Возвращаемый порядок: natural-группа (если есть) первой, затем override-
 * группы в порядке появления в исходном массиве warehouses. Каждая группа —
 * массив исходных WarehouseCode (порядок сохраняется внутри группы).
 *
 * Пример: warehouses = [1270, 2200], natural = [1,2,3], 2200 override [1,3]
 *   → [[1270], [2200]]  (две группы — разные эффективные дни)
 * Пример: 2200 override [1,2,3] (совпало с natural)
 *   → [[1270, 2200]]   (одна группа — счастливое совпадение)
 */
export function splitWarehousesByOverrides(
  warehouses: readonly WarehouseCode[],
  naturalDays: readonly number[],
  overrides: readonly ScheduleOverrideRule[],
): WarehouseCode[][] {
  const naturalKey = [...naturalDays].sort((a, b) => a - b).join(',');
  const order: string[] = [];
  const groups = new Map<string, WarehouseCode[]>();
  for (const w of warehouses) {
    const rule = findOverride(w.code, overrides);
    const effectiveDays = rule
      ? [...rule.days].sort((a, b) => a - b)
      : [...naturalDays].sort((a, b) => a - b);
    const key = effectiveDays.join(',');
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(w);
  }
  // natural-группа первой
  const result: WarehouseCode[][] = [];
  if (groups.has(naturalKey)) result.push(groups.get(naturalKey)!);
  for (const key of order) {
    if (key !== naturalKey) result.push(groups.get(key)!);
  }
  return result;
}

/**
 * Вычислить даты для одной строки графика.
 *
 * Логика (mirror D6 в xlsx):
 * - Если хотя бы один warehouse-код имеет override → даты = объединение
 *   `rule.days` для всех совпавших правил. Праздники не применяются —
 *   override = явный список.
 * - Иначе → все дни месяца, где `weekday(date) === row.weekday` И
 *   `day NOT IN holidays`.
 *
 * @returns массив 1..31, отсортирован по возрастанию.
 */
export function computeRowDates(
  year: number,
  month: number,
  weekday: Weekday,
  warehouses: readonly WarehouseCode[],
  holidays: readonly number[],
  overrides: readonly ScheduleOverrideRule[],
): number[] {
  // Override path: если ЛЮБОЙ код строки матчит override — используем его дни.
  // На практике в одной строке обычно один override-кандидат, но если будет
  // несколько правил → объединяем (UNION).
  const overrideDays = new Set<number>();
  let hasOverride = false;
  for (const w of warehouses) {
    const rule = findOverride(w.code, overrides);
    if (rule) {
      hasOverride = true;
      for (const d of rule.days) overrideDays.add(d);
    }
  }
  if (hasOverride) {
    return [...overrideDays].sort((a, b) => a - b);
  }

  // Weekly schedule: все дни месяца с нужным weekday минус праздники.
  const daysInMonth = new Date(year, month, 0).getDate(); // month 1..12 → Date(year, month, 0) = последний день
  const targetJsDay = WEEKDAY_TO_JS[weekday];
  const holidaysSet = new Set(holidays);
  const out: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getDay() === targetJsDay && !holidaysSet.has(d)) {
      out.push(d);
    }
  }
  return out;
}

/** Форматирование массива дат в строку графика, e.g. `5, 12, 19, 26`.
 * Linear/Notion pattern — запятая вместо slash. Естественный reading-flow,
 * tabular-nums держит numerics aligned. */
export function formatDates(days: readonly number[]): string {
  return days.join(', ');
}

/**
 * Валидация warehouse-кода для inline-индикации в UI.
 *
 * @param code очищенный код (без `*`/`#`)
 * @param knownWarehouses список известных кодов из справочника
 *        (`wf_warehouses!A`, нормализован 4-знака)
 * @returns:
 *   - `'ok'` — формат валиден + код в справочнике
 *   - `'unknown'` — формат валиден, но кода нет в справочнике
 *   - `'invalid'` — формат не соответствует (длина / символы)
 *   - `'no_dict'` — справочник пуст (нечего проверять, не показываем ошибку)
 */
export function validateWarehouse(
  code: string,
  knownWarehouses: readonly string[] | null,
): 'ok' | 'unknown' | 'invalid' | 'no_dict' {
  if (!isValidWarehouseFormat(code)) return 'invalid';
  if (knownWarehouses === null || knownWarehouses.length === 0) return 'no_dict';
  const norm = code.toLowerCase();
  const found = knownWarehouses.some((k) => k.toLowerCase() === norm);
  return found ? 'ok' : 'unknown';
}

/** Названия месяцев по-русски (для header). */
export const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;
