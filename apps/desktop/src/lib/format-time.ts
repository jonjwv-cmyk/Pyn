/**
 * Унифицированный формат времени по Екатеринбургу в 12-часовой нотации.
 *
 * Сервер OTLHelper2 пишет даты в формате `YYYY-MM-DD HH:MM:SS` (MySQL DATETIME),
 * и эти значения — **локальное время Екатеринбурга** (UTC+5), а не UTC.
 * Поэтому при parse'е делаем сдвиг на -5 часов чтобы получить корректный
 * UTC-момент, дальше форматируем обратно в Yek через `Intl.DateTimeFormat`.
 *
 * Все user-facing timestamps в Pyn проходят через эти helper'ы — UI везде
 * показывает "10:11 AM" / "16.05 2:34 PM" / "сегодня в 11:00 AM" в одной
 * timezone независимо от того где запущен Pyn.
 */

const YEK_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Yekaterinburg',
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Yekaterinburg',
});

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Парсит "YYYY-MM-DD HH:MM:SS" как Yekaterinburg local time → UTC Date.
 * Возвращает null если не удалось распарсить.
 */
export function parseServerDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  // Yek local time → UTC: subtract +5h offset.
  return new Date(Date.UTC(year, month, day, hour - 5, minute, second));
}

/** Время "10:11 AM" в Yek TZ, в 12-часовом формате. */
export function formatTimeYek(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  return d ? TIME_FORMATTER.format(d) : (raw ?? '');
}

/**
 * Короткая дата "16.05" в Yek TZ (для chat list rows, news date).
 */
export function formatShortDateYek(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  return d ? SHORT_DATE_FORMATTER.format(d) : (raw ?? '');
}

/**
 * Унифицированный формат для всего приложения: `5 мая, 2:34 PM` (с годом
 * если не текущий: `5 мая 2025, 2:34 PM`).
 *
 * Используется для news createdAtLabel, chat message time, chat-list
 * lastMessageTime, stats read_at / voted_at, scheduled-publish индикатора.
 * Один формат, никаких "сегодня" / "вчера" / "16.05" — пользователь явно
 * попросил вид «число месяц словом + время».
 */
export function formatFullYek(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  if (!d) return raw ?? '';
  const { day, month, year } = yekParts(d);
  const monthName = MONTHS_GEN[month] ?? '';
  const time = TIME_FORMATTER.format(d);
  const nowYear = yekParts(new Date()).year;
  if (year === nowYear) {
    return `${day} ${monthName}, ${time}`;
  }
  return `${day} ${monthName} ${year}, ${time}`;
}

/** Backward-compat алиасы — все указывают на единый формат. */
export const formatRelativeYek = formatFullYek;
export const formatChatListTimeYek = formatFullYek;
export const formatDateTimeYek = formatFullYek;

/**
 * `true` если с момента `raw` прошло больше `hours` часов (по Yek-calendar
 * это эквивалентно сравнению UTC-моментов, потому что server даёт Yek local).
 */
export function isOlderThanHours(raw: string | undefined | null, hours: number): boolean {
  const d = parseServerDate(raw);
  if (!d) return false;
  return Date.now() - d.getTime() > hours * 3600 * 1000;
}

// ── private ───────────────────────────────────────────────────────────────

/** Календарный день Yek (для diff в днях между датами). */
function yekDayKey(d: Date): number {
  return Math.floor((d.getTime() + YEK_OFFSET_MS) / DAY_MS);
}

/** Day/month/year в Yek calendar — для рендера дат на русском без Intl-locale-specific формата. */
function yekParts(d: Date): { day: number; month: number; year: number } {
  const shifted = new Date(d.getTime() + YEK_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    year: shifted.getUTCFullYear(),
  };
}
