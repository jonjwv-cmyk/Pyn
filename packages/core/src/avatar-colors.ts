/**
 * Палитра фоновых цветов аватарки-кружка (когда нет фото — рендерим инициалы
 * на этом фоне). 1:1 с Kotlin `core/theme/Color.kt::AvatarColors` — поэтому
 * один и тот же юзер выглядит одинаково на любой платформе (Android, iOS, Pyn).
 *
 * Алгоритм маппинга `login → color` тоже зеркалит Kotlin:
 *   • Аккумулятор стартует с 7
 *   • Для каждого char: acc = acc * 31 + charCode
 *   • Final: abs(acc) mod palette.size
 *   • Используется raw login — без trim/lowercase
 *
 * Чисто client-side — сервер не знает про эти цвета.
 */
export const AVATAR_COLORS = [
  '#5B6ABF', // indigo
  '#B5577A', // rose
  '#2E9E8F', // teal
  '#CF8E3E', // amber
  '#7E5EC2', // violet
  '#2E96B4', // cyan
  '#5A8C3E', // sage
  '#B85C3B', // terracotta
] as const;

/**
 * Детерминированный цвет для login'a. Тот же login на любом устройстве даёт
 * тот же цвет (consistent UX через platforms).
 */
export function avatarColorForLogin(login: string): string {
  let hash = 7;
  for (let i = 0; i < login.length; i++) {
    // | 0 чтобы JS-арифметика оставалась 32-bit signed как в Kotlin Int.
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  // `as` — TS narrow что index в bounds; AVATAR_COLORS уже non-empty.
  return AVATAR_COLORS[index] as string;
}
