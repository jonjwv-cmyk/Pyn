import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Lock, RefreshCw } from 'lucide-react';
import { flowDeliveriesGet, flowPlanFix } from '@pyn/core';
import { api } from '@/lib/api';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * «Зафиксировать» (ТЗ §3.6): замораживает состав плана на день. Первая фиксация
 * даты = «план» (батч 1), повторные = «дополнение» (2+). После фиксации свободны
 * только машина/экспедиторы/ID + отметки отчёта; строки появляются в Отчёте.
 */
export function FlowPlanFixButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState<{ date: string; count: number }[] | null>(null);
  const [msg, setMsg] = useState('');

  const loadDates = (): void => {
    setDates(null);
    setMsg('');
    void flowDeliveriesGet(api)
      .then((rows) => {
        const byDate = new Map<string, number>();
        for (const r of rows) {
          if (Number(r.fixation_id) > 0) continue; // уже зафиксированы
          const d = (r.plan_date || '').trim();
          if (d) byDate.set(d, (byDate.get(d) ?? 0) + 1);
        }
        setDates(
          [...byDate.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        );
      })
      .catch((e) => {
        setDates([]);
        setMsg(`Ошибка: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      });
  };

  const run = (date: string): void => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    void flowPlanFix(api, date)
      .then((r) => {
        setMsg(
          r.batchSeq === 1
            ? `План на ${fmtDateRu(date)} зафиксирован: ${r.fixed} строк`
            : `Дополнение ${r.batchSeq} на ${fmtDateRu(date)}: ${r.fixed} строк`,
        );
        setOpen(false);
      })
      .catch((e) => {
        const t = e instanceof Error ? e.message : String(e);
        setMsg(t.includes('nothing_to_fix') ? 'На этой дате нечего фиксировать' : `Ошибка: ${t.slice(0, 80)}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="no-drag-region max-w-[300px] truncate text-[11px] text-text-muted/80" title={msg}>
          {msg}
        </span>
      )}
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) loadDates();
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={busy}
            title="Зафиксировать состав плана на день (повторно = дополнение)"
            className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:opacity-50"
          >
            {busy ? (
              <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Lock size={13} strokeWidth={1.75} />
            )}
            Зафиксировать
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="no-drag-region z-50 w-[260px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
          >
            <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/70">
              Незафиксированные дни
            </div>
            {dates === null && <div className="px-1 py-2 text-[12px] text-text-muted">Загрузка…</div>}
            {dates !== null && dates.length === 0 && (
              <div className="px-1 py-2 text-[12px] text-text-muted">Всё зафиксировано — нечего замораживать.</div>
            )}
            {dates !== null && dates.length > 0 && (
              <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
                {dates.map(({ date, count }) => (
                  <button
                    key={date}
                    type="button"
                    disabled={busy}
                    onClick={() => run(date)}
                    title={`Заморозить состав на ${fmtDateRu(date)}`}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-deep hover:text-text-strong"
                  >
                    <span>{fmtDateRu(date)}</span>
                    <span className="tabular-nums text-text-muted/70">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** YYYY-MM-DD → «12 июня» (+ год, если не текущий). */
function fmtDateRu(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const year = Number(m[1]);
  const base = `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
  return year === new Date().getFullYear() ? base : `${base} ${year}`;
}
