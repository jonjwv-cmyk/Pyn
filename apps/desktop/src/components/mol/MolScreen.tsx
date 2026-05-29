import { useMemo, useState } from 'react';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { cn } from '@/lib/cn';
import { useMolStore, useUiStateStore } from '@/lib/stores';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { sortMolRecords } from '@/lib/mol-format';
import {
  dedupeMolByPerson,
  groupByWarehouse,
  matchesMolQuery,
  parseMolQuery,
  type MolRecord,
} from '@pyn/core';
import { ContactActionDialog, type ContactActionRequest } from './ContactActionDialog';
import { MolEmptyView, type MolEmptyState } from './MolEmptyView';
import { MolTable } from './MolTable';
import { MolTopBar } from './MolTopBar';
import { ShopsTab } from './ShopsTab';
import { WarehouseSidebar } from './WarehouseSidebar';

/**
 * Раздел «МОЛы» — поиск работников + закреплённых складов.
 *
 * Layout:
 *   ┌── MolTopBar ───────────────────────────────────────────────────┐
 *   │ ┌── table area (relative для composer'a) ───┬── sidebar ────┐ │
 *   │ │ MolTable (scroll, padding-bottom ~70px)   │ Warehouse     │ │
 *   │ │ MolComposer (absolute bottom, blur)       │ cards         │ │
 *   │ └────────────────────────────────────────────┴───────────────┘ │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Composer absolute → rows проходят ПОД ним с backdrop-blur размытием
 * (Apple/iOS sticky-composer feel, как в Chats/News).
 *
 * Все клики по phone/email проходят через ContactActionDialog —
 * confirmation prompt прежде чем открыть tel:/mailto:.
 */
export function MolScreen() {
  const records = useMolStore((s) => s.records);
  const meta = useMolStore((s) => s.meta);
  const status = useMolStore((s) => s.status);
  const errorMessage = useMolStore((s) => s.errorMessage);
  // Query + scrollTop — persistent. Загружены из safeStorage в момент mount'a
  // store'а (synchronous, persisted state восстанавливается до первого render'a).
  const query = useUiStateStore((s) => s.molQuery);
  const setQuery = useUiStateStore((s) => s.setMolQuery);
  const [actionRequest, setActionRequest] = useState<ContactActionRequest | null>(null);

  // §v1.2.14 — initMol() и useWsEvent('base_changed') переехали в App.tsx.
  // §pyn-1.2.27 — inline-фильтр «Уточнить по найденному» удалён: per-column
  // фильтры в MolTable покрывают эту функциональность.

  const parsed = useMemo(() => parseMolQuery(query), [query]);

  const filtered = useMemo(() => {
    if (parsed.mode === 'empty') return [];
    return records.filter((r) => matchesMolQuery(r, parsed));
  }, [records, parsed]);

  const sortedMatched = useMemo(() => sortMolRecords(filtered), [filtered]);

  // §pyn-1.2.54 — dedupe по табельному применяется во ВСЕХ режимах поиска
  // (включая warehouse). Юзер: если один человек числится на N складах,
  // в таблице показываем 1 строку. Сводка по складам остаётся в sidebar
  // через warehouseGroups, использующий sortedMatched (без dedupe).
  const dedupedRecords = useMemo<MolRecord[]>(() => {
    return dedupeMolByPerson(sortedMatched).map((d) => d.record);
  }, [sortedMatched]);

  const tableRecords = dedupedRecords;

  // Sidebar формируем из ВСЕХ matched (без dedupe) — иначе пропадут другие
  // склады человека. Один и тот же человек на складах 0609, 0610, 0611 даст
  // 3 карточки склада + 1 строку в таблице.
  const warehouseGroups = useMemo(() => {
    if (parsed.mode === 'empty' || sortedMatched.length === 0) return null;
    const groups = groupByWarehouse(sortedMatched);
    return groups.size > 0 ? groups : null;
  }, [parsed.mode, sortedMatched]);

  // Уникальные люди в базе — клиент дедупит локально через тот же ключ что и
  // dedupeMolByPerson (fio+mobile). Это «реальное» количество людей, в отличие
  // от records.length которое включает одного человека на N складах N раз.
  // Server тоже считает unique и пишет в `meta.recordsCount` начиная с deploy
  // 2026-05-17; до этого meta.recordsCount = total. Поэтому всегда берём
  // максимально-точный clientUnique — это всегда верное живое значение.
  const uniquePeopleCount = useMemo(() => dedupeMolByPerson(records).length, [records]);

  // Активный лист базы (МОЛы / Склады) — из ui-state-store, переключается из
  // сайдбара (флайаут «База»). Счётчики складов/цехов — из warehouses-store;
  // «сейчас» = активные (без is_removed).
  const tab = useUiStateStore((s) => s.baseTab);
  const warehouses = useWarehousesStore((s) => s.warehouses);
  const { shopsCount, warehousesCount } = useMemo(() => {
    const active = warehouses.filter((w) => !w.is_removed);
    return {
      shopsCount: new Set(active.map((w) => w.shop_name)).size,
      warehousesCount: active.length,
    };
  }, [warehouses]);

  // Case-insensitive индекс складов: id может содержать букву (824Т / 824T),
  // юзер вводит код в любом регистре.
  const byIdLower = useMemo(
    () => new Map(warehouses.map((w) => [w.id.toLowerCase(), w] as const)),
    [warehouses],
  );

  // §pyn — поиск сверяется с ДВУМЯ базами: МОЛы + склады. Warehouse-токены без
  // МОЛов, которые ЕСТЬ в базе складов → показываем реальную карточку склада
  // («На складе N нет МОЛов»). Токенов нет нигде → красный пилл «не найдено».
  const emptyWarehouseIds = useMemo<string[]>(() => {
    if (parsed.mode !== 'warehouse') return [];
    const found = new Set(
      warehouseGroups ? [...warehouseGroups.keys()].map((k) => k.toLowerCase()) : [],
    );
    const out: string[] = [];
    for (const token of parsed.tokens) {
      if (found.has(token.toLowerCase())) continue;
      const w = byIdLower.get(token.toLowerCase());
      if (w) out.push(w.id);
    }
    return out.sort(byWarehouseCode);
  }, [parsed.mode, parsed.tokens, warehouseGroups, byIdLower]);

  // Карточки справа = склады с МОЛами (groups) + пустые-но-существующие.
  // Порядок — по коду склада (numeric), как нумерация в графике.
  const sidebarWarehouseIds = useMemo<string[]>(
    () => [...(warehouseGroups ? warehouseGroups.keys() : []), ...emptyWarehouseIds].sort(byWarehouseCode),
    [warehouseGroups, emptyWarehouseIds],
  );

  // Правый сайдбар — только когда есть результаты-люди. Если МОЛов нет, но
  // склад существует, его карточка показывается ПО ЦЕНТРУ (в MolEmptyView).
  const rightSidebar = tableRecords.length > 0 && sidebarWarehouseIds.length > 0;

  // Пустое состояние таблицы (когда в выдаче нет МОЛов).
  const emptyState = useMemo<MolEmptyState>(() => {
    if (parsed.mode === 'empty') return { kind: 'hero' };
    if (emptyWarehouseIds.length > 0) return { kind: 'noMols', warehouseIds: emptyWarehouseIds };
    return { kind: 'notFound', mode: parsed.mode };
  }, [parsed.mode, emptyWarehouseIds]);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <MolTopBar
        tab={tab}
        status={status}
        errorMessage={errorMessage}
        recordCount={uniquePeopleCount}
        previousCount={meta?.previous?.recordsCount ?? null}
        shopsCount={shopsCount}
        warehousesCount={warehousesCount}
        query={query}
        onQueryChange={setQuery}
      />
      {tab === 'mol' ? (
        <WorkspaceCard>
          <div className="flex flex-1 overflow-hidden">
            <section
              className={cn(
                'relative flex min-w-0 flex-1 flex-col overflow-hidden',
                // §design — паттерн-фон только на welcome-экране «Что ищем
                // сегодня?»; в результатах поиска фон чистый (bg-surface).
                parsed.mode === 'empty' && 'mol-pattern-bg',
              )}
            >
              {/* Table занимает весь section — composer absolute поверх; scroll
                  в MolTable имеет внутренний padding-bottom, чтобы последние
                  rows не теряли видимость под композером. */}
              {tableRecords.length > 0 ? (
                <MolTable
                  records={tableRecords}
                  hasSidebar={rightSidebar}
                  onContactAction={setActionRequest}
                  persistScrollKey={`mol:${parsed.raw || 'empty'}`}
                />
              ) : (
                <MolEmptyView state={emptyState} onContactAction={setActionRequest} />
              )}
            </section>
            {rightSidebar && (
              <WarehouseSidebar
                warehouseIds={sidebarWarehouseIds}
                onContactAction={setActionRequest}
              />
            )}
          </div>
        </WorkspaceCard>
      ) : (
        <WorkspaceCard>
          <ShopsTab />
        </WorkspaceCard>
      )}
      <ContactActionDialog request={actionRequest} onClose={() => setActionRequest(null)} />
    </main>
  );
}

/** Сортировка кодов складов как нумерация в графике: numeric locale-compare. */
function byWarehouseCode(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true });
}
