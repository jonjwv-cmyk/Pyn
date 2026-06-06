import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { cn } from '@/lib/cn';
import { FlowSandboxGrid } from './FlowSandboxGrid';
import { FlowOrderUploadButton } from './FlowOrderUploadButton';

/** Этапы плана: формирование → план → отчёт (как в Google-процессе). */
type FlowStage = 'form' | 'plan' | 'report';

/**
 * «Поток» (β) — раздел собственного табличного реестра (миграция с Google Sheets).
 * В панели — этапы `Формирование → План → Отчёт`, рядом контекстная кнопка этапа
 * (Формирование → «Выгрузка заказов»; План → «Сформировать план» — позже; Отчёт →
 * авто-пополнение — позже). Сейчас рабочий только этап Формирование (грид на живой
 * базе); План/Отчёт — следующий крупный этап. Виден admin/developer (гейт `showFlow`).
 */
export function FlowScreen(): JSX.Element {
  const { t } = useTranslation();
  const [stage, setStage] = useState<FlowStage>('form');
  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_flow')}
        </span>
        <span className="no-drag-region rounded-full border border-border-subtle px-1.5 py-px text-[10px] font-medium leading-none text-text-muted/80">
          β
        </span>
        {/* Этапы плана. План/Отчёт — заглушки (следующий этап). */}
        <div className="no-drag-region ml-1 flex items-center gap-1">
          <StageSeg label="Формирование" active={stage === 'form'} onClick={() => setStage('form')} />
          <StageArrow />
          <StageSeg label="План" active={stage === 'plan'} disabled onClick={() => setStage('plan')} />
          <StageArrow />
          <StageSeg label="Отчёт" active={stage === 'report'} disabled onClick={() => setStage('report')} />
        </div>
        {/* Контекстная кнопка текущего этапа. */}
        <div className="no-drag-region ml-auto flex items-center gap-2">
          {stage === 'form' && <FlowOrderUploadButton />}
        </div>
      </div>
      <WorkspaceCard>
        {stage === 'form' ? <FlowSandboxGrid /> : <StagePlaceholder stage={stage} />}
      </WorkspaceCard>
    </main>
  );
}

/** Сегмент этапа: активный — clay-полоска снизу (как активная вкладка); disabled — приглушён + «скоро». */
function StageSeg({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Скоро' : undefined}
      className={cn(
        'relative px-1.5 py-0.5 text-[12px] outline-none transition-colors',
        active ? 'font-medium text-text-strong' : 'text-text-muted/70',
        disabled ? 'cursor-default opacity-50' : 'hover:text-text-secondary',
      )}
    >
      {label}
      {active && <span className="absolute inset-x-1 -bottom-[3px] h-[2px] rounded-full bg-accent-clay" />}
    </button>
  );
}

function StageArrow(): JSX.Element {
  return <span className="select-none text-[11px] text-text-muted/40">→</span>;
}

/** Заглушка этапов План/Отчёт (следующий крупный этап). */
function StagePlaceholder({ stage }: { stage: FlowStage }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-[13px] text-text-muted/70">
      <span className="text-[14px] font-medium text-text-secondary">
        {stage === 'plan' ? 'План' : 'Отчёт'}
      </span>
      <span>Этап в разработке — скоро.</span>
    </div>
  );
}
