import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatBandwidth, formatRtt, useConnectivity } from '@/lib/use-connectivity';

interface ConnectivityIndicatorProps {
  /** В collapsed Sidebar — показываем только dot, без текста. */
  collapsed: boolean;
}

/**
 * Индикатор сетевого состояния в нижней части Sidebar (над BottomUserRow).
 *
 * Двухстрочный layout — без Wi-Fi иконки, чтобы вторая строка с RTT+Mbps
 * не обрезалась узкой колонкой sidebar'a:
 *
 *   ● Онлайн
 *     42 мс · 12 Мбит/с
 *
 *   ● Не в сети
 *
 * Маленький dot слева (зелёный/красный) и текст — этого достаточно для
 * мгновенного «status check» без потери места на крупную Wi-Fi иконку.
 *
 * RTT обновляется через WS-ping (один уже-открытый канал, ноль доп запросов
 * к серверу). Если pong не приходит — секция «N мс» скрывается, остаётся
 * только bandwidth (browser estimate).
 *
 * Цвет RTT: <100 мс — норма (text-muted), 100-300 мс — медленно (амбер),
 * >300 мс — плохо (text-danger).
 */
export function ConnectivityIndicator({ collapsed }: ConnectivityIndicatorProps) {
  const { t } = useTranslation();
  const { online, downlinkMbps, rttMs } = useConnectivity();
  const speed = formatBandwidth(downlinkMbps);
  const rtt = online ? formatRtt(rttMs) : null;
  const rttColor =
    rttMs === null
      ? 'text-text-muted'
      : rttMs < 100
        ? 'text-text-muted'
        : rttMs < 300
          ? 'text-amber-400'
          : 'text-danger';

  // §pyn-1.2.54 — collapsed показывает те же 3 метрики что expanded, но
  // stacked в 3 строки (текст центрирован, без точки/иконки). Чтобы при
  // toggle collapse не было layout shift'а — pill всегда занимает одинаковое
  // место в sidebar.
  if (collapsed) {
    // §pyn-1.2.54 — текст в одну строку каждый (whitespace-nowrap), шрифт 9.5px
    // чтобы строки типа «11 Мбит/с» / «11 Mbit/s» / «11 Мбіт/с» во всех локалях
    // вписывались в collapsed-width sidebar без переноса. Padding px-1.5
    // выравнивает текст с другими sidebar-элементами по невидимой левой линии.
    return (
      <div
        className="flex h-10 flex-col items-start justify-center gap-0 overflow-hidden px-1.5 py-0.5 text-left"
        title={online ? t('connectivity.online') : t('connectivity.offline')}
      >
        <span
          className={cn(
            'whitespace-nowrap text-[9px] leading-[11px]',
            online ? 'text-text-secondary' : 'text-danger',
          )}
        >
          {online ? t('connectivity.online') : t('connectivity.offline')}
        </span>
        {online && rtt && (
          <span className={cn('whitespace-nowrap text-[9px] leading-[11px] tabular-nums', rttColor)}>
            {rtt}
          </span>
        )}
        {online && speed && (
          <span className="whitespace-nowrap text-[9px] leading-[11px] tabular-nums text-text-muted">
            {speed}
          </span>
        )}
      </div>
    );
  }

  // Развёрнутый: только текст, без иконки. Две строки — статус и метрики.
  // §pyn-1.2.54 — px-1.5 (6) выравнивает текст с другими элементами sidebar
  // (NavItem icons, BottomUserRow avatar) на единой линии слева.
  return (
    <div
      className="flex h-10 flex-col justify-center gap-0 rounded-md px-1.5 py-1 leading-tight"
      title={online ? t('connectivity.online') : t('connectivity.offline')}
    >
      <span
        className={cn(
          'text-[12px]',
          online ? 'text-text-secondary' : 'text-danger',
        )}
      >
        {online ? t('connectivity.online') : t('connectivity.offline')}
      </span>
      {online && (rtt || speed) && (
        <span className="flex items-baseline gap-1 text-[11px] tabular-nums">
          {rtt && <span className={rttColor}>{rtt}</span>}
          {rtt && speed && <span className="text-text-muted">·</span>}
          {speed && <span className="text-text-muted">{speed}</span>}
        </span>
      )}
    </div>
  );
}
