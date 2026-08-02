import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { FlowTransportGrok } from './flow-transport-grok';

/**
 * Раздел «Транспорт» (сайдбар, admin-only).
 *
 * Единственный вид — Grok (вкладки Разнарядка | Дашборд, dark glass table,
 * сортировки, выпадашки, KPI/ApexCharts). Переключатель движков (Glide /
 * Tabulator / Grok) убран 2026-08-02: спайк закрыт, Grok стал боевым видом.
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
        <FlowTransportGrok />
      </WorkspaceCard>
    </main>
  );
}
