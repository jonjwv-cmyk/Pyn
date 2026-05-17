import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpCircle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal-приглашение обновиться. Показывается когда server-side
 * `app_status.current_version > appVersion`. На «Обновить» вызывает main-process
 * IPC `pyn:update:download-install` — он стримит exe в %LOCALAPPDATA%,
 * запускает установщик, после чего наш process exit'ит.
 *
 * `forceUpdate=true` → нет кнопки «Позже» (server считает версию критической).
 */
export function UpdatePromptDialog({
  open,
  currentVersion,
  newVersion,
  updateUrl,
  forceUpdate,
  onDismiss,
}: {
  open: boolean;
  currentVersion: string;
  newVersion: string;
  updateUrl: string;
  forceUpdate: boolean;
  onDismiss: () => void;
}): JSX.Element {
  const [stage, setStage] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [bytes, setBytes] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStage('idle');
      setBytes(0);
      setTotal(0);
      setError(null);
      return;
    }
    const unsubscribe = window.pyn?.update?.onProgress?.(({ bytes: b, total: t }) => {
      setBytes(b);
      if (t > 0) setTotal(t);
    });
    return unsubscribe;
  }, [open]);

  const handleUpdate = async (): Promise<void> => {
    if (!window.pyn?.update?.downloadInstall) return;
    setStage('downloading');
    setError(null);
    try {
      const res = await window.pyn.update.downloadInstall(updateUrl, newVersion);
      if (!res.ok) {
        setError(res.error ?? 'unknown');
        setStage('error');
      }
      // На успехе main spawn'ит installer и app.quit() — Dialog исчезнет с
      // приложением.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  const percent = total > 0 ? Math.round((bytes / total) * 100) : 0;
  const dismissable = !forceUpdate && stage !== 'downloading';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && dismissable) onDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/55 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[400px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
          onEscapeKeyDown={(e) => {
            if (!dismissable) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissable) e.preventDefault();
          }}
        >
          <div className="mb-4 flex items-start gap-3">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                'border border-accent-clay/30 bg-accent-clay-bg text-accent-clay',
              )}
            >
              <ArrowUpCircle className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[14px] font-semibold text-text-strong">
                {forceUpdate ? 'Требуется обновление' : 'Доступно обновление'}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12.5px] text-text-secondary">
                Версия <span className="font-mono">{currentVersion}</span> →{' '}
                <span className="font-mono text-text-strong">{newVersion}</span>
              </Dialog.Description>
            </div>
            {dismissable && (
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-strong"
                  aria-label="Закрыть"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </Dialog.Close>
            )}
          </div>

          {stage === 'idle' && (
            <p className="text-[12.5px] leading-relaxed text-text-secondary">
              {forceUpdate
                ? 'Текущая версия больше не поддерживается. Обновитесь чтобы продолжить работу.'
                : 'Pyn перезапустится сам после установки. Несохранённое — потеряется.'}
            </p>
          )}

          {stage === 'downloading' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[12px] text-text-secondary">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  Загрузка…
                </span>
                <span>{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                <div
                  className="h-full bg-accent-clay transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {total > 0 && (
                <div className="text-right text-[11px] text-text-muted">
                  {formatBytes(bytes)} / {formatBytes(total)}
                </div>
              )}
            </div>
          )}

          {stage === 'error' && error && (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              Ошибка обновления: {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {dismissable && stage !== 'error' && (
              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                  'text-text-secondary outline-none transition-colors',
                  'hover:bg-bg-hover hover:text-text-strong',
                )}
              >
                Позже
              </button>
            )}
            <button
              type="button"
              onClick={handleUpdate}
              disabled={stage === 'downloading'}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium',
                'outline-none transition-colors',
                stage === 'downloading'
                  ? 'cursor-wait bg-bg-hover text-text-muted'
                  : 'bg-accent-clay text-white hover:bg-accent-clay-dim',
              )}
            >
              {stage === 'error' ? 'Повторить' : 'Обновить'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
