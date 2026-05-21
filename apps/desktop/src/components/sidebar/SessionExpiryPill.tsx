import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useSessionInfoStore } from '@/lib/stores';
import { useSessionRemaining } from '@/lib/use-session-remaining';

/** За 5 минут до истечения сессии — sidebar pill с countdown'ом. */
const EXTENSION_PROMPT_MS = 5 * 60 * 1000;

/**
 * §v1.2.14 — Sidebar pill «Через M:SS потребуется войти заново».
 *
 * Рендерится над `ConnectivityIndicator` когда PC-сессия в последних
 * 5 минутах И уже нет свободных продлений (3/3 использовано). Pill
 * НЕ закрываемая — юзер должен видеть таймер постоянно. Если продления
 * остались, появляется отдельный модальный диалог в `SessionExpiryWatch`
 * с кнопкой «Продлить»; pill в sidebar тогда не показывается.
 */
export function SessionExpiryPill(): JSX.Element | null {
  const { t } = useTranslation();
  const info = useSessionInfoStore((s) => s.info);
  const { remainingMs } = useSessionRemaining();
  const isPcSession =
    info?.isPc === true ||
    info?.sessionKind === 'pc_qr' ||
    info?.sessionKind === 'pc_password';
  const extensionsLeft = info?.extensionsRemaining ?? 0;
  const inWarningWindow =
    isPcSession && remainingMs > 0 && remainingMs <= EXTENSION_PROMPT_MS;
  // Показ только когда продлений уже нет — иначе работает модал с кнопкой
  // «Продлить» (см. SessionExpiryWatch). Дублировать в sidebar смысла нет.
  if (!inWarningWindow || extensionsLeft > 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1',
        'border border-accent-clay/25 bg-accent-clay-bg/40',
      )}
    >
      <Clock className="h-3 w-3 shrink-0 text-accent-clay" strokeWidth={1.75} />
      <span className="text-[11px] leading-tight text-text-secondary">
        {t('session_expiry.pill_prefix')}{' '}
        <span className="font-medium tabular-nums text-text-strong">
          {formatRemaining(remainingMs)}
        </span>
        <br />
        {t('session_expiry.pill_relogin')}
      </span>
    </div>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}
