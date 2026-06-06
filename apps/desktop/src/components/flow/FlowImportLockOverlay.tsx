import { Avatar } from '@/components/ui/Avatar';
import { PynLoader } from '@/components/ui/PynLoader';
import { computeInitials } from '@/lib/initials';

/** Кто запустил выгрузку заказов (из события общего lock'а `flow_import:running`). */
export interface FlowImportRunner {
  login: string;
  name: string;
  avatarUrl?: string;
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
}

/**
 * Полноэкранное окно-блокировка раздела «Поток», пока КТО-ТО гонит выгрузку заказов
 * (как overlay скрипта на Google-листе): аватар + ФИО инициатора + «запущена выгрузка
 * заказов» + индикатор. Перехватывает клики (pointer-events:auto) — другой не запустит
 * выгрузку параллельно. Сам инициатор окна не видит (у него спиннер на кнопке).
 */
export function FlowImportLockOverlay({ runner }: { runner: FlowImportRunner }): JSX.Element {
  const initials = computeInitials(runner.name || runner.login);
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-bg-deep/55 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <Avatar
          initials={initials}
          size={56}
          login={runner.login || undefined}
          avatarUrl={runner.avatarUrl}
          avatarBlobKey={runner.avatarBlobKey}
          avatarBlobNonce={runner.avatarBlobNonce}
        />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.005em] text-text-strong">
            {runner.name || runner.login}
          </h2>
          <p className="flex items-center gap-2 text-[13px] leading-relaxed text-text-secondary">
            запущена выгрузка заказов
            <PynLoader size="sm" />
          </p>
        </div>
      </div>
    </div>
  );
}
