import i18next from 'i18next';

const MONTH_GEN_KEYS = [
  'news_schedule_dialog.month_gen_jan',
  'news_schedule_dialog.month_gen_feb',
  'news_schedule_dialog.month_gen_mar',
  'news_schedule_dialog.month_gen_apr',
  'news_schedule_dialog.month_gen_may',
  'news_schedule_dialog.month_gen_jun',
  'news_schedule_dialog.month_gen_jul',
  'news_schedule_dialog.month_gen_aug',
  'news_schedule_dialog.month_gen_sep',
  'news_schedule_dialog.month_gen_oct',
  'news_schedule_dialog.month_gen_nov',
  'news_schedule_dialog.month_gen_dec',
];

const WEEKDAY_KEYS = [
  'format_time.weekday_sun',
  'format_time.weekday_mon',
  'format_time.weekday_tue',
  'format_time.weekday_wed',
  'format_time.weekday_thu',
  'format_time.weekday_fri',
  'format_time.weekday_sat',
];

/**
 * Human-friendly relative date для файлов (Linear-style + i18n).
 * Использует уже существующие ключи `news_schedule_dialog.month_gen_*` (родительный
 * падеж месяцев) и `format_time.weekday_*` — нет нужды дублировать переводы.
 */
export function formatFsTime(mtimeMs: number): string {
  const now = Date.now();
  const diffMs = now - mtimeMs;
  const date = new Date(mtimeMs);
  const t = i18next.t.bind(i18next);

  if (diffMs < 60_000) {
    return t('storage.time.just_now');
  }

  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return t('storage.time.minutes_ago', { count: mins });
  }

  // §pyn-1.2.21 — AM/PM формат вместо 24h (юзер: «формат времени файлов
  // показываем в am pm а не 24 часовом»). 12-часовая шкала: 0 → 12 AM,
  // 1..11 → AM, 12 → 12 PM, 13..23 → PM.
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const isPM = hours24 >= 12;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const ampm = isPM ? t('storage.format_pm') : t('storage.format_am');
  const timeStr = `${hours12}:${minutes} ${ampm}`;

  const nowDate = new Date(now);
  const isSameDay =
    date.getFullYear() === nowDate.getFullYear()
    && date.getMonth() === nowDate.getMonth()
    && date.getDate() === nowDate.getDate();
  if (isSameDay) {
    return t('storage.time.today_at', { time: timeStr });
  }

  const yesterday = new Date(now - 24 * 3_600_000);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return t('storage.time.yesterday_at', { time: timeStr });
  }

  if (diffMs < 7 * 24 * 3_600_000) {
    const dayKey = WEEKDAY_KEYS[date.getDay()];
    const dayLabel = dayKey ? t(dayKey) : '';
    return t('storage.time.weekday_at', { day: dayLabel, time: timeStr });
  }

  const monthKey = MONTH_GEN_KEYS[date.getMonth()];
  const monthLabel = monthKey ? t(monthKey) : '';
  const day = date.getDate();
  const year = date.getFullYear();
  const sameYear = year === nowDate.getFullYear();

  if (sameYear) {
    return t('storage.time.date_no_year', { day, month: monthLabel });
  }
  return t('storage.time.date_with_year', { day, month: monthLabel, year });
}

export function formatFsSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const formatted = i === 0 ? value.toFixed(0) : value < 10 ? value.toFixed(1) : value.toFixed(0);
  return `${formatted} ${units[i]}`;
}
