/**
 * Форматирование данных МОЛ — телефоны, статусы, разбор multi-value строк.
 * Конвенции согласованы с Android-приложением (см. core/ui/WarehouseCard.kt).
 */

/**
 * Мобильный телефон — формат `8 901 438 8831`.
 *
 * Нормализация:
 *   • `7XXXXXXXXXX` (11 цифр с country code) → `8XXXXXXXXXX` (юзер хочет
 *     российскую внутреннюю запись с лидирующей 8, не с международной 7).
 *   • `XXXXXXXXXX` (10 цифр без префикса) → добавляем 8 в начало.
 *   • Иначе — fallback на generic group-by-twos.
 */
export function formatMobilePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  if (digits.length === 11 && digits[0] === '7') {
    digits = `8${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    digits = `8${digits}`;
  }
  if (digits.length === 11) {
    return `${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return formatInternalPhone(digits);
}

/**
 * Рабочий (внутренний) телефон — формат `49 02 82` / `7 14 15`.
 *
 * Юзер хочет видеть ТОЛЬКО внутренний номер, без 7 + код города (Россия,
 * +7 3435… для Каменск-Уральского). Strip-ает первые 5 цифр если строка
 * длиннее 7 — это country+city, остальное — internal.
 *
 *   `73435490282` → strip `73435` → `490282` → `49 02 82`
 *   `73435714 15` → strip `73435` → `71415`  → `7 14 15`
 *   `49 02 82`    → digits `490282` → `49 02 82`
 */
export function formatWorkPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;
  // 10+ digits начинающиеся с 7/8 — отрезаем 5-значный country+city prefix.
  if (digits.length >= 10 && (digits[0] === '7' || digits[0] === '8')) {
    digits = digits.slice(5);
  }
  return formatInternalPhone(digits);
}

/** Generic group-by-twos для коротких internal номеров (4–7 digit). */
function formatInternalPhone(digits: string): string {
  switch (digits.length) {
    case 7:
      return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
    case 6:
      return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
    case 5:
      return `${digits.slice(0, 1)} ${digits.slice(1, 3)} ${digits.slice(3)}`;
    case 4:
      return `${digits.slice(0, 2)} ${digits.slice(2)}`;
    default:
      return digits;
  }
}

/**
 * Дата актуальности базы в коротком формате `17.05.2026` (Yek TZ).
 * Используется в попап-меню юзера → строка «База данных vN ДД.ММ.ГГГГ».
 */
export function formatDbDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return raw;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

/**
 * Дата «по какое число включительно» из колонки «склад» (формат источника
 * `DD.MM.YYYY`, напр. `01.07.2026`) → человекочитаемо «1 июля 2026». Если строка
 * не распознана как дата — возвращаем как есть (graceful, не теряем данные).
 */
export function formatMolUntil(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (!m) return s;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return s;
  return `${day} ${RU_MONTHS_GENITIVE[month - 1]} ${m[3]}`;
}

/**
 * Статус срока «по» относительно СЕГОДНЯ (для цвета пилюли в колонке «Склад»):
 *   • 'expired' — дедлайн уже прошёл (раньше сегодня) → красный;
 *   • 'soon'    — осталось ≤2 дней, т.е. окно [дедлайн−2 … дедлайн] (3 дня
 *                 включая сам дедлайн: для «по 23» это 21/22/23) → жёлтый;
 *   • 'ok'      — до срока ещё >2 дней (или дата не распознана) → обычная подсветка.
 * Сравнение по календарным дням (полночь), дедлайн включителен.
 */
export function molUntilStatus(until: string): 'expired' | 'soon' | 'ok' {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((until || '').trim());
  if (!m) return 'ok';
  const deadline = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  deadline.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 2) return 'soon';
  return 'ok';
}

/**
 * Tailwind-классы пилюли срока «по» по статусу `molUntilStatus` (нужен `ring-1`
 * на самом элементе). Единый источник для колонки «Склад» в таблице МОЛ и для
 * поп-овера МОЛ на складе во вкладке «Цеха»: просрочено — красный, ≤2 дней —
 * жёлтый, обычный — фирменный clay.
 */
export const MOL_UNTIL_PILL_CLASS: Record<'expired' | 'soon' | 'ok', string> = {
  expired: 'bg-danger/[0.16] text-danger ring-danger/45',
  soon: 'bg-presence-away/[0.18] text-presence-away ring-presence-away/50',
  ok: 'bg-accent-clay/[0.14] text-accent-clay ring-accent-clay/40',
};

/**
 * Несколько work-телефонов в одной строке («49-02-82, 7-14-15» → ['49 02 82',
 * '7 14 15']). Каждый прогоняется через `formatWorkPhone` (strip city +
 * group-by-twos).
 */
export function splitAndFormatWorkPhones(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(formatWorkPhone);
}

/**
 * Статус строки в таблице. Возвращает `'ok' | 'error' | 'neutral'`:
 *   • работает / работает по совмещению / active → ok
 *   • уволен / не работает / inactive / suspended → error
 *   • пусто / unknown → neutral
 */
export function molStatusKind(rawStatus: string): 'ok' | 'error' | 'neutral' {
  const s = rawStatus.trim().toLowerCase();
  if (!s) return 'neutral';
  // OK — содержит «работает», «active», «активен»
  if (s.includes('работает') || s.includes('active') || s.includes('активен')) {
    return 'ok';
  }
  // Иначе всё что есть — error (уволен / не работает / прочее)
  return 'error';
}

/**
 * Разбивает статус по `/` на несколько строк. `/` остаётся в конце строки,
 * пробел ПОСЛЕ `/` не уходит на новую строку (с trim'ом):
 *
 *   "На бол / в отпус то / остается"
 *     → ["На бол /", "в отпус то /", "остается"]
 *
 * Так разделители-маркеры остаются «приклеены» к предыдущему фрагменту,
 * следующий фрагмент начинается чисто с первого слова без leading whitespace.
 */
export function splitStatusLines(rawStatus: string): string[] {
  const trimmed = rawStatus.trim();
  if (!trimmed) return [];
  const parts = trimmed.split('/').map((p) => p.trim()).filter(Boolean);
  return parts.map((p, i) => (i < parts.length - 1 ? `${p} /` : p));
}

/**
 * Сортировка результатов: сначала группа «работает» (зелёная) → потом
 * «уволен/др.» (красная) → потом без статуса. Внутри группы — по алфавиту
 * ФИО (русская локаль, regard'ит ё как е).
 */
type MolSortable = {
  fio: string;
  status: string;
};

export function sortMolRecords<T extends MolSortable>(records: T[]): T[] {
  const order: Record<'ok' | 'error' | 'neutral', number> = {
    ok: 0,
    error: 1,
    neutral: 2,
  };
  return [...records].sort((a, b) => {
    const ka = order[molStatusKind(a.status)];
    const kb = order[molStatusKind(b.status)];
    if (ka !== kb) return ka - kb;
    return a.fio.localeCompare(b.fio, 'ru', { sensitivity: 'base' });
  });
}
