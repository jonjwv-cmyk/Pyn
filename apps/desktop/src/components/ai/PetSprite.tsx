import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import {
  catalogEntry,
  moodToPetdexState,
  PETDEX_FRAME_H,
  PETDEX_FRAME_W,
  PETDEX_SHEET_W,
  type PetMood,
  type PetSpecies,
} from '@/lib/pet-catalog';
import type { WeatherFx } from '@/lib/pet-context';

interface PetSpriteProps {
  species: PetSpecies;
  mood: PetMood;
  /** Масштаб кадра 192×208 (0.35 ≈ 67px, 0.45 ≈ 86px). */
  scale?: number;
  className?: string;
  /** Визуал погоды: зонтик/лист, пот, шарф… */
  weatherFx?: WeatherFx;
}

/**
 * Petdex atlas sprite (soft chibi) или mesh-orb.
 * Анимация — CSS steps() по row, как в petdex.
 */
export function PetSprite({
  species,
  mood,
  scale = 0.42,
  className,
  weatherFx = 'none',
}: PetSpriteProps) {
  const entry = catalogEntry(species);

  if (!entry.sheet) {
    const px = Math.round(PETDEX_FRAME_W * scale * 0.75);
    return (
      <div className={cn('relative shrink-0', className)} style={{ width: px, height: px }}>
        <OrbSprite mood={mood} size={px} />
        <WeatherOverlays fx={weatherFx} mood={mood} />
        {mood === 'smoke' && <SmokeOverlay />}
      </div>
    );
  }

  const st = moodToPetdexState(mood);
  const w = PETDEX_FRAME_W * scale;
  const h = PETDEX_FRAME_H * scale;

  return (
    <div
      className={cn('relative shrink-0 overflow-visible', className)}
      style={{ width: w, height: h }}
      aria-hidden
      data-pet-mood={mood}
      data-pet-species={species}
      data-pet-weather={weatherFx}
    >
      <div className="relative h-full w-full overflow-hidden">
        <div
          className="pyn-pet-atlas"
          style={
            {
              '--sprite-url': `url("${entry.sheet}")`,
              '--sprite-row': st.row,
              '--sprite-frames': st.frames,
              '--sprite-duration': `${st.durationMs}ms`,
              '--sprite-sheet-width': `${PETDEX_SHEET_W}px`,
              '--pet-scale': scale,
            } as CSSProperties
          }
        />
      </div>
      <WeatherOverlays fx={weatherFx} mood={mood} />
      {mood === 'smoke' && <SmokeOverlay />}
    </div>
  );
}

/** Сигарета + колечки дыма («пыхтит»). */
function SmokeOverlay() {
  return (
    <div className="pyn-pet-fx pyn-pet-fx--smoke pointer-events-none" aria-hidden>
      <span className="pyn-pet-cig">🚬</span>
      <span className="pyn-pet-puff pyn-pet-puff--a" />
      <span className="pyn-pet-puff pyn-pet-puff--b" />
      <span className="pyn-pet-puff pyn-pet-puff--c" />
    </div>
  );
}

function WeatherOverlays({ fx, mood }: { fx: WeatherFx; mood: PetMood }) {
  if (mood === 'sleep' && (fx === 'none' || fx === 'hot')) {
    return (
      <span className="pyn-pet-fx pyn-pet-fx--zzz pointer-events-none" aria-hidden>
        zzz
      </span>
    );
  }
  if (fx === 'none') return null;

  if (fx === 'rain') {
    return (
      <>
        <span className="pyn-pet-fx pyn-pet-fx--umbrella pointer-events-none" aria-hidden>
          ☔
        </span>
        <span className="pyn-pet-fx pyn-pet-fx--drops pointer-events-none" aria-hidden>
          <i /><i /><i />
        </span>
      </>
    );
  }
  if (fx === 'snow') {
    return (
      <>
        <span className="pyn-pet-fx pyn-pet-fx--scarf pointer-events-none" aria-hidden>
          🧣
        </span>
        <span className="pyn-pet-fx pyn-pet-fx--snow pointer-events-none" aria-hidden>
          ❄️
        </span>
      </>
    );
  }
  if (fx === 'hot') {
    return (
      <span className="pyn-pet-fx pyn-pet-fx--sweat pointer-events-none" aria-hidden>
        <i /><i />
      </span>
    );
  }
  if (fx === 'cold') {
    return (
      <>
        <span className="pyn-pet-fx pyn-pet-fx--scarf pointer-events-none" aria-hidden>
          🧣
        </span>
        <span className="pyn-pet-fx pyn-pet-fx--wrap pointer-events-none" aria-hidden>
          🍃
        </span>
      </>
    );
  }
  if (fx === 'storm') {
    return (
      <>
        <span className="pyn-pet-fx pyn-pet-fx--umbrella pointer-events-none" aria-hidden>
          ☔
        </span>
        <span className="pyn-pet-fx pyn-pet-fx--bolt pointer-events-none" aria-hidden>
          ⚡
        </span>
      </>
    );
  }
  return null;
}

function OrbSprite({
  mood,
  size,
  className,
}: {
  mood: PetMood;
  size: number;
  className?: string;
}) {
  const mesh =
    'radial-gradient(circle at 30% 30%,#F2774C 0%,transparent 55%),' +
    'radial-gradient(circle at 70% 40%,#3FC6E8 0%,transparent 50%),' +
    'radial-gradient(circle at 50% 70%,#B664F5 0%,transparent 55%),' +
    'radial-gradient(circle at 40% 60%,#5C84F5 0%,transparent 45%)';
  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full shadow-lg ring-1 ring-white/15',
        mood === 'dance' && 'animate-pet-bounce',
        (mood === 'think' || mood === 'typing') && 'animate-pulse',
        mood === 'working' && 'animate-pet-nudge',
        mood === 'eat' && 'animate-pulse',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundImage: mesh,
        backgroundColor: '#1F1E1B',
        backgroundSize: '160% 160%',
      }}
      aria-hidden
    >
      <span
        className={cn(
          'absolute left-[28%] top-[38%] h-[12%] w-[12%] rounded-full bg-white/90',
          (mood === 'sleep' || mood === 'think' || mood === 'eat') && 'h-[4%] translate-y-1',
        )}
      />
      <span
        className={cn(
          'absolute right-[28%] top-[38%] h-[12%] w-[12%] rounded-full bg-white/90',
          (mood === 'sleep' || mood === 'think' || mood === 'eat') && 'h-[4%] translate-y-1',
        )}
      />
      {mood === 'eat' && (
        <span className="absolute bottom-[18%] left-1/2 -translate-x-1/2 text-[10px] leading-none">
          🥢
        </span>
      )}
    </div>
  );
}
