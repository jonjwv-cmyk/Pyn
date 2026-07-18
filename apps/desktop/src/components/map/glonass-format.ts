/**
 * Форматы подписей Глонасс (ТЗ 17.07 п.10 + уточнение 2026-07-18):
 *
 * Список машин (не история):
 *   «Х 905 КВ КамАЗ»  — гос с пробелами + марка после; статус = кружок + скорость.
 *
 * История (выбор машины):
 *   пилюля статуса · гаражный · гос · тип ТС · марка · водитель (сегодня из Транспорта).
 */

/** Латиница-двойники букв РФ-номеров → кириллица (Глонасс часто отдаёт латиницу). */
const PLATE_LAT_TO_CYR: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О',
  P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
};

function plateUpper(raw: string): string {
  return String(raw || '')
    .trim()
    .toLocaleUpperCase('ru-RU')
    .replace(/Ё/g, 'Е');
}

/** Сжать и привести буквы номера к кириллице. */
export function normalizePlateCompact(raw: string): string {
  const upper = plateUpper(raw).replace(/\s+/g, '');
  let out = '';
  for (const ch of upper) {
    out += PLATE_LAT_TO_CYR[ch] ?? ch;
  }
  return out;
}

/**
 * Госномер → «Х 905 КВ» / «А 982 НК 96».
 * Всегда разделяет буквы и цифры; латиницу-двойники приводит к кириллице.
 */
export function formatGosPlate(raw: string): string {
  const compact = normalizePlateCompact(raw);
  if (!compact) return '';

  // Стандарт РФ: L DDD LL [RR]
  const m = /^([А-ЯA-Z])(\d{3})([А-ЯA-Z]{2})(\d{2,3})?$/.exec(compact);
  if (m) {
    const base = `${m[1]} ${m[2]} ${m[3]}`;
    return m[4] ? `${base} ${m[4]}` : base;
  }

  // Fallback: вставить пробел на каждой границе буква↔цифра.
  return compact
    .replace(/([А-ЯA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([А-ЯA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Список машин: «Х 905 КВ КамАЗ» (гос + марка после). */
export function formatGlonassListTitle(parts: {
  gos?: string;
  brand?: string;
  fallbackName?: string;
}): string {
  const gos = formatGosPlate(parts.gos || '') || String(parts.gos || '').trim();
  const brand = String(parts.brand || '').trim();
  if (gos && brand) return `${gos} ${brand}`;
  if (gos) return gos;
  if (brand) return brand;
  return String(parts.fallbackName || '').trim() || '—';
}

/**
 * История — текстовая часть после пилюли статуса:
 * `398 | Х 905 КВ | Пульман 9м | КамАЗ | Тимофеев …`
 */
export function formatGlonassHistoryLine(parts: {
  garage?: string;
  gos?: string;
  vehicleType?: string;
  brand?: string;
  driver?: string;
  fallbackName?: string;
}): string {
  const garage = String(parts.garage || '').trim();
  const gos = formatGosPlate(parts.gos || '') || String(parts.gos || '').trim();
  const vtype = String(parts.vehicleType || '').trim();
  const brand = String(parts.brand || '').trim();
  const driver = String(parts.driver || '').trim();
  const chunks = [garage, gos, vtype, brand, driver].filter(Boolean);
  if (chunks.length > 0) return chunks.join(' | ');
  return String(parts.fallbackName || 'машина').trim() || 'машина';
}

/** @deprecated use formatGlonassHistoryLine */
export function formatGlonassPickLine(parts: {
  garage?: string;
  gos?: string;
  vehicleType?: string;
  brand?: string;
  driver?: string;
  fallbackName?: string;
}): string {
  return formatGlonassHistoryLine(parts);
}

/** Сегодня YYYY-MM-DD по Екатеринбургу (как на сервере Транспорта). */
export function todayYmdYekaterinburg(now = new Date()): string {
  // Asia/Yekaterinburg = UTC+5 без DST
  const ms = now.getTime() + 5 * 60 * 60 * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTH_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
] as const;

/**
 * Чип истории на карте: `401 июль 19` или `401 июль 19 2025`,
 * если год отличается от текущего.
 */
export function formatHistoryChipTitle(
  garage: string,
  dayYmdOrIso: string,
  now = new Date(),
): string {
  const g = String(garage || '').trim() || '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayYmdOrIso || '').slice(0, 10));
  let y: number;
  let mo: number;
  let d: number;
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else {
    const dt = new Date(dayYmdOrIso);
    if (!Number.isFinite(dt.getTime())) return g;
    y = dt.getFullYear();
    mo = dt.getMonth() + 1;
    d = dt.getDate();
  }
  const month = MONTH_RU[mo - 1] ?? '';
  const curY = now.getFullYear();
  if (y !== curY) return `${g} ${month} ${d} ${y}`.trim();
  return `${g} ${month} ${d}`.trim();
}
