/** Число встроенных дефолтных аватарок (desktop bundle). */
export const DEFAULT_AVATAR_COUNT = 12;

/**
 * Детерминированный индекс аватарки по login (тот же алгоритм что avatarColorForLogin).
 * Один login → одна и та же картинка на всех устройствах, без рандома.
 */
export function defaultAvatarIndex(login: string): number {
  let hash = 7;
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % DEFAULT_AVATAR_COUNT;
}