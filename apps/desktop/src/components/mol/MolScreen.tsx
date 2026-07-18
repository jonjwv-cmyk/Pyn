import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceCard } from '@/components/WorkspaceCard';
import { cn } from '@/lib/cn';
import { useUiStateStore } from '@/lib/stores';
import { usePersonsStore } from '@/lib/persons-store';
import { useWarehousesStore } from '@/lib/warehouses-store';
import { distinctStatuses, matchesPersonQuery, sortPersons } from '@/lib/persons-view';
import { isValidPersonFio, parseMolQuery, warehouseCodeKey, type Person } from '@pyn/core';
import { ensureFullPersons, releaseFullPersonsHold } from '@/lib/persons-repo';
import { ContactActionDialog, type ContactActionRequest } from './ContactActionDialog';
import { MolEmptyView, type MolEmptyState } from './MolEmptyView';
import { MolTable, type MolTableRow } from './MolTable';
import { MolTopBar } from './MolTopBar';
import { OrphanPanel } from './OrphanPanel';
import { usePersonEditStore } from '@/lib/person-edit-store';
import { ShopsTab } from './ShopsTab';
import { WarehouseSidebar } from './WarehouseSidebar';

/** Сколько строк рендерим максимум — paste 500–1000 складов → много МОЛ; cap с запасом. */
const RESULTS_CAP = 5000;

/** П1.2.д: контур нормализации — снять навсегда после открытия карточки. */
const NORMALIZE_SEEN_KEY = 'pyn:mol:normalize-seen:v1';

function loadNormalizeSeen(): Set<number> {
  try {
    const raw = localStorage.getItem(NORMALIZE_SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(Number).filter((n) => Number.isFinite(n) && n > 0));
  } catch {
    return new Set();
  }
}

function saveNormalizeSeen(ids: Set<number>): void {
  try {
    localStorage.setItem(NORMALIZE_SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode */
  }
}

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
  /** Боковая панель: нормализация «кривых» vs новые МОЛ/контакты. */
  const [normalizeMode, setNormalizeMode] = useState(false);
  /** Id карточек, в которые уже заходили из Нормализации — контур снят навсегда. */
  const [normalizeSeen, setNormalizeSeen] = useState<Set<number>>(() => loadNormalizeSeen());
  const openPersonEdit = usePersonEditStore((s) => s.open);

  const markNormalizeSeen = useCallback((personId: number) => {
    setNormalizeSeen((prev) => {
      if (prev.has(personId)) return prev;
      const next = new Set(prev);
      next.add(personId);
      saveNormalizeSeen(next);
      return next;
    });
  }, []);

  // Полные 19k — только когда раздел База/Контакты ВИДЕН. Иначе в RAM slim
  // (МОЛ+роли ~1–2k) для Потока. Always-mounted shell → смотрим activeSection.
  const activeSection = useUiStateStore((s) => s.activeSection);
  useEffect(() => {
    if (activeSection !== 'mol') {
      releaseFullPersonsHold();
      return;
    }
    void ensureFullPersons();
    return () => {
      releaseFullPersonsHold();
    };
  }, [activeSection]);

  const parsed = useMemo(() => parseMolQuery(query), [query]);

  // Счётчик контактов = все с табельным (ключ) + ручные без tab, но с ФИО.
  // Таблица — валидное ФИО. Панель справа ТОЛЬКО из выгрузки МОЛ:
  //   • Новый МОЛ = is_mol + tab + нет валидного ФИО (в т.ч. только что появившиеся табельные)
  //   • Новый контакт = source=sap_mol, уже не МОЛ, ФИО так и не завели
  //     (не весь мусор базы без ФИО — иначе «простыня»).
  const contactsCount = useMemo(
    () => persons.filter((p) => p.tab.trim().length > 0 || p.fio.trim().length > 0).length,
    [persons],
  );
  const contacts = useMemo(
    () => persons.filter((p) => isValidPersonFio(p.fio)),
    [persons],
  );
  const newMols = useMemo(
    () => persons.filter((p) => p.isMol && !isValidPersonFio(p.fio) && p.tab.trim().length > 0),
    [persons],
  );
  const newContacts = useMemo(
    () => persons.filter(
      (p) => !p.isMol
        && !isValidPersonFio(p.fio)
        && p.tab.trim().length > 0
        && p.source === 'sap_mol',
    ),
    [persons],
  );
  const molCount = useMemo(() => persons.filter((p) => p.isMol).length, [persons]);
  /**
   * Нормализация (узко + приоритет):
   *  • Со складом / «был»: важны сотовый и почта (и кривое ФИО).
   *  • Просто МОЛ без склада: важен сотовый; «нет только почты» — НЕ показываем.
   * Порядок: склад без тел+почты → склад без почты → склад без сотового →
   *          просто МОЛ без сотового → (кривое ФИО).
   */
  const normalizePeople = useMemo(() => {
    type Row = { p: Person; tier: number };
    const rows: Row[] = [];
    for (const p of persons) {
      if (!p.tab.trim()) continue;
      // П1.2.в: «Уволился» — больше не в Нормализации.
      if (p.isDismissed) continue;
      const hasWh = p.warehouses.some(
        (w) => (w.code && w.code !== 'МОЛ' && w.code !== 'MOL') || w.isWas,
      );
      const noMail = !p.mail.trim();
      const noMobile = !p.mobile.trim();
      const badFio = !isValidPersonFio(p.fio);

      if (hasWh) {
        // Склад/«был»: почта желательна, сотовый важен.
        if (!badFio && !noMail && !noMobile) continue;
        let tier = 9;
        if (noMobile && noMail) tier = 0;
        else if (noMail && !noMobile) tier = 1;
        else if (noMobile && !noMail) tier = 2;
        else if (badFio) tier = 3;
        rows.push({ p, tier });
        continue;
      }

      if (p.isMol) {
        // Просто МОЛ: почта не обязательна. Показываем без сотового или с кривым ФИО.
        if (!noMobile && !badFio) continue;
        let tier = 9;
        if (noMobile) tier = 4;
        else if (badFio) tier = 5;
        rows.push({ p, tier });
      }
    }
    rows.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.p.tab.localeCompare(b.p.tab, 'ru', { numeric: true });
    });
    return rows.map((r) => r.p);
  }, [persons]);
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
  // Порядок токенов = порядок ввода/paste; сравнение 824T ≡ 824Т.
  const foundWarehouseIds = useMemo<string[]>(() => {
    if (parsed.mode !== 'warehouse') return [];
    const tokenKeys = new Set(parsed.tokens.map(warehouseCodeKey).filter(Boolean));
    const foundByKey = new Map<string, string>();
    for (const p of filtered) {
      for (const w of p.warehouses) {
        const k = warehouseCodeKey(w.code);
        if (k && tokenKeys.has(k) && !foundByKey.has(k)) foundByKey.set(k, w.code);
      }
    }
    // Порядок как в запросе (не алфавит кодов).
    const out: string[] = [];
    for (const tok of parsed.tokens) {
      const k = warehouseCodeKey(tok);
      const code = foundByKey.get(k);
      if (code) out.push(code);
    }
    return out;
  }, [parsed, filtered]);

  const emptyWarehouseIds = useMemo<string[]>(() => {
    if (parsed.mode !== 'warehouse') return [];
    const foundKeys = new Set(foundWarehouseIds.map(warehouseCodeKey));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tok of parsed.tokens) {
      const k = warehouseCodeKey(tok);
      if (!k || foundKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      // byIdLower — exact lower; также ищем по key среди складов.
      const w =
        byIdLower.get(tok.toLowerCase())
        ?? warehouses.find((x) => warehouseCodeKey(x.id) === k);
      if (w) out.push(w.id);
    }
    return out;
  }, [parsed, foundWarehouseIds, byIdLower, warehouses]);

  // Склады в сайдбаре — порядок ввода (paste), не алфавит; контакты в таблице — по ФИО.
  const sidebarWarehouseIds = useMemo<string[]>(
    () => [...foundWarehouseIds, ...emptyWarehouseIds],
    [foundWarehouseIds, emptyWarehouseIds],
  );

  const rightSidebar = tableRecords.length > 0 && sidebarWarehouseIds.length > 0;

  const emptyState = useMemo<MolEmptyState>(() => {
    if (parsed.mode === 'empty') return { kind: 'hero' };
    if (emptyWarehouseIds.length > 0) return { kind: 'noMols', warehouseIds: emptyWarehouseIds };
    return { kind: 'notFound', mode: parsed.mode };
  }, [parsed.mode, emptyWarehouseIds]);

  // Пустой поиск: нормализация (если кнопка вкл) или «Новые МОЛы/контакты».
  const showSidePanel =
    parsed.mode === 'empty'
    && (normalizeMode || newMols.length > 0 || newContacts.length > 0);

  const openEdit = (person: Person, fromNormalize = false) => {
    // Активный МОЛ без ФИО → режим orphan; иначе обычный edit (ФИО/должность правятся).
    const mode = person.isMol && !isValidPersonFio(person.fio) ? 'orphan' : 'edit';
    // П1.2.д: провалились в карточку — контур снимается навсегда (даже без правок).
    if (fromNormalize || normalizeMode) markNormalizeSeen(person.id);
    openPersonEdit({ mode, person });
  };
  const onEditPersonId = (id: number) => {
    const p = persons.find((x) => x.id === id);
    if (p) openEdit(p, false);
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
        onAddContact={() => openPersonEdit({ mode: 'create' })}
        normalizeActive={normalizeMode}
        normalizeCount={normalizePeople.length}
        onToggleNormalize={() => setNormalizeMode((v) => !v)}
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
            ) : showSidePanel ? (
              <OrphanPanel
                newMols={newMols}
                newContacts={newContacts}
                normalizeMode={normalizeMode}
                normalizePeople={normalizePeople}
                normalizeSeenIds={normalizeSeen}
                onEdit={(p) => openEdit(p, true)}
              />
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
    isDismissed: p.isDismissed,
  };
}

