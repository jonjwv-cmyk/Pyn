import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { RefreshCw } from 'lucide-react';
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
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 2_000;

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
 * QR валиден 60 секунд. По истечению — кнопка "Обновить" перезапрашивает.
 */
export function QrLoginPanel({ onSuccess }: QrLoginPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestNewQr = async (): Promise<void> => {
    setPhase({ kind: 'loading' });
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
  };

  // На mount запрашиваем первый QR.
  useEffect(() => {
    void requestNewQr();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling статуса + countdown — запускаются только в phase.ready.
  useEffect(() => {
    if (phase.kind !== 'ready') return;

    const { challenge, expiresAt } = phase;

    // Countdown
    const updateCountdown = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (tickTimerRef.current) clearInterval(tickTimerRef.current);
        setPhase({ kind: 'expired' });
      }
    };
    updateCountdown();
    tickTimerRef.current = setInterval(updateCountdown, 1000);

    // Polling
    pollTimerRef.current = setInterval(async () => {
      try {
        const result = await checkPcSessionStatus(api, challenge);
        if (result.status === 'redeemed' && result.session) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          if (tickTimerRef.current) clearInterval(tickTimerRef.current);
          // Token сразу setToken'им в ApiClient — все последующие calls используют.
          api.setToken(result.session.token);
          onSuccess(result.session);
        } else if (result.status === 'expired') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          if (tickTimerRef.current) clearInterval(tickTimerRef.current);
          setPhase({ kind: 'expired' });
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
    };
  }, [phase, onSuccess]);

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
          <img
            src={phase.qrDataUrl}
            alt="QR-код входа"
            width={224}
            height={224}
            className="select-none"
          />
        )}
        {phase.kind === 'expired' && (
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <p className="text-[12.5px] text-text-muted">QR-код истёк</p>
            <button
              type="button"
              onClick={() => void requestNewQr()}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px]',
                'bg-accent-clay text-white hover:bg-accent-clay-dim transition-colors',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Обновить
            </button>
          </div>
        )}
        {phase.kind === 'error' && (
          <p className="px-4 text-center text-[12px] text-danger">{phase.message}</p>
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
