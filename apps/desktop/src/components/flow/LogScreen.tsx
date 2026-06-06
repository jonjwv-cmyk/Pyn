import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flowImportRunsGet, type FlowImportRun, type FlowImportLoggedEvent } from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { useUsersStore } from '@/lib/stores';
import { computeInitials } from '@/lib/initials';
import { formatDateRu } from './flow-sandbox.fixtures';

/** «YYYY-MM-DD HH:MM:SS» (UTC, без Z от сервера) ИЛИ ISO → миллисекунды UTC. */
function parseUtcMs(s: string): number {
  if (!s) return NaN;
  let t = s.trim().replace(' ', 'T');
  if (!/[Zz]|[+-]\d\d:?\d\d$/.test(t)) t += 'Z';
  return Date.parse(t);
}

/** Длительность прогона (нажатие → полное завершение пересчёта) — «N мин M с» / «M с». */
function fmtDuration(startedAt: string, finishedAt: string): string {
  const ms = parseUtcMs(finishedAt) - parseUtcMs(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m > 0 ? `${m} мин ${sec} с` : `${sec} с`;
}

/** Одна цифра-итог прогона: значение + подпись (скрыта, если 0). */
function Stat({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'warn' | 'muted' }): JSX.Element | null {
  if (!n) return null;
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-rose-600' : 'text-text-secondary';
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className={`text-[13px] font-semibold tabular-nums ${color}`}>{n}</span>
      <span className="text-[11px] text-text-muted/80">{label}</span>
    </span>
  );
}

/**
 * Раздел «LOG» — журнал прогонов выгрузки заказов: кто/когда запускал и итоги
 * (новых/правок/снято OFF/вернулось/смен складов/в ВГХ) + длительность от нажатия
 * до полного завершения пересчёта. Чтение `flow_import_runs_get` + реалтайм-добавление
 * новых записей сверху (`flow_import_logged`). Admin/developer-only (гейт `showLog`).
 */
export function LogScreen(): JSX.Element {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<FlowImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const users = useUsersStore((s) => s.users);

  useEffect(() => {
    let alive = true;
    flowImportRunsGet(api)
      .then((list) => { if (alive) setRuns(list); })
      .catch(() => { /* пусто — покажем 0 записей */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Реалтайм: завершённый прогон — добавляем сверху (если ещё нет по id).
  useWsEvent<FlowImportLoggedEvent>('flow_import_logged', (e) => {
    const run = e.run as unknown as FlowImportRun;
    if (!run || !run.id) return;
    setRuns((prev) => (prev.some((r) => r.id === run.id) ? prev : [run, ...prev]));
  });

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          {t('sidebar.nav_log')}
        </span>
      </div>
      <WorkspaceCard>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
          {loading && <div className="py-8 text-center text-[13px] text-text-muted">Загрузка журнала…</div>}
          {!loading && runs.length === 0 && (
            <div className="py-8 text-center text-[13px] text-text-muted">Выгрузок ещё не было.</div>
          )}
          <div className="flex flex-col gap-1.5">
            {runs.map((r) => {
              const user = users.find((u) => u.login === r.login);
              const name = r.full_name || r.login || '—';
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface/40 px-3 py-2"
                >
                  <Avatar
                    initials={user?.initials || computeInitials(name)}
                    size={32}
                    login={r.login || undefined}
                    avatarUrl={user?.avatarUrl}
                    avatarBlobKey={user?.avatarBlobKey ?? undefined}
                    avatarBlobNonce={user?.avatarBlobNonce ?? undefined}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium text-text-strong">{name}</span>
                      <span className="text-[12px] text-text-secondary">· Выгрузка заказов</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-text-muted/80">
                      <span>{formatDateRu(r.started_at)}</span>
                      {fmtDuration(r.started_at, r.finished_at) && (
                        <span className="text-text-secondary">· за {fmtDuration(r.started_at, r.finished_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    <Stat n={r.inserted} label="новых" tone="good" />
                    <Stat n={r.updated} label="правок" />
                    <Stat n={r.to_changed} label="смен складов" />
                    <Stat n={r.off_marked} label="снято OFF" tone="warn" />
                    <Stat n={r.reappeared} label="вернулось" tone="good" />
                    <Stat n={r.staging_upserted} label="в ВГХ" />
                    <Stat n={r.received} label="всего" tone="muted" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </WorkspaceCard>
    </main>
  );
}
