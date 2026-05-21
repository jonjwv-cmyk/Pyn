import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

interface PasswordInputProps extends NativeInputProps {
  /**
   * Дополнительный CSS для самого `<input>` (например padding/border).
   * Wrapper-div управляется отдельно через `wrapperClassName`.
   */
  className?: string;
  wrapperClassName?: string;
}

/**
 * Универсальный password-input с eye-toggle справа. Управляет local state'ом
 * `visible` — не меняет автозаполнение/UX браузера: тип переключается между
 * `password` и `text`. Eye-кнопка кликабельна, focus-state не уводит с input'a
 * (`tabIndex=-1`, mousedown preventDefault) — так юзер на iOS/Win/Mac не теряет
 * caret после клика по глазику.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, wrapperClassName, ...inputProps }, ref) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;
    const label = visible ? t('common.hide_password') : t('common.show_password');

    return (
      <div className={cn('relative w-full', wrapperClassName)}>
        <input
          ref={ref}
          {...inputProps}
          type={visible ? 'text' : 'password'}
          className={cn(className, 'pr-9')}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          title={label}
          className={cn(
            'absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center',
            'rounded-md text-text-muted outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    );
  },
);
