import { useMemo, useState } from 'react';
import { useMolStore, useUiStateStore } from '@/lib/stores';
import { sortMolRecords } from '@/lib/mol-format';
import {
  dedupeMolByPerson,
  groupByWarehouse,
  matchesMolQuery,
  parseMolQuery,
  type MolRecord,
  type ParsedMolQuery,
} from '@pyn/core';
import { ContactActionDialog, type ContactActionRequest } from './ContactActionDialog';
import { MolComposer } from './MolComposer';
import { MolTable } from './MolTable';
import { MolTopBar } from './MolTopBar';
import { WarehouseSidebar, type NotFoundList } from './WarehouseSidebar';

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

  const notFound = useMemo<NotFoundList>(
    () => buildNotFound(parsed, warehouseGroups, sortedMatched.length > 0),
    [parsed, warehouseGroups, sortedMatched.length],
  );

  const showSidebar = warehouseGroups !== null || hasAnyNotFound(notFound);

  // Уникальные люди в базе — клиент дедупит локально через тот же ключ что и
  // dedupeMolByPerson (fio+mobile). Это «реальное» количество людей, в отличие
  // от records.length которое включает одного человека на N складах N раз.
  // Server тоже считает unique и пишет в `meta.recordsCount` начиная с deploy
  // 2026-05-17; до этого meta.recordsCount = total. Поэтому всегда берём
  // максимально-точный clientUnique — это всегда верное живое значение.
  const uniquePeopleCount = useMemo(() => dedupeMolByPerson(records).length, [records]);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <MolTopBar
        status={status}
        errorMessage={errorMessage}
        recordCount={uniquePeopleCount}
        previousCount={meta?.previous?.recordsCount ?? null}
      />
      <div className="flex flex-1 overflow-hidden">
        <section className="mol-pattern-bg relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Table занимает весь section — composer absolute поверх; scroll
              в MolTable имеет внутренний padding-bottom, чтобы последние
              rows не теряли видимость под композером (но при этом
              проходили за стеклом для blur-эффекта). */}
          <MolTable
            records={tableRecords}
            parsed={parsed}
            hasSidebar={showSidebar}
            onContactAction={setActionRequest}
            persistScrollKey={`mol:${parsed.raw || 'empty'}`}
          />
          <MolComposer value={query} onChange={setQuery} />
        </section>
        {showSidebar && (
          <WarehouseSidebar
            groups={warehouseGroups ?? new Map()}
            notFound={notFound}
            onContactAction={setActionRequest}
          />
        )}
      </div>
      <ContactActionDialog request={actionRequest} onClose={() => setActionRequest(null)} />
    </main>
  );
}

function hasAnyNotFound(nf: NotFoundList): boolean {
  return nf.warehouses.length > 0 || nf.emails.length > 0 || nf.names.length > 0;
}

function buildNotFound(
  parsed: ParsedMolQuery,
  groups: Map<string, ReturnType<typeof groupByWarehouse> extends Map<string, infer V> ? V : never> | null,
  hasResults: boolean,
): NotFoundList {
  const warehouses: string[] = [];
  const emails: string[] = [];
  const names: string[] = [];

  if (parsed.mode === 'warehouse') {
    // Неполные tokens (например `9` при `0609 9`) — всегда not-found.
    if (parsed.invalidTokens) warehouses.push(...parsed.invalidTokens);
    // Валидные tokens — проверяем, нашёлся ли хоть один record на этом складе.
    const foundWids = new Set(groups ? [...groups.keys()] : []);
    for (const token of parsed.tokens) {
      if (!foundWids.has(token)) warehouses.push(token);
    }
  } else if (parsed.mode === 'email' && !hasResults && parsed.raw) {
    // Карточку «не найдено» показываем ТОЛЬКО когда вообще ничего не нашли.
    // Если хоть один совпавший email есть — не зашумляем sidebar.
    emails.push(parsed.raw);
  } else if (parsed.mode === 'name' && !hasResults && parsed.raw) {
    names.push(parsed.raw);
  }

  return { warehouses, emails, names };
}
