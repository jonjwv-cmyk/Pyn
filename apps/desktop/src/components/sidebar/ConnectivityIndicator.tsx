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

  // В collapsed-режиме: ничего когда онлайн (avatar ниже имеет свою
  // presence-dot — две зелёные точки рядом выглядели как баг). Показываем
  // явный красный dot только при offline — это требует внимания.
  if (collapsed) {
    if (online) return null;
    return (
      <div
        className="flex items-center justify-center px-2 py-1"
        title="Не в сети"
      >
        <span className="h-2 w-2 rounded-full bg-danger" />
      </div>
    );
  }

  // Развёрнутый: только текст, без иконки. Две строки — статус и метрики.
  return (
    <div
      className="flex flex-col gap-0 rounded-md px-2 py-1 leading-tight"
      title={online ? 'Подключено к сети' : 'Нет подключения'}
    >
      <span
        className={cn(
          'text-[12px]',
          online ? 'text-text-secondary' : 'text-danger',
        )}
      >
        {online ? 'Онлайн' : 'Не в сети'}
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
