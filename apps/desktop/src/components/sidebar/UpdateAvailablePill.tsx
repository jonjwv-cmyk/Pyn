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
  const isBusy = stage === 'downloading' || stage === 'installing';
  const percent = total > 0 ? Math.round((bytes / total) * 100) : 0;

  // §pyn-1.2.54 — collapsed: компактный pill только с лейблом «Update»
  // (или percent для downloading). Сохраняется тот же visual slot, нет скачков.
  if (collapsed) {
    const tooltip =
      stage === 'downloading'
        ? t('update.pill_downloading', { percent })
        : stage === 'installing'
          ? t('update.pill_installing')
          : stage === 'ready'
            ? `${t('update.pill_ready_line1')} ${t('update.pill_ready_line2')}`
            : `${t('update.pill_available_line1')} ${t('update.pill_available_line2')}`;
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isBusy}
        aria-label={tooltip}
        title={tooltip}
        className={cn(
          // §pyn-1.2.54 — pl-[5px] компенсирует border 1px, текст на линии 12.
          // h-10 (40px) — единая высота с другими pills, нет скачка при toggle.
          // В collapsed text-only (без icon) — юзер просил: «Обновить» по линии
          // выравнивания без иконки. При downloading показываем percent.
          'relative flex h-10 w-full items-center justify-start overflow-hidden rounded-md py-1 pl-[5px] pr-1.5',
          'border border-accent-clay/40 bg-accent-clay-bg/50',
          'transition-all outline-none',
          !isBusy && 'hover:bg-accent-clay-bg/70',
          isBusy && 'opacity-80',
        )}
      >
        {!isBusy && <span aria-hidden className="pyn-shimmer-ltr" />}
        <span className="relative whitespace-nowrap text-[10px] font-medium leading-none text-accent-clay">
          {stage === 'downloading' ? `${percent}%` : t('update.pill_label')}
        </span>
      </button>
    );
  }

  // §pyn-1.2.54 — single-line label compact pill (как Session/Connectivity по высоте).
  // Состояние выбирается по stage: detected/ready → "Обновление", downloading →
  // "Загрузка 45%", installing → "Установка…". Icon (Download / Loader2) слева
  // inline, без bg-box. Padding py-1 для compact высоты, pl-[5px] для alignment.
  const label =
    stage === 'downloading'
      ? t('update.pill_downloading', { percent })
      : stage === 'installing'
        ? t('update.pill_installing')
        : t('update.pill_label');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      aria-label={label}
      className={cn(
        // §pyn-1.2.34 — relative + overflow-hidden для shimmer-overlay.
        // §pyn-1.2.54 — pl-[5px] компенсирует border 1px, icon на линии 12.
        // h-10 → высота консистентна с другими pills, no jump при toggle.
        'relative flex h-10 w-full items-center gap-1.5 overflow-hidden rounded-md py-1 pl-[5px] pr-2',
        'border border-accent-clay/40 bg-accent-clay-bg/50',
        'transition-all outline-none',
        !isBusy && 'hover:border-accent-clay/60 hover:bg-accent-clay-bg/70',
        isBusy && 'opacity-80',
      )}
    >
      {/* §pyn-1.2.34 — shimmer gradient слева→направо. Не показываем при busy. */}
      {!isBusy && <span aria-hidden className="pyn-shimmer-ltr" />}
      {isBusy ? (
        <Loader2 className="relative h-3 w-3 shrink-0 animate-spin text-accent-clay" strokeWidth={2} />
      ) : (
        <Download className="relative h-3 w-3 shrink-0 text-accent-clay" strokeWidth={2} />
      )}
      {/* §pyn-1.2.54 — inline text без flex-1/truncate: ведёт себя как Session
          текст (прямо после icon + gap), визуально слева. Юзер просил «Обновить»
          в ровень с «Через 5:00» — оба pills теперь имеют идентичную flex-row
          структуру: icon + gap-1.5 + inline-text. */}
      <span className="relative whitespace-nowrap text-left text-[11px] font-medium leading-tight text-text-strong">
        {label}
      </span>
    </button>
  );
}
