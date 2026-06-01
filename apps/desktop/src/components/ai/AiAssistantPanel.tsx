import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUp, Check, Copy, HelpCircle, Minus, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/lib/ws';
import { DateDivider } from '@/components/ui/DateDivider';
import { formatDayDividerLabel, formatTimeYek, yekDayKeyFor } from '@/lib/format-time';
import { useAiStore, type AiChatMessage, type AiServerMessage } from '@/lib/ai-store';

interface AiQueryResponse {
  ok: boolean;
  answer?: string;
  message?: { id?: number; created_at?: string };
  model_label?: string;
  remaining_pct?: number;
  error?: string;
}

interface AiAssistantPanelProps {
  myLogin: string;
  myName: string;
}

/**
 * ИИ-помощник — общий чат в правом нижнем углу (как чат с оператором).
 * Снизу ввод, сверху лента «кто спросил → вопрос → ответ». Сворачивается в
 * пилюлю, закрывается крестиком. В шапке — остаток общего лимита.
 *
 * MVP: отправка `ai_query` + показ ответа + счётчик. История/realtime/кэш —
 * следующим слоем (ai_history + событие ai_message + persist).
 */
export function AiAssistantPanel({ myLogin, myName }: AiAssistantPanelProps) {
  const { t } = useTranslation();
  const open = useAiStore((s) => s.open);
  const minimized = useAiStore((s) => s.minimized);
  const messages = useAiStore((s) => s.messages);
  const modelLabel = useAiStore((s) => s.modelLabel);
  const remainingPct = useAiStore((s) => s.remainingPct);
  const setOpen = useAiStore((s) => s.setOpen);
  const toggleMinimized = useAiStore((s) => s.toggleMinimized);
  const setMessages = useAiStore((s) => s.setMessages);
  const setStatus = useAiStore((s) => s.setStatus);
  const upsertServer = useAiStore((s) => s.upsertServer);
  const applyHistory = useAiStore((s) => s.applyHistory);
  const geom = useAiStore((s) => s.geom);
  const setPillPos = useAiStore((s) => s.setPillPos);
  const setPanelSize = useAiStore((s) => s.setPanelSize);

  const pillDrag = usePillDrag(geom.pill, setPillPos, toggleMinimized);
  const panelResize = usePanelResize(geom.size, setPanelSize);

  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Общий чат: после гидрации кэша подтягиваем только НОВОЕ (since lastId),
  // дальше живые сообщения прилетают по ws-событию ai_message.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const since = useAiStore.getState().lastId;
        const r = await api.call<{
          messages?: AiServerMessage[];
          model_label?: string; remaining_pct?: number;
        }>('ai_history', { since_id: since });
        if (!cancelled) {
          applyHistory(r.messages ?? [], { model_label: r.model_label, remaining_pct: r.remaining_pct });
        }
      } catch {
        /* оффлайн/ошибка — покажем кэш, повторим при следующем открытии */
      }
    };
    if (useAiStore.persist.hasHydrated()) {
      void pull();
      return () => { cancelled = true; };
    }
    const unsub = useAiStore.persist.onFinishHydration(() => void pull());
    return () => { cancelled = true; unsub(); };
  }, [applyHistory]);

  // Живые сообщения общего ИИ-чата (все admin/dev видят одну ленту).
  useWsEvent('ai_message', (e) => {
    const ev = e as unknown as {
      message?: AiServerMessage; model_label?: string; remaining_pct?: number;
    };
    if (ev.message?.id != null) {
      upsertServer(ev.message, { model_label: ev.model_label, remaining_pct: ev.remaining_pct });
    }
  });

  useEffect(() => {
    if (open && !minimized) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, open, minimized]);

  // При открытии подтягиваем индикатор «модель + остаток %» в шапку.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const s = await api.call<{ model_label?: string; remaining_pct?: number }>('ai_status', {});
        setStatus({ model_label: s.model_label, remaining_pct: s.remaining_pct });
      } catch {
        /* ignore */
      }
    })();
  }, [open, setStatus]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    // Не блокируем чат: каждый вопрос летит независимо (свой плейсхолдер +
    // свой запрос). Можно задать следующий, не дожидаясь ответа на текущий.
    const key = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [
      ...prev,
      { key, login: myLogin, name: myName, question: q, answer: '', pending: true },
    ]);
    try {
      const res = await api.call<AiQueryResponse>('ai_query', { question: q }, { timeoutMs: 90_000 });
      const st = { model_label: res.model_label, remaining_pct: res.remaining_pct };
      if (res.message?.id != null) {
        // Серверное сообщение — заменяем оптимистичный плейсхолдер им (дедуп по
        // id, чтобы ws-копия того же сообщения не задвоила ленту).
        setMessages((prev) => prev.filter((m) => m.key !== key));
        upsertServer(
          {
            id: res.message.id,
            login: myLogin,
            name: myName,
            question: q,
            answer: res.answer || '—',
            created_at: res.message.created_at,
          },
          st,
        );
      } else {
        // Нет server-id (мягкая ошибка сервиса) — показываем ответ на месте.
        setStatus(st);
        setMessages((prev) =>
          prev.map((m) =>
            m.key === key
              ? { ...m, pending: false, answer: res.answer || '—', error: !res.ok }
              : m,
          ),
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.key === key
            ? { ...m, pending: false, error: true, answer: 'Ошибка запроса. Попробуй ещё раз.' }
            : m,
        ),
      );
    }
  }, [input, myLogin, myName, setMessages, setStatus, upsertServer]);

  // Группировка по yek-дню (как в Чатах) — внутри каждой группы плавающий
  // sticky-разделитель даты. Оптимистичные сообщения без created_at → dayKey 0
  // (без подписи), стоят последней группой пока не подтвердятся сервером.
  const groups = useMemo(() => {
    const out: { dayKey: number; label: string; items: AiChatMessage[] }[] = [];
    for (const m of messages) {
      const dayKey = yekDayKeyFor(m.created_at) ?? 0;
      const last = out[out.length - 1];
      if (last && last.dayKey === dayKey) last.items.push(m);
      else out.push({ dayKey, label: dayKey === 0 ? '' : formatDayDividerLabel(m.created_at), items: [m] });
    }
    return out;
  }, [messages]);

  if (!open) return null;

  if (minimized) {
    // Сочный mesh: насыщенные цветные источники с плотным ядром (color до ~20%,
    // прозрачность дальше) — плавно блуждают по площади, перекрываются богато,
    // без туманных размывов. Анкор — фирменный clay, акценты — водно-плазменные.
    const mesh =
      'radial-gradient(circle,#F2774C 0%,#F2774C 22%,transparent 60%),' +
      'radial-gradient(circle,#3FC6E8 0%,#3FC6E8 18%,transparent 56%),' +
      'radial-gradient(circle,#B664F5 0%,#B664F5 18%,transparent 56%),' +
      'radial-gradient(circle,#5C84F5 0%,#5C84F5 18%,transparent 56%),' +
      'radial-gradient(circle,#F0A23F 0%,#F0A23F 20%,transparent 58%)';
    const meshStyle = {
      backgroundImage: mesh,
      backgroundSize: '150% 150%', // крупные плотные пятна → богатое перекрытие
      backgroundRepeat: 'no-repeat',
    } as const;
    // Цветной кант-рамка (тот же набор по кругу, насыщеннее, без шва).
    const borderGrad =
      'conic-gradient(from 0deg,#F2774C,#F0A23F,#3FC6E8,#5C84F5,#B664F5,#F2774C)';
    const pos = pillDrag.pos;
    return (
      <button
        type="button"
        aria-label="Развернуть AI Gemini"
        onPointerDown={pillDrag.onPointerDown}
        onPointerMove={pillDrag.onPointerMove}
        onPointerUp={pillDrag.onPointerUp}
        onClick={pillDrag.onClick}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cn(
          'group fixed z-[60] touch-none select-none rounded-full',
          'cursor-grab active:cursor-grabbing',
          !pos && 'bottom-4 right-4',
        )}
      >
        {/* Насыщенное цветное свечение-ореол по площади (размытая копия mesh). */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full opacity-90 blur-[7px] saturate-150 animate-mesh group-hover:opacity-100 motion-reduce:animate-none"
          style={meshStyle}
        />
        {/* Сочный цветной кант 2px (тело перекрывает центр). */}
        <span
          className="relative block overflow-hidden rounded-full p-[2px] shadow-lg"
          style={{ backgroundImage: borderGrad }}
        >
          {/* Тело: тёмная подложка + плотный цветной градиент; текст/иконка поверх. */}
          <span className="relative flex items-center gap-2 overflow-hidden rounded-full bg-bg-primary px-3.5 py-2 text-[13px] font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-90 saturate-150 animate-mesh motion-reduce:animate-none"
              style={meshStyle}
            />
            <Sparkles className="relative h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" strokeWidth={1.85} />
            <span className="relative">AI Gemini</span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      style={{ width: panelResize.size.w, height: panelResize.size.h }}
      className={cn(
        'fixed bottom-4 right-4 z-[60] flex flex-col',
        // Стеклянное окно (как пилюля): полупрозрачный фон + блюр подложки.
        'overflow-hidden rounded-xl border border-border-strong bg-bg-surface/80 backdrop-blur-2xl',
        'shadow-[0_12px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/10',
      )}
    >
      {/* Ресайз за края/угол: окно якорится снизу-справа, поэтому верхний край
          растит высоту, левый — ширину, угол — оба. */}
      <div aria-hidden {...panelResize.makeHandlers('n')} className="absolute left-3 right-3 top-0 z-10 h-1.5 cursor-ns-resize touch-none" />
      <div aria-hidden {...panelResize.makeHandlers('w')} className="absolute bottom-3 left-0 top-3 z-10 w-1.5 cursor-ew-resize touch-none" />
      <div
        role="separator"
        aria-label="Изменить размер окна"
        {...panelResize.makeHandlers('nw')}
        className="group absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
      >
        <span className="absolute left-1 top-1 h-2 w-2 rounded-tl-[3px] border-l-2 border-t-2 border-border-strong opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-default px-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-clay" strokeWidth={1.75} />
          <span className="text-[13px] font-medium text-text-strong">AI Gemini</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Текущая модель цепочки + остаток её дневной квоты (%). Модель слева. */}
          {modelLabel && (
            <span className="mr-1.5 flex items-center gap-1 text-[11px] text-text-muted">
              <span className="font-medium text-text-secondary">{modelLabel}</span>
              <span className="text-text-muted/40">·</span>
              <span className="tabular-nums">{t('ai.remaining_pct', { p: remainingPct })}</span>
            </span>
          )}
          {/* «Что я могу» — простая подсказка-концепция (рядом с индикатором). */}
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={t('ai.help')}
                title={t('ai.help')}
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
              >
                <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="end"
                sideOffset={6}
                className={cn(
                  'z-[70] w-[300px] rounded-xl border border-border-default bg-bg-elevated p-3 shadow-2xl',
                  'data-[state=open]:animate-in data-[state=closed]:animate-out',
                  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
                  'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
                )}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-accent-clay" strokeWidth={1.75} />
                  <span className="text-[12px] font-semibold text-text-strong">{t('ai.help')}</span>
                </div>
                <HelpBody text={t('ai.help_body')} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <HeaderButton title="Свернуть" onClick={toggleMinimized}>
            <Minus className="h-4 w-4" strokeWidth={1.75} />
          </HeaderButton>
          <HeaderButton title="Закрыть" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" strokeWidth={1.75} />
          </HeaderButton>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
            {t('ai.empty')}
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map((g) => (
              // Без gap на обёртке — sticky-divider внутри flex+gap в Chromium
              // капризничает (см. DateDivider). Отступы сообщений — вложенным space-y.
              <div key={g.dayKey} className="flex flex-col">
                {g.label && <DateDivider label={g.label} />}
                <div className="space-y-3">
                  {g.items.map((m) => (
                    <MessageRow key={m.key} m={m} time={formatTimeYek(m.created_at)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border-default p-2">
        <div
          className={cn(
            'flex items-end gap-1.5 rounded-xl border border-border-default bg-bg-deep px-2 py-1.5',
            'transition-colors focus-within:border-accent-clay/60',
          )}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t('ai.ask')}
            rows={1}
            className="max-h-28 min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
          />
          {input.trim().length > 0 && (
            <button
              type="button"
              onClick={() => void send()}
              className={cn(
                'mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                'bg-accent-clay text-white transition-colors hover:bg-accent-clay-dim',
              )}
              aria-label="Отправить"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Справка «Что я могу»: вводная строка + категории «• Название — примеры».
 * Текст приходит из i18n (многострочный, `\n`); категорию (до «—») выделяем.
 */
function HelpBody({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-[12px] leading-snug text-text-secondary">
      {text.split('\n').map((line, i) => {
        const li = line.trim();
        if (!li) return null;
        if (li.startsWith('•')) {
          const body = li.replace(/^•\s*/, '');
          const dash = body.indexOf('—');
          const cat = dash > 0 ? body.slice(0, dash).trim() : '';
          const rest = dash > 0 ? body.slice(dash + 1).trim() : body;
          return (
            <div key={i} className="flex gap-1.5">
              <span className="mt-px select-none text-accent-clay">•</span>
              <span className="min-w-0 flex-1">
                {cat && <span className="font-medium text-text-strong">{cat} — </span>}
                {rest}
              </span>
            </div>
          );
        }
        return <p key={i}>{li}</p>;
      })}
    </div>
  );
}

/** Минимальный размер развёрнутого окна (px). Максимум — вьюпорт минус поля. */
const MIN_W = 320;
const MIN_H = 360;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

interface PillPos {
  x: number;
  y: number;
}

interface PillDrag {
  /** Текущая позиция (live при перетаскивании, иначе сохранённая); null = дефолт низ-право. */
  pos: PillPos | null;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: () => void;
}

/**
 * Перетаскивание свёрнутой пилюли указателем. Отличает клик (сдвиг < 4px) от
 * перетаскивания: клик → onClick (развернуть), перетаскивание → commit позиции.
 * Live-позиция в state для плавности; последняя точка в ref (без stale-closure).
 * Сохранённую позицию клампим во вьюпорт — окно могли уменьшить между сессиями.
 */
function usePillDrag(
  saved: PillPos | null,
  commit: (x: number, y: number) => void,
  onClick: () => void,
): PillDrag {
  const [live, setLive] = useState<PillPos | null>(null);
  const st = useRef({ active: false, moved: false, px: 0, py: 0, ox: 0, oy: 0, w: 0, h: 0, lx: 0, ly: 0 });
  const dragged = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    st.current = { active: true, moved: false, px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height, lx: r.left, ly: r.top };
    dragged.current = false;
    el.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = st.current;
    if (!s.active) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 4) return;
    s.moved = true;
    dragged.current = true;
    s.lx = clamp(s.ox + dx, 4, window.innerWidth - s.w - 4);
    s.ly = clamp(s.oy + dy, 4, window.innerHeight - s.h - 4);
    setLive({ x: s.lx, y: s.ly });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = st.current;
    if (!s.active) return;
    s.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (s.moved) commit(s.lx, s.ly);
    setLive(null);
  }, [commit]);

  // Клик после реального перетаскивания подавляем (флаг гасится в pointerdown).
  const onClickGuarded = useCallback(() => {
    if (dragged.current) { dragged.current = false; return; }
    onClick();
  }, [onClick]);

  let pos = live ?? saved;
  if (pos && !live) {
    pos = { x: clamp(pos.x, 4, window.innerWidth - 48), y: clamp(pos.y, 4, window.innerHeight - 40) };
  }
  return { pos, onPointerDown, onPointerMove, onPointerUp, onClick: onClickGuarded };
}

interface PanelSize {
  w: number;
  h: number;
}

/** Направление ручки ресайза: 'n' — верх (высота), 'w' — лево (ширина), 'nw' — угол (оба). */
type ResizeDir = 'n' | 'w' | 'nw';

interface ResizeHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}

interface PanelResize {
  size: PanelSize;
  /** Обработчики для ручки заданного направления (верх / лево / угол). */
  makeHandlers: (dir: ResizeDir) => ResizeHandlers;
}

/**
 * Ресайз развёрнутого окна за края/угол. Окно якорится снизу-справа, поэтому
 * тянем вверх → высота растёт (ручка 'n'), влево → ширина растёт ('w'), угол —
 * оба ('nw'). Клампим в [MIN_W×MIN_H … вьюпорт-32]; сохранённый размер тоже.
 */
function usePanelResize(saved: PanelSize, commit: (w: number, h: number) => void): PanelResize {
  const [live, setLive] = useState<PanelSize | null>(null);
  const st = useRef({ active: false, dir: 'nw' as ResizeDir, px: 0, py: 0, ow: 0, oh: 0, lw: 0, lh: 0 });

  const makeHandlers = useCallback((dir: ResizeDir): ResizeHandlers => ({
    onPointerDown: (e) => {
      st.current = { active: true, dir, px: e.clientX, py: e.clientY, ow: saved.w, oh: saved.h, lw: saved.w, lh: saved.h };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.stopPropagation();
    },
    onPointerMove: (e) => {
      const s = st.current;
      if (!s.active) return;
      s.lw = s.dir.includes('w') ? clamp(s.ow + (s.px - e.clientX), MIN_W, window.innerWidth - 32) : s.ow;
      s.lh = s.dir.includes('n') ? clamp(s.oh + (s.py - e.clientY), MIN_H, window.innerHeight - 32) : s.oh;
      setLive({ w: s.lw, h: s.lh });
    },
    onPointerUp: (e) => {
      const s = st.current;
      if (!s.active) return;
      s.active = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      commit(s.lw, s.lh);
      setLive(null);
    },
  }), [saved.w, saved.h, commit]);

  const raw = live ?? saved;
  const size = {
    w: clamp(raw.w, MIN_W, window.innerWidth - 32),
    h: clamp(raw.h, MIN_H, window.innerHeight - 32),
  };
  return { size, makeHandlers };
}

interface HeaderButtonProps {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function HeaderButton({ title, onClick, children }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-strong"
    >
      {children}
    </button>
  );
}

function MessageRow({ m, time }: { m: AiChatMessage; time: string }) {
  return (
    <div className="space-y-2">
      {/* Вопрос пользователя — справа (имя + время над пузырём, тоже справа). */}
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-baseline gap-1.5 px-1">
          <span className="text-[11px] font-medium text-text-muted">{m.name || m.login}</span>
          <span className="text-[10px] tabular-nums text-text-muted/60">{time}</span>
        </div>
        <div className="group flex max-w-[88%] items-start justify-end gap-1">
          <CopyButton text={m.question} />
          <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-accent-clay/15 px-3 py-1.5 text-[13px] text-text-strong">
            {m.question}
          </div>
        </div>
      </div>
      {/* Ответ ИИ — слева (входящее). */}
      <div className="group flex items-start gap-1.5">
        <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-accent-clay" strokeWidth={1.75} />
        <div
          className={cn(
            'max-w-[88%] rounded-2xl rounded-tl-sm px-3 py-1.5 text-[13px]',
            m.error ? 'text-danger' : 'bg-bg-deep text-text-primary',
          )}
        >
          {m.pending ? <Thinking /> : <AnswerBody text={m.answer} />}
        </div>
        {!m.pending && !m.error && m.answer && <CopyButton text={m.answer} />}
      </div>
    </div>
  );
}

/** Жирный **текст** внутри строки (модель иногда выделяет ключевое). */
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-text-strong">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

type AnswerBlock =
  | { type: 'text'; lines: string[] }
  | { type: 'table'; rows: string[][] };

/** Строка похожа на ряд Markdown-таблицы: есть `|` и ≥2 ячейки после разбиения. */
function isTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  return t.replace(/^\||\|$/g, '').split('|').length >= 2;
}
/** Разделительный ряд таблицы (|---|:--:|) — не данные. */
function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && /-/.test(line);
}
function splitCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** Разбить ответ на блоки текста и таблиц (подряд идущие table-строки → таблица). */
function parseBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let text_lines: string[] = [];
  let table_rows: string[][] = [];
  const flushText = () => { if (text_lines.length) { blocks.push({ type: 'text', lines: text_lines }); text_lines = []; } };
  const flushTable = () => { if (table_rows.length) { blocks.push({ type: 'table', rows: table_rows }); table_rows = []; } };
  for (const line of text.split('\n')) {
    if (isTableRow(line)) {
      if (isTableSep(line)) continue; // строку-разделитель пропускаем
      flushText();
      table_rows.push(splitCells(line));
    } else {
      flushTable();
      text_lines.push(line);
    }
  }
  flushText();
  flushTable();
  return blocks;
}

/**
 * Оформление ответа ИИ: списки-пункты «• …» (clay-маркер), обычные строки и
 * **жирный**; Markdown-таблицы (график/сверка) → компактная таблица с
 * горизонтальной прокруткой. Окно ИИ можно расширить — широкие таблицы влезают.
 */
function AnswerBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-1.5">
      {blocks.map((b, bi) =>
        b.type === 'table' ? <MdTable key={bi} rows={b.rows} /> : <TextLines key={bi} lines={b.lines} keyPrefix={`b${bi}`} />,
      )}
    </div>
  );
}

function TextLines({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }) {
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (/^[•\-*]\s+/.test(t)) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="mt-px select-none text-accent-clay">•</span>
              <span className="min-w-0 flex-1">{renderInline(t.replace(/^[•\-*]\s+/, ''), `${keyPrefix}l${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(t, `${keyPrefix}l${i}`)}</div>;
      })}
    </div>
  );
}

/** Компактная таблица для табличных ответов (первый ряд — заголовок). */
function MdTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  if (!head) return null;
  return (
    <div className="my-0.5 overflow-x-auto rounded-md border border-border-subtle/40">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-bg-hover/50">
            {head.map((c, i) => (
              <th key={i} className="whitespace-nowrap border-b border-border-default px-2 py-1 text-left font-semibold text-text-strong">
                {renderInline(c, `th${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b border-border-subtle/25 last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className="px-2 py-1 align-top text-text-primary">{renderInline(c, `td${ri}-${ci}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-text-muted via-accent-clay to-text-muted bg-clip-text font-medium text-transparent">
        думаю
      </span>
      <span className="flex items-center gap-0.5">
        {[0, 180, 360].map((delay) => (
          <span
            key={delay}
            className="h-1 w-1 animate-bounce rounded-full bg-accent-clay/70"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Копировать"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
      className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:text-text-strong group-hover:opacity-100"
    >
      {done ? <Check className="h-3 w-3" strokeWidth={2} /> : <Copy className="h-3 w-3" strokeWidth={1.75} />}
    </button>
  );
}

