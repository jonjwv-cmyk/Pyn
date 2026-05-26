import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { sessionStore } from '@/lib/token-store';
import {
  computeNaturalDays,
  computeRowDates,
  formatDates,
  splitWarehousesByOverrides,
} from '@/lib/schedule/compute';
import { migrateScheduleLocalStorageToServer } from '@/lib/schedule/migrate-localstorage';
import { resetScheduleCache, useScheduleSync } from '@/lib/schedule/use-schedule-sync';
import { LockedEditorContent } from '@/components/schedule/EditorLockedOverlay';
import type {
  ScheduleApproverDate,
  ScheduleCommit,
  ScheduleMeta,
  ScheduleOverrideRule,
  ScheduleShop,
  ScheduleState,
  WarehouseCode,
  Weekday,
} from '@/lib/schedule/types';
import { EvrazLogo } from '@/components/schedule/EvrazLogo';
import { HolidaysCalendar } from '@/components/schedule/HolidaysCalendar';
import { MonthYearPicker } from '@/components/schedule/MonthYearPicker';
import { DatePicker } from './DatePicker';
import { ExceptionsEditor } from './ExceptionsEditor';
import { PersonEditor } from './PersonEditor';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { clusterLabel, weekdayShortLabel } from '@/lib/i18n-labels';

/**
 * Раздел «График» — server-backed редизайн листа «График доставки ТМЦ».
 *
 * Состояние:
 *   • Source of truth — D1 (`schedule_state`), один row per (year, month).
 *   • `useScheduleSync(year, month)` — GET on mount, debounced PUT 500ms,
 *     optimistic concurrency через version, кэш cross-month.
 *   • Cross-instance updates: этап B добавит WS push для real-time видимости
 *     изменений между клиентами.
 *   • Локальный localStorage больше не используется — миграция один раз
 *     перетаскивает старые snapshot'ы и удаляет ключи `pyn:schedule:*`.
 *
 * Управление:
 *   • month/year picker меняет YM → хук подтянет (year, month) с сервера
 *     или наследует от latest prior month (`inheritForNewMonth`).
 *   • Undo / Redo через хук (Cmd+Z / Cmd+Shift+Z).
 *   • Зафиксировать — пишет meta.commit, хук авто-PUT'нет.
 *     UI lock = `!!meta.commit` (этап D добавит серверный commit endpoint
 *     который set'нет колонку `committed=1` для серверной защиты).
 *
 * Визуал: hairline-разделители, day-pills с 7 цветами, КХП-контур /
 * Выезд-fill чипы, ПОДГОТОВИЛ-блок внизу.
 */

const WEEKDAY_TONE: Record<Weekday, string> = {
  ПН: 'mon',
  ВТ: 'tue',
  СР: 'wed',
  ЧТ: 'thu',
  ПТ: 'fri',
  СБ: 'sat',
  ВС: 'sun',
};

/** Дата по умолчанию — сегодня. Используется когда meta.approverDate ещё не задан. */
function todayDate(): ScheduleApproverDate {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/**
 * Дефолт даты подписания: последний день прошлого месяца относительно
 * текущего отображаемого месяца. E.g. если view = май 2026 → 30 апреля 2026.
 * Если юзер задал approverDate вручную через DatePicker — этот fallback
 * не применяется, сохраняется выбранное значение.
 */
function lastDayOfPreviousMonth(year: number, month: number): ScheduleApproverDate {
  // month 1-based. JS new Date(y, m-1, 0) → день 0 текущего месяца = последний
  // день предыдущего. Январь автоматически даёт декабрь предыдущего года.
  const d = new Date(year, month - 1, 0);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

/** Формат: «Май 26, 2026» — месяц локализован, день без leading-zero, год полный. */
function formatApproverDate(
  d: ScheduleApproverDate,
  monthName: (m: number) => string,
): string {
  return `${monthName(d.month)} ${d.day}, ${d.year}`;
}

function formatWarehousesAsText(codes: WarehouseCode[]): string {
  return [...codes]
    .sort((a, b) => a.code.localeCompare(b.code, 'ru', { numeric: true }))
    .map((w) => w.code)
    .join('  ');
}

/** Дефолтные year/month — сегодняшние. Юзер потом меняет через MonthYearPicker. */
function todayYM(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function ProbaScreen() {
  const { t } = useTranslation();

  // ─── Year / month state (input для хука) ─────────────────────────────────
  // Lifted из state.meta наверх: хук получает (year, month) как параметры,
  // возвращает соответствующий ScheduleState. Меняя YM — переключаем месяц.
  const [{ year: currentYear, month: currentMonth }, setYM] = useState(todayYM);

  // ─── Server-sync hook ────────────────────────────────────────────────────
  const sync = useScheduleSync(currentYear, currentMonth);
  const state = sync.state;
  const setState = sync.setState;

  // ─── Lock resource_id'ы для editor popover'ов ─────────────────────────────
  // §TZ-SERVER-SYNC-COLLAB §3.1. Каждый editor получает уникальный ID per-month
  // → юзеры в разных месяцах не блокируют друг друга. Один и тот же editor в
  // одном месяце — только один юзер может править одновременно.
  const ymKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const lockIds = useMemo(() => ({
    exceptions: `schedule:${ymKey}:exceptions`,
    holidays:   `schedule:${ymKey}:holidays`,
    commit:     `schedule:${ymKey}:commit`,
    approver:   `schedule:${ymKey}:approver`,
    deputy:     `schedule:${ymKey}:deputy`,
    date:       `schedule:${ymKey}:date`,
    month:      `schedule:${ymKey}:month`,
  }), [ymKey]);

  // ─── Migration localStorage → server (once) ──────────────────────────────
  // Race с initial GET хука: migration GET'нет null → PUT'нет localStorage data,
  // но hook'овский initial GET мог уже вернуть null и установить INITIAL_SCHEDULE.
  // После migration — сбрасываем cache + reload чтобы подтянуть мигрированные
  // данные с сервера. Если migrated === 0 (нет local archive) → no-op.
  useEffect(() => {
    void migrateScheduleLocalStorageToServer().then((res) => {
      if (res.migrated > 0 || res.conflicts > 0) {
        // eslint-disable-next-line no-console
        console.log('[schedule] migration:', res);
      }
      if (res.migrated > 0) {
        // Cache в хуке держит «pristine» INITIAL_SCHEDULE — сбрасываем чтобы
        // следующий month-switch ре-фетчил с сервера. Текущий month — явный reload.
        resetScheduleCache();
        void sync.reload();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Current user — для commit author label. Грузим один раз на mount.
  const [currentUser, setCurrentUser] = useState<string>('');
  useEffect(() => {
    sessionStore.load().then((s) => {
      if (s?.user) {
        setCurrentUser(s.user.fullName || s.user.login || '');
      }
    }).catch(() => {});
  }, []);

  // commit — irreversible lock текущего месяца. После set'а график read-only.
  // Pre-condition: holidays != []. Хук авто-PUT'нет state с meta.commit.
  // В этапе D добавится отдельный POST /schedule/commit который установит
  // серверный committed=1 для real read-only enforcement (защита от patched
  // клиентов и от случайных PUT'ов из других сессий).
  const commitMonth = useCallback(() => {
    setState((s) => ({
      ...s,
      meta: {
        ...s.meta,
        commit: {
          author: currentUser || 'неизвестно',
          committedAt: new Date().toISOString(),
        },
      },
    }));
  }, [setState, currentUser]);

  const undo = sync.undo;
  const redo = sync.redo;

  // ─── Keyboard: Cmd+Z / Cmd+Shift+Z / Ctrl+Y ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const { meta } = state;

  // shops/shipping/removed для НЕ-зафиксированных месяцев derive'ятся из
  // warehouses store в real-time (Variant A — synced с МОЛ-базой).
  // Любое изменение склада в МОЛ → real-time виден в графике у всех клиентов.
  //
  // Для зафиксированных (committed) месяцев — берём frozen snapshot
  // (state.shops / removedWarehouses / shippingWarehouses), который хук
  // получил с сервера. snapshot не зависит от warehouses store.
  //
  // Past month без commit: derive из current warehouses (compromise — user
  // должен commit'ить чтобы заморозить состояние на дату закрытия месяца).
  const allWarehouses = useWarehousesStore((s) => s.warehouses);

  // График зафиксирован — read-only. Edits в UI заблокированы.
  // В этапе D добавится серверный committed=1 enforcement через
  // /schedule/commit endpoint + 403 month_committed на PUT.
  const isLocked = !!meta.commit;
  /** Frozen snapshot используется только когда month committed. */
  const useArchived = isLocked;

  // Derive cells/rows из store. Группировка: по shop_name → по delivery_day.
  // Исключаем is_removed=1 — такие склады уходят в «Склады удалены».
  //
  // Split по override: если warehouses одной (shop, day) группы имеют разные
  // эффективные дни (из-за override-правила) — группа разбивается на под-
  // строки. Каждая под-строка homogeneous: все склады в ней имеют одни и
  // те же даты доставки. Совпадение (override = natural) → одна строка.
  const shops = useMemo<ScheduleShop[]>(() => {
    if (useArchived) {
      // Archived path: split state.shops по текущим meta.overrides.
      // Снепшот хранит warehouses без split'а, но meta.overrides уже
      // зафиксированы → можем восстановить split детерминированно.
      return state.shops.map((shop) => {
        const rows: ScheduleShop['rows'] = [];
        for (const row of shop.rows) {
          const natural = computeNaturalDays(
            meta.year, meta.month, row.weekday, meta.holidays,
          );
          const groups = splitWarehousesByOverrides(
            row.warehouses, natural, meta.overrides,
          );
          groups.forEach((g, gi) => {
            rows.push({
              id: `${row.id}__g${gi}`,
              weekday: row.weekday,
              warehouses: g,
            });
          });
        }
        return { ...shop, rows };
      });
    }
    const scheduled = allWarehouses.filter(
      (w) => w.in_schedule && w.delivery_day && !w.is_removed,
    );
    const byShop = new Map<string, typeof scheduled>();
    for (const w of scheduled) {
      const arr = byShop.get(w.shop_name) ?? [];
      arr.push(w);
      byShop.set(w.shop_name, arr);
    }
    const shopNames = [...byShop.keys()].sort((a, b) =>
      a.localeCompare(b, 'ru'),
    );
    const dayOrder: Record<string, number> = {
      ПН: 0, ВТ: 1, СР: 2, ЧТ: 3, ПТ: 4, СБ: 5, ВС: 6,
    };
    return shopNames.map((name, i) => {
      const list = byShop.get(name)!;
      const byDay = new Map<string, typeof list>();
      for (const w of list) {
        const day = w.delivery_day!;
        const arr = byDay.get(day) ?? [];
        arr.push(w);
        byDay.set(day, arr);
      }
      const rows: ScheduleShop['rows'] = [];
      for (const [day, wsRaw] of [...byDay.entries()].sort(
        ([a], [b]) => (dayOrder[a] ?? 99) - (dayOrder[b] ?? 99),
      )) {
        const weekday = day as ScheduleShop['rows'][0]['weekday'];
        const codes = [...wsRaw]
          .sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }))
          .map((w) => ({
            code: w.id,
            isKhp: w.cluster === 'КХП' ? true : undefined,
            isVyezd: w.cluster === 'ВЫЕЗД' ? true : undefined,
          }));
        const natural = computeNaturalDays(
          meta.year, meta.month, weekday, meta.holidays,
        );
        const groups = splitWarehousesByOverrides(codes, natural, meta.overrides);
        groups.forEach((g, gi) => {
          rows.push({
            id: `${name}__${day}__g${gi}`,
            weekday,
            warehouses: g,
          });
        });
      }
      return { id: `shop__${name}`, idx: i + 1, name, rows };
    });
  }, [
    allWarehouses, useArchived, state.shops,
    meta.year, meta.month, meta.holidays, meta.overrides,
  ]);

  const shippingWarehouses = useMemo<WarehouseCode[]>(
    () => {
      if (useArchived) return state.shippingWarehouses;
      return allWarehouses
        .filter((w) => w.is_shipping && !w.is_removed)
        .map((w) => ({ code: w.id }));
    },
    [allWarehouses, useArchived, state.shippingWarehouses],
  );
  const removedWarehouses = useMemo<WarehouseCode[]>(
    () => {
      if (useArchived) return state.removedWarehouses;
      return allWarehouses
        .filter((w) => w.is_removed)
        .map((w) => ({ code: w.id }));
    },
    [allWarehouses, useArchived, state.removedWarehouses],
  );
  /** Локализованное имя месяца по номеру 1..12 — t('common.month_N'). */
  const localizedMonth = useCallback(
    (m: number) => t(`common.month_${m}`),
    [t],
  );
  const monthName = localizedMonth(meta.month);

  // Счётчики складов по кластерам в графике (только действующие, что в доставке).
  // Используется в шапке таблицы — рядом с пиллами НТМК / Выезд / КХП.
  const clusterCounts = useMemo(() => {
    let ntmk = 0;
    let vyezd = 0;
    let khp = 0;
    if (useArchived) {
      for (const shop of state.shops) {
        for (const row of shop.rows) {
          for (const w of row.warehouses) {
            if (w.isKhp) khp++;
            else if (w.isVyezd) vyezd++;
            else ntmk++;
          }
        }
      }
    } else {
      for (const w of allWarehouses) {
        if (!w.in_schedule || !w.delivery_day || w.is_removed) continue;
        if (w.cluster === 'КХП') khp++;
        else if (w.cluster === 'ВЫЕЗД') vyezd++;
        else ntmk++;
      }
    }
    return { ntmk, vyezd, khp };
  }, [allWarehouses, useArchived, state.shops]);

  // При смене year/month: меняем YM state → хук подтянет (year, month)
  // с сервера. Если на сервере пусто — хук наследует от latest prior month
  // через `inheritForNewMonth` (data.ts): копирует meta с reset'ом holidays,
  // approverDate и override.days в пусто. См. use-schedule-sync.ts.
  //
  // Перед сменой — flush pending PUT для текущего месяца, чтобы изменения
  // не потерялись если юзер быстро переключается. Хук всё равно flush'нет
  // через debounce-clear в эффекте смены year/month, но явный await даёт
  // гарантию что предыдущая запись зафиксирована до загрузки новой.
  const changeYear = (year: number) => {
    void sync.flush();
    setYM((prev) => ({ year, month: prev.month }));
  };
  const changeMonth = (month: number) => {
    void sync.flush();
    setYM((prev) => ({ year: prev.year, month }));
  };
  // setHolidays: когда добавляем holiday — этот день должен исчезнуть из всех
  // override.days (иначе остаётся стары список не учитывающий новый holiday).
  // Intersection с новым natural: если день стал holiday → выпал из override.
  // Пользовательские explicit-снятия (override.days subset of natural) — сохраняются.
  const setHolidays = (days: number[]) =>
    setState((s) => {
      const byIdSnapshot = useWarehousesStore.getState().byId;
      const newOverrides = s.meta.overrides.map((rule) => {
        const code = rule.codes[0];
        const wh = code ? byIdSnapshot.get(code) : undefined;
        if (!wh?.delivery_day) return rule;
        const newNatural = computeNaturalDays(s.meta.year, s.meta.month, wh.delivery_day, days);
        const naturalSet = new Set(newNatural);
        // Filter override.days: оставляем только дни, которые в новом natural.
        return { ...rule, days: rule.days.filter((d) => naturalSet.has(d)) };
      });
      return { ...s, meta: { ...s.meta, holidays: days, overrides: newOverrides } };
    });
  const setOverrides = (overrides: ScheduleOverrideRule[]) =>
    setState((s) => ({ ...s, meta: { ...s.meta, overrides } }));
  const setApproverDate = (date: ScheduleApproverDate) =>
    setState((s) => ({ ...s, meta: { ...s.meta, approverDate: date } }));
  const setApprover = (p: { name: string; title: string }) =>
    setState((s) => ({ ...s, meta: { ...s.meta, approver: p } }));
  const setDeputy = (p: { name: string; title: string }) =>
    setState((s) => ({ ...s, meta: { ...s.meta, deputy: p } }));

  // По умолчанию — последний день прошлого месяца. Если юзер задал вручную
  // (meta.approverDate set), используем его и не пересчитываем при смене вида.
  const approverDate =
    meta.approverDate ?? lastDayOfPreviousMonth(meta.year, meta.month);

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-bg-deep">
      <ProbaToolbar
        onCommit={commitMonth}
        isLocked={isLocked}
        canCommit={meta.holidays.length > 0}
        year={meta.year}
        month={meta.month}
        holidays={meta.holidays}
        overrides={meta.overrides}
        onChangeOverrides={setOverrides}
        printLabel={t('schedule.print')}
        lockIdExceptions={lockIds.exceptions}
        lockIdCommit={lockIds.commit}
      />

      <div className="proba-canvas flex-1 overflow-auto">
        <div className="proba-sheet">
          <div className="proba-sticky">
          <header className="proba-header">
            <div className="proba-header-top">
              <div className="proba-brand">
                <EvrazLogo className="proba-brand-logo" />
                <span>ЕВРАЗ</span>
              </div>
              <MonthYearPicker
                year={meta.year}
                month={meta.month}
                onChangeYear={changeYear}
                onChangeMonth={changeMonth}
                lockResourceId={lockIds.month}
              >
                <button
                  type="button"
                  className="proba-title proba-editable"
                  title={t('proba.month_year_tip')}
                >
                  {t('schedule.title')} {monthName} {meta.year}
                </button>
              </MonthYearPicker>
              <div className="proba-approver">
                <p className="proba-approver-label">{t('schedule.approver_label')}</p>
                <PersonEditor
                  heading={t('proba.approver_label')}
                  name={meta.approver.name}
                  title={meta.approver.title}
                  onChange={setApprover}
                  lockResourceId={lockIds.approver}
                >
                  <button
                    type="button"
                    className="proba-approver-person proba-editable"
                    title={t('proba.person_edit_title')}
                  >
                    <span className="proba-approver-title">{meta.approver.title}</span>
                    <span className="proba-approver-name">{meta.approver.name}</span>
                  </button>
                </PersonEditor>
                <div className="proba-approver-space" />
                <div className="proba-approver-line" />
                <DatePicker date={approverDate} onChange={setApproverDate} lockResourceId={lockIds.date}>
                  <button
                    type="button"
                    className="proba-approver-date proba-editable"
                    title={t('proba.date_signing_tip')}
                  >
                    {formatApproverDate(approverDate, localizedMonth)}
                  </button>
                </DatePicker>
              </div>
            </div>

            <div className="proba-meta">
              <HolidaysCalendar
                year={meta.year}
                month={meta.month}
                holidays={meta.holidays}
                onChange={setHolidays}
                lockResourceId={lockIds.holidays}
              >
                <button
                  type="button"
                  className="proba-meta-row proba-editable"
                  title={t('proba.days_no_delivery_tip')}
                >
                  <span className="proba-meta-label">
                    {t('proba.days_no_delivery')}
                  </span>
                  <span
                    className={`proba-meta-value ${meta.holidays.length === 0 ? 'proba-meta-value--empty' : ''}`}
                  >
                    {meta.holidays.length > 0
                      ? meta.holidays.join(', ')
                      : t('proba.no_value_add')}
                  </span>
                </button>
              </HolidaysCalendar>

              {/* read-only — управляется из МОЛ (is_removed flag на warehouse).
                  Показываем только если список не пустой: иначе строка-«—»
                  занимает место зря. Для архивных/зафиксированных snapshot'ов
                  тоже подчиняется: пусто → нет смысла рендерить. */}
              {removedWarehouses.length > 0 && (
                <div className="proba-meta-row proba-meta-row--readonly">
                  <span className="proba-meta-label">
                    {t('proba.removed_warehouses')}
                    <span className="proba-cluster-count">
                      {removedWarehouses.length}
                    </span>
                  </span>
                  <span className="proba-meta-value">
                    {formatWarehousesAsText(removedWarehouses)}
                  </span>
                </div>
              )}

              {/* read-only — управляется из МОЛ (is_shipping flag на warehouse) */}
              <div className="proba-meta-row proba-meta-row--readonly">
                <span className="proba-meta-label">
                  {t('proba.shipping_warehouses')}
                  {shippingWarehouses.length > 0 && (
                    <span className="proba-cluster-count">
                      {shippingWarehouses.length}
                    </span>
                  )}
                </span>
                <span
                  className={`proba-meta-value ${shippingWarehouses.length === 0 ? 'proba-meta-value--empty' : ''}`}
                >
                  {shippingWarehouses.length > 0
                    ? formatWarehousesAsText(shippingWarehouses)
                    : t('proba.dash')}
                </span>
              </div>
            </div>

          </header>

          <TableHead counts={clusterCounts} />
          </div>

          <main className="proba-shops">
            <table className="proba-shops-table">
              {/* <thead> в HTML <table> Chromium повторяет на каждой странице
                  при печати автоматически. На экране весь thead скрыт через
                  CSS, sticky-вариант шапки живёт в .proba-sticky. */}
              <thead>
                <tr>
                  <td className="proba-thead-print-num" />
                  <td className="proba-thead-print-body">
                    <div className="proba-thead-row">
                      <span className="proba-thead-day">{t('proba.thead_day')}</span>
                      <span className="proba-thead-date">{t('proba.thead_date')}</span>
                      <span className="proba-thead-code">
                        <span>{t('proba.thead_warehouse')}</span>
                        <span className="proba-code proba-code--plain">
                          {t('common.cluster_ntmk')}<span className="proba-cluster-count">{clusterCounts.ntmk}</span>
                        </span>
                        <span className="proba-code proba-code--vyezd">
                          {t('common.cluster_vyezd')}<span className="proba-cluster-count">{clusterCounts.vyezd}</span>
                        </span>
                        <span className="proba-code proba-code--khp">
                          {t('common.cluster_khp')}<span className="proba-cluster-count">{clusterCounts.khp}</span>
                        </span>
                        <span className="proba-cluster-total">
                          · {clusterCounts.ntmk + clusterCounts.vyezd + clusterCounts.khp}
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <ShopBlock key={shop.id} shop={shop} meta={meta} />
                ))}
              </tbody>
            </table>
          </main>

          {meta.commit && <VerstkaLine commit={meta.commit} />}

          <PreparedBy deputy={meta.deputy} onChange={setDeputy} lockResourceId={lockIds.deputy} />
        </div>
      </div>

      <ProbaStyles />
    </main>
  );
}

// ─── Toolbar — заголовок, исключения, зафиксировать, печать ─────────────────

function ProbaToolbar({
  onCommit,
  isLocked,
  canCommit,
  year,
  month,
  holidays,
  overrides,
  onChangeOverrides,
  printLabel,
  lockIdExceptions,
  lockIdCommit,
}: {
  onCommit: () => void;
  isLocked: boolean;
  canCommit: boolean;
  year: number;
  month: number;
  holidays: number[];
  overrides: ScheduleOverrideRule[];
  onChangeOverrides: (overrides: ScheduleOverrideRule[]) => void;
  printLabel: string;
  lockIdExceptions: string;
  lockIdCommit: string;
}) {
  const { t } = useTranslation();
  return (
    <header className="proba-chrome drag-region relative flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface px-4 text-text-primary">
      <span className="no-drag-region text-[14px] font-semibold tracking-[-0.005em] text-text-strong">
        {t('sidebar.nav_schedule')}
      </span>

      <div className="flex-1" />

      <ExceptionsEditor
        year={year}
        month={month}
        holidays={holidays}
        overrides={overrides}
        onChange={onChangeOverrides}
        lockResourceId={lockIdExceptions}
      >
        <button
          type="button"
          disabled={isLocked}
          className="no-drag-region flex h-7 items-center gap-1 rounded px-2 text-[11.5px] font-medium text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong data-[state=open]:bg-white/[0.08] data-[state=open]:text-text-strong disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
          title={t('proba.exceptions_btn_tip')}
        >
          {t('proba.exceptions_btn')}
          {(() => {
            const total = overrides.reduce((acc, r) => acc + r.codes.length, 0);
            return total > 0 ? (
              <span className="tabular-nums text-text-muted/80">· {total}</span>
            ) : null;
          })()}
        </button>
      </ExceptionsEditor>

      <CommitButton
        onCommit={onCommit}
        isLocked={isLocked}
        canCommit={canCommit}
        lockResourceId={lockIdCommit}
      />

      <div className="h-4 w-px bg-white/[0.08]" />

      <PrintMenu year={year} month={month} printLabel={printLabel} />
    </header>
  );
}

// ─── PrintMenu — popover «Печать ▸ Печать | Сохранить PDF» ──────────────────

function PrintMenu({
  year,
  month,
  printLabel,
}: {
  year: number;
  month: number;
  printLabel: string;
}) {
  const { t } = useTranslation();
  const monthName = t(`common.month_${month}`);
  // Имя файла не локализуем — это идентификатор файла, который видят
  // юзеры в Finder/Explorer и потом ищут по нему. Держим русским как
  // канонический формат «графика доставки ТМЦ» (бренд + предметная область).
  const defaultFileName = `График доставки ТМЦ ${monthName} ${year}`;

  const callPrintDialog = async () => {
    // Печать через дефолтный системный PDF-вьюер: генерим тот же PDF,
    // открываем в Preview/Adobe, юзер жмёт Cmd+P. Файл удаляется автоматом
    // через 2 минуты. Так визуал гарантированно идентичен Save-PDF.
    if (window.pyn?.print?.dialog) {
      await window.pyn.print.dialog(defaultFileName);
    } else {
      window.print();
    }
  };

  const callSavePdf = async () => {
    if (window.pyn?.print?.savePdf) {
      await window.pyn.print.savePdf(defaultFileName);
    } else {
      // Web-fallback: тот же системный print dialog (юзер выберет «Save as PDF»).
      window.print();
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="no-drag-region flex h-7 items-center rounded bg-accent-clay-bg px-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/20 data-[state=open]:bg-accent-clay/25"
        >
          {printLabel}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[220px] overflow-hidden rounded-lg border border-white/[0.08] bg-bg-elevated p-1 text-text-primary shadow-2xl outline-none"
        >
          <Popover.Close asChild>
            <button
              type="button"
              onClick={callPrintDialog}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-text-primary outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              {t('proba.print_menu_print')}
            </button>
          </Popover.Close>
          <Popover.Close asChild>
            <button
              type="button"
              onClick={callSavePdf}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-text-primary outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
            >
              {t('proba.print_menu_save_pdf')}
            </button>
          </Popover.Close>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── CommitButton — фиксация графика (с confirm-popover) ────────────────────

function CommitButton({
  onCommit,
  isLocked,
  canCommit,
  lockResourceId,
}: {
  onCommit: () => void;
  isLocked: boolean;
  canCommit: boolean;
  /** Collaboration lock resource_id, e.g. 'schedule:2026-05:commit'. */
  lockResourceId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <CommitButtonInner
    onCommit={onCommit}
    isLocked={isLocked}
    canCommit={canCommit}
    lockResourceId={lockResourceId}
    open={open}
    setOpen={setOpen}
    t={t}
  />;
}

function CommitButtonInner({
  onCommit,
  isLocked,
  canCommit,
  lockResourceId,
  open,
  setOpen,
  t,
}: {
  onCommit: () => void;
  isLocked: boolean;
  canCommit: boolean;
  lockResourceId?: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  t: (k: string) => string;
}) {
  // Если уже зафиксировано — статичная кнопка «Зафиксировано» (disabled clay).
  if (isLocked) {
    return (
      <span
        className="no-drag-region flex h-7 items-center rounded bg-accent-clay-bg px-2 text-[11.5px] font-medium text-accent-clay"
        title={t('proba.commit_locked_tip')}
      >
        {t('proba.committed_label')}
      </span>
    );
  }

  const tooltip = !canCommit
    ? t('proba.commit_no_holidays_tip')
    : t('proba.commit_btn');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={!canCommit}
          className="no-drag-region flex h-7 items-center rounded px-2 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-strong data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
          title={tooltip}
        >
          {t('proba.commit_btn')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[280px] rounded-lg border border-white/[0.08] bg-bg-elevated p-3 text-text-primary shadow-2xl outline-none"
        >
          <LockedEditorContent resourceId={lockResourceId ?? null} active={open}>
          <div className="text-[12.5px] font-medium text-text-strong">
            {t('proba.commit_confirm_title')}
          </div>
          <div className="mt-1 text-[11.5px] text-text-muted">
            {t('proba.commit_confirm_body')}
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <Popover.Close asChild>
              <button
                type="button"
                className="h-7 rounded px-2.5 text-[12px] text-text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-text-strong"
              >
                {t('proba.commit_confirm_no')}
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button
                type="button"
                onClick={onCommit}
                className="h-7 rounded bg-accent-clay px-2.5 text-[12px] font-medium text-white outline-none transition-colors hover:bg-accent-clay-dim"
              >
                {t('proba.commit_confirm_yes')}
              </button>
            </Popover.Close>
          </div>
          </LockedEditorContent>
          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Formatting commit timestamp в Yekaterinburg (UTC+5) ────────────────────

function formatCommitYekaterinburg(iso: string): string {
  const d = new Date(iso);
  const tz = 'Asia/Yekaterinburg';
  // Месяц русский с capitalize, день numeric, год полный, время 12h am/pm
  const month = d.toLocaleString('ru-RU', { month: 'long', timeZone: tz });
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  const day = d.toLocaleString('en-US', { day: 'numeric', timeZone: tz });
  const year = d.toLocaleString('en-US', { year: 'numeric', timeZone: tz });
  const time = d.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  });
  return `${monthCap} ${day}, ${year} ${time}`;
}

// ─── Verstka line — subtle авторский label слева над bold line ──────────────

function VerstkaLine({ commit }: { commit: ScheduleCommit }) {
  const { t } = useTranslation();
  return (
    <div className="proba-verstka">
      {t('proba.commit_signed_prefix')}: {commit.author} · {formatCommitYekaterinburg(commit.committedAt)}
    </div>
  );
}

// (Meta-rows inline в render выше — `<button.proba-meta-row>` напрямую внутри
//  HolidaysCalendar / WarehouseListEditor. Custom-обёртку не используем,
//  иначе Radix Slot не пробрасывает onClick через function-component.)

// ─── Table head — колонки выровнены с .proba-shop / .proba-row ──────────────

function TableHead({
  counts,
}: {
  counts: { ntmk: number; vyezd: number; khp: number };
}) {
  const { t } = useTranslation();
  const total = counts.ntmk + counts.vyezd + counts.khp;
  return (
    <div className="proba-thead">
      <div /> {/* placeholder — colspan для shop № column (6.5mm) */}
      <div className="proba-thead-row">
        <span className="proba-thead-day">{t('proba.thead_day')}</span>
        <span className="proba-thead-date">{t('proba.thead_date')}</span>
        <span className="proba-thead-code">
          <span>{t('proba.thead_warehouse')}</span>
          <span className="proba-code proba-code--plain">
            {t('common.cluster_ntmk')}<span className="proba-cluster-count">{counts.ntmk}</span>
          </span>
          <span className="proba-code proba-code--vyezd">
            {t('common.cluster_vyezd')}<span className="proba-cluster-count">{counts.vyezd}</span>
          </span>
          <span className="proba-code proba-code--khp">
            {t('common.cluster_khp')}<span className="proba-cluster-count">{counts.khp}</span>
          </span>
          <span className="proba-cluster-total">· {total}</span>
        </span>
      </div>
    </div>
  );
}

// ─── Shop block ─────────────────────────────────────────────────────────────

function ShopBlock({
  shop,
  meta,
}: {
  shop: ScheduleShop;
  meta: ScheduleMeta;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    return shop.rows.map((row) => ({
      row,
      dates: computeRowDates(
        meta.year,
        meta.month,
        row.weekday,
        row.warehouses,
        meta.holidays,
        meta.overrides,
      ),
    }));
  }, [shop.rows, meta]);

  // Read-only: список складов и состав цехов теперь полностью derive'ится из
  // warehouses store. Юзер меняет состав через МОЛ, не через график.
  //
  // <tr>+<td> вместо <article>+<div> — нужно для thead auto-repeat в print.
  // На экране CSS override'ит display: tr→grid, td→block чтобы layout остался
  // идентичным прошлому grid-варианту.
  return (
    <tr className="proba-shop">
      <td className="proba-shop-num">{shop.idx}</td>
      <td className="proba-shop-body">
        <h2 className="proba-shop-name">{shop.name}</h2>
        {rows.length === 0 ? (
          <div className="proba-row proba-row--empty">— нет складов —</div>
        ) : (
          <div className="proba-shop-rows">
            {rows.map(({ row, dates }) => (
              <div className="proba-row" key={row.id}>
                <span
                  className={`proba-day proba-day--${WEEKDAY_TONE[row.weekday]}`}
                >
                  {weekdayShortLabel(row.weekday, t)}
                </span>
                <span className="proba-dates">{formatDates(dates)}</span>
                <div className="proba-codes">
                  {row.warehouses.map((w, i) => (
                    <WarehouseChip key={`${w.code}-${i}`} w={w} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Warehouse chip — без префикс-глифов ────────────────────────────────────

function WarehouseChip({ w }: { w: WarehouseCode }) {
  const { t } = useTranslation();
  const tone = w.isKhp ? 'khp' : w.isVyezd ? 'vyezd' : 'plain';
  const title = w.isKhp
    ? `${t('common.cluster_khp')}: ${w.code}`
    : w.isVyezd
      ? `${t('common.cluster_vyezd')}: ${w.code}`
      : `${t('mol.warehouse')} ${w.code}`;
  return (
    <span className={`proba-code proba-code--${tone}`} title={title}>
      {w.code}
    </span>
  );
}

// ─── PreparedBy footer ──────────────────────────────────────────────────────

function PreparedBy({
  deputy,
  onChange,
  lockResourceId,
}: {
  deputy: { title: string; name: string };
  onChange: (next: { name: string; title: string }) => void;
  lockResourceId?: string;
}) {
  const { t } = useTranslation();
  // Inline signature line — паттерн из «Графика» (SignatureLine):
  // label · line · name · должность. Name+title объединены в один pill-trigger
  // (PersonEditor), линия и label остаются read-only.
  //
  // Label из `proba.prepared_footer_label` — CSS uppercase'ит для российского
  // дизайна, для других локалей текст рендерится как есть (Prepared by /
  // Vorbereitet von / Preparado por / Підготував).
  return (
    <footer className="proba-prepared">
      <span className="proba-prepared-label">{t('proba.prepared_footer_label')}</span>
      <span className="proba-prepared-line" />
      <PersonEditor
        heading={t('proba.prepared_label')}
        name={deputy.name}
        title={deputy.title}
        onChange={onChange}
        lockResourceId={lockResourceId}
      >
        <button
          type="button"
          className="proba-prepared-person proba-editable"
          title={t('proba.person_edit_title')}
        >
          <span className="proba-prepared-name">{deputy.name}</span>
          <span className="proba-prepared-title">· {deputy.title}</span>
        </button>
      </PersonEditor>
    </footer>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function ProbaStyles() {
  return (
    <style>{`
      .proba-sheet,
      .proba-sheet * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      /* Screen: график занимает всю область приложения (Google-Sheets-стиль),
         без «бумажной» обёртки + dark frame. Print: возвращаем A4 формат.
         Экран — Pyn dark warm: deep canvas + surface sheet. Print restore
         к white/light в @media print ниже. */
      .proba-canvas {
        padding: 0;
        background: #161611;
      }

      .proba-sheet {
        background: #1F1E1B;
        color: #E5E5E2;
        padding: 10mm 14mm 14mm;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
        font-size: 7.5pt;
        line-height: 1.35;
        font-feature-settings: 'tnum', 'ss01', 'cv11';
        min-height: 100%;
        box-sizing: border-box;
      }

      /* Sticky-блок: шапка + meta-строки + table-head пинятся при скролле
         канваса. negative margin расширяет фон на всю ширину sheet'а, padding
         восстанавливает внутреннее положение контента. z-index выше шопов,
         opaque bg перекрывает прокручиваемый контент сверху. */
      .proba-sticky {
        position: sticky;
        top: 0;
        z-index: 10;
        background: #1F1E1B;
        margin: -10mm -14mm 0;
        padding: 10mm 14mm 1mm;
      }

      /* ── Header ───────────────────────────────────────────────────────── */
      .proba-header {
        padding-bottom: 2mm;
        border-bottom: 1.2pt solid rgba(234,221,216,0.35);
        margin-bottom: 3mm;
      }
      .proba-header-top {
        display: grid;
        /* minmax(0, 1fr) — центральная колонка может shrink-нуть ниже min-content,
           чтобы grid не «распёр» страницу когда заголовок длиннее обычного
           (Сентябрь/September/Lieferplan-локали). nowrap на title удержит
           в одной строке, overflow допустим симметричный. */
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 4mm;
        /* center — brand+title (single-line) центрируются по вертикали
           внутри высоты approver-блока (multi-line), не висят наверху
           с пустотой под собой. Гармоничный вертикальный баланс. */
        align-items: center;
      }
      .proba-brand {
        /* 14pt (был 16pt) — даёт title запас на длинные локали:
           «ГРАФИК ДОСТАВКИ ТМЦ — СЕНТЯБРЬ 2026» (35 chars) комфортно
           фитится в ~95mm центральной колонки без overflow в ЕВРАЗ. */
        font-size: 14pt;
        font-weight: 600;
        letter-spacing: -0.025em;
        text-transform: uppercase;
        line-height: 1;
        color: #F5F4EF;
        white-space: nowrap;
        display: inline-flex;
        /* center — слово ЕВРАЗ визуально по центру логотипа (3-полосник),
           а не прижато к нижней линии (как было при baseline). */
        align-items: center;
        gap: 1.5mm;
      }
      /* Title — clickable button-trigger для MonthYearPicker popover.
         Начало строки фиксировано (justify-self: start, text-align: left) —
         «График доставки ТМЦ — » всегда стартует с одной точки. Конец
         растёт вправо по мере удлинения названия месяца. */
      .proba-title {
        all: unset;
        display: inline-block;
        font-size: 14pt;
        font-weight: 600;
        letter-spacing: -0.025em;
        color: #F5F4EF;
        line-height: 1;
        text-transform: uppercase;
        text-align: left;
        white-space: nowrap;
        cursor: pointer;
        padding: 0.4mm 2mm;
        border-radius: 1mm;
        transition: background 120ms ease, box-shadow 120ms ease;
        justify-self: start;
        font-family: inherit;
      }
      .proba-title:hover {
        background: rgba(217,119,87,0.12);
      }
      .proba-title:focus-visible {
        box-shadow: 0 0 0 0.5pt rgba(217,119,87,0.45);
      }
      .proba-title[data-state="open"] {
        background: rgba(217,119,87,0.18);
        box-shadow: 0 0 0 0.4pt rgba(217,119,87,0.35);
      }
      .proba-approver {
        text-align: right;
        font-size: 7.5pt;
        color: #CECCC5;
        line-height: 1.3;
      }
      .proba-approver-label {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #A6A39B;
        font-weight: 500;
        margin: 0;
        font-size: 7pt;
        line-height: 1;
      }
      /* Кликабельный pill-блок: должность + ФИО одной кнопкой.
         position+isolation выставлены явно — see .proba-prepared-person note. */
      .proba-approver-person {
        all: unset;
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        margin-top: 0.7mm;
        gap: 0.3mm;
        cursor: pointer;
        position: relative;
        isolation: isolate;
      }
      .proba-approver-title {
        color: #CECCC5;
        font-weight: 400;
        font-size: 6.5pt;
      }
      .proba-approver-name {
        font-weight: 600;
        color: #F5F4EF;
        font-size: 7pt;
      }
      /* Подпись (top УТВЕРЖДАЮ / bottom ПОДГОТОВИЛ): единый стиль 50mm
         hairline 0.4pt — на тёмном фоне светлый alpha-белый. */
      .proba-approver-line {
        width: 50mm;
        margin-left: auto;
        margin-top: 0.8mm;
        height: 0;
        border-bottom: 0.4pt solid rgba(234,221,216,0.18);
      }
      .proba-approver-space {
        height: 5mm;
      }
      .proba-approver-date {
        all: unset;
        display: inline-block;
        margin-top: 0.6mm;
        margin-left: auto;
        font-size: 7pt;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: #E5E5E2;
        cursor: pointer;
        padding: 0.4mm 1.2mm;
        border-radius: 0.8mm;
        transition: background 120ms ease, box-shadow 120ms ease;
        font-family: inherit;
      }
      .proba-approver-date:hover {
        background: rgba(217,119,87,0.12);
      }
      .proba-approver-date:focus-visible {
        box-shadow: 0 0 0 0.5pt rgba(217,119,87,0.45);
      }
      .proba-approver-date[data-state="open"] {
        background: rgba(217,119,87,0.18);
        box-shadow: 0 0 0 0.4pt rgba(217,119,87,0.35);
      }

      /* ── Meta rows ────────────────────────────────────────────────────── */
      .proba-meta {
        margin-top: 2.5mm;
        display: flex;
        flex-direction: column;
        gap: 0.3mm;
      }
      /* <button> trigger для Radix popover: reset native стилей + наш hover */
      .proba-meta-row {
        all: unset;
        box-sizing: border-box;
        font-size: 7pt;
        display: flex;
        gap: 1.5mm;
        align-items: baseline;
        padding: 0.6mm 1.2mm;
        border-radius: 1mm;
        cursor: pointer;
        transition: background 120ms ease, box-shadow 120ms ease;
        min-height: 4.2mm;
        width: 100%;
        text-align: left;
        font-family: inherit;
        color: inherit;
        outline: none;
      }
      .proba-meta-row:hover {
        background: rgba(217,119,87,0.12);
      }
      .proba-meta-row:focus-visible {
        box-shadow: 0 0 0 0.5pt rgba(217,119,87,0.45);
      }
      .proba-meta-row[data-state="open"] {
        background: rgba(217,119,87,0.18);
        box-shadow: 0 0 0 0.4pt rgba(217,119,87,0.35);
      }
      .proba-meta-label {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 500;
        color: #A6A39B;
        font-size: 6pt;
        white-space: nowrap;
        min-width: 38mm;
        padding-top: 0.15mm;
      }
      .proba-meta-value {
        color: #E5E5E2;
        font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', ui-monospace, monospace;
        font-variant-numeric: tabular-nums;
        font-weight: 450;
        font-size: 7pt;
        word-break: break-word;
      }
      .proba-meta-value--empty {
        color: #6C6A60;
        font-style: italic;
      }

      /* ── Editable pill — мягкое clay-свечение для редактируемых полей.
         На экране: плавающий gradient-haze. В печать НЕ идёт. */
      .proba-editable {
        position: relative;
        isolation: isolate;
      }
      .proba-editable::before {
        content: '';
        position: absolute;
        inset: -0.4mm -0.8mm;
        border-radius: 1.6mm;
        background: linear-gradient(
          120deg,
          rgba(217,119,87,0.04) 0%,
          rgba(217,119,87,0.16) 35%,
          rgba(217,119,87,0.06) 55%,
          rgba(217,119,87,0.18) 75%,
          rgba(217,119,87,0.05) 100%
        );
        background-size: 220% 220%;
        animation: proba-editable-haze 7s ease-in-out infinite;
        box-shadow: 0 0 0 0.3pt rgba(217,119,87,0.18) inset;
        z-index: -1;
        pointer-events: none;
      }
      @keyframes proba-editable-haze {
        0%   { background-position:   0%  20%; }
        50%  { background-position: 100%  80%; }
        100% { background-position:   0%  20%; }
      }
      /* Hover/open усиливают свечение */
      .proba-editable:hover::before {
        background: linear-gradient(
          120deg,
          rgba(217,119,87,0.08) 0%,
          rgba(217,119,87,0.24) 35%,
          rgba(217,119,87,0.10) 55%,
          rgba(217,119,87,0.26) 75%,
          rgba(217,119,87,0.10) 100%
        );
        box-shadow: 0 0 0 0.4pt rgba(217,119,87,0.30) inset;
      }
      .proba-editable[data-state="open"]::before {
        background: linear-gradient(
          120deg,
          rgba(217,119,87,0.14) 0%,
          rgba(217,119,87,0.30) 50%,
          rgba(217,119,87,0.14) 100%
        );
        box-shadow: 0 0 0 0.5pt rgba(217,119,87,0.45) inset;
        animation: none;
      }
      /* На печать pill полностью убираем — лист «чистый». */
      @media print {
        .proba-editable::before {
          display: none !important;
        }
      }

      /* Read-only meta-row (Склады удалены / Склады отгрузки ТМЦ) —
         без hover-bg и без cursor:pointer; чисто текст. */
      .proba-meta-row--readonly {
        cursor: default !important;
      }
      .proba-meta-row--readonly:hover {
        background: transparent !important;
      }

      /* ── Verstka — subtle label «Зафиксировал: name · date» снизу
         (после складов, перед линией ПОДГОТОВИЛ). */
      .proba-verstka {
        margin-top: 4mm;
        padding: 0 1mm;
        font-size: 5.8pt;
        font-weight: 400;
        color: #807D72;
        letter-spacing: 0.03em;
        text-align: left;
        font-variant-numeric: tabular-nums;
      }
      /* Если verstka присутствует — убираем верхний margin у Подготовил,
         чтобы две строки не разлетались. */
      .proba-verstka + .proba-prepared {
        margin-top: 2mm;
      }

      /* ── Table head — выровнен с .proba-shop / .proba-row grid ──────────
         Horizontal padding 2.5mm — точно как у .proba-shop, чтобы внутренние
         колонки 6.5mm/1fr стартовали ровно над колонками цеха (День над днём,
         Дата над датой, Склад над складами). */
      .proba-thead {
        display: grid;
        grid-template-columns: 6.5mm 1fr;
        gap: 2.5mm;
        margin-bottom: 0.5mm;
        padding: 0 2.5mm 1mm;
        border-bottom: 0.4pt solid rgba(234,221,216,0.18);
      }
      .proba-thead-row {
        display: grid;
        grid-template-columns: 7mm minmax(22mm, auto) 1fr;
        gap: 2.5mm;
        align-items: baseline;
      }
      .proba-thead-day,
      .proba-thead-date,
      .proba-thead-code {
        font-size: 5.5pt;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #A6A39B;
        line-height: 1;
      }
      .proba-thead-day {
        text-align: center;
      }
      /* СКЛАД + 2 inline-пиллы (Выезд / КХП) — заменяют отдельную легенду */
      .proba-thead-code {
        display: flex;
        align-items: center;
        gap: 2mm;
      }
      /* Счётчик рядом с пиллом кластера: цифра того же размера/веса что
         «НТМК» текст в пилле (6.8pt), отделённая тонкой вертикальной линией.
         Размер закреплён явно, чтобы не «худеть» в meta-label где базовый
         font-size меньше. */
      .proba-cluster-count {
        margin-left: 1mm;
        padding-left: 1mm;
        border-left: 0.3pt solid currentColor;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        font-size: 6.8pt;
        color: inherit;
      }
      /* Total после кластеров — middle-dot слева, без рамки, того же размера
         что и числа в пиллах (6.8pt). */
      .proba-cluster-total {
        margin-left: 0.6mm;
        color: #F5F4EF;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        font-size: 6.8pt;
        letter-spacing: 0.02em;
      }

      /* ── Shops ────────────────────────────────────────────────────────── */
      .proba-shops {
        display: flex;
        flex-direction: column;
      }
      /* На экране table должна выглядеть как обычный flex-column блоков.
         В print восстанавливаем table-семантику чтобы <thead> повторялся. */
      .proba-shops-table {
        display: block;
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0;
      }
      .proba-shops-table > thead {
        display: none;
      }
      .proba-shops-table > tbody {
        display: flex;
        flex-direction: column;
      }
      /* Shop — read-only блок (без hover/click trigger'a). Состав цехов
         derive'ится из warehouses store, юзер меняет через МОЛ. */
      .proba-shop {
        position: relative;
        display: grid;
        grid-template-columns: 6.5mm 1fr;
        gap: 2.5mm;
        padding: 1.4mm 2.5mm;
        border-radius: 2mm;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      /* (first-child special-case удалён — border-top больше нет) */
      /* <td> по умолчанию display:table-cell — на экране это создаёт
         anonymous tables. Явно делаем block чтобы они работали как
         grid-items в shop'е. */
      .proba-shop-num,
      .proba-shop-body {
        display: block;
      }
      .proba-shop-num {
        font-size: 6.5pt;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        color: #A6A39B;
        padding-top: 0.4mm;
        text-align: right;
      }
      .proba-shop-body {
        min-width: 0;
      }
      .proba-shop-name {
        margin: 0 0 0.8mm 0;
        font-size: 7.5pt;
        font-weight: 600;
        letter-spacing: -0.005em;
        color: #F5F4EF;
        line-height: 1.15;
      }
      .proba-shop-rows {
        display: flex;
        flex-direction: column;
        gap: 0.7mm;
      }
      .proba-row {
        display: grid;
        grid-template-columns: 7mm minmax(22mm, auto) 1fr;
        gap: 2.5mm;
        align-items: center;
      }
      .proba-row--empty {
        font-size: 6.5pt;
        font-style: italic;
        color: #6C6A60;
        grid-column: 1 / -1;
      }

      /* Day pill — read-only. Редактирование через ShopWarehousesEditor. */
      .proba-day {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        font-size: 5.6pt;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 0.4mm 0;
        border-radius: 1mm;
        color: #1A1815;
        text-transform: uppercase;
        line-height: 1;
        height: 3.4mm;
      }
      .proba-day--mon { background: rgba(217,119,87,0.38); }   /* ПН clay */
      .proba-day--tue { background: rgba(125,192,97,0.36); }   /* ВТ green */
      .proba-day--wed { background: rgba(120,150,210,0.36); }  /* СР blue */
      .proba-day--thu { background: rgba(255,183,43,0.40); }   /* ЧТ amber */
      .proba-day--fri { background: rgba(178,120,180,0.36); }  /* ПТ lilac */
      .proba-day--sat { background: rgba(80,180,180,0.36); }   /* СБ teal */
      .proba-day--sun { background: rgba(212,163,127,0.42); }  /* ВС kraft */

      .proba-dates {
        font-size: 7pt;
        font-weight: 500;
        color: #B8B5A9;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }

      .proba-codes {
        display: flex;
        flex-wrap: wrap;
        gap: 1mm 1.4mm;
        align-items: center;
      }
      .proba-code {
        font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', ui-monospace, monospace;
        font-size: 6.8pt;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
        text-transform: none;
        padding: 0.3mm 1.2mm;
        border-radius: 0.7mm;
        line-height: 1;
        white-space: nowrap;
        height: 3.4mm;
        display: inline-flex;
        align-items: center;
        color: #E5E5E2;
      }
      .proba-code--plain {
        background: transparent;
        /* Тоньше border (0.2pt) — чтобы КХП с его 0.8pt контуром
           и жирным текстом был визуально явно отдельным классом. */
        border: 0.2pt solid rgba(234,221,216,0.30);
        color: #E5E5E2;
      }
      .proba-code--khp {
        background: transparent;
        border: 0.8pt solid rgba(234,221,216,0.55);
        color: #F5F4EF;
        /* font-weight 700 — КХП выделяется жирным, не сливается с plain */
        font-weight: 700;
        padding: 0.2mm 1.1mm;
      }
      /* Выезд — distinct violet/indigo (не сливается с пн-clay/пт-lilac),
         текст strong-white для читаемости поверх заливки. */
      .proba-code--vyezd {
        background: rgba(140,120,200,0.35);
        border: 0;
        color: #F5F4EF;
        padding: 0.3mm 1.3mm;
      }

      /* ── ПОДГОТОВИЛ — inline-строка как в Графике ────────────────────── */
      .proba-prepared {
        margin-top: 5mm;
        /* padding-top увеличен — между линией-концом-таблицы и текстом
           остаётся ~9mm воздуха, в которые от руки помещается подпись. */
        padding-top: 9mm;
        border-top: 0.4pt solid rgba(234,221,216,0.18);
        display: flex;
        align-items: baseline;
        gap: 2mm;
        line-height: 1.2;
        font-size: 7pt;
        color: #E5E5E2;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .proba-prepared-label {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #A6A39B;
        font-weight: 500;
        font-size: 6pt;
        white-space: nowrap;
      }
      .proba-prepared-line {
        display: inline-block;
        width: 50mm;
        border-bottom: 0.4pt solid rgba(234,221,216,0.18);
        height: 1pt;
      }
      /* Кликабельный pill: ФИО + должность в одной inline-кнопке.
         position+isolation повторяем явно, т.к. .proba-editable объявлен
         выше в каскаде, а all:unset обнуляет position обратно в static. */
      .proba-prepared-person {
        all: unset;
        display: inline-flex;
        align-items: baseline;
        gap: 1.2mm;
        cursor: pointer;
        position: relative;
        isolation: isolate;
      }
      .proba-prepared-name {
        font-weight: 600;
        color: #F5F4EF;
        font-size: 7.5pt;
        white-space: nowrap;
      }
      .proba-prepared-title {
        color: #CECCC5;
        font-size: 7pt;
        white-space: nowrap;
      }

      /* ── Print ────────────────────────────────────────────────────────── */
      @media print {
        /* @page margin 10mm = поля ~1см со всех сторон на КАЖДОЙ странице
           (как было в исходной вёрстке, только теперь работают и на 2-й
           странице тоже). Custom margin в printToPDF в Electron сам по
           себе даёт поля, @page здесь дублирует для надёжности. */
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        /* Тёмная рамка в PDF — это body bg от Tailwind @apply bg-bg-surface,
           который через canvas propagation Chromium показывает в @page margin
           area. Гасим body+html+root в белый, чтобы margin area была чисто
           белой. Tailwind @apply без !important — наш !important выигрывает. */
        html, body, #root {
          background: #ffffff !important;
          background-color: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
          height: auto !important;
          width: auto !important;
          overflow: visible !important;
        }
        body > div,
        body > div > div {
          display: block !important;
          flex: none !important;
          width: 100% !important;
          height: auto !important;
          overflow: visible !important;
          background: white !important;
          position: static !important;
        }
        aside {
          display: none !important;
        }
        main {
          display: block !important;
          flex: none !important;
          width: auto !important;
          height: auto !important;
          overflow: visible !important;
          background: white !important;
        }
        .proba-chrome {
          display: none !important;
        }
        .proba-canvas {
          padding: 0 !important;
          background: white !important;
          overflow: visible !important;
          display: block !important;
        }
        /* Sheet — белый фон, поля даёт @page + printToPDF margins. */
        .proba-sheet {
          position: static !important;
          width: auto !important;
          min-height: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          box-shadow: none !important;
          background: white !important;
          overflow: visible !important;
        }
        .proba-sticky {
          position: static !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          z-index: auto !important;
        }

        /* ── Light-theme restore для PDF ─────────────────────────────────
           Экран в Pyn dark warm, печать остаётся в светлой бумажной палитре
           (как было до dark-flip). Все color/border/background-flips ниже
           возвращают исходные значения. */
        .proba-sheet {
          color: #1A1815 !important;
        }
        .proba-header {
          border-bottom-color: #1A1815 !important;
        }
        .proba-brand,
        .proba-title {
          color: #1A1815 !important;
        }
        .proba-approver {
          color: #5E5E5E !important;
        }
        .proba-approver-label {
          color: #707070 !important;
        }
        .proba-approver-title {
          color: #5E5E5E !important;
        }
        .proba-approver-name {
          color: #1A1815 !important;
        }
        .proba-approver-line {
          border-bottom-color: #B8B5A9 !important;
        }
        .proba-approver-date {
          color: #1A1815 !important;
        }
        .proba-meta-label {
          color: #707070 !important;
        }
        .proba-meta-value {
          color: #1A1815 !important;
        }
        .proba-meta-value--empty {
          color: #B0AC9F !important;
        }
        .proba-verstka {
          color: #A09C92 !important;
        }
        .proba-thead {
          border-bottom-color: rgba(26,24,21,0.18) !important;
        }
        .proba-thead-day,
        .proba-thead-date,
        .proba-thead-code {
          color: #8A867D !important;
        }
        .proba-cluster-total {
          color: #1A1815 !important;
        }
        .proba-shop-num {
          color: #B0AC9F !important;
        }
        .proba-shop-name {
          color: #1A1815 !important;
        }
        .proba-row--empty {
          color: #B0AC9F !important;
        }
        .proba-day--mon { background: rgba(217,119,87,0.28) !important; }
        .proba-day--tue { background: rgba(125,192,97,0.26) !important; }
        .proba-day--wed { background: rgba(120,150,210,0.26) !important; }
        .proba-day--thu { background: rgba(255,183,43,0.30) !important; }
        .proba-day--fri { background: rgba(178,120,180,0.26) !important; }
        .proba-day--sat { background: rgba(80,180,180,0.26) !important; }
        .proba-day--sun { background: rgba(212,163,127,0.32) !important; }
        .proba-dates {
          color: #6F6C64 !important;
        }
        .proba-code {
          color: #1A1815 !important;
        }
        .proba-code--plain {
          border-color: rgba(26,24,21,0.18) !important;
          color: #1A1815 !important;
        }
        .proba-code--khp {
          border-color: rgba(26,24,21,0.62) !important;
          color: #1A1815 !important;
        }
        .proba-code--vyezd {
          background: rgba(26,24,21,0.10) !important;
          color: #1A1815 !important;
        }
        .proba-prepared {
          border-top-color: rgba(26,24,21,0.18) !important;
          color: #1A1815 !important;
        }
        .proba-prepared-label {
          color: #707070 !important;
        }
        .proba-prepared-line {
          border-bottom-color: #B8B5A9 !important;
        }
        .proba-prepared-name {
          color: #1A1815 !important;
        }
        .proba-prepared-title {
          color: #5E5E5E !important;
        }

        /* ── Table flow для thead-repeat на каждой странице ─────────────── */
        /* Sticky-вариант шапки таблицы (из .proba-sticky) скрываем — он бы
           вышел один раз на 1-й странице. На каждой странице выводим thead
           из <table> внутри .proba-shops (Chromium повторяет автоматом). */
        .proba-sticky .proba-thead {
          display: none !important;
        }
        .proba-shops-table {
          display: table !important;
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .proba-shops-table > thead {
          display: table-header-group !important;
        }
        .proba-shops-table > tbody {
          display: table-row-group !important;
        }
        .proba-shop {
          display: table-row !important;
          padding: 0 !important;
        }
        .proba-shop-num {
          display: table-cell !important;
          width: 6.5mm !important;
          padding: 0.9mm 1.5mm 0.9mm 0 !important;
          vertical-align: top !important;
          text-align: right !important;
        }
        .proba-shop-body {
          display: table-cell !important;
          padding: 0.9mm 0 !important;
          vertical-align: top !important;
        }
        /* Print-thead ячейки выравниваются с shop-num / shop-body */
        .proba-thead-print-num {
          width: 6.5mm !important;
          padding: 0 1.5mm 0.6mm 0 !important;
        }
        .proba-thead-print-body {
          padding: 0 0 0.6mm 0 !important;
          border-bottom: 0.4pt solid rgba(0,0,0,0.22) !important;
        }

        /* ── Компрессия для влезания в 2 листа ─────────────────────────── */
        .proba-shop {
          padding: 0.9mm 2mm !important;
        }
        .proba-shop-name {
          margin-bottom: 0.5mm !important;
        }
        .proba-shop-rows {
          gap: 0.4mm !important;
        }
        .proba-header {
          padding-bottom: 1.5mm !important;
          margin-bottom: 2mm !important;
        }
        .proba-meta {
          margin-top: 1.5mm !important;
          gap: 0.2mm !important;
        }
        .proba-meta-row {
          padding: 0.3mm 1mm !important;
          min-height: 3.6mm !important;
        }
        .proba-thead {
          margin-bottom: 0.3mm !important;
          /* horizontal padding match shop print (2mm) — колонки выровнены */
          padding: 0 2mm 0.6mm !important;
        }
        .proba-prepared {
          margin-top: 4mm !important;
          padding-top: 6mm !important;
        }

        /* Day-pills и chip backgrounds для PDF перебиты выше в light-theme
           restore блоке (alpha-значения возвращены к pre-dark уровню). */

        /* ── Hover/data-state на печати убираем ─────────────────────────── */
        .proba-shop-delete {
          display: none !important;
        }
        .proba-meta-row,
        .proba-title,
        .proba-approver-date,
        .proba-shop {
          cursor: default !important;
          box-shadow: none !important;
        }
        .proba-meta-row:hover,
        .proba-meta-row[data-state="open"],
        .proba-title:hover,
        .proba-title[data-state="open"],
        .proba-approver-date:hover,
        .proba-approver-date[data-state="open"],
        .proba-shop:hover,
        .proba-shop[data-state="open"] {
          background: transparent !important;
          box-shadow: none !important;
        }
      }
    `}</style>
  );
}
