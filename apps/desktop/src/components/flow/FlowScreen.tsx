import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { FlowSandboxGrid } from './FlowSandboxGrid';

/**
 * «Поток» (β) — раздел собственного табличного реестра рабочих данных, миграция
 * с Google Sheets. Фаза 0: изолированная песочница со спайком движка
 * glide-data-grid на тестовых данных. Существующий раздел «Таблицы» (Google
 * webview) не затрагивает — параллельная разработка.
 *
 * Shell как у остальных экранов: шапка `h-9` на тёмной подложке + контент в
 * приподнятой `WorkspaceCard`. Виден только admin/developer (гейт `showFlow` в
 * Sidebar) — рабочие пользователи не видят незавершённый раздел.
 */
export function FlowScreen() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_flow')}
        </span>
        {/* β — раздел в разработке (subtle, Linear-вкус). */}
        <span className="no-drag-region rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium leading-none text-text-muted/80">
          β
        </span>
        <span className="no-drag-region text-[12px] text-text-muted/70">Этап 1 · Формирование</span>
      </div>
      <WorkspaceCard>
        <FlowSandboxGrid />
      </WorkspaceCard>
    </main>
  );
}
