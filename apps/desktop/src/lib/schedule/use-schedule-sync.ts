/**
 * useScheduleSync(year, month) — server-backed состояние раздела «График».
 *
 * §TZ-SERVER-SYNC-COLLAB этап A — заменяет localStorage-based loadState/
 * saveArchive из ProbaScreen. Один row per (year, month) в D1.
 *
 * Ответственности:
 *   • GET снапшот на mount + при смене (year, month).
 *   • Кэш по month-key, чтобы не GET'ать при back-forth между месяцами.
 *   • Auto-save через 500ms debounce после setState — экономит CF requests.
 *   • Optimistic concurrency через `version`. 409 → re-fetch (server wins).
 *   • Inherit от latest prior month если новый месяц пуст на сервере.
 *   • Flush pending PUT при unmount / смене месяца.
 *
 * Этап A НЕ делает:
 *   • WS push для real-time updates (этап B).
 *   • Lock acquire/release (этап C).
 *   • Commit endpoint integration (этап D — пока локально в meta.commit).
 *
 * Перевод между local ScheduleState и server payload:
 *   • Не-committed месяц: PUT только `{ meta }`, shops derive в UI.
 *   • Committed месяц: PUT `{ meta, shopsFrozen, removedFrozen, shippingFrozen }`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  scheduleGet,
  scheduleMonthsList,
  schedulePut,
  type ScheduleMonthSummary,
  type ScheduleSnapshot,
  type ScheduleStateChangedEvent,
  type ScheduleStatePayload,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { inheritForNewMonth, INITIAL_SCHEDULE } from './data';
import type {
  ScheduleMeta,
  ScheduleOverrideRule,
  ScheduleShop,
  ScheduleState,
  WarehouseCode,
} from './types';

const SAVE_DEBOUNCE_MS = 500;
const HISTORY_LIMIT = 50;

/** Ключ кэша для пары (year, month). */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

interface MonthCacheEntry {
  state: ScheduleState;
  version: number;
  committed: number;
  committedBy: string;
  committedByName: string;
  committedAt: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

/**
 * Singleton cache между mount'ами хука. Когда юзер переключает месяцы туда-
 * сюда — не делаем повторный GET для уже загруженного.
 *
 * Ключ — `monthKey(year, month)`. Также служит источником для inheritForNewMonth
 * при переходе на пустой месяц.
 */
const monthCache = new Map<string, MonthCacheEntry>();

/** Список всех month'ов известных серверу (для inheritForNewMonth). */
let monthsListCache: ScheduleMonthSummary[] | null = null;
let monthsListPromise: Promise<ScheduleMonthSummary[]> | null = null;

async function fetchMonthsList(forceRefresh = false): Promise<ScheduleMonthSummary[]> {
  if (!forceRefresh && monthsListCache) return monthsListCache;
  if (!forceRefresh && monthsListPromise) return monthsListPromise;
  monthsListPromise = (async () => {
    try {
      const list = await scheduleMonthsList(api);
      monthsListCache = list;
      return list;
    } catch {
      monthsListCache = monthsListCache ?? [];
      return monthsListCache;
    } finally {
      monthsListPromise = null;
    }
  })();
  return monthsListPromise;
}

/**
 * Конверт ScheduleState → server payload.
 *   committed → пишем frozen-копию shops/removed/shipping.
 *   non-committed → только meta (shops derive'ятся в UI каждый рендер).
 */
function localToServer(local: ScheduleState, committed: boolean): ScheduleStatePayload {
  const meta = local.meta;
  // Frozen-снапшот пишем когда месяц committed серверно ИЛИ имеет локальный
  // meta.commit. Серверный commit-endpoint (этап D) пока не выставляет
  // committed=1, поэтому freeze триггерим по meta.commit — иначе снапшот не
  // сохранится и зафиксированный месяц приедет пустым.
  if (committed || !!meta.commit) {
    return {
      meta,
      shopsFrozen: local.shops,
      removedFrozen: local.removedWarehouses,
      shippingFrozen: local.shippingWarehouses,
    };
  }
  return { meta };
}

/**
 * Конверт server payload → ScheduleState.
 *   Frozen-fields присутствуют → committed snapshot, восстанавливаем shops/removed/shipping.
 *   Иначе — пустые массивы (UI derive'ит из warehouses store).
 */
function serverToLocal(payload: ScheduleStatePayload | null): ScheduleState {
  if (!payload || typeof payload !== 'object') {
    return INITIAL_SCHEDULE;
  }
  const meta = (payload.meta as ScheduleMeta | undefined) ?? INITIAL_SCHEDULE.meta;
  const shopsFrozen = payload.shopsFrozen as ScheduleShop[] | undefined;
  const removedFrozen = payload.removedFrozen as WarehouseCode[] | undefined;
  const shippingFrozen = payload.shippingFrozen as WarehouseCode[] | undefined;
  return {
    meta,
    shops: shopsFrozen ?? [],
    removedWarehouses: removedFrozen ?? [],
    shippingWarehouses: shippingFrozen ?? [],
  };
}

/**
 * Найти ключ ближайшего прошлого месяца в списке. Поиск до 36 месяцев назад.
 */
function findLatestPriorKey(
  list: ScheduleMonthSummary[],
  year: number,
  month: number,
): string | null {
  let y = year;
  let m = month;
  for (let i = 0; i < 36; i++) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    const key = monthKey(y, m);
    if (list.some((it) => monthKey(it.year, it.month) === key)) return key;
  }
  return null;
}

/**
 * Загрузить prior snapshot для inherit. Сначала смотрит в monthCache,
 * иначе GET'ит с сервера.
 */
async function fetchPriorEntryForInherit(
  year: number,
  month: number,
): Promise<MonthCacheEntry | null> {
  const list = await fetchMonthsList();
  const priorKey = findLatestPriorKey(list, year, month);
  if (!priorKey) return null;
  const cached = monthCache.get(priorKey);
  if (cached) return cached;
  const parts = priorKey.split('-').map(Number);
  const py = parts[0]!;
  const pm = parts[1]!;
  try {
    const snap = await scheduleGet(api, { year: py, month: pm });
    if (!snap.state) return null;
    const entry = snapshotToEntry(snap);
    monthCache.set(priorKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function snapshotToEntry(snap: ScheduleSnapshot): MonthCacheEntry {
  return {
    state: serverToLocal(snap.state),
    version: snap.version,
    committed: snap.committed,
    committedBy: snap.committedBy,
    committedByName: snap.committedByName,
    committedAt: snap.committedAt,
    updatedBy: snap.updatedBy,
    updatedByName: snap.updatedByName,
    updatedAt: snap.updatedAt,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

export interface UseScheduleSyncResult {
  /** Текущее локальное состояние графика за (year, month). */
  state: ScheduleState;
  /** Optimistic concurrency token; 0 если на сервере записи нет. */
  version: number;
  /** 1 = месяц зафиксирован, 0 = редактируемый. */
  committed: number;
  /** Login юзера зафиксировавшего месяц (если committed). */
  committedBy: string;
  /** Имя юзера зафиксировавшего месяц. */
  committedByName: string;
  /** ISO timestamp commit'а. */
  committedAt: string;
  /** Login последнего PUT (любого). */
  updatedBy: string;
  /** Имя последнего PUT. */
  updatedByName: string;
  /** ISO timestamp последнего PUT. */
  updatedAt: string;
  /** Идёт начальный GET для (year, month). */
  isLoading: boolean;
  /** PUT в полёте. */
  isSaving: boolean;
  /** Последняя ошибка (network / 409 / server error). */
  error: string | null;
  /** Установить state локально + schedule debounced PUT. */
  setState: (updater: ScheduleState | ((prev: ScheduleState) => ScheduleState)) => void;
  /** Undo (на одну ступень). Возвращает true если что-то откатилось. */
  undo: () => boolean;
  /** Redo. Возвращает true если что-то применилось. */
  redo: () => boolean;
  /** Принудительный flush pending PUT (немедленный сейв). */
  flush: () => Promise<void>;
  /** Re-fetch с сервера, пере-применить локально. */
  reload: () => Promise<void>;
}

/**
 * Главный хук. Возвращает state + setState + meta + ops.
 *
 * Lifecycle:
 *   - mount → GET (year, month). Если null → inherit от latest prior. Если
 *     prior тоже пуст → INITIAL_SCHEDULE с new meta.
 *   - setState(updater) → local mutate + push history + 500ms debounced PUT
 *   - смена year/month → flush previous + GET new
 *   - unmount → flush pending PUT (fire-and-forget)
 */
export function useScheduleSync(year: number, month: number): UseScheduleSyncResult {
  const [entry, setEntry] = useState<MonthCacheEntry>(() => {
    const cached = monthCache.get(monthKey(year, month));
    return cached ?? makeEmptyEntry(year, month);
  });
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !monthCache.has(monthKey(year, month)),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs для history (undo/redo) — не триггерят re-render, dirty flag отдельно.
  const pastRef = useRef<ScheduleState[]>([]);
  const futureRef = useRef<ScheduleState[]>([]);
  const [, setHistoryTick] = useState(0);

  // Pending PUT — таймер debounce'а и фактический Promise для flush().
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightSaveRef = useRef<Promise<void> | null>(null);
  // Latest entry-ref для callback'ов: state в closures стейл к моменту scheduled save.
  const entryRef = useRef(entry);
  entryRef.current = entry;
  // Текущий (year, month) — нужен для PUT после смены месяца чтобы не race'ить.
  const ymRef = useRef({ year, month });
  ymRef.current = { year, month };

  // ── Auto-save (debounced) ────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void doSave();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const doSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Capture снапшот для гарантии что race condition не отправит чужой state.
    const current = entryRef.current;
    const ym = ymRef.current;
    if (current.committed === 1) {
      // Committed — не должны были setState'ить, но защитим.
      return;
    }
    setIsSaving(true);
    setError(null);
    const save = (async () => {
      try {
        const payload = localToServer(current.state, current.committed === 1);
        const res = await schedulePut(api, {
          year: ym.year,
          month: ym.month,
          state: payload,
          expectedVersion: current.version,
        });
        // Обновляем version + cache; state не трогаем (server мог не отдавать его).
        const updated: MonthCacheEntry = {
          ...current,
          version: res.version,
          updatedBy: res.updatedBy,
          updatedByName: res.updatedByName,
          updatedAt: new Date().toISOString(),
        };
        monthCache.set(monthKey(ym.year, ym.month), updated);
        // Только если месяц не сменился пока шёл PUT.
        if (ymRef.current.year === ym.year && ymRef.current.month === ym.month) {
          setEntry(updated);
        }
        // Обновляем months_list cache (новый month может появиться).
        if (!monthsListCache?.some((it) => it.year === ym.year && it.month === ym.month)) {
          // Background refresh — не блокируем save.
          void fetchMonthsList(true);
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'version_conflict') {
          // Server wins. Re-fetch для текущего (year, month).
          setError('version_conflict');
          await reloadInternal(ym.year, ym.month);
          return;
        }
        if (err instanceof ApiError && err.code === 'month_committed') {
          setError('month_committed');
          await reloadInternal(ym.year, ym.month);
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        // eslint-disable-next-line no-console
        console.error('[schedule] save failed', err);
      } finally {
        setIsSaving(false);
      }
    })();
    inflightSaveRef.current = save;
    try { await save; } finally {
      if (inflightSaveRef.current === save) inflightSaveRef.current = null;
    }
  }, []);

  // ── Reload (GET) ─────────────────────────────────────────────────────────
  const reloadInternal = useCallback(
    async (y: number, m: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const snap = await scheduleGet(api, { year: y, month: m });
        if (snap.state) {
          const e = snapshotToEntry(snap);
          monthCache.set(monthKey(y, m), e);
          if (ymRef.current.year === y && ymRef.current.month === m) {
            setEntry(e);
          }
          return;
        }
        // Сервер пуст — пробуем inherit от прошлого месяца.
        const priorEntry = await fetchPriorEntryForInherit(y, m);
        const seed: ScheduleState = priorEntry
          ? inheritForNewMonth(priorEntry.state, y, m)
          : { ...INITIAL_SCHEDULE, meta: { ...INITIAL_SCHEDULE.meta, year: y, month: m } };
        const newEntry: MonthCacheEntry = {
          state: seed,
          version: 0,
          committed: 0,
          committedBy: '',
          committedByName: '',
          committedAt: '',
          updatedBy: '',
          updatedByName: '',
          updatedAt: '',
        };
        monthCache.set(monthKey(y, m), newEntry);
        if (ymRef.current.year === y && ymRef.current.month === m) {
          setEntry(newEntry);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        // eslint-disable-next-line no-console
        console.error('[schedule] reload failed', err);
      } finally {
        if (ymRef.current.year === y && ymRef.current.month === m) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  // ── Month change effect ──────────────────────────────────────────────────
  useEffect(() => {
    const key = monthKey(year, month);
    // Очищаем history при смене месяца (history is per-month).
    pastRef.current = [];
    futureRef.current = [];
    // Flush previous month'а pending PUT (fire-and-forget — мы уже сменили ym).
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      void doSave();
    }
    const cached = monthCache.get(key);
    if (cached) {
      setEntry(cached);
      setIsLoading(false);
      setError(null);
      // Background refresh — если на сервере новее, обновим.
      // (Это compromise: 1 fetch на цикл смены месяца чтобы поймать чужие изменения).
      void reloadInternal(year, month);
      return;
    }
    void reloadInternal(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // ── Initial months_list fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (!monthsListCache) {
      void fetchMonthsList();
    }
  }, []);

  // ── Unmount: flush pending PUT ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        // Fire-and-forget: компонент уже размонтируется.
        void doSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WS event: schedule_state_changed ─────────────────────────────────────
  // Server broadcast'ит после успешного PUT. Sender тоже получает event, но
  // его local version === event.version (только что обновили из PUT response) —
  // дедуплицируем сравнением. Другие клиенты с этим месяцем открытым ре-фетчат.
  // Для месяцев в monthCache (не текущий открытый) — invalidate, чтобы
  // следующий month-switch вытянул свежее.
  useWsEvent<ScheduleStateChangedEvent>('schedule_state_changed', (event) => {
    const evYear = Number(event.year);
    const evMonth = Number(event.month);
    const evVersion = Number(event.version);
    if (!Number.isInteger(evYear) || !Number.isInteger(evMonth)) return;
    const evKey = monthKey(evYear, evMonth);
    const isCurrent = ymRef.current.year === evYear && ymRef.current.month === evMonth;
    if (isCurrent) {
      // Если наш local version >= event.version — это наш собственный PUT или
      // мы уже впереди (редкий case). Skip.
      if (entryRef.current.version >= evVersion) return;
      // Защита от race: если у нас pending PUT (debounce активен) — не reload'им,
      // PUT сам через 500ms схватит 409 и сделает reload.
      if (debounceTimerRef.current || inflightSaveRef.current) return;
      void reloadInternal(evYear, evMonth);
      return;
    }
    // Не текущий месяц — invalidate если в кэше И version stale.
    const cached = monthCache.get(evKey);
    if (cached && cached.version < evVersion) {
      monthCache.delete(evKey);
    }
    // monthsListCache тоже мог стать stale (новый месяц мог появиться).
    if (!monthsListCache?.some((it) => it.year === evYear && it.month === evMonth)) {
      // Force-refresh в фоне — не блокируем UI.
      void fetchMonthsList(true);
    }
  });

  // ── setState API ─────────────────────────────────────────────────────────
  const setState = useCallback(
    (updater: ScheduleState | ((prev: ScheduleState) => ScheduleState)) => {
      setEntry((prev) => {
        const nextState =
          typeof updater === 'function'
            ? (updater as (p: ScheduleState) => ScheduleState)(prev.state)
            : updater;
        if (nextState === prev.state) return prev;
        if (prev.committed === 1 || prev.state.meta.commit) {
          // Read-only — месяц зафиксирован (серверно committed=1 ИЛИ локально
          // через meta.commit). Игнорируем любые mutation попытки.
          return prev;
        }
        pastRef.current.push(prev.state);
        if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
        futureRef.current = [];
        setHistoryTick((v) => v + 1);
        const next: MonthCacheEntry = { ...prev, state: nextState };
        monthCache.set(monthKey(ymRef.current.year, ymRef.current.month), next);
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback((): boolean => {
    // Зафиксированный месяц неизменяем — undo не должен откатывать сам commit.
    if (entryRef.current.state.meta.commit) return false;
    const prevState = pastRef.current.pop();
    if (!prevState) return false;
    setEntry((cur) => {
      futureRef.current.push(cur.state);
      const next: MonthCacheEntry = { ...cur, state: prevState };
      monthCache.set(monthKey(ymRef.current.year, ymRef.current.month), next);
      return next;
    });
    setHistoryTick((v) => v + 1);
    scheduleSave();
    return true;
  }, [scheduleSave]);

  const redo = useCallback((): boolean => {
    if (entryRef.current.state.meta.commit) return false;
    const nextState = futureRef.current.pop();
    if (!nextState) return false;
    setEntry((cur) => {
      pastRef.current.push(cur.state);
      if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
      const next: MonthCacheEntry = { ...cur, state: nextState };
      monthCache.set(monthKey(ymRef.current.year, ymRef.current.month), next);
      return next;
    });
    setHistoryTick((v) => v + 1);
    scheduleSave();
    return true;
  }, [scheduleSave]);

  const flush = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      await doSave();
    } else if (inflightSaveRef.current) {
      await inflightSaveRef.current;
    }
  }, [doSave]);

  const reload = useCallback(async () => {
    await reloadInternal(year, month);
  }, [year, month, reloadInternal]);

  return {
    state: entry.state,
    version: entry.version,
    committed: entry.committed,
    committedBy: entry.committedBy,
    committedByName: entry.committedByName,
    committedAt: entry.committedAt,
    updatedBy: entry.updatedBy,
    updatedByName: entry.updatedByName,
    updatedAt: entry.updatedAt,
    isLoading,
    isSaving,
    error,
    setState,
    undo,
    redo,
    flush,
    reload,
  };
}

function makeEmptyEntry(year: number, month: number): MonthCacheEntry {
  return {
    state: { ...INITIAL_SCHEDULE, meta: { ...INITIAL_SCHEDULE.meta, year, month } },
    version: 0,
    committed: 0,
    committedBy: '',
    committedByName: '',
    committedAt: '',
    updatedBy: '',
    updatedByName: '',
    updatedAt: '',
  };
}

// ── Migration utility (для этапа A.5) ─────────────────────────────────────

/**
 * Принудительно сбросить in-memory cache. Используется после миграции
 * localStorage чтобы свежие данные приехали с сервера.
 */
export function resetScheduleCache(): void {
  monthCache.clear();
  monthsListCache = null;
}

// ── Read-only meta для нескольких месяцев (карточка склада в Базе) ──────────

/** Holidays + overrides месяца для расчёта дат вне Proba (read-only). */
export interface ScheduleMonthMeta {
  /** На сервере есть снапшот этого месяца (график сформирован). */
  exists: boolean;
  /** Месяц зафиксирован. */
  committed: boolean;
  holidays: number[];
  overrides: ScheduleOverrideRule[];
  /** Зафиксированные цеха (committed-месяц) — для исторического дня недели склада. */
  shops: ScheduleShop[];
}

/** In-flight дедуп GET'ов по month-key — N карточек не дают N запросов. */
const inflightMetaGets = new Map<string, Promise<MonthCacheEntry | null>>();

/**
 * Загрузить снапшот месяца read-only. Переиспользует общий monthCache (если
 * месяц уже открыт в Proba — без запроса). `null` = на сервере снапшота нет
 * (график не сформирован). Version-0 / inherited-черновики НЕ считаются
 * сформированными.
 */
async function loadMonthEntry(year: number, month: number): Promise<MonthCacheEntry | null> {
  const key = monthKey(year, month);
  const cached = monthCache.get(key);
  if (cached && (cached.version > 0 || cached.committed === 1)) return cached;
  const inflight = inflightMetaGets.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const snap = await scheduleGet(api, { year, month });
      if (!snap.state || snap.version === 0) return null;
      const entry = snapshotToEntry(snap);
      monthCache.set(key, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inflightMetaGets.delete(key);
    }
  })();
  inflightMetaGets.set(key, p);
  return p;
}

/**
 * Read-only мета нескольких месяцев (holidays + overrides) для расчёта дат
 * доставки в карточке склада. Без save / undo / WS — просто GET + cache.
 * Пустой `months` → ничего не грузит. Ключи результата — `monthKey()`.
 */
export function useScheduleMonthsMeta(
  months: ReadonlyArray<{ year: number; month: number }>,
): Map<string, ScheduleMonthMeta> {
  const keys = months.map((m) => monthKey(m.year, m.month)).join('|');
  const [map, setMap] = useState<Map<string, ScheduleMonthMeta>>(() => new Map());

  useEffect(() => {
    if (months.length === 0) {
      setMap((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, ScheduleMonthMeta>();
      await Promise.all(
        months.map(async (m) => {
          const entry = await loadMonthEntry(m.year, m.month);
          next.set(monthKey(m.year, m.month), entry
            ? {
                exists: true,
                committed: entry.committed === 1 || !!entry.state.meta.commit,
                holidays: entry.state.meta.holidays,
                overrides: entry.state.meta.overrides,
                shops: entry.state.shops,
              }
            : { exists: false, committed: false, holidays: [], overrides: [], shops: [] });
        }),
      );
      if (!cancelled) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return map;
}
