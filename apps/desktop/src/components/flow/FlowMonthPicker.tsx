import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronDown, Loader2, Lock } from 'lucide-react';
import { ApiError, flowPlanMonthSet, scheduleMonthsList, type FlowPlanMonth } from '@pyn/core';
import { api } from '@/lib/api';
import { useUsersStore } from '@/lib/stores';
import { Avatar } from '@/components/ui/Avatar';
import { useFormatYek } from '@/lib/hooks/use-format-yek';
import { useScheduleMonthsMeta, monthKey } from '@/lib/schedule/use-schedule-sync';
import { MONTH_NAMES_RU } from '@/lib/schedule/compute';

interface FlowMonthPickerProps {
  /** Текущий выбранный месяц формирования (общий, с сервера). */
  year: number;
  month: number;
  /** Кто выбрал месяц (для аватара). Пусто — месяц по умолчанию (не выбирали). */
  info: { updatedBy: string; updatedByName: string; updatedAt: string };
  /** Сервер подтвердил смену — применить сразу (WS обновит остальных). */
  onChanged: (p: FlowPlanMonth) => void;
}

type MonthStatus = 'past' | 'not-formed' | 'ok' | 'loading';

/** Текст ошибки сервера при смене месяца → человекочитаемо. */
function setErrorText(code: string, label: string): string {
  switch (code) {
    case 'wrong_password':
      return 'Неверный пароль';
    case 'month_in_past':
      return 'Прошлый месяц выбрать нельзя';
    case 'schedule_not_formed':
      return `График для ${label} не сформирован`;
    default:
      return 'Не удалось сменить месяц';
  }
}

/**
 * Выбор МЕСЯЦА ФОРМИРОВАНИЯ раздела «Поток» (общий для всех, сервер помнит).
 * По нему считается CLST. Рядом с кнопкой — аватар того, кто выбрал месяц.
 * Смена под паролем (как «скрипты», 01012). Нельзя выбрать прошлый месяц и
 * месяц, где в графике не заданы «дни без доставки» (правило раздела Цеха) —
 * по нему показываем «График для … не сформирован».
 */
export function FlowMonthPicker({ year, month, info, onChanged }: FlowMonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'pick' | 'password'>('pick');
  const [pending, setPending] = useState<{ year: number; month: number } | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notFormed, setNotFormed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const years = useMemo(() => [curY, curY + 1], [curY]);

  // Аватар выбравшего месяц — из общего справочника пользователей.
  const users = useUsersStore((s) => s.users);
  const chooser = useMemo(
    () => (info.updatedBy ? users.find((u) => u.login === info.updatedBy) : undefined),
    [users, info.updatedBy],
  );
  const chosenAt = useFormatYek(info.updatedAt || undefined);

  // Какие месяцы вообще ЕСТЬ в графике (есть запись schedule_state) — один запрос на
  // открытие (кэшируем в state). Месяца НЕ из списка точно не сформированы (графика
  // нет) → недоступны без отдельных запросов. Это и закрывает баг «можно выбрать
  // декабрь 2026 / 2027» — их в графике просто нет.
  const [monthsExist, setMonthsExist] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!open || monthsExist) return;
    let alive = true;
    void scheduleMonthsList(api)
      .then((list) => {
        if (alive) setMonthsExist(new Set(list.map((m) => `${m.year}-${m.month}`)));
      })
      .catch(() => {
        if (alive) setMonthsExist(new Set());
      });
    return () => {
      alive = false;
    };
  }, [open, monthsExist]);

  // Мета (holidays) ТОЛЬКО для существующих не-прошлых месяцев — их единицы. Месяц
  // без «дней без доставки» (holidays пусто) — не сформирован, выбрать нельзя.
  const metaMonths = useMemo(() => {
    if (!open || !monthsExist) return [];
    const out: { year: number; month: number }[] = [];
    for (const y of years) {
      for (let m = 1; m <= 12; m++) {
        if ((y > curY || m >= curM) && monthsExist.has(`${y}-${m}`)) out.push({ year: y, month: m });
      }
    }
    return out;
  }, [open, monthsExist, years, curY, curM]);
  const metaMap = useScheduleMonthsMeta(metaMonths);

  // Сброс при закрытии/открытии — всегда стартуем со стадии выбора.
  useEffect(() => {
    if (!open) {
      setStage('pick');
      setPending(null);
      setPassword('');
      setError(null);
      setNotFormed(null);
      setBusy(false);
    }
  }, [open]);

  // Автофокус на поле пароля при переходе к нему.
  useEffect(() => {
    if (stage === 'password') {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [stage]);

  const monthStatus = (y: number, m: number): MonthStatus => {
    if (y < curY || (y === curY && m < curM)) return 'past';
    if (!monthsExist) return 'loading'; // список месяцев ещё грузится
    if (!monthsExist.has(`${y}-${m}`)) return 'not-formed'; // графика на месяц нет вообще
    const meta = metaMap.get(monthKey(y, m));
    if (!meta) return 'loading'; // holidays ещё грузятся
    return meta.exists && meta.holidays.length > 0 ? 'ok' : 'not-formed';
  };

  const monthFullLabel = (y: number, m: number) => `${MONTH_NAMES_RU[m - 1]} ${y}`;

  const handlePick = (y: number, m: number) => {
    const st = monthStatus(y, m);
    if (st === 'past' || st === 'loading') return; // прошлый / ещё грузится — ждём
    if (st === 'not-formed') {
      setNotFormed(monthFullLabel(y, m));
      return;
    }
    setNotFormed(null);
    setError(null);
    setPending({ year: y, month: m });
    setPassword('');
    setStage('password');
  };

  const submit = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await flowPlanMonthSet(api, {
        year: pending.year,
        month: pending.month,
        password: password.trim(),
      });
      onChanged(result); // сервер подтвердил — применяем сразу, WS догонит остальных
      setOpen(false);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      setError(setErrorText(code, monthFullLabel(pending.year, pending.month)));
      // Несформированный месяц мог пройти как 'loading' — вернёмся к выбору с пометкой.
      if (code === 'schedule_not_formed') {
        setNotFormed(monthFullLabel(pending.year, pending.month));
        setStage('pick');
      }
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={
            chooser
              ? `Месяц формирования выбрал(а): ${info.updatedByName || chooser.fullName}${chosenAt ? ` · ${chosenAt}` : ''}`
              : 'Месяц формирования — по нему считается CLST'
          }
          className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 pl-2 pr-1.5 text-[12px] tabular-nums text-[#6B6862] outline-none transition-colors hover:text-[#0A0A0A] data-[state=open]:text-[#0A0A0A]"
        >
          <CalendarDays size={13} strokeWidth={1.75} />
          <span>
            {MONTH_NAMES_RU[month - 1]} {year}
          </span>
          {chooser ? (
            <Avatar
              initials={chooser.initials}
              size={16}
              login={chooser.login}
              avatarUrl={chooser.avatarUrl}
              avatarBlobKey={chooser.avatarBlobKey}
              avatarBlobNonce={chooser.avatarBlobNonce}
              className="ml-0.5"
            />
          ) : (
            <ChevronDown size={12} className="text-text-muted" strokeWidth={1.75} />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-30 w-[236px] rounded-lg border border-white/[0.08] bg-bg-elevated p-2.5 text-text-primary shadow-2xl outline-none"
        >
          {stage === 'pick' ? (
            <>
              {/* Месяцы — 3 колонки × 4 строки (как в Графике), по году, с гейтом
                  доступности: прошлые нельзя, несформированные (без «дней без
                  доставки») помечены и при клике дают уведомление. */}
              {years.map((y) => (
                <div key={y} className="mb-1.5 last:mb-0">
                  <div
                    className={[
                      'mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider tabular-nums',
                      y === year ? 'text-accent-clay' : 'text-text-muted/70',
                    ].join(' ')}
                  >
                    {y}
                  </div>
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
                      gridAutoFlow: 'column',
                    }}
                  >
                    {MONTH_NAMES_RU.map((name, idx) => {
                      const m = idx + 1;
                      const st = monthStatus(y, m);
                      const selected = y === year && m === month;
                      const isCurrent = y === curY && m === curM; // текущий месяц «сейчас»
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={st === 'past'}
                          onClick={() => handlePick(y, m)}
                          title={
                            isCurrent
                              ? 'Текущий месяц'
                              : st === 'past'
                                ? 'Прошлый месяц выбрать нельзя'
                                : st === 'not-formed'
                                  ? 'График не сформирован (нет «дней без доставки»)'
                                  : undefined
                          }
                          className={[
                            'relative h-7 rounded text-[11.5px] outline-none transition-colors',
                            selected
                              ? 'bg-accent-clay-bg font-semibold text-accent-clay ring-1 ring-inset ring-accent-clay/40'
                              : st === 'past'
                                ? 'cursor-not-allowed text-text-muted/25'
                                : st === 'loading'
                                  ? 'cursor-default text-text-muted/40'
                                  : st === 'not-formed'
                                    ? 'text-amber-400/70 hover:bg-white/[0.05] hover:text-amber-300'
                                    : 'text-text-primary hover:bg-white/[0.06] hover:text-text-strong',
                          ].join(' ')}
                        >
                          {name.slice(0, 3)}
                          {/* Текущий месяц — полоска-индикатор снизу (как активная вкладка). */}
                          {isCurrent && (
                            <span className="absolute bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-accent-clay/80" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {notFormed && (
                <div className="mt-1.5 rounded-md border border-amber-400/25 bg-amber-400/[0.08] px-2 py-1.5 text-[11px] leading-snug text-amber-300/90">
                  График для {notFormed} не сформирован — сначала задайте «дни без
                  доставки» в разделе График.
                </div>
              )}
            </>
          ) : (
            // Стадия пароля — смена общего месяца защищена паролем (как «скрипты»).
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-text-strong">
                <Lock size={12} strokeWidth={2} className="text-accent-clay" />
                Месяц формирования
              </div>
              <div className="text-[11px] leading-snug text-text-muted">
                {pending ? monthFullLabel(pending.year, pending.month) : ''} — для смены
                введите пароль.
              </div>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setStage('pick');
                  }
                }}
                placeholder="Пароль"
                autoComplete="off"
                className="h-8 rounded-md border border-white/[0.1] bg-black/20 px-2.5 text-[12px] text-text-strong outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent-clay/50"
              />
              {error && <div className="text-[11px] text-danger">{error}</div>}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStage('pick')}
                  className="h-7 rounded-md px-2 text-[12px] text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy || password.trim() === ''}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-accent-clay px-3 text-[12px] font-medium text-white outline-none transition-colors hover:bg-accent-clay/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy && <Loader2 size={12} className="animate-spin" strokeWidth={2} />}
                  Сменить
                </button>
              </div>
            </div>
          )}

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
