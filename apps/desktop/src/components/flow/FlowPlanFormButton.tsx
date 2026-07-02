import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarPlus, RefreshCw } from 'lucide-react';
import { flowDeliveriesGet, flowPlanForm, flowWorkflowGet } from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * «Сформировать план» (этап План): собрать строки формирования с выбранной датой
 * DAY → черновые поставки (группировка отправитель+получатель+уровень на сервере).
 *
 * Выбор даты — список ДОСТУПНЫХ дат из колонки DAY формирования (с числом строк):
 * прошлое не показываем (в DAY его и не выбрать), будущий год дописывается.
 * Результат прилетает в грид плана реалтаймом (`flow_deliveries_changed`).
 */
export function FlowPlanFormButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState<{ date: string; count: number }[] | null>(null);
  const [msg, setMsg] = useState('');

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  /** Даты из колонки DAY формирования (сколько строк ждёт каждую дату).
   *  Частичная отгрузка (юзер 2026-06-16): позицию считаем, пока есть ОСТАТОК
   *  (кол-во выгрузки − Σ открытых поставок > 0); полностью покрытую планом — нет.
   *  Перенос (В1, юзер 2026-07-02): OFF-якорь с висящим переносом считается на дату
   *  переноса (из статуса «перенос на другой день: дата» эпизода отчёта). */
  const loadDates = (): void => {
    setDates(null);
    setMsg('');
    void Promise.all([flowWorkflowGet(api), flowDeliveriesGet(api)])
      .then(([rows, dlv]) => {
        // Σ кол-ва ОТКРЫТЫХ поставок по якорю (occupies: без факта и не увезли/не увезли).
        const openByAnchor = new Map<string, number>();
        const transferByAnchor = new Map<string, string>(); // якорь → дата висящего переноса
        for (const d of dlv) {
          const done = String(d.done_stat ?? '');
          if (done === 'не увезли') {
            const m = /^перенос на другой день: (\d{4}-\d{2}-\d{2})/.exec(String(d.fail_reason ?? '').trim());
            if (m && m[1]) transferByAnchor.set(`${d.ord}|${d.it}`, m[1]);
          }
          if (d.fact_qty != null || done === 'увезли' || done === 'не увезли') continue;
          const k = `${d.ord}|${d.it}`;
          openByAnchor.set(k, (openByAnchor.get(k) ?? 0) + (Number(d.qty) || 0));
        }
        const byDate = new Map<string, number>();
        for (const r of rows) {
          let d = (r.day_wk || '').trim();
          // OFF-якорь с переносом → считаем на дату переноса (строка видна в Формировании).
          if (d.toUpperCase() === 'OFF') d = transferByAnchor.get(`${r.ord}|${r.it}`) ?? '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          const open = openByAnchor.get(`${r.ord}|${r.it}`) ?? 0;
          if (open > 0) {
            const q = Number(r.qty);
            if (!Number.isFinite(q) || q - open <= 1e-6) continue; // покрыта планом целиком
          }
          byDate.set(d, (byDate.get(d) ?? 0) + 1);
        }
        const list = [...byDate.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setDates(list);
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
    void flowPlanForm(api, date)
      .then((r) => {
        const parts = [`+${r.created} строк`, `${r.groups} поставок`];
        if (r.skippedActive > 0) parts.push(`${r.skippedActive} уже в плане`);
        if (r.noKey > 0) parts.push(`${r.noKey} без ключа`);
        setMsg(`План на ${fmtDateRu(date)}: ${parts.join(' · ')}`);
        setOpen(false);
      })
      .catch((e) => {
        const t = e instanceof Error ? e.message : String(e);
        setMsg(
          t.includes('date_in_past')
            ? 'Прошлую дату выбрать нельзя'
            : `Ошибка: ${t.slice(0, 80)}`,
        );
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
            title="Собрать черновые поставки из строк формирования с выбранной датой DAY"
            className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:opacity-50"
          >
            {busy ? (
              <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <CalendarPlus size={13} strokeWidth={1.75} />
            )}
            Сформировать план
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="no-drag-region z-50 w-[260px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
          >
            <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/70">
              Даты из колонки DAY
            </div>
            {dates === null && <div className="px-1 py-2 text-[12px] text-text-muted">Загрузка…</div>}
            {dates !== null && dates.length === 0 && (
              <div className="px-1 py-2 text-[12px] text-text-muted">
                В формировании нет строк с выбранной датой — проставьте DAY.
              </div>
            )}
            {dates !== null && dates.length > 0 && (
              <div className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
                {dates.map(({ date, count }) => {
                  const past = date < todayIso;
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={past || busy}
                      onClick={() => run(date)}
                      title={past ? 'Прошлая дата — план не собирается' : `Собрать план на ${fmtDateRu(date)}`}
                      className={cn(
                        'flex items-center justify-between rounded-md px-2 py-1 text-[12px] transition-colors',
                        past
                          ? 'cursor-default text-text-muted/40'
                          : 'text-text-secondary hover:bg-bg-deep hover:text-text-strong',
                      )}
                    >
                      <span>{fmtDateRu(date)}</span>
                      <span className="tabular-nums text-text-muted/70">{count}</span>
                    </button>
                  );
                })}
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
