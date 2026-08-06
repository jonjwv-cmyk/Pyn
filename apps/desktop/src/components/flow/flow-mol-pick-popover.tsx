/**
 * Выбор МОЛ — UI 1:1 с FlowDriverPickPopover (Транспорт).
 * Без запроса: только МОЛы склада-получателя.
 * С поиском: вся база + «Вписать …» (осознанно чужой / произвольный текст).
 */
import { useMemo, useState } from 'react';
import { Phone } from 'lucide-react';
import { formatMobilePhone } from '@/lib/mol-format';

/** ФИО в списке — ВЕРХНИЙ РЕГИСТР (как в таблице Формирования). */
function molFioUpper(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('ru-RU');
}

export interface MolPickOption {
  fio: string;
  phone: string;
  /** Цвет ФИО: зелёный работает / красноватый прочее / серый неизвестен. */
  color: string;
  status: string;
  until?: string;
  onWarehouse?: boolean;
}

export function FlowMolPickPopover({
  warehouseOptions,
  searchOptions,
  current,
  onPick,
  onFree,
  onClear,
  onClose,
}: {
  /** МОЛы только этого склада — список по умолчанию. */
  warehouseOptions: readonly MolPickOption[];
  /** Вся база — для поиска. */
  searchOptions: readonly MolPickOption[];
  current: string;
  onPick: (o: MolPickOption, fromWarehouseList: boolean) => void;
  onFree?: (fio: string) => void;
  onClear: () => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const cur = current.trim().toUpperCase();
  const q = query.trim();
  const qLower = q.toLowerCase();
  const searching = qLower.length > 0;

  const matches = useMemo(() => {
    if (!searching) {
      return warehouseOptions.slice(0, 50);
    }
    const digits = qLower.replace(/\D/g, '');
    return searchOptions
      .filter((o) => {
        const byFio = o.fio.toLowerCase().includes(qLower);
        const byPhone = digits.length >= 3 && o.phone.replace(/\D/g, '').includes(digits);
        const byStatus = (o.status || '').toLowerCase().includes(qLower);
        return byFio || byPhone || byStatus;
      })
      .slice(0, 50);
  }, [searching, warehouseOptions, searchOptions, qLower]);

  const exactInSearch = q
    ? searchOptions.some((o) => o.fio.trim().toUpperCase() === q.toUpperCase())
    : false;
  const showFree = Boolean(onFree && searching && !exactInSearch);

  const commitFree = (): void => {
    if (!onFree || !q) return;
    onFree(q);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="pyn-driver-pick fixed left-1/2 top-[18%] z-50 flex max-h-[min(420px,70vh)] w-[320px] -translate-x-1/2 flex-col rounded-xl border border-border-subtle bg-bg-elevated p-2.5 shadow-2xl">
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          placeholder="Поиск: ФИО / телефон"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (matches[0]) onPick(matches[0]!, !searching || Boolean(matches[0]!.onWarehouse));
              else if (showFree) commitFree();
            }
          }}
          className="pyn-driver-pick-input mb-2 h-9 w-full shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent-clay/55"
        />
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {!searching && (
            <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              МОЛ этого склада
            </div>
          )}
          {searching && matches.length > 0 && (
            <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Поиск по базе
            </div>
          )}
          {matches.length === 0 && !showFree ? (
            <div className="px-2 py-3 text-[12px] text-text-muted">
              {searching ? 'Не найдено — можно вписать ФИО' : 'Нет МОЛов на этом складе'}
            </div>
          ) : (
            matches.map((o) => {
              const displayFio = molFioUpper(o.fio);
              const selected = o.fio.trim().toUpperCase() === cur;
              const phoneDisp = o.phone ? formatMobilePhone(o.phone) : '';
              const fromWh = !searching || Boolean(o.onWarehouse);
              return (
                <button
                  key={`${fromWh ? 'wh' : 'all'}:${o.fio}`}
                  type="button"
                  onClick={() => onPick(o, fromWh)}
                  className={[
                    'rounded-lg border px-2.5 py-2 text-left transition-colors',
                    selected
                      ? 'border-accent-clay/40 bg-accent-clay/15'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                  ].join(' ')}
                >
                  <div
                    className="truncate whitespace-nowrap text-[12.5px] font-medium leading-snug"
                    style={{ color: o.color || undefined }}
                    title={displayFio}
                  >
                    {displayFio}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                    {phoneDisp && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone size={11} strokeWidth={1.75} />
                        {phoneDisp}
                      </span>
                    )}
                    {o.status && <span className="truncate">{o.status}</span>}
                    {o.until && <span>по {o.until}</span>}
                  </div>
                </button>
              );
            })
          )}
          {showFree && (
            <button
              type="button"
              onClick={commitFree}
              className="rounded-lg border border-dashed border-white/[0.12] px-2.5 py-2 text-left text-[12.5px] text-text-primary transition-colors hover:border-accent-clay/40 hover:bg-accent-clay/10"
            >
              Вписать «{molFioUpper(q)}»
            </button>
          )}
        </div>
        <div className="mt-2 flex shrink-0 justify-between gap-2 border-t border-white/[0.06] pt-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-white/[0.04] hover:text-text-primary"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:bg-white/[0.04] hover:text-text-primary"
          >
            Закрыть
          </button>
        </div>
      </div>
    </>
  );
}
