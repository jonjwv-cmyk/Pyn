/**
 * Sync pet species + music selection with server (source of truth).
 * Local zustand cache = offline fallback / fast paint.
 *
 * Важно:
 *  · ждать rehydrate persist ДО wire/pull (иначе default `boba` затирает сервер);
 *  · не push до ready (после pull);
 *  · pet overlay = отдельный BrowserWindow → свой api token + свой store.
 */
import { api } from '@/lib/api';
import { useMusicStore } from '@/lib/music-store';
import { usePetStore } from '@/lib/pet-store';
import { normalizeSpecies, type PetSpecies } from '@/lib/pet-catalog';

export interface DesktopPrefs {
  pet_species: string;
  music_want_playing: boolean;
  music_playlist_id: string;
  music_playlist_index: number;
  music_track_title: string;
  music_paused_at: number | null;
}

export type DesktopPrefsPatch = {
  pet_species?: PetSpecies | string;
  music_want_playing?: boolean;
  music_playlist_id?: string;
  music_playlist_index?: number;
  music_track_title?: string;
  music_paused_at?: number | null;
};

let syncing = false;
/** false пока hydrate+pull не завершены — блокирует push default boba. */
let prefsReady = false;
let lastPush = 0;
const PUSH_DEBOUNCE_MS = 400;

let wiredPrevSpecies: PetSpecies | null = null;
let wiredPrevMusicKey: string | null = null;
let wired = false;
let initPromise: Promise<void> | null = null;

type PersistApi = {
  hasHydrated: () => boolean;
  onFinishHydration: (cb: () => void) => () => void;
};

function waitStoreHydrated(store: { persist?: PersistApi }): Promise<void> {
  const p = store.persist;
  if (!p) return Promise.resolve();
  if (p.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = p.onFinishHydration(() => {
      try {
        unsub();
      } catch {
        /* */
      }
      resolve();
    });
    // safety: if already hydrated between check and subscribe
    if (p.hasHydrated()) {
      try {
        unsub();
      } catch {
        /* */
      }
      resolve();
    }
  });
}

/**
 * Полный init для окна (main или pet overlay).
 * Идемпотентно: повторные вызовы ждут тот же цикл / no-op если ready.
 */
export async function initDesktopPrefs(): Promise<void> {
  if (prefsReady && wired) {
    // Повторный pull (напр. re-login) — обновить с сервера.
    await pullDesktopPrefs();
    return;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await Promise.all([
        waitStoreHydrated(usePetStore as unknown as { persist?: PersistApi }),
        waitStoreHydrated(useMusicStore as unknown as { persist?: PersistApi }),
      ]);
      wireDesktopPrefsSync();
      // pull под syncing — без push
      await pullDesktopPrefs();
      // После сервера — разослать species во все окна (main ↔ pet overlay)
      const sp = usePetStore.getState().species;
      void window.pyn?.pet?.broadcastSpecies?.(sp);
    } finally {
      prefsReady = true;
      initPromise = null;
    }
  })();

  return initPromise;
}

/** Подтянуть prefs с сервера → stores. */
export async function pullDesktopPrefs(): Promise<DesktopPrefs | null> {
  try {
    const r = await api.call<{
      ok?: boolean;
      prefs?: DesktopPrefs;
      error?: string;
    }>('desktop_prefs_get', {});
    if (!r?.ok || !r.prefs) {
      if (r?.error) console.warn('[pyn:prefs] pull not ok', r.error);
      return null;
    }
    applyPrefsLocal(r.prefs);
    wiredPrevSpecies = usePetStore.getState().species;
    wiredPrevMusicKey = musicKey(useMusicStore.getState());
    console.log('[pyn:prefs] pulled species=', r.prefs.pet_species);
    return r.prefs;
  } catch (err) {
    console.warn('[pyn:prefs] pull failed', err);
    return null;
  }
}

function applyPrefsLocal(prefs: DesktopPrefs): void {
  syncing = true;
  try {
    const sp = normalizeSpecies(prefs.pet_species);
    if (usePetStore.getState().species !== sp) {
      usePetStore.setState({ species: sp });
    }

    const want = !!prefs.music_want_playing;
    const playlistId =
      typeof prefs.music_playlist_id === 'string' ? prefs.music_playlist_id : '';
    const playlistIndex =
      typeof prefs.music_playlist_index === 'number' && Number.isFinite(prefs.music_playlist_index)
        ? Math.floor(prefs.music_playlist_index)
        : -1;
    const trackTitle =
      typeof prefs.music_track_title === 'string' ? prefs.music_track_title : '';
    const pausedAt =
      prefs.music_paused_at == null
        ? null
        : typeof prefs.music_paused_at === 'number' && Number.isFinite(prefs.music_paused_at)
          ? prefs.music_paused_at
          : null;

    const m = useMusicStore.getState();
    const musicPatch: Partial<{
      wantPlaying: boolean;
      lastPlaylistId: string;
      lastPlaylistIndex: number;
      trackTitle: string;
      pausedAt: number | null;
    }> = {};
    if (m.wantPlaying !== want) musicPatch.wantPlaying = want;
    if (playlistId && m.lastPlaylistId !== playlistId) {
      musicPatch.lastPlaylistId = playlistId;
    }
    if (playlistIndex >= 0 && m.lastPlaylistIndex !== playlistIndex) {
      musicPatch.lastPlaylistIndex = playlistIndex;
    }
    if (trackTitle && m.trackTitle !== trackTitle) {
      musicPatch.trackTitle = trackTitle;
    }
    if (Object.prototype.hasOwnProperty.call(prefs, 'music_paused_at')) {
      if (m.pausedAt !== pausedAt) musicPatch.pausedAt = pausedAt;
    }
    if (Object.keys(musicPatch).length > 0) {
      useMusicStore.setState(musicPatch);
    }
  } finally {
    window.setTimeout(() => {
      syncing = false;
    }, 0);
  }
}

/** Сохранить partial на сервер. */
export function pushDesktopPrefs(partial: DesktopPrefsPatch): void {
  if (syncing || !prefsReady) return;
  const now = Date.now();
  lastPush = now;
  window.setTimeout(() => {
    if (lastPush !== now) return;
    void pushNow(partial);
  }, PUSH_DEBOUNCE_MS);
}

function snapshotMusicPatch(): DesktopPrefsPatch {
  const m = useMusicStore.getState();
  return {
    music_want_playing: m.wantPlaying,
    music_playlist_id: m.lastPlaylistId || '',
    music_playlist_index: m.lastPlaylistIndex,
    music_track_title: m.trackTitle || '',
    music_paused_at: m.pausedAt,
  };
}

async function pushNow(partial: DesktopPrefsPatch): Promise<void> {
  try {
    const body: Record<string, unknown> = {};
    if (partial.pet_species != null) {
      body.pet_species = normalizeSpecies(partial.pet_species);
    }
    if (typeof partial.music_want_playing === 'boolean') {
      body.music_want_playing = partial.music_want_playing;
    }
    if (typeof partial.music_playlist_id === 'string') {
      body.music_playlist_id = partial.music_playlist_id.slice(0, 80);
    }
    if (typeof partial.music_playlist_index === 'number' && Number.isFinite(partial.music_playlist_index)) {
      body.music_playlist_index = Math.floor(partial.music_playlist_index);
    }
    if (typeof partial.music_track_title === 'string') {
      body.music_track_title = partial.music_track_title.slice(0, 200);
    }
    if (partial.music_paused_at === null) {
      body.music_paused_at = null;
    } else if (typeof partial.music_paused_at === 'number' && Number.isFinite(partial.music_paused_at)) {
      body.music_paused_at = Math.floor(partial.music_paused_at);
    }
    if (Object.keys(body).length === 0) return;
    const r = await api.call<{ ok?: boolean; error?: string; prefs?: DesktopPrefs }>(
      'desktop_prefs_set',
      body,
    );
    if (!r?.ok) {
      console.warn('[pyn:prefs] push not ok', r?.error);
      return;
    }
    if (body.pet_species) {
      console.log('[pyn:prefs] pushed species=', body.pet_species);
    }
  } catch (err) {
    console.warn('[pyn:prefs] push failed', err);
  }
}

export function applySpeciesRemote(species: string): void {
  const sp = normalizeSpecies(species);
  if (usePetStore.getState().species === sp) return;
  syncing = true;
  try {
    usePetStore.setState({ species: sp });
    wiredPrevSpecies = sp;
  } finally {
    window.setTimeout(() => {
      syncing = false;
    }, 0);
  }
}

/**
 * Подписка stores → server + cross-window IPC.
 * Вызывать после hydrate (через initDesktopPrefs).
 */
export function wireDesktopPrefsSync(): void {
  if (wired) return;
  wired = true;

  wiredPrevSpecies = usePetStore.getState().species;
  usePetStore.subscribe((s) => {
    if (syncing || !prefsReady) return;
    if (s.species === wiredPrevSpecies) return;
    wiredPrevSpecies = s.species;
    pushDesktopPrefs({ pet_species: s.species });
    void window.pyn?.pet?.broadcastSpecies?.(s.species);
  });

  wiredPrevMusicKey = musicKey(useMusicStore.getState());
  useMusicStore.subscribe((s) => {
    if (syncing || !prefsReady) return;
    const key = musicKey(s);
    if (key === wiredPrevMusicKey) return;
    wiredPrevMusicKey = key;
    pushDesktopPrefs(snapshotMusicPatch());
  });

  try {
    window.pyn?.pet?.onSpecies?.((species) => {
      applySpeciesRemote(species);
    });
  } catch {
    /* no pet bridge */
  }
}

function musicKey(s: {
  wantPlaying: boolean;
  lastPlaylistId: string;
  lastPlaylistIndex: number;
  trackTitle: string;
  pausedAt: number | null;
}): string {
  return [
    s.wantPlaying ? '1' : '0',
    s.lastPlaylistId || '',
    String(s.lastPlaylistIndex),
    s.trackTitle || '',
    s.pausedAt == null ? '' : String(s.pausedAt),
  ].join('|');
}
