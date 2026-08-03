import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { WorkspaceSurfaceToggle } from '@/components/WorkspaceSurfaceToggle';
import { useWorkspaceSurface } from '@/lib/workspace-surface';
import '@/components/workspace-surface.css';
import { FlowTransportGrok } from './flow-transport-grok';

/**
 * Раздел «Транспорт» (сайдбар, admin-only).
 *
 * Grok: Разнарядка | Дашборд. Переключатель «Светлее» — тёплый paper-лист
 * (localStorage), общий с Заметками/Сводкой.
 */
export function TransportScreen(): JSX.Element {
  const { t } = useTranslation();
  const surface = useWorkspaceSurface('transport');
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden" data-pyn-surface={surface}>
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_transport', 'Транспорт')}
        </span>
        <div className="flex-1" />
        <WorkspaceSurfaceToggle section="transport" />
      </div>
      <WorkspaceCard>
        <FlowTransportGrok />
      </WorkspaceCard>
    </main>
  );
}
