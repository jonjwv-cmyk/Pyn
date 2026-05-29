import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SettingsTopBarProps {
  /** Заголовок активной подсекции. */
  title: string;
  /** Правая зона: search, кнопки действий и т.п. — рендерится после title. */
  children?: ReactNode;
}

/**
 * Шапка карточки Settings — h-12 как у заголовков Chats/News. Только title +
 * actions подсекции; back-кнопка живёт в SettingsSidebar (rail слева), там же
 * gobbled macOS traffic-lights.
 *
 * Drag-region на header; **критично** `no-drag-region` на интерактивных
 * элементах — иначе macOS-handler глотает клики (класс см. в index.css ::
 * .no-drag-region, не `.no-drag`).
 */
export function SettingsTopBar({ title, children }: SettingsTopBarProps) {
  return (
    <header
      className={cn(
        'drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface px-4',
      )}
    >
      <span className="no-drag-region text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
        {title}
      </span>
      {children && (
        <>
          <div className="flex-1" />
          <div className="no-drag-region flex items-center gap-2">{children}</div>
        </>
      )}
    </header>
  );
}
