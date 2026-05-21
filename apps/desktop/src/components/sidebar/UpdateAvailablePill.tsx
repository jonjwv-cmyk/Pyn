import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/**
 * Sidebar pill «Доступно обновление». Кликабельный, без авто-popup.
 * Состояния (контролируется caller'ом через props):
 *   • idle       — кнопка готова, click → start download
 *   • downloading — спиннер + прогресс (bytes/total)
 *   • ready      — скачано, click → confirm dialog «обновиться?»
 *   • installing — installer уже запущен
 *
 * Co-existence с SessionExpiryPill: оба pill'a stack'ятся в sidebar
 * (см. Sidebar.tsx), UpdatePill выше т.к. это event которого можно отложить,
 * SessionExpiry — критический countdown который must be visible.
 */
export type UpdatePillStage = 'detected' | 'downloading' | 'ready' | 'installing';

interface UpdateAvailablePillProps {
  stage: UpdatePillStage;
  /** Только для downloading state. */
  bytes?: number;
  total?: number;
  /** Скрывать в collapsed sidebar (нет места для текста). */
  collapsed?: boolean;
  onClick: () => void;
}

export function UpdateAvailablePill({
  stage,
  bytes = 0,
  total = 0,
  collapsed = false,
  onClick,
}: UpdateAvailablePillProps): JSX.Element | null {
  const { t } = useTranslation();
  if (collapsed) return null;

  const isBusy = stage === 'downloading' || stage === 'installing';
  const percent = total > 0 ? Math.round((bytes / total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      aria-label={`${t('update.pill_available_line1')} ${t('update.pill_available_line2')}`}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-left',
        'border border-accent-clay/25 bg-accent-clay-bg/40',
        'transition-colors outline-none',
        !isBusy && 'hover:bg-accent-clay-bg/60',
        isBusy && 'opacity-80',
      )}
    >
      {stage === 'downloading' || stage === 'installing' ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent-clay" strokeWidth={1.75} />
      ) : (
        <Download className="h-3 w-3 shrink-0 text-accent-clay" strokeWidth={1.75} />
      )}
      <span className="text-[11px] leading-tight text-text-secondary">
        {stage === 'downloading' ? (
          t('update.pill_downloading', { percent })
        ) : stage === 'installing' ? (
          t('update.pill_installing')
        ) : stage === 'ready' ? (
          <>
            {t('update.pill_ready_line1')}
            <br />
            {t('update.pill_ready_line2')}
          </>
        ) : (
          <>
            {t('update.pill_available_line1')}
            <br />
            {t('update.pill_available_line2')}
          </>
        )}
      </span>
    </button>
  );
}
