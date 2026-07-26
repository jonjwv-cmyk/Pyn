import { useEffect } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMusicStore } from '@/lib/music-store';
import { waveAt } from '@/lib/music-waves';
import { musicCmd, wireMusicUiBridge } from '@/lib/music-bridge';

interface HiFiSidebarControlProps {
  collapsed: boolean;
}

/**
 * Сайдбар Hi-Fi: hover ▶/⏸ ⏭ + Волна N + статус.
 * Звук крутится в pet overlay; сюда state по IPC.
 */
export function HiFiSidebarControl({ collapsed }: HiFiSidebarControlProps) {
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const trackTitle = useMusicStore((s) => s.trackTitle).trim();
  const waveIndex = useMusicStore((s) => s.waveIndex);
  const error = useMusicStore((s) => s.error);

  useEffect(() => {
    wireMusicUiBridge();
  }, []);

  const wave = waveAt(waveIndex);
  const status =
    trackTitle ||
    (isPlaying ? `Воспроизведение: ${wave.shortLabel}` : wave.label);

  return (
    <div
      className={cn(
        'group/hifi relative flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-1 py-0.5',
        'transition-colors hover:bg-bg-hover',
      )}
    >
      <div className="flex h-7 min-w-0 items-center gap-0.5">
        <span
          className={cn(
            'shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide',
            isPlaying ? 'bg-accent-clay/25 text-accent-clay' : 'text-text-muted',
          )}
        >
          {collapsed ? 'Hi' : 'Hi-Fi'}
        </span>
        <div
          className={cn(
            'flex items-center gap-0.5 opacity-0 transition-opacity',
            'group-hover/hifi:opacity-100 focus-within:opacity-100',
            isPlaying && 'opacity-100',
          )}
        >
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-bg-selected hover:text-text-strong"
            onClick={() => musicCmd('toggle')}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            disabled={!!error && !isPlaying}
          >
            {isPlaying ? (
              <Pause className="h-3 w-3" strokeWidth={2.25} />
            ) : (
              <Play className="h-3 w-3 translate-x-px" strokeWidth={2.25} />
            )}
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-bg-selected hover:text-text-strong"
            onClick={() => musicCmd('next')}
            aria-label="Next"
            title="Next track / next wave"
          >
            <SkipForward className="h-3 w-3" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className={cn(
              'flex h-6 min-w-[1.75rem] items-center justify-center rounded px-1',
              'text-[10px] font-semibold tabular-nums text-text-secondary',
              'hover:bg-bg-selected hover:text-text-strong',
            )}
            onClick={() => musicCmd('cycleWave')}
            title={`Волна ${wave.n}: ${wave.label}`}
            aria-label={`Волна ${wave.n}`}
          >
            {wave.n}
          </button>
        </div>
        {!collapsed && (
          <span
            className={cn(
              'ml-auto max-w-[40%] truncate text-[10px] text-text-muted',
              'group-hover/hifi:hidden',
            )}
          >
            Волна {wave.n}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="min-w-0 overflow-hidden px-0.5">
          <p
            className={cn(
              'truncate text-[10px] leading-tight text-text-muted',
              isPlaying && 'text-text-secondary',
            )}
            title={status}
          >
            {isPlaying ? `▶ ${status}` : status}
          </p>
        </div>
      )}
    </div>
  );
}
