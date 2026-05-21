import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  DEFAULT_LANGUAGE,
  I18N_RESOURCES,
  normalizeLanguage,
  type SupportedLanguage,
} from '@pyn/core';

/**
 * i18n bootstrap для mobile (Expo / RN).
 *
 * Order of locale resolution:
 *   1. Saved preference (AsyncStorage `pyn:language`)
 *   2. System locale (`expo-localization.getLocales()`)
 *   3. Default `ru`
 *
 * Persist выбора — AsyncStorage прямо тут; на desktop то же делает
 * useUiStateStore через safeStorage. Mobile отдельный store пока не нужен
 * — единственный preference это language.
 */

const LANGUAGE_STORAGE_KEY = 'pyn:language';

function detectSystemLanguage(): SupportedLanguage {
  const locales = getLocales();
  const first = locales && locales.length > 0 ? locales[0] : null;
  const code = first?.languageCode ?? null;
  return normalizeLanguage(code);
}

let inited = false;

export async function initI18n(): Promise<SupportedLanguage> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* AsyncStorage недоступен — fallback на system locale */
  }
  const lang = saved ? normalizeLanguage(saved) : detectSystemLanguage();
  if (!inited) {
    await i18next.use(initReactI18next).init({
      resources: I18N_RESOURCES,
      lng: lang,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    inited = true;
  } else {
    await i18next.changeLanguage(lang);
  }
  return lang;
}

/** Smena языка в runtime — persist + apply. */
export async function changeLanguage(lang: SupportedLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* persist опционален — apply всё равно сработает в текущей сессии */
  }
  await i18next.changeLanguage(lang);
}
