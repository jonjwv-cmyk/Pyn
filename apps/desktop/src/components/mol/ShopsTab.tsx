import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Factory, Phone } from 'lucide-react';
import {
  getWarehouseState,
  groupByWarehouse,
  parseMolQuery,
  type MolRecord,
  type ParsedMolQuery,
  type Warehouse,
  type WarehouseCluster,
  type WarehouseWeekday,
} from '@pyn/core';
import { cn } from '@/lib/cn';
import { useMolStore, useUiStateStore } from '@/lib/stores';
import { useWarehousesStore } from '@/lib/warehouses-store';
import {
  formatMobilePhone,
  formatMolUntil,
  MOL_UNTIL_PILL_CLASS,
  molUntilStatus,
  sortMolRecords,
  splitAndFormatWorkPhones,
} from '@/lib/mol-format';
import { clusterLabel, monthLabel, weekdayShortLabel } from '@/lib/i18n-labels';
import { computeRowDates } from '@/lib/schedule/compute';
import {
  canUseLiveWarehouseScheduleForMonth,
  currentThreeMonths,
  monthKey,
  useScheduleMonthsMeta,
  type ScheduleMonthMeta,
} from '@/lib/schedule/use-schedule-sync';
import { dayToneClass, EditDialog, frozenWeekday } from './WarehouseSidebar';
import type { ContactActionRequest } from './ContactActionDialog';

type WarehouseState = ReturnType<typeof getWarehouseState>;

const CLUSTER_ORDER: WarehouseCluster[] = ['НТМК', 'ВЫЕЗД', 'КХП'];
const DAY_ORDER: WarehouseWeekday[] = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

/** Вертикальный зазор между карточками (Tailwind gap-3 = 12px). */
const CARD_GAP = 12;
/** Короче этого числа цехов виртуализация не нужна — рендерим всё. */
const WINDOW_THRESHOLD = 24;
/** Оценка высоты неизмеренной карточки (px) — fallback до первого замера. */
const EST_CARD_H = 260;

interface ClusterGroup {
  cluster: WarehouseCluster;
  days: WarehouseWeekday[];
}

interface ShopSummary {
  hasScheduled: boolean;
  hasShipping: boolean;
  /** Сколько складов удалено — для чипа «Склады удалены N из M». */
  removedCount: number;
  /** Всего складов в цеху. */
  total: number;
  /** Все склады idle — только тогда показываем «Нет в графике». */
  allIdle: boolean;
  /** Кластеры с днями (компактно: один кластер + перечисление его дней). */
  clusterGroups: ClusterGroup[];
}

/**
 * Сводка по цеху для строки заголовка. Активные «В графике»/«Отгрузка» (если
 * есть) + счётчик удалённых; «Нет в графике» — ТОЛЬКО когда цех целиком idle.
 * Кластеры·дни — сгруппированы по кластеру (НТМК · ПН ВТ СР), дни в DAY_ORDER.
 */
function aggregateShop(warehouses: Warehouse[]): ShopSummary {
  let hasScheduled = false;
  let hasShipping = false;
  let removedCount = 0;
  let idleCount = 0;
  const clusterMap = new Map<WarehouseCluster, Set<WarehouseWeekday>>();
  for (const w of warehouses) {
    const st = getWarehouseState(w);
    if (st === 'scheduled') {
      hasScheduled = true;
      if (w.cluster && w.delivery_day) {
        let set = clusterMap.get(w.cluster);
        if (!set) {
          set = new Set();
          clusterMap.set(w.cluster, set);
        }
        set.add(w.delivery_day);
      }
    } else if (st === 'shipping') {
      hasShipping = true;
    } else if (st === 'removed') {
      removedCount += 1;
    } else {
      idleCount += 1;
    }
  }
  const total = warehouses.length;
  const clusterGroups = [...clusterMap.entries()]
    .map(([cluster, daySet]) => ({ cluster, days: DAY_ORDER.filter((d) => daySet.has(d)) }))
    .sort((a, b) => CLUSTER_ORDER.indexOf(a.cluster) - CLUSTER_ORDER.indexOf(b.cluster));
  return {
    hasScheduled,
    hasShipping,
    removedCount,
    total,
    allIdle: total > 0 && idleCount === total,
    clusterGroups,
  };
}

/**
 * Постоянная подсветка пункта цеха в правом списке (TOC) — мягкая заливка в
 * цветах статусов складов цеха (как hover, но всегда и по статусам):
 *   «В графике» → зелёный, «Отгрузка» → фиолетовый, есть удалённые → красный.
 * Несколько статусов → лёгкий градиент по присутствующим цветам; все удалены →
 * сплошной красный («красный пилл»); только «нет в графике» (idle) → без
 * заливки (как сейчас). Цвета = statusChip-палитра в низкой прозрачности.
 */
function shopTintStyle(warehouses: Warehouse[]): CSSProperties | undefined {
  let scheduled = false;
  let shipping = false;
  let removed = false;
  for (const w of warehouses) {
    const st = getWarehouseState(w);
    if (st === 'scheduled') scheduled = true;
    else if (st === 'shipping') shipping = true;
    else if (st === 'removed') removed = true;
  }
  const stops: string[] = [];
  if (scheduled) stops.push('rgba(125,192,97,0.16)'); // presence-online #7DC061
  if (shipping) stops.push('rgba(140,120,200,0.16)'); // #8C78C8
  if (removed) stops.push('rgba(229,115,115,0.18)'); // danger #E57373
  if (stops.length === 0) return undefined; // только idle → как сейчас (без заливки)
  if (stops.length === 1) return { background: stops[0] };
  return { background: `linear-gradient(135deg, ${stops.join(', ')})` };
}

interface ShopsTabProps {
  /** Единый поиск (склад · цех · телефон) — из MolTopBar. */
  query: string;
  onContactAction: (req: ContactActionRequest) => void;
}

interface Shop {
  name: string;
  warehouses: Warehouse[];
}

interface MonthEntry {
  year: number;
  month: number;
}

/** Код склада как нумерация графика: numeric locale-compare. */
function byWarehouseCode(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true });
}

/** Группировка складов по shop_name → цеха, склады внутри по коду. */
function buildShops(warehouses: Warehouse[]): Shop[] {
  const map = new Map<string, Warehouse[]>();
  for (const w of warehouses) {
    const name = w.shop_name || '—';
    const arr = map.get(name);
    if (arr) arr.push(w);
    else map.set(name, [w]);
  }
  const shops = [...map.entries()].map(([name, ws]) => ({
    name,
    warehouses: [...ws].sort((a, b) => byWarehouseCode(a.id, b.id)),
  }));
  shops.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return shops;
}

/**
 * Совпадение склада с запросом — режимами как в МОЛ (parseMolQuery):
 *   warehouse (4 знака, 3 цифры) → точный номер склада;
 *   phone (> 4 цифр)             → рабочий телефон;
 *   name / email (текст)         → название цеха.
 */
function warehouseMatchesParsed(w: Warehouse, parsed: ParsedMolQuery): boolean {
  switch (parsed.mode) {
    case 'empty':
      return true;
    case 'warehouse': {
      if (parsed.tokens.length === 0) return false;
      const id = w.id.toLowerCase();
      return parsed.tokens.some((tk) => id === tk.toLowerCase());
    }
    case 'phone': {
      const qd = parsed.tokens[0] ?? '';
      return qd.length > 0 && (w.work_phone || '').replace(/\D/g, '').includes(qd);
    }
    default: {
      // name / email → ищем по названию цеха.
      const qn = (parsed.tokens[0] ?? '').toLowerCase();
      return qn.length > 0 && (w.shop_name || '').toLowerCase().includes(qn);
    }
  }
}

/**
 * Persist scroll-позиции контейнера через ui-state-store: restore один раз
 * после hydration (когда есть контент), throttled save (250ms) при скролле.
 * Используется и для ленты карточек, и для правого списка — возврат на вкладку
 * восстанавливает обе позиции (вместе с сохранённым запросом).
 */
function usePersistedScroll(value: number, setValue: (v: number) => void, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<number>(-1);

  useEffect(() => {
    if (!ready || restoredRef.current) return;
    const saved = value;
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = saved;
      lastSavedRef.current = saved;
      restoredRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const onScroll = (): void => {
    const el = ref.current;
    if (!el || !ready || !restoredRef.current) return;
    const cur = el.scrollTop;
    if (Math.abs(cur - lastSavedRef.current) < 8) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedRef.current = cur;
      setValue(cur);
    }, 250);
  };

  return { ref, onScroll };
}

/**
 * Вкладка «Цеха» базы — полноширинные секции цехов с sticky-шапкой (название
 * фиксируется сверху, пока крутятся склады, потом следующий цех). Каждый склад:
 * код + статус + кластер·день; напротив — 3-месячный график (колонки, как в
 * карточке склада); кликабельные телефоны; поля; кнопка «Редактировать» (тот же
 * диалог, что у складов справа). Поиск (склад·цех·телефон) — в шапке (MolTopBar):
 * фильтрует цеха и склады. Стиль — Linear.
 */
export function ShopsTab({ query, onContactAction }: ShopsTabProps) {
  const { t } = useTranslation();
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const molRecords = useMolStore((s) => s.records);

  // §per-цех — число уникальных МОЛ-людей (по табельному) на каждый цех, по всем
  // его складам. Для счётчика «МОЛов: N» в шапке цеха рядом со «складов: N».
  const molCountByShop = useMemo(() => {
    const widToShop = new Map<string, string>();
    for (const w of warehouses) widToShop.set(w.id.trim().toLowerCase(), w.shop_name || '—');
    const byShop = new Map<string, Set<string>>();
    for (const r of molRecords) {
      const shop = widToShop.get(r.warehouseId.trim().toLowerCase());
      if (!shop) continue;
      const key = r.tab.trim() ? `t:${r.tab.trim()}` : `n:${r.fio.trim().toLowerCase()}|${r.mobile.trim()}`;
      let set = byShop.get(shop);
      if (!set) { set = new Set<string>(); byShop.set(shop, set); }
      set.add(key);
    }
    const out = new Map<string, number>();
    for (const [shop, set] of byShop) out.set(shop, set.size);
    return out;
  }, [warehouses, molRecords]);

  // §мол-по-дату — записи МОЛ, сгруппированные по складу (для поп-овера в строке
  // склада: люди, ответственные именно за этот склад). Ключ — нижний регистр кода
  // (id склада может содержать букву: 824Т / 824T). Источник — groupByWarehouse.
  const molByWarehouse = useMemo(() => {
    const m = new Map<string, MolRecord[]>();
    for (const [wid, recs] of groupByWarehouse(molRecords)) {
      m.set(wid.trim().toLowerCase(), recs);
    }
    return m;
  }, [molRecords]);

  // Persist scroll обеих колонок: лента карточек + правый список цехов. Возврат
  // на вкладку восстанавливает обе позиции (запрос — через shopsQuery).
  const shopsScrollTop = useUiStateStore((s) => s.shopsScrollTop);
  const setShopsScrollTop = useUiStateStore((s) => s.setShopsScrollTop);
  const shopsListScrollTop = useUiStateStore((s) => s.shopsListScrollTop);
  const setShopsListScrollTop = useUiStateStore((s) => s.setShopsListScrollTop);
  const [uiHydrated, setUiHydrated] = useState(() => useUiStateStore.persist.hasHydrated());
  const didInitScrollRef = useRef(false);

  const months = useMemo(() => currentThreeMonths(), []);
  const metaMap = useScheduleMonthsMeta(months);

  const shops = useMemo(() => buildShops(warehouses), [warehouses]);
  // Стабильный № цеха = позиция в ПОЛНОМ списке (по алфавиту). При фильтрации
  // поиском номер НЕ пересчитывается — и карточка, и правый список показывают
  // один и тот же реальный номер цеха.
  const shopOrder = useMemo(() => {
    const m = new Map<string, number>();
    shops.forEach((sh, i) => m.set(sh.name, i + 1));
    return m;
  }, [shops]);

  // Канон ширины правого списка = самое длинное название цеха в одну строку.
  // Меряем натуральную ширину всех названий скрытым sizer'ом: короче канона —
  // одна строка без многоточия, длиннее — перенос на вторую строку.
  const nameSizerRef = useRef<HTMLDivElement>(null);
  const [nameColW, setNameColW] = useState(150);
  useLayoutEffect(() => {
    const el = nameSizerRef.current;
    if (!el) return;
    let max = 0;
    for (const child of Array.from(el.children)) {
      const w = (child as HTMLElement).offsetWidth;
      if (w > max) max = w;
    }
    if (max > 0) setNameColW(Math.min(Math.max(Math.ceil(max) + 2, 120), 260));
  }, [shops]);

  const parsed = useMemo(() => parseMolQuery(query), [query]);
  const filteredShops = useMemo<{ name: string; rows: Warehouse[]; all: Warehouse[] }[]>(() => {
    // `all` — полный состав цеха (счётчик активных + сводка), `rows` — что
    // показываем (при фильтре только совпавшие). Пустой запрос — показываем всё.
    // Поиск по складам → один цех с N складами, либо несколько цехов.
    if (parsed.mode === 'empty') {
      return shops.map((sh) => ({ name: sh.name, rows: sh.warehouses, all: sh.warehouses }));
    }
    return shops
      .map((sh) => ({
        name: sh.name,
        rows: sh.warehouses.filter((w) => warehouseMatchesParsed(w, parsed)),
        all: sh.warehouses,
      }))
      .filter((sh) => sh.rows.length > 0);
  }, [shops, parsed]);

  // Persist scroll обеих колонок одним хуком (лента + правый список).
  const scrollReady = uiHydrated && filteredShops.length > 0;
  const feedScroll = usePersistedScroll(shopsScrollTop, setShopsScrollTop, scrollReady);
  const listScroll = usePersistedScroll(shopsListScrollTop, setShopsListScrollTop, scrollReady);

  useEffect(() => {
    if (uiHydrated) return;
    const unsub = useUiStateStore.persist.onFinishHydration(() => setUiHydrated(true));
    return unsub;
  }, [uiHydrated]);

  // Смена запроса → лента к верху. Warehouse-режим центрируется CSS'ом (my-auto).
  // Первый прогон (mount) пропускаем — scroll восстанавливает хук persist.
  useEffect(() => {
    const root = feedScroll.ref.current;
    if (!root) return;
    if (!didInitScrollRef.current) {
      didInitScrollRef.current = true;
      return;
    }
    root.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const isEmpty = warehouses.length === 0;
  // Поиск по складам — результат центрируем по вертикали (1-2 совпадения ровно
  // по центру; список растёт центрированным блоком, при переполнении — скролл
  // сверху). Пустой / цех / телефон — обычный список сверху.
  const centered = parsed.mode === 'warehouse';

  // ── Оконная виртуализация ленты ──────────────────────────────────────────
  // Сайдбар анимирует ширину 220ms → контент рефлоутится каждый кадр. Чтобы
  // пересчитывались только видимые карточки (а не все ~55), держим в DOM «окно»
  // (видимое + буфер сверху/снизу), остальные — заглушки точной высоты. Слот-
  // обёртка обычная (не контейнит/не клипает) → sticky-шапка и докующийся низ
  // целы (canonical-рамка). Высоты меряем у отрисованных карточек и кэшируем —
  // заглушка занимает ровно столько же, поэтому замена карточка↔заглушка не
  // двигает раскладку и позицию скролла.
  const heightsRef = useRef<number[]>([]);
  const reportHeight = useCallback((i: number, h: number) => {
    heightsRef.current[i] = h;
  }, []);
  // null = рендерим всё (короткий/отфильтрованный список или до первого расчёта).
  const [windowRange, setWindowRange] = useState<{ start: number; end: number } | null>(null);
  const useWindowing = !centered && filteredShops.length > WINDOW_THRESHOLD;

  // Сброс кэша высот + окна при смене состава списка (индексы → другие цеха).
  // Делаем в рендере через ref-страж, а НЕ в эффекте: layout-эффект слота
  // (ребёнок) отрабатывает раньше эффекта родителя, поэтому сброс из эффекта
  // затёр бы только что измеренные высоты.
  const listSig = `${filteredShops.length}|${query}`;
  const listSigRef = useRef(listSig);
  if (listSigRef.current !== listSig) {
    listSigRef.current = listSig;
    heightsRef.current = [];
    setWindowRange(null);
  }

  const recomputeWindow = useCallback(() => {
    const root = feedScroll.ref.current;
    if (!root || !useWindowing) {
      setWindowRange(null);
      return;
    }
    const n = filteredShops.length;
    const scrollTop = root.scrollTop;
    const vh = root.clientHeight;
    const buffer = vh * 2; // видимое + ~2 экрана сверху/снизу (плавная подгрузка)
    const top = scrollTop - buffer;
    const bottom = scrollTop + vh + buffer;
    const heights = heightsRef.current;
    let y = 0;
    let start = -1;
    let end = n - 1;
    for (let i = 0; i < n; i++) {
      const h = heights[i] || EST_CARD_H;
      if (start === -1 && y + h >= top) start = i;
      if (y > bottom) {
        end = i - 1;
        break;
      }
      y += h + CARD_GAP;
    }
    if (start === -1) start = 0;
    if (end < start) end = start;
    setWindowRange((prev) =>
      prev && prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, [useWindowing, filteredShops.length, feedScroll.ref]);

  // Активируем окно после первого полного рендера (высоты уже измерены слотами
  // в useLayoutEffect). Restore скролла затем сам шлёт scroll-событие → окно
  // пересчитается под сохранённую позицию.
  useEffect(() => {
    if (!useWindowing) {
      setWindowRange(null);
      return;
    }
    const id = requestAnimationFrame(recomputeWindow);
    return () => cancelAnimationFrame(id);
  }, [useWindowing, recomputeWindow]);

  // rAF-throttle пересчёта окна на скролле (поверх persist-throttle feedScroll).
  const winRafRef = useRef<number | null>(null);
  const handleFeedScroll = (): void => {
    feedScroll.onScroll();
    if (winRafRef.current != null) return;
    winRafRef.current = requestAnimationFrame(() => {
      winRafRef.current = null;
      recomputeWindow();
    });
  };
  useEffect(
    () => () => {
      if (winRafRef.current != null) cancelAnimationFrame(winRafRef.current);
    },
    [],
  );

  const cards = filteredShops.map((shop, i) => {
    const visible =
      !useWindowing || !windowRange || (i >= windowRange.start && i <= windowRange.end);
    return (
      <ShopSlot
        key={shop.name}
        index={i}
        shopId={shop.name}
        visible={visible}
        height={heightsRef.current[i]}
        reportHeight={reportHeight}
      >
        <ShopCard
          name={shop.name}
          rows={shop.rows}
          all={shop.all}
          molCount={molCountByShop.get(shop.name) ?? 0}
          molByWarehouse={molByWarehouse}
          idx={shopOrder.get(shop.name) ?? 0}
          months={months}
          metaMap={metaMap}
          query={query}
          onContactAction={onContactAction}
        />
      </ShopSlot>
    );
  });

  // Прыжок ленты к выбранному цеху (как клик по закреплённой новости): плавный
  // скролл к карточке цеха, заголовок чуть ниже верха ленты.
  const jumpToShop = (name: string): void => {
    const root = feedScroll.ref.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-shop-id="${CSS.escape(name)}"]`);
    if (!target) return;
    const tRect = target.getBoundingClientRect();
    const rRect = root.getBoundingClientRect();
    const top = root.scrollTop + (tRect.top - rRect.top) - 12;
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  return (
    // Единое поле 16px по периметру (как на всех листах). Верх даёт обложка
    // (16px, см. ниже), бока — px-4 карточек / pr-4 списка (16px). Снизу — pb-4
    // здесь: инсетит ОБА скролл-вьюпорта (лента + список) на 16px, чтобы контент
    // и при прокрутке заканчивался на этой линии (а не упирался в край). Фон-
    // паттерн — во всю карточку (на root); обложка/sticky-шапка не тронуты.
    <div className="mol-pattern-bg flex min-h-0 flex-1 overflow-hidden pb-4">
      {/* ЛЕВО — лента карточек цехов (смещена влево, как новости). */}
      <div ref={feedScroll.ref} onScroll={handleFeedScroll} className="min-w-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Factory className="h-9 w-9 text-text-muted/25" strokeWidth={1.2} />
            <p className="text-[12.5px] text-text-muted">{t('shops.empty')}</p>
          </div>
        ) : filteredShops.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-center text-[12.5px] text-text-muted">{t('shops.nothing_found')}</p>
          </div>
        ) : (
          // ЕДИНАЯ раскладка для списка И поиска. Полоса-обложка (sticky top-0,
          // фон-паттерн) ВЫШЕ шапки (32px) и ПОД ней по z (z-[5] < шапка z-10):
          // прячет строки/линии в зазоре над шапкой И заполняет вырез
          // скруглённого угла шапки фоном. В потоке занимает 16px (h-8 + -mb-4)
          // = верхний отступ-периметр. centered (поиск) → min-h-full + m-auto
          // центрируют по вертикали; иначе обычный список сверху.
          <div className={cn('flex flex-col', centered && 'min-h-full')}>
            {/* Верхняя кромка рамки 16px НАД шапками (z-20 > шапка z-10): уезжающая
                при докинге шапка клипается ровно о линию 16px (как контент правого
                списка), а не наезжает на отступ. h-4 -mb-4 = нулевой вклад в поток
                (отступ даёт обложка ниже). */}
            <div className="mol-pattern-bg pointer-events-none sticky top-0 z-[20] -mb-4 h-4 shrink-0" aria-hidden />
            {/* Обложка-заполнитель ПОД шапками (z-5 < z-10): прячет строки/линии
                над пристикованной шапкой и заполняет вырез её скруглённого верха
                паттерном. h-8 -mb-4 = верхний отступ-периметр 16px. */}
            <div className="mol-pattern-bg pointer-events-none sticky top-0 z-[5] -mb-4 h-8 shrink-0" aria-hidden />
            <div className={cn('flex w-full flex-col gap-3 px-4', centered && 'm-auto')}>{cards}</div>
          </div>
        )}
      </div>

      {/* ПРАВО — «полоса» с нумерованным списком цехов (как закреплённые
          новости). Клик → лента прыгает к цеху. Прозрачная: за списком
          проступает фон-логотип. Скроллится сама, если цехов много. */}
      <aside
        ref={listScroll.ref}
        onScroll={listScroll.onScroll}
        style={{ width: nameColW + 68 }}
        className="flex shrink-0 flex-col overflow-y-auto mt-4 pl-2 pr-4"
      >
        {/* Невидимый sizer — натуральная ширина всех названий (одной строкой);
            ширину колонки фиксируем по самому длинному (канон). Absolute — не
            влияет на раскладку и центрирование. */}
        <div ref={nameSizerRef} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap">
          {shops.map((sh) => (
            <span key={sh.name} className="block text-[12px] font-medium">{sh.name}</span>
          ))}
        </div>
        {/* my-auto — список центрируется по вертикали как карточки (warehouse-
            режим); при переполнении схлопывается → скролл сверху. */}
        <div className={cn('flex w-full flex-col gap-0.5', centered && 'my-auto')}>
          {filteredShops.map((shop) => (
            <button
              key={shop.name}
              type="button"
              onClick={() => jumpToShop(shop.name)}
              title={shop.name}
              style={shopTintStyle(shop.all)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text-secondary outline-none transition-[color,background-color,filter] duration-150 hover:bg-accent-clay/[0.06] hover:brightness-110 hover:text-text-strong"
            >
              <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-text-muted">
                {shopOrder.get(shop.name) ?? 0}
              </span>
              <span className="min-w-0 flex-1 break-words leading-snug line-clamp-2 text-[12px] font-medium">
                {shop.name}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

/**
 * Слот-обёртка карточки цеха для оконной виртуализации. Видимый слот рендерит
 * карточку и меряет её высоту (ResizeObserver) → кэш в родителе. Невидимый —
 * заглушка ровно той же высоты, чтобы раскладка и позиция скролла не дёргались.
 * Обычный блок (без contain/overflow) → sticky-шапка и докующийся низ работают
 * относительно ленты так же, как без обёртки. data-shop-id здесь (а не на
 * article) → есть в DOM и у заглушки, поэтому jumpToShop находит цель вне окна.
 */
function ShopSlot({
  index,
  shopId,
  visible,
  height,
  reportHeight,
  children,
}: {
  index: number;
  shopId: string;
  visible: boolean;
  height: number | undefined;
  reportHeight: (index: number, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Меряем высоту, пока слот видим (карточка в DOM). ResizeObserver ловит и
  // изменение от анимации сайдбара (меняется ширина → может измениться высота).
  useLayoutEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const h = el.offsetHeight;
      if (h > 0) reportHeight(index, h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, index, reportHeight]);

  return (
    <div
      ref={ref}
      data-shop-id={shopId}
      className="shrink-0"
      style={visible ? undefined : { height: height && height > 0 ? height : EST_CARD_H }}
    >
      {visible ? children : null}
    </div>
  );
}

function ShopCard({
  name,
  rows,
  all,
  molCount,
  molByWarehouse,
  idx,
  months,
  metaMap,
  query,
  onContactAction,
}: {
  name: string;
  /** Склады для показа (при фильтре — только совпавшие). */
  rows: Warehouse[];
  /** Полный состав цеха — для счётчика активных и сводки. */
  all: Warehouse[];
  /** Число уникальных МОЛ-людей на цех — для «МОЛов: N» в шапке. */
  molCount: number;
  /** МОЛ-записи по складу (нижний регистр кода) — для поп-овера в строке склада. */
  molByWarehouse: Map<string, MolRecord[]>;
  idx: number;
  months: MonthEntry[];
  metaMap: Map<string, ScheduleMonthMeta>;
  query: string;
  onContactAction: (req: ContactActionRequest) => void;
}) {
  const { t } = useTranslation();
  const { hasScheduled, hasShipping, removedCount, total, allIdle, clusterGroups } = useMemo(
    () => aggregateShop(all),
    [all],
  );
  // Счётчик в шапке — активные (не удалённые) склады цеха «сейчас»; все удалены → 0.
  const activeCount = useMemo(() => all.filter((w) => !w.is_removed).length, [all]);
  const hasSummary =
    hasScheduled || hasShipping || removedCount > 0 || allIdle || clusterGroups.length > 0;

  // Высота шапки → точка докинга низа (ровно под кромкой шапки). Меряем вживую.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headBottom, setHeadBottom] = useState(72);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeadBottom(16 + el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // data-shop-id перенесён на слот-обёртку (ShopSlot) — он есть в DOM и для
    // заглушек, поэтому jumpToShop находит цель даже когда карточка вне окна.
    <article>
      {/* Sticky-шапка остаётся на месте (top-4). Скругление верха + верхняя/
          боковые рамки — на шапке (линии загибаются в скругление). Снизу рамки/
          тени нет — clay-заливка плавно гаснет в фон (to-transparent). Строки и
          линии над шапкой прячет sticky-полоса-обложка вверху ленты. */}
      <div className="sticky top-4 z-10">
        <div
          ref={headerRef}
          className="flex items-center gap-2.5 rounded-t-xl border border-b-0 border-border-subtle/60 bg-bg-surface bg-gradient-to-b from-accent-clay/[0.16] to-transparent px-4 py-3"
        >
          {/* № цеха — по вертикали по центру между двумя строками. */}
        <span className="flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-md bg-accent-clay/15 px-1.5 text-[12px] font-bold tabular-nums text-accent-clay">
          {idx}
        </span>
        {/* Две строки: 1) название цеха целиком (во всю ширину), 2) пиллы
            (статус / кластеры·дни / «удалены N из M»). */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-[14px] font-semibold leading-snug tracking-[-0.01em] text-text-strong">
            <Highlight text={name} query={query} />
          </h3>
          {hasSummary && (
            <div className="flex flex-wrap items-center gap-1.5">
              {hasScheduled && <StatusChip state="scheduled" />}
              {hasShipping && <StatusChip state="shipping" />}
              {removedCount > 0 && (
                <span className="inline-flex items-center rounded bg-danger/15 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-danger">
                  {t('shops.removed_count', { n: removedCount, total })}
                </span>
              )}
              {clusterGroups.map((g) => (
                <span
                  key={g.cluster}
                  className="rounded bg-bg-hover px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-text-secondary"
                >
                  {clusterLabel(g.cluster, t)} · {g.days.map((d) => weekdayShortLabel(d, t)).join(' ')}
                </span>
              ))}
              {allIdle && <StatusChip state="idle" />}
            </div>
          )}
        </div>
          {/* Кол-во складов + МОЛов — справа, по центру между строками. */}
          <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-text-muted">
            <span>{t('shops.warehouses_n', { n: activeCount })}</span>
            <span className="text-text-muted/40">·</span>
            <span>{t('shops.mols_n', { n: molCount })}</span>
          </span>
        </div>
        {/* Прозрачный удлинитель шапки (14px = высота докующегося низа):
            продлевает её sticky-зону, чтобы шапка открепилась ОДНОВРЕМЕННО с
            низом → уходят единым блоком. Тело перекрывает его (-mt-3.5). */}
        <div aria-hidden className="h-3.5" />
      </div>

      {/* Тело — только боковые рамки + bg. -mt-3.5 заводит верх тела под
          прозрачный удлинитель шапки (зазора нет). Низ рисует докующийся ниже. */}
      <div className="-mt-3.5 border-x border-border-subtle/60 bg-bg-surface">
        <div className="flex flex-col px-4 pb-1">
          {rows.map((w) => (
            <WarehouseRow
              key={w.id}
              w={w}
              mols={molByWarehouse.get(w.id.trim().toLowerCase()) ?? []}
              months={months}
              metaMap={metaMap}
              query={query}
              onContactAction={onContactAction}
            />
          ))}
        </div>
      </div>
      {/* Докующийся низ карточки: скруглённый низ + нижняя/боковые рамки. Sticky
          top = нижняя кромка шапки (headBottom): при сворачивании низ доезжает и
          ОСТАНАВЛИВАЕТСЯ ровно под шапкой — карточка = «шапка + ровный скруглённый
          низ», бока плавно переходят в скругление. Слой НИЖЕ шапки (z-[9], между
          обложкой z-5 и шапкой z-10): стык под шапкой перекрыт ей — без хвоста.
          -mt-3.5 совмещает низ с телом (в покое незаметен). Спейсер-контент ниже
          (= зазор между карточками) даёт sticky ход закрепиться. */}
      <div
        aria-hidden
        style={{ top: headBottom }}
        className="pointer-events-none sticky z-[11] h-3.5 rounded-b-xl border border-t-0 border-border-subtle/60 bg-bg-surface"
      />
      <div aria-hidden className="h-1" />
    </article>
  );
}

function WarehouseRow({
  w,
  mols,
  months,
  metaMap,
  query,
  onContactAction,
}: {
  w: Warehouse;
  /** МОЛ, ответственные именно за этот склад — для пилюли-счётчика + поп-овера. */
  mols: MolRecord[];
  months: MonthEntry[];
  metaMap: Map<string, ScheduleMonthMeta>;
  query: string;
  onContactAction: (req: ContactActionRequest) => void;
}) {
  const { t } = useTranslation();
  const state = getWarehouseState(w);
  const phones = w.work_phone ? splitAndFormatWorkPhones(w.work_phone) : [];

  const hasFields = !!(w.description || w.designation || w.keeper || w.legacy_id || w.shop_code);

  return (
    <div data-wh-id={w.id.toLowerCase()} className="border-t border-border-subtle/25 py-3 first:border-t-0">
      {/* Шапка строки: код + статус + кластер·день; справа «Редактировать». */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold tabular-nums text-text-strong">
            <Highlight text={w.id} query={query} />
          </span>
          <StatusChip state={state} />
          {state === 'scheduled' && w.cluster && w.delivery_day && (
            <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-text-secondary">
              {clusterLabel(w.cluster, t)} · {weekdayShortLabel(w.delivery_day, t)}
            </span>
          )}
          {mols.length > 0 && (
            <WarehouseMolsPill warehouseId={w.id} records={mols} onContactAction={onContactAction} />
          )}
        </div>
        <EditDialog warehouse={w} />
      </div>

      {/* Тело — три колонки: телефоны | поля | график. Телефоны и график
          сжаты по содержимому (max-content): график вмещает свои числа в одну
          строку (до 7), а когда графика нет — не оставляет пустоту справа.
          Поля (данные склада) забирают всё оставшееся место (1fr) → влезают в
          одну строку без переносов. */}
      <div className="mt-2 grid grid-cols-[140px_minmax(0,1fr)_max-content] items-start gap-x-6">
        {/* 1 — телефоны (кликабельные). */}
        <div className="min-w-0">
          {phones.length > 0 ? (
            <div className="flex flex-col gap-1">
              {phones.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    onContactAction({
                      kind: 'callWarehouse',
                      target: p,
                      display: p,
                      contactName: `${t('mol.warehouse')} ${w.id}`,
                    })
                  }
                  className={cn(
                    '-mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-left',
                    'text-[13px] font-semibold tabular-nums text-text-strong',
                    'transition-colors hover:bg-bg-hover',
                  )}
                >
                  <Phone className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                  <Highlight text={p} query={query} />
                </button>
              ))}
            </div>
          ) : (
            <NoData />
          )}
        </div>

        {/* 2 — поля: Описание / Обозначение / Кладовщик; затем Склад до / код. */}
        <div className="min-w-0">
          {hasFields ? (
            <div className="flex flex-col gap-0.5 text-[12px] leading-snug">
              {w.description && <Field label={t('mol_sidebar.field_description')} value={w.description} />}
              {w.designation && <Field label={t('mol_sidebar.field_designation')} value={w.designation} />}
              {w.keeper && <Field label={t('mol_sidebar.field_keeper')} value={w.keeper} />}
              {(w.legacy_id || w.shop_code) && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {w.legacy_id && <Field label={t('mol_sidebar.field_legacy_id')} value={w.legacy_id} mono />}
                  {w.shop_code && <Field label={t('mol_sidebar.field_code')} value={w.shop_code} mono />}
                </div>
              )}
            </div>
          ) : (
            <NoData />
          )}
        </div>

        {/* 3 — график: 3 строки (месяцы), рядом — дни. */}
        <div className="min-w-0">
          {state === 'scheduled' && w.delivery_day ? (
            <ScheduleRows warehouse={w} weekday={w.delivery_day} months={months} metaMap={metaMap} />
          ) : (
            <NoData />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Пилюля-счётчик МОЛ конкретного склада в строке цеха (рядом со Статус/Кластер).
 * Клик → поп-овер со списком ответственных: ФИО, мобильный телефон (кликабельный),
 * и срок «по {дата}» цветом по близости дедлайна (красный/жёлтый/clay) — если он
 * есть; нет срока (ответственность бессрочна) → строка без пилюли срока. Список
 * сортируется как везде (работающие сверху, затем по ФИО) и скроллится, если длинный.
 */
function WarehouseMolsPill({
  warehouseId,
  records,
  onContactAction,
}: {
  warehouseId: string;
  records: MolRecord[];
  onContactAction: (req: ContactActionRequest) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => sortMolRecords(records), [records]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t('shops.mols_of_warehouse')}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide transition-colors',
            open
              ? 'bg-accent-clay/15 text-accent-clay'
              : 'bg-bg-hover text-text-secondary hover:bg-accent-clay/[0.10] hover:text-accent-clay',
          )}
        >
          <span>{t('shops.mols_short')}</span>
          <span className="tabular-nums">{records.length}</span>
          <ChevronDown
            className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-180')}
            strokeWidth={2}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            'z-50 flex max-h-[340px] w-[300px] flex-col rounded-xl border border-border-default bg-bg-elevated p-2 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <div className="mb-1.5 flex items-baseline gap-1.5 px-1.5">
            <span className="text-[11px] font-semibold text-text-muted">
              {t('shops.mols_of_warehouse')}
            </span>
            <span className="text-[11px] font-bold tabular-nums text-text-strong">{warehouseId}</span>
          </div>
          <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
            {sorted.map((r, i) => (
              <MolPopoverRow
                key={`${r.tab || r.fio}-${i}`}
                record={r}
                onContactAction={onContactAction}
                onClose={() => setOpen(false)}
              />
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Строка поп-овера МОЛ склада: ФИО + моб.телефон (звонок) + срок «по {дата}». */
function MolPopoverRow({
  record,
  onContactAction,
  onClose,
}: {
  record: MolRecord;
  onContactAction: (req: ContactActionRequest) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mobile = formatMobilePhone(record.mobile);
  const until = record.warehouseUntil.trim();

  return (
    <li className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-bg-hover">
      <div className="min-w-0 flex-1">
        <div className="break-words text-[12px] font-medium leading-snug text-text-strong">
          {record.fio || '—'}
        </div>
        {mobile ? (
          <button
            type="button"
            onClick={() => {
              onContactAction({
                kind: 'call',
                target: record.mobile,
                display: mobile,
                contactName: record.fio || t('mol.contact_unknown'),
              });
              onClose();
            }}
            className="mt-0.5 flex items-center gap-1 text-left text-[11px] tabular-nums text-text-muted transition-colors hover:text-accent-clay"
          >
            <Phone className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            {mobile}
          </button>
        ) : (
          <div className="mt-0.5 text-[11px] text-text-muted/55">—</div>
        )}
      </div>
      {until && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ring-1',
            MOL_UNTIL_PILL_CLASS[molUntilStatus(until)],
          )}
        >
          по {formatMolUntil(until)}
        </span>
      )}
    </li>
  );
}

function ScheduleRows({
  warehouse,
  weekday,
  months,
  metaMap,
}: {
  warehouse: Warehouse;
  weekday: WarehouseWeekday;
  months: MonthEntry[];
  metaMap: Map<string, ScheduleMonthMeta>;
}) {
  const { t } = useTranslation();
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();

  return (
    <div className="flex flex-col gap-1">
      {months.map((m) => {
        const meta = metaMap.get(monthKey(m.year, m.month));
        const frozen = meta ? frozenWeekday(meta.shops, warehouse.id) : null;
        const monthWeekday = meta?.shops.length
          ? frozen
          : canUseLiveWarehouseScheduleForMonth(m.year, m.month)
            ? weekday
            : null;
        const weekdayChanged = monthWeekday !== weekday;
        const days =
          meta && meta.exists && meta.holidays.length > 0
            ? monthWeekday
              ? computeRowDates(m.year, m.month, monthWeekday, [{ code: warehouse.id }], meta.holidays, meta.overrides)
              : []
            : null;
        return (
          <div key={`${m.year}-${m.month}`} className="flex items-baseline gap-2">
            <span className="w-[52px] shrink-0 whitespace-nowrap text-[10.5px] font-medium capitalize text-text-muted">
              {monthLabel(m.month, t)}
            </span>
            {weekdayChanged && monthWeekday && (
              <span className="rounded bg-accent-clay/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-accent-clay">
                {weekdayShortLabel(monthWeekday, t)}
              </span>
            )}
            {days === null ? (
              <span className="text-[10px] italic text-text-muted/70">
                {t('mol_sidebar.schedule_not_formed')}
              </span>
            ) : days.length === 0 ? (
              <span className="text-[11px] text-text-muted/70">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {days.map((d) => (
                  <span
                    key={d}
                    className={cn(
                      'flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 text-[10.5px] font-medium tabular-nums',
                      dayToneClass(m.year, m.month, d, todayY, todayM, todayD),
                    )}
                  >
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusChip({ state }: { state: WarehouseState }) {
  const { t } = useTranslation();
  const cfg: Record<WarehouseState, { label: string; cls: string }> = {
    scheduled: { label: t('shops.status_scheduled'), cls: 'bg-presence-online/15 text-presence-online' },
    shipping: { label: t('shops.status_shipping'), cls: 'bg-[#8C78C8]/20 text-[#8C78C8]' },
    removed: { label: t('shops.status_removed'), cls: 'bg-danger/15 text-danger' },
    idle: { label: t('shops.status_idle'), cls: 'bg-bg-hover text-text-muted' },
  };
  const { label, cls } = cfg[state];
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[10.5px] font-semibold tracking-wide', cls)}>
      {label}
    </span>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="break-words">
      <span className="text-text-muted">{label}: </span>
      <span className={mono ? 'font-mono tabular-nums text-text-primary' : 'text-text-primary'}>{value}</span>
    </span>
  );
}

/** Плейсхолдер пустой колонки — место сохраняется, колонки не сдвигаются. */
function NoData() {
  const { t } = useTranslation();
  return <span className="text-[11.5px] italic text-text-muted/55">{t('shops.no_data')}</span>;
}

function markRange(text: string, start: number, end: number): JSX.Element {
  return (
    <>
      {text.slice(0, start)}
      {/* Пилл-обводка (clay outline + мягкое свечение) — как в МОЛ и в графике. */}
      <mark className="rounded-[3px] bg-accent-clay/10 px-0.5 text-text-strong shadow-[0_0_0_1px_rgba(217,119,87,0.9),0_0_5px_1px_rgba(217,119,87,0.3)]">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

/**
 * Подсветка найденного: совпавшая подстрока запроса в тексте (название цеха /
 * номер склада / телефон). Сначала прямое substring-совпадение; для телефона —
 * совпадение по цифрам сквозь пробелы формата («49 71 95» ← «7195»).
 */
function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const direct = text.toLowerCase().indexOf(q.toLowerCase());
  if (direct !== -1) return markRange(text, direct, direct + q.length);
  // Телефон: цифры запроса в цифрах текста (учитываем пробелы формата).
  const qd = q.replace(/\D/g, '');
  if (qd.length === 0) return <>{text}</>;
  const digitPos: number[] = [];
  let digits = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch >= '0' && ch <= '9') {
      digitPos.push(i);
      digits += ch;
    }
  }
  const di = digits.indexOf(qd);
  if (di === -1) return <>{text}</>;
  return markRange(text, digitPos[di]!, digitPos[di + qd.length - 1]! + 1);
}
