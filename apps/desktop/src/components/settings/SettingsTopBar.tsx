import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SettingsTopBarProps {
  /** Заголовок (рендерим жирным справа от невидимой границы sidebar'a). */
  title: string;
  /** Возврат к предыдущему разделу. */
  onBack: () => void;
  /** Правая зона: search, кнопки действий и т.п. — рендерится после title. */
  children?: ReactNode;
}

/**
 * Единый «top bar» экрана Settings — высота h-12 как у заголовков Chats/News.
 *
 * Разделён на 2 зоны вертикально совпадающие с layout'ом ниже:
 *   ┌─── 200px (зона inner sidebar) ────┬─── flex-1 (зона content) ──────┐
 *   │ [mac traffic-lights spacer] ←Назад │ Title · ... actions          │
 *   └────────────────────────────────────┴───────────────────────────────┘
 *
 * Back-кнопка визуально интегрирована с inner sidebar'ом (стоит «над»
 * пунктами Пользователи/Язык/Оформление). Title начинается после невидимой
 * границы — над content area, не над разделителем. Это даёт честный
 * визуальный grid вместо одной длинной строки.
 *
 * Drag-region на header; **критично** `no-drag-region` на интерактивных
 * элементах — иначе macOS-handler глотает клики (класс см. в
 * apps/desktop/src/index.css :: .no-drag-region, не `.no-drag`).
 *
 * macOS: traffic-lights (close/min/max) — первые ~76px слева; на mac даём
 * pl-[84px] чтобы back-кнопка стартовала после них.
 */
export function SettingsTopBar({ title, onBack, children }: SettingsTopBarProps) {
  const isMac = typeof window !== 'undefined' && window.pyn?.platform === 'darwin';
  return (
    <header
      className={cn(
        'drag-region flex h-12 shrink-0 items-stretch border-b border-border-subtle',
        'bg-bg-surface',
      )}
    >
      {/* Левая зона — ширина = inner sidebar (200px). Здесь back-кнопка. */}
      <div
        className={cn(
          'flex w-[200px] shrink-0 items-center pr-1.5',
          isMac ? 'pl-[84px]' : 'pl-1.5',
        )}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          className={cn(
            'no-drag-region flex h-8 items-center gap-1.5 rounded-md px-2',
            'text-[13px] font-medium text-text-secondary outline-none transition-colors',
            'hover:bg-bg-hover hover:text-text-strong',
          )}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          <span>Назад</span>
        </button>
      </div>

      {/* Правая зона — над content. Title + actions. */}
      <div className="flex flex-1 items-center gap-3 px-4">
        <span className="no-drag-region text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
          {title}
        </span>
        {children && (
          <>
            <div className="flex-1" />
            <div className="no-drag-region flex items-center gap-2">{children}</div>
          </>
        )}
      </div>
    </header>
  );
}
