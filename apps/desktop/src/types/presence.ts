/**
 * Состояние присутствия пользователя — применяется ко всем аватарам в
 * приложении (chat list, conversation header, BottomUserRow sidebar и т.д.).
 *
 *   online  → зелёный (в сети)
 *   away    → жёлтый  (Пауза — отошёл, бездействует)
 *   offline → красный (Оффлайн — не в сети)
 */
export type PresenceState = 'online' | 'away' | 'offline';
