/**
 * Одобренные сервером реакции. 1:1 с `handlers-reactions.js::ALLOWED_EMOJIS`
 * и Kotlin `Reactions.ALLOWED` (см. OTLHelper2 / domain/model/Reactions.kt).
 *
 * 🔴 Любой emoji вне этого списка → сервер вернёт `{ok:false,error:"invalid_emoji"}`.
 *    Поэтому picker'ы в news + chat должны рендериться строго из этого массива.
 *
 * Порядок важен — он определяет порядок кнопок в UI, и должен совпадать со
 * списком в Kotlin-клиентах для кросс-платформенной консистенции.
 */
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '🎉', '✅'] as const;

export type AllowedReaction = (typeof ALLOWED_REACTIONS)[number];

/** True если emoji принят сервером. */
export function isAllowedReaction(emoji: string): emoji is AllowedReaction {
  return (ALLOWED_REACTIONS as readonly string[]).includes(emoji);
}
