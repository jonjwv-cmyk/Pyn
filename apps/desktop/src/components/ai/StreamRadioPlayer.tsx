import { useEffect, useRef } from 'react';
import { useMusicStore } from '@/lib/music-store';
import { waveAt } from '@/lib/music-waves';
import { usePetStore } from '@/lib/pet-store';

/**
 * HTMLAudio live-stream для волн 2–4.
 * Надёжная смена волны: generation id + canplay → play (без гонок pause/play).
 */
export function StreamRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const genRef = useRef(0);
  const urlIdx = useRef(0);

  const waveIndex = useMusicStore((s) => s.waveIndex);
  const wantPlaying = useMusicStore((s) => s.wantPlaying);
  const requestToggle = useMusicStore((s) => s.requestToggle);
  const requestNext = useMusicStore((s) => s.requestNext);
  const setIsPlaying = useMusicStore((s) => s.setIsPlaying);
  const setReady = useMusicStore((s) => s.setReady);
  const setTrackTitle = useMusicStore((s) => s.setTrackTitle);
  const setWantPlaying = useMusicStore((s) => s.setWantPlaying);
  const setError = useMusicStore((s) => s.setError);
  const setMood = usePetStore((s) => s.setMood);

  const wave = waveAt(waveIndex);
  const isStream = wave.kind === 'stream';

  const streamUrls = (): string[] => {
    const w = waveAt(useMusicStore.getState().waveIndex);
    if (w.kind !== 'stream') return [];
    return [w.streamUrl, ...(w.streamFallbacks ?? [])].filter(Boolean) as string[];
  };

  const playSrc = (a: HTMLAudioElement, src: string, gen: number) => {
    a.pause();
    try {
      a.removeAttribute('src');
      a.load();
    } catch {
      /* */
    }
    a.src = src;
    a.load();

    const tryPlay = () => {
      if (gen !== genRef.current) return;
      if (!useMusicStore.getState().wantPlaying) return;
      if (waveAt(useMusicStore.getState().waveIndex).kind !== 'stream') return;
      void a.play().then(
        () => {
          if (gen !== genRef.current) return;
          setIsPlaying(true);
          setReady(true);
          setError(null);
          setMood('dance');
        },
        (err) => {
          if (gen !== genRef.current) return;
          console.warn('[pyn:music] stream play fail', err);
          // fallback URL
          const urls = streamUrls();
          urlIdx.current += 1;
          if (urlIdx.current < urls.length) {
            playSrc(a, urls[urlIdx.current]!, gen);
            return;
          }
          setError('stream_play_failed');
          setIsPlaying(false);
          setReady(false);
        },
      );
    };

    const onCanPlay = () => {
      a.removeEventListener('canplay', onCanPlay);
      tryPlay();
    };
    a.addEventListener('canplay', onCanPlay);
    // safety: some streams never fire canplay promptly
    window.setTimeout(tryPlay, 800);
  };

  // create audio once
  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    audioRef.current = a;

    const onPlaying = () => {
      setIsPlaying(true);
      setReady(true);
      setError(null);
      setMood('dance');
    };
    const onPause = () => {
      // не гасим isPlaying если уже ушли на другую волну / YT
      if (waveAt(useMusicStore.getState().waveIndex).kind !== 'stream') return;
      setIsPlaying(false);
      if (!useMusicStore.getState().wantPlaying) setMood('idle');
    };
    const onError = () => {
      if (waveAt(useMusicStore.getState().waveIndex).kind !== 'stream') return;
      const gen = genRef.current;
      const urls = streamUrls();
      urlIdx.current += 1;
      if (urlIdx.current < urls.length) {
        console.warn('[pyn:music] stream error → fallback', urlIdx.current);
        playSrc(a, urls[urlIdx.current]!, gen);
        return;
      }
      setError('stream_error');
      setIsPlaying(false);
      setReady(false);
    };

    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', onPause);
    a.addEventListener('error', onError);

    return () => {
      genRef.current += 1;
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('error', onError);
      a.pause();
      a.removeAttribute('src');
      try {
        a.load();
      } catch {
        /* */
      }
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Смена волны
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const gen = ++genRef.current;

    if (!isStream) {
      a.pause();
      try {
        a.removeAttribute('src');
        a.load();
      } catch {
        /* */
      }
      return;
    }

    const urls = [wave.streamUrl, ...(wave.streamFallbacks ?? [])].filter(Boolean) as string[];
    urlIdx.current = 0;
    if (urls.length === 0) {
      setError('stream_no_url');
      return;
    }
    setTrackTitle(wave.label);
    setError(null);
    setReady(false);
    // не ставим isPlaying false здесь — иначе мигание; playSrc выставит true
    playSrc(a, urls[0]!, gen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveIndex, isStream]);

  // wantPlaying while on stream
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !isStream) return;
    if (wantPlaying) {
      if (!a.src) {
        const urls = streamUrls();
        if (urls[0]) playSrc(a, urls[0], genRef.current);
        return;
      }
      void a.play().catch(() => {
        /* playSrc fallback path */
      });
    } else {
      a.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlaying, isStream]);

  // toggle
  useEffect(() => {
    if (requestToggle === 0) return;
    if (!isStream) return;
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      setWantPlaying(false);
      setMood('idle');
    } else {
      setWantPlaying(true);
      const gen = genRef.current;
      if (!a.src) {
        const urls = streamUrls();
        if (urls[0]) playSrc(a, urls[0], gen);
      } else {
        void a.play().catch(() => setError('stream_play_failed'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestToggle, isStream]);

  // next within stream wave
  useEffect(() => {
    if (requestNext === 0) return;
    if (!isStream) return;
    const a = audioRef.current;
    if (!a) return;
    const urls = streamUrls();
    if (urls.length === 0) return;
    urlIdx.current = (urlIdx.current + 1) % urls.length;
    setWantPlaying(true);
    setError(null);
    playSrc(a, urls[urlIdx.current]!, ++genRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNext, isStream]);

  return null;
}
