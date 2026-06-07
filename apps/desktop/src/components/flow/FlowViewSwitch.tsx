import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, ListFilter, RotateCcw, User, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { useUsersStore, usePresenceStore } from '@/lib/stores';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { computeInitials } from '@/lib/initials';
import type { FlowViewMode } from './flow-view';

interface FlowViewSwitchProps {
  /** Текущий режим вида. */
  mode: FlowViewMode;
  /** Сменить режим (Общий ↔ Личный). */
  onModeChange: (m: FlowViewMode) => void;
  /** Кто последний менял общий вид (для аватара). Пусто — общий вид не задан. */
  sharedAuthor: { updatedBy: string; updatedByName: string; updatedAt: string };
  /** Есть ли непустой ОБЩИЙ вид (аватар + доступность сброса в режиме Общий). */
  hasSharedView: boolean;
  /** Есть ли непустой ЛИЧНЫЙ вид (доступность сброса в режиме Личный). */
  hasPersonalView: boolean;
  /** Сбросить вид АКТИВНОГО режима к виду по умолчанию. */
  onReset: () => void;
}

/**
 * Переключатель видов раздела «Поток» — «Общий / Личный» (filter-views, как в Google-
 * таблицах). Вид = UI-слой над данными (фильтры/сортировка/масштаб), строки не меняет.
 *   • Общий  — синхронный, на сервере, виден всем; рядом аватар того, кто менял.
 *   • Личный — приватный, в localStorage, виден только себе.
 * Кнопка-фильтр рядом с месяцем формирования; в выпадашке — выбор режима + «Сбросить вид».
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

  // Автор общего вида — из общего справочника пользователей (аватар/инициалы/presence).
  const users = useUsersStore((s) => s.users);
  const author = useMemo(
    () => (sharedAuthor.updatedBy ? users.find((u) => u.login === sharedAuthor.updatedBy) : undefined),
    [users, sharedAuthor.updatedBy],
  );
  const authorPresence =
    usePresenceStore((s) => (sharedAuthor.updatedBy ? s.byLogin[sharedAuthor.updatedBy]?.status : undefined)) ??
    'offline';
  const changedAt = useFormatYek(sharedAuthor.updatedAt || undefined);
  const authorInitials = author?.initials || computeInitials(sharedAuthor.updatedByName || sharedAuthor.updatedBy);
  // Аватар автора показываем только когда есть НЕПУСТОЙ общий вид и известно кто менял.
  const showAuthor = hasSharedView && !!sharedAuthor.updatedBy;

  const activeHasView = mode === 'shared' ? hasSharedView : hasPersonalView;

  const switchTo = (m: FlowViewMode) => {
    if (m !== mode) onModeChange(m);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={
            mode === 'shared'
              ? showAuthor
                ? `Общий вид · менял(а): ${sharedAuthor.updatedByName || author?.fullName || sharedAuthor.updatedBy}${changedAt ? ` · ${changedAt}` : ''}`
                : 'Общий вид — фильтры/сортировка/масштаб, виден всем'
              : 'Личный вид — приватный, виден только вам'
          }
          className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 pl-2 pr-1.5 text-[12px] text-[#6B6862] outline-none transition-colors hover:text-[#0A0A0A] data-[state=open]:text-[#0A0A0A]"
        >
          <ListFilter size={13} strokeWidth={1.75} />
          <span>{mode === 'shared' ? 'Общий' : 'Личный'}</span>
          {mode === 'shared' && showAuthor ? (
            <span className="relative ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              <Avatar
                initials={authorInitials}
                size={16}
                login={sharedAuthor.updatedBy}
                avatarUrl={author?.avatarUrl}
                avatarBlobKey={author?.avatarBlobKey}
                avatarBlobNonce={author?.avatarBlobNonce}
              />
              <PresenceDot
                state={authorPresence}
                size={6}
                ringClass="ring-[#FDFDFB]"
                className="absolute -bottom-0.5 -right-0.5"
              />
            </span>
          ) : (
            <ChevronDown size={12} className="text-text-muted" strokeWidth={1.75} />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-30 w-[252px] rounded-lg border border-white/[0.08] bg-bg-elevated p-1.5 text-text-primary shadow-2xl outline-none"
        >
          <div className="px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted/70">
            Вид таблицы
          </div>

          {/* Общий — синхронный серверный вид, виден всем, с автором. */}
          <ViewModeRow
            active={mode === 'shared'}
            icon={<Users size={14} strokeWidth={1.75} />}
            label="Общий"
            desc="виден всем · синхронно"
            onClick={() => switchTo('shared')}
          >
            {showAuthor && (
              <div className="mt-1 flex items-center gap-1.5 pl-[26px] text-[10.5px] text-text-muted/80">
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  <Avatar
                    initials={authorInitials}
                    size={16}
                    login={sharedAuthor.updatedBy}
                    avatarUrl={author?.avatarUrl}
                    avatarBlobKey={author?.avatarBlobKey}
                    avatarBlobNonce={author?.avatarBlobNonce}
                  />
                  <PresenceDot
                    state={authorPresence}
                    size={6}
                    ringClass="ring-bg-elevated"
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </span>
                <span className="truncate">
                  менял(а) {sharedAuthor.updatedByName || author?.fullName || sharedAuthor.updatedBy}
                  {changedAt ? ` · ${changedAt}` : ''}
                </span>
              </div>
            )}
          </ViewModeRow>

          {/* Личный — приватный вид (localStorage), виден только себе. */}
          <ViewModeRow
            active={mode === 'personal'}
            icon={<User size={14} strokeWidth={1.75} />}
            label="Личный"
            desc="только у вас · приватно"
            onClick={() => switchTo('personal')}
          />

          <div className="mx-1.5 my-1 h-px bg-white/[0.07]" />

          {/* Сброс вида активного режима (фильтры/сортировка/масштаб → по умолчанию). */}
          <button
            type="button"
            disabled={!activeHasView}
            onClick={() => {
              onReset();
              setOpen(false);
            }}
            title={
              mode === 'shared'
                ? 'Сбросить общий вид у всех (фильтры/сортировка/масштаб)'
                : 'Сбросить ваш личный вид'
            }
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-text-secondary outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            <RotateCcw size={14} strokeWidth={1.75} className="text-text-muted" />
            Сбросить вид
            <span className="ml-auto text-[10.5px] text-text-muted/70">
              {mode === 'shared' ? 'у всех' : 'у себя'}
            </span>
          </button>

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Строка выбора режима вида: иконка + название + описание + галка активного. */
function ViewModeRow({
  active,
  icon,
  label,
  desc,
  onClick,
  children,
}: {
  active: boolean;
  icon: JSX.Element;
  label: string;
  desc: string;
  onClick: () => void;
  children?: JSX.Element | false;
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
        <span className={active ? 'text-accent-clay' : 'text-text-muted'}>{icon}</span>
        <span className={['text-[12px]', active ? 'font-semibold text-accent-clay' : 'text-text-primary'].join(' ')}>
          {label}
        </span>
        <span className="text-[10.5px] text-text-muted/70">{desc}</span>
        {active && <Check size={13} strokeWidth={2} className="ml-auto text-accent-clay" />}
      </div>
      {children}
    </button>
  );
}
