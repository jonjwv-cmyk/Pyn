import { useCallback, useEffect, useRef, useState } from 'react';
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
        setPhase({ kind: 'error', message: 'Сервер не вернул challenge' });
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
        message: err instanceof Error ? err.message : 'Не удалось запросить QR',
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

    // Countdown: каждую секунду пересчитываем `secondsLeft`. На 0 — если
    // refresh ещё не отстрелял (медленная сеть), сразу триггерим фоновой
    // запрос. Старый QR остаётся видимым до прихода нового.
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

    // Polling status check.
    pollTimerRef.current = setInterval(async () => {
      try {
        const result = await checkPcSessionStatus(api, challenge);
        if (result.status === 'redeemed' && result.session) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          if (tickTimerRef.current) clearInterval(tickTimerRef.current);
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          // Token сразу setToken'им в ApiClient — все последующие calls используют.
          api.setToken(result.session.token);
          onSuccess(result.session);
        } else if (result.status === 'expired') {
          // Server отверг — попробуем фоном получить новый.
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          if (tickTimerRef.current) clearInterval(tickTimerRef.current);
          void requestNewQr(true);
        }
      } catch (err) {
        // Transient ошибки игнорим — следующий poll попробует снова.
        // eslint-disable-next-line no-console
        console.warn('[pyn:qr] poll failed:', err);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
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
          'flex h-[240px] w-[240px] items-center justify-center rounded-xl',
          'border border-border-default bg-bg-elevated',
        )}
      >
        {phase.kind === 'loading' && (
          <span className="text-[12px] text-text-muted">Подготовка QR…</span>
        )}
        {phase.kind === 'ready' && (
          // `key={challenge}` гарантирует remount img при свапе → Tailwind
          // animate-in fade-in проигрывается на новом коде, старый исчезает
          // одновременно с появлением. Subtle 250ms — не мельтешит.
          <img
            key={phase.challenge}
            src={phase.qrDataUrl}
            alt="QR-код входа"
            width={224}
            height={224}
            className={cn(
              'select-none',
              'animate-in fade-in-0 zoom-in-[0.97] duration-[260ms] ease-out',
            )}
          />
        )}
        {phase.kind === 'error' && (
          <div className="flex flex-col items-center gap-1.5 px-4 text-center">
            <p className="text-[12px] text-danger">{phase.message}</p>
            <p className="text-[11px] text-text-muted">Пробуем снова…</p>
          </div>
        )}
      </div>

      <p className="max-w-[280px] text-center text-[11.5px] leading-snug text-text-muted">
        Откройте OTLHelper на телефоне → меню → «Войти на ПК» — и наведите камеру на код.
      </p>

      {phase.kind === 'ready' && (
        <p className="text-[10.5px] tabular-nums text-text-muted">
          Действителен ещё {secondsLeft} с
        </p>
      )}
    </div>
  );
}
