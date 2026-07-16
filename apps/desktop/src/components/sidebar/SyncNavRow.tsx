import * as React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Download } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isDeveloper, useSheetsLockStore, type Role } from '@pyn/core';
import { MOLS_SYNC_ACTION_ID, runMolsBackup, runMolsRestore, runMolsSync } from '@/lib/mols-sync-run';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface SyncNavRowProps {
  collapsed: boolean;
  /** Роль для кнопки отката (только developer). */
  userRole?: Role | string;
}

/**
 * Пункт «Импорт» — как «База»: hover-флайаут справа, не отдельная «выпадашка».
 * Один лист «МОЛы»: слева запуск импорта, справа «Откат» (developer).
 * Перед импортом всегда пишется резерв (фиксация текущего состояния).
 */
export function SyncNavRow({ collapsed, userRole }: SyncNavRowProps) {
  const [running, setRunning] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = React.useState(false);
  /** 'sync' = пароль макроса SAP; 'restore' = пароль отката */
  const [pwMode, setPwMode] = React.useState<'sync' | 'restore'>('sync');
  const canRestore = isDeveloper((userRole as Role) ?? 'user');
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

  const importDisabled = running || blockedByOther || molsLockedByOther;
  const restoreDisabled = running || blockedByOther || !canRestore;

  const importTitle = molsLockedByOther
    ? `Импорт запустил ${activeLock?.userName}`
    : blockedByOther
      ? `Занято: ${activeLock?.actionLabel}`
      : 'Импорт МОЛ из SAP (сначала сохраняется резерв)';

  const restoreTitle = !canRestore
    ? 'Откат только для разработчика'
    : 'Откат к последнему резерву';

  const trigger = (
    <ImportTrigger
      collapsed={collapsed}
      label="Импорт"
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
                Импорт
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
              'z-50 flex w-[200px] flex-col',
              'rounded-xl border border-border-default bg-bg-elevated p-1.5 shadow-2xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
              'data-[side=right]:slide-in-from-left-2',
            )}
          >
            {msg ? (
              <p className="mb-1 line-clamp-3 px-1.5 text-[10px] text-text-muted/80" title={msg}>
                {msg}
              </p>
            ) : null}

            {/* Одна плашка: МОЛы | Откат — как лист «База», но split-кнопка */}
            <div
              className={cn(
                'flex h-8 w-full items-stretch overflow-hidden rounded-md',
                'border border-border-default/70 bg-bg-primary/40',
              )}
            >
              <button
                type="button"
                disabled={importDisabled}
                title={importTitle}
                onClick={() => {
                  if (importDisabled) return;
                  setPwMode('sync');
                  setPwOpen(true);
                }}
                className={cn(
                  'flex min-w-0 flex-1 items-center px-2.5 text-left text-[12.5px] outline-none transition-colors',
                  importDisabled
                    ? 'cursor-not-allowed text-text-muted/45'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-strong',
                  running && !blockedByOther && !molsLockedByOther ? 'text-accent-clay' : null,
                )}
              >
                <span className="truncate font-medium">
                  {running ? 'МОЛы…' : 'МОЛы'}
                </span>
              </button>
              <span className="w-px shrink-0 self-stretch bg-border-default/70" aria-hidden />
              <button
                type="button"
                disabled={restoreDisabled}
                title={restoreTitle}
                onClick={() => {
                  if (restoreDisabled) return;
                  setRestoreConfirmOpen(true);
                }}
                className={cn(
                  'flex shrink-0 items-center px-2.5 text-[12.5px] outline-none transition-colors',
                  restoreDisabled
                    ? 'cursor-not-allowed text-text-muted/45'
                    : 'text-amber-400/90 hover:bg-bg-hover hover:text-amber-300',
                )}
              >
                Откат
              </button>
            </div>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>

      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="Откатить базу контактов?"
        description="Вернём контакты и МОЛ к последнему резерву (тот, что сохранился перед импортом или вручную). Действие только для разработчика."
        confirmLabel="Откатить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={() => {
          setPwMode('restore');
          setPwOpen(true);
        }}
      />

      <SheetsPasswordPrompt
        open={pwOpen}
        actionLabel={pwMode === 'restore' ? 'Откат базы контактов' : 'Импорт МОЛ'}
        title={pwMode === 'restore' ? 'Пароль отката' : undefined}
        onSubmit={(password) => {
          setPwOpen(false);
          if (pwMode === 'restore') {
            runAction(() => runMolsRestore(password));
          } else {
            // Сначала резерв «как есть», потом импорт из SAP.
            runAction(async () => {
              const bak = await runMolsBackup('auto_before_import');
              const sync = await runMolsSync(password);
              if (!bak.ok && sync.ok) {
                return { ok: true, msg: `${sync.msg} · резерв: ${bak.msg}` };
              }
              if (!sync.ok) return sync;
              return {
                ok: true,
                msg: bak.ok ? `${sync.msg} · ${bak.msg}` : sync.msg,
              };
            });
          }
        }}
        onCancel={() => setPwOpen(false)}
      />
    </>
  );
}

type ImportTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  collapsed: boolean;
  label: string;
};

/** Trigger как у «База»: иконка + лейбл, hover-флайаут через Radix. */
const ImportTrigger = React.forwardRef<HTMLButtonElement, ImportTriggerProps>(
  function ImportTrigger({ collapsed, label, className, ...rest }, ref) {
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
          <Download
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
