import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activateAppLock,
  deactivateAppLock,
  useAppLockStore,
  type AppLockScope,
  type AppLockScopeData,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SheetsPasswordPrompt } from '@/components/tables/SheetsPasswordPrompt';

/**
 * «Управление» panel (developer-only). Два независимых kill switch:
 *   • PC версия
 *   • Android версия
 *
 * Источник правды — useAppLockStore (Zustand). Store сидируется в App.tsx
 * один раз на login + обновляется через WS push. Этот компонент НЕ делает
 * loading-fetch на mount — рендер мгновенный из текущего store, без прыжков.
 * Fetch только после toggle (для свежих device counts).
 */

const WIPE_AFTER_SECONDS = 24 * 3600;

export function AppControlPanel(): JSX.Element {
  const { t } = useTranslation();
  const desktop = useAppLockStore((s) => s.desktop);
  const android = useAppLockStore((s) => s.android);

  const [submitting, setSubmitting] = useState<AppLockScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pending toggle ждёт пароль. После submit пароля — runToggle(scope, next, pw).
  const [pwPending, setPwPending] = useState<{ scope: AppLockScope; next: boolean } | null>(null);

  // Toggle click → открыть password prompt. Реальный API call — после ввода.
  const handleToggle = (scope: AppLockScope, next: boolean): void => {
    if (submitting) return;
    setError(null);
    setPwPending({ scope, next });
  };

  const runToggle = async (scope: AppLockScope, next: boolean, password: string): Promise<void> => {
    const store = useAppLockStore.getState();
    const previous = store[scope];
    // Optimistic + pending guard.
    store.setPending(scope, true);
    const wipeAtIso = next
      ? toSqliteUtc(new Date(Date.now() + WIPE_AFTER_SECONDS * 1000))
      : null;
    store.setScopeFromServer(scope, {
      state: next ? 'paused' : 'normal',
      title: next ? 'Pyn временно приостановил работу' : '',
      message: '',
      wipeAt: wipeAtIso,
      initiatedBy: next ? 'developer' : '',
    });
    setSubmitting(scope);
    try {
      if (next) {
        await activateAppLock(api, { scope, password, wipeAfterSeconds: WIPE_AFTER_SECONDS });
      } else {
        await deactivateAppLock(api, { scope, password });
      }
    } catch (err) {
      // Revert optimistic (включая wrong_password case)
      store.setScopeFromServer(scope, previous);
      const code = (err as { code?: string }).code;
      setError(code === 'wrong_password'
        ? t('tables.toast_wrong_password')
        : (err instanceof Error ? err.message : String(err)));
    } finally {
      window.setTimeout(() => {
        useAppLockStore.getState().setPending(scope, false);
      }, 600);
      setSubmitting(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-text-strong">{t('settings_control.title')}</h2>
          <p className="text-[12px] text-text-muted">
            {t('settings_control.subtitle')}
          </p>
        </div>

        <ScopeCard
          scope="desktop"
          label={t('settings_control.scope_pc')}
          sublabel={t('settings_control.scope_pc_idle')}
          status={desktop}
          submitting={submitting === 'desktop'}
          onToggle={(next) => handleToggle('desktop', next)}
        />

        <ScopeCard
          scope="android"
          label={t('settings_control.scope_android')}
          sublabel={t('settings_control.scope_android_idle')}
          status={android}
          submitting={submitting === 'android'}
          onToggle={(next) => handleToggle('android', next)}
        />

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-[12px] text-danger">
            {error}
          </div>
        )}
      </div>

      <SheetsPasswordPrompt
        open={pwPending !== null}
        actionLabel={t('settings_control.title')}
        onSubmit={(pw) => {
          const pending = pwPending;
          setPwPending(null);
          if (!pending) return;
          void runToggle(pending.scope, pending.next, pw);
        }}
        onCancel={() => setPwPending(null)}
      />
    </div>
  );
}

interface ScopeCardProps {
  scope: AppLockScope;
  label: string;
  sublabel: string;
  status: AppLockScopeData;
  submitting: boolean;
  onToggle: (next: boolean) => void;
}

function ScopeCard({
  label, sublabel, status, submitting, onToggle,
}: ScopeCardProps): JSX.Element {
  const { t } = useTranslation();
  const isPaused = status.state === 'paused';
  const isWiping = status.state === 'wiping';
  const isWiped = status.state === 'wiped';
  const isActive = isPaused || isWiping || isWiped;

  const wipeAtMs = useMemo(() => {
    if (!status.wipeAt) return null;
    const ms = Date.parse(status.wipeAt.replace(' ', 'T') + 'Z');
    return Number.isFinite(ms) ? ms : null;
  }, [status.wipeAt]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPaused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isPaused]);

  const remainingMs = wipeAtMs !== null ? Math.max(0, wipeAtMs - now) : 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-4',
        isActive
          ? 'border-accent-clay/30 bg-accent-clay-bg/20'
          : 'border-border-default bg-bg-elevated/30',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="text-[13px] font-medium text-text-strong">{label}</div>
          <div className="text-[11px] text-text-muted">
            {isPaused ? t('settings_control.status_active')
              : isWiping ? t('settings_control.status_wiping')
              : isWiped ? t('settings_control.status_wiped')
              : sublabel}
          </div>
        </div>
        <Toggle
          on={isActive}
          disabled={submitting || isWiped}
          onChange={onToggle}
        />
      </div>

      {isPaused && wipeAtMs !== null && (
        <div className="rounded-md bg-bg-deep/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">
            {t('settings_control.countdown_label')}
          </div>
          <div className="mt-1 font-mono text-2xl tabular-nums text-accent-clay">
            {formatRemaining(remainingMs)}
          </div>
          <div className="mt-1 text-[11px] text-text-muted">
            {formatYekWipeAt(wipeAtMs)}
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            {t('settings_control.warning_reinstall')}
          </div>
        </div>
      )}
    </div>
  );
}

interface ToggleProps {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function Toggle({ on, disabled, onChange }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-accent-clay' : 'bg-bg-hover',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Yekaterinburg TZ, формат «21 мая 2026, 9:50:15 ПП».
 * День + месяц словом + год через ru-RU локаль, время — manual h24→h12
 * (надёжнее чем dayPeriod из Intl, у которого AM/PM на разных системах
 * может различаться).
 */
function formatYekWipeAt(ms: number): string {
  const d = new Date(ms);
  // Дата: «21 мая 2026 г.» (ru-RU с long month), убираем хвост «г.».
  const ruDate = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(d).replace(/\s*г\.?\s*$/, '');
  // Время: 24h из en-GB → конвертируем в 12h + ДП/ПП.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yekaterinburg',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const h24 = parseInt(m.hour ?? '0', 10) || 0;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${ruDate}, ${h12}:${m.minute}:${m.second} ${period}`;
}

/** Конверт Date → SQLite-формат `YYYY-MM-DD HH:MM:SS` (UTC). */
function toSqliteUtc(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
