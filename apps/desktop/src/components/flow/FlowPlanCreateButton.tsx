import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Factory, RefreshCw } from 'lucide-react';
import {
  flowDeliveriesGet,
  flowPlanRowsApply,
  getMacroBundle,
  parsePlanPasteTsv,
  releaseSheetLock,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { reportClientError } from '@/lib/error-report';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * «Создание поставок» (В2, юзер 2026-07-02) — флоу-нативный запуск SAP-макроса
 * VL10D по ЧЕРНОВИКАМ Плана выбранной даты (созданы «Сформировать план»):
 *  1) программа сама собирает входной файл (заказ ⭾ позиция ⭾ номенклатура,
 *     ANSI/1251 — SAP иначе даёт ошибки) — раньше юзер копировал колонки руками;
 *  2) сервер выдаёт VBS (server-tunable — правки скрипта без пересборки приложения);
 *  3) VL10D создаёт поставки → ZM_VL grid → TSV «до AL» → номера ложатся на
 *     черновики (flow_plan_rows_apply), результат виден в Плане реалтаймом.
 * Google-путь (wf_plan) не задет. Только Windows (нужен SAP). Пароль — как у wf_plan.
 */
export function FlowPlanCreateButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [dates, setDates] = useState<{ date: string; count: number }[] | null>(null);
  const [msg, setMsg] = useState('');

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  /** Даты, где есть черновики БЕЗ номера поставки (им и создаём поставки в SAP). */
  const loadDates = (): void => {
    setDates(null);
    setMsg('');
    void flowDeliveriesGet(api)
      .then((dlv) => {
        const byDate = new Map<string, number>();
        for (const d of dlv) {
          if (Number(d.fixation_id) !== 0 || Number(d.reserved) === 1) continue;
          if ((d.dlv || '').trim()) continue; // номер уже есть
          if (!(d.ord || '').trim()) continue; // без ключа макрос не берёт
          const day = (d.plan_date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          byDate.set(day, (byDate.get(day) ?? 0) + 1);
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

  const run = async (date: string): Promise<void> => {
    if (busy) return;
    if (window.pyn?.platform !== 'win32') {
      setMsg('Только на Windows (нужен SAP)');
      return;
    }
    if (!password.trim()) {
      setMsg('Введите пароль');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      // 1) Входной файл из черновиков даты: первый столбец заказ, второй позиция,
      //    последний номенклатура (ровно как ждал старый макрос из буфера).
      const dlv = await flowDeliveriesGet(api);
      const drafts = dlv.filter(
        (d) =>
          Number(d.fixation_id) === 0 &&
          Number(d.reserved) !== 1 &&
          !(d.dlv || '').trim() &&
          (d.ord || '').trim() &&
          (d.plan_date || '').slice(0, 10) === date,
      );
      if (drafts.length === 0) {
        setMsg('На эту дату нет черновиков без номера поставки');
        return;
      }
      const content = drafts.map((d) => `${(d.ord || '').trim()}\t${(d.it || '').trim()}\t${(d.no_num || '').trim()}`).join('\r\n');

      // 2) VBS с сервера (пароль проверяет сервер).
      const bundle = await getMacroBundle(api, {
        actionId: 'flow_plan_create',
        password: password.trim(),
        tabName: 'ZM_VL',
        actionLabel: 'Создание поставок',
      });
      if (!bundle.ok) {
        setMsg(bundle.error === 'wrong_password' ? 'Неверный пароль' : `Макрос: ${bundle.error}`);
        return;
      }

      // 3) SAP: VL10D создание → ZM_VL grid → TSV.
      const vbs = await window.pyn?.macro?.runVbs(bundle.bundle.vbsSource, {
        inputFiles: [{
          envName: 'OTL_FLOW_PLANFORM_FILE',
          filename: `flow-planform-${date}.txt`,
          content,
          encoding: 'win1251',
        }],
      });
      if (!vbs || !vbs.ok || vbs.tsv == null) {
        setMsg(`SAP/VBS: ${vbs?.error ?? 'ошибка'}`);
        return;
      }

      // 4) Результат «до AL» → номера на черновики + новые строки Плана.
      const rows = parsePlanPasteTsv(vbs.tsv);
      if (rows.length === 0) {
        setMsg('SAP вернул пустой результат — поставки не созданы?');
        return;
      }
      const r = await flowPlanRowsApply(api, rows, { planDate: date, source: 'macro' });
      setMsg(`Создание поставок: ${r.received} строк · ${r.assigned} номеров на черновики · ${r.inserted} нов · ${r.updated} обновл`);
      setOpen(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      reportClientError('flow_plan_create', m, { stack: e instanceof Error ? e.stack : undefined, context: 'Создание поставок' });
      setMsg(`Ошибка: ${m.slice(0, 100)}`);
    } finally {
      await releaseSheetLock(api, 'flow_plan_create').catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="no-drag-region max-w-[320px] truncate text-[11px] text-text-muted/80" title={msg}>
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
            title="Создать поставки в SAP по черновикам Плана выбранной даты (VL10D)"
            className="no-drag-region flex h-6 items-center gap-1.5 rounded-md border border-border-subtle px-2 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-default hover:text-text-strong disabled:opacity-50"
          >
            {busy ? (
              <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Factory size={13} strokeWidth={1.75} />
            )}
            Создание поставок
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="no-drag-region z-50 w-[280px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
          >
            <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/70">
              Черновики без номера поставки
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="off"
              className="mb-1.5 h-7 w-full rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-strong outline-none placeholder:text-text-muted/50 focus:border-accent-clay/60"
            />
            {dates === null && <div className="px-1 py-2 text-[12px] text-text-muted">Загрузка…</div>}
            {dates !== null && dates.length === 0 && (
              <div className="px-1 py-2 text-[12px] text-text-muted">
                Нет черновиков без номера — сначала «Сформировать план».
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
                      disabled={busy}
                      onClick={() => void run(date)}
                      title={past ? 'Прошлая дата — поставки обычно не создаются, но черновики остались' : `Создать поставки на ${fmtDateRu(date)}`}
                      className={cn(
                        'flex items-center justify-between rounded-md px-2 py-1 text-[12px] transition-colors',
                        past ? 'text-text-muted/60 hover:bg-bg-deep' : 'text-text-secondary hover:bg-bg-deep hover:text-text-strong',
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
