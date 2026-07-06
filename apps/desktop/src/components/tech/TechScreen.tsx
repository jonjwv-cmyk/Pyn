import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';

const TECH_URL = 'https://pynflow.ru/';

/**
 * Раздел «Технология» — встроенный публичный логистический борт pynflow.ru
 * (заявки цехов · кладовщики 9010/9030 · машины 7.1/7.2 · рейсы · статус ГЛОНАСС).
 * Открывается прямо в приложении через Electron `<webview>`; сайт сам тянет
 * данные с нашего сервера (`/board`). Admin/developer-only (как Поток/Карта),
 * always-mounted (display-toggle в App.tsx) — не перезагружается при переключении
 * разделов; собственный `persist:pynflow` partition держит сессию борта.
 *
 * Как остальные вкладки (юзер 2026-07-06): шапка на подложке + борт в «плавающей
 * карточке» WorkspaceCard (тонкий border + тень + gutter), а не голым блоком —
 * данные лежат «на подложке», в единой скруглённой рамке.
 */
export function TechScreen(): JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_tech', 'Технология')}
        </span>
      </div>
      <WorkspaceCard>
        <webview
          src={TECH_URL}
          partition="persist:pynflow"
          allowpopups
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#e8e8ed',
          }}
        />
      </WorkspaceCard>
    </main>
  );
}
