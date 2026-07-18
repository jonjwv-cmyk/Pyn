import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  flowImportRunsGet,
  flowMolsRunsGet,
  flowScriptRunsGet,
  flowSapRunsGet,
  type FlowImportRun,
  type FlowImportLoggedEvent,
  type FlowMolsLoggedEvent,
  type FlowMolsRun,
  type FlowScriptRun,
  type FlowScriptLoggedEvent,
  type FlowSapRun,
} from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { useUsersStore, usePresenceStore } from '@/lib/stores';
import { computeInitials } from '@/lib/initials';
import { formatFullYek } from '@/lib/format-time';

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


/**
 * Раздел «LOG» — журнал прогонов выгрузки заказов: кто/когда запускал и итоги
 * (новых/правок/снято OFF/вернулось/смен складов/в ВГХ) + длительность от нажатия
 * до полного завершения пересчёта. Чтение `flow_import_runs_get` + реалтайм-добавление
 * новых записей сверху (`flow_import_logged`). Admin/developer-only (гейт `showLog`).
 *
 * Экран always-mounted (display-toggle в App) — журнал ПЕРЕЧИТЫВАЕТСЯ при каждом
 * ОТКРЫТИИ раздела (юзер 2026-07-04: прогон был в БД, а в LOG не появился — WS-пуш
 * `flow_import_logged` во время 70-сек SAP-прогона легко теряется на reconnect'е).
 * Не polling: чтение только по действию юзера, с троттлом 15 с.
 */
export function LogScreen({ active = true }: { active?: boolean } = {}): JSX.Element {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<FlowImportRun[]>([]);
  const [scriptRuns, setScriptRuns] = useState<FlowScriptRun[]>([]);
  const [sapRuns, setSapRuns] = useState<FlowSapRun[]>([]);
  const [molsRuns, setMolsRuns] = useState<FlowMolsRun[]>([]);
  const [loading, setLoading] = useState(true);
  const users = useUsersStore((s) => s.users);
  // Presence — из единого источника (как у всех аватаров): статус-точка на аватаре прогона.
  const presenceByLogin = usePresenceStore((s) => s.byLogin);

  const lastFetchRef = useRef(0);
  const fetchAll = useCallback(() => {
    lastFetchRef.current = Date.now();
    let alive = true;
    // Каждое чтение со своим catch: сбой одного журнала не прячет остальные.
    Promise.all([
      flowImportRunsGet(api).catch(() => [] as FlowImportRun[]),
      flowScriptRunsGet(api).catch(() => []),
      flowSapRunsGet(api).catch(() => []),
      flowMolsRunsGet(api).catch(() => []),
    ])
      .then(([imp, scr, sap, mols]) => {
        if (!alive) return;
        if (imp.length > 0) setRuns(imp);
        if (scr.length > 0) setScriptRuns(scr);
        if (sap.length > 0) setSapRuns(sap);
        if (mols.length > 0) setMolsRuns(mols);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => fetchAll(), [fetchAll]);
  // Открытие раздела — перечитать (свежая правда сервера), не чаще раза в 15 с.
  useEffect(() => {
    if (!active || Date.now() - lastFetchRef.current < 15_000) return undefined;
    return fetchAll();
  }, [active, fetchAll]);

  // Реалтайм: завершённый прогон выгрузки — добавляем сверху (если ещё нет по id).
  useWsEvent<FlowImportLoggedEvent>('flow_import_logged', (e) => {
    const run = e.run as unknown as FlowImportRun;
    if (!run || !run.id) return;
    setRuns((prev) => (prev.some((r) => r.id === run.id) ? prev : [run, ...prev]));
  });
  // Реалтайм: нажата кнопка-скрипт — добавляем строку сверху.
  useWsEvent<FlowMolsLoggedEvent>('flow_mols_logged', (e) => {
    const run = e.run as unknown as FlowMolsRun;
    if (!run || !run.id) return;
    setMolsRuns((prev) => (prev.some((r) => r.id === run.id) ? prev : [run, ...prev]));
  });
  useWsEvent<FlowScriptLoggedEvent>('flow_script_logged', (e) => {
    const w = e.run;
    if (!w || !w.id) return;
    const run: FlowScriptRun = {
      id: Number(w.id), scriptId: String(w.script_id || ''),
      login: String(w.login || ''), fullName: String(w.full_name || ''), at: String(w.at || ''),
    };
    setScriptRuns((prev) => (prev.some((r) => r.id === run.id) ? prev : [run, ...prev]));
  });

  // Единая лента: выгрузки заказов + нажатия кнопок-скриптов, новые сверху (по времени).
  const SCRIPT_LABEL: Record<string, string> = {
    obd: 'OBD · выгрузка заказов', zmvl: 'zm_vl · сверка', sed: 'СЭД', mols: 'МОЛы',
  };
  const timeline = useMemo(() => {
    const items: Array<
      | { kind: 'import'; ts: number; run: FlowImportRun }
      | { kind: 'script'; ts: number; run: FlowScriptRun }
      | { kind: 'sap'; ts: number; run: FlowSapRun }
      | { kind: 'mols'; ts: number; run: FlowMolsRun }
    > = [];
    for (const r of runs) items.push({ kind: 'import', ts: parseUtcMs(r.started_at), run: r });
    // scriptId «mols» = клик кнопки; полный итог импорта — в molsRuns («База МОЛов»).
    // Раньше обе строки попадали в ленту: сверху пустая «· МОЛы», ниже с данными (ТЗ 17.07 п.2г).
    for (const r of scriptRuns) {
      if (r.scriptId === 'mols') continue;
      items.push({ kind: 'script', ts: parseUtcMs(r.at), run: r });
    }
    for (const r of sapRuns) items.push({ kind: 'sap', ts: parseUtcMs(r.started_at), run: r });
    for (const r of molsRuns) items.push({ kind: 'mols', ts: parseUtcMs(r.started_at), run: r });
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return items;
  }, [runs, scriptRuns, sapRuns, molsRuns]);

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
          {!loading && timeline.length === 0 && (
            <div className="py-8 text-center text-[13px] text-text-muted">Записей ещё не было.</div>
          )}
          <div className="flex flex-col gap-1.5">
            {timeline.map((item) => {
              // Прогон подгрузки SAP (zm_vl/СЭД) — мониторинг: кто · что · итоги · ошибка.
              if (item.kind === 'sap') {
                const s = item.run;
                const u = users.find((x) => x.login === s.login);
                const nm = s.full_name || s.login || '—';
                const pres = presenceByLogin[s.login]?.status ?? 'offline';
                const dur = fmtDuration(s.started_at, s.finished_at);
                const label =
                  s.kind === 'sed'
                    ? 'СЭД · подгрузка'
                    : `zm_vl · сверка (${s.full_load ? 'все' : 'открытые'})`;
                return (
                  <div
                    key={`sap${s.id}`}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                      s.ok
                        ? 'border-border-subtle bg-bg-surface/40'
                        : 'border-rose-300/60 bg-rose-50/40'
                    }`}
                  >
                    <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                      <Avatar
                        initials={u?.initials || computeInitials(nm)}
                        size={32}
                        login={s.login || undefined}
                        avatarUrl={u?.avatarUrl}
                        avatarBlobKey={u?.avatarBlobKey ?? undefined}
                        avatarBlobNonce={u?.avatarBlobNonce ?? undefined}
                      />
                      <PresenceDot state={pres} size={10} ringClass="ring-bg-surface" className="absolute -bottom-0.5 -right-0.5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="max-w-[220px] truncate text-[13px] font-medium text-text-strong" title={nm}>
                          {nm}
                        </span>
                        <span className="text-[12px] text-accent-clay">· {label}</span>
                        <span className="text-[11px] text-text-muted/80">{formatFullYek(s.started_at)}</span>
                        {dur && <span className="text-[11px] text-text-secondary">· за {dur}</span>}
                      </div>
                      {s.ok ? (
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-text-secondary">
                          <span>получено {s.received}</span>
                          {s.assigned > 0 && <span>· создано {s.assigned}</span>}
                          {s.updated > 0 && <span>· обновлено {s.updated}</span>}
                          {s.inserted > 0 && <span>· добавлено {s.inserted}</span>}
                          {s.reserved > 0 && <span className="text-rose-600">· в резерв {s.reserved}</span>}
                          <span className="text-text-muted/60">
                            (поставок {s.total_before} → {s.total_after})
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11.5px] text-rose-600" title={s.error}>
                          ошибка: {s.error || 'нет данных'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (item.kind === 'mols') {
                const s = item.run as typeof item.run & {
                  action?: string;
                  contacts_new?: number;
                  wh_empty_before?: number;
                  wh_empty_after?: number;
                  wh_empty_codes?: string;
                  version_from?: string;
                  version_to?: string;
                };
                const u = users.find((x) => x.login === s.login);
                const nm = s.full_name || s.login || '—';
                const pres = presenceByLogin[s.login]?.status ?? 'offline';
                const dur = fmtDuration(s.started_at, s.finished_at);
                const isRestore = (s.action || 'import') === 'restore';
                const delta = s.mol_after - s.mol_before;
                const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
                const cNew = Number(s.contacts_new ?? s.new_count ?? 0);
                const whB = Number(s.wh_empty_before ?? 0);
                const whA = Number(s.wh_empty_after ?? 0);
                const whD = whA - whB;
                const whDs = whD > 0 ? `+${whD}` : whD < 0 ? `${whD}` : '±0';
                return (
                  <div
                    key={`mols${s.id}`}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                      s.ok
                        ? 'border-border-subtle bg-bg-surface/40'
                        : 'border-rose-300/60 bg-rose-50/40'
                    }`}
                  >
                    <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                      <Avatar
                        initials={u?.initials || computeInitials(nm)}
                        size={32}
                        login={s.login || undefined}
                        avatarUrl={u?.avatarUrl}
                        avatarBlobKey={u?.avatarBlobKey ?? undefined}
                        avatarBlobNonce={u?.avatarBlobNonce ?? undefined}
                      />
                      <PresenceDot state={pres} size={10} ringClass="ring-bg-surface" className="absolute -bottom-0.5 -right-0.5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="max-w-[220px] truncate text-[13px] font-medium text-text-strong" title={nm}>
                          {nm}
                        </span>
                        <span className="text-[12px] text-accent-clay">
                          {isRestore ? '· Откат базы контактов' : '· База МОЛов'}
                        </span>
                        <span className="text-[11px] text-text-muted/80">{formatFullYek(s.started_at)}</span>
                        {dur && <span className="text-[11px] text-text-secondary">· за {dur}</span>}
                      </div>
                      {s.ok ? (
                        isRestore ? (
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-text-secondary">
                            <span>
                              версия {s.version_from || '—'} → {s.version_to || '—'}
                            </span>
                            <span>МОЛ {s.mol_after}</span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-text-secondary">
                            <span className="text-emerald-700/90">Контакты: +{cNew} новых</span>
                            <span>
                              МОЛ: было {s.mol_before} → стало {s.mol_after} ({deltaStr})
                            </span>
                            <span title={s.wh_empty_codes || undefined}>
                              Склады без МОЛ: было {whB} → стало {whA} ({whDs})
                              {s.wh_empty_codes ? `: ${s.wh_empty_codes}` : ''}
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="text-[11.5px] text-rose-600" title={s.error}>
                          ошибка: {s.error || 'нет данных'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              // Нажатие кнопки-скрипта — компактная строка (кто · что · когда).
              if (item.kind === 'script') {
                const s = item.run;
                const u = users.find((x) => x.login === s.login);
                const nm = s.fullName || s.login || '—';
                const pres = presenceByLogin[s.login]?.status ?? 'offline';
                return (
                  <div
                    key={`s${s.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface/40 px-3 py-1.5"
                  >
                    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
                      <Avatar
                        initials={u?.initials || computeInitials(nm)}
                        size={28}
                        login={s.login || undefined}
                        avatarUrl={u?.avatarUrl}
                        avatarBlobKey={u?.avatarBlobKey ?? undefined}
                        avatarBlobNonce={u?.avatarBlobNonce ?? undefined}
                      />
                      <PresenceDot state={pres} size={9} ringClass="ring-bg-surface" className="absolute -bottom-0.5 -right-0.5" />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="max-w-[220px] truncate text-[13px] font-medium text-text-strong" title={nm}>
                        {nm}
                      </span>
                      <span className="text-[12px] text-accent-clay">· {SCRIPT_LABEL[s.scriptId] ?? s.scriptId}</span>
                      <span className="text-[11px] text-text-muted/80">{formatFullYek(s.at)}</span>
                    </div>
                  </div>
                );
              }
              const r = item.run;
              const user = users.find((u) => u.login === r.login);
              const name = r.full_name || r.login || '—';
              const presence = presenceByLogin[r.login]?.status ?? 'offline';
              const dur = fmtDuration(r.started_at, r.finished_at);
              const delta = r.total_after - r.total_before;
              const hasTotals = r.total_before > 0 || r.total_after > 0;
              const failed = Number(r.ok ?? 1) === 0;
              // «Тихий» прогон — формирование не изменилось и в ВГХ ничего не подтянулось.
              const quiet = delta === 0 && !r.staging_upserted;
              return (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                    failed ? 'border-rose-300/60 bg-rose-50/40' : 'border-border-subtle bg-bg-surface/40'
                  }`}
                >
                  {/* Аватар со статусом (presence) — на обе строки. */}
                  <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                    <Avatar
                      initials={user?.initials || computeInitials(name)}
                      size={32}
                      login={r.login || undefined}
                      avatarUrl={user?.avatarUrl}
                      avatarBlobKey={user?.avatarBlobKey ?? undefined}
                      avatarBlobNonce={user?.avatarBlobNonce ?? undefined}
                    />
                    <PresenceDot state={presence} size={10} ringClass="ring-bg-surface" className="absolute -bottom-0.5 -right-0.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* Строка 1: кто · что · дата-время · сколько грузилось */}
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="max-w-[220px] truncate text-[13px] font-medium text-text-strong" title={name}>
                        {name}
                      </span>
                      <span className="text-[12px] text-text-secondary">· Выгрузка заказов</span>
                      {/* Время по Екатеринбургу — единый принцип всего приложения. */}
                      <span className="text-[11px] text-text-muted/80">{formatFullYek(r.started_at)}</span>
                      {dur && <span className="text-[11px] text-text-secondary">· за {dur}</span>}
                    </div>
                    {/* Строка 2: было N → стало M (±Δ) · ВГХ +N (НОВЫЕ номенклатуры этого прогона). */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
                      {hasTotals && (
                        <span className="text-[11.5px]">
                          <span className="text-text-muted/70">было </span>
                          <span className="text-text-muted/80">{r.total_before}</span>
                          <span className="text-text-muted/50"> → стало </span>
                          <span className="font-semibold text-text-strong">{r.total_after}</span>
                          {delta !== 0 && (
                            <span className={delta > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                              {' '}({delta > 0 ? '+' : ''}{delta})
                            </span>
                          )}
                        </span>
                      )}
                      {/* Разбивка дельты (юзер 2026-07-04: «строк 257, а в логе +199» —
                          +199 это ИТОГ: новые минус удалённые; показываем слагаемые). */}
                      {(r.inserted > 0 || r.deleted > 0 || r.updated > 0) && (
                        <span className="text-[11.5px] tabular-nums text-text-secondary">
                          {r.inserted > 0 && <span className="text-emerald-600">+{r.inserted} нов</span>}
                          {r.deleted > 0 && <span>{r.inserted > 0 ? ' · ' : ''}<span className="text-rose-600">−{r.deleted} удал</span></span>}
                          {r.updated > 0 && <span>{r.inserted > 0 || r.deleted > 0 ? ' · ' : ''}{r.updated} правок</span>}
                        </span>
                      )}
                      {r.staging_upserted > 0 && (
                        <span className="text-[11.5px] text-text-secondary">ВГХ +{r.staging_upserted}</span>
                      )}
                      {quiet && <span className="text-[11px] text-text-muted/70">без изменений</span>}
                    </div>
                    {failed && (
                      <div className="text-[11.5px] text-rose-600" title={r.error || ''}>
                        ошибка: {r.error || 'нет данных'}
                      </div>
                    )}
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
