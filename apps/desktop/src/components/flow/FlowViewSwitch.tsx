import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, ListFilter, RotateCcw, User, Users } from 'lucide-react';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import type { FlowViewMode } from './flow-view';

interface FlowViewSwitchProps {
  /** Текущий режим вида. */
  mode: FlowViewMode;
  /** Сменить режим (Общий ↔ Личный). */
  onModeChange: (m: FlowViewMode) => void;
  /** Кто последний поставил общий вид (ФИО + когда). Пусто — общий вид не задан. */
  sharedAuthor: { updatedBy: string; updatedByName: string; updatedAt: string };
  /** Есть ли непустой ОБЩИЙ вид (показ автора + доступность «Сбросить общий»). */
  hasSharedView: boolean;
  /** Есть ли непустой ЛИЧНЫЙ вид (доступность «Сбросить личный»). */
  hasPersonalView: boolean;
  /** Сбросить вид к стандарту (снять все фильтры/сортировку) — личный или общий. */
  onReset: (target: FlowViewMode) => void;
}

/**
 * Переключатель видов раздела «Поток» — «Общий / Личный» (filter-views, как в Google-
 * таблицах). Вид = UI-слой над данными (фильтры/сортировка/масштаб), строки не меняет.
 *   • Общий  — синхронный, на сервере, виден всем; кто поставил — ФИО + дата по Екб.
 *   • Личный — приватный, в localStorage, виден только себе.
 * Кнопка называется «Вид» и показывает текущий режим (Общий/Личный) — не нужно раскрывать,
 * чтобы вспомнить. В выпадашке 4 пункта: Общий · Личный · Сбросить личный · Сбросить общий.
 */
export function FlowViewSwitch({
  mode,
  onModeChange,
  sharedAuthor,
  hasSharedView,
  hasPersonalView,
  onReset,
}: FlowViewSwitchProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const setAt = useFormatYek(sharedAuthor.updatedAt || undefined);
  const authorName = sharedAuthor.updatedByName || sharedAuthor.updatedBy;
  // Автора показываем только когда есть НЕПУСТОЙ общий вид и известно, кто поставил.
  const showAuthor = hasSharedView && !!sharedAuthor.updatedBy;
  const modeLabel = mode === 'shared' ? 'Общий' : 'Личный';

  const switchTo = (m: FlowViewMode) => {
    if (m !== mode) onModeChange(m);
    setOpen(false);
  };
  const reset = (target: FlowViewMode) => {
    onReset(target);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={`Вид таблицы — ${modeLabel}`}
          className="flex h-6 items-center gap-1 rounded-md border border-black/10 pl-2 pr-1.5 text-[12px] text-[#6B6862] outline-none transition-colors hover:text-[#0A0A0A] data-[state=open]:text-[#0A0A0A]"
        >
          <ListFilter size={13} strokeWidth={1.75} />
          <span>Вид</span>
          <span className="text-black/25">·</span>
          <span className="font-semibold text-[#0A0A0A]">{modeLabel}</span>
          <ChevronDown size={11} className="text-text-muted" strokeWidth={1.75} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-30 w-[232px] rounded-lg border border-white/[0.08] bg-bg-elevated p-1.5 text-text-primary shadow-2xl outline-none"
        >
          {/* Общий — синхронный серверный вид; под ним «кто поставил». */}
          <ModeRow
            active={mode === 'shared'}
            icon={<Users size={14} strokeWidth={1.75} />}
            label="Общий"
            onClick={() => switchTo('shared')}
          >
            {showAuthor && (
              <div className="mt-0.5 truncate pl-[26px] text-[10.5px] leading-snug text-text-muted/80">
                {authorName}
                {setAt ? ` · ${setAt}` : ''}
              </div>
            )}
          </ModeRow>

          {/* Личный — приватный вид (localStorage), виден только себе. */}
          <ModeRow
            active={mode === 'personal'}
            icon={<User size={14} strokeWidth={1.75} />}
            label="Личный"
            onClick={() => switchTo('personal')}
          />

          <div className="mx-1 my-1 h-px bg-white/[0.07]" />

          {/* Сброс к стандарту (снять все фильтры/сортировку) — личный или общий. */}
          <ResetRow
            label="Сбросить личный"
            disabled={!hasPersonalView}
            title="Снять все фильтры и сортировку в вашем личном виде"
            onClick={() => reset('personal')}
          />
          <ResetRow
            label="Сбросить общий"
            disabled={!hasSharedView}
            title="Снять все фильтры и сортировку в общем виде — у всех"
            onClick={() => reset('shared')}
          />

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Строка выбора режима: иконка + название + галка активного (+ опц. под-строка автора). */
function ModeRow({
  active,
  icon,
  label,
  onClick,
  children,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full flex-col rounded-md px-1.5 py-1.5 text-left outline-none transition-colors',
        active ? 'bg-accent-clay-bg' : 'hover:bg-white/[0.06]',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span className={['flex w-[18px] justify-center', active ? 'text-accent-clay' : 'text-text-muted'].join(' ')}>
          {icon}
        </span>
        <span className={['text-[12.5px]', active ? 'font-semibold text-accent-clay' : 'text-text-primary'].join(' ')}>
          {label}
        </span>
        {active && <Check size={13} strokeWidth={2} className="ml-auto text-accent-clay" />}
      </div>
      {children}
    </button>
  );
}

/** Строка сброса вида (личный / общий) — снять все фильтры и сортировку к стандарту. */
function ResetRow({
  label,
  disabled,
  title,
  onClick,
}: {
  label: string;
  disabled: boolean;
  title: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-text-secondary outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
    >
      <span className="flex w-[18px] justify-center text-text-muted">
        <RotateCcw size={13} strokeWidth={1.75} />
      </span>
      {label}
    </button>
  );
}
