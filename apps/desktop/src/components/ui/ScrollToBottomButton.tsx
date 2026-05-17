import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * Floating круг ↓ для прокрутки скроллируемой ленты к низу.
 *
 *   • По умолчанию — прозрачный fill, виден только контур + стрелка.
 *   • При hover    — контур остаётся, круг заполняется bg-bg-elevated.
 *
 * Позиционирование: `bottom-20` (80px от низа) + `z-30`, чтобы кнопка не
 * скрывалась под floating glass-composer'ом (он висит на `bottom-0` высотой
 * ~72px на z-20). Если composer'a нет (read-only лента) — кнопка всё равно
 * красиво над краем, чуть выше визуального центра нижней зоны.
 */
export function ScrollToBottomButton({
  visible,
  onClick,
  className,
}: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Прокрутить к концу"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        'absolute bottom-20 left-1/2 z-30',
        'flex h-9 w-9 items-center justify-center rounded-full',
        'border border-border-default bg-bg-elevated/85 text-text-strong',
        'backdrop-blur-sm shadow-md outline-none transition-all duration-200',
        'hover:bg-bg-elevated hover:shadow-lg',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
      style={{
        transform: visible ? 'translate(-50%, 0)' : 'translate(-50%, 8px)',
      }}
    >
      <ChevronDown className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
