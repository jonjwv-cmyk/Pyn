import { Sparkles } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';
import { useAiStore } from '@/lib/ai-store';

interface AiNavButtonProps {
  collapsed: boolean;
  onClick: () => void;
}

/**
 * Кнопка ИИ-помощника в шапке сайдбара: иконка + текст «AI Gemini» (в
 * свёрнутом — «Gemini», иконка меньше, чтобы вписалось; при наведении — тултип).
 * Подсвечивается, пока окно помощника открыто. Гейт admin/developer — выше.
 */
export function AiNavButton({ collapsed, onClick }: AiNavButtonProps) {
  const active = useAiStore((s) => s.open);

  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label="AI Gemini"
      className={cn(
        'group flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1',
        'text-text-primary transition-colors',
        'hover:bg-bg-hover hover:text-text-strong',
        active && 'bg-bg-selected text-text-strong',
      )}
    >
      {/* Градиент для значка ИИ (повторяет палитру пилюли), когда активно.
          userSpaceOnUse — иначе на «лучиках»-чёрточках (нулевая ширина/высота)
          objectBoundingBox-градиент вырождается и они пропадают. */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="pyn-ai-grad" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
            <stop offset="0%" stopColor="#E9C9A3" />
            <stop offset="38%" stopColor="#D97757" />
            <stop offset="72%" stopColor="#E0934F" />
            <stop offset="100%" stopColor="#C58AF0" />
          </linearGradient>
        </defs>
      </svg>
      <span className="flex h-7 w-5 shrink-0 items-center justify-center">
        <Sparkles
          className={cn(
            'transition-colors',
            collapsed ? 'h-4 w-4' : 'h-[18px] w-[18px]',
            active
              ? 'drop-shadow-[0_0_5px_rgba(217,119,87,0.95)]'
              : 'text-accent-clay/85 group-hover:text-accent-clay',
          )}
          style={active ? { stroke: 'url(#pyn-ai-grad)' } : undefined}
          strokeWidth={1.75}
        />
      </span>
      <span className="truncate text-[13px] font-normal tracking-[-0.005em]">
        {collapsed ? 'Gemini' : 'AI Gemini'}
      </span>
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
          AI Gemini
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
