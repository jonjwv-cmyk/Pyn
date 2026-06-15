import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';

/**
 * Раздел «Рассылка» — заглушка (контент будет позже).
 * Shell как у остальных вкладок: шапка на подложке + WorkspaceCard.
 */
export function BroadcastScreen(): JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_broadcast')}
        </span>
      </div>
      <WorkspaceCard>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-12">
          <p className="text-[13px] text-text-muted">Раздел в разработке.</p>
        </div>
      </WorkspaceCard>
    </main>
  );
}