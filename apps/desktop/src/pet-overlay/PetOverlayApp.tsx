/**
 * Always-on-top pet shell (hash #pet).
 * - 1 клик → полоска ввода + mini-плеер слева
 * - 2 клик → полный чат (магнитится слева) + плеер слева от чата
 * - idle (чат скрыт) → без кнопок плеера
 * - drag питомца → moveBy окна
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Pause, Play, SkipForward, Minus, Headphones, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAiStore, type AiChatMessage, type AiServerMessage } from '@/lib/ai-store';
import { useMusicStore } from '@/lib/music-store';
import { usePetStore } from '@/lib/pet-store';
import { PetSprite } from '@/components/ai/PetSprite';
import { YoutubeLofiPlayer } from '@/components/ai/YoutubeLofiPlayer';
import { StreamRadioPlayer } from '@/components/ai/StreamRadioPlayer';
import { PetActivityBridge } from '@/components/ai/PetActivityBridge';
import { waveAt } from '@/lib/music-waves';
import { wireMusicEngineBridge } from '@/lib/music-bridge';
import { DateDivider } from '@/components/ui/DateDivider';
import { formatDayDividerLabel, yekDayKeyFor } from '@/lib/format-time';
import { useWsEvent } from '@/lib/ws';
import { petScheduleAt, type SchedulePhase } from '@/lib/pet-schedule';
import {
  completeWeekdayConfirm,
  formatWhenLabel,
  looksLikeReminder,
  parseReminderText,
  parseWeekdayConfirm,
} from '@/lib/pet-reminders-parse';
import {
  ackPetReminder,
  addPetReminder,
  dueReminders,
  parseReminderViaAi,
  pullPetReminders,
  usePetRemindersStore,
  type PetReminder,
} from '@/lib/pet-reminders-api';

interface AiQueryResponse {
  ok: boolean;
  answer?: string;
  message?: { id?: number; created_at?: string };
  model_label?: string;
  remaining_pct?: number;
  error?: string;
}

const PET_COL_W = 200;
const PLACEHOLDER = 'Напиши мне…';
const REMIND_POLL_MS = 25_000;

/**
 * SF 2027 / Linear: плотные solid surfaces.
 * Окно Electron transparent — любой alpha (/xx, rgba) «просвечивает» рабочий стол.
 * Только hex без прозрачности.
 */
const SURFACE = '#1F1E1B'; // bg-surface
const DEEP = '#161611'; // bg-deep
const ELEVATED = '#302F2D'; // bg-elevated
const PANEL_SOLID =
  'border border-border-default shadow-[0_18px_48px_rgba(0,0,0,0.55)]';

export function PetOverlayApp() {
  const species = usePetStore((s) => s.species);
  const mood = usePetStore((s) => s.mood);
  const weatherFx = usePetStore((s) => s.weatherFx);
  const bubble = usePetStore((s) => s.bubble);
  const say = usePetStore((s) => s.say);
  const setAiThinking = usePetStore((s) => s.setAiThinking);

  const messages = useAiStore((s) => s.messages);
  const modelLabel = useAiStore((s) => s.modelLabel);
  const reminderItems = usePetRemindersStore((s) => s.items);
  const clarify = usePetRemindersStore((s) => s.clarify);
  const setClarify = usePetRemindersStore((s) => s.setClarify);
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  /** system-wide input (Accessibility + uiohook). null = ещё не знаем. */
  const [globalInputOk, setGlobalInputOk] = useState<boolean | null>(null);
  const dueList = useMemo(() => dueReminders(reminderItems), [reminderItems, tick]);
  const remainingPct = useAiStore((s) => s.remainingPct);
  const setMessages = useAiStore((s) => s.setMessages);
  const setStatus = useAiStore((s) => s.setStatus);
  const upsertServer = useAiStore((s) => s.upsertServer);
  const applyHistory = useAiStore((s) => s.applyHistory);

  const isPlaying = useMusicStore((s) => s.isPlaying);
  const musicError = useMusicStore((s) => s.error);
  const musicReady = useMusicStore((s) => s.ready);
  const waveIndex = useMusicStore((s) => s.waveIndex);
  const toggleMusic = useMusicStore((s) => s.toggle);
  const nextTrack = useMusicStore((s) => s.next);
  const cycleWave = useMusicStore((s) => s.cycleWave);

  const [session, setSession] = useState<{ login: string; name: string } | null>(null);
  const [mode, setMode] = useState<'idle' | 'strip' | 'full'>('idle');
  const [input, setInput] = useState('');
  const [schedPhase, setSchedPhase] = useState<SchedulePhase>(() => petScheduleAt().phase);
  const [schedBadge, setSchedBadge] = useState<string | null>(() => petScheduleAt().badge);
  const clickTimer = useRef(0);
  const lastClickAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    active: boolean;
    moved: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, moved: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    void (async () => {
      try {
        // Pet overlay = отдельный BrowserWindow: свой ApiClient без token → auth_required.
        // Сначала token из session.bin, потом prefs/reminders.
        const s = await window.pyn?.tokenStore?.load?.();
        if (s?.token) {
          api.setToken(s.token);
        }
        if (s?.user?.login) {
          setSession({
            login: s.user.login,
            name: s.user.fullName || s.user.login,
          });
          const { initDesktopPrefs } = await import('@/lib/desktop-prefs');
          await initDesktopPrefs();
          await pullPetReminders();
        }
      } catch {
        /* */
      }
    })();
  }, []);

  // Poll due reminders (per-user on server)
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => {
      void pullPetReminders().then(() => setTick((n) => n + 1));
    }, REMIND_POLL_MS);
    const tickId = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tickId);
    };
  }, [session]);

  // System-wide keyboard/mouse (за пределами Pyn) — статус Accessibility
  const globalInputOkRef = useRef(globalInputOk);
  globalInputOkRef.current = globalInputOk;
  const accessTipShown = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const st = await window.pyn?.pet?.globalInputStatus?.();
        if (cancelled || !st) return;
        setGlobalInputOk(!!(st.ok || st.running));
      } catch {
        /* */
      }
    };
    void refresh();
    const unsub = window.pyn?.pet?.onGlobalInput?.((ev) => {
      setGlobalInputOk(!!ev.ok);
      if (!ev.ok && ev.reason === 'accessibility' && !accessTipShown.current) {
        accessTipShown.current = true;
        say('Чтобы видеть набор вне Pyn — включи Универсальный доступ ⚙️', 7000);
      }
    });
    const id = window.setInterval(() => {
      void refresh();
      if (globalInputOkRef.current === false) {
        void window.pyn?.pet?.retryGlobalInput?.().then((r) => {
          if (r?.running || r?.ok) setGlobalInputOk(true);
        });
      }
    }, 15_000);
    return () => {
      cancelled = true;
      unsub?.();
      window.clearInterval(id);
    };
  }, [say]);

  // When due — bubble once per reminder id
  const announcedDue = useRef<Set<number>>(new Set());
  useEffect(() => {
    void tick;
    const due = dueReminders(usePetRemindersStore.getState().items);
    for (const r of due) {
      if (announcedDue.current.has(r.id)) continue;
      announcedDue.current.add(r.id);
      say(`Напоминаю! ${r.body}`, 12_000);
      break; // one bubble at a time
    }
  }, [reminderItems, tick, say]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const since = useAiStore.getState().lastId;
        const r = await api.call<{
          messages?: AiServerMessage[];
          model_label?: string;
          remaining_pct?: number;
        }>('ai_history', { since_id: since });
        if (!cancelled) {
          applyHistory(r.messages ?? [], {
            model_label: r.model_label,
            remaining_pct: r.remaining_pct,
          });
        }
      } catch {
        /* */
      }
      try {
        const st = await api.call<{ model_label?: string; remaining_pct?: number }>('ai_status', {});
        if (!cancelled) setStatus({ model_label: st.model_label, remaining_pct: st.remaining_pct });
      } catch {
        /* */
      }
    };
    void pull();
    return () => {
      cancelled = true;
    };
  }, [session, applyHistory, setStatus]);

  useWsEvent('ai_message', (e) => {
    const ev = e as unknown as {
      message?: AiServerMessage;
      model_label?: string;
      remaining_pct?: number;
    };
    if (ev.message?.id != null) {
      upsertServer(ev.message, {
        model_label: ev.model_label,
        remaining_pct: ev.remaining_pct,
      });
    }
  });

  useEffect(() => {
    if (mode === 'full' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, mode]);

  // Обед / конец дневной смены — badge сверху, раз в 30с
  useEffect(() => {
    const refresh = () => {
      const snap = petScheduleAt();
      setSchedPhase(snap.phase);
      setSchedBadge(snap.badge);
    };
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Размер окна под layout (idle маленький → нет «призрака» 560×680)
  useEffect(() => {
    void window.pyn?.pet?.setLayout?.(mode);
  }, [mode]);

  /**
   * Click-through: прозрачные зоны не ловят скролл/клики чужих окон.
   * Только [data-pet-hit] принимает мышь (пет, bubble, чат, strip).
   */
  useEffect(() => {
    let ignoring = true;
    const setIgnore = (ignore: boolean) => {
      if (ignore === ignoring) return;
      ignoring = ignore;
      void window.pyn?.pet?.setIgnoreMouse?.(ignore);
    };
    void window.pyn?.pet?.setIgnoreMouse?.(true);

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const hit = !!(el as Element | null)?.closest?.('[data-pet-hit]');
      setIgnore(!hit);
    };
    const onLeave = () => setIgnore(true);

    window.addEventListener('mousemove', onMove, true);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      void window.pyn?.pet?.setIgnoreMouse?.(true);
    };
  }, []);

  const pushLocalChat = useCallback(
    (question: string, answer: string) => {
      if (!session) return;
      const key = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setMessages((prev) => [
        ...prev,
        {
          key,
          login: session.login,
          name: session.name,
          question,
          answer,
          pending: false,
        },
      ]);
    },
    [session, setMessages],
  );

  const saveReminderOk = useCallback(
    async (body: string, fireAt: Date, whenLabel: string, question: string) => {
      const saved = await addPetReminder(body, fireAt);
      if (!saved) {
        pushLocalChat(question, 'Не удалось сохранить напоминание. Попробуй ещё раз.');
        say('Не сохранилось 😕', 4000);
        return;
      }
      const answer = `Запомнил! Напомню ${whenLabel}: «${body}».`;
      pushLocalChat(question, answer);
      say(answer, 7000);
      setClarify(null);
    },
    [pushLocalChat, say, setClarify],
  );

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || !session) return;
    setInput('');

    // ── 1) Ответ на «сегодня / следующую неделю?»
    const pendingClarify = usePetRemindersStore.getState().clarify;
    if (pendingClarify) {
      const prefer = parseWeekdayConfirm(q);
      if (prefer) {
        const ok = completeWeekdayConfirm(
          {
            kind: 'need_weekday_confirm',
            body: pendingClarify.body,
            weekday: pendingClarify.weekday,
            weekdayRu: pendingClarify.weekdayRu,
            hour: pendingClarify.hour,
            minute: pendingClarify.minute,
          },
          prefer,
        );
        await saveReminderOk(ok.body, ok.fireAt, ok.whenLabel, q);
        return;
      }
      // повторный полный «напомни…» — сброс clarify
      if (!looksLikeReminder(q) && !parseWeekdayConfirm(q)) {
        pushLocalChat(
          q,
          `Нужно: «сегодня» или «на следующую неделю» (про ${pendingClarify.weekdayRu}).`,
        );
        say('Сегодня или на следующую неделю?', 6000);
        return;
      }
      setClarify(null);
    }

    // ── 2) Напоминания: локальный парсер (0 tok) → DeepSeek Flash только если нужно
    if (looksLikeReminder(q)) {
      const parsed = parseReminderText(q);

      // Локально однозначно — не тратим токены
      if (parsed.kind === 'ok') {
        await saveReminderOk(parsed.body, parsed.fireAt, parsed.whenLabel, q);
        return;
      }
      if (parsed.kind === 'need_weekday_confirm') {
        setClarify({
          body: parsed.body,
          weekday: parsed.weekday,
          weekdayRu: parsed.weekdayRu,
          hour: parsed.hour,
          minute: parsed.minute,
        });
        const ask = `Сегодня ${parsed.weekdayRu} — напомнить сегодня или на следующую неделю?`;
        pushLocalChat(q, ask);
        say(ask, 8000);
        return;
      }

      // error / need_time / not_reminder edge → AI fallback (минимум токенов)
      say('Секунду, разбираю время…', 4000);
      const ai = await parseReminderViaAi(q);
      if (ai.ok) {
        await saveReminderOk(ai.body, ai.fireAt, formatWhenLabel(ai.fireAt), q);
        return;
      }
      if (ai.need === 'weekday' && ai.body) {
        const wd = typeof ai.weekday === 'number' ? ai.weekday : 3;
        const ru = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'][wd] ?? 'этот день';
        setClarify({
          body: ai.body,
          weekday: wd,
          weekdayRu: ru,
          hour: 9,
          minute: 0,
        });
        const ask =
          ai.ask ||
          `Сегодня ${ru} — напомнить сегодня или на следующую неделю?`;
        pushLocalChat(q, ask);
        say(ask, 8000);
        return;
      }
      if (ai.need === 'time' || parsed.kind === 'need_time') {
        const body = ai.body || (parsed.kind === 'need_time' ? parsed.body : '');
        const msg =
          ai.ask ||
          (body
            ? `Ок, «${body}». Во сколько? Например: «напомни ${body} в 14:00».`
            : 'Во сколько напомнить? Например: «напомни … в 14:00».');
        pushLocalChat(q, msg);
        say('Во сколько напомнить?', 5000);
        return;
      }
      if (parsed.kind === 'error') {
        pushLocalChat(q, parsed.message);
        say(parsed.message, 5000);
        return;
      }
      pushLocalChat(
        q,
        ai.ask ||
          'Не разобрал время. Напиши так: «напомни … в 14:00» или «завтра к часу».',
      );
      say('Не разобрал время 😕', 5000);
      return;
    }

    // ── 3) Обычный AI-чат
    const key = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [
      ...prev,
      {
        key,
        login: session.login,
        name: session.name,
        question: q,
        answer: '',
        pending: true,
      },
    ]);
    setAiThinking(true);
    say('Думаю…', 8000);
    try {
      const res = await api.call<AiQueryResponse>(
        'ai_query',
        { question: q },
        { timeoutMs: 90_000 },
      );
      const st = { model_label: res.model_label, remaining_pct: res.remaining_pct };
      const answer = res.answer || '—';
      if (res.message?.id != null) {
        setMessages((prev) => prev.filter((m) => m.key !== key));
        upsertServer(
          {
            id: res.message.id,
            login: session.login,
            name: session.name,
            question: q,
            answer,
            created_at: res.message.created_at,
          },
          st,
        );
      } else {
        setStatus(st);
        setMessages((prev) =>
          prev.map((m) =>
            m.key === key ? { ...m, pending: false, answer, error: !res.ok } : m,
          ),
        );
      }
      const short = answer.replace(/\s+/g, ' ').trim().slice(0, 120);
      say(short + (answer.length > 120 ? '…' : ''), 8000);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.key === key
            ? { ...m, pending: false, error: true, answer: 'Ошибка запроса.' }
            : m,
        ),
      );
      say('Ошибка запроса 😕', 4000);
    } finally {
      const still = useAiStore.getState().messages.some((m) => m.pending);
      setAiThinking(still);
    }
  }, [
    input,
    session,
    setMessages,
    setStatus,
    upsertServer,
    setAiThinking,
    say,
    saveReminderOk,
    pushLocalChat,
    setClarify,
  ]);

  const onAckReminder = useCallback(async (r: PetReminder) => {
    setAckingId(r.id);
    try {
      const ok = await ackPetReminder(r.id);
      if (ok) say('Ок, отмечено ✓', 3000);
      else say('Не удалось отметить', 3000);
    } finally {
      setAckingId(null);
    }
  }, [say]);

  /** 1 клик → strip; 2 клик → full-чат рядом. */
  const fireClick = useCallback(() => {
    const now = Date.now();
    const gap = now - lastClickAt.current;
    lastClickAt.current = now;
    if (gap > 0 && gap < 320) {
      window.clearTimeout(clickTimer.current);
      lastClickAt.current = 0;
      setMode((m) => (m === 'full' ? 'idle' : 'full'));
      return;
    }
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      setMode((m) => (m === 'strip' ? 'idle' : m === 'full' ? 'full' : 'strip'));
    }, 300);
  }, []);

  const onPetPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      moved: false,
      lastX: e.screenX,
      lastY: e.screenY,
    };
  };

  const onPetPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.screenX - d.lastX;
    const dy = e.screenY - d.lastY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.lastX = e.screenX;
    d.lastY = e.screenY;
    void window.pyn?.pet?.moveBy?.(dx, dy);
  };

  const onPetPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    d.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
    if (!d.moved) {
      fireClick();
    }
  };

  const groups = (() => {
    const out: { dayKey: number; label: string; items: AiChatMessage[] }[] = [];
    for (const m of messages) {
      const dayKey = yekDayKeyFor(m.created_at) ?? 0;
      const last = out[out.length - 1];
      if (last && last.dayKey === dayKey) last.items.push(m);
      else
        out.push({
          dayKey,
          label: dayKey === 0 ? '' : formatDayDividerLabel(m.created_at),
          items: [m],
        });
    }
    return out;
  })();

  const musicProps = {
    isPlaying,
    musicError,
    musicReady,
    waveN: waveAt(waveIndex).n,
    waveLabel: waveAt(waveIndex).shortLabel,
    onToggle: () => {
      // один путь: requestToggle; wantPlaying выставит плеер
      toggleMusic();
    },
    onNext: () => nextTrack(),
    onWave: () => cycleWave(),
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent select-none">
      <YoutubeLofiPlayer />
      <StreamRadioPlayer />
      <PetActivityBridge />
      <MusicEngineBridge />

      {/* pointer-events-none на оболочке: hit только у data-pet-hit */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-end gap-1.5 p-2">
        {/* Full-чат: solid SF panel, плеер внутри ввода */}
        {mode === 'full' && (
          <div
            data-pet-hit
            className={cn(
              'pointer-events-auto flex h-[min(460px,calc(100vh-1rem))] w-[min(320px,calc(100vw-240px))] flex-col overflow-hidden rounded-2xl',
              PANEL_SOLID,
            )}
            style={{ backgroundColor: SURFACE }}
          >
            <div
              className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-3"
              style={{ backgroundColor: ELEVATED }}
            >
              <span className="text-[12px] font-semibold tracking-tight text-text-strong">
                Чат
              </span>
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-text-muted">
                {modelLabel && (
                  <span className="max-w-[100px] truncate text-text-secondary">{modelLabel}</span>
                )}
                <span className="tabular-nums text-text-secondary">{remainingPct}%</span>
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
                  onClick={() => setMode('idle')}
                  aria-label="Свернуть"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div
              ref={listRef}
              className="flex-1 overflow-y-auto px-3 py-2.5"
              style={{ backgroundColor: DEEP }}
            >
              {messages.length === 0 ? (
                <div className="px-0.5 pt-3 text-left text-[12px] text-text-muted">
                  Жду сообщения…
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.dayKey}>
                    {g.label && <DateDivider label={g.label} />}
                    <div className="space-y-2 pb-2">
                      {g.items.map((m) => (
                        <div key={m.key} className="space-y-1 text-[12px] leading-snug">
                          <div
                            className="ml-auto max-w-[90%] rounded-2xl rounded-tr-md px-2.5 py-1.5 text-text-strong"
                            style={{ backgroundColor: 'rgba(217,119,87,0.22)' }}
                          >
                            {m.question}
                          </div>
                          <div
                            className={cn(
                              'max-w-[90%] rounded-2xl rounded-tl-md px-2.5 py-1.5',
                              m.error ? 'text-danger' : 'text-text-primary',
                            )}
                            style={
                              m.error
                                ? undefined
                                : { backgroundColor: ELEVATED }
                            }
                          >
                            {m.pending ? '…' : m.answer}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div
              className="shrink-0 border-t border-border-subtle p-2.5"
              style={{ backgroundColor: SURFACE }}
            >
              <Composer
                value={input}
                onChange={setInput}
                onSend={() => void send()}
                placeholder={PLACEHOLDER}
                music={musicProps}
              />
            </div>
          </div>
        )}

        {/* Колонка пета — только интерактивные куски ловят мышь */}
        <div className="flex flex-col items-center" style={{ width: PET_COL_W }}>
          {schedBadge && (
            <div
              data-pet-hit
              className={cn(
                'pointer-events-auto mb-1.5 w-full rounded-full border px-2.5 py-1 text-center text-[10px] font-medium leading-snug',
                schedPhase === 'lunch'
                  ? 'border-border-default text-brand-manilla'
                  : 'border-border-default text-text-secondary',
              )}
              style={{ backgroundColor: ELEVATED }}
            >
              {schedBadge}
            </div>
          )}

          {/* Нет Accessibility → питомец не видит клаву/мышь вне Pyn */}
          {globalInputOk === false && (
            <button
              type="button"
              data-pet-hit
              className={cn(
                'pointer-events-auto mb-1.5 w-full rounded-xl border border-amber-500/40 px-2 py-1.5',
                'text-center text-[10px] font-medium leading-snug text-amber-200/95',
                PANEL_SOLID,
              )}
              style={{ backgroundColor: ELEVATED }}
              onClick={() => {
                void window.pyn?.pet?.openAccessibility?.();
                window.setTimeout(() => {
                  void window.pyn?.pet?.retryGlobalInput?.().then((r) => {
                    if (r?.running || r?.ok) {
                      setGlobalInputOk(true);
                      say('Теперь вижу набор везде! 👀', 4000);
                    } else {
                      say('Включи Electron/Pyn в Универсальном доступе, потом кликни снова', 6000);
                    }
                  });
                }, 800);
              }}
            >
              Вне Pyn не вижу клаву/мышь.
              <br />
              Нажми: Универсальный доступ
            </button>
          )}

          {/* Due reminders — full card + ack; текст можно выделять и копировать (⌘C / ПКМ) */}
          {dueList.length > 0 && (
            <div className="pointer-events-auto mb-2 flex w-full flex-col gap-1.5" data-pet-hit>
              {dueList.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'w-full rounded-2xl border border-accent-clay/45 px-2.5 py-2',
                    'shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
                    PANEL_SOLID,
                  )}
                  style={{ backgroundColor: SURFACE }}
                >
                  <p className="select-text-msg text-center text-[10px] font-semibold uppercase tracking-wide text-accent-clay">
                    Напоминаю!
                  </p>
                  <p
                    className="select-text-msg mt-1 text-center text-[12px] font-medium leading-snug text-text-strong"
                    // не даём drag-питомца перехватить выделение
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {r.body}
                  </p>
                  <button
                    type="button"
                    data-pet-hit
                    disabled={ackingId === r.id}
                    onClick={() => void onAckReminder(r)}
                    className={cn(
                      'mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-border-default py-1.5',
                      'text-[11px] font-medium text-text-strong transition-colors',
                      'hover:bg-bg-hover disabled:opacity-50',
                      'select-none',
                    )}
                    style={{ backgroundColor: ELEVATED }}
                    aria-label="Прочитано"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.5} />
                    Прочитано
                  </button>
                </div>
              ))}
            </div>
          )}

          {clarify && dueList.length === 0 && (
            <div
              data-pet-hit
              className={cn(
                'pointer-events-auto mb-2 w-full rounded-2xl border border-border-default px-2.5 py-1.5',
                'text-center text-[10px] leading-snug text-text-secondary',
                PANEL_SOLID,
              )}
              style={{ backgroundColor: ELEVATED }}
            >
              Жду: сегодня или след. неделя ({clarify.weekdayRu})
            </div>
          )}

          {bubble && (
            <div
              data-pet-hit
              className={cn(
                'pointer-events-auto relative mb-2 w-full rounded-2xl border border-border-default px-2.5 py-1.5',
                'text-center text-[11px] leading-snug text-text-strong',
                PANEL_SOLID,
              )}
              style={{ backgroundColor: SURFACE }}
            >
              {isPlaying && (
                <span
                  className="absolute -left-1 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-clay text-white"
                  title="Музыка"
                  aria-hidden
                >
                  <Headphones className="h-3 w-3" strokeWidth={2.25} />
                </span>
              )}
              {bubble}
            </div>
          )}

          <div className="relative">
            {isPlaying && <MusicSteamNotes />}
            <button
              type="button"
              data-pet-hit
              onPointerDown={onPetPointerDown}
              onPointerMove={onPetPointerMove}
              onPointerUp={onPetPointerUp}
              onPointerCancel={onPetPointerUp}
              className="pointer-events-auto relative cursor-grab touch-none bg-transparent p-0.5 active:cursor-grabbing"
              aria-label="Питомец"
            >
              <PetSprite
                species={species}
                mood={mood}
                weatherFx={weatherFx}
                scale={0.52}
              />
              {isPlaying && !bubble && (
                <span
                  className="pointer-events-none absolute -right-0.5 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-clay text-white"
                  title="Музыка"
                  aria-hidden
                >
                  <Headphones className="h-3 w-3" strokeWidth={2.25} />
                </span>
              )}
              {mood === 'eat' && (
                <span
                  className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[13px]"
                  aria-hidden
                >
                  🥢
                </span>
              )}
              {mood === 'sleep' && (
                <span
                  className="pointer-events-none absolute -top-1 right-0 text-[11px] text-text-muted"
                  aria-hidden
                >
                  zzz
                </span>
              )}
            </button>
          </div>

          {mode === 'strip' && (
            <div data-pet-hit className="pointer-events-auto mt-2 w-full">
              <Composer
                value={input}
                onChange={setInput}
                onSend={() => void send()}
                placeholder={PLACEHOLDER}
                compact
                music={musicProps}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wire IPC: main Hi-Fi → this engine. */
function MusicEngineBridge() {
  useEffect(() => {
    wireMusicEngineBridge();
  }, []);
  return null;
}

/** Плавающие нотки «как пар» над питомцем. */
function MusicSteamNotes() {
  return (
    <div className="pyn-music-steam pointer-events-none absolute inset-x-0 -top-3 h-10 overflow-visible" aria-hidden>
      <span className="pyn-music-note pyn-music-note--a">♪</span>
      <span className="pyn-music-note pyn-music-note--b">♫</span>
      <span className="pyn-music-note pyn-music-note--c">♪</span>
    </div>
  );
}

interface MusicProps {
  isPlaying: boolean;
  musicError: string | null;
  musicReady: boolean;
  waveN: number;
  waveLabel: string;
  onToggle: () => void;
  onNext: () => void;
  onWave: () => void;
}

function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  compact,
  music,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  compact?: boolean;
  /** Плеер слева внутри того же блока ввода. */
  music?: MusicProps;
}) {
  const fieldClass = cn(
    'pyn-pet-composer-field min-w-0 flex-1 bg-transparent text-left text-text-primary',
    'placeholder:text-left placeholder:text-text-muted focus:outline-none',
    compact ? 'h-6 text-[12px] leading-6' : 'min-h-[26px] max-h-24 resize-none text-[13px] leading-snug',
  );
  const fieldStyle: CSSProperties = {
    textAlign: 'left',
    direction: 'ltr',
  };

  return (
    <div
      className={cn(
        'pyn-pet-composer flex w-full items-center gap-1 rounded-xl border border-border-default',
        'focus-within:border-accent-clay/50',
        compact ? 'px-1.5 py-1' : 'items-end px-2 py-1.5',
      )}
      style={{ backgroundColor: DEEP }}
    >
      {music && (
        <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-lg',
              'bg-accent-clay text-white transition-colors',
              'hover:bg-accent-clay-dim active:scale-95',
              music.musicError && 'opacity-50',
            )}
            onClick={music.onToggle}
            aria-label={music.isPlaying ? 'Pause' : 'Play'}
            disabled={!!music.musicError && !music.musicReady}
          >
            {music.isPlaying ? (
              <Pause className="h-3 w-3" strokeWidth={2.5} />
            ) : (
              <Play className="h-3 w-3 translate-x-px" strokeWidth={2.5} />
            )}
          </button>
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-lg',
              'text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-strong active:scale-95',
            )}
            onClick={music.onNext}
            aria-label="Next"
            title="Next"
          >
            <SkipForward className="h-3 w-3" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className={cn(
              'flex h-6 max-w-[5.5rem] items-center justify-center rounded-lg px-1.5',
              'text-[10px] font-semibold text-text-secondary',
              'transition-colors hover:bg-bg-hover hover:text-text-strong active:scale-95',
            )}
            onClick={music.onWave}
            aria-label={`Волна ${music.waveN}`}
            title={`${music.waveLabel} · следующая волна`}
          >
            Волна {music.waveN}
          </button>
          <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border-default" aria-hidden />
        </div>
      )}

      {compact ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className={fieldClass}
          style={fieldStyle}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className={fieldClass}
          style={fieldStyle}
        />
      )}
      {value.trim() && (
        <button
          type="button"
          onClick={onSend}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-clay text-white"
          aria-label="Отправить"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
