/**
 * Pyn i18n — shared между desktop (Electron) и mobile (RN).
 *
 * Translation files в `./locales/{lang}.json` — flat keys с namespace через dot
 * (`login.title`, `dialogs.session_expiry.body`). Interpolation через `{name}`:
 *   t('news.scheduled_toast', { date: '21 мая' }) → «Запланировано на 21 мая»
 *
 * Каждое app инициализирует свой `i18next.init(...)` через `createI18n()`,
 * передавая ресурсы из этого пакета. Locale detection — отдельный пакет
 * (browser-language-detector / expo-localization).
 */

import ru from './locales/ru.json';
import en from './locales/en.json';
import es from './locales/es.json';
import uk from './locales/uk.json';
import de from './locales/de.json';

export const SUPPORTED_LANGUAGES = ['ru', 'en', 'es', 'uk', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'ru';

/** Display name каждого языка (на самом языке — native name). */
export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  ru: 'Русский',
  en: 'English',
  es: 'Español',
  uk: 'Українська',
  de: 'Deutsch',
};

export const I18N_RESOURCES = {
  ru: { translation: ru },
  en: { translation: en },
  es: { translation: es },
  uk: { translation: uk },
  de: { translation: de },
} as const;

/** Проверка что строка — поддерживаемый язык. Иначе fallback на default. */
export function normalizeLanguage(lang: string | undefined | null): SupportedLanguage {
  if (!lang) return DEFAULT_LANGUAGE;
  const lower = lang.toLowerCase().split('-')[0] || '';
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lower)) {
    return lower as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}
