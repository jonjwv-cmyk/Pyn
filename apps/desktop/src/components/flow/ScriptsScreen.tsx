import { useEffect, useMemo, useState } from 'react';
import { Download, DatabaseZap, FileText, Users } from 'lucide-react';
import {
  flowScriptPress,
  flowScriptPressesGet,
  type FlowScriptId,
  type FlowScriptPress,
  type FlowScriptPressedEvent,
} from '@pyn/core';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/lib/ws';
import { useUsersStore } from '@/lib/stores';
import { flowDate } from './flow-sandbox.fixtures';

/**
 * Раздел «Скрипты» — 4 кнопки прогонов данных (юзер 2026-06-11). Сейчас это
 * КНОПКИ-ЗАГЛУШКИ: фиксируем кто/когда нажал (подсветка у всех реалтайм, при
 * наведении — аватар и имя); сами прогоны подключатся позже + запись в LOG.
 *
 * Что повесим (зафиксировано):
 *  • OBD — выгрузка заказов (есть в Потоке, сюда переедет/продублируется);
 *  • zm_vl — выгрузка поставок: `zm_vl_all.vbs` (по СПИСКУ номеров из текстового
 *    файла — поставки, СОЗДАННЫЕ в текущем месяце; галочка PX_WBSTK снята = все)
 *    и `zm_vl.vbs` (галочка стоит = только НЕзакрытые на момент выгрузки);
 *  • СЭД — движение документов, выгружаем ТОЛЬКО текущий месяц (старые долгие и
 *    не нужны); макрос СЭД + гугл-обработку юзер пришлёт — совместим;
 *  • МОЛы — обновление контактов/статусов по договорам.
 */
const SCRIPTS: { id: FlowScriptId; title: string; desc: string; icon: typeof Download }[] = [
  { id: 'obd', title: 'OBD', desc: 'Выгрузка заказов (формирование)', icon: Download },
  { id: 'zmvl', title: 'zm_vl', desc: 'Выгрузка поставок (сверка)', icon: DatabaseZap },
  { id: 'sed', title: 'СЭД', desc: 'Движение документов · текущий месяц', icon: FileText },
  { id: 'mols', title: 'МОЛы', desc: 'Контакты · статусы по договорам', icon: Users },
];

export function ScriptsScreen(): JSX.Element {
  const [presses, setPresses] = useState<Map<string, FlowScriptPress>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const users = useUsersStore((s) => s.users);

  useEffect(() => {
    let alive = true;
    void flowScriptPressesGet(api)
      .then((list) => {
        if (alive) setPresses(new Map(list.map((p) => [p.id, p] as const)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useWsEvent<FlowScriptPressedEvent>('flow_script_pressed', (e) => {
    setPresses((prev) => {
      const next = new Map(prev);
      next.set(String(e.id), { id: String(e.id), by: String(e.by || ''), byName: String(e.by_name || ''), at: String(e.at || '') });
      return next;
    });
  });

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const press = (id: FlowScriptId): void => {
    if (busy) return;
    setBusy(id);
    void flowScriptPress(api, id)
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-4">
        <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
          Скрипты
        </span>
        <span className="no-drag-region text-[11px] text-text-muted/60">
          прогоны данных — подключаются по мере готовности
        </span>
      </div>
      <WorkspaceCard>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#FDFDFB]">
          <div className="grid grid-cols-2 gap-4">
            {SCRIPTS.map(({ id, title, desc, icon: Icon }) => {
              const p = presses.get(id);
              const pressedToday = !!p && p.at.slice(0, 10) === todayIso;
              const who = p ? users.find((u) => u.login === p.by) : undefined;
              const tip = p
                ? `Нажимал: ${who?.fullName || p.byName || p.by}${p.at ? ` · ${flowDate(p.at, { year: false, time: true })}` : ''}`
                : 'Ещё не запускали';
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => press(id)}
                  title={tip}
                  className={cn(
                    'group flex w-[230px] flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all',
                    pressedToday
                      ? 'border-accent-clay/70 bg-white shadow-[0_0_14px_rgba(217,119,87,0.35)]'
                      : 'border-black/10 bg-white hover:border-black/25 hover:shadow-sm',
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Icon
                      size={20}
                      strokeWidth={1.75}
                      className={pressedToday ? 'text-accent-clay' : 'text-[#6B6862] group-hover:text-[#0A0A0A]'}
                    />
                    {p && (
                      who?.avatarUrl ? (
                        <img src={who.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/[0.06] text-[10px] font-medium text-[#3F3D38]">
                          {(who?.fullName || p.byName || p.by).slice(0, 1).toUpperCase()}
                        </span>
                      )
                    )}
                  </span>
                  <span className="text-[15px] font-semibold text-[#0A0A0A]">{title}</span>
                  <span className="text-[11px] leading-snug text-[#6B6862]">{desc}</span>
                  <span className="text-[10px] text-[#6B6862]/70">
                    {p ? `${who?.fullName || p.byName || p.by} · ${p.at ? flowDate(p.at, { year: false }) : ''}` : 'не запускался'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </WorkspaceCard>
    </main>
  );
}
