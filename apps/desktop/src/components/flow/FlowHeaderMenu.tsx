import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDown, ArrowUp, Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Экранные координаты заголовка колонки (из Glide `onHeaderMenuClick`). */
export interface FlowHeaderMenuAnchor {
  colIndex: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlowHeaderMenuProps {
  /** Открытое меню (колонка + якорь) или null. */
  state: FlowHeaderMenuAnchor | null;
  sortDir: 'asc' | 'desc' | null;
  /** Текст поиска по колонке (он же сужает чек-лист). */
  search: string;
  /** Уникальные значения колонки (отсортированы, при необходимости усечены). */
  values: readonly string[];
  /** Значения, СНЯТЫЕ галочкой (скрытые). */
  excluded: ReadonlySet<string>;
  onSort: (dir: 'asc' | 'desc') => void;
  /** Сбросить сортировку этой колонки (вернуть исходный порядок). */
  onSortReset: () => void;
  onSearchChange: (q: string) => void;
  onToggleValue: (value: string) => void;
  onCheckAll: () => void;
  onUncheckAll: () => void;
  onClose: () => void;
}

const MAX_VISIBLE = 300;

/**
 * Меню колонки раздела «Поток» (как в Google Таблицах): сортировка + поиск по
 * колонке + чек-лист значений для фильтра показа. Открывается по клику на ▾ в
 * заголовке (Glide `onHeaderMenuClick`), позиционируется по экранным координатам
 * заголовка. Фильтр — клиентский «фильтр показа» поверх загруженных строк.
 */
export function FlowHeaderMenu({
  state,
  sortDir,
  search,
  values,
  excluded,
  onSort,
  onSortReset,
  onSearchChange,
  onToggleValue,
  onCheckAll,
  onUncheckAll,
  onClose,
}: FlowHeaderMenuProps) {
  const open = state !== null;

  // Чек-лист: сужаем поиском + кап, чтобы не рисовать тысячи строк.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
    return { items: list.slice(0, MAX_VISIBLE), truncated: list.length > MAX_VISIBLE };
  }, [values, search]);

  const sortBtn =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent-clay/20 hover:text-text-strong';

  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Якорь = невидимый узел в точке заголовка (экранные координаты Glide). */}
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
          className="z-30 flex w-64 flex-col rounded-xl border border-border-subtle bg-bg-elevated p-1.5 text-text-secondary shadow-[0_8px_28px_rgba(0,0,0,0.45)]"
        >
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

          {/* Поиск по колонке — фильтрует строки и сужает чек-лист ниже. */}
          <div className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1">
            <Search size={13} strokeWidth={1.75} className="shrink-0 text-text-muted/70" />
            <input
              autoFocus
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Поиск в колонке…"
              className="w-full bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted/60"
            />
          </div>

          <div className="flex items-center justify-between px-1 pt-1.5 text-[12px]">
            <button type="button" className="text-text-muted hover:text-text-strong" onClick={onCheckAll}>
              Выбрать все
            </button>
            <button type="button" className="text-text-muted hover:text-text-strong" onClick={onUncheckAll}>
              Очистить
            </button>
          </div>

          <div className="mt-1 max-h-56 overflow-y-auto">
            {shown.items.map((v) => {
              const checked = !excluded.has(v);
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
              <div className="px-1.5 py-2 text-[12px] text-text-muted/70">Ничего не найдено</div>
            )}
            {shown.truncated && (
              <div className="px-1.5 py-1 text-[12px] text-text-muted/70">
                …показаны первые {MAX_VISIBLE}, уточните поиском
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
