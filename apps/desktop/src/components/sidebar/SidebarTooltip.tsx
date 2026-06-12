import type { ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * Единая подсказка сайдбара (свёрнутый режим): справа от пункта, ОДИН стиль и ОТСТУП
 * для ВСЕХ элементов — навигация (Поток/Чаты/…) и кнопки-скрипты (юзер 2026-06-12).
 * Меняется только текст. Не дублировать разметку тултипа в отдельных местах.
 */
export function SidebarTooltip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={20}
          className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
        >
          {label}
          <Tooltip.Arrow className="fill-bg-deep" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
