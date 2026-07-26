import { createZustandStore, persist } from '@pyn/core';
import { createCacheStorage } from './cache-storage';
import {
  clampWaveIndex,
  MUSIC_WAVE_COUNT,
  nextWaveIndex,
  waveAt,
} from './music-waves';

/**
 * Hi-Fi плеер + 4 волны.
 *  - next → переборка ВНУТРИ волны (YT: next track; stream: reconnect/skip)
 *  - cycleWave → Волна 1→2→3→4→1
 */

export const MUSIC_LONG_PAUSE_MS = 2 * 60 * 60 * 1000;

export interface MusicStoreState {
  wantPlaying: boolean;
  isPlaying: boolean;
  ready: boolean;
  trackTitle: string;
  error: string | null;
  lastPlaylistId: string;
  lastPlaylistIndex: number;
  pausedAt: number | null;
  /** 0..3 — Волна 1..4 */
  waveIndex: number;

  setWantPlaying: (v: boolean) => void;
  setIsPlaying: (v: boolean) => void;
  setReady: (v: boolean) => void;
  setTrackTitle: (t: string) => void;
  setError: (e: string | null) => void;
  rememberTrack: (opts: {
    playlistId?: string;
    index: number;
    title?: string;
  }) => void;

  requestToggle: number;
  requestNext: number;
  requestWave: number;
  toggle: () => void;
  /** Внутри волны: следующий трек / skip stream. */
  next: () => void;
  /** Смена волны 1→2→3→4→1. */
  cycleWave: () => void;
  setWaveIndex: (i: number) => void;
}

export function shouldStartFreshTrack(state: {
  wantPlaying: boolean;
  pausedAt: number | null;
  now?: number;
}): boolean {
  if (state.wantPlaying) return false;
  if (state.pausedAt == null) return false;
  const now = state.now ?? Date.now();
  return now - state.pausedAt >= MUSIC_LONG_PAUSE_MS;
}

export const useMusicStore = createZustandStore<MusicStoreState>()(
  persist(
    (set) => ({
      wantPlaying: false,
      isPlaying: false,
      ready: false,
      trackTitle: '',
      error: null,
      lastPlaylistId: '',
      lastPlaylistIndex: -1,
      pausedAt: null,
      waveIndex: 0,
      requestToggle: 0,
      requestNext: 0,
      requestWave: 0,
      setWantPlaying: (v) =>
        set((s) => ({
          wantPlaying: v,
          pausedAt: v ? null : (s.pausedAt ?? Date.now()),
        })),
      setIsPlaying: (v) => set({ isPlaying: v }),
      setReady: (v) => set({ ready: v }),
      setTrackTitle: (t) => set({ trackTitle: t }),
      setError: (e) => set({ error: e }),
      rememberTrack: ({ playlistId, index, title }) =>
        set((s) => ({
          lastPlaylistIndex: index >= 0 ? index : s.lastPlaylistIndex,
          lastPlaylistId: playlistId || s.lastPlaylistId,
          trackTitle: title?.trim() ? title.trim() : s.trackTitle,
          pausedAt: null,
        })),
      toggle: () => set((s) => ({ requestToggle: s.requestToggle + 1 })),
      // Всегда внутри волны (не меняет waveIndex)
      next: () => set((s) => ({ requestNext: s.requestNext + 1 })),
      cycleWave: () =>
        set((s) => {
          const ni = nextWaveIndex(s.waveIndex);
          const nw = waveAt(ni);
          return {
            requestWave: s.requestWave + 1,
            waveIndex: ni,
            trackTitle: nw.label,
            error: null,
            // не трогаем isPlaying/ready — плеер сам выставит после play
            // смена волны — продолжаем играть
            wantPlaying: true,
            pausedAt: null,
          };
        }),
      setWaveIndex: (i) =>
        set((s) => {
          const ni = clampWaveIndex(i);
          if (ni === s.waveIndex) return s;
          const nw = waveAt(ni);
          return {
            requestWave: s.requestWave + 1,
            waveIndex: ni,
            trackTitle: nw.label,
            error: null,
            wantPlaying: true,
            pausedAt: null,
          };
        }),
    }),
    {
      name: 'pyn-music',
      storage: createCacheStorage(),
      partialize: (s) => ({
        wantPlaying: s.wantPlaying,
        lastPlaylistId: s.lastPlaylistId,
        lastPlaylistIndex: s.lastPlaylistIndex,
        trackTitle: s.trackTitle,
        pausedAt: s.pausedAt,
        waveIndex: s.waveIndex,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MusicStoreState>;
        const wi =
          typeof p.waveIndex === 'number' ? clampWaveIndex(p.waveIndex) : 0;
        return {
          ...current,
          ...p,
          waveIndex: wi,
          // не автоплей без клика (Electron/YouTube autoplay policy)
          wantPlaying: false,
          isPlaying: false,
          ready: false,
          error: null,
          lastPlaylistIndex:
            typeof p.lastPlaylistIndex === 'number' ? p.lastPlaylistIndex : -1,
          pausedAt: typeof p.pausedAt === 'number' ? p.pausedAt : null,
          trackTitle:
            (p.trackTitle && p.trackTitle.trim()) || waveAt(wi).label,
        };
      },
    },
  ),
);

export { MUSIC_WAVE_COUNT, waveAt };
