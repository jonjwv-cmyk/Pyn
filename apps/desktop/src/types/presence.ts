/**
 * Состояние присутствия пользователя — применяется ко всем аватарам в
 * приложении (chat list, conversation header, BottomUserRow sidebar и т.д.).
 *
 *   online  → зелёный (в сети)
 *   away    → жёлтый  (Пауза — отошёл, бездействует)
 *   offline → красный (Оффлайн — не в сети)
 */
export type PresenceState = 'online' | 'away' | 'offline';

/**
 * §pyn-1.2.37 — нормализация raw-значения из server payload в типизированный
 * PresenceState. Server возвращает `'paused'` для background-session
 * (см. `db.js::getPresenceByLogins`), но client-тип не имеет 'paused' —
 * без маппинга `COLOR_BY_STATE['paused']` = undefined → CSS-класс пустой →
 * жёлтая точка «прозрачная» (без фона).
 */
export function normalizePresence(raw: string | null | undefined): PresenceState {
  if (raw === 'online') return 'online';
  if (raw === 'paused' || raw === 'away') return 'away';
  return 'offline';
}
