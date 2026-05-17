import { Lock } from 'lucide-react';
import type { SheetLock } from '@pyn/core';
import { cn } from '@/lib/cn';

/**
 * Полноэкранный overlay поверх Google Sheets webview, когда на текущем
 * листе запущен скрипт/макрос. Перекрывает клики (pointer-events:auto на
 * корневом контейнере). Визуально — sheets-pattern (отличается от chat /
 * news / mol fonов), сообщение центрировано.
 */
export function SheetsLockOverlay({ lock }: { lock: SheetLock }): JSX.Element {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-0 z-30 flex items-center justify-center',
        'sheets-pattern-bg backdrop-blur-[2px]',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full',
            'border border-accent-clay/30 bg-accent-clay-bg text-accent-clay',
          )}
        >
          <Lock className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
          Лист заблокирован
        </h2>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          <span className="font-semibold text-text-strong">{lock.userName}</span>
          {' запустил '}
          <span className="font-semibold text-text-strong">«{lock.actionLabel}»</span>
        </p>
        <p className="text-[12px] italic text-text-muted">
          Лист разблокируется автоматически по завершении.
        </p>
      </div>
    </div>
  );
}
