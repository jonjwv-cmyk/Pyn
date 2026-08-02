import * as Popover from '@radix-ui/react-popover';
import { ArrowDownUp, Check, ChevronDown, Columns3 } from 'lucide-react';

/**
 * Поповер «Колонки»: показать/скрыть + перестановка заголовков.
 * variant=grok — warm-dark surface, clay accent (GitHub/Tailwind-плотность, наши цвета).
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
  variant = 'default',
}: {
  columns: readonly FlowColumnToggle[];
  visible: ReadonlySet<string>;
  onToggle: (id: string) => void;
  reorderOn: boolean;
  onToggleReorder: () => void;
  /** grok — тёмный popover в стиле pyn-table. */
  variant?: 'default' | 'grok';
}): JSX.Element {
  const shownCount = columns.reduce((n, c) => n + (visible.has(c.id) ? 1 : 0), 0);
  const active = shownCount < columns.length || reorderOn;
  const isGrok = variant === 'grok';

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Колонки: показать/скрыть и порядок"
          className={
            isGrok
              ? 'flow-tab-tool-btn gap-1.5 px-2'
              : `flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] outline-none transition-colors data-[state=open]:border-black/30 ${
                  active
                    ? 'border-accent-clay/70 text-[#0A0A0A]'
                    : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]'
                }`
          }
        >
          <Columns3 size={13} strokeWidth={1.75} />
          Колонки
          <span className="tabular-nums opacity-70">
            {shownCount}/{columns.length}
          </span>
          <ChevronDown size={11} strokeWidth={1.75} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className={
            isGrok
              ? 'pyn-popover z-50 flex max-h-[70vh] w-[240px] flex-col overflow-hidden p-1'
              : 'z-40 flex max-h-[70vh] w-[240px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated p-1 text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]'
          }
        >
          {columns.length > 0 && (
            <>
              <div
                className={
                  isGrok
                    ? 'px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500'
                    : 'px-2 py-1 text-[10.5px] uppercase tracking-wide text-text-muted/60'
                }
              >
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
                      className={
                        isGrok
                          ? 'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.06]'
                          : 'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/10'
                      }
                    >
                      <span
                        className={
                          isGrok
                            ? `flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                                on
                                  ? 'border-[rgba(217,119,87,0.45)] bg-[rgba(217,119,87,0.12)] text-[#e8a48a]'
                                  : 'border-white/14 bg-white/[0.03] text-transparent'
                              }`
                            : `flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                on
                                  ? 'border-accent-clay/60 bg-accent-clay/15 text-accent-clay'
                                  : 'border-black/15 bg-black/[0.02] text-transparent'
                              }`
                        }
                        aria-hidden
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span
                        className={
                          on
                            ? isGrok
                              ? 'min-w-0 flex-1 truncate text-zinc-50'
                              : 'min-w-0 flex-1 truncate text-text-strong'
                            : isGrok
                              ? 'min-w-0 flex-1 truncate text-zinc-500'
                              : 'min-w-0 flex-1 truncate text-text-muted/80'
                        }
                      >
                        {c.title}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={`my-1 h-px shrink-0 ${isGrok ? 'bg-white/[0.08]' : 'bg-white/[0.06]'}`} />
            </>
          )}
          <button
            type="button"
            onClick={onToggleReorder}
            className={
              isGrok
                ? 'flex shrink-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.06]'
                : 'flex shrink-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/10'
            }
          >
            <span className="flex items-center gap-1.5">
              <ArrowDownUp size={12} strokeWidth={1.75} />
              Перестановка
            </span>
            <span
              className={`text-[10px] font-medium ${
                reorderOn ? (isGrok ? 'text-[#e8a48a]' : 'text-accent-clay') : isGrok ? 'text-zinc-600' : 'text-text-muted/50'
              }`}
            >
              {reorderOn ? 'вкл' : 'выкл'}
            </span>
          </button>
          {reorderOn && (
            <div className={`shrink-0 px-2 pb-1.5 pt-0.5 text-[10.5px] leading-snug ${isGrok ? 'text-zinc-500' : 'text-text-muted/60'}`}>
              Перетащите заголовки колонок. Порядок сохранится в «Сохранить вид».
            </div>
          )}
          {!isGrok && (
            <div className="flex items-center justify-end px-2 pb-1 pt-0.5">
              {reorderOn && <Check size={12} className="text-accent-clay" strokeWidth={2} />}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
