import { Avatar } from '@/components/ui/Avatar';
import { PynLoader } from '@/components/ui/PynLoader';
import { computeInitials } from '@/lib/initials';

/** Кто запустил выгрузку заказов (из события общего lock'а `flow_import:running` или сам инициатор). */
export interface FlowImportRunner {
  login: string;
  name: string;
  avatarUrl?: string;
  avatarBlobKey?: string;
  avatarBlobNonce?: string;
}

/**
 * Мягкий индикатор «идёт выгрузка заказов» в шапке раздела «Поток» (НЕ окно-блок):
 * маленький аватар + ФИО инициатора + «Выгрузка заказов» + лоадер. Все видят, кто
 * запустил, и продолжают работать — на время прогона лист становится «только просмотр»
 * (см. FlowScreen → FlowSandboxGrid readOnly), чтобы перезапись не затёрла чью-то правку.
 */
export function FlowImportIndicator({ runner }: { runner: FlowImportRunner }): JSX.Element {
  const initials = computeInitials(runner.name || runner.login);
  return (
    <div
      className="no-drag-region flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface/60 py-0.5 pl-0.5 pr-2.5"
      role="status"
      aria-live="polite"
      title={`${runner.name || runner.login} — идёт выгрузка заказов (лист только для просмотра)`}
    >
      <Avatar
        initials={initials}
        size={20}
        login={runner.login || undefined}
        avatarUrl={runner.avatarUrl}
        avatarBlobKey={runner.avatarBlobKey}
        avatarBlobNonce={runner.avatarBlobNonce}
      />
      <span className="max-w-[130px] truncate text-[11.5px] font-medium text-text-secondary">
        {runner.name || runner.login}
      </span>
      <span className="text-[11.5px] text-text-muted/70">· Выгрузка заказов</span>
      <PynLoader size="sm" />
    </div>
  );
}
