import { cn } from '@/lib/cn';
import { usePetStore } from '@/lib/pet-store';
import { PET_CATALOG, type PetSpecies } from '@/lib/pet-catalog';
import { PetSprite } from '@/components/ai/PetSprite';

/**
 * Настройки → Питомцы: только плитки (заголовок уже в сайдбаре настроек).
 */
export function PetsPanel() {
  const species = usePetStore((s) => s.species);
  const setSpecies = usePetStore((s) => s.setSpecies);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="grid max-w-2xl grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {PET_CATALOG.map((s) => {
          const active = species === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSpecies(s.id as PetSpecies)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border p-2.5 transition-colors',
                active
                  ? 'border-accent-clay/50 bg-bg-selected'
                  : 'border-border-default bg-bg-surface hover:bg-bg-hover',
              )}
              aria-pressed={active}
              aria-label={s.label}
            >
              <div className="flex h-[88px] w-full items-end justify-center">
                <PetSprite species={s.id} mood={active ? 'dance' : 'idle'} scale={0.38} />
              </div>
              <span className="text-[12px] font-medium text-text-strong">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
