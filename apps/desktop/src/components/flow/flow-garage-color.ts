// ============================================================
// flow-garage-color.ts — стабильный «свой» цвет машины по гаражному № (юзер 2026-07-03).
// ============================================================
// В Отчёте при статусе «ожидание» каждая машина (гаражный) красит свои строки своим
// ненавязчивым пастельным тоном — так глазами группируются машины при раскидке.
// «Выполнено» остаётся зелёным, причины — серыми (это приоритетнее цвета машины).
// Тот же цвет уходит в xlsx кладовщикам («скачаем кладовщикам вместе с цветом»).

/** Детерминированный оттенок 0..359 по гаражному номеру (FNV-1a, шаг по золотому углу). */
function garageHue(id: string): number {
  let h = 0x811c9dc5;
  const s = id.trim().toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Золотой угол разводит соседние номера (7.1 / 7.2) по разным частям круга.
  return Math.abs(Math.imul(h >>> 0, 2654435761)) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Пастельная заливка строки грида: css-цвет (светлый, текст остаётся тёмным). */
export function garageRowColor(id: string): string {
  const g = id.trim();
  if (!g) return '';
  return `hsl(${garageHue(g)} 52% 93%)`;
}

/** Тот же тон для Excel: ARGB `FFRRGGBB` (заливка строк кладовщикам). */
export function garageFillArgb(id: string): string {
  const g = id.trim();
  if (!g) return '';
  const [r, gg, b] = hslToRgb(garageHue(g), 0.52, 0.93);
  const hex = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `FF${hex(r)}${hex(gg)}${hex(b)}`;
}
