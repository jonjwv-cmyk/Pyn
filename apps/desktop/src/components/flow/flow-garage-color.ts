// ============================================================
// flow-garage-color.ts — «свой» цвет машины по гаражному № (юзер 2026-07-03/04).
// ============================================================
// В Отчёте при статусе «ожидание» каждая машина (гаражный) красит свои строки своим
// тоном — так глазами группируются машины при раскидке. «Выполнено» остаётся зелёным,
// причины — серыми (это приоритетнее цвета машины). Тот же цвет уходит в xlsx.
//
// Юзер 2026-07-04: цвета — ИЗ ОДНОЙ ПАЛИТРЫ с кистью-«Заливкой» (10 контрастных
// пастелей), а не hsl-градус (363 и 331 выглядели одинаково). Один гаражный → всегда
// один и тот же цвет; соседние номера разводим хэшем (363→5, 331→8, 7.1→7, 7.2→2).
// Коллизию двух машин в один цвет всегда можно перебить кистью (row_fill приоритетнее).

/** Единая палитра заливок «Потока»: кисть в Отчёте + авто-цвет машин (RRGGBB без #).
 *  ≥20 контрастных пастелей (юзер 2026-07-28, задача 23): чтобы каждый гаражный (и пара
 *  машин) получал свой цвет без коллизий в пределах дня. */
export const FLOW_FILL_PALETTE = [
  'F5A3A3', 'FFBE7A', 'F5DE5A', '9FDD8C', '7ED4C0',
  '8FC1F7', 'B79BF0', 'F191D3', 'C9C9C2', 'D9A98C',
  'F5C0A3', 'BFE89A', 'A3B8F5', 'E0A3E8', 'F0E19A',
  'A3E8C6', 'CBB3F5', 'F5A3CE', 'A3D4E8', 'D4B89A',
] as const;

/**
 * Ключ цвета по набору машин строки: гаражные номера строки (может быть несколько через
 * `\n`/`;`) → нормализованный ключ (trim, сорт, `|`). Две машины на строке → СВОЙ ключ,
 * отличный от каждой машины по отдельности (юзер 2026-07-28, задача 23). Пусто → ''.
 */
export function garageColorKey(rideId: string): string {
  const parts = String(rideId ?? '')
    .split(/[\n;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) return '';
  return [...new Set(parts)].sort().join('|');
}

/** Детерминированный индекс палитры по ключу (FNV-1a + золотое сечение). */
function paletteIndex(id: string): number {
  let h = 0x811c9dc5;
  const s = id.trim().toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(Math.imul(h >>> 0, 2654435761)) % FLOW_FILL_PALETTE.length;
}

/** Мягкий тон для ФОНА строки В ПРИЛОЖЕНИИ: тот же цвет, разбавленный к белому —
 *  чтобы пиллы МОЛ/экспедиторов не сливались с заливкой (юзер 2026-07-05: «мягче,
 *  но заметнее»). В xlsx уходит ПОЛНЫЙ цвет палитры (там пиллов нет). */
export function softenRowFill(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1] ?? '0', 16);
  const mix = (c: number): number => Math.round(c + (255 - c) * 0.45);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/** Пастельная заливка строки грида: css-цвет (смягчённый, текст остаётся тёмным). */
export function garageRowColor(id: string): string {
  const g = id.trim();
  if (!g) return '';
  return softenRowFill(`#${FLOW_FILL_PALETTE[paletteIndex(g)]}`);
}

/** Тот же тон для Excel: ARGB `FFRRGGBB` (заливка строк кладовщикам). */
export function garageFillArgb(id: string): string {
  const g = id.trim();
  if (!g) return '';
  return `FF${FLOW_FILL_PALETTE[paletteIndex(g)]}`;
}
