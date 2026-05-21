import { Search, X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface MolComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** Placeholder подсказка — описывает доступные форматы. */
  placeholder?: string;
}

/**
 * Нижняя «чатовая» панель поиска — визуально интегрирована с контентом
 * выше: нет border-top, фон полупрозрачный с backdrop-blur (Apple/iOS-style
 * sticky composer как в Chats/News). Когда список длинный и rows проходят
 * под композером, они мягко размываются.
 *
 * Один input — `parseMolQuery` в @pyn/core сам определит mode (warehouse /
 * phone / email / name) и для warehouse раздробит на отдельные склады.
 */
export function MolComposer({ value, onChange, placeholder }: MolComposerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedPlaceholder = placeholder ?? t('mol.composer_placeholder');
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
      {/* Blur-layer высотой ~ composer area, mask «50% black → 100% transparent»
          ВВЕРХ: blur активен в нижней половине pill'а и ниже, верхняя
          половина pill'а + всё выше — чётко. Это то что юзер хочет:
          панель поиска делит на «прозрачную верхнюю половину» (видно
          контент за ней) и «glass-нижнюю половину» (blur + полупрозрачность). */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[56px] backdrop-blur-xl"
        style={{
          maskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 50%, transparent 100%)',
        }}
      />
      <div className="relative px-4 pb-2 pt-1">
        <div
          className={cn(
            // Сам pill — БЕЗ backdrop-blur (он на layer ниже). Полупрозрачный
            // bg даёт «стеклянный» вид: за нижней половиной видно blur'енный
            // контент, верхняя пилюли прозрачнее.
            'pointer-events-auto mx-auto flex max-w-[640px] items-center gap-2',
            'rounded-2xl border border-border-default/60 bg-bg-elevated/45',
            'shadow-lg shadow-bg-deep/30',
            'px-3 transition-colors focus-within:border-accent-clay/70',
          )}
        >
        <Search
          className={cn(
            'h-4 w-4 shrink-0',
            value ? 'text-accent-clay' : 'text-text-muted',
          )}
          strokeWidth={1.75}
        />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={resolvedPlaceholder}
          className={cn(
            'h-9 min-w-0 flex-1 bg-transparent text-[13.5px]',
            'text-text-primary outline-none',
            'placeholder:text-text-muted',
          )}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            aria-label={t('mol.clear_aria')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md',
              'text-text-muted outline-none transition-colors',
              'hover:bg-bg-hover hover:text-text-strong',
            )}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
