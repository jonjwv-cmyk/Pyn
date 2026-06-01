import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Minus, Sparkles, X } from 'lucide-react';
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
  used?: number;
  limit?: number;
  remaining?: number;
  limit_exceeded?: boolean;
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
  const open = useAiStore((s) => s.open);
  const minimized = useAiStore((s) => s.minimized);
  const messages = useAiStore((s) => s.messages);
  const remaining = useAiStore((s) => s.remaining);
  const limit = useAiStore((s) => s.limit);
  const setOpen = useAiStore((s) => s.setOpen);
  const toggleMinimized = useAiStore((s) => s.toggleMinimized);
  const setMessages = useAiStore((s) => s.setMessages);
  const setLimits = useAiStore((s) => s.setLimits);
  const upsertServer = useAiStore((s) => s.upsertServer);
  const applyHistory = useAiStore((s) => s.applyHistory);

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
          used?: number; limit?: number; remaining?: number;
        }>('ai_history', { since_id: since });
        if (!cancelled) {
          applyHistory(r.messages ?? [], { used: r.used, limit: r.limit, remaining: r.remaining });
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
      message?: AiServerMessage; used?: number; limit?: number; remaining?: number;
    };
    if (ev.message?.id != null) {
      upsertServer(ev.message, { used: ev.used, limit: ev.limit, remaining: ev.remaining });
    }
  });

  useEffect(() => {
    if (open && !minimized) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, open, minimized]);

  // При открытии подтягиваем остаток общего лимита (счётчик в шапке).
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const s = await api.call<{ used?: number; limit?: number; remaining?: number }>(
          'ai_status',
          {},
        );
        if (typeof s.used === 'number') setLimits(s.used, s.limit ?? 0, s.remaining ?? 0);
      } catch {
        /* ignore */
      }
    })();
  }, [open, setLimits]);

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
      const lim = { used: res.used, limit: res.limit, remaining: res.remaining };
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
          lim,
        );
      } else {
        // Нет server-id (лимит/мягкая ошибка) — показываем ответ на месте.
        if (typeof res.used === 'number') setLimits(res.used, res.limit ?? 0, res.remaining ?? 0);
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
  }, [input, myLogin, myName, setMessages, setLimits, upsertServer]);

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
    // Хаотичный градиент НА ВСЮ ПЛОЩАДЬ: несколько цветных источников (центр,
    // бока, углы) перекрываются и плавно блуждают — без тёмных дыр. Палитра
    // тёплый clay + холодные водно-плазменные тона.
    const mesh =
      'radial-gradient(circle,#D97757 0%,transparent 70%),' +
      'radial-gradient(circle,#5BB8D9 0%,transparent 70%),' +
      'radial-gradient(circle,#B57BE8 0%,transparent 70%),' +
      'radial-gradient(circle,#6E8CE0 0%,transparent 70%),' +
      'radial-gradient(circle,#D4A37F 0%,transparent 70%)';
    const meshStyle = {
      backgroundImage: mesh,
      backgroundSize: '135% 135%', // крупные пятна → перекрытие, закрывают всю площадь
      backgroundRepeat: 'no-repeat',
    } as const;
    // Цветная рамка-кант (тот же набор цветов по кругу, без шва).
    const borderGrad =
      'conic-gradient(from 0deg,#D97757,#E0A050,#D4A37F,#5BB8D9,#6E8CE0,#B57BE8,#D97757)';
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        aria-label="Развернуть AI Helper"
        className="group fixed bottom-4 right-4 z-[60] rounded-full"
      >
        {/* Мягкая подсветка по всей площади — размытая копия градиента. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full opacity-50 blur-md animate-mesh group-hover:opacity-70 motion-reduce:animate-none"
          style={meshStyle}
        />
        {/* Цветная рамка: градиент виден кантом 1.5px (тело перекрывает центр). */}
        <span
          className="relative block overflow-hidden rounded-full p-[1.5px] shadow-md"
          style={{ backgroundImage: borderGrad }}
        >
          {/* Тело: тёмная подложка + градиент-заливка на всю площадь; текст поверх. */}
          <span className="relative flex items-center gap-2 overflow-hidden rounded-full bg-bg-primary px-3.5 py-2 text-[13px] text-text-strong">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.55] animate-mesh motion-reduce:animate-none"
              style={meshStyle}
            />
            <Sparkles className="relative h-4 w-4 text-accent-clay" strokeWidth={1.75} />
            <span className="relative">AI Helper</span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[60] flex h-[520px] w-[380px] flex-col',
        'overflow-hidden rounded-xl border border-border-strong bg-bg-surface',
        'shadow-[0_12px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/5',
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-default px-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-clay" strokeWidth={1.75} />
          <span className="text-[13px] font-medium text-text-strong">AI Helper</span>
        </div>
        <div className="flex items-center gap-0.5">
          {limit > 0 && (
            <span className="mr-1.5 text-[11px] tabular-nums text-text-muted">
              осталось {remaining}/{limit}
            </span>
          )}
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
            Что тебя интересует?
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
            placeholder="Спросить…"
            rows={1}
            className="max-h-28 min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
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
      title={title}
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

/**
 * Лёгкое оформление ответа ИИ: строки-пункты «• …» получают аккуратный отступ
 * и clay-маркер, обычные строки — как есть. Markdown-таблицы сервер не шлёт
 * (узкое окно), так что тяжёлый рендерер не нужен.
 */
function AnswerBody({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        const bullet = /^[•\-*]\s+/.test(t);
        if (bullet) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="mt-px select-none text-accent-clay">•</span>
              <span className="min-w-0 flex-1">{renderInline(t.replace(/^[•\-*]\s+/, ''), `l${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(t, `l${i}`)}</div>;
      })}
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

