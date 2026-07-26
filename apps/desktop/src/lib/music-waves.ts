/**
 * 4 волны (источника) Hi-Fi плеера.
 * Волна 1 — YouTube канал @Ino-KHK (uploads / плейлисты).
 * 2–4 — live Icecast/HTTP streams.
 */

export type MusicWaveKind = 'youtube' | 'stream';

export interface MusicWave {
  /** 1..4 для UI «Волна N». */
  n: number;
  id: string;
  label: string;
  shortLabel: string;
  kind: MusicWaveKind;
  /** YouTube playlist id (kind=youtube). */
  playlistId?: string;
  /** Direct stream URL (kind=stream). */
  streamUrl?: string;
  /** Fallback stream URLs. */
  streamFallbacks?: string[];
}

/**
 * @Ino-KHK — https://www.youtube.com/@Ino-KHK
 * channel UCr4ANLdmH6veW4mvZMwIQHA → uploads playlist UU…
 */
export const INO_KHK_CHANNEL_ID = 'UCr4ANLdmH6veW4mvZMwIQHA';
export const INO_KHK_UPLOADS = 'UUr4ANLdmH6veW4mvZMwIQHA';
/** Один из публичных плейлистов канала (fallback, если UU* не крутится). */
export const INO_KHK_PLAYLIST_FALLBACK = 'PLKk2oXKFvy810nV4AmNSnO1GLHsfeqCht';

export const YT_PLAYLIST_PRIMARY = INO_KHK_UPLOADS;

export const MUSIC_WAVES: readonly MusicWave[] = [
  {
    n: 1,
    id: 'ino-khk',
    label: 'Ino-KHK',
    shortLabel: 'Ino-KHK',
    kind: 'youtube',
    playlistId: INO_KHK_UPLOADS,
  },
  {
    n: 2,
    id: 'streamafrica-lofi',
    label: 'StreamAfrica Lofi',
    shortLabel: 'Lofi Radio',
    kind: 'stream',
    // Прямой Icecast edge (play.streamafrica.net → 302, CORS/crossOrigin ломал play)
    streamUrl: 'https://boxradio-edge-00.streamafrica.net/lofi',
    streamFallbacks: [
      'https://play.streamafrica.net/lofiradio',
      'https://boxradio-edge-01.streamafrica.net/lofi',
    ],
  },
  {
    n: 3,
    id: 'nightride-synth',
    label: 'Nightride FM (Synth)',
    shortLabel: 'Nightride',
    kind: 'stream',
    streamUrl: 'https://stream.nightride.fm/nightride.mp3',
    streamFallbacks: [
      'https://stream.nightride.fm/nightride.m4a',
      'https://stream.nightride.fm/chillsynth.mp3',
    ],
  },
  {
    n: 4,
    id: 'datawave-city',
    label: 'Nightride Datawave (City / Vapor)',
    shortLabel: 'Datawave',
    kind: 'stream',
    // plaza.one/mp3 сейчас 404 — Datawave как city-pop/vapor live
    streamUrl: 'https://stream.nightride.fm/datawave.mp3',
    streamFallbacks: [
      'https://stream.nightride.fm/chillsynth.mp3',
      'https://stream.nightride.fm/darksynth.mp3',
    ],
  },
] as const;

export const MUSIC_WAVE_COUNT = MUSIC_WAVES.length;

export function clampWaveIndex(i: number): number {
  if (!Number.isFinite(i)) return 0;
  const n = Math.floor(i);
  if (n < 0) return 0;
  if (n >= MUSIC_WAVE_COUNT) return n % MUSIC_WAVE_COUNT;
  return n;
}

export function waveAt(index: number): MusicWave {
  return MUSIC_WAVES[clampWaveIndex(index)]!;
}

export function nextWaveIndex(current: number): number {
  return (clampWaveIndex(current) + 1) % MUSIC_WAVE_COUNT;
}

export function waveStatusLabel(index: number, trackTitle?: string): string {
  const w = waveAt(index);
  const t = (trackTitle || '').trim();
  if (t) return t;
  return w.label;
}
