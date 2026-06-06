import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { guardInteractOutside } from '@/lib/modal-guard';
import type { FlowHeaderMenuAnchor } from './FlowHeaderMenu';
import { useScrollMemory } from './use-scroll-memory';
import { FLOW_MAT_SUBFIELDS, type FlowMatSubId } from './flow-sandbox.fixtures';

/** Состояние одного под-фильтра MAT: текстовый поиск + снятые галочкой значения. */
export interface FlowMatSubState {
  search: string;
  excluded: ReadonlySet<string>;
}

interface FlowMatFilterMenuProps {
  /** Открыто (якорь заголовка MAT) или null. */
  state: FlowHeaderMenuAnchor | null;
  /** Под-фильтры по id под-поля (название/создал/даты/тех-имя). */
  filters: Partial<Record<FlowMatSubId, FlowMatSubState>>;
  /** Уникальные значения по id под-поля (уже отформатированы как в таблице). */
  values: Record<FlowMatSubId, readonly string[]>;
  onSearch: (sub: FlowMatSubId, q: string) => void;
  onToggleValue: (sub: FlowMatSubId, value: string) => void;
  /** Очистить один под-фильтр (снять поиск + вернуть все галочки) → показать всё. */
  onClear: (sub: FlowMatSubId) => void;
  /** Снять все галочки одного под-фильтра → дальше отметить нужные. */
  onDeselectAll: (sub: FlowMatSubId) => void;
  /** Сбросить ВСЕ под-фильтры разом. */
  onClearAll: () => void;
  onClose: () => void;
}

const MAX_VISIBLE = 300;

/** Активен ли под-фильтр (есть поиск или снятые значения). */
function isSubActive(s: FlowMatSubState | undefined): boolean {
  return !!s && (s.search.trim() !== '' || s.excluded.size > 0);
}

/**
 * «Умный» фильтр колонки MAT (юзер 2026-06-06): данные материала, спрятанные в карточке
 * строки (название · кто создал · дата создания · дата выгрузки · тех-имя), вынесены в
 * НЕСКОЛЬКО под-фильтров СРАЗУ — карточки в ряд, как в поиске. Значения в каждом —
 * как в таблице (даты по-русски), отметил нужные → условия складываются И («все
 * Гроховский + такие-то даты выгрузки»). Клиентский фильтр показа поверх загруженных строк.
 */
export function FlowMatFilterMenu({
  state,
  filters,
  values,
  onSearch,
  onToggleValue,
  onClear,
  onDeselectAll,
  onClearAll,
  onClose,
}: FlowMatFilterMenuProps) {
  const open = state !== null;
  const anyActive = FLOW_MAT_SUBFIELDS.some((sf) => isSubActive(filters[sf.id]));

  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Popover.Anchor
        style={{
          position: 'fixed',
          left: state?.x ?? 0,
          top: (state?.y ?? 0) + (state?.height ?? 0),
          width: state?.width ?? 0,
          height: 0,
        }}
      />
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onInteractOutside={guardInteractOutside}
          className="z-30 flex max-w-[92vw] flex-col rounded-xl border border-border-subtle bg-bg-elevated p-2 text-text-secondary shadow-[0_10px_32px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[12px] font-medium text-text-secondary">Фильтр материала</span>
            <button
              type="button"
              onClick={onClearAll}
              disabled={!anyActive}
              className="rounded-md px-1.5 py-0.5 text-[12px] text-text-muted transition-colors hover:text-text-strong disabled:opacity-40"
            >
              Сбросить всё
            </button>
          </div>
          {/* Под-фильтры в ряд (как карточки поиска); много под-полей → горизонт. прокрутка. */}
          <div className="flex gap-2 overflow-x-auto">
            {FLOW_MAT_SUBFIELDS.map((sf) => (
              <MatSubCard
                key={sf.id}
                title={sf.title}
                state={filters[sf.id]}
                values={values[sf.id] ?? []}
                onSearch={(q) => onSearch(sf.id, q)}
                onToggleValue={(v) => onToggleValue(sf.id, v)}
                onClear={() => onClear(sf.id)}
                onDeselectAll={() => onDeselectAll(sf.id)}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface MatSubCardProps {
  title: string;
  state: FlowMatSubState | undefined;
  values: readonly string[];
  onSearch: (q: string) => void;
  onToggleValue: (value: string) => void;
  onClear: () => void;
  onDeselectAll: () => void;
}

/** Один под-фильтр MAT: заголовок + поиск (с ×) + чек-лист значений. */
function MatSubCard({ title, state, values, onSearch, onToggleValue, onClear, onDeselectAll }: MatSubCardProps) {
  const search = state?.search ?? '';
  const excluded = state?.excluded;
  const active = isSubActive(state);
  const scroll = useScrollMemory(`mat-${title}`);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
    return { items: list.slice(0, MAX_VISIBLE), truncated: list.length > MAX_VISIBLE };
  }, [values, search]);

  return (
    <div className="flex w-44 shrink-0 flex-col rounded-lg border border-border-subtle/60">
      <div className="flex items-center gap-1.5 border-b border-border-subtle/50 px-2 py-1">
        <span className={cn('truncate text-[12px] font-medium', active ? 'text-accent-clay' : 'text-text-secondary')}>
          {title}
        </span>
        {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-clay" />}
      </div>

      <div className="flex items-center gap-1.5 border-b border-border-subtle/40 px-2 py-1">
        <Search size={12} strokeWidth={1.75} className="shrink-0 text-text-muted/70" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Поиск…"
          className="w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted/60"
        />
        {search !== '' && (
          <button
            type="button"
            onClick={() => onSearch('')}
            title="Очистить"
            className="shrink-0 rounded p-0.5 text-text-muted/70 transition-colors hover:text-text-strong"
          >
            <X size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-2.5 px-2 py-1 text-[11px]">
        <button
          type="button"
          onClick={onDeselectAll}
          disabled={values.length === 0}
          className="text-text-muted transition-colors hover:text-text-strong disabled:opacity-40"
        >
          Сбросить
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!active}
          className="text-text-muted transition-colors hover:text-text-strong disabled:opacity-40"
        >
          Очистить
        </button>
      </div>

      <div ref={scroll.ref} onScroll={scroll.onScroll} className="max-h-52 overflow-y-auto px-1 pb-1">
        {shown.items.map((v) => {
          const checked = !excluded?.has(v);
          return (
            <button
              type="button"
              key={v}
              onClick={() => onToggleValue(v)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-accent-clay/20"
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                  checked ? 'border-accent-clay bg-accent-clay/20' : 'border-border-strong',
                )}
              >
                {checked && <Check size={11} strokeWidth={3} className="text-accent-clay" />}
              </span>
              <span className="truncate text-text-primary">{v === '' ? '(пусто)' : v}</span>
            </button>
          );
        })}
        {shown.items.length === 0 && (
          <div className="px-1.5 py-2 text-[12px] text-text-muted/70">Ничего</div>
        )}
        {shown.truncated && (
          <div className="px-1.5 py-1 text-[11px] text-text-muted/70">…первые {MAX_VISIBLE}, уточните поиском</div>
        )}
      </div>
    </div>
  );
}
