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
 *   1. Saved preference (из ui-state-store / localStorage backup)
 *   2. Default `ru`
 *
 * §2026-05-21 — autodetect через `navigator.language` убран. Юзер хочет
 * чтобы при первом запуске всегда был русский, а не OS-locale.
 *
 * §pyn-1.2.25 — `initI18n` теперь возвращает Promise. main.tsx делает
 * `await initI18n(...)` ДО первого render, чтобы tray window и все
 * format-time.ts вызовы стартовали с правильной локалью без флэша
 * raw-keys / «16 мая» в EN UI. Sync caller'ы (use-init-i18n.ts) могут
 * просто `void initI18n(...)`.
 *
 * Также пишет savedLanguage в localStorage — tray window через main.tsx
 * читает этот cache synchronously, без electron safeStorage IPC.
 */

const STORAGE_KEY = 'pyn:i18n:lang';
let inited = false;

export async function initI18n(savedLanguage: string | null): Promise<SupportedLanguage> {
  const lang = savedLanguage ? normalizeLanguage(savedLanguage) : DEFAULT_LANGUAGE;

  // Persist в localStorage как sync-readable бэкап для tray window (он
  // открывается отдельным BrowserWindow и не ждёт ui-state-store hydrate).
  if (savedLanguage) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore quota */ }
  }

  if (!inited) {
    await i18next.use(initReactI18next).init({
      resources: I18N_RESOURCES,
      lng: lang,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    inited = true;
  } else if (i18next.language !== lang) {
    await i18next.changeLanguage(lang);
  }
  return lang;
}

/** Smena языка в runtime — вызывается из Settings → Язык. */
export function changeLanguage(lang: SupportedLanguage): void {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore quota */ }
  void i18next.changeLanguage(lang);
}
