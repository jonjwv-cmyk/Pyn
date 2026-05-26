import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFullYek } from '@/lib/format-time';

/**
 * Reactive обёртка над `formatFullYek` — пере-вычисляет label при смене языка.
 *
 * Раньше: репозитории (news-repo, chats-repo) форматировали даты при load и
 * клали готовые строки в store (`createdAtLabel`, `lastMessageTime`,
 * `lastSeenAtLabel`). При changeLanguage эти строки в store не пересчитывались
 * → UI показывал русские даты при английской локали.
 *
 * Теперь: репозитории кладут raw timestamp, компоненты используют этот хук —
 * `useTranslation` подписан на i18n events → re-render при switch, useMemo
 * пере-формат под актуальной локалью.
 */
export function useFormatYek(raw: string | null | undefined): string {
  const { i18n } = useTranslation();
  return useMemo(() => formatFullYek(raw), [raw, i18n.language]);
}
