import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Factory, RefreshCw } from 'lucide-react';
import {
  flowDeliveriesGet,
  flowPlanForm,
  flowPlanRowsApply,
  getMacroBundle,
  parsePlanPasteTsv,
  releaseSheetLock,
} from '@pyn/core';
import { api } from '@/lib/api';
import { reportClientError } from '@/lib/error-report';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * «Создание поставок» — ОДНО действие на ВЫБРАННЫЙ день Плана (юзер 2026-07-03:
 * «не делим черновик плана и создать поставки — сидим в дне плана, на него и делаем»):
 *  1) «Сформировать план» на день: строки формирования с DAY=день → черновики
 *     (flow_plan_form, идемпотентно — активные позиции не дублируются);
 *  2) программа собирает входной файл из черновиков БЕЗ номера (заказ ⭾ позиция ⭾
 *     номенклатура, ANSI/1251) и гонит SAP-макрос VL10D (VBS с сервера, server-tunable);
 *  3) ZM_VL grid → TSV «до AL» → номера ложатся на черновики (flow_plan_rows_apply),
 *     результат виден в Плане реалтаймом.
 * Прошедший день — кнопка неактивна (только сегодня/будущее). Только Windows (SAP).
 */
export function FlowPlanCreateButton({ selectedDay }: { selectedDay: string | null }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const past = !!selectedDay && selectedDay < todayIso;
  const disabled = busy || !selectedDay || past;

  const run = async (): Promise<void> => {
    const date = selectedDay;
    if (busy || !date) return;
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
      // 1) Черновики дня из формирования (DAY=дата). Повторный запуск не дублирует.
      const formed = await flowPlanForm(api, date);
      // 2) Входной файл из черновиков даты БЕЗ номера поставки: первый столбец заказ,
      //    второй позиция, последний номенклатура (ровно как ждал старый макрос).
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
        setMsg(formed.created > 0
          ? 'Черновики собраны, но без ключа заказа — SAP создавать нечего'
          : 'На этот день нет строк формирования с DAY и нет черновиков без номера');
        return;
      }
      const content = drafts.map((d) => `${(d.ord || '').trim()}\t${(d.it || '').trim()}\t${(d.no_num || '').trim()}`).join('\r\n');

      // 3) VBS с сервера (пароль проверяет сервер).
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

      // 4) SAP: VL10D создание → ZM_VL grid → TSV.
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

      // 5) Результат «до AL» → номера на черновики + новые строки Плана.
      const rows = parsePlanPasteTsv(vbs.tsv);
      if (rows.length === 0) {
        setMsg('SAP вернул пустой результат — поставки не созданы?');
        return;
      }
      const r = await flowPlanRowsApply(api, rows, { planDate: date, source: 'macro' });
      setMsg(`Готово: +${formed.created} черновиков · ${r.assigned} номеров · ${r.inserted} нов · ${r.updated} обновл`);
      setOpen(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      reportClientError('flow_plan_create', m, { stack: e instanceof Error ? e.stack : undefined, context: 'Создание поставок' });
      setMsg(m.includes('date_in_past') ? 'Прошлую дату выбрать нельзя' : `Ошибка: ${m.slice(0, 100)}`);
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
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={
              !selectedDay
                ? 'Выберите день в календаре Плана'
                : past
                  ? 'Прошедший день — поставки не создаются'
                  : `Черновики + поставки SAP на ${fmtDateRu(selectedDay)} одним действием`
            }
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
              План + поставки на {selectedDay ? fmtDateRu(selectedDay) : '—'}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="off"
              className="mb-1.5 h-7 w-full rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-strong outline-none placeholder:text-text-muted/50 focus:border-accent-clay/60"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => void run()}
              className="flex h-7 w-full items-center justify-center rounded-md border border-border-subtle text-[12px] text-text-secondary transition-colors hover:border-border-default hover:text-text-strong disabled:opacity-50"
            >
              {busy ? 'Идёт создание…' : 'Собрать черновики и создать поставки'}
            </button>
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
