import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { guardInteractOutside } from '@/lib/modal-guard';
import type { FlowHeaderMenuAnchor } from './FlowHeaderMenu';
import { useScrollMemory } from './use-scroll-memory';

/** Заказ + его позиции (для фильтра ORD). */
export interface FlowOrdEntry {
  ord: string;
  positions: readonly string[];
}

interface FlowOrdFilterMenuProps {
  /** Открыто (якорь заголовка ORD) или null. */
  state: FlowHeaderMenuAnchor | null;
  /** Заказы (отсортированы по номеру), у каждого — его позиции. */
  orders: readonly FlowOrdEntry[];
  search: string;
  /** Направление сортировки по заказу (заказ→позиция) или null. */
  sortDir: 'asc' | 'desc' | null;
  onSort: (dir: 'asc' | 'desc') => void;
  onSortReset: () => void;
  /** Выбранные заказы (целиком — все позиции). */
  selectedOrders: ReadonlySet<string>;
  /** Выбранные отдельные позиции, ключ `${ord}|${it}` (ограничение внутри заказа). */
  selectedPositions: ReadonlySet<string>;
  onSearch: (q: string) => void;
  onToggleOrder: (ord: string) => void;
  onTogglePosition: (ord: string, it: string) => void;
  /** Выбрать ВСЕ позиции заказа разом (= весь заказ). */
  onSelectAllPositions: (ord: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

const MAX_VISIBLE = 300;

/**
 * «Умный» фильтр колонки ORD (юзер 2026-06-06): ДВЕ колонки — слева целиком список
 * заказов, справа позиции выбранного(ых) заказа(ов) пилюлями (без галочек). Серое =
 * не в фильтре, клик красит = в фильтре. Клик по заказу слева = весь заказ; справа
 * появляются его позиции (мягко-clay «весь заказ») — клик по позиции сужает заказ
 * только до отмеченных. Позиций мало → окно узкое; много → правая колонка со скроллом.
 */
export function FlowOrdFilterMenu({
  state,
  orders,
  search,
  sortDir,
  onSort,
  onSortReset,
  selectedOrders,
  selectedPositions,
  onSearch,
  onToggleOrder,
  onTogglePosition,
  onSelectAllPositions,
  onClearAll,
  onClose,
}: FlowOrdFilterMenuProps) {
  const open = state !== null;
  const anyActive = selectedOrders.size > 0;
  const ordersScroll = useScrollMemory('ord-orders');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? orders.filter((o) => o.ord.toLowerCase().includes(q)) : orders;
    return { items: list.slice(0, MAX_VISIBLE), truncated: list.length > MAX_VISIBLE };
  }, [orders, search]);

  // Выбранные заказы (с позициями) — для правой колонки.
  const selected = useMemo(() => orders.filter((o) => selectedOrders.has(o.ord)), [orders, selectedOrders]);
  // У каких заказов есть ограничение по позициям (выбраны конкретные позиции).
  const restricted = useMemo(() => {
    const s = new Set<string>();
    for (const k of selectedPositions) {
      const i = k.indexOf('|');
      if (i >= 0) s.add(k.slice(0, i));
    }
    return s;
  }, [selectedPositions]);

  const pill = 'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums transition-colors cursor-pointer select-none';
  // Кнопка сортировки — тот же стиль, что в меню колонки (FlowHeaderMenu).
  const sortBtn =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/20 hover:text-text-strong';

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
          {/* Сортировка по заказу (заказ→позиция) — как в фильтре колонки: две кнопки +
              линия, ниже — заказы/позиции. Копится в общую умную сортировку. */}
          <button type="button" className={sortBtn} onClick={() => onSort('asc')}>
            <ArrowUp size={14} strokeWidth={1.75} className={sortDir === 'asc' ? 'text-accent-clay' : ''} />
            По возрастанию
          </button>
          <button type="button" className={sortBtn} onClick={() => onSort('desc')}>
            <ArrowDown size={14} strokeWidth={1.75} className={sortDir === 'desc' ? 'text-accent-clay' : ''} />
            По убыванию
          </button>
          {sortDir !== null && (
            <button type="button" className={sortBtn} onClick={onSortReset}>
              <X size={14} strokeWidth={1.75} />
              Без сортировки
            </button>
          )}

          <div className="my-1.5 h-px bg-border-subtle/60" />

          <div className="flex gap-2">
            {/* ЛЕВО: список заказов (целая колонка) + поиск. */}
            <div className="flex w-44 shrink-0 flex-col">
              <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1">
                <Search size={13} strokeWidth={1.75} className="shrink-0 text-text-muted/70" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Поиск заказа…"
                  className="w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted/60"
                />
                {search !== '' && (
                  <button
                    type="button"
                    onClick={() => onSearch('')}
                    title="Очистить"
                    className="shrink-0 rounded p-0.5 text-text-muted/70 transition-colors hover:text-text-strong"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between px-1 pb-1 text-[11px]">
                <span className="text-text-muted/70">Заказы</span>
                <button
                  type="button"
                  onClick={onClearAll}
                  disabled={!anyActive}
                  className="text-text-muted transition-colors hover:text-text-strong disabled:opacity-40"
                >
                  Очистить
                </button>
              </div>
              <div
                ref={ordersScroll.ref}
                onScroll={ordersScroll.onScroll}
                className="flex max-h-72 flex-col gap-0.5 overflow-y-auto pr-1"
              >
                {shown.items.map((o) => {
                  const on = selectedOrders.has(o.ord);
                  return (
                    <button
                      type="button"
                      key={o.ord}
                      onClick={() => onToggleOrder(o.ord)}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors',
                        on ? 'bg-accent-clay/20 text-accent-clay' : 'text-text-primary hover:bg-accent-clay/10',
                      )}
                    >
                      <span className="truncate tabular-nums">{o.ord}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-muted/60">{o.positions.length}</span>
                    </button>
                  );
                })}
                {shown.items.length === 0 && (
                  <div className="px-1.5 py-2 text-[12px] text-text-muted/70">Ничего не найдено</div>
                )}
                {shown.truncated && (
                  <div className="px-1.5 py-1 text-[11px] text-text-muted/70">…первые {MAX_VISIBLE}, уточните поиском</div>
                )}
              </div>
            </div>

            {/* ПРАВО: позиции выбранных заказов. */}
            <div className="flex max-w-[460px] flex-col border-l border-border-subtle/50 pl-2">
              <div className="px-1 pb-1 text-[11px] text-text-muted/70">Позиции</div>
              <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
                {selected.length === 0 ? (
                  <div className="px-1 py-2 text-[12px] text-text-muted/60">
                    Выберите заказ слева — появятся его позиции
                  </div>
                ) : (
                  selected.map((o) => {
                    const noRestrict = !restricted.has(o.ord);
                    const total = o.positions.length;
                    const selCount = noRestrict
                      ? total
                      : o.positions.filter((it) => selectedPositions.has(`${o.ord}|${it}`)).length;
                    const isWhole = selCount >= total;
                    return (
                      <div key={o.ord} className="min-w-0">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[10px] tabular-nums text-text-muted/70">
                            {o.ord}
                            <span className="text-accent-clay/70">
                              {isWhole ? ' · весь заказ' : ` · ${selCount} из ${total} позиций`}
                            </span>
                          </span>
                          {!isWhole && (
                            <button
                              type="button"
                              onClick={() => onSelectAllPositions(o.ord)}
                              className="rounded px-1 text-[10px] text-text-muted transition-colors hover:text-accent-clay"
                            >
                              Все
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {o.positions.map((it) => {
                            const onPos = selectedPositions.has(`${o.ord}|${it}`);
                            return (
                              <button
                                type="button"
                                key={it}
                                onClick={() => onTogglePosition(o.ord, it)}
                                className={cn(
                                  pill,
                                  onPos
                                    ? 'bg-accent-clay/25 text-accent-clay'
                                    : noRestrict
                                      ? 'bg-accent-clay/10 text-accent-clay/80 ring-1 ring-inset ring-accent-clay/20'
                                      : 'bg-white/[0.05] text-text-muted hover:text-text-strong',
                                )}
                              >
                                {it === '' ? '—' : it}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
