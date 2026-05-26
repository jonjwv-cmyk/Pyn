import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, Menu, ScanLine, Smartphone, LogIn } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { getDeviceLabel } from '@/lib/device';
import { cn } from '@/lib/cn';
import {
  checkPcSessionStatus,
  requestPcSessionQr,
  type LoginResponse,
} from '@pyn/core';

interface QrLoginPanelProps {
  onSuccess: (result: LoginResponse) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; challenge: string; qrDataUrl: string; expiresAt: number }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 2_000;
/**
 * За сколько до expiration запросить новый QR в фоне. 5 секунд — обычно
 * хватает для сетевого round-trip + render canvas; новый код встанет на
 * место старого до того, как countdown упадёт в 0.
 */
const REFRESH_LEAD_MS = 5_000;
/** Auto-retry transient error через секунды. */
const ERROR_RETRY_MS = 3_000;

/**
 * QR-вход. Primary способ login'а на desktop'е в OTLHelper2 (password ограничен
 * 3/неделю, QR — без лимита).
 *
 * Flow:
 *   1. request_pc_session_qr → получаем challenge + qr_payload (JSON string)
 *   2. Рендерим QR через `qrcode` npm
 *   3. Каждые 2 сек polling'уем check_pc_session_status(challenge)
 *   4. При status:"redeemed" — onSuccess(session) → LoginScreen → App
 *
 * Юзер сканирует QR со своего OTLHelper2-Android (меню → «Войти на ПК»).
 * После подтверждения на телефоне server создаёт PC-сессию и revoke'ит все
 * прошлые PC-сессии этого юзера (single-PC policy).
 *
 * Auto-refresh: за 5 секунд до expiration в фоне запрашиваем новый QR —
 * старый остаётся виден до самого свопа. Свап анимируется fade-in (см.
 * `key={phase.challenge}` на img). Кнопки «Обновить» нет — всё прозрачно.
 */
export function QrLoginPanel({ onSuccess }: QrLoginPanelProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * @param background — если true, не сбрасываем UI в `loading` — старый QR
   *   остаётся видимым пока новый не приедет (плавный фоновый рефреш).
   */
  const requestNewQr = useCallback(async (background = false): Promise<void> => {
    if (!background) setPhase({ kind: 'loading' });
    try {
      const result = await requestPcSessionQr(api, {
        deviceLabel: getDeviceLabel(),
        desktopOs: window.pyn?.platform === 'darwin' ? 'mac' : 'win',
      });
      if (!result.challenge || !result.qrPayload) {
        setPhase({ kind: 'error', message: t('qr_login.no_challenge') });
        return;
      }
      const qrDataUrl = await QRCode.toDataURL(result.qrPayload, {
        errorCorrectionLevel: 'M',
        width: 240,
        margin: 1,
        color: { dark: '#1F1E1B', light: '#FAF7F2' },
      });
      const expiresAt = Date.now() + result.ttlSec * 1000;
      setPhase({ kind: 'ready', challenge: result.challenge, qrDataUrl, expiresAt });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pyn:qr] request failed:', err);
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : t('qr_login.request_failed'),
      });
    }
  }, []);

  // На mount запрашиваем первый QR.
  useEffect(() => {
    void requestNewQr();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (errorRetryRef.current) clearTimeout(errorRetryRef.current);
    };
  }, [requestNewQr]);

  // Polling статуса + countdown + auto-refresh — только в phase.ready.
  useEffect(() => {
    if (phase.kind !== 'ready') return;

    const { challenge, expiresAt } = phase;

    // Countdown: каждую секунду пересчитываем `secondsLeft`. На 0 —
    // переходим в loading state (PynLoader анимация полосок visible
    // минимум 1.8s = полный цикл), затем новый QR. Юзер видит «срок
    // вышел → анимация → новый код».
    const updateCountdown = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (tickTimerRef.current) clearInterval(tickTimerRef.current);
        void requestNewQr(true);
      }
    };
    updateCountdown();
    tickTimerRef.current = setInterval(updateCountdown, 1000);

    // Auto-refresh за 5с до expiration. Если уже меньше — refresh сразу.
    const leadMs = expiresAt - Date.now() - REFRESH_LEAD_MS;
    refreshTimerRef.current = setTimeout(
      () => {
        void requestNewQr(true);
      },
      Math.max(0, leadMs),
    );

    // §pyn-1.2.45 — long-polling вместо setInterval. Сервер держит запрос
    // до 25 сек ждая redeem'а. При scan'е возвращается мгновенно (~100ms).
    // После каждого response клиент сразу запускает новый long-poll.
    // Только ОДИН запрос в любой момент времени → −97% жора на CF.
    let cancelled = false;
    const longPoll = async (): Promise<void> => {
      while (!cancelled) {
        try {
          const result = await checkPcSessionStatus(api, challenge, true);
          if (cancelled) return;
          if (result.status === 'redeemed' && result.session) {
            if (tickTimerRef.current) clearInterval(tickTimerRef.current);
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            api.setToken(result.session.token);
            onSuccess(result.session);
            return;
          }
          if (result.status === 'expired') {
            if (tickTimerRef.current) clearInterval(tickTimerRef.current);
            void requestNewQr(true);
            return;
          }
          // pending → сразу новый long-poll (без задержки, сервер сам держит 25s).
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[pyn:qr] long-poll failed:', err);
          // Transient — пауза 2 сек, потом retry. Не зацикливаться на network down.
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }
    };
    void longPoll();

    return () => {
      cancelled = true;
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [phase, onSuccess, requestNewQr]);

  // Error → авто-retry через 3с. Сетевые сбои бывают временные; кнопки
  // «Обновить» больше нет, потому делаем сами.
  useEffect(() => {
    if (phase.kind !== 'error') return;
    errorRetryRef.current = setTimeout(() => {
      void requestNewQr();
    }, ERROR_RETRY_MS);
    return () => {
      if (errorRetryRef.current) clearTimeout(errorRetryRef.current);
    };
  }, [phase, requestNewQr]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          'flex h-[240px] w-[240px] items-center justify-center overflow-hidden rounded-xl',
          'border border-border-default bg-bg-elevated',
        )}
      >
        {phase.kind === 'loading' && (
          <Loader2
            className="h-7 w-7 animate-spin text-accent-clay opacity-80"
            strokeWidth={1.5}
            aria-label={t('common.loading')}
          />
        )}
        {phase.kind === 'ready' && (
          // `key={challenge}` гарантирует remount img при свапе → Tailwind
          // animate-in fade-in проигрывается на новом коде, старый исчезает
          // одновременно с появлением. Subtle 250ms — не мельтешит.
          // `rounded-lg` на самом QR — скругляет белые углы кода так чтобы
          // визуально совпасть с округлой рамкой контейнера.
          <img
            key={phase.challenge}
            src={phase.qrDataUrl}
            alt={t('qr_login.qr_alt')}
            width={224}
            height={224}
            className={cn(
              'select-none rounded-lg',
              'animate-in fade-in-0 zoom-in-[0.97] duration-[260ms] ease-out',
            )}
          />
        )}
        {phase.kind === 'error' && (
          <div className="flex flex-col items-center gap-1.5 px-4 text-center">
            <p className="text-[12px] text-danger">{phase.message}</p>
            <p className="text-[11px] text-text-muted">{t('qr_login.retrying')}</p>
          </div>
        )}
      </div>

      {phase.kind === 'ready' && (
        <p className="text-[11px] tabular-nums text-text-muted">
          <Trans
            i18nKey="qr_login.expires_in"
            values={{ n: secondsLeft }}
            components={{
              b: <span className="font-medium text-accent-clay" />,
            }}
          />
        </p>
      )}

      <StepsList />
    </div>
  );
}

interface StepProps {
  number: number;
  icon: LucideIcon;
  label: string;
}

/**
 * Один шаг numbered-инструкции: маленький номер-кружок + иконка + текст.
 * Linear-style вертикальный список, без чрезмерного зрительного шума.
 */
function Step({ number, icon: Icon, label }: StepProps) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          'bg-accent-clay-bg text-[10px] font-semibold tabular-nums text-accent-clay',
        )}
      >
        {number}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
      <span className="text-[11.5px] leading-snug text-text-secondary">{label}</span>
    </li>
  );
}

/**
 * Numbered visual steps QR-логина (Linear/Figma-style).
 *
 *   ① 📱 Открой Pyn на телефоне
 *   ② ☰ Перейди в меню
 *   ③ → Войти на ПК
 *   ④ ▣ Наведи камеру на код
 */
function StepsList() {
  const { t } = useTranslation();
  return (
    <ol
      className={cn(
        // 240px — точная ширина QR-контейнера выше; визуально ровно в одной
        // колонке (QR / счётчик / инструкция).
        'flex w-[240px] flex-col gap-1.5 rounded-lg',
        'border border-border-subtle bg-bg-primary/40 px-3 py-2.5',
      )}
    >
      <Step number={1} icon={Smartphone} label={t('qr_login.step_open')} />
      <Step number={2} icon={Menu} label={t('qr_login.step_menu')} />
      <Step number={3} icon={LogIn} label={t('qr_login.step_login')} />
      <Step number={4} icon={ScanLine} label={t('qr_login.step_scan')} />
    </ol>
  );
}
