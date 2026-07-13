import * as React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import * as Tooltip from '@radix-ui/react-tooltip';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';

type SyncItemId = 'mols-db';

type SyncItem = {
  id: SyncItemId;
  label: string;
  hint: string;
  enabled: boolean;
};

/** Подпункты «Synchronization» — скрипты подключаем по одному. */
const SYNC_ITEMS: SyncItem[] = [
  { id: 'mols-db', label: 'База МОЛов', hint: 'Синхронизация базы МОЛов', enabled: false },
];

interface SyncNavRowProps {
  collapsed: boolean;
}

/**
 * Пункт «Synchronization» в сайдбаре — заменил сетку из 6 кнопок-скриптов.
 * Hover-флайаут с подпунктами (как «База» / Google-таблицы). В свёрнутом рейле —
 * единый SidebarTooltip справа; флайаут по hover остаётся.
 */
export function SyncNavRow({ collapsed }: SyncNavRowProps) {
  const onPick = (item: SyncItem) => {
    if (!item.enabled) return;
    // TODO: подключить прогон скрипта (mols-db → flowScriptPress / SAP-run).
  };

  const trigger = <SyncTrigger collapsed={collapsed} label="Synchronization" />;

  return (
    <HoverCard.Root openDelay={80} closeDelay={150}>
      {collapsed ? (
        <Tooltip.Root>
          <HoverCard.Trigger asChild>
            <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
          </HoverCard.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              sideOffset={20}
              className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
            >
              Synchronization
              <Tooltip.Arrow className="fill-bg-deep" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        <HoverCard.Trigger asChild>{trigger}</HoverCard.Trigger>
      )}
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={20}
          collisionPadding={8}
          className={cn(
            'z-50 flex w-[196px] flex-col',
            'rounded-xl border border-border-default bg-bg-elevated p-1.5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[side=right]:slide-in-from-left-2',
          )}
        >
          <p className="px-2 pb-1 text-[10px] font-medium tracking-[-0.01em] text-text-muted/75">
            Synchronization
          </p>
          <ul className="flex flex-col gap-0.5">
            {SYNC_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!item.enabled}
                  title={item.enabled ? item.hint : `${item.hint} · скоро`}
                  onClick={() => onPick(item)}
                  className={cn(
                    'flex h-8 w-full items-center rounded-md px-2 text-left text-[12.5px] outline-none transition-colors',
                    item.enabled
                      ? 'text-text-secondary hover:bg-bg-hover hover:text-text-strong'
                      : 'cursor-not-allowed text-text-muted/45',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {!item.enabled ? (
                    <span className="ml-2 shrink-0 text-[9px] font-medium uppercase tracking-wide text-text-muted/50">
                      soon
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

type SyncTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  collapsed: boolean;
  label: string;
};

const SyncTrigger = React.forwardRef<HTMLButtonElement, SyncTriggerProps>(
  function SyncTrigger({ collapsed, label, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        className={cn(
          'group flex h-8 w-full items-center gap-1.5 rounded-md px-1.5',
          'text-text-primary outline-none transition-colors',
          'hover:bg-bg-hover hover:text-text-strong',
          className,
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-start">
          <RefreshCw
            className="h-[18px] w-[18px] text-teal-400/90 transition-colors group-hover:text-teal-300"
            strokeWidth={1.75}
          />
        </span>
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center overflow-hidden transition-opacity duration-200',
            collapsed ? 'opacity-0' : 'opacity-100',
          )}
        >
          <span className="truncate text-[13px] font-normal tracking-[-0.005em]">{label}</span>
        </span>
      </button>
    );
  },
);