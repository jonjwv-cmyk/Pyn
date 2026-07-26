/**
 * Каталог питомцев — Petdex atlas (192×208, 8 cols).
 * https://petdex.dev · MIT gallery, ≥17 вариантов.
 * См. assets/pets/petdex/ATTRIBUTION.md
 */

import bobaSheet from '@/assets/pets/petdex/boba/spritesheet.webp';
import wangcaiSheet from '@/assets/pets/petdex/wangcai/spritesheet.webp';
import usagiSheet from '@/assets/pets/petdex/usagi/spritesheet.webp';
import mallowSheet from '@/assets/pets/petdex/mallow/spritesheet.webp';
import tikoSheet from '@/assets/pets/petdex/tiko/spritesheet.webp';
import luluSheet from '@/assets/pets/petdex/lulu/spritesheet.webp';
import doraemonSheet from '@/assets/pets/petdex/doraemon/spritesheet.webp';
import eveSheet from '@/assets/pets/petdex/eve/spritesheet.webp';
import noirSheet from '@/assets/pets/petdex/noir/spritesheet.webp';
import shinchanSheet from '@/assets/pets/petdex/shinchan/spritesheet.webp';
import aiSheet from '@/assets/pets/petdex/ai/spritesheet.webp';
import gooseSheet from '@/assets/pets/petdex/goose/spritesheet.png';
import kabiSheet from '@/assets/pets/petdex/kabi/spritesheet.webp';
import dashengSheet from '@/assets/pets/petdex/dasheng/spritesheet.webp';
import ddoSheet from '@/assets/pets/petdex/ddo/spritesheet.webp';
import teemoSheet from '@/assets/pets/petdex/teemo/spritesheet.webp';

export type PetdexStateId =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export interface PetdexState {
  id: PetdexStateId;
  row: number;
  frames: number;
  durationMs: number;
}

export const PETDEX_STATES: PetdexState[] = [
  { id: 'idle', row: 0, frames: 6, durationMs: 1100 },
  { id: 'running-right', row: 1, frames: 8, durationMs: 1060 },
  { id: 'running-left', row: 2, frames: 8, durationMs: 1060 },
  { id: 'waving', row: 3, frames: 4, durationMs: 700 },
  { id: 'jumping', row: 4, frames: 5, durationMs: 840 },
  { id: 'failed', row: 5, frames: 8, durationMs: 1220 },
  { id: 'waiting', row: 6, frames: 6, durationMs: 1010 },
  { id: 'running', row: 7, frames: 6, durationMs: 820 },
  { id: 'review', row: 8, frames: 6, durationMs: 1030 },
];

export const PETDEX_FRAME_W = 192;
export const PETDEX_FRAME_H = 208;
export const PETDEX_SHEET_W = 1536;

export type PetdexSpecies =
  | 'boba'
  | 'wangcai'
  | 'usagi'
  | 'mallow'
  | 'tiko'
  | 'lulu'
  | 'doraemon'
  | 'eve'
  | 'noir'
  | 'shinchan'
  | 'ai'
  | 'goose'
  | 'kabi'
  | 'dasheng'
  | 'ddo'
  | 'teemo';

export type PetSpecies = PetdexSpecies | 'orb';

export type PetMood =
  | 'idle'
  | 'dance'
  | 'think'
  | 'typing'
  | 'working'
  | 'sleep'
  | 'eat'
  | 'smoke';

export interface PetCatalogEntry {
  id: PetSpecies;
  label: string;
  blurb: string;
  /** null = CSS orb */
  sheet: string | null;
}

export const PET_CATALOG: PetCatalogEntry[] = [
  { id: 'boba', label: 'Boba', blurb: 'Выдра + bubble tea', sheet: bobaSheet },
  { id: 'wangcai', label: 'Wangcai', blurb: 'Мягкий ragdoll-кот', sheet: wangcaiSheet },
  { id: 'usagi', label: 'Usagi', blurb: 'Кремовый кролик', sheet: usagiSheet },
  { id: 'mallow', label: 'Mallow', blurb: 'Плюшевый кот', sheet: mallowSheet },
  { id: 'lulu', label: 'Lulu', blurb: 'Капибара', sheet: luluSheet },
  { id: 'tiko', label: 'Tiko', blurb: 'Жёлтый робот', sheet: tikoSheet },
  { id: 'doraemon', label: 'Doraemon', blurb: 'Синий робот-кот', sheet: doraemonSheet },
  { id: 'eve', label: 'EVE', blurb: 'Белый робот EVE', sheet: eveSheet },
  { id: 'noir', label: 'Noir', blurb: 'Паук-детектив', sheet: noirSheet },
  { id: 'shinchan', label: 'Shinchan', blurb: 'Озорной малыш', sheet: shinchanSheet },
  { id: 'ai', label: 'Ai', blurb: 'Спокойный компаньон', sheet: aiSheet },
  { id: 'goose', label: 'Goose', blurb: 'Гусь Codux', sheet: gooseSheet },
  { id: 'kabi', label: 'Kabi', blurb: 'Сонный капи-друг', sheet: kabiSheet },
  { id: 'dasheng', label: 'Dasheng', blurb: 'Царь Обезьян', sheet: dashengSheet },
  { id: 'ddo', label: 'DDO', blurb: 'Фиолетовый маскот', sheet: ddoSheet },
  { id: 'teemo', label: 'Teemo', blurb: 'Пчелиный Teemo', sheet: teemoSheet },
  { id: 'orb', label: 'Orb', blurb: 'Soft mesh · SF 2027', sheet: null },
];

export const PET_SPECIES_IDS = PET_CATALOG.map((p) => p.id);

export function isPetSpecies(v: unknown): v is PetSpecies {
  return typeof v === 'string' && (PET_SPECIES_IDS as string[]).includes(v);
}

/** Старые id → актуальные. */
export function normalizeSpecies(v: unknown): PetSpecies {
  if (v === 'cat' || v === 'fox' || v === 'dog' || v === 'raccoon' || v === 'totoro') return 'wangcai';
  if (v === 'duck' || v === 'turtle' || v === 'snake' || v === 'crab' || v === 'clippy') return 'boba';
  if (isPetSpecies(v)) return v;
  return 'boba';
}

export function catalogEntry(id: PetSpecies): PetCatalogEntry {
  return PET_CATALOG.find((p) => p.id === id) ?? PET_CATALOG[0]!;
}

export function moodToPetdexState(mood: PetMood): PetdexState {
  const id: PetdexStateId =
    mood === 'dance'
      ? 'jumping'
      : mood === 'think'
        ? 'review'
        : mood === 'typing'
          ? 'waving'
          : mood === 'working'
            ? 'running'
            : mood === 'eat'
              ? 'waiting' // спокойно «сидит / жуёт»
              : mood === 'sleep'
                ? 'waiting'
                : mood === 'smoke'
                  ? 'waiting' // «пыхтит» + overlay сигареты
                  : 'idle';
  return PETDEX_STATES.find((s) => s.id === id) ?? PETDEX_STATES[0]!;
}
