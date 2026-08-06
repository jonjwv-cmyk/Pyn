// ============================================================
// flow-tab-facet.tsx — секция-фасет боковой панели фильтров Tabulator-гридов Потока.
// ============================================================
// Вынесено из flow-tabulator-transport.tsx (2026-08-06): тот же список значений с
// галочками и счётчиками нужен Транспорту и Формированию — держим ОДИН источник,
// а не копию на грид.
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/** Секция-фасет: заголовок сворачивает список; галочки в стиле pyn-tick (не native checkbox). */
export function FacetSection({
  title,
  options,
  counts,
  selected,
  open,
  onToggleOpen,
  onToggleValue,
}: {
  title: string;
  options: readonly string[];
  counts: Record<string, number>;
  selected: ReadonlySet<string>;
  open: boolean;
  onToggleOpen: () => void;
  onToggleValue: (value: string, only?: boolean) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="flow-tab-facet border-t pt-2 first:border-t-0 first:pt-0">
      <button type="button" onClick={onToggleOpen} className="flex w-full items-center justify-between py-1 text-left">
        <span className="text-[12px] font-medium">{title}</span>
        <span className="flex items-center gap-1">
          {selected.size > 0 && <span className="flow-tab-facet-badge rounded px-1 text-[10px]">{selected.size}</span>}
          {open ? <ChevronUp size={13} className="opacity-50" /> : <ChevronDown size={13} className="opacity-50" />}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pb-1 pt-1">
          {options.length > 4 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="flow-tab-facet-search rounded-md px-2 py-1 text-[11.5px] outline-none"
            />
          )}
          <div className="flow-tab-facet-list overflow-hidden rounded-md border">
            {filtered.map((opt, i) => {
              const on = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onToggleValue(opt)}
                  className={`group flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] ${
                    i !== filtered.length - 1 ? 'border-b' : ''
                  } ${on ? 'flow-tab-facet-item--on' : ''}`}
                >
                  <span className={`pyn-tick ${on ? 'pyn-tick--on' : 'pyn-tick--off'}`} aria-hidden>
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{opt || '—'}</span>
                  <span className="font-mono text-[10.5px] opacity-50 group-hover:hidden">{counts[opt] ?? 0}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleValue(opt, true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleValue(opt, true);
                      }
                    }}
                    className="hidden text-[10.5px] opacity-60 hover:opacity-100 group-hover:block"
                  >
                    только
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-2 py-1.5 text-[11px] opacity-50">Нет значений</div>}
          </div>
        </div>
      )}
    </div>
  );
}
