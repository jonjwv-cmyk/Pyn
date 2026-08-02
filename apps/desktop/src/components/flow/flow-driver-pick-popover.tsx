/**
 * Поиск/выбор водителя — как FlowDriverEditor в Glide, UI popover для Tabulator.
 * Вверху строка поиска; ниже карточки кандидатов.
 */

import { useMemo, useState } from 'react';
import { Phone } from 'lucide-react';
import { formatMobilePhone } from '@/lib/mol-format';

export interface DriverPickOption {
  fio: string;
  phone: string;
  color: string;
  isMol: boolean;
  position?: string;
}

export function FlowDriverPickPopover({
  options,
  current,
  onPick,
  onClose,
}: {
  options: readonly DriverPickOption[];
  current: string;
  onPick: (o: DriverPickOption) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const base = !q
      ? options
      : options.filter((d) => {
          const byFio = d.fio.toLowerCase().includes(q);
          const byPhone = digits.length >= 3 && d.phone.replace(/\D/g, '').includes(digits);
          const byPos = (d.position || '').toLowerCase().includes(q);
          return byFio || byPhone || byPos;
        });
    const cur = current.trim().toUpperCase();
    return [...base]
      .sort((a, b) => (b.fio.toUpperCase() === cur ? 1 : 0) - (a.fio.toUpperCase() === cur ? 1 : 0) || a.fio.localeCompare(b.fio, 'ru'))
      .slice(0, 50);
  }, [options, query, current]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />
      <div className="fixed left-1/2 top-[18%] z-50 flex max-h-[min(420px,70vh)] w-[320px] -translate-x-1/2 flex-col rounded-xl border border-border-subtle bg-bg-elevated p-2.5 shadow-2xl">
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
            } else if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              onPick(matches[0]!);
            }
          }}
          className="mb-2 h-9 w-full shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted/55 focus:border-accent-clay/55"
        />
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {matches.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-text-muted">
              {query.trim() ? 'Не найдено' : 'Нет водителей в базе'}
            </div>
          ) : (
            matches.map((o) => {
              const selected = o.fio === current;
              const phoneDisp = o.phone ? formatMobilePhone(o.phone) : '';
              return (
                <button
                  key={o.fio}
                  type="button"
                  onClick={() => onPick(o)}
                  className={[
                    'rounded-lg border px-2.5 py-2 text-left transition-colors',
                    selected
                      ? 'border-accent-clay/40 bg-accent-clay/15'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                  ].join(' ')}
                >
                  <div className="text-[12.5px] font-medium leading-snug" style={{ color: o.color || undefined }}>
                    {o.fio}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                    {phoneDisp && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone size={11} strokeWidth={1.75} />
                        {phoneDisp}
                      </span>
                    )}
                    {o.isMol && (
                      <span className="rounded-md bg-accent-clay/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-clay ring-1 ring-accent-clay/30">
                        МОЛ
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
