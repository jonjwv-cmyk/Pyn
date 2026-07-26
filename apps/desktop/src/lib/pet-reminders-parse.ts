/**
 * Парсер «напомни …» для чата питомца.
 * Время — день смены, зона Asia/Yekaterinburg (UTC+5, без DST).
 *
 * Важно: JS `\b` — только ASCII [A-Za-z0-9_]. Кириллица считается non-word,
 * поэтому границы слов здесь через `\p{L}` / `\p{N}` (флаг `u`).
 */

export type ReminderParseOk = {
  kind: 'ok';
  body: string;
  fireAt: Date;
  whenLabel: string;
};

export type ReminderParseResult =
  | ReminderParseOk
  | {
      kind: 'need_weekday_confirm';
      body: string;
      weekday: number;
      weekdayRu: string;
      hour: number;
      minute: number;
    }
  | { kind: 'need_time'; body: string; dayHint: string }
  | { kind: 'not_reminder' }
  | { kind: 'error'; message: string };

/** Конец «слова» с учётом кириллицы (вместо \b). */
const WE = String.raw`(?![\p{L}\p{N}_])`;
/** Начало «слова» с учётом кириллицы. */
const WB = String.raw`(?<![\p{L}\p{N}_])`;

const WEEKDAYS: { re: RegExp; dow: number; ru: string }[] = [
  { re: new RegExp(`${WB}(?:в\\s+)?понедельник${WE}`, 'iu'), dow: 1, ru: 'понедельник' },
  { re: new RegExp(`${WB}(?:во?\\s+)?вторник${WE}`, 'iu'), dow: 2, ru: 'вторник' },
  { re: new RegExp(`${WB}(?:в\\s+)?сред[ауые]?${WE}`, 'iu'), dow: 3, ru: 'среду' },
  { re: new RegExp(`${WB}(?:в\\s+)?четверг${WE}`, 'iu'), dow: 4, ru: 'четверг' },
  { re: new RegExp(`${WB}(?:в\\s+)?пятниц[уеыа]?${WE}`, 'iu'), dow: 5, ru: 'пятницу' },
  { re: new RegExp(`${WB}(?:в\\s+)?суббот[уеыа]?${WE}`, 'iu'), dow: 6, ru: 'субботу' },
  { re: new RegExp(`${WB}(?:в\\s+)?воскресень[еяю]?${WE}`, 'iu'), dow: 0, ru: 'воскресенье' },
];

const HOUR_WORDS: { re: RegExp; hour: number; minute: number }[] = [
  { re: new RegExp(`${WB}(?:к|в)\\s+час(?:у|а)?(?:\\s+дня)?${WE}`, 'iu'), hour: 13, minute: 0 },
  { re: new RegExp(`${WB}пол\\s*первого${WE}`, 'iu'), hour: 12, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*второго${WE}`, 'iu'), hour: 13, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*третьего${WE}`, 'iu'), hour: 14, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*четв[её]ртого${WE}`, 'iu'), hour: 15, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*пятого${WE}`, 'iu'), hour: 16, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*шестого${WE}`, 'iu'), hour: 17, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*седьмого${WE}`, 'iu'), hour: 18, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*восьмого${WE}`, 'iu'), hour: 8, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*девятого${WE}`, 'iu'), hour: 9, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*десятого${WE}`, 'iu'), hour: 10, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*одиннадцатого${WE}`, 'iu'), hour: 11, minute: 30 },
  { re: new RegExp(`${WB}пол\\s*двенадцатого${WE}`, 'iu'), hour: 12, minute: 30 },
  { re: new RegExp(`${WB}(?:к|в)\\s+двум${WE}`, 'iu'), hour: 14, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+тр[её]м${WE}`, 'iu'), hour: 15, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+четыр[её]м${WE}`, 'iu'), hour: 16, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+пяти${WE}`, 'iu'), hour: 17, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+шести${WE}`, 'iu'), hour: 18, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+семи${WE}`, 'iu'), hour: 19, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+восьми${WE}`, 'iu'), hour: 8, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+девяти${WE}`, 'iu'), hour: 9, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+десяти${WE}`, 'iu'), hour: 10, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+одиннадцати${WE}`, 'iu'), hour: 11, minute: 0 },
  { re: new RegExp(`${WB}(?:к|в)\\s+двенадцати${WE}`, 'iu'), hour: 12, minute: 0 },
  { re: new RegExp(`${WB}в\\s+час${WE}`, 'iu'), hour: 13, minute: 0 },
  { re: new RegExp(`${WB}в\\s+два${WE}`, 'iu'), hour: 14, minute: 0 },
  { re: new RegExp(`${WB}в\\s+три${WE}`, 'iu'), hour: 15, minute: 0 },
  { re: new RegExp(`${WB}в\\s+четыре${WE}`, 'iu'), hour: 16, minute: 0 },
  { re: new RegExp(`${WB}в\\s+пять${WE}`, 'iu'), hour: 17, minute: 0 },
  { re: new RegExp(`${WB}в\\s+шесть${WE}`, 'iu'), hour: 18, minute: 0 },
  { re: new RegExp(`${WB}в\\s+семь${WE}`, 'iu'), hour: 19, minute: 0 },
  { re: new RegExp(`${WB}в\\s+восемь${WE}`, 'iu'), hour: 8, minute: 0 },
  { re: new RegExp(`${WB}в\\s+девять${WE}`, 'iu'), hour: 9, minute: 0 },
  { re: new RegExp(`${WB}в\\s+десять${WE}`, 'iu'), hour: 10, minute: 0 },
  { re: new RegExp(`${WB}в\\s+одиннадцать${WE}`, 'iu'), hour: 11, minute: 0 },
  { re: new RegExp(`${WB}в\\s+двенадцать${WE}`, 'iu'), hour: 12, minute: 0 },
];

const REMIND_HEAD = new RegExp(
  `^(?:пожалуйста[,.]?\\s*)?(?:напомни(?:ть)?|напоминание|reminder)${WE}[:\\s,]*`,
  'iu',
);

const REMIND_ANY = new RegExp(
  `(?:^|[^\\p{L}\\p{N}_])(?:напомни(?:ть)?|напоминание|reminder)${WE}`,
  'iu',
);

export function looksLikeReminder(text: string): boolean {
  const t = text.trim();
  return REMIND_HEAD.test(t) || REMIND_ANY.test(t);
}

export function parseWeekdayConfirm(text: string): 'today' | 'next' | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (new RegExp(`^(сегодня|на\\s*сегодня|этот|эту|текущ|да|1)${WE}`, 'iu').test(t)) {
    return 'today';
  }
  if (
    new RegExp(`^(следующ|на\\s*следующ|через\\s*недел|недел|потом|2)${WE}`, 'iu').test(t) ||
    new RegExp(`${WB}следующ`, 'iu').test(t)
  ) {
    return 'next';
  }
  return null;
}

function yekParts(now = Date.now()): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')),
    min: Number(get('minute')),
    dow: map[get('weekday')] ?? 0,
  };
}

export function yekWallToDate(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 5, min, 0));
}

function addDaysYmd(y: number, m: number, d: number, delta: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

export function formatWhenLabel(fire: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fire);
}

type TimeHit = {
  hour: number;
  minute: number;
  rest: string;
  relativeMs?: number;
};

/** «утра / дня / вечера / ночи» → 24h. */
function applyDayPart(hour: number, ctx: string): number {
  const c = ctx.toLowerCase();
  if (/вечер/.test(c)) {
    if (hour >= 1 && hour <= 11) return hour + 12;
    return hour;
  }
  if (/(?:^|[\s,])дн[ея]м?(?:$|[\s,])/.test(c) || /\sдня(?:$|[\s,])/.test(c)) {
    if (hour >= 1 && hour <= 11) return hour + 12;
    return hour;
  }
  if (/утр/.test(c)) {
    if (hour === 12) return 0;
    return hour;
  }
  if (/ноч/.test(c)) {
    if (hour === 12) return 0;
    return hour;
  }
  return hour;
}

function stripDayPart(s: string): string {
  return s
    .replace(new RegExp(`${WB}(?:утра|утром|вечера|вечером|ночи|ночью|днём|днем|дня)${WE}`, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTime(s: string): TimeHit | null {
  // «в 6:30» / «в 6.30» / «в 6-30» / «в 6 30»
  let m = s.match(
    new RegExp(`(?:^|[\\s,])(?:в|к)?\\s*(\\d{1,2})[:.\\-\\s](\\d{2})${WE}`, 'iu'),
  );
  if (m) {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      hour = applyDayPart(hour, s);
      return { hour, minute, rest: stripDayPart(s.replace(m[0], ' ')) };
    }
  }
  // «в 18» / «к 9» / «в 6 ч»
  m = s.match(
    new RegExp(`(?:^|[\\s,])(?:в|к)\\s*(\\d{1,2})\\s*(?:ч(?:ас(?:а|ов)?)?)?${WE}`, 'iu'),
  );
  if (m) {
    let hour = Number(m[1]);
    if (hour >= 0 && hour <= 23) {
      hour = applyDayPart(hour, s);
      return { hour, minute: 0, rest: stripDayPart(s.replace(m[0], ' ')) };
    }
  }
  for (const w of HOUR_WORDS) {
    if (w.re.test(s)) {
      let hour = applyDayPart(w.hour, s);
      return { hour, minute: w.minute, rest: stripDayPart(s.replace(w.re, ' ')) };
    }
  }
  m = s.match(
    new RegExp(`${WB}через\\s+(\\d{1,3})\\s*(мин(?:ут[уы]?)?|час(?:а|ов)?|ч)${WE}`, 'iu'),
  );
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    const relativeMs =
      /час|^ч$/i.test(unit) && !/мин/.test(unit) ? n * 3600_000 : n * 60_000;
    const fire = new Date(Date.now() + relativeMs);
    const p = yekParts(fire.getTime());
    return {
      hour: p.h,
      minute: p.min,
      rest: s.replace(m[0], ' '),
      relativeMs,
    };
  }
  return null;
}

function stripNoise(s: string): string {
  return s
    .replace(REMIND_HEAD, '')
    .replace(new RegExp(`${WB}пожалуйста${WE}`, 'giu'), ' ')
    .replace(new RegExp(`${WB}мне${WE}`, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanBody(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;—\-]+|[\s,.:;—\-]+$/g, '')
    .replace(new RegExp(`${WB}(?:на|в|ко?)${WE}\\s*$`, 'iu'), '')
    .trim();
}

function buildFire(
  dayOffset: number,
  hour: number,
  minute: number,
  now = Date.now(),
): Date {
  const p = yekParts(now);
  const base = addDaysYmd(p.y, p.m, p.d, dayOffset);
  return yekWallToDate(base.y, base.m, base.d, hour, minute);
}

export function parseReminderText(
  raw: string,
  opts?: { weekdayPrefer?: 'today' | 'next'; now?: number },
): ReminderParseResult {
  const now = opts?.now ?? Date.now();
  const text = raw.trim();
  if (!looksLikeReminder(text) && opts?.weekdayPrefer == null) {
    return { kind: 'not_reminder' };
  }

  let s = stripNoise(text);
  let dayOffset: number | null = null;
  let weekdayHit: { dow: number; ru: string } | null = null;

  if (new RegExp(`${WB}послезавтра${WE}`, 'iu').test(s)) {
    dayOffset = 2;
    s = s.replace(new RegExp(`${WB}послезавтра${WE}`, 'iu'), ' ');
  } else if (new RegExp(`${WB}завтра${WE}`, 'iu').test(s)) {
    dayOffset = 1;
    s = s.replace(new RegExp(`${WB}завтра${WE}`, 'iu'), ' ');
  } else if (new RegExp(`${WB}сегодня${WE}`, 'iu').test(s)) {
    dayOffset = 0;
    s = s.replace(new RegExp(`${WB}сегодня${WE}`, 'iu'), ' ');
  }

  for (const w of WEEKDAYS) {
    if (w.re.test(s)) {
      weekdayHit = { dow: w.dow, ru: w.ru };
      s = s.replace(w.re, ' ');
      break;
    }
  }

  const timeHit = extractTime(s);
  if (timeHit?.relativeMs != null) {
    const fireAt = new Date(now + timeHit.relativeMs);
    const body = cleanBody(timeHit.rest);
    if (!body) {
      return { kind: 'error', message: 'Что напомнить? Напиши текст после «напомни».' };
    }
    return { kind: 'ok', body, fireAt, whenLabel: formatWhenLabel(fireAt) };
  }

  const hour = timeHit?.hour ?? 9;
  const minute = timeHit?.minute ?? 0;
  if (timeHit) s = timeHit.rest;
  const body = cleanBody(s);

  if (!body) {
    return {
      kind: 'error',
      message: 'Что напомнить? Например: «напомни созвон в 14:00».',
    };
  }

  if (!timeHit && dayOffset == null && !weekdayHit) {
    return { kind: 'need_time', body, dayHint: 'сегодня' };
  }

  if (weekdayHit) {
    const p = yekParts(now);
    if (weekdayHit.dow === p.dow && opts?.weekdayPrefer == null && dayOffset == null) {
      return {
        kind: 'need_weekday_confirm',
        body,
        weekday: weekdayHit.dow,
        weekdayRu: weekdayHit.ru,
        hour: timeHit ? hour : 9,
        minute: timeHit ? minute : 0,
      };
    }
    if (opts?.weekdayPrefer === 'next') {
      dayOffset = weekdayHit.dow === p.dow ? 7 : ((weekdayHit.dow - p.dow + 7) % 7) + 7;
    } else if (opts?.weekdayPrefer === 'today') {
      dayOffset = 0;
    } else {
      // future weekday this week (or today if later)
      dayOffset = (weekdayHit.dow - p.dow + 7) % 7;
      if (dayOffset === 0) dayOffset = 7;
    }
  }

  if (dayOffset == null) dayOffset = 0;

  let fireAt = buildFire(dayOffset, hour, minute, now);
  if (fireAt.getTime() <= now + 30_000) {
    // сегодня время прошло → +1 день (или +7 если зафиксирован weekday today past)
    fireAt = buildFire(dayOffset + (weekdayHit && opts?.weekdayPrefer === 'today' ? 7 : 1), hour, minute, now);
  }

  return {
    kind: 'ok',
    body,
    fireAt,
    whenLabel: formatWhenLabel(fireAt),
  };
}

export function completeWeekdayConfirm(
  pending: Extract<ReminderParseResult, { kind: 'need_weekday_confirm' }>,
  prefer: 'today' | 'next',
  now = Date.now(),
): ReminderParseOk {
  const p = yekParts(now);
  let dayOffset: number;
  if (prefer === 'today') {
    dayOffset = 0;
  } else {
    dayOffset = pending.weekday === p.dow ? 7 : ((pending.weekday - p.dow + 7) % 7) + 7;
  }
  let fireAt = buildFire(dayOffset, pending.hour, pending.minute, now);
  if (fireAt.getTime() <= now + 30_000) {
    fireAt = buildFire(prefer === 'today' ? 7 : dayOffset + 7, pending.hour, pending.minute, now);
  }
  return {
    kind: 'ok',
    body: pending.body,
    fireAt,
    whenLabel: formatWhenLabel(fireAt),
  };
}
