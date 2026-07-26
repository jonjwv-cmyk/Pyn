import { useEffect, useState } from 'react';
import { PawPrint } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

interface AiNavButtonProps {
  collapsed: boolean;
  onClick: () => void;
}

/**
 * Кнопка «Питомец» в сайдбаре: toggle show/hide always-on-top окна.
 */
export function AiNavButton({ collapsed, onClick }: AiNavButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void window.pyn?.pet?.isVisible?.().then(setVisible);
    const unsub = window.pyn?.pet?.onVisible?.(setVisible);
    return () => {
      unsub?.();
    };
  }, []);

  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={visible ? 'Скрыть питомца' : 'Показать питомца'}
      aria-pressed={visible}
      className={cn(
        'group flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1',
        'text-text-primary transition-colors',
        'hover:bg-bg-hover hover:text-text-strong',
        visible && 'bg-bg-selected text-text-strong',
      )}
    >
      <span className="flex h-7 w-5 shrink-0 items-center justify-center">
        <PawPrint
          className={cn(
            'transition-colors',
            collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]',
            visible
              ? 'text-accent-clay drop-shadow-[0_0_5px_rgba(217,119,87,0.85)]'
              : 'text-accent-clay/85 group-hover:text-accent-clay',
          )}
          strokeWidth={1.75}
        />
      </span>
      {!collapsed && (
        <span className="truncate text-[13px] font-normal tracking-[-0.005em]">
          Питомец
        </span>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={20}
          className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
        >
          {visible ? 'Скрыть' : 'Показать'}
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
