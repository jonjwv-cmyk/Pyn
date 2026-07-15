import * as React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import * as Tooltip from '@radix-ui/react-tooltip';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSheetsLockStore } from '@pyn/core';
import { MOLS_SYNC_ACTION_ID, runMolsBackup, runMolsRestore, runMolsSync } from '@/lib/mols-sync-run';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';

type SyncItemId = 'mols-db';

type SyncItem = {
  id: SyncItemId;
  label: string;
  hint: string;
  enabled: boolean;
};

const SYNC_ITEMS: SyncItem[] = [
  { id: 'mols-db', label: 'База МОЛов', hint: 'Синхронизация базы МОЛов из SAP', enabled: true },
];

interface SyncNavRowProps {
  collapsed: boolean;
}

export function SyncNavRow({ collapsed }: SyncNavRowProps) {
  const [running, setRunning] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const activeLock = useSheetsLockStore((s) => s.activeLock);
  const blockedByOther = Boolean(
    activeLock && activeLock.actionId !== MOLS_SYNC_ACTION_ID,
  );
  const molsLockedByOther = Boolean(
    activeLock && activeLock.actionId === MOLS_SYNC_ACTION_ID && activeLock.userName !== 'Вы',
  );

  const runAction = (fn: () => Promise<{ ok: boolean; msg: string }>) => {
    setRunning(true);
    setMsg(null);
    void fn()
      .then((r) => setMsg(r.msg))
      .finally(() => setRunning(false));
  };

  const run = (password?: string) => {
    runAction(() => runMolsSync(password));
  };

  const onPick = (item: SyncItem) => {
    if (!item.enabled || running || blockedByOther || molsLockedByOther) return;
    setPwOpen(true);
  };

  const onBackup = () => {
    if (running || blockedByOther) return;
    runAction(() => runMolsBackup('manual_before_sync'));
  };

  const onRestore = () => {
    if (running || blockedByOther) return;
    if (!window.confirm('Откатить контакты и МОЛ к последнему резерву?')) return;
    runAction(() => runMolsRestore());
  };

  const trigger = (
    <SyncTrigger
      collapsed={collapsed}
      label="Synchronization"
      className={running ? 'animate-pulse' : undefined}
    />
  );

  return (
    <>
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
            {msg ? (
              <p className="mx-1 mb-1 line-clamp-3 px-1 text-[10px] text-text-muted/80" title={msg}>
                {msg}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {SYNC_ITEMS.map((item) => {
                const disabled = !item.enabled || running || blockedByOther || molsLockedByOther;
                const title = molsLockedByOther
                  ? `Синхронизацию запустил ${activeLock?.userName}`
                  : blockedByOther
                    ? `Занято: ${activeLock?.actionLabel}`
                    : item.hint;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      title={title}
                      onClick={() => onPick(item)}
                      className={cn(
                        'flex h-8 w-full items-center rounded-md px-2 text-left text-[12.5px] outline-none transition-colors',
                        disabled
                          ? 'cursor-not-allowed text-text-muted/45'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                        running && item.enabled && !blockedByOther && !molsLockedByOther
                          ? 'text-accent-clay'
                          : null,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="ml-2 shrink-0 text-[10px] font-medium text-accent-clay/90">
                        {running ? '…' : 'Обновить МОЛов'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mx-1 mt-1 flex flex-col gap-0.5 border-t border-border-default/60 pt-1">
              <button
                type="button"
                disabled={running || blockedByOther}
                onClick={onBackup}
                className={cn(
                  'flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] outline-none transition-colors',
                  running || blockedByOther
                    ? 'cursor-not-allowed text-text-muted/45'
                    : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                )}
              >
                Сохранить резерв
              </button>
              <button
                type="button"
                disabled={running || blockedByOther}
                onClick={onRestore}
                className={cn(
                  'flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] outline-none transition-colors',
                  running || blockedByOther
                    ? 'cursor-not-allowed text-text-muted/45'
                    : 'text-amber-400/85 hover:bg-bg-hover hover:text-amber-300',
                )}
              >
                Откатить резерв
              </button>
            </div>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>

      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel="База МОЛов"
        onSubmit={(password) => {
          setPwOpen(false);
          run(password);
        }}
        onCancel={() => setPwOpen(false)}
      />
    </>
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