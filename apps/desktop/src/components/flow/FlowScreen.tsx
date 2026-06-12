import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleLockAcquiredEvent, ScheduleLockReleasedEvent } from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { cn } from '@/lib/cn';
import { useEditLock } from '@/lib/schedule/use-edit-lock';
import { useWsEvent } from '@/lib/ws';
import { sessionStore } from '@/lib/token-store';
import { useUsersStore } from '@/lib/stores';
import { FlowSandboxGrid } from './FlowSandboxGrid';
import { FlowPlanGrid } from './FlowPlanGrid';
import { FlowPlanFormButton } from './FlowPlanFormButton';
import { FlowPlanFixButton } from './FlowPlanFixButton';
import { FlowOrderUploadButton } from './FlowOrderUploadButton';
import { FlowImportIndicator, type FlowImportRunner } from './FlowImportIndicator';

/** Этапы плана: формирование → план → отчёт. Транспорт — отдельный раздел сайдбара. */
type FlowStage = 'form' | 'plan' | 'report';

/** Общий lock «идёт выгрузка заказов» — один на всех; держит инициатор, видят остальные. */
const FLOW_IMPORT_LOCK = 'flow_import:running';

/**
 * «Поток» (β) — раздел собственного табличного реестра (миграция с Google Sheets).
 * В панели — этапы `Формирование → План → Отчёт`, рядом контекстная кнопка этапа
 * (Формирование → «Выгрузка заказов»; План → «Сформировать план» — позже; Отчёт →
 * авто-пополнение — позже). Сейчас рабочий только этап Формирование (грид на живой
 * базе); План/Отчёт — следующий крупный этап. Виден admin/developer (гейт `showFlow`).
 */
export function FlowScreen(): JSX.Element {
  const { t } = useTranslation();
  const users = useUsersStore((s) => s.users);
  const [stage, setStage] = useState<FlowStage>('form');
  // Окно-блокировка на время выгрузки заказов (пароль — у самой кнопки). Инициатор держит
  // общий lock (heartbeat + авто-истечение при зависании); остальные видят, кто запустил.
  const [selfRunning, setSelfRunning] = useState(false);
  const [runner, setRunner] = useState<FlowImportRunner | null>(null);
  const [myLogin, setMyLogin] = useState('');
  const myLoginRef = useRef('');
  useEffect(() => {
    sessionStore
      .load()
      .then((s) => {
        if (s?.user?.login) {
          setMyLogin(s.user.login);
          myLoginRef.current = s.user.login;
        }
      })
      .catch(() => {});
  }, []);
  useEditLock(FLOW_IMPORT_LOCK, selfRunning);
  useWsEvent<ScheduleLockAcquiredEvent>('schedule_lock_acquired', (e) => {
    // Сверяем с myLoginRef (всегда актуален, не зависит от async-загрузки сессии) —
    // иначе своё же событие могло сесть как «чужой» и залипнуть в индикаторе/блокировке.
    if (e.resource_id !== FLOW_IMPORT_LOCK || e.user_login === myLoginRef.current) return;
    setRunner({
      login: String(e.user_login || ''),
      name: String(e.full_name || e.user_login || ''),
      avatarUrl: String(e.avatar_url || ''),
      avatarBlobKey: String(e.avatar_blob_key || ''),
      avatarBlobNonce: String(e.avatar_blob_nonce || ''),
    });
  });
  useWsEvent<ScheduleLockReleasedEvent>('schedule_lock_released', (e) => {
    if (e.resource_id === FLOW_IMPORT_LOCK) setRunner(null);
  });
  // Подстраховка: индикатор чужой выгрузки сам гаснет, если событие «снят» потерялось
  // (через 4 мин прогон точно завершён) — чтобы ничего не залипало.
  useEffect(() => {
    if (!runner) return;
    const t = window.setTimeout(() => setRunner(null), 4 * 60 * 1000);
    return () => window.clearTimeout(t);
  }, [runner]);
  // Кто сейчас гонит выгрузку (другой по WS-локу ИЛИ я сам) — для мягкого индикатора.
  const me = users.find((u) => u.login === myLogin);
  const selfRunner: FlowImportRunner | null = selfRunning
    ? {
        login: myLogin,
        name: me?.fullName || myLogin,
        avatarUrl: me?.avatarUrl,
        avatarBlobKey: me?.avatarBlobKey ?? undefined,
        avatarBlobNonce: me?.avatarBlobNonce ?? undefined,
      }
    : null;
  const activeRunner = runner ?? selfRunner;
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_flow')}
        </span>
        {/* Этапы плана. Отчёт — заглушка (следующий этап). */}
        <div className="no-drag-region ml-1 flex items-center gap-1">
          <StageSeg label="Формирование" active={stage === 'form'} onClick={() => setStage('form')} />
          <StageArrow />
          <StageSeg label="План" active={stage === 'plan'} onClick={() => setStage('plan')} />
          <StageArrow />
          <StageSeg label="Отчёт" active={stage === 'report'} onClick={() => setStage('report')} />
        </div>
        {/* Мягкий индикатор выгрузки (кто запустил) + контекстная кнопка этапа. */}
        <div className="no-drag-region ml-auto flex items-center gap-2">
          {activeRunner && <FlowImportIndicator runner={activeRunner} />}
          {stage === 'form' && (
            <FlowOrderUploadButton onRunningChange={setSelfRunning} blocked={runner != null} />
          )}
          {stage === 'plan' && (
            <>
              <FlowPlanFormButton />
              <FlowPlanFixButton />
            </>
          )}
          {/* Кнопка «Сверка zm_vl» убрана из Отчёта (юзер 2026-06-12, п.7): её роль теперь
              выполняет кнопка-скрипт zm_vl в сайдбаре. Компонент FlowZmVlButton оставлен. */}
        </div>
      </div>
      <WorkspaceCard>
        {stage === 'form' ? (
          <FlowSandboxGrid />
        ) : stage === 'plan' ? (
          <FlowPlanGrid />
        ) : (
          <FlowPlanGrid mode="report" />
        )}
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
