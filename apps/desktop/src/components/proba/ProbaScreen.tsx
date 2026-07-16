import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, Download, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Warehouse } from '@pyn/core';
import { sessionStore } from '@/lib/token-store';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import {
  computeNaturalDays,
  computeRowDates,
  splitWarehousesByOverrides,
} from '@/lib/schedule/compute';
import { migrateScheduleLocalStorageToServer } from '@/lib/schedule/migrate-localstorage';
import { resetScheduleCache, useScheduleSync } from '@/lib/schedule/use-schedule-sync';
import {
  autoNonDeliveryDays,
  shortDaysOfMonth,
  useProdCalendarYear,
} from '@/lib/prod-calendar';
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

/**
 * Сортирует коды складов (numeric, ru) и режет на строки ровно по `size` штук —
 * для аккуратной сетки «Склады отгрузки» / «Склады удалены» (по 15 в строку).
 */
function chunkedWarehouseCodes(codes: WarehouseCode[], size: number): string[][] {
  const sorted = [...codes]
    .sort((a, b) => a.code.localeCompare(b.code, 'ru', { numeric: true }))
    .map((w) => w.code);
  const rows: string[][] = [];
  for (let i = 0; i < sorted.length; i += size) rows.push(sorted.slice(i, i + size));
  return rows;
}

/** Дефолтные year/month — сегодняшние. Юзер потом меняет через MonthYearPicker. */
function todayYM(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Последний просмотренный (year, month) — module-level, переживает unmount
 * ProbaScreen в рамках сессии. Без него возврат в График сбрасывал на текущий
 * месяц (ProbaScreen unmount'ится при уходе в другой раздел). Сбрасывается на
 * сегодняшний только при рестарте процесса.
 */
let lastViewedYM: { year: number; month: number } | null = null;

/**
 * Снимок графика на момент фиксации: цеха/склады в «несплит»-форме (одна row на
 * (цех, день), warehouses без split'а по override — archived-ветка shops re-split'ит
 * их по зафиксированным meta.overrides). Зеркалит derive-ветку shops useMemo, но
 * без splitWarehousesByOverrides. Замораживает state, чтобы зафиксированный месяц
 * не менялся вслед за последующими правками карточек складов в МОЛ.
 */
function buildFrozenSnapshot(warehouses: Warehouse[]): {
  shops: ScheduleShop[];
  shipping: WarehouseCode[];
  removed: WarehouseCode[];
} {
  const dayOrder: Record<string, number> = { ПН: 0, ВТ: 1, СР: 2, ЧТ: 3, ПТ: 4, СБ: 5, ВС: 6 };
  const scheduled = warehouses.filter((w) => w.in_schedule && w.delivery_day && !w.is_removed);
  const byShop = new Map<string, Warehouse[]>();
  for (const w of scheduled) {
    const arr = byShop.get(w.shop_name) ?? [];
    arr.push(w);
    byShop.set(w.shop_name, arr);
  }
  const shops: ScheduleShop[] = [...byShop.keys()]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((name, i) => {
      const byDay = new Map<string, Warehouse[]>();
      for (const w of byShop.get(name)!) {
        const arr = byDay.get(w.delivery_day!) ?? [];
        arr.push(w);
        byDay.set(w.delivery_day!, arr);
      }
      const rows: ScheduleShop['rows'] = [...byDay.entries()]
        .sort(([a], [b]) => (dayOrder[a] ?? 99) - (dayOrder[b] ?? 99))
        .map(([day, wsRaw]) => ({
          id: `${name}__${day}`,
          weekday: day as ScheduleShop['rows'][0]['weekday'],
          warehouses: [...wsRaw]
            .sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }))
            .map((w) => ({
              code: w.id,
              isKhp: w.cluster === 'КХП' ? true : undefined,
              isVyezd: w.cluster === 'ВЫЕЗД' ? true : undefined,
            })),
        }));
      return { id: `shop__${name}`, idx: i + 1, name, rows };
    });
  const shipping = warehouses
    .filter((w) => w.is_shipping && !w.is_removed)
    .map((w) => ({ code: w.id }));
  const removed = warehouses.filter((w) => w.is_removed).map((w) => ({ code: w.id }));
  return { shops, shipping, removed };
}

export function ProbaScreen() {
  const { t } = useTranslation();

  // ─── Year / month state (input для хука) ─────────────────────────────────
  // Lifted из state.meta наверх: хук получает (year, month) как параметры,
  // возвращает соответствующий ScheduleState. Меняя YM — переключаем месяц.
  const [{ year: currentYear, month: currentMonth }, setYM] = useState(
    () => lastViewedYM ?? todayYM(),
  );
  // Запоминаем последний просмотренный месяц на время сессии (см. lastViewedYM).
  useEffect(() => {
    lastViewedYM = { year: currentYear, month: currentMonth };
  }, [currentYear, currentMonth]);

  // ─── Server-sync hook ────────────────────────────────────────────────────
  const sync = useScheduleSync(currentYear, currentMonth);
  const state = sync.state;
  const setState = sync.setState;

  // ── Производственный календарь (авто «не возим» + предпраздничные) ──────────
  // Авто-нерабочие для ГРАФИКА: выходные + праздники + первый/последний рабочий
  // день месяца. Их снять руками нельзя. Ручные добавки живут в meta.holidays.
  // Эффективный набор «не возим» = авто ∪ ручные. Для зафиксированного месяца
  // meta.holidays уже заморожен как эффективный набор на момент фиксации —
  // повторно авто-правила НЕ накладываем (иначе задним числом изменим архив).
  const cal = useProdCalendarYear(state.meta.year);
  const autoNonDelivery = useMemo(
    () => autoNonDeliveryDays(cal, state.meta.year, state.meta.month),
    [cal, state.meta.year, state.meta.month],
  );
  const shortDaysMonth = useMemo(
    () => shortDaysOfMonth(cal, state.meta.year, state.meta.month),
    [cal, state.meta.year, state.meta.month],
  );
  // «Не возим» = ВСЕ нерабочие дни: выходные + праздники + первый/последний
  // рабочий день месяца + ручные добавки. Перечисляем полностью (юзер 2026-07-14).
  const effectiveHolidays = useMemo(
    () =>
      state.meta.commit
        ? state.meta.holidays
        : [...new Set([...autoNonDelivery, ...state.meta.holidays])].sort((a, b) => a - b),
    [state.meta.commit, autoNonDelivery, state.meta.holidays],
  );

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
    // Замораживаем текущий derive'нутый снапшот складов в state — зафиксированный
    // месяц рендерится из него (useArchived), не из живого warehouses store, и
    // больше не меняется вслед за правками карточек складов в МОЛ.
    const frozen = buildFrozenSnapshot(useWarehousesStore.getState().warehouses);
    // Замораживаем ЭФФЕКТИВНЫЙ набор «не возим» (авто ∪ ручные) в meta.holidays,
    // чтобы зафиксированный месяц воспроизводил те же даты доставки и после
    // изменения производственного календаря на сервере.
    const frozenHolidays = [...new Set([...autoNonDelivery, ...state.meta.holidays])]
      .sort((a, b) => a - b);
    setState((s) => ({
      ...s,
      shops: frozen.shops,
      shippingWarehouses: frozen.shipping,
      removedWarehouses: frozen.removed,
      meta: {
        ...s.meta,
        holidays: frozenHolidays,
        commit: {
          author: currentUser || 'неизвестно',
          committedAt: new Date().toISOString(),
        },
      },
    }));
  }, [setState, currentUser, autoNonDelivery, state.meta.holidays]);

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
  /**
   * Frozen snapshot используется только когда month committed И снапшот реально
   * непустой. Месяцы, зафиксированные до серверного freeze (этап D не доделан),
   * имеют meta.commit, но пустой state.shops — для них fallback на derive из
   * складов, иначе график рендерился бы пустым (баг «Апрель/Май пустые после
   * фиксации»). Когда этап D начнёт сохранять frozen-снапшот — ветка станет
   * настоящей заморозкой автоматически.
   */
  const useArchived = isLocked && state.shops.length > 0;

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
            meta.year, meta.month, row.weekday, effectiveHolidays,
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
          meta.year, meta.month, weekday, effectiveHolidays,
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
    meta.year, meta.month, effectiveHolidays, meta.overrides,
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
      // «Склады удалены» показываем только в НЕзафиксированном месяце, и только для
      // складов, удалённых не позже месяца графика (раньше они ещё работали) и бывших
      // в графике — cluster+день сохраняются при удалении, без них склад в график не попадал.
      if (isLocked) return [];
      const graphMonthKey = `${meta.year}-${String(meta.month).padStart(2, '0')}`;
      return allWarehouses
        .filter(
          (w) =>
            w.is_removed === 1 &&
            !!w.removed_month &&
            w.removed_month <= graphMonthKey &&
            !!w.cluster &&
            !!w.delivery_day,
        )
        .map((w) => ({ code: w.id }));
    },
    [allWarehouses, isLocked, meta.year, meta.month],
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
      // Эффективный набор «не возим» = авто (выходные/праздники/первый-последний
      // рабочий день) ∪ ручные — по нему считаем natural для фильтра overrides.
      const eff = [...new Set([...autoNonDelivery, ...days])];
      const byIdSnapshot = useWarehousesStore.getState().byId;
      const newOverrides = s.meta.overrides.map((rule) => {
        const code = rule.codes[0];
        const wh = code ? byIdSnapshot.get(code) : undefined;
        if (!wh?.delivery_day) return rule;
        const newNatural = computeNaturalDays(s.meta.year, s.meta.month, wh.delivery_day, eff);
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

  // ── Поиск склада ──────────────────────────────────────────────────────────
  // Юзер вводит код в тулбаре. Точное совпадение ищем в трёх местах:
  //   1) строки цехов (`shops`) → скроллим цех в центр, подсвечиваем цех+чипы;
  //   2) «Склады удалены» / «Склады отгрузки» (meta-чипы шапки) → скроллим лист
  //      вверх (шапка залипающая) и подсвечиваем чип — видно, что склад там.
  // Идём по derive'нутым массивам — работает и для archived-снапшота, и для live.
  const [search, setSearch] = useState('');
  const searchQuery = search.trim();
  const searchTargetId = useMemo(() => {
    if (!searchQuery) return null;
    for (const shop of shops) {
      for (const row of shop.rows) {
        if (row.warehouses.some((w) => w.code === searchQuery)) {
          return shop.id;
        }
      }
    }
    return null;
  }, [searchQuery, shops]);

  // Совпадение в meta-секциях (удалены / отгрузки) — склад не в графике, а в
  // шапке. Только если не нашёлся в цехах (цех приоритетнее).
  const searchMetaHit = useMemo(() => {
    if (!searchQuery || searchTargetId) return false;
    return (
      removedWarehouses.some((w) => w.code === searchQuery) ||
      shippingWarehouses.some((w) => w.code === searchQuery)
    );
  }, [searchQuery, searchTargetId, removedWarehouses, shippingWarehouses]);

  // Скролл найденного цеха в центр. Из effect — при смене цели (ввод кода);
  // вручную по Enter — чтобы вернуть в центр после того как юзер пролистал
  // (срабатывает каждый раз, пока в поле введён найденный код).
  const scrollToSearchTarget = useCallback(() => {
    if (!searchTargetId) {
      // Совпадение в meta (удалены/отгрузки) — шапка залипающая, поэтому просто
      // прокручиваем лист к верху, чтобы подсвеченный чип шапки был в фокусе.
      if (searchMetaHit) {
        document
          .querySelector<HTMLElement>('.proba-canvas')
          ?.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    const target = [
      ...document.querySelectorAll<HTMLElement>('[data-proba-shop]'),
    ].find((el) => el.dataset.probaShop === searchTargetId);
    if (!target) return;
    const canvas = target.closest<HTMLElement>('.proba-canvas');
    if (!canvas) return;
    // Центр считаем по РАБОЧЕЙ области листа, не по окну приложения: верх =
    // низ залипающей шапки (.proba-sticky), низ = низ канваса (плитки). Иначе
    // цех встаёт под шапкой и выглядит смещённым вверх.
    const canvasRect = canvas.getBoundingClientRect();
    const sticky = canvas.querySelector<HTMLElement>('.proba-sticky');
    const workTop = sticky
      ? sticky.getBoundingClientRect().bottom
      : canvasRect.top;
    const workBottom = canvasRect.top + canvas.clientHeight;
    const targetRect = target.getBoundingClientRect();
    const targetCenter = targetRect.top + targetRect.height / 2;
    const delta = targetCenter - (workTop + workBottom) / 2;
    canvas.scrollTo({ top: canvas.scrollTop + delta, behavior: 'smooth' });
  }, [searchTargetId, searchMetaHit]);

  useEffect(() => {
    scrollToSearchTarget();
  }, [scrollToSearchTarget]);

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-bg-deep">
      <ProbaToolbar
        onCommit={commitMonth}
        isLocked={isLocked}
        canCommit={effectiveHolidays.length > 0}
        year={meta.year}
        month={meta.month}
        holidays={effectiveHolidays}
        overrides={meta.overrides}
        onChangeOverrides={setOverrides}
        downloadLabel={t('schedule.download')}
        lockIdExceptions={lockIds.exceptions}
        lockIdCommit={lockIds.commit}
        searchValue={search}
        onSearchChange={setSearch}
        onSearchSubmit={scrollToSearchTarget}
      />

      <WorkspaceCard>
        <div className="proba-canvas flex-1 overflow-y-auto overflow-x-hidden">
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
                  markNoHolidayMonths
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
                    locked={isLocked}
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
                  <DatePicker date={approverDate} onChange={setApproverDate} lockResourceId={lockIds.date} locked={isLocked}>
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
                  autoDays={isLocked ? [] : autoNonDelivery}
                  shortDays={shortDaysMonth}
                  onChange={setHolidays}
                  lockResourceId={lockIds.holidays}
                  locked={isLocked}
                >
                  <button
                    type="button"
                    className="proba-meta-row proba-editable"
                    title={t('proba.days_no_delivery_tip')}
                  >
                    <span className="proba-meta-label">
                      <span className="proba-meta-label-text">{t('proba.days_no_delivery')}</span>
                      {effectiveHolidays.length > 0 && (
                        <span className="proba-cluster-count">{effectiveHolidays.length}</span>
                      )}
                    </span>
                    <span
                      className={`proba-meta-value ${effectiveHolidays.length === 0 ? 'proba-meta-value--empty' : ''}`}
                    >
                      {effectiveHolidays.length > 0
                        ? effectiveHolidays.join(', ')
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
                      <span className="proba-meta-label-text">{t('proba.removed_warehouses')}</span>
                      <span className="proba-cluster-count">
                        {removedWarehouses.length}
                      </span>
                    </span>
                    <span className="proba-meta-value proba-meta-codes">
                      {chunkedWarehouseCodes(removedWarehouses, 15).map((row, i) => (
                        <span key={i} className="proba-meta-code-row">
                          {row.map((code) => (
                            <span
                              key={code}
                              className={`proba-meta-code${code === searchQuery ? ' proba-meta-code--search' : ''}`}
                            >
                              {code}
                            </span>
                          ))}
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {/* read-only — управляется из МОЛ (is_shipping flag на warehouse).
                    Склады отгрузки — только на экране, в печать НЕ идут (@media print скрывает). */}
                <div className="proba-meta-row proba-meta-row--readonly proba-meta-row--shipping">
                  <span className="proba-meta-label">
                    <span className="proba-meta-label-text">{t('proba.shipping_warehouses')}</span>
                    {shippingWarehouses.length > 0 && (
                      <span className="proba-cluster-count">
                        {shippingWarehouses.length}
                      </span>
                    )}
                  </span>
                  <span
                    className={`proba-meta-value ${shippingWarehouses.length === 0 ? 'proba-meta-value--empty' : 'proba-meta-codes'}`}
                  >
                    {shippingWarehouses.length > 0
                      ? chunkedWarehouseCodes(shippingWarehouses, 15).map((row, i) => (
                          <span key={i} className="proba-meta-code-row">
                            {row.map((code) => (
                              <span key={code} className="proba-meta-code">{code}</span>
                            ))}
                          </span>
                        ))
                      : t('proba.dash')}
                  </span>
                </div>

              </div>

            </header>

            <TableHead counts={clusterCounts} hasShort={shortDaysMonth.length > 0} />
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
                          {shortDaysMonth.length > 0 && (
                            <span className="proba-shift-legend">
                              <span className="proba-date-star">*</span> смена короче на 1 час
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop) => (
                    <ShopBlock
                      key={shop.id}
                      shop={shop}
                      meta={meta}
                      effectiveHolidays={effectiveHolidays}
                      shortDays={shortDaysMonth}
                      isSearchTarget={shop.id === searchTargetId}
                      searchQuery={searchQuery}
                    />
                  ))}
                </tbody>
              </table>
            </main>

            {meta.commit && <VerstkaLine commit={meta.commit} />}

            <PreparedBy deputy={meta.deputy} onChange={setDeputy} lockResourceId={lockIds.deputy} locked={isLocked} />
          </div>
        </div>
      </WorkspaceCard>

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
  downloadLabel,
  lockIdExceptions,
  lockIdCommit,
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: {
  onCommit: () => void;
  isLocked: boolean;
  canCommit: boolean;
  year: number;
  month: number;
  holidays: number[];
  overrides: ScheduleOverrideRule[];
  onChangeOverrides: (overrides: ScheduleOverrideRule[]) => void;
  downloadLabel: string;
  lockIdExceptions: string;
  lockIdCommit: string;
  searchValue: string;
  onSearchChange: (next: string) => void;
  onSearchSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="proba-chrome drag-region relative flex h-9 shrink-0 items-center gap-2 px-4 text-text-primary">
      <span className="no-drag-region text-[13px] font-semibold tracking-[-0.005em] text-text-strong">
        {t('sidebar.nav_schedule')}
      </span>

      <ProbaSearchField
        value={searchValue}
        onChange={onSearchChange}
        onSubmit={onSearchSubmit}
      />

      <div className="flex-1" />

      <ExceptionsEditor
        year={year}
        month={month}
        holidays={holidays}
        overrides={overrides}
        onChange={onChangeOverrides}
        lockResourceId={lockIdExceptions}
        locked={isLocked}
      >
        <button
          type="button"
          className="no-drag-region flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-text-secondary outline-none transition-colors hover:bg-bg-hover hover:text-text-strong data-[state=open]:bg-bg-hover data-[state=open]:text-text-strong"
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

      <DownloadButton year={year} month={month} label={downloadLabel} />
    </header>
  );
}

// ─── Поиск склада — поле в тулбаре графика ──────────────────────────────────

/**
 * Контролируемое поле поиска склада по коду. Значение и сброс живут в
 * ProbaScreen (там же резолв цеха + scroll + подсветка) — поле остаётся
 * «тупым». Esc очищает и снимает фокус, крестик — очищает.
 */
function ProbaSearchField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  // «В работе» = есть запрос → пилл получает clay-контур (selection-стиль Pyn),
  // видно что поиск активен. Иконка тоже тинтится в clay.
  const active = value.trim() !== '';
  return (
    <div className="no-drag-region relative flex h-7 items-center">
      <Search
        className={`pointer-events-none absolute left-2 h-3.5 w-3.5 transition-colors ${
          active ? 'text-accent-clay/80' : 'text-text-muted/70'
        }`}
        strokeWidth={1.75}
      />
      <input
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
            e.currentTarget.blur();
          }
        }}
        placeholder={t('proba.search_warehouse')}
        className={`h-7 w-[160px] rounded-md pl-7 pr-6 text-[12px] text-text-primary outline-none transition-[background-color,box-shadow] placeholder:text-text-muted/60 ${
          active
            ? 'bg-accent-clay/[0.08] ring-1 ring-accent-clay/55'
            : 'bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.07]'
        }`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title={t('proba.search_clear')}
          className="absolute right-1 flex h-4 w-4 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-white/[0.08] hover:text-text-strong"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

// ─── DownloadButton — скачивание PDF Графика сразу в «Загрузки» ──────────────

function DownloadButton({
  year,
  month,
  label,
}: {
  year: number;
  month: number;
  label: string;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const monthName = t(`common.month_${month}`);
  // Имя файла русское — идентификатор документа в Finder/Explorer.
  const defaultFileName = `График доставки ТМЦ ${monthName} ${year}`;

  const handleDownload = async (): Promise<void> => {
    if (window.pyn?.print?.savePdf) {
      const res = await window.pyn.print.savePdf(defaultFileName);
      // Короткое подтверждение галочкой (без отдельного i18n-ключа).
      if (res?.ok) {
        setDone(true);
        window.setTimeout(() => setDone(false), 1800);
      }
    } else {
      window.print();
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      className="no-drag-region flex h-7 items-center gap-1.5 rounded-md bg-accent-clay-bg px-2.5 text-[12px] font-medium text-accent-clay outline-none transition-colors hover:bg-accent-clay/20"
    >
      {done ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
      ) : (
        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {label}
    </button>
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
        className="no-drag-region flex h-7 items-center rounded-md bg-accent-clay-bg px-2.5 text-[12px] font-medium text-accent-clay"
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
          className="no-drag-region flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-strong data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
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

function formatCommitYekaterinburg(iso: string, locale: string): string {
  const d = new Date(iso);
  // Локализованная дата + время в TZ Екатеринбурга (UTC+5) по ТЕКУЩЕМУ языку
  // приложения (i18n.language: ru/en/de/es/uk) — порядок полей и 12h/24h берёт
  // сам locale. Раньше было захардкожено: ru-месяц + en-US структура (не
  // реагировало на смену языка).
  return d.toLocaleString(locale || 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
  });
}

// ─── Verstka line — subtle авторский label слева над bold line ──────────────

function VerstkaLine({ commit }: { commit: ScheduleCommit }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="proba-verstka">
      {t('proba.commit_signed_prefix')}: {commit.author} · {formatCommitYekaterinburg(commit.committedAt, i18n.language)}
    </div>
  );
}

// (Meta-rows inline в render выше — `<button.proba-meta-row>` напрямую внутри
//  HolidaysCalendar / WarehouseListEditor. Custom-обёртку не используем,
//  иначе Radix Slot не пробрасывает onClick через function-component.)

// ─── Table head — колонки выровнены с .proba-shop / .proba-row ──────────────

function TableHead({
  counts,
  hasShort,
}: {
  counts: { ntmk: number; vyezd: number; khp: number };
  /** В месяце есть предпраздничные дни `*` → показать легенду у счётчика. */
  hasShort: boolean;
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
          {hasShort && (
            <span className="proba-shift-legend">
              <span className="proba-date-star">*</span> смена короче на 1 час
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── Shop block ─────────────────────────────────────────────────────────────

function ShopBlock({
  shop,
  meta,
  effectiveHolidays,
  shortDays,
  isSearchTarget,
  searchQuery,
}: {
  shop: ScheduleShop;
  meta: ScheduleMeta;
  /** Эффективный набор «не возим» (авто ∪ ручные) — им режем даты доставки. */
  effectiveHolidays: number[];
  /** Числа месяца, предпраздничные (−1ч) — рисуем звёздочку-степень. */
  shortDays: number[];
  isSearchTarget: boolean;
  searchQuery: string;
}) {
  const { t } = useTranslation();
  const shortSet = useMemo(() => new Set(shortDays), [shortDays]);
  const rows = useMemo(() => {
    return shop.rows.map((row) => ({
      row,
      dates: computeRowDates(
        meta.year,
        meta.month,
        row.weekday,
        row.warehouses,
        effectiveHolidays,
        meta.overrides,
      ),
    }));
  }, [shop.rows, meta, effectiveHolidays]);

  // Подсветка «сегодня»: число месяца, если на листе показан ТЕКУЩИЙ месяц/год
  // (иначе «сегодня» к чужому месяцу не относится → -1, не подсветится).
  // Чисто экранная (CSS .proba-date--today в @media screen), в печать не идёт.
  const now = new Date();
  const todayDay =
    meta.year === now.getFullYear() && meta.month === now.getMonth() + 1
      ? now.getDate()
      : -1;

  // Read-only: список складов и состав цехов теперь полностью derive'ится из
  // warehouses store. Юзер меняет состав через МОЛ, не через график.
  //
  // <tr>+<td> вместо <article>+<div> — нужно для thead auto-repeat в print.
  // На экране CSS override'ит display: tr→grid, td→block чтобы layout остался
  // идентичным прошлому grid-варианту.
  return (
    <tr
      className={`proba-shop${isSearchTarget ? ' proba-shop--search' : ''}`}
      data-proba-shop={shop.id}
    >
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
                <span className="proba-dates">
                  {dates.map((d, di) => (
                    <Fragment key={d}>
                      {di > 0 ? ', ' : ''}
                      <span className={d === todayDay ? 'proba-date--today' : undefined}>
                        {d}
                        {shortSet.has(d) && (
                          <span className="proba-date-star" title="Предпраздничный день — смена короче на 1 час">*</span>
                        )}
                      </span>
                    </Fragment>
                  ))}
                </span>
                <div className="proba-codes">
                  {row.warehouses.map((w, i) => (
                    <WarehouseChip
                      key={`${w.code}-${i}`}
                      w={w}
                      highlight={
                        isSearchTarget &&
                        searchQuery !== '' &&
                        w.code === searchQuery
                      }
                    />
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

function WarehouseChip({
  w,
  highlight = false,
}: {
  w: WarehouseCode;
  highlight?: boolean;
}) {
  const { t } = useTranslation();
  const tone = w.isKhp ? 'khp' : w.isVyezd ? 'vyezd' : 'plain';
  const title = w.isKhp
    ? `${t('common.cluster_khp')}: ${w.code}`
    : w.isVyezd
      ? `${t('common.cluster_vyezd')}: ${w.code}`
      : `${t('mol.warehouse')} ${w.code}`;
  return (
    <span
      className={`proba-code proba-code--${tone}${highlight ? ' proba-code--search' : ''}`}
      title={title}
    >
      {w.code}
    </span>
  );
}

// ─── PreparedBy footer ──────────────────────────────────────────────────────

function PreparedBy({
  deputy,
  onChange,
  lockResourceId,
  locked = false,
}: {
  deputy: { title: string; name: string };
  onChange: (next: { name: string; title: string }) => void;
  lockResourceId?: string;
  locked?: boolean;
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
        locked={locked}
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
        /* §шрифт — лист Графика наследует выбранный в Настройках шрифт
           (--app-font) → и экран, и PDF используют его же, одинаково Win/Mac. */
        font-family: var(--app-font);
        font-size: 7.5pt;
        line-height: 1.35;
        font-feature-settings: 'tnum', 'ss01', 'cv11';
        min-height: 100%;
        box-sizing: border-box;
      }

      /* Screen-only: прокручиваемая рабочая область графика (.proba-canvas)
         отступает на 16px от окантовки карточки со ВСЕХ сторон — единая линия
         поля как на всех листах. Содержимое, в т.ч. при прокрутке, заканчивается
         на расстоянии от края. Поле того же тона (#1F1E1B, невидимое), видимая
         окантовка = граница карточки. БЕЗ масштабирования. Печать (A4) —
         @media print отдельно (margin на экране не применяется). */
      @media screen {
        .proba-canvas {
          margin: 16px;
          background: #1F1E1B;
        }
      }

      /* Зафиксированный месяц: editable-триггеры некликабельны (popover не
         открывается, см. LockableTrigger) — гасим haze и pointer-курсор,
         оставляя hover для tooltip. MonthYearPicker НЕ помечается data-frozen,
         поэтому навигация по месяцам остаётся живой. */
      [data-frozen] {
        cursor: default !important;
      }
      /* Зафиксировано: на hover — единообразная нейтральная подсветка на ВСЕХ
         неизменяемых элементах (показывает «это элемент графика, но менять
         нельзя») + tooltip. НЕ clay-haze редактирования (он намекал бы на edit).
         MonthYearPicker без data-frozen → его обычный hover жив. */
      [data-frozen]:hover {
        background-color: rgba(234, 221, 216, 0.08) !important;
        box-shadow: none !important;
      }
      .proba-editable[data-frozen]::before {
        display: none !important;
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
      /* Чип кода склада (Склады отгрузки). Базовый inline-отступ — для печати;
         на экране раскладкой управляет .proba-meta-codes (flex-сетка). */
      .proba-meta-code {
        margin-right: 2mm;
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

      /* Day pill — read-only. */
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
      /* Экранные alphas подняты для насыщенности (были бледные 0.36–0.42).
         Печать НЕ затронута — @media print задаёт свои сниженные значения. */
      .proba-day--mon { background: rgba(217,119,87,0.55); }   /* ПН clay */
      .proba-day--tue { background: rgba(125,192,97,0.52); }   /* ВТ green */
      .proba-day--wed { background: rgba(120,150,210,0.52); }  /* СР blue */
      .proba-day--thu { background: rgba(255,183,43,0.58); }   /* ЧТ amber */
      .proba-day--fri { background: rgba(178,120,180,0.52); }  /* ПТ lilac */
      .proba-day--sat { background: rgba(80,180,180,0.52); }   /* СБ teal */
      .proba-day--sun { background: rgba(212,163,127,0.58); }  /* ВС kraft */

      .proba-dates {
        font-size: 7pt;
        font-weight: 500;
        color: #CFCDC6;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }
      /* Звёздочка у предпраздничных чисел — инлайн «3*» (смена −1ч). */
      .proba-date-star {
        color: #C08457;
        font-weight: 600;
      }
      /* Легенда «* смена короче на 1 час» в строке счётчика складов. */
      .proba-shift-legend {
        margin-left: 8px;
        color: #8C8A83;
        font-style: italic;
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

      /* §design — ЭКРАННЫЕ override'ы размещены ПОСЛЕ всех базовых правил, чтобы
         выигрывать по source-order на screen (раньше блок @media screen стоял ДО
         базовых правил → они перекрывали его, изменения не применялись). Печать
         (@media print ниже) — отдельная media, этими правилами НЕ затрагивается. */
      @media screen {
        /* §screen — содержимое прижато к ЕДИНОЙ рамке 16px (это margin .proba-
           canvas), без «бумажных» полей 14мм: у листа нет внутреннего паддинга,
           а sticky-шапка без расширяющих негативных margin'ов и без своего
           паддинга → логотип/текст/строки/УТВЕРЖДАЮ стоят ровно по рамке со всех
           сторон. Печать (@media print) использует поля 10/14мм — НЕ затронута. */
        .proba-sheet { padding: 0; }
        .proba-sticky { margin: 0; padding: 0 0 1mm; }
        .proba-header-top { align-items: start; }
        .proba-header { margin-bottom: 1.5mm; padding-bottom: 1mm; }
        /* Верхушка «УТВЕРЖДАЮ» вровень с верхушкой «ГРАФИК ДОСТАВКИ»: заголовок
           14pt в пилле (padding + бОльшая ascent-зона) садится чуть ниже, поэтому
           сдвигаем блок approver вниз на эту же величину. */
        .proba-approver { margin-top: 0.6mm; }
        /* ЕВРАЗ (логотип + слово) на одной линии с «ГРАФИК ДОСТАВКИ»
           АВТОМАТИЧЕСКИ — по baseline (align-self у brand/title ниже), без
           ручного подпора margin'ом. Оба 18px → базовые линии совпадают сами;
           логотип масштабируется от кегля (height:0.72em) и встаёт от baseline
           до cap-line, подгоняясь под высоту заголовка. */
        /* Зазор НАД линией = место для живой подписи между ФИО и линией.
           Иначе линия читается как разделитель, а не строка подписи.
           Высота на глаз (как и остальные mm в шапке). */
        .proba-approver-space { height: 7mm; }
        .proba-meta { margin-top: 0.5mm; }
        /* §3 Реструктур шапки (screen-only): убираем пустоту слева под
           заголовком. .proba-header → 2-рядный grid, а .proba-header-top
           растворяется (display:contents), его дети раскладываются по areas:
           ЕВРАЗ+ГРАФИК сверху, УТВЕРЖДАЮ справа на оба ряда, Дни/Склады во
           2-м ряду слева — заполняя пустоту. Печать (@media print) использует
           обычный block + grid header-top, этими правилами НЕ затронута. */
        .proba-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          grid-template-areas:
            "brand title approver"
            "meta  meta  approver";
          column-gap: 4mm;
          row-gap: 0;
          align-items: start;
        }
        .proba-header-top { display: contents; }
        /* align-items:baseline (override center из базы) → внутри brand слово и
           логотип на общей baseline; align-self:baseline → эта baseline
           совпадает с baseline заголовка (две grid-ячейки одного ряда). */
        .proba-brand { grid-area: brand; align-items: baseline; align-self: baseline; }
        .proba-title { grid-area: title; align-self: baseline; }
        /* Логотип ЕВРАЗ ровно по буквам: height:1cap = cap-height текущего
           шрифта → низ полосок на baseline (align-self), верх — на cap-line
           заголовка. Пропорционально и АВТОМАТИЧЕСКИ под любой шрифт/локаль
           (раньше был фикс 0.92em — торчал выше букв). Только экран; печать
           сохраняет inline 0.72em. !important перекрывает inline-style SVG.
           Fallback (если 1cap не поддержан) → inline 0.72em ≈ cap-height. */
        .proba-brand-logo { height: 1cap !important; align-self: baseline; }
        .proba-approver { grid-area: approver; }
        .proba-meta {
          grid-area: meta;
          /* §meta-align — единая колоночная сетка [метка | счётчик | значение]
             на ВСЕ строки через subgrid: ширина колонки метки = самая длинная
             метка среди строк (любой локали) → разделители-счётчики «│N» и
             колонка значений сами встают на один X. Без фикс-мм, авто, на любой
             будущей локали. */
          display: grid;
          grid-template-columns: auto max-content 1fr;
          column-gap: 2.5mm;
          row-gap: 0.3mm;
        }
        /* Склады отгрузки / удалены — строки ровно по 15 кодов (chunk в render),
           аккуратными колонками; приписка по центру при нескольких строках. */
        .proba-meta-codes {
          display: flex;
          flex-direction: column;
          gap: 0.8mm;
        }
        /* flex-wrap → коды переносятся в пределах доступной ширины: узкое окно
           не вызывает горизонтальную прокрутку листа. Чанк ≤15 из render
           остаётся логической «строкой», просто допереносится при нехватке
           места; метка/счётчик центрируются против всех получившихся строк
           (--readonly align-items:center). */
        .proba-meta-code-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.8mm 1mm;
        }
        .proba-meta-codes .proba-meta-code {
          min-width: 8mm;
          margin-right: 0;
        }
        .proba-meta-row--readonly { align-items: center; }
        /* §screen-типографика (px; печать в @media print — свои pt). РОВНО три
           размера, межстрочный в норме 1.3–1.5:
             • Заголовок 18px / 24 — ЕВРАЗ/ГРАФИК;
             • Контент   14px / 20 — цеха, склады-коды, даты, значения полосок;
             • Подпись   12px / 16 — нумерация, метки, дни, счётчики, шапка,
                                     УТВЕРЖДАЮ, ПОДГОТОВИЛ, Зафиксировано.
           Иерархию внутри размера — весом и цветом, не кеглем. */
        /* — Заголовок 18px / 24 — */
        .proba-brand,
        .proba-title { font-size: 18px; line-height: 24px; }
        /* — Подпись 12px / 16 — */
        /* §meta — метки Дни/Склады прижаты к ЛЕВОЙ линии листа (как ЕВРАЗ и
           номера цехов); базовый left-padding строки даёт сдвиг — гасим его.
           Строка раскрывает родительские колонки через subgrid: метка занимает
           col 1-2 (текст+счётчик), значение — col 3. */
        .proba-meta-row {
          padding-left: 0;
          display: grid;
          grid-template-columns: subgrid;
          grid-column: 1 / -1;
        }
        /* Метка — вложенный subgrid на col 1-2: текст в col 1 (ширина = самая
           длинная метка любой локали), счётчик-разделитель «│N» в col 2 (ширина
           = самый широкий счётчик) → во ВСЕХ строках │ и значения на одном X. */
        .proba-meta-label {
          font-size: 12px; line-height: 16px;
          display: grid;
          grid-template-columns: subgrid;
          grid-column: 1 / 3;
          align-items: baseline;
          min-width: 0;
        }
        .proba-meta-label-text { grid-column: 1; min-width: 0; }
        .proba-meta-label .proba-cluster-count { grid-column: 2; margin-left: 0; }
        .proba-thead-day,
        .proba-thead-date,
        .proba-thead-code { font-size: 12px; line-height: 16px; letter-spacing: 0.04em; }
        /* ДАТА — по центру своей колонки (над датами). */
        .proba-thead-date { text-align: center; }
        .proba-cluster-count,
        .proba-cluster-total { font-size: 12px; }
        .proba-shop-num { font-size: 12px; line-height: 16px; }
        .proba-day { font-size: 12px; height: 5mm; padding: 0.4mm 1.2mm; }
        /* — Контент 14px / 20 (пиллы дней/кодов — высотой, без line-height) — */
        .proba-meta-value { grid-column: 3; font-size: 14px; line-height: 20px; }
        .proba-shop-name { font-size: 14px; line-height: 20px; }
        .proba-dates { font-size: 14px; line-height: 20px; }
        /* §сегодня — заметная подсветка числа-дня, совпавшего с СЕГОДНЯШНЕЙ датой
           (только если на листе показан текущий месяц/год; см. todayDay в
           ShopBlock — там же guard по месяцу). Насыщенная clay-пилюля + резкий 1px
           контур + мягкое свечение (selection-стиль Pyn) — хорошо видно среди дат.
           Чисто экранная: в @media print правила нет → в печать НЕ идёт. */
        .proba-date--today {
          background: rgba(217, 119, 87, 0.55);
          color: #FFFFFF;
          font-weight: 700;
          border-radius: 4px;
          padding: 0 5px;
          box-shadow:
            0 0 0 1px rgba(217, 119, 87, 0.95),
            0 0 6px 1px rgba(217, 119, 87, 0.40);
        }
        .proba-code { font-size: 14px; height: 5.2mm; }

        /* §выравнивание левого края (screen): нумерация цеха и шапка таблицы
           прижаты к той же левой линии, что ЕВРАЗ/ГРАФИК и полоски Дни/Склады
           (убираем доп. левый отступ shop/thead). Номер цеха — по левому краю
           (1 и 10 начинаются на одной линии); колонки День/Дата/Склад остаются
           под своей шапкой. */
        .proba-shop { padding-left: 0; }
        .proba-thead { padding-left: 0; }
        .proba-shop-num { text-align: left; }
        /* §коды складов — от одной линии под «СКЛАД». Колонка ДАТА фиксированной
           ширины (а не minmax auto, которая плясала по строкам → коды шли
           «шахматами»). thead и строки используют одни и те же колонки, поэтому
           коды во ВСЕХ строках начинаются на одном X; если дат больше — общая
           линия сдвигается вправо разом, а не по одной строке. */
        .proba-row,
        .proba-thead-row { grid-template-columns: 7mm 30mm 1fr; }
        /* §УТВЕРЖДАЮ — правое выравнивание сохранено; шрифт в «Подписи» 12px/16,
           имя выделено весом, не кеглем. */
        .proba-approver,
        .proba-approver-label,
        .proba-approver-title,
        .proba-approver-name,
        .proba-approver-date { font-size: 12px; line-height: 16px; }
        /* §низ листа — ПОДГОТОВИЛ-футер + строка «Зафиксировано» в «Подписи»
           12px/16 (иерархия весом/цветом, НЕ кеглем). Печать — свои размеры в
           @media print. Дочерние селекторы (label/name/title) намеренно
           специфичнее: их базовые pt-правила стоят ПОСЛЕ этого блока, и без
           повышенной специфичности перебивали бы 12px по source-order. */
        .proba-verstka,
        .proba-prepared,
        .proba-row--empty,
        .proba-prepared .proba-prepared-label,
        .proba-prepared .proba-prepared-name,
        .proba-prepared .proba-prepared-title { font-size: 12px; line-height: 16px; }

        /* Поиск склада — подсветка найденного цеха и его чипов. Цех: мягкая
           clay-заливка (как hover). Чип: резкий 1px clay-контур + рассеянное
           свечение (selection-стиль Pyn). Только screen — печать не трогаем. */
        .proba-shop,
        .proba-code,
        .proba-meta-code {
          transition: background-color 0.18s ease, box-shadow 0.18s ease;
        }
        .proba-shop--search {
          background-color: rgba(217, 119, 87, 0.07);
          border-radius: 1.5mm;
        }
        .proba-code--search,
        .proba-meta-code--search {
          position: relative;
          z-index: 1;
          box-shadow:
            0 0 0 1px rgba(217, 119, 87, 0.95),
            0 0 5px 1px rgba(217, 119, 87, 0.30);
        }
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
        /* §рамка — «парящая» карточка WorkspaceCard (border + скругление + тень
           + bg) в печать НЕ идёт: PDF = чистый белый лист, текст с полями 1см
           (поля даёт printToPDF). Это div'ы main>div (внешний gutter) и
           main>div>div (карточка с border). proba-canvas/sheet — отдельно ниже. */
        main > div,
        main > div > div {
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: white !important;
          overflow: visible !important;
          padding: 0 !important;
          margin: 0 !important;
          width: 100% !important;
          min-height: 0 !important;
          display: block !important;
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

        /* ── Компрессия: цель ~1.5 листа (а не 2 полных) ───────────────────
           Режем вертикальные зазоры/паддинги и чуть-чуть кегль строк. Если
           надо плотнее/свободнее — крутить значения здесь. */
        .proba-shop {
          padding: 0.5mm 2mm !important;
        }
        .proba-shop-name {
          margin-bottom: 0.3mm !important;
          font-size: 7pt !important;
        }
        .proba-shop-rows {
          gap: 0.25mm !important;
        }
        .proba-day {
          height: 3mm !important;
        }
        .proba-code {
          height: 3mm !important;
        }
        .proba-header {
          padding-bottom: 1mm !important;
          margin-bottom: 1.2mm !important;
        }
        .proba-meta {
          margin-top: 1mm !important;
          gap: 0.15mm !important;
        }
        .proba-meta-row {
          padding: 0.2mm 1mm !important;
          min-height: 3mm !important;
        }
        .proba-thead {
          margin-bottom: 0.3mm !important;
          /* horizontal padding match shop print (2mm) — колонки выровнены */
          padding: 0 2mm 0.5mm !important;
        }
        .proba-prepared {
          margin-top: 3mm !important;
          padding-top: 4mm !important;
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

        /* §print-mirror — раскладку PDF подтягиваем под ЭКРАН (юзер: «нет повтора
           нашей таблицы; у нас заголовок выше компактнее, всё по левому краю»).
           Зеркалим @media screen-реструктур, но в pt/A4: компактная 2-рядная
           шапка (ЕВРАЗ+ГРАФИК сверху, Дни/Склады слева снизу — без пустоты,
           УТВЕРЖДАЮ справа как на экране), subgrid-выравнивание meta в колонки,
           склады по 15 в строку с корректным переносом. */
        .proba-header {
          display: grid !important;
          grid-template-columns: auto minmax(0, 1fr) auto !important;
          grid-template-areas:
            "brand title approver"
            "meta meta approver" !important;
          column-gap: 4mm !important;
          row-gap: 0 !important;
          align-items: start !important;
        }
        .proba-header-top { display: contents !important; }
        .proba-brand {
          grid-area: brand !important;
          align-items: baseline !important;
          align-self: baseline !important;
        }
        .proba-title { grid-area: title !important; align-self: baseline !important; }
        .proba-approver { grid-area: approver !important; }
        .proba-meta {
          grid-area: meta !important;
          display: grid !important;
          grid-template-columns: auto max-content 1fr !important;
          column-gap: 2.5mm !important;
          row-gap: 0.3mm !important;
          margin-top: 0.6mm !important;
        }
        .proba-meta-row {
          padding-left: 0 !important;
          display: grid !important;
          grid-template-columns: subgrid !important;
          grid-column: 1 / -1 !important;
        }
        .proba-meta-label {
          display: grid !important;
          grid-template-columns: subgrid !important;
          grid-column: 1 / 3 !important;
          align-items: baseline !important;
          min-width: 0 !important;
        }
        .proba-meta-label-text { grid-column: 1 !important; min-width: 0 !important; }
        .proba-meta-label .proba-cluster-count { grid-column: 2 !important; margin-left: 0 !important; }
        /* §print — отодвигаем список значений от счётчика (≈ ширина 2-3 цифр /
           одного кода): иначе на печати «дни без доставки» / «склады удалены»
           вплотную к счётчику и сливаются. */
        .proba-meta-value { grid-column: 3 !important; padding-left: 3mm !important; }
        .proba-meta-codes {
          display: flex !important;
          flex-direction: column !important;
          gap: 0.7mm !important;
        }
        .proba-meta-code-row {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 0.6mm 1mm !important;
        }
        .proba-meta-codes .proba-meta-code { margin-right: 0 !important; }
        .proba-meta-row--readonly { align-items: center !important; }
        /* §print — «Склады отгрузки» в печать НЕ включаем (юзер): только на экране. */
        .proba-meta-row--shipping { display: none !important; }

        /* §print-align — левый край В ОДНУ ЛИНИЮ (как на экране): нумерация цеха
           по ЛЕВОМУ краю (1 и 10 стартуют с одной линии, вровень с ЕВРАЗ/Дни/
           Склады), а не right-aligned «лесенкой». Фикс-ширина колонки ДАТА
           (7mm 30mm 1fr вместо minmax-auto) → коды всех строк на одном X, без
           «шахмат». Зеркалит §выравнивание из @media screen. */
        .proba-shop-num {
          text-align: left !important;
          padding-left: 0 !important;
        }
        .proba-row,
        .proba-thead-row {
          grid-template-columns: 7mm 30mm 1fr !important;
        }

        /* §ч/б — весь ТЕКСТ листа в PDF ЧИСТО ЧЁРНЫЙ #000 (не тёплый #1A1815:
           он на мелком кегле + Win-растеризации читался серым и отличался от
           Mac). Pure black → максимально чётко и идентично Win/Mac. Цвет
           сохраняют только фоны day-pills / Выезда / статус-чипов (background,
           не color) и логотип ЕВРАЗ (SVG fill). Правило последнее в @media print
           → перебивает все серые color-правила выше. */
        .proba-sheet,
        .proba-sheet * {
          color: #000000 !important;
        }

        /* §насыщенность — мелкий тонкий текст (даты, коды, шапка таблицы,
           метки, нумерация, УТВЕРЖДАЮ/ПОДГОТОВИЛ) при #000 + weight 500 на
           Win-растеризации читался СЕРЫМ. Поднимаем вес → чёрный насыщенный
           как названия цехов. */
        .proba-meta-label, .proba-meta-value, .proba-meta-code,
        .proba-thead-day, .proba-thead-date, .proba-thead-code,
        .proba-dates, .proba-shop-num, .proba-code,
        .proba-cluster-count, .proba-cluster-total,
        .proba-approver, .proba-approver-label, .proba-approver-title, .proba-approver-name,
        .proba-prepared-label, .proba-prepared-title, .proba-prepared-name,
        .proba-verstka {
          font-weight: 600 !important;
        }

        /* §коды складов в печати — кластеры различаем РАМКОЙ/ЗАЛИВКОЙ (тёмные,
           ровные внутри класса):
           • НТМК/прочие — тонкая тёмная рамка;
           • КХП — ЖИРНАЯ заметная рамка (как пилл КХП в шапке);
           • Выезд — тёмно-серый ЗАЛИВНОЙ пилл без рамки, белый текст. */
        .proba-code--plain {
          border: 0.4pt solid rgba(0,0,0,0.5) !important;
          background: transparent !important;
          color: #000 !important;
          padding: 0.3mm 1.2mm !important;
        }
        .proba-code--khp {
          /* Жирную рамку КХП даём НЕ толстым border'ом, а тонким border (как
             plain → одинаковая внутренняя высота чипа) + outline снаружи.
             Раньше border:1.6pt при box-sizing:border-box съедал ~1.1мм из 3мм
             высоты → текст (~2.4мм) не помещался и наползал на рамку, а высота
             КХП ≠ plain → коды «не ровно по высоте». outline не влияет на размер
             бокса, повторяет border-radius (Chromium) и надёжно печатается. */
          border: 0.4pt solid #000 !important;
          outline: 1.2pt solid #000 !important;
          outline-offset: 0 !important;
          background: transparent !important;
          color: #000 !important;
          padding: 0.3mm 1.2mm !important;
        }
        .proba-code--vyezd {
          border: 0 !important;
          background: #3F3F3F !important;
          color: #ffffff !important;
          padding: 0.3mm 1.4mm !important;
        }
        /* Счётчик внутри тёмного пилла Выезд — белый (иначе catch-all #000 →
           чёрный на тёмно-сером = не видно). Его border-left = currentColor → тоже белый. */
        .proba-code--vyezd .proba-cluster-count {
          color: #ffffff !important;
        }

        /* §склады отгрузки/удалены — единый перенос: все коды текут одной
           wrap-строкой (без сиротливых строк по 1 коду). Чанки-«ряды» из
           render распускаем в общий поток (display:contents). */
        .proba-meta-codes {
          flex-direction: row !important;
          flex-wrap: wrap !important;
          gap: 0.7mm 1mm !important;
        }
        .proba-meta-code-row {
          display: contents !important;
        }
      }
    `}</style>
  );
}
