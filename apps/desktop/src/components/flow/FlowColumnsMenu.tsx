import * as Popover from '@radix-ui/react-popover';
import { ArrowDownUp, Check, ChevronDown, Columns3 } from 'lucide-react';

/**
 * Поповер «Колонки» — один компактный триггер вместо россыпи кнопок в тулбаре
 * (юзер 2026-07-13: «панель не аккуратная, перебор кнопок»). Внутри: тумблеры
 * показа служебных/жёлтых колонок + переключатель «Перестановка» (свой порядок).
 * Общий для Формирования и Плана/Отчёта.
 */
export interface FlowColumnToggle {
  readonly id: string;
  readonly title: string;
}

export function FlowColumnsMenu({
  columns,
  visible,
  onToggle,
  reorderOn,
  onToggleReorder,
}: {
  columns: readonly FlowColumnToggle[];
  visible: ReadonlySet<string>;
  onToggle: (id: string) => void;
  reorderOn: boolean;
  onToggleReorder: () => void;
}): JSX.Element {
  const shownCount = columns.reduce((n, c) => n + (visible.has(c.id) ? 1 : 0), 0);
  const active = shownCount > 0 || reorderOn;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Колонки: показать/скрыть служебные колонки и включить свой порядок"
          className={`flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] outline-none transition-colors data-[state=open]:border-black/30 ${
            active
              ? 'border-accent-clay/70 text-[#0A0A0A]'
              : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]'
          }`}
        >
          <Columns3 size={12} strokeWidth={1.75} />
          Колонки
          {shownCount > 0 && <span className="tabular-nums opacity-70">{shownCount}</span>}
          <ChevronDown size={11} strokeWidth={1.75} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="z-40 flex max-h-[70vh] w-56 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated p-1 text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
          {columns.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10.5px] uppercase tracking-wide text-text-muted/60">
                Показать колонки
              </div>
              <div className="flex min-h-0 flex-col overflow-y-auto">
                {columns.map((c) => {
                  const on = visible.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onToggle(c.id)}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/10"
                    >
                      <span className={on ? 'text-text-strong' : 'text-text-muted/80'}>{c.title}</span>
                      {on && <Check size={13} strokeWidth={2} className="shrink-0 text-accent-clay" />}
                    </button>
                  );
                })}
              </div>
              <div className="my-1 h-px shrink-0 bg-white/[0.06]" />
            </>
          )}
          <button
            type="button"
            onClick={onToggleReorder}
            className="flex shrink-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/10"
          >
            <span className="flex items-center gap-1.5">
              <ArrowDownUp size={12} strokeWidth={1.75} />
              Перестановка
            </span>
            <span className={`text-[10px] ${reorderOn ? 'text-accent-clay' : 'text-text-muted/60'}`}>
              {reorderOn ? 'вкл' : 'выкл'}
            </span>
          </button>
          {reorderOn && (
            <div className="shrink-0 px-2 pb-1 pt-0.5 text-[10.5px] leading-snug text-text-muted/60">
              Перетаскивайте заголовки колонок — порядок сохранится за вами.
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
