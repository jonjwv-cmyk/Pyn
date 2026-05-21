import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSessionInfoStore } from '@/lib/stores';
import { useSessionRemaining } from '@/lib/use-session-remaining';
import { extendSession, meSessionInfo } from '@pyn/core';

const POLL_INTERVAL_MS = 30_000;
/**
 * За сколько до истечения сессии показывать prompt продления. 1:1 с
 * Kotlin `SessionLifecycleManager.kt::EXTENSION_PROMPT_MS` (5 минут).
 *
 * Логика: prompt появляется когда `remainingMs ∈ (0, 5min]` И есть свободные
 * extensions (`extensionsRemaining > 0`) И сессия PC-типа. Юзер видит реальный
 * countdown в формате `M:SS` и может продлить на 30 минут одним кликом.
 */
const EXTENSION_PROMPT_MS = 5 * 60 * 1000;

/**
 * Top-level watcher — поллит `me_session_info` каждые 30с (как Kotlin) и
 * показывает диалог «Продлить сессию?» когда remaining < 5 мин для PC-сессии
 * с доступными extensions (макс 3 × 30 мин).
 *
 * Mountится в App.tsx только когда юзер залогинен — на logout/session_expired
 * родитель unmount'ит и polling прекращается.
 *
 * Правила сессии (из server `handlers-pc-session.js + session-time.js`):
 *   • Login в рабочее окно (ПН-ЧТ 7:45-17:00, ПТ 7:45-15:45 Yek) → сессия до
 *     конца окна. После окна, в выходные/праздники → 30 мин + до 3×30 мин
 *     extension'ов (макс 2 часа).
 *   • Праздники РФ hardcoded в `holidays-rf.js`.
 *
 * UX: один dismiss скрывает prompt до следующего successful extend (т.е. либо
 * юзер продлит позже когда осознает, либо сессия истечёт и App.tsx уведёт на
 * LoginScreen через auth-failure flow).
 */
export function SessionExpiryWatch() {
  const { t } = useTranslation();
  /**
   * `null` — никогда не dismiss'или. Число — remaining_ms на момент dismiss'a;
   * больше не показываем пока remaining > это число (т.е. до следующего extend
   * или reset через успешный extend).
   */
  const [dismissedAtRemainingMs, setDismissedAtRemainingMs] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  const dialogJustOpenedRef = useRef(false);

  const info = useSessionInfoStore((s) => s.info);
  const setSharedInfo = useSessionInfoStore((s) => s.setInfo);
  // Единый источник countdown'a (тот же хук в UserPopupMenu) — основан на
  // авторитативном `info.remaining_ms` snapshot + локальный elapsed, не на
  // парсинге `expires_at` (который ломался на UTC/ISO формате).
  const { remainingMs } = useSessionRemaining();

  const refreshInfo = useCallback(async (): Promise<void> => {
    try {
      const fresh = await meSessionInfo(api);
      // Один setter — сразу и наш local-display, и shared store с polledAt.
      setSharedInfo(fresh);
    } catch {
      /* auth-failure обрабатывается выше через ws-event / global handler */
    }
  }, [setSharedInfo]);

  // Polling каждые 30 сек + immediate fetch при mount.
  useEffect(() => {
    void refreshInfo();
    const id = setInterval(() => {
      void refreshInfo();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [refreshInfo]);

  // PC-сессия может быть явно помечена is_pc=true, либо derived из
  // sessionKind. Server иногда отдаёт только session_kind="pc_qr"/"pc_password"
  // без is_pc — без deriv'a мы бы не показывали модал.
  const isPcSession =
    info?.isPc === true ||
    info?.sessionKind === 'pc_qr' ||
    info?.sessionKind === 'pc_password';

  const inWarningWindow =
    isPcSession && remainingMs > 0 && remainingMs <= EXTENSION_PROMPT_MS;
  const hasExtensionsLeft = (info?.extensionsRemaining ?? 0) > 0;
  const notDismissed =
    dismissedAtRemainingMs === null || remainingMs > dismissedAtRemainingMs;
  /** Диалог с кнопкой «Продлить» — только если есть свободные продления. */
  const shouldShow = inWarningWindow && hasExtensionsLeft && notDismissed;
  // §v1.2.14 — case «продлений нет» теперь — sidebar pill (SessionExpiryPill).
  // Top-toast убран по UX-request — он закрывался крестиком, теперь
  // постоянный индикатор в sidebar.

  // Reset dismiss при появлении нового info с увеличенным remainingMs (i.e.
  // юзер где-то ещё продлил, или server prolongation подоспел).
  const lastSeenRemainingRef = useRef<number>(0);
  useEffect(() => {
    const fresh = info?.remainingMs ?? 0;
    if (fresh > lastSeenRemainingRef.current) {
      lastSeenRemainingRef.current = fresh;
      setDismissedAtRemainingMs(null);
    }
  }, [info?.remainingMs]);

  // Логируем когда диалог реально появился — для диагностики через debugLog.
  useEffect(() => {
    if (shouldShow && !dialogJustOpenedRef.current) {
      dialogJustOpenedRef.current = true;
      window.pyn?.debugLog?.(
        'session-expiry',
        `prompt opened: remaining=${Math.round(remainingMs / 1000)}s, extensions=${info?.extensionsRemaining}`,
      );
    } else if (!shouldShow) {
      dialogJustOpenedRef.current = false;
    }
  }, [shouldShow, remainingMs, info?.extensionsRemaining]);

  const handleExtend = async (): Promise<void> => {
    if (extending) return;
    setExtending(true);
    try {
      await extendSession(api);
      // Подтянем свежий expires_at от сервера — он авторитативный.
      await refreshInfo();
      setDismissedAtRemainingMs(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[pyn:session-expiry] extend failed:', err);
    } finally {
      setExtending(false);
    }
  };

  const handleDismiss = (): void => {
    // Заpomim remaining_ms — пока countdown не пройдёт мимо него, не показываем
    // prompt снова. После successful extend remaining прыгает выше → reset null.
    setDismissedAtRemainingMs(remainingMs);
  };

  return (
    <Dialog.Root
      open={shouldShow}
      onOpenChange={(open) => {
        if (!open) handleDismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-bg-deep/70 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border-default bg-bg-elevated p-5 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-clay-bg">
              <Clock className="h-4 w-4 text-accent-clay" strokeWidth={1.75} />
            </span>
            <Dialog.Title className="text-[15px] font-semibold tracking-[-0.005em] text-text-strong">
              {t('session_expiry.title')}
            </Dialog.Title>
          </div>

          <Dialog.Description asChild>
            <div className="text-[13px] leading-snug text-text-secondary">
              <p>
                {/* Inline-time через сплит шаблона: i18n key возвращает строку
                    с placeholder '{{time}}', разрезаем на префикс/суффикс и
                    кладём JSX с tabular-nums в середину для правильного выравнивания. */}
                {renderWithTime(
                  t('session_expiry.body', { time: '__TIME__' }),
                  <span className="font-medium text-text-strong tabular-nums">
                    {formatRemaining(remainingMs)}
                  </span>,
                )}
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-muted">
                {t('session_expiry.subtext', { n: info?.extensionsRemaining ?? 0 })}
              </p>
            </div>
          </Dialog.Description>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] text-text-secondary outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              {t('session_expiry.dismiss')}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleExtend();
              }}
              disabled={extending}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                'bg-accent-clay text-white hover:bg-accent-clay-dim',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {extending ? t('session_expiry.extending') : t('session_expiry.extend')}
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={t('common.close')}
              className={cn(
                'absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md',
                'text-text-muted outline-none transition-colors',
                'hover:bg-bg-hover hover:text-text-strong',
              )}
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** `M:SS` для countdown'a (например `4:23`). */
function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

/**
 * Split i18n строки по маркеру `__TIME__` и подставить JSX-узел внутрь.
 * Используется чтобы вставить styled <span> с tabular-nums в середину
 * локализованной фразы вроде «Через {time} сессия завершится…».
 */
function renderWithTime(template: string, node: JSX.Element): JSX.Element {
  const idx = template.indexOf('__TIME__');
  if (idx === -1) return <>{template}</>;
  const before = template.slice(0, idx);
  const after = template.slice(idx + '__TIME__'.length);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}
