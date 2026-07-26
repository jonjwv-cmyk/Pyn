import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useMusicStore } from '@/lib/music-store';
import { usePetStore, pickLocalPhrase, type PhraseKind } from '@/lib/pet-store';
import { petScheduleAt, yekDayKey } from '@/lib/pet-schedule';
import {
  contextFactsForAi,
  getPetWorkContext,
  localPhraseFromContext,
  refreshPetWorkContext,
  weatherFxFromSnap,
  type PetWorkContext,
} from '@/lib/pet-context';

const PROACTIVE_MIN_MS = 10 * 60 * 1000;
const PROACTIVE_MAX_MS = 15 * 60 * 1000;
const TYPING_IDLE_MS = 1400;
const MOUSE_IDLE_MS = 2800;
const SLEEP_AFTER_MS = 8 * 60 * 1000;
/** В обед: после тишины — sleep, иначе eat. */
const LUNCH_SLEEP_AFTER_MS = 90_000;
/** Перекур: каждые 45 мин пока сессия/работа, кроме обеда. */
const SMOKE_BREAK_MS = 45 * 60 * 1000;

const METRIC_WINDOW_MS = 45_000;
const METRIC_TICK_MS = 8_000;
const PROD_COOLDOWN_MS = 3 * 60 * 1000;
const OVERTIME_COOLDOWN_MS = 25 * 60 * 1000;
const ACTIVE_RECENT_MS = 90_000;
const CTX_REFRESH_MS = 12 * 60 * 1000;
/** Напоминания по делу — не чаще. */
const FACT_COOLDOWN_MS = 18 * 60 * 1000;

const FAST_KEYS = 55;
const BUSY_MOUSE_PX = 12_000;
const BUSY_MOUSE_EVENTS = 80;

/** Ситуации, где DeepSeek уместен (комплименты / болтовня). Факты — локально. */
const AI_SITUATIONS = new Set<PhraseKind>([
  'idle',
  'music',
  'click',
  'fast_typing',
  'busy_mouse',
  'productivity',
  'weather',
]);

interface PetPhraseRes {
  ok?: boolean;
  phrase?: string;
  error?: string;
}

type ProactiveTopic =
  | 'compliment'
  | 'weather'
  | 'plan'
  | 'report'
  | 'transport_idle'
  | 'music';

/**
 * Мышь/клава → mood + контекстные реплики (погода/план/отчёт/простой) + комплименты.
 * Приоритет mood: think > lunch(eat|sleep) > dance > typing > working > sleep > idle.
 */
export function PetActivityBridge() {
  const setMood = usePetStore((s) => s.setMood);
  const setWeatherFx = usePetStore((s) => s.setWeatherFx);
  const say = usePetStore((s) => s.say);
  const aiThinking = usePetStore((s) => s.aiThinking);
  const isPlaying = useMusicStore((s) => s.isPlaying);

  const lastActivity = useRef(Date.now());
  const typingUntil = useRef(0);
  const workingUntil = useRef(0);
  const phraseBusy = useRef(false);
  const lastProdAt = useRef(0);
  const sessionStart = useRef(Date.now());
  const phaseAnnounced = useRef<string>('');
  const lastOvertimeAt = useRef(0);
  const topicIdx = useRef(0);
  const lastFactAt = useRef<Record<string, number>>({});

  const keyTs = useRef<number[]>([]);
  const mouseTs = useRef<number[]>([]);
  const mousePx = useRef(0);
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  const prune = (arr: number[], now: number) => {
    const cut = now - METRIC_WINDOW_MS;
    while (arr.length && arr[0]! < cut) arr.shift();
  };

  const noteKey = () => {
    const now = Date.now();
    lastActivity.current = now;
    typingUntil.current = now + TYPING_IDLE_MS;
    keyTs.current.push(now);
    prune(keyTs.current, now);
  };

  const noteMouse = (x: number, y: number) => {
    const now = Date.now();
    lastActivity.current = now;
    workingUntil.current = now + MOUSE_IDLE_MS;
    mouseTs.current.push(now);
    prune(mouseTs.current, now);
    const prev = lastMouse.current;
    if (prev) {
      mousePx.current += Math.hypot(x - prev.x, y - prev.y);
    }
    lastMouse.current = { x, y };
    if (mouseTs.current.length <= 1) mousePx.current *= 0.85;
  };

  // Контекст: погода / план / отчёт / простой (редко)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const ctx = await refreshPetWorkContext(true);
      if (cancelled) return;
      setWeatherFx(weatherFxFromSnap(ctx.weather));
    };
    void run();
    const id = window.setInterval(() => {
      void refreshPetWorkContext(false).then((ctx) => {
        if (!cancelled) setWeatherFx(weatherFxFromSnap(ctx.weather));
      });
    }, CTX_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [setWeatherFx]);

  // Mood + фазы дня
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const snap = petScheduleAt(now);
      const phase = snap.phase;

      if (phase === 'lunch_soon' || phase === 'lunch' || phase === 'shift_end_soon') {
        const key = `${yekDayKey(now)}:${phase}`;
        if (phaseAnnounced.current !== key && !phraseBusy.current) {
          phaseAnnounced.current = key;
          const kind: PhraseKind =
            phase === 'lunch_soon' ? 'lunch_soon' : phase === 'lunch' ? 'lunch' : 'shift_end_soon';
          void speakProactive(kind);
        }
      }

      const hasInput =
        keyTs.current.length > 0 ||
        mouseTs.current.length > 0 ||
        now < typingUntil.current ||
        now < workingUntil.current;
      const recentlyActive = hasInput && now - lastActivity.current < ACTIVE_RECENT_MS;
      if (
        recentlyActive &&
        !phraseBusy.current &&
        now - lastOvertimeAt.current >= OVERTIME_COOLDOWN_MS &&
        phase === 'none'
      ) {
        if (snap.isNonWorking) {
          lastOvertimeAt.current = now;
          void speakProactive('weekend_work');
        } else if (snap.isOffHours) {
          lastOvertimeAt.current = now;
          void speakProactive('off_hours');
        }
      }

      if (usePetStore.getState().aiThinking) {
        setMood('think');
        return;
      }
      // Перекур: пыхтит с сигаретой (поверх dance/typing)
      if (now < usePetStore.getState().smokeUntil) {
        setMood('smoke');
        return;
      }
      // Обед: кушает; если долго тихо — спит
      if (phase === 'lunch') {
        if (now - lastActivity.current > LUNCH_SLEEP_AFTER_MS) setMood('sleep');
        else setMood('eat');
        return;
      }
      if (isPlaying) {
        setMood('dance');
        return;
      }
      if (now < typingUntil.current) {
        setMood('typing');
        return;
      }
      if (now < workingUntil.current) {
        setMood('working');
        return;
      }
      if (now - lastActivity.current > SLEEP_AFTER_MS) {
        setMood('sleep');
        return;
      }
      setMood('idle');
    };
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [isPlaying, aiThinking, setMood]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift') return;
      }
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Tab') {
        noteKey();
      }
    };
    const onMove = (e: MouseEvent) => noteMouse(e.clientX, e.clientY);
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') noteMouse(e.clientX, e.clientY);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMove, { passive: true, capture: true });
    window.addEventListener('pointermove', onPointer, { passive: true, capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('pointermove', onPointer, true);
    };
  }, []);

  useEffect(() => {
    const unsub = window.pyn?.onUserActivity?.((ev) => {
      if (ev?.kind === 'key') noteKey();
      if (ev?.kind === 'mouse' && typeof ev.x === 'number' && typeof ev.y === 'number') {
        noteMouse(ev.x, ev.y);
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  // Продуктивность → DeepSeek-комплимент (без рода)
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      prune(keyTs.current, now);
      prune(mouseTs.current, now);
      mousePx.current *= 0.7;
      if (phraseBusy.current) return;
      if (now - lastProdAt.current < PROD_COOLDOWN_MS) return;
      const keys = keyTs.current.length;
      const moves = mouseTs.current.length;
      const px = mousePx.current;
      const sessionMin = (now - sessionStart.current) / 60_000;
      let kind: PhraseKind | null = null;
      if (keys >= FAST_KEYS) kind = 'fast_typing';
      else if (px >= BUSY_MOUSE_PX || moves >= BUSY_MOUSE_EVENTS) kind = 'busy_mouse';
      else if (sessionMin >= 25 && (keys >= 20 || moves >= 40)) kind = 'productivity';
      if (!kind) return;
      lastProdAt.current = now;
      void speakProactive(kind, {
        keys,
        moves,
        px: Math.round(px),
        sessionMin: Math.round(sessionMin),
      });
    }, METRIC_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Проактив: ротация тем 10–15 мин
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const wait = PROACTIVE_MIN_MS + Math.random() * (PROACTIVE_MAX_MS - PROACTIVE_MIN_MS);
      timer = window.setTimeout(() => {
        void (async () => {
          await refreshPetWorkContext(false);
          const ctx = getPetWorkContext();
          setWeatherFx(weatherFxFromSnap(ctx.weather));
          const topic = pickTopic(ctx, isPlaying);
          await speakTopic(topic, ctx);
          schedule();
        })();
      }, wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [isPlaying, setWeatherFx]);

  // Перекур каждые 45 мин: сессия жива, не обед (рабочий день / активная смена или overtime)
  useEffect(() => {
    const sessionStart = Date.now();
    let lastSmokeAt = sessionStart;
    const id = window.setInterval(() => {
      const now = Date.now();
      if (now - lastSmokeAt < SMOKE_BREAK_MS) return;
      const snap = petScheduleAt(now);
      // Кроме обеда
      if (snap.phase === 'lunch') return;
      // Не ночной idle: только пока «работа/сессия» — сменное окно, overtime с активностью, или выходной с активностью
      const recentlyActive = now - lastActivity.current < 20 * 60 * 1000;
      const inShift = !snap.isOffHours && !snap.isNonWorking;
      const workingSession =
        inShift ||
        (recentlyActive && (snap.isOffHours || snap.isNonWorking));
      if (!workingSession) return;
      if (phraseBusy.current) return;
      if (usePetStore.getState().aiThinking) return;

      lastSmokeAt = now;
      usePetStore.getState().startSmokeBreak();
    }, 30_000); // check every 30s; fire when 45m elapsed
    return () => window.clearInterval(id);
  }, []);

  function factReady(key: string): boolean {
    const now = Date.now();
    const last = lastFactAt.current[key] ?? 0;
    if (now - last < FACT_COOLDOWN_MS) return false;
    lastFactAt.current[key] = now;
    return true;
  }

  function pickTopic(ctx: PetWorkContext, music: boolean): ProactiveTopic {
    const order: ProactiveTopic[] = [
      'plan',
      'report',
      'transport_idle',
      'weather',
      'compliment',
      music ? 'music' : 'compliment',
    ];
    for (let i = 0; i < order.length; i++) {
      const t = order[(topicIdx.current + i) % order.length]!;
      if (t === 'plan' && ctx.plan && ctx.plan.state !== 'ready' && factReady('plan')) {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
      if (t === 'report' && ctx.report && ctx.report.missingStat > 0 && factReady('report')) {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
      if (t === 'transport_idle' && ctx.idle && ctx.idle.idleMin >= 15 && factReady('idle')) {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
      if (t === 'weather' && ctx.weather && factReady('weather')) {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
      if (t === 'music' && music) {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
      if (t === 'compliment') {
        topicIdx.current = (topicIdx.current + i + 1) % order.length;
        return t;
      }
    }
    return 'compliment';
  }

  async function speakTopic(topic: ProactiveTopic, ctx: PetWorkContext) {
    if (topic === 'plan') {
      const p = localPhraseFromContext('plan', ctx);
      if (p) {
        say(p, 6500);
        return;
      }
    }
    if (topic === 'report') {
      const p = localPhraseFromContext('report', ctx);
      if (p) {
        say(p, 6500);
        return;
      }
    }
    if (topic === 'transport_idle') {
      const p = localPhraseFromContext('transport_idle', ctx);
      if (p) {
        say(p, 6500);
        return;
      }
    }
    if (topic === 'weather') {
      // локально (0 ток) + редко AI-вариация
      const local = localPhraseFromContext('weather', ctx);
      if (local && Math.random() < 0.65) {
        say(local, 5500);
        return;
      }
      await speakProactive('weather');
      return;
    }
    if (topic === 'music') {
      await speakProactive('music');
      return;
    }
    await speakProactive('idle');
  }

  async function speakProactive(
    kind: PhraseKind,
    stats?: { keys?: number; moves?: number; px?: number; sessionMin?: number },
  ) {
    if (phraseBusy.current) return;
    phraseBusy.current = true;
    try {
      const ctx = getPetWorkContext();
      // Структурные kind — только локальные шаблоны (0 DeepSeek)
      if (kind === 'plan' || kind === 'report' || kind === 'transport_idle') {
        const fact = localPhraseFromContext(kind, ctx);
        say(fact || pickLocalPhrase(kind), 6000);
        return;
      }
      if (kind === 'weather') {
        const fact = localPhraseFromContext('weather', ctx);
        if (fact && !AI_SITUATIONS.has('weather')) {
          say(fact, 5500);
          return;
        }
      }

      const local = pickLocalPhrase(kind);
      if (!AI_SITUATIONS.has(kind)) {
        say(local, 5000);
        return;
      }

      try {
        const res = await api.call<PetPhraseRes>(
          'ai_pet_phrase',
          {
            situation: kind,
            pet_name: usePetStore.getState().name,
            track: useMusicStore.getState().trackTitle || undefined,
            music: useMusicStore.getState().isPlaying,
            stats,
            // компактные факты — меньше токенов, чем простыня
            facts: contextFactsForAi(ctx) || undefined,
            weather: ctx.weather
              ? {
                  label: ctx.weather.label,
                  tempC: ctx.weather.tempC,
                  fx: ctx.weather.fx,
                }
              : undefined,
          },
          { timeoutMs: 12_000 },
        );
        if (res.ok && res.phrase) {
          say(res.phrase, 5500);
          return;
        }
      } catch {
        /* offline / limit → local */
      }
      if (kind === 'weather') {
        const fact = localPhraseFromContext('weather', ctx);
        if (fact) {
          say(fact, 5500);
          return;
        }
      }
      say(local, 5000);
    } finally {
      phraseBusy.current = false;
    }
  }

  useEffect(() => {
    const handler = () => {
      void speakProactive('click');
    };
    window.addEventListener('pyn-pet-click', handler);
    return () => window.removeEventListener('pyn-pet-click', handler);
  }, []);

  return null;
}

export function emitPetClick() {
  window.dispatchEvent(new Event('pyn-pet-click'));
}
