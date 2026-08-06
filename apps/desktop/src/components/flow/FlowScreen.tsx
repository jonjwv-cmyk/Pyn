import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleLockAcquiredEvent, ScheduleLockReleasedEvent } from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { WorkspaceSurfaceToggle } from '@/components/WorkspaceSurfaceToggle';
import { useWorkspaceSurface } from '@/lib/workspace-surface';
import '@/components/workspace-surface.css';
import { useEditLock } from '@/lib/schedule/use-edit-lock';
import { useWsEvent } from '@/lib/ws';
import { sessionStore } from '@/lib/token-store';
import { useUsersStore } from '@/lib/stores';
import { FlowTabulatorForm } from './flow-tabulator-form';
import { FlowPlanGrid } from './FlowPlanGrid';
import { FlowPlanCreateButton } from './FlowPlanCreateButton';
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
  // Светлый «бумажный» / тёмный лист — ОДИН механизм с Транспортом
  // (WorkspaceSurfaceToggle в верхней панели, не свой переключатель внутри грида).
  const surface = useWorkspaceSurface('flow');
  // План/Отчёт — mount после первого захода (не вместе с Формированием при входе
  // в Поток). Иначе сразу 2 МБ workflow + 0.6 МБ deliveries + liveRows×2. После
  // визита keep-alive (display), дни — module-cache.
  const [planVisited, setPlanVisited] = useState(false);
  useEffect(() => {
    if (stage === 'plan' || stage === 'report') setPlanVisited(true);
  }, [stage]);
  // Выбранный день календаря Плана — для кнопки «Создание поставок» (черновики+SAP сразу).
  const [planDay, setPlanDay] = useState<string | null>(null);
  // Окно-блокировка на время выгрузки заказов (пароль — у самой кнопки). Инициатор держит
  // общий lock (heartbeat + авто-истечение при зависании); остальные видят, кто запустил.
  const [selfRunning, setSelfRunning] = useState(false);
  const [runner, setRunner] = useState<FlowImportRunner | null>(null);
  const [myLogin, setMyLogin] = useState('');
  const [myFullName, setMyFullName] = useState('');
  const myLoginRef = useRef('');
  useEffect(() => {
    sessionStore
      .load()
      .then((s) => {
        if (s?.user?.login) {
          setMyLogin(s.user.login);
          myLoginRef.current = s.user.login;
          // ФИО из сессии — надёжный источник (§6, юзер 2026-07-03): у суперадмина
          // в users-store могло не быть fullName → индикатор показывал логин.
          if (s.user.fullName) setMyFullName(s.user.fullName);
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
        name: me?.fullName || myFullName || myLogin,
        avatarUrl: me?.avatarUrl,
        avatarBlobKey: me?.avatarBlobKey ?? undefined,
        avatarBlobNonce: me?.avatarBlobNonce ?? undefined,
      }
    : null;
  const activeRunner = runner ?? selfRunner;
  /** Этапы — pyn-segment как Разнарядка|Дашборд в Транспорте (в chrome грида). */
  const stageTabs = (
    <div className="pyn-segment" role="tablist" aria-label="Этапы потока">
      {(
        [
          { id: 'form' as const, label: 'Формирование' },
          { id: 'plan' as const, label: 'План' },
          { id: 'report' as const, label: 'Отчёт' },
        ] as const
      ).map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={stage === s.id}
          data-active={stage === s.id ? 'true' : 'false'}
          onClick={() => setStage(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden" data-pyn-surface={surface}>
      {/* Верхняя полоса как у Транспорта: только название + действия раздела. */}
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_flow')}
        </span>
        <div className="flex-1" />
        <div className="no-drag-region flex items-center gap-2">
          {activeRunner && <FlowImportIndicator runner={activeRunner} />}
          <WorkspaceSurfaceToggle section="flow" />
          {stage === 'form' && (
            <FlowOrderUploadButton onRunningChange={setSelfRunning} blocked={runner != null} />
          )}
          {stage === 'plan' && (
            <>
              <FlowPlanCreateButton selectedDay={planDay} />
              <FlowPlanFixButton />
            </>
          )}
        </div>
      </div>
      <WorkspaceCard>
        {/* ALWAYS-MOUNTED (display-toggle). Этапы — в chrome грида (как вкладки Транспорта). */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: stage === 'form' ? 'flex' : 'none' }}
        >
          <FlowTabulatorForm active={stage === 'form'} chromeLeading={stageTabs} />
        </div>
        {planVisited && (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            style={{ display: stage !== 'form' ? 'flex' : 'none' }}
          >
            {/* Chrome этапов на Плане/Отчёте — тот же pyn-table-chrome, что у Транспорта. */}
            <div
              className="pyn-table-root flex shrink-0 flex-col"
              data-pyn-table-theme="grok"
            >
              <div className="pyn-table-chrome flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
                <div className="flex shrink-0 items-center">{stageTabs}</div>
              </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <FlowPlanGrid
                mode={stage === 'report' ? 'report' : 'plan'}
                onSelectedDayChange={setPlanDay}
                active={stage !== 'form'}
              />
            </div>
          </div>
        )}
      </WorkspaceCard>
    </main>
  );
}
