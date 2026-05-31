import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useSessionInfoStore } from '@/lib/stores';
import { useSessionRemaining } from '@/lib/use-session-remaining';

/** За 5 минут до истечения сессии — sidebar pill с countdown'ом. */
const EXTENSION_PROMPT_MS = 5 * 60 * 1000;

interface SessionExpiryPillProps {
  /** В collapsed sidebar — компактный «OFF» + countdown без подписи. */
  collapsed?: boolean;
}

/**
 * §v1.2.14 — Sidebar pill «Через M:SS потребуется войти заново».
 *
 * Рендерится в нижнем стеке Sidebar когда PC-сессия в последних
 * 5 минутах И уже нет свободных продлений (3/3 использовано). Pill
 * НЕ закрываемая — юзер должен видеть таймер постоянно. Если продления
 * остались, появляется отдельный модальный диалог в `SessionExpiryWatch`
 * с кнопкой «Продлить»; pill в sidebar тогда не показывается.
 *
 * §pyn-1.2.54 — collapsed-режим: компактный «OFF» (red label) + countdown
 * timer; сохраняется тот же визуальный slot чтобы не было скачков
 * layout'а при сворачивании sidebar.
 */
export function SessionExpiryPill({ collapsed = false }: SessionExpiryPillProps = {}): JSX.Element | null {
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

  if (collapsed) {
    return (
      <div
        role="status"
        aria-live="polite"
        title={`${t('session_expiry.pill_prefix')} ${formatRemaining(remainingMs)}`}
        className={cn(
          // §pyn-1.2.54 — pl-[5px] компенсирует 1px border, content на линии 12.
          // h-10 → высота совпадает с expanded и Connectivity, no jump.
          'relative flex h-10 flex-col items-start justify-center gap-0 overflow-hidden rounded-md py-1 pl-[5px] pr-1.5 text-left leading-tight',
          'border border-accent-clay/25 bg-accent-clay-bg/40',
        )}
      >
        <span aria-hidden className="pyn-shimmer-rtl" />
        <span className="relative whitespace-nowrap text-[9.5px] font-semibold text-accent-clay">
          OFF
        </span>
        <span className="relative whitespace-nowrap text-[9.5px] font-medium tabular-nums text-text-strong">
          {formatRemaining(remainingMs)}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // §pyn-1.2.34 — relative + overflow-hidden для shimmer-overlay.
        // §pyn-1.2.54 — pl-[5px] компенсирует border (1px), Clock icon на линии 12.
        // h-10 — единая высота с другими pills, no jump при collapse/expand.
        'relative flex h-10 items-center gap-1.5 overflow-hidden rounded-md py-1 pl-[5px] pr-2',
        'border border-accent-clay/25 bg-accent-clay-bg/40',
      )}
    >
      {/* §pyn-1.2.34 — shimmer справа→налево: пара к UpdatePill (slевa→направо),
          визуально подчёркивает что время «утекает» назад. */}
      <span aria-hidden className="pyn-shimmer-rtl" />
      <Clock className="relative h-3 w-3 shrink-0 text-accent-clay" strokeWidth={1.75} />
      <span className="relative text-[11px] leading-tight text-text-secondary">
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
