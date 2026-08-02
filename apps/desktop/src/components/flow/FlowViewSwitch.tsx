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
  /** Кто последний поставил общий вид (ФИО + когда). */
  sharedAuthor: { updatedBy: string; updatedByName: string; updatedAt: string };
  /** Есть непустой общий вид (для default-меню сброса). */
  hasSharedView: boolean;
  /** Есть непустой личный вид (для default-меню сброса). */
  hasPersonalView: boolean;
  /** Сброс вида — только default (Glide/Формирование). Grok: без сброса. */
  onReset?: (target: FlowViewMode) => void;
  /**
   * grok — один ползунок «Личный»: вкл = свой, выкл = общий. Без сброса.
   * default — выпадашка Общий/Личный + сброс (как раньше).
   */
  variant?: 'default' | 'grok';
}

/**
 * Переключатель видов: Общий (сервер) / Личный (localStorage).
 * Grok: ползунок «Личный» (вкл по умолчанию), сброса нет — настроил и сохранил.
 */
export function FlowViewSwitch({
  mode,
  onModeChange,
  sharedAuthor,
  hasSharedView,
  hasPersonalView,
  onReset,
  variant = 'default',
}: FlowViewSwitchProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const setAt = useFormatYek(sharedAuthor.updatedAt || undefined);
  const authorName = sharedAuthor.updatedByName || sharedAuthor.updatedBy;
  const showAuthor = hasSharedView && !!sharedAuthor.updatedBy;
  const modeLabel = mode === 'shared' ? 'Общий' : 'Личный';
  const isGrok = variant === 'grok';
  const isPersonal = mode === 'personal';

  if (isGrok) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isPersonal}
        title={
          isPersonal
            ? 'Личный вид (свой). Выкл — общий вид для всех'
            : 'Общий вид. Вкл — личный (свой)'
        }
        onClick={() => onModeChange(isPersonal ? 'shared' : 'personal')}
        className="flow-tab-tool-btn flow-view-toggle gap-2 px-2"
      >
        <span className="flow-view-switch-track" data-on={isPersonal ? 'true' : 'false'} aria-hidden>
          <span className="flow-view-switch-thumb" />
        </span>
        <span className="text-[11.5px] font-medium">{isPersonal ? 'Личный' : 'Общий'}</span>
      </button>
    );
  }

  const switchTo = (m: FlowViewMode) => {
    if (m !== mode) onModeChange(m);
    setOpen(false);
  };
  const reset = (target: FlowViewMode) => {
    onReset?.(target);
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
          className="z-30 w-[256px] rounded-lg border border-white/[0.08] bg-bg-elevated p-1.5 text-text-primary shadow-2xl outline-none"
        >
          <ModeRow
            active={mode === 'shared'}
            icon={<Users size={14} strokeWidth={1.75} />}
            label="Общий"
            onClick={() => switchTo('shared')}
          >
            {showAuthor && (
              <div className="mt-1 whitespace-normal break-words text-[10.5px] leading-snug text-text-muted/80">
                {authorName}
                {setAt ? ` · ${setAt}` : ''}
              </div>
            )}
          </ModeRow>

          <ModeRow
            active={mode === 'personal'}
            icon={<User size={14} strokeWidth={1.75} />}
            label="Личный"
            onClick={() => switchTo('personal')}
          />

          {onReset && (
            <>
              <div className="mx-1 my-1 h-px bg-white/[0.07]" />
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
            </>
          )}

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
