import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { PynLoader } from '@/components/ui/PynLoader';
import { computeInitials } from '@/lib/initials';
import { usePresenceStore } from '@/lib/stores';

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
 * аватар СО СТАТУСОМ (из единого presence — как везде) + ФИО инициатора + «Выгрузка
 * заказов» + лоадер. Все видят, кто запустил, и при этом продолжают работать как обычно
 * (лист НЕ блокируется; редкий конфликт правки с прогоном разрешает сервер).
 */
export function FlowImportIndicator({ runner }: { runner: FlowImportRunner }): JSX.Element {
  const initials = computeInitials(runner.name || runner.login);
  const presence = usePresenceStore((s) => s.byLogin[runner.login])?.status ?? 'offline';
  return (
    <div
      className="no-drag-region flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-surface/60 py-0.5 pl-0.5 pr-2.5"
      role="status"
      aria-live="polite"
      title={`${runner.name || runner.login} — идёт выгрузка заказов`}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <Avatar
          initials={initials}
          size={20}
          login={runner.login || undefined}
          avatarUrl={runner.avatarUrl}
          avatarBlobKey={runner.avatarBlobKey}
          avatarBlobNonce={runner.avatarBlobNonce}
        />
        <PresenceDot state={presence} size={7} ringClass="ring-bg-surface" className="absolute -bottom-0.5 -right-0.5" />
      </span>
      <span className="max-w-[130px] truncate text-[11.5px] font-medium text-text-secondary">
        {runner.name || runner.login}
      </span>
      <span className="text-[11.5px] text-text-muted/70">· Выгрузка заказов</span>
      <PynLoader size="sm" />
    </div>
  );
}
