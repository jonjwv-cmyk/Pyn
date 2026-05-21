import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@pyn/core';
import { useUiStateStore } from '@/lib/stores';
import { changeLanguage } from '@/lib/i18n';
import { cn } from '@/lib/cn';

/**
 * Settings → Язык. Выбор языка интерфейса.
 * Сохраняется в ui-state-store (persisted) + сразу применяется через i18next.
 */
export function LanguagePanel(): JSX.Element {
  const { i18n } = useTranslation();
  const setLanguage = useUiStateStore((s) => s.setLanguage);
  const current = i18n.language as SupportedLanguage;

  const handleSelect = (lang: SupportedLanguage): void => {
    changeLanguage(lang);
    setLanguage(lang);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col gap-1.5 px-6 py-6">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const selected = lang === current;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => handleSelect(lang)}
              className={cn(
                'flex h-10 items-center gap-2.5 rounded-md px-3 text-left text-[13px]',
                'outline-none transition-colors',
                selected
                  ? 'bg-bg-hover text-text-strong'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <span className="flex-1 truncate">{LANGUAGE_NATIVE_NAMES[lang]}</span>
              {selected && (
                <Check className="h-4 w-4 shrink-0 text-accent-clay" strokeWidth={1.75} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
