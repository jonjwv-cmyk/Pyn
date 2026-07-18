/**
 * Формат строки выбора Глонасс (ТЗ 17.07 п.10):
 * `398 | Х 905 КВ | Пульман 9м | Тимофеев Александр Борисович`
 * (гаражный · гос «А 982 НК» · тип ТС · водитель на ТЕКУЩИЙ день из Транспорта).
 */

/** Госномер → «Х 905 КВ» / «А 982 НК 96» (буквы-цифры-буквы, пробелы). */
export function formatGosPlate(raw: string): string {
  const compact = String(raw || '')
    .trim()
    .toLocaleUpperCase('ru-RU')
    .replace(/\s+/g, '')
    .replace(/Ё/g, 'Е');
  if (!compact) return '';
  // A123BC96 / A123BC / A123BC196
  const m = /^([A-ZА-Я])(\d{3})([A-ZА-Я]{2})(\d{2,3})?$/.exec(compact);
  if (!m) {
    // уже с пробелами — нормализуем кратно
    const spaced = String(raw || '').trim().replace(/\s+/g, ' ');
    return spaced;
  }
  const base = `${m[1]} ${m[2]} ${m[3]}`;
  return m[4] ? `${base} ${m[4]}` : base;
}

/** Сборка подписи: гар. | гос | тип | водитель(если есть). */
export function formatGlonassPickLine(parts: {
  garage?: string;
  gos?: string;
  vehicleType?: string;
  driver?: string;
  fallbackName?: string;
}): string {
  const garage = String(parts.garage || '').trim();
  const gos = formatGosPlate(parts.gos || '') || String(parts.gos || '').trim();
  const vtype = String(parts.vehicleType || '').trim();
  const driver = String(parts.driver || '').trim();
  const chunks = [garage, gos, vtype, driver].filter(Boolean);
  if (chunks.length > 0) return chunks.join(' | ');
  return String(parts.fallbackName || 'машина').trim() || 'машина';
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
