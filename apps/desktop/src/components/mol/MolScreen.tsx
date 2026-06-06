import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { cn } from '@/lib/cn';
import { useUiStateStore } from '@/lib/stores';
import { usePersonsStore } from '@/lib/persons-store';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { distinctStatuses, matchesPersonQuery, sortPersons } from '@/lib/persons-view';
import { parseMolQuery, type Person } from '@pyn/core';
import { ContactActionDialog, type ContactActionRequest } from './ContactActionDialog';
import { MolEmptyView, type MolEmptyState } from './MolEmptyView';
import { MolTable, type MolTableRow } from './MolTable';
import { MolTopBar } from './MolTopBar';
import { OrphanPanel } from './OrphanPanel';
import { PersonEditDialog, type PersonEditTarget } from './PersonEditDialog';
import { ShopsTab } from './ShopsTab';
import { WarehouseSidebar } from './WarehouseSidebar';

/** Сколько строк рендерим максимум — защита от лага на очень широком запросе. */
const RESULTS_CAP = 1000;

/**
 * Раздел «Контакты» — единая база ПЕРСОН (ФИО + МОЛ) + лист «Цеха».
 * Поиск по всей базе (ФИО / телефон / почта / склад / табельный). На пустом
 * запросе — приветствие + панель орфанов «Нет данных МОЛов» справа. МОЛ —
 * подмножество (счётчик «МОЛы N»). Правка контакта — карандаш у № строки
 * (окно с блокировкой), создание — «+ Контакт».
 */
export function MolScreen() {
  const { t } = useTranslation();
  const persons = usePersonsStore((s) => s.persons);
  const meta = usePersonsStore((s) => s.meta);
  const status = usePersonsStore((s) => s.status);

  const query = useUiStateStore((s) => s.molQuery);
  const setQuery = useUiStateStore((s) => s.setMolQuery);
  const shopsQuery = useUiStateStore((s) => s.shopsQuery);
  const setShopsQuery = useUiStateStore((s) => s.setShopsQuery);

  const [actionRequest, setActionRequest] = useState<ContactActionRequest | null>(null);
  const [editTarget, setEditTarget] = useState<PersonEditTarget | null>(null);

  // База «Контакты» (persons) грузится eager после логина (App.tsx) — она же
  // питает производный МОЛ для Потока/Цеха. Здесь только читаем.
  const parsed = useMemo(() => parseMolQuery(query), [query]);

  // Контакты = персоны с ФИО (орфаны — отдельно, в панели). Счётчики по ним.
  const contacts = useMemo(() => persons.filter((p) => !p.isOrphan), [persons]);
  const orphans = useMemo(() => persons.filter((p) => p.isOrphan), [persons]);
  const contactsCount = contacts.length;
  const molCount = useMemo(() => contacts.filter((p) => p.isMol).length, [contacts]);
  const statuses = useMemo(() => distinctStatuses(persons), [persons]);

  const filtered = useMemo<Person[]>(() => {
    if (parsed.mode === 'empty') return [];
    return sortPersons(contacts.filter((p) => matchesPersonQuery(p, parsed)));
  }, [contacts, parsed]);

  const overflow = filtered.length > RESULTS_CAP;
  const tableRecords = useMemo<MolTableRow[]>(
    () => filtered.slice(0, RESULTS_CAP).map(personToRow),
    [filtered],
  );

  // Лист базы (Контакты / Цеха) — из ui-state-store, переключается из сайдбара.
  const tab = useUiStateStore((s) => s.baseTab);
  const [shopsEverOpened, setShopsEverOpened] = useState(() => tab === 'warehouses');
  useEffect(() => {
    if (tab === 'warehouses') setShopsEverOpened(true);
  }, [tab]);

  const warehouses = useWarehousesStore((s) => s.warehouses);
  const { shopsCount, warehousesCount } = useMemo(() => {
    const active = warehouses.filter((w) => !w.is_removed);
    return {
      shopsCount: new Set(active.map((w) => w.shop_name)).size,
      warehousesCount: active.length,
    };
  }, [warehouses]);

  const byIdLower = useMemo(
    () => new Map(warehouses.map((w) => [w.id.toLowerCase(), w] as const)),
    [warehouses],
  );

  // Правый сайдбар складов — только в режиме поиска по складу.
  const foundWarehouseIds = useMemo<string[]>(() => {
    if (parsed.mode !== 'warehouse') return [];
    const found = new Set<string>();
    for (const p of filtered) {
      for (const w of p.warehouses) {
        if (parsed.tokens.some((tok) => tok.toLowerCase() === w.code.toLowerCase())) found.add(w.code);
      }
    }
    return [...found];
  }, [parsed, filtered]);

  const emptyWarehouseIds = useMemo<string[]>(() => {
    if (parsed.mode !== 'warehouse') return [];
    const foundLower = new Set(foundWarehouseIds.map((c) => c.toLowerCase()));
    const out: string[] = [];
    for (const tok of parsed.tokens) {
      if (foundLower.has(tok.toLowerCase())) continue;
      const w = byIdLower.get(tok.toLowerCase());
      if (w) out.push(w.id);
    }
    return out.sort(byWarehouseCode);
  }, [parsed, foundWarehouseIds, byIdLower]);

  const sidebarWarehouseIds = useMemo<string[]>(
    () => [...foundWarehouseIds, ...emptyWarehouseIds].sort(byWarehouseCode),
    [foundWarehouseIds, emptyWarehouseIds],
  );

  const rightSidebar = tableRecords.length > 0 && sidebarWarehouseIds.length > 0;

  const emptyState = useMemo<MolEmptyState>(() => {
    if (parsed.mode === 'empty') return { kind: 'hero' };
    if (emptyWarehouseIds.length > 0) return { kind: 'noMols', warehouseIds: emptyWarehouseIds };
    return { kind: 'notFound', mode: parsed.mode };
  }, [parsed.mode, emptyWarehouseIds]);

  // На пустом запросе справа — панель орфанов (если есть). Уходит при поиске.
  const showOrphanPanel = parsed.mode === 'empty' && orphans.length > 0;

  const openEdit = (person: Person) =>
    setEditTarget({ mode: person.isOrphan ? 'orphan' : 'edit', person });
  const onEditPersonId = (id: number) => {
    const p = persons.find((x) => x.id === id);
    if (p) openEdit(p);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <MolTopBar
        tab={tab}
        status={tab === 'mol' ? status : 'loaded'}
        errorMessage={null}
        recordCount={contactsCount}
        previousCount={meta?.previous?.recordsCount ?? null}
        shopsCount={shopsCount}
        warehousesCount={warehousesCount}
        molCount={molCount}
        molPreviousCount={meta?.previous?.molCount ?? null}
        onAddContact={() => setEditTarget({ mode: 'create' })}
        query={tab === 'mol' ? query : shopsQuery}
        onQueryChange={tab === 'mol' ? setQuery : setShopsQuery}
      />
      {/* Контакты — always-mounted, display-toggle (мгновенный возврат). */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ display: tab === 'mol' ? 'flex' : 'none' }}
      >
        <WorkspaceCard>
          <div className="flex flex-1 overflow-hidden p-4">
            <section
              className={cn(
                'relative flex min-w-0 flex-1 flex-col overflow-hidden',
                parsed.mode === 'empty' && 'mol-pattern-bg',
              )}
            >
              {tableRecords.length > 0 ? (
                <>
                  {overflow && (
                    <div className="shrink-0 px-2 pb-1 text-center text-[11px] text-text-muted">
                      {t('mol.results_truncated', { shown: RESULTS_CAP, total: filtered.length })}
                    </div>
                  )}
                  <MolTable
                    records={tableRecords}
                    hasSidebar={rightSidebar}
                    onContactAction={setActionRequest}
                    onEditPerson={onEditPersonId}
                    persistScrollKey={`mol:${parsed.raw || 'empty'}`}
                    searchQuery={parsed}
                  />
                </>
              ) : (
                <MolEmptyView state={emptyState} onContactAction={setActionRequest} />
              )}
            </section>
            {rightSidebar ? (
              <WarehouseSidebar
                warehouseIds={sidebarWarehouseIds}
                onContactAction={setActionRequest}
              />
            ) : showOrphanPanel ? (
              <OrphanPanel orphans={orphans} onEdit={openEdit} />
            ) : null}
          </div>
        </WorkspaceCard>
      </div>

      {/* Цеха — lazy-mount при первом заходе, дальше остаётся в DOM. */}
      {shopsEverOpened && (
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: tab === 'warehouses' ? 'flex' : 'none' }}
        >
          <WorkspaceCard>
            <ShopsTab query={shopsQuery} onContactAction={setActionRequest} />
          </WorkspaceCard>
        </div>
      )}

      <PersonEditDialog target={editTarget} statuses={statuses} onClose={() => setEditTarget(null)} />
      <ContactActionDialog request={actionRequest} onClose={() => setActionRequest(null)} />
    </main>
  );
}

/** Person → строка таблицы (форма MolTableRow + контактные поля). */
function personToRow(p: Person): MolTableRow {
  return {
    remoteId: p.id,
    warehouseId: '',
    warehouseName: '',
    warehouseDesc: '',
    warehouseMark: '',
    warehouseKeeper: '',
    warehouseUntil: '',
    warehouseWorkPhones: '',
    fio: p.fio,
    status: p.status,
    position: p.position,
    mobile: p.mobile,
    work: p.work,
    mail: p.mail,
    tab: p.tab,
    searchText: '',
    createdAt: p.updatedAt,
    warehouses: p.warehouses,
    comment: p.comment,
    personId: p.id,
    isMol: p.isMol,
    isOrphan: p.isOrphan,
  };
}

/** Сортировка кодов складов как нумерация в графике: numeric locale-compare. */
function byWarehouseCode(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true });
}
