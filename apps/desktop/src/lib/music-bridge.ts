/**
 * Синхронизация music-store между main window и pet overlay.
 * Engine (YT + streams) монтируется только в pet overlay.
 */
import { useMusicStore } from './music-store';
import { clampWaveIndex } from './music-waves';

let engineWired = false;
let uiWired = false;

/** Pet overlay: принимать cmd из main + слать state. */
export function wireMusicEngineBridge(): void {
  if (engineWired) return;
  engineWired = true;

  try {
    window.pyn?.music?.onCmd?.((cmd) => {
      const s = useMusicStore.getState();
      if (cmd === 'toggle') s.toggle();
      else if (cmd === 'next') s.next();
      else if (cmd === 'cycleWave') s.cycleWave();
    });
  } catch {
    /* */
  }

  let last = '';
  const push = () => {
    const s = useMusicStore.getState();
    const payload = {
      wantPlaying: s.wantPlaying,
      isPlaying: s.isPlaying,
      trackTitle: s.trackTitle,
      waveIndex: s.waveIndex,
      error: s.error,
      ready: s.ready,
    };
    const key = JSON.stringify(payload);
    if (key === last) return;
    last = key;
    void window.pyn?.music?.broadcastState?.(payload);
  };
  useMusicStore.subscribe(push);
  push();
}

/** Main window: Hi-Fi UI — принимать state, слать cmd. */
export function wireMusicUiBridge(): void {
  if (uiWired) return;
  uiWired = true;

  try {
    window.pyn?.music?.onState?.((st) => {
      useMusicStore.setState({
        wantPlaying: !!st.wantPlaying,
        isPlaying: !!st.isPlaying,
        trackTitle: String(st.trackTitle || ''),
        waveIndex: clampWaveIndex(st.waveIndex ?? 0),
        error: st.error ?? null,
        ready: !!st.ready,
      });
    });
  } catch {
    /* */
  }
}

export function musicCmd(cmd: 'toggle' | 'next' | 'cycleWave'): void {
  // Engine только в pet: шлём cmd, UI main обновится через onState.
  // Если pet window нет — локальный fallback (без звука, но UI жив).
  void (async () => {
    try {
      const ok = await window.pyn?.music?.cmd?.(cmd);
      if (ok) return;
    } catch {
      /* */
    }
    const s = useMusicStore.getState();
    if (cmd === 'toggle') s.toggle();
    else if (cmd === 'next') s.next();
    else if (cmd === 'cycleWave') s.cycleWave();
  })();
}
