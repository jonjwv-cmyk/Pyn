import { Check, ChevronDown, Globe } from 'lucide-react';
import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@pyn/core';
import { changeLanguage } from '@/lib/i18n';
import { useUiStateStore } from '@/lib/stores';
import { cn } from '@/lib/cn';

/**
 * Компактный switcher языка для экранов до login (QR / Password). Иконка
 * Globe + название текущего языка → click → popover со списком 5 языков.
 * Outside-click автоматически закрывает (Radix Popover).
 *
 * Выбор персистится через useUiStateStore.setLanguage (safeStorage), так что
 * пережиёт reload и restart Pyn'a.
 */
export function LanguageSwitcher(): JSX.Element {
  const { i18n } = useTranslation();
  const setLanguage = useUiStateStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const current = i18n.language as SupportedLanguage;

  const handleSelect = (lang: SupportedLanguage): void => {
    changeLanguage(lang);
    setLanguage(lang);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2',
            'text-[11.5px] text-text-muted outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-primary',
            'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary',
          )}
        >
          <Globe className="h-3 w-3 shrink-0" strokeWidth={1.75} />
          <span>{LANGUAGE_NATIVE_NAMES[current] ?? LANGUAGE_NATIVE_NAMES.ru}</span>
          <ChevronDown
            className="h-3 w-3 shrink-0 opacity-60 transition-transform data-[state=open]:rotate-180"
            strokeWidth={1.75}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex w-[180px] flex-col gap-0.5 rounded-xl',
            'border border-border-default bg-bg-elevated p-1 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = lang === current;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => handleSelect(lang)}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[12.5px]',
                  'outline-none transition-colors',
                  selected
                    ? 'bg-bg-hover text-text-strong'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                <span className="flex-1 truncate">{LANGUAGE_NATIVE_NAMES[lang]}</span>
                {selected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-accent-clay" strokeWidth={2} />
                )}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
