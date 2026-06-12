import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Download, DatabaseZap, FileText, Users } from 'lucide-react';
import {
  flowScriptPress,
  flowScriptPressesGet,
  type FlowScriptId,
  type FlowScriptPress,
  type FlowScriptPressedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/lib/ws';
import { useUsersStore } from '@/lib/stores';
import { Avatar } from '@/components/ui/Avatar';
import { computeInitials } from '@/lib/initials';
import { formatFullYek } from '@/lib/format-time';

/**
 * 4 кнопки-скрипта прямо в сайдбаре (юзер 2026-06-11): OBD / zm_vl / СЭД / МОЛы,
 * 2×2. Пока заглушки — позже на них вешаются реальные прогоны + запись в LOG (уже
 * пишется flow_script_runs). Поведение:
 *  • клик → flowScriptPress (фиксирует кто/когда + журнал LOG);
 *  • СВЕЧЕНИЕ при работе — пока скрипт «бежит» (стаб: ~10 c после нажатия,
 *    реальный прогон позже снимет свечение событием завершения);
 *  • при наведении — аватар + имя + время последнего запустившего.
 *  • свёрнутый сайдбар — компактные иконки 2×2.
 */

const SCRIPTS: { id: FlowScriptId; title: string; desc: string; icon: typeof Download }[] = [
  { id: 'obd', title: 'OBD', desc: 'Синхронизация открытых поставок', icon: Download },
  { id: 'zmvl', title: 'zm_vl', desc: 'Синхронизация реестра поставок', icon: DatabaseZap },
  { id: 'sed', title: 'СЭД', desc: 'Синхронизация с СЭД', icon: FileText },
  { id: 'mols', title: 'МОЛы', desc: 'Синхронизация МОЛов', icon: Users },
];

/** Сколько держим «свечение работы» после нажатия (стаб; реальный прогон снимет раньше/событием). */
const RUN_GLOW_MS = 10_000;

export function FlowScriptButtons({ collapsed }: { collapsed: boolean }): JSX.Element {
  const [presses, setPresses] = useState<Map<string, FlowScriptPress>>(() => new Map());
  const [running, setRunning] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<string | null>(null);
  const users = useUsersStore((s) => s.users);
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let alive = true;
    void flowScriptPressesGet(api)
      .then((list) => {
        if (alive) setPresses(new Map(list.map((p) => [p.id, p] as const)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // Помечаем скрипт «бежит» + авто-снятие свечения (стаб).
  const markRunning = (id: string): void => {
    setRunning((prev) => new Set(prev).add(id));
    const prevTimer = timersRef.current.get(id);
    if (prevTimer) window.clearTimeout(prevTimer);
    const t = window.setTimeout(() => {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      timersRef.current.delete(id);
    }, RUN_GLOW_MS);
    timersRef.current.set(id, t);
  };

  useWsEvent<FlowScriptPressedEvent>('flow_script_pressed', (e) => {
    const id = String(e.id || '');
    if (!id) return;
    setPresses((prev) => {
      const next = new Map(prev);
      next.set(id, { id, by: String(e.by || ''), byName: String(e.by_name || ''), at: String(e.at || '') });
      return next;
    });
    markRunning(id);
  });

  const press = (id: FlowScriptId): void => {
    markRunning(id); // оптимистично — сразу подсветка
    void flowScriptPress(api, id).catch(() => undefined);
  };

  const userByLogin = useMemo(() => {
    const m = new Map<string, (typeof users)[number]>();
    for (const u of users) m.set(u.login, u);
    return m;
  }, [users]);

  return (
    <div className={cn('px-1.5', collapsed ? 'py-1' : 'pb-1 pt-0.5')}>
      {/* Свёрнутый сайдбар — кнопки в ОДНУ колонку, чтобы тултип-подсказка справа выходила
          ЗА ПРЕДЕЛЫ рейла (а не на соседнюю кнопку); развёрнутый — 2×2 (юзер 2026-06-12 R3.2). */}
      <div className={cn('grid gap-1', collapsed ? 'grid-cols-1' : 'grid-cols-2')}>
        {SCRIPTS.map(({ id, title, desc, icon: Icon }) => {
          const p = presses.get(id);
          const who = p ? userByLogin.get(p.by) : undefined;
          const isRunning = running.has(id);
          const buttonEl = (
            <button
              type="button"
              onClick={() => press(id)}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover((h) => (h === id ? null : h))}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-md border transition-all',
                collapsed ? 'h-7' : 'h-8 px-1.5',
                isRunning
                  ? 'border-accent-clay/80 bg-accent-clay/15 text-text-strong shadow-[0_0_10px_rgba(217,119,87,0.55)] animate-pulse'
                  : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-strong',
              )}
            >
              <Icon size={collapsed ? 14 : 13} strokeWidth={1.75} />
              {!collapsed && <span className="truncate text-[11px] font-medium">{title}</span>}
              {/* мини-аватар последнего запустившего (угол кнопки) */}
              {p && who && (
                <Avatar
                  initials={computeInitials(who.fullName || who.login)}
                  size={collapsed ? 11 : 13}
                  login={who.login}
                  avatarUrl={who.avatarUrl}
                  avatarBlobKey={who.avatarBlobKey ?? undefined}
                  avatarBlobNonce={who.avatarBlobNonce ?? undefined}
                  className="ml-auto"
                />
              )}
            </button>
          );
          return (
            <div key={id} className="relative">
              {/* Свёрнутый сайдбар — подсказка как у пунктов навигации (Radix Tooltip справа,
                  тот же стиль/отступ; меняется только текст = desc; юзер 2026-06-12). */}
              {collapsed ? (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>{buttonEl}</Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      sideOffset={20}
                      avoidCollisions={false}
                      className="z-50 rounded-md bg-bg-deep px-2 py-1 text-[12px] text-text-strong shadow-lg"
                    >
                      {desc}
                      <Tooltip.Arrow className="fill-bg-deep" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ) : (
                buttonEl
              )}
              {/* hover-карточка «кто запускал» — только в развёрнутом (в свёрнутом — тултип desc). */}
              {!collapsed && hover === id && p && (
                <div className="absolute left-1/2 top-full z-50 mt-1 w-[180px] -translate-x-1/2 rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-xl">
                  <div className="flex items-center gap-2">
                    <Avatar
                      initials={computeInitials(who?.fullName || p.byName || p.by)}
                      size={26}
                      login={p.by}
                      avatarUrl={who?.avatarUrl}
                      avatarBlobKey={who?.avatarBlobKey ?? undefined}
                      avatarBlobNonce={who?.avatarBlobNonce ?? undefined}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-text-strong">
                        {who?.fullName || p.byName || p.by}
                      </div>
                      <div className="text-[10px] text-text-muted/70">
                        {isRunning ? 'запускает сейчас' : 'последний запуск'}
                        {p.at ? ` · ${formatFullYek(p.at)}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
