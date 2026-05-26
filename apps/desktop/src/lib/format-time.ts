/**
 * Унифицированный формат времени по Екатеринбургу в 12-часовой нотации.
 *
 * §pyn-1.2.36 — Pyn-сервер (Cloudflare D1) пишет timestamps через
 * `datetime('now')` — это **UTC**. Раньше код предполагал что это Yek-локальное
 * время (legacy assumption от OTLHelper2) и делал `-5h` shift → все даты в UI
 * были на 5 часов в прошлом. Подтверждено логом: server отдаёт
 * `created_at:"2026-05-23 17:29:41"` + `yek_hm:"22:59"` — значит 17:29 = UTC,
 * Yek = 22:29. Сейчас parseServerDate интерпретирует строку как UTC напрямую,
 * Intl.DateTimeFormat с `timeZone: 'Asia/Yekaterinburg'` рендерит правильное
 * локальное время Yek.
 *
 * Все user-facing timestamps в Pyn проходят через эти helper'ы — UI везде
 * показывает "10:11 AM" / "16.05 2:34 PM" / "сегодня в 11:00 AM" в одной
 * timezone независимо от того где запущен Pyn.
 *
 * Локализация: месяцы / дни недели / "Сегодня"/"Вчера" / единицы длительности
 * берутся через `i18next.t()`. Caller-компоненты подписаны на change-language
 * через useTranslation() — rerender автоматически пересчитывает форматы.
 */

import i18next from 'i18next';

const YEK_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// §pyn-1.2.23 — formatters per-language, не hardcoded. Раньше TIME=en-US,
// SHORT_DATE=ru-RU висели как module-level const → не реагировали на смену
// языка. Юзер видел mix: «16 мая, 8:52 AM» вместо «May 16, 8:52 AM» в EN UI.
// Cache per language чтобы не создавать formatter на каждом вызове.
const _timeCache = new Map<string, Intl.DateTimeFormat>();
const _shortDateCache = new Map<string, Intl.DateTimeFormat>();

function currentLang(): string {
  return i18next.language || 'en-US';
}

function timeFormatter(): Intl.DateTimeFormat {
  const lang = currentLang();
  let f = _timeCache.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Yekaterinburg',
    });
    _timeCache.set(lang, f);
  }
  return f;
}

function shortDateFormatter(): Intl.DateTimeFormat {
  const lang = currentLang();
  let f = _shortDateCache.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Yekaterinburg',
    });
    _shortDateCache.set(lang, f);
  }
  return f;
}

const MONTH_GEN_KEYS = [
  'news_schedule_dialog.month_gen_jan', 'news_schedule_dialog.month_gen_feb',
  'news_schedule_dialog.month_gen_mar', 'news_schedule_dialog.month_gen_apr',
  'news_schedule_dialog.month_gen_may', 'news_schedule_dialog.month_gen_jun',
  'news_schedule_dialog.month_gen_jul', 'news_schedule_dialog.month_gen_aug',
  'news_schedule_dialog.month_gen_sep', 'news_schedule_dialog.month_gen_oct',
  'news_schedule_dialog.month_gen_nov', 'news_schedule_dialog.month_gen_dec',
];

const WEEKDAY_KEYS = [
  'format_time.weekday_sun', 'format_time.weekday_mon', 'format_time.weekday_tue',
  'format_time.weekday_wed', 'format_time.weekday_thu', 'format_time.weekday_fri',
  'format_time.weekday_sat',
];

function monthGen(idx: number): string {
  const key = MONTH_GEN_KEYS[idx];
  return key ? i18next.t(key) : '';
}

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
  // §pyn-1.2.36 — server (D1 SQLite datetime('now')) даёт UTC. Никакого shift.
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/** Время "10:11 AM" в Yek TZ, в 12-часовом формате. */
export function formatTimeYek(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  return d ? timeFormatter().format(d) : (raw ?? '');
}

/**
 * Короткая дата "16.05" в Yek TZ (для chat list rows, news date).
 */
export function formatShortDateYek(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  return d ? shortDateFormatter().format(d) : (raw ?? '');
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
  const monthName = monthGen(month);
  const time = timeFormatter().format(d);
  const nowYear = yekParts(new Date()).year;
  if (year === nowYear) {
    return `${day} ${monthName}, ${time}`;
  }
  return `${day} ${monthName} ${year}, ${time}`;
}

/**
 * То же что `formatFullYek`, но принимает уже распарсенный `Date` (а не
 * сырую серверную строку). Используется когда у нас на руках уже `Date`
 * (например, scheduled publication picker отдаёт `Date`, не строку).
 */
export function formatDateFullYek(d: Date): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const { day, month, year } = yekParts(d);
  const monthName = monthGen(month);
  const time = timeFormatter().format(d);
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

// ── Day grouping helpers (для date-разделителей в чате и ленте) ───────────

/**
 * Уникальный integer-ключ дня в Yek-календаре для сообщения. Сообщения с
 * одинаковым ключом — в одной "пачке" под одним date-разделителем.
 * Возвращает `null` если raw не парсится.
 */
export function yekDayKeyFor(raw: string | undefined | null): number | null {
  const d = parseServerDate(raw);
  if (!d) return null;
  return yekDayKey(d);
}

/**
 * Метка для date-разделителя в чате/ленте:
 *   • Сегодня
 *   • Вчера
 *   • Прошедшие 6 дней → название дня недели ("Понедельник")
 *   • В этом году → "5 мая"
 *   • Раньше → "5 мая 2025"
 *
 * Используется и как inline-divider, и как floating sticky pill при scroll'е.
 */
export function formatDayDividerLabel(raw: string | undefined | null): string {
  const d = parseServerDate(raw);
  if (!d) return '';
  const dayKey = yekDayKey(d);
  const todayKey = yekDayKey(new Date());
  const diff = todayKey - dayKey;
  if (diff === 0) return i18next.t('format_time.today');
  if (diff === 1) return i18next.t('format_time.yesterday');
  if (diff >= 2 && diff < 7) {
    const shifted = new Date(d.getTime() + YEK_OFFSET_MS);
    const key = WEEKDAY_KEYS[shifted.getUTCDay()];
    return key ? i18next.t(key) : '';
  }
  const { day, month, year } = yekParts(d);
  const monthName = monthGen(month);
  const nowYear = yekParts(new Date()).year;
  if (year === nowYear) return `${day} ${monthName}`;
  return `${day} ${monthName} ${year}`;
}

/**
 * Длительность в формате "1ч 23м 45с" / "23м 45с" / "45с" — для счётчиков
 * сессии/таймеров. Часы/минуты опускаются если равны нулю. Tabular-nums на
 * UI стороне держит ширину неизменной при тике.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hU = i18next.t('format_time.duration_h');
  const mU = i18next.t('format_time.duration_m');
  const sU = i18next.t('format_time.duration_s');
  if (h > 0) return `${h}${hU} ${pad2(m)}${mU} ${pad2(s)}${sU}`;
  if (m > 0) return `${m}${mU} ${pad2(s)}${sU}`;
  return `${s}${sU}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

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
