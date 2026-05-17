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
 * Размещается внутри `relative`-обёртки. Появляется через opacity + translate-y
 * для плавности. По центру горизонтально, отступ 12dp от низа.
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
        'absolute bottom-3 left-1/2 z-20',
        'flex h-9 w-9 items-center justify-center rounded-full',
        'border border-border-default bg-transparent text-text-strong',
        'outline-none transition-all duration-200',
        'hover:bg-bg-elevated hover:shadow-md',
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
