import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { WorkspaceCard } from '@/components/WorkspaceCard';

const TECH_URL = 'https://pynflow.ru/';

/**
 * Раздел «Технология» — встроенный публичный логистический борт pynflow.ru
 * (заявки цехов · кладовщики 9010/9030 · машины 7.1/7.2 · рейсы · статус ГЛОНАСС).
 * Открывается прямо в приложении через Electron `<webview>`; сайт сам тянет
 * данные с нашего сервера (`/board`). Admin/developer-only (как Поток/Карта),
 * always-mounted (display-toggle в App.tsx) — не перезагружается при переключении
 * разделов; собственный `persist:pynflow` partition держит сессию борта.
 */
export function TechScreen() {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);

  const reload = () => {
    (ref.current as (HTMLElement & { reload?: () => void }) | null)?.reload?.();
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_tech', 'Технология')}
        </span>
        <span className="no-drag-region text-[11px] text-text-muted">· логистический борт</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={reload}
          title="Обновить"
          className="no-drag-region flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-secondary"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <WorkspaceCard>
        <div className="relative flex min-h-0 flex-1">
          <webview
            ref={ref}
            src={TECH_URL}
            partition="persist:pynflow"
            allowpopups
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              backgroundColor: '#15171b',
            }}
          />
        </div>
      </WorkspaceCard>
    </main>
  );
}
