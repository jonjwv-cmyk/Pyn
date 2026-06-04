import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Стиль кода-чипа в подсказке (clay-токен, как в редакторах). */
const CODE = 'rounded bg-accent-clay/15 px-1 py-0.5 font-mono text-[11px] text-accent-clay';

/** Одно совпадение: стабильный id строки (для перелёта/подсветки) + значение ячейки. */
export interface FlowSearchMatch {
  id: number;
  value: string;
}

/** Группа результатов по одной колонке («в какой колонке нашлось»). */
export interface FlowSearchGroup {
  colIndex: number;
  title: string;
  /** Показываемые совпадения (усечены до лимита). */
  matches: FlowSearchMatch[];
  /** Полное число совпадений в колонке. */
  total: number;
}

interface FlowSearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  groups: FlowSearchGroup[];
  /** Всего совпадений по всем колонкам. */
  totalMatches: number;
  /** Активное (последнее, к которому перелетели) совпадение. */
  active: { colIndex: number; id: number } | null;
  onGoTo: (colIndex: number, id: number) => void;
  /** Заменить значение во ВСЕХ найденных ячейках на переданное (целиком). */
  onReplace: (replacement: string) => void;
  /** Результат последней замены (сколько заменено) или null — подтверждение. */
  replaceResult: number | null;
  /** «Хочет погаснуть» — после перелёта к результату (чтобы не перекрывать его).
   *  Реально гаснет только когда курсор НЕ над окном (наведение — всегда чёткое). */
  dimmed: boolean;
}

/**
 * Поиск раздела «Поток» — кнопка-пилюля «Поиск» (как отмена/масштаб) разворачивает
 * ПОД СОБОЙ окно (Radix-поповер, толстая clay-рамка — видно, что это поиск). Результаты
 * по всей базе, СГРУППИРОВАНЫ ПО КОЛОНКАМ и разложены ГОРИЗОНТАЛЬНО (видно всё сразу;
 * если колонок много — горизонтальная прокрутка, у каждой колонки своя вертикальная).
 * Клик по совпадению (→) — грид перелетает к ячейке; все совпадения подсвечены в таблице.
 */
export function FlowSearchPanel({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  totalMatches,
  active,
  onGoTo,
  onReplace,
  replaceResult,
  dimmed,
}: FlowSearchPanelProps) {
  const [hovered, setHovered] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  // Гасим только когда мешает: есть запрос на «погаснуть» И курсор не над окном.
  const faded = dimmed && !hovered;
  const has = query.trim() !== '';
  // Ширина окна адаптивна под число найденных колонок (карточка ≈168px): 2/3/4/5…
  // Сверх лимита (≈5–6 карточек) — горизонтальная прокрутка списка карточек.
  const panelWidth =
    has && groups.length > 0 ? Math.max(300, Math.min(900, groups.length * 168 + 16)) : 300;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Поиск по таблице (⌘F)"
          className={cn(
            'flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] transition-colors',
            open
              ? 'border-accent-clay/60 text-[#0A0A0A]'
              : 'border-black/10 text-[#6B6862] hover:text-[#0A0A0A]',
          )}
        >
          <Search size={13} strokeWidth={1.75} />
          Поиск
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          // Не закрывать при работе с таблицей (клик/правка) — закрытие по ✕ / Esc / кнопке.
          onInteractOutside={(e) => e.preventDefault()}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ width: panelWidth, opacity: faded ? 0.4 : 1 }}
          className="z-30 flex max-h-[60vh] max-w-[88vw] flex-col rounded-xl border-2 border-accent-clay/45 bg-bg-elevated text-text-secondary shadow-[0_10px_32px_rgba(0,0,0,0.5)] transition-opacity duration-150"
        >
          {/* Поле ввода + счётчик + закрытие. */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle/60 px-3 py-2">
            <Search size={14} strokeWidth={1.75} className="shrink-0 text-accent-clay" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={replaceOpen ? 'Что меняем (найти)…' : 'Поиск'}
              className="w-full bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
            />
            {has && (
              <span className="shrink-0 text-[12px] tabular-nums text-text-muted/70">{totalMatches}</span>
            )}
            <button
              type="button"
              onClick={() => setReplaceOpen((o) => !o)}
              title="Заменить найденное"
              className={cn(
                'shrink-0 rounded-md border px-1.5 py-0.5 text-[12px] transition-colors',
                replaceOpen
                  ? 'border-accent-clay/60 text-accent-clay'
                  : 'border-border-subtle text-text-secondary hover:text-text-strong',
              )}
            >
              Заменить
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="shrink-0 rounded p-0.5 text-text-muted/70 transition-colors hover:text-text-strong"
              title="Закрыть (Esc)"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>

          {/* Замена: строка «что меняем» — это поле поиска выше; здесь «на что» + кнопка
              с числом найденного; ниже — подтверждение результата. Целиком, отменяемо ⌘Z. */}
          {replaceOpen && (
            <>
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle/60 px-3 py-2">
                <input
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="На что меняем…"
                  className="w-full bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
                />
                <button
                  type="button"
                  onClick={() => onReplace(replaceText)}
                  disabled={!has || totalMatches === 0}
                  className="shrink-0 rounded-md border border-accent-clay/40 px-2 py-0.5 text-[12px] text-accent-clay transition-colors hover:bg-accent-clay/15 disabled:opacity-40"
                >
                  Заменить{totalMatches > 0 ? ` ${totalMatches}` : ''}
                </button>
              </div>
              {replaceResult !== null && (
                <div className="shrink-0 border-b border-border-subtle/60 px-3 py-1.5 text-[12px] text-accent-clay">
                  {replaceResult > 0 ? `✓ Заменено: ${replaceResult}` : 'Ничего не подошло'}
                </div>
              )}
            </>
          )}

          {/* Результаты — карточки колонок В РЯД (горизонтальная прокрутка при избытке). */}
          <div className="min-h-0 flex-1">
            {!has ? (
              <div className="px-3 py-3 text-[12px] leading-relaxed text-text-muted/75">
                <p className="mb-1.5">
                  Ищу <span className="text-text-secondary">точно</span>:{' '}
                  <code className={CODE}>42</code> — найду ровно «42».
                </p>
                <p className="mb-1">
                  Добавь <code className={CODE}>*</code> — и поймаю больше:
                </p>
                <ul className="space-y-1">
                  <li>
                    <code className={CODE}>42*</code> — начинается на 42
                  </li>
                  <li>
                    <code className={CODE}>*42</code> — заканчивается на 42
                  </li>
                  <li>
                    <code className={CODE}>*42*</code> — встречается где угодно
                  </li>
                </ul>
              </div>
            ) : groups.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-text-muted/60">Ничего не найдено</div>
            ) : (
              <div className="flex gap-2 overflow-x-auto p-2">
                {groups.map((g) => (
                  <div
                    key={g.colIndex}
                    className="flex w-40 shrink-0 flex-col rounded-lg border border-border-subtle/60"
                  >
                    {/* Заголовок карточки = колонка + число совпадений. */}
                    <div className="flex shrink-0 items-center justify-between border-b border-border-subtle/50 px-2 py-1 text-[12px]">
                      <span className="truncate font-medium text-text-secondary">{g.title}</span>
                      <span className="shrink-0 tabular-nums text-text-muted/70">{g.total}</span>
                    </div>
                    {/* Совпадения колонки — вертикальная прокрутка, если их много. */}
                    <div className="max-h-44 overflow-y-auto p-1">
                      {g.matches.map((m) => {
                        const isActive = active?.colIndex === g.colIndex && active.id === m.id;
                        return (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => onGoTo(g.colIndex, m.id)}
                            className={cn(
                              // Без стрелки — клик и так сразу перелетает к ячейке.
                              'w-full truncate rounded px-1.5 py-1 text-left text-[12px] transition-colors',
                              isActive
                                ? 'bg-accent-clay/25 text-text-strong'
                                : 'text-text-primary hover:bg-accent-clay/20',
                            )}
                          >
                            {m.value === '' ? '(пусто)' : m.value}
                          </button>
                        );
                      })}
                      {g.total > g.matches.length && (
                        <div className="px-1.5 py-1 text-[11px] text-text-muted/60">
                          …ещё {g.total - g.matches.length}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
