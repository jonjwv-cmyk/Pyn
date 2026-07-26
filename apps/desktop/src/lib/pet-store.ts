import { createZustandStore, persist } from '@pyn/core';
import { createCacheStorage } from './cache-storage';
import { normalizeSpecies, type PetMood, type PetSpecies } from './pet-catalog';
import type { WeatherFx } from './pet-context';

export type { PetMood, PetSpecies, WeatherFx };

/** Сколько держим «пыхтит» с сигаретой. */
export const PET_SMOKE_MS = 28_000;

export interface PetStoreState {
  species: PetSpecies;
  name: string;
  mood: PetMood;
  /** Визуал погоды (зонтик / пот / шарф…) — отдельно от mood. */
  weatherFx: WeatherFx;
  /** До какого timestamp (ms) — сигарета / дым. */
  smokeUntil: number;
  aiThinking: boolean;
  bubble: string | null;
  bubbleAt: number;
  setSpecies: (s: PetSpecies) => void;
  setName: (n: string) => void;
  setMood: (m: PetMood) => void;
  setWeatherFx: (fx: WeatherFx) => void;
  setAiThinking: (v: boolean) => void;
  /** Перекур: mood smoke + сигарета + bubble. */
  startSmokeBreak: (phrase?: string, ms?: number) => void;
  say: (text: string, ms?: number) => void;
  clearBubble: () => void;
}

const DEFAULT_NAME = 'Питомец';

export const usePetStore = createZustandStore<PetStoreState>()(
  persist(
    (set) => ({
      species: 'boba',
      name: DEFAULT_NAME,
      mood: 'idle',
      weatherFx: 'none',
      smokeUntil: 0,
      aiThinking: false,
      bubble: null,
      bubbleAt: 0,
      setSpecies: (species) => set({ species: normalizeSpecies(species) }),
      setName: (name) => set({ name: name.trim() || DEFAULT_NAME }),
      setMood: (mood) => set({ mood }),
      setWeatherFx: (weatherFx) => set({ weatherFx }),
      setAiThinking: (aiThinking) => set({ aiThinking }),
      startSmokeBreak: (phrase, ms = PET_SMOKE_MS) => {
        const t =
          (phrase ?? pickLocalPhrase('smoke_break')).trim() || 'Перекурим? 🚬';
        const until = Date.now() + ms;
        set({
          mood: 'smoke',
          smokeUntil: until,
          bubble: t,
          bubbleAt: Date.now(),
        });
        window.setTimeout(() => {
          const s = usePetStore.getState();
          if (s.bubble === t) set({ bubble: null });
          if (s.smokeUntil === until) {
            set({
              smokeUntil: 0,
              mood: s.mood === 'smoke' ? 'idle' : s.mood,
            });
          }
        }, ms);
      },
      say: (text, ms = 4500) => {
        const t = text.trim();
        if (!t) return;
        set({ bubble: t, bubbleAt: Date.now() });
        window.setTimeout(() => {
          if (usePetStore.getState().bubble === t) set({ bubble: null });
        }, ms);
      },
      clearBubble: () => set({ bubble: null }),
    }),
    {
      name: 'pyn-pet',
      storage: createCacheStorage(),
      // Только species локально (fallback offline); сервер — desktop_prefs.
      partialize: (s) => ({ species: s.species }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PetStoreState>;
        return {
          ...current,
          ...p,
          species: normalizeSpecies(p.species ?? current.species),
        };
      },
    },
  ),
);

export type PhraseKind =
  | 'idle'
  | 'music'
  | 'working'
  | 'typing'
  | 'pause'
  | 'think'
  | 'click'
  | 'fast_typing'
  | 'busy_mouse'
  | 'productivity'
  | 'lunch_soon'
  | 'lunch'
  | 'shift_end_soon'
  | 'weekend_work'
  | 'off_hours'
  | 'weather'
  | 'plan'
  | 'report'
  | 'transport_idle'
  | 'smoke_break';

/**
 * Локальный пул: только русский, без рода (никаких «красавчик/умница» и т.п.).
 * Факты план/отчёт/простой/погода — в pet-context.localPhraseFromContext.
 */
export const PET_LOCAL_PHRASES: Record<PhraseKind, readonly string[]> = {
  idle: [
    'Привет! Как настроение?',
    'Ого, всё ещё в деле? Не забудь отдохнуть 👀',
    'Ну и задачку ты решаешь…',
    'Я рядом — кликни, если нужен чат.',
  ],
  music: [
    'Качает! Lofi 🎶',
    'Этот бит расслабляет…',
    'Слушаю вместе 🎧',
    'Круто! Класс, приятно ✨',
  ],
  working: [
    'Так продуктивно — супер! 💪',
    'Вижу темп — круто, не сбавляй.',
    'В потоке! Так держать ✨',
  ],
  typing: ['Печатаешь? Я рядом ⌨️', 'Мысли летят — я с тобой.'],
  pause: ['Музыка на паузе. Стало тихо…', 'Тишина тоже ок.'],
  think: ['Думаю… 🧠', 'Секунду, ищу ответ…'],
  click: ['Эй, клик! Чем помочь?', 'Я тут!'],
  fast_typing: [
    'Скорость набора огонь — настоящий писатель! ✍️',
    'Вау, клавиши не успевают 🔥',
    'Так быстро печатать — восхищаюсь ✨',
  ],
  busy_mouse: [
    'Продуктивность супер! 🚀',
    'Какой темп — круто!',
    'Вот это работа! Продолжай 💪',
  ],
  productivity: [
    'Продуктивность огонь — ты супер! ⭐',
    'Долго в деле и не сбавляешь 👀',
    'Настоящий писатель и трудяга 💼',
  ],
  lunch_soon: [
    'Скоро обед — через час. Не забудь перерыв! 🍽️',
    'Обед близко. Добей кусок и отдохни.',
    'Через час обед. Водичку не забудь 💧',
  ],
  lunch: [
    'Обед! Приятного аппетита 🍱',
    'Кушаю… и чуть вздремну 🥢',
    'Обеденный тайм — перезарядка!',
  ],
  shift_end_soon: [
    'До конца смены час — можно без геройства 🕐',
    'Скоро конец дня. Добей хвосты и на выход!',
    'Час до конца смены. Отдыхать тоже надо.',
  ],
  weekend_work: [
    'Работа в выходной — сила! Но отдохни 💪',
    'Выходной, а дело идёт… выдохни 👀',
    'Праздник, а ты в потоке. Ты супер — береги себя.',
  ],
  off_hours: [
    'Вне смены? Монстр продуктивности. Отдых важен 🌙',
    'Рабочий день уже не тот — журю: отдыхай.',
    'После смены ещё в деле? Хватит на сегодня.',
  ],
  weather: ['Погода интересная. Я подстроился!', 'Смотрю на небо…'],
  plan: ['Проверяю план на ближайший день…', 'План по графику на контроле 📋'],
  report: ['Глянул отчёт — есть ли статусы…', 'Отчёт любит заполненные строки ✍️'],
  transport_idle: ['Смотрю, кто из машин стоит…', 'Транспорт на сегодня под присмотром 🚛'],
  smoke_break: [
    'Перекурим? 🚬',
    'Пых… перекур. С нами? 🚬',
    'Сигаретка? Выдохни пару минут 💨',
    'Перекур! Я уже пыхчу 🚬',
    'Пора подымить — оторвись от монитора 👀',
  ],
};

export function pickLocalPhrase(kind: PhraseKind): string {
  const list = PET_LOCAL_PHRASES[kind] ?? PET_LOCAL_PHRASES.idle;
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!;
}
