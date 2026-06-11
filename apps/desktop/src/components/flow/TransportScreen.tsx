import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { FlowTransportGrid } from './FlowTransportGrid';

/**
 * Раздел «Транспорт» (отдельный пункт сайдбара, admin-only) — реестр «машина на
 * день»: база машин + лист дня. Вынесен из вкладок «Потока» (юзер 2026-06-11):
 * это самостоятельный рабочий лист, а не этап плана.
 */
export function TransportScreen(): JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_transport', 'Транспорт')}
        </span>
      </div>
      <WorkspaceCard>
        <FlowTransportGrid />
      </WorkspaceCard>
    </main>
  );
}
