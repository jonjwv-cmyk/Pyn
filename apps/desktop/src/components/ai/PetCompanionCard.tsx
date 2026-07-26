import { cn } from '@/lib/cn';
import { usePetStore } from '@/lib/pet-store';
import { useMusicStore } from '@/lib/music-store';
import { PetSprite } from './PetSprite';
import { emitPetClick } from './PetActivityBridge';

interface PetCompanionCardProps {
  modelLabel: string;
  remainingPct: number;
  drag: {
    pos: { x: number; y: number } | null;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onClick: () => void;
  };
  chatOpen?: boolean;
  className?: string;
}

/**
 * Питомец **сам по себе** — без карточки/подложки/stage.
 * Только спрайт + bubble + лёгкие подписи (имя, модель, %).
 */
export function PetCompanionCard({
  modelLabel,
  remainingPct,
  drag,
  chatOpen,
  className,
}: PetCompanionCardProps) {
  const petName = usePetStore((s) => s.name);
  const species = usePetStore((s) => s.species);
  const mood = usePetStore((s) => s.mood);
  const weatherFx = usePetStore((s) => s.weatherFx);
  const bubble = usePetStore((s) => s.bubble);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const pos = drag.pos;

  return (
    <div
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        'fixed z-[60] flex w-[110px] flex-col items-center gap-1',
        !pos && 'bottom-4 right-4',
        className,
      )}
    >
      {bubble && (
        <div
          className={cn(
            'max-w-[160px] rounded-2xl border border-border-default/70',
            'bg-bg-elevated/90 px-2.5 py-1.5 text-[11px] leading-snug text-text-strong',
            'shadow-md backdrop-blur-sm',
          )}
        >
          {bubble}
        </div>
      )}

      <button
        type="button"
        aria-label={chatOpen ? petName : `Открыть чат: ${petName}`}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onClick={() => {
          drag.onClick();
          if (chatOpen) emitPetClick();
        }}
        className={cn(
          'flex flex-col items-center gap-0.5',
          'cursor-grab touch-none select-none bg-transparent p-0',
          'active:cursor-grabbing',
          // без border / bg / ring — только hit-area
          'outline-none focus-visible:outline-none',
        )}
      >
        {/* Спрайт без сцены и без карточки */}
        <PetSprite species={species} mood={mood} weatherFx={weatherFx} scale={0.5} />

        {/* Подписи — текст поверх рабочего стола, без плашки */}
        <span
          className={cn(
            'mt-0.5 max-w-[100px] truncate text-center text-[11px] font-medium tracking-[-0.01em]',
            'text-text-strong drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
          )}
        >
          {petName}
        </span>
        <span
          className={cn(
            'max-w-[100px] truncate text-center text-[10px]',
            'text-text-secondary drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]',
          )}
        >
          {modelLabel || '—'}
        </span>
        <span
          className={cn(
            'tabular-nums text-[10px]',
            'text-text-muted drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]',
          )}
        >
          {typeof remainingPct === 'number' ? `${remainingPct}%` : '—'}
          {isPlaying ? ' · ♪' : ''}
        </span>
      </button>
    </div>
  );
}
