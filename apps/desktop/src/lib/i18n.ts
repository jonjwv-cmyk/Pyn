import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  I18N_RESOURCES,
  normalizeLanguage,
  type SupportedLanguage,
} from '@pyn/core';

/**
 * i18n bootstrap для desktop.
 *
 * Order of locale resolution:
 *   1. Saved preference (from ui-state-store, передаётся caller'ом в `initI18n`)
 *   2. Default `ru`
 *
 * §2026-05-21 — autodetect через `navigator.language` убран. Юзер хочет
 * чтобы при первом запуске всегда был русский, а не OS-locale — даже на
 * macOS с EN-локалью.
 *
 * Persist выбора — App.tsx сохраняет в ui-state-store при change через
 * Settings → Язык. Store hydrate'ится через safeStorage IPC asynchronously,
 * поэтому caller должен ждать `useUiStateStore.persist.hasHydrated()` перед
 * вызовом initI18n — иначе savedLanguage всегда будет null и мы инициализируем
 * на ru до прихода persisted value.
 */

let inited = false;

export function initI18n(savedLanguage: string | null): SupportedLanguage {
  const lang = savedLanguage ? normalizeLanguage(savedLanguage) : DEFAULT_LANGUAGE;

  if (!inited) {
    void i18next.use(initReactI18next).init({
      resources: I18N_RESOURCES,
      lng: lang,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    inited = true;
  } else {
    void i18next.changeLanguage(lang);
  }
  return lang;
}

/** Smena языка в runtime — вызывается из Settings → Язык. */
export function changeLanguage(lang: SupportedLanguage): void {
  void i18next.changeLanguage(lang);
}
