import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { FlowTransportGrid } from './FlowTransportGrid';
import { FlowTabulatorTransport } from './flow-tabulator-transport';
import { FlowTransportGrok } from './flow-transport-grok';

/**
 * Раздел «Транспорт» (сайдбар, admin-only).
 *
 * Движок/UI:
 *  - glide     — боевой Glide
 *  - tabulator — Tabulator + светлая тема Flow
 *  - grok      — принципиально новый UI: вкладки Разнарядка | Дашборд,
 *                dark glass table, сортировки, выпадашки, KPI/ApexCharts
 */
type TransportEngine = 'glide' | 'tabulator' | 'grok';

const ENGINES: { id: TransportEngine; label: string; title: string }[] = [
  { id: 'glide', label: 'Glide', title: 'Боевой грид (Glide)' },
  { id: 'tabulator', label: 'Tabulator', title: 'Tabulator + светлая тема Flow' },
  { id: 'grok', label: 'Grok', title: 'Grok: разнарядка + дашборд' },
];

export function TransportScreen(): JSX.Element {
  const { t } = useTranslation();
  const [engine, setEngine] = useState<TransportEngine>('grok');
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_transport', 'Транспорт')}
        </span>
        <div
          className="no-drag-region ml-auto flex items-center rounded-lg border border-black/10 p-0.5"
          role="group"
          aria-label="Движок / UI транспорта"
        >
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.title}
              onClick={() => setEngine(e.id)}
              data-active={engine === e.id ? 'true' : 'false'}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                engine === e.id ? 'bg-black/[0.08] text-text-strong' : 'text-text-muted hover:text-text-strong'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <WorkspaceCard>
        {engine === 'glide' ? (
          <FlowTransportGrid />
        ) : engine === 'grok' ? (
          <FlowTransportGrok />
        ) : (
          <FlowTabulatorTransport theme="classic" />
        )}
      </WorkspaceCard>
    </main>
  );
}
