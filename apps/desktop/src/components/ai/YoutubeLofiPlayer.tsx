import { useEffect, useRef } from 'react';
import { useMusicStore } from '@/lib/music-store';
import {
  INO_KHK_PLAYLIST_FALLBACK,
  YT_PLAYLIST_PRIMARY,
  waveAt,
} from '@/lib/music-waves';
import { usePetStore, pickLocalPhrase } from '@/lib/pet-store';

/**
 * Волна 1: YouTube @Ino-KHK — playlist, shuffle всегда.
 * Волны 2–4 — StreamRadioPlayer.
 */

const PLAYLIST_PRIMARY = YT_PLAYLIST_PRIMARY;
const PLAYLIST_FALLBACK = INO_KHK_PLAYLIST_FALLBACK;

const YT_API_SRC = 'https://www.youtube.com/iframe_api';

const YT_UNSTARTED = -1;
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_CUED = 5;

interface YtPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  nextVideo: () => void;
  previousVideo?: () => void;
  stopVideo: () => void;
  getPlayerState: () => number;
  getVideoData: () => { title?: string; video_id?: string };
  getPlaylistIndex: () => number;
  getPlaylist?: () => string[];
  setShuffle?: (shufflePlaylist: boolean) => void;
  setLoop?: (loopPlaylists: boolean) => void;
  loadPlaylist: (opts: {
    list: string;
    listType?: string;
    index?: number;
  }) => void;
  destroy: () => void;
}

interface YtNamespace {
  Player: new (
    el: string | HTMLElement,
    opts: Record<string, unknown>,
  ) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function isInoPlaylist(id: string): boolean {
  return (
    id === PLAYLIST_PRIMARY ||
    id === PLAYLIST_FALLBACK ||
    id.startsWith('UUr4ANLdmH6veW4mvZMwIQHA') ||
    id.startsWith('PLKk2oXKFvy8')
  );
}

function randomBootIndex(): number {
  // «всегда вперемешку» — старт с случайной позиции
  return Math.floor(Math.random() * 40);
}

/**
 * Off-screen YouTube IFrame playlist player (Волна 1).
 */
export function YoutubeLofiPlayer() {
  const playerRef = useRef<YtPlayer | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const errorStreak = useRef(0);
  const playlistId = useRef(PLAYLIST_PRIMARY);
  const playlistIndex = useRef(0);
  const created = useRef(false);

  const waveIndex = useMusicStore((s) => s.waveIndex);
  const isYtWave = waveAt(waveIndex).kind === 'youtube';
  const wantPlaying = useMusicStore((s) => s.wantPlaying);
  const requestToggle = useMusicStore((s) => s.requestToggle);
  const requestNext = useMusicStore((s) => s.requestNext);
  const setIsPlaying = useMusicStore((s) => s.setIsPlaying);
  const setReady = useMusicStore((s) => s.setReady);
  const setTrackTitle = useMusicStore((s) => s.setTrackTitle);
  const setWantPlaying = useMusicStore((s) => s.setWantPlaying);
  const setError = useMusicStore((s) => s.setError);
  const rememberTrack = useMusicStore((s) => s.rememberTrack);
  const setMood = usePetStore((s) => s.setMood);
  const say = usePetStore((s) => s.say);

  const applyShuffle = (p: YtPlayer) => {
    try {
      p.setShuffle?.(true);
      p.setLoop?.(true);
    } catch {
      /* */
    }
  };

  const tryPlay = (p: YtPlayer) => {
    if (!useMusicStore.getState().wantPlaying) return;
    if (waveAt(useMusicStore.getState().waveIndex).kind !== 'youtube') return;
    try {
      p.playVideo();
    } catch {
      /* autoplay */
    }
  };

  // Не YT-волна → пауза
  useEffect(() => {
    if (isYtWave) return;
    const p = playerRef.current;
    if (!p) return;
    try {
      p.pauseVideo();
    } catch {
      /* */
    }
  }, [isYtWave, waveIndex]);

  // Mount YT API + player once
  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;
    const mountId = 'pyn-hidden-yt-player';

    playlistId.current = PLAYLIST_PRIMARY;
    playlistIndex.current = randomBootIndex();

    const skipOrFallback = (p: YtPlayer) => {
      errorStreak.current += 1;
      if (errorStreak.current >= 2 && playlistId.current === PLAYLIST_PRIMARY) {
        playlistId.current = PLAYLIST_FALLBACK;
        playlistIndex.current = randomBootIndex();
        errorStreak.current = 0;
        console.warn('[pyn:music] Ino uploads fail → channel playlist fallback');
        try {
          p.loadPlaylist({
            list: PLAYLIST_FALLBACK,
            listType: 'playlist',
            index: playlistIndex.current,
          });
          window.setTimeout(() => {
            applyShuffle(p);
            tryPlay(p);
          }, 500);
          return;
        } catch (err) {
          console.warn('[pyn:music] fallback load failed', err);
        }
      }
      if (errorStreak.current > 15) {
        setError('youtube_embed_blocked');
        setIsPlaying(false);
        return;
      }
      // skip broken video — shuffle next
      try {
        p.nextVideo();
      } catch {
        playlistIndex.current = randomBootIndex();
        try {
          p.loadPlaylist({
            list: playlistId.current,
            listType: 'playlist',
            index: playlistIndex.current,
          });
          window.setTimeout(() => tryPlay(p), 400);
        } catch {
          setError('youtube_skip_failed');
        }
      }
    };

    const createPlayer = () => {
      if (cancelled || !window.YT?.Player || !hostRef.current) return;
      if (playerRef.current || created.current) return;
      created.current = true;
      try {
        hostRef.current.innerHTML = '';
        const el = document.createElement('div');
        el.id = mountId;
        hostRef.current.appendChild(el);

        const origin =
          typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'http://localhost:5173';

        const bootIndex = Math.max(0, playlistIndex.current);

        new window.YT.Player(mountId, {
          height: 135,
          width: 240,
          playerVars: {
            listType: 'playlist',
            list: playlistId.current,
            index: bootIndex,
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin,
          },
          events: {
            onReady: (e: { target: YtPlayer }) => {
              if (cancelled) return;
              playerRef.current = e.target;
              setReady(true);
              setError(null);
              errorStreak.current = 0;
              applyShuffle(e.target);
              console.log(
                '[pyn:music] YT ready Ino-KHK shuffle index=',
                bootIndex,
                'want=',
                useMusicStore.getState().wantPlaying,
              );
              window.setTimeout(() => tryPlay(e.target), 300);
            },
            onStateChange: (e: { data: number; target: YtPlayer }) => {
              if (cancelled) return;
              if (waveAt(useMusicStore.getState().waveIndex).kind !== 'youtube') {
                return;
              }
              playerRef.current = e.target;
              if (
                e.data === YT_BUFFERING ||
                e.data === YT_CUED ||
                e.data === YT_UNSTARTED
              ) {
                return;
              }
              const playing = e.data === YT_PLAYING;
              setIsPlaying(playing);
              if (playing) {
                errorStreak.current = 0;
                setError(null);
                setMood('dance');
                applyShuffle(e.target);
                let idx = playlistIndex.current;
                try {
                  const i = e.target.getPlaylistIndex?.();
                  if (typeof i === 'number' && i >= 0) {
                    idx = i;
                    playlistIndex.current = i;
                  }
                } catch {
                  /* */
                }
                let title = '';
                try {
                  title = e.target.getVideoData()?.title || '';
                } catch {
                  /* */
                }
                rememberTrack({
                  playlistId: playlistId.current,
                  index: idx,
                  title,
                });
                // без bubble с названием трека (юзер 2026-07-26)
                if (title) setTrackTitle(title);
              } else if (e.data === YT_PAUSED) {
                setIsPlaying(false);
                if (!useMusicStore.getState().wantPlaying) setMood('idle');
              } else if (e.data === YT_ENDED) {
                setIsPlaying(false);
                if (useMusicStore.getState().wantPlaying) {
                  try {
                    e.target.nextVideo();
                  } catch {
                    /* */
                  }
                }
              }
            },
            onError: (e: { data: number; target?: YtPlayer }) => {
              console.warn('[pyn:music] YT error', e?.data, 'streak', errorStreak.current);
              const p = e?.target ?? playerRef.current;
              if (e?.target) playerRef.current = e.target;
              if (!p) {
                setError(`youtube_error_${e?.data ?? '?'}`);
                return;
              }
              skipOrFallback(p);
            },
          },
        });
      } catch (err) {
        console.warn('[pyn:music] createPlayer failed', err);
        setError('youtube_create_failed');
        created.current = false;
      }
    };

    const waitForApi = () => {
      if (cancelled) return;
      if (window.YT?.Player) {
        createPlayer();
        return;
      }
      pollTimer = window.setTimeout(waitForApi, 200);
    };

    if (!document.querySelector(`script[src="${YT_API_SRC}"]`)) {
      const tag = document.createElement('script');
      tag.src = YT_API_SRC;
      tag.async = true;
      tag.onerror = () => {
        setError('youtube_script_blocked');
        console.warn('[pyn:music] iframe_api blocked');
      };
      document.head.appendChild(tag);
    }
    waitForApi();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      setReady(false);
      try {
        playerRef.current?.destroy();
      } catch {
        /* */
      }
      playerRef.current = null;
      created.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle play/pause (только YT-волна)
  useEffect(() => {
    if (requestToggle === 0) return;
    if (!isYtWave) return;
    const p = playerRef.current;
    const st = useMusicStore.getState();
    const wantPlay = !st.isPlaying;

    if (wantPlay) {
      setWantPlaying(true);
      setError(null);
      if (!p) {
        console.warn('[pyn:music] toggle: player not ready');
        return;
      }
      try {
        applyShuffle(p);
        p.playVideo();
      } catch (err) {
        setError('youtube_control_failed');
        console.warn('[pyn:music] toggle play', err);
      }
      return;
    }

    setWantPlaying(false);
    if (!p) return;
    try {
      p.pauseVideo();
      setMood('idle');
      say(pickLocalPhrase('pause'), 3500);
    } catch (err) {
      setError('youtube_control_failed');
      console.warn('[pyn:music] toggle pause', err);
    }
  }, [requestToggle, isYtWave, setWantPlaying, setMood, say, setError]);

  // Next track ВНУТРИ волны 1
  useEffect(() => {
    if (requestNext === 0) return;
    if (!isYtWave) return;
    const p = playerRef.current;
    if (!p) return;
    try {
      setWantPlaying(true);
      setError(null);
      applyShuffle(p);
      p.nextVideo();
    } catch {
      try {
        playlistIndex.current = randomBootIndex();
        p.loadPlaylist({
          list: playlistId.current,
          listType: 'playlist',
          index: playlistIndex.current,
        });
        window.setTimeout(() => tryPlay(p), 400);
      } catch {
        /* */
      }
    }
  }, [requestNext, isYtWave, setWantPlaying, setError]);

  // wantPlaying / возврат на волну 1 после stream — с задержкой (stream успевает отпустить)
  useEffect(() => {
    if (!isYtWave) return;
    const p = playerRef.current;
    if (!p) return;
    if (!wantPlaying) {
      try {
        p.pauseVideo();
      } catch {
        /* */
      }
      return;
    }
    const t = window.setTimeout(() => {
      if (waveAt(useMusicStore.getState().waveIndex).kind !== 'youtube') return;
      if (!useMusicStore.getState().wantPlaying) return;
      try {
        applyShuffle(p);
        setError(null);
        const st = p.getPlayerState?.();
        if (st !== YT_PLAYING && st !== YT_BUFFERING) {
          // перезагрузить плейлист если зависло
          if (st === YT_UNSTARTED || st === YT_CUED || st === -1) {
            p.loadPlaylist({
              list: playlistId.current,
              listType: 'playlist',
              index: Math.max(0, playlistIndex.current),
            });
            window.setTimeout(() => tryPlay(p), 400);
          } else {
            p.playVideo();
          }
        }
      } catch (err) {
        console.warn('[pyn:music] resume YT wave1', err);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [wantPlaying, isYtWave, waveIndex, setError]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none fixed"
      style={{
        left: -9999,
        top: 0,
        width: 240,
        height: 135,
        overflow: 'hidden',
        opacity: 0.01,
      }}
    />
  );
}
