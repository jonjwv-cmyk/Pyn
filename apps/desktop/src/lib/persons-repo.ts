/**
 * persons-repo — server-sync базы ПЕРСОН (вкладка «Контакты»), один-в-один с
 * `warehouses-repo.ts`:
 *   • кэш-старт из зашифрованного safeStorage-кэша (window.pyn.cache);
 *   • фон-обновление: version check → при расхождении R2-слепок (decrypt+gunzip);
 *   • правка контакта → на сервер (person_update) + optimistic local + кэш;
 *   • новый контакт → на сервер (person_create) + refresh;
 *   • live-обновление по WS 'persons_changed' (вызывается из App.tsx).
 *
 * Загрузка ЛЕНИВАЯ — initPersons() вызывается при первом открытии вкладки
 * «Контакты» (база 19.6k не нужна тем, кто туда не заходит).
 */

import {
  personsVersion,
  personsDownload,
  personsDownloadUrl,
  personUpdate,
  personCreate,
  isValidPersonFio,
  parsePersonsSnapshotJson,
  parseBroadcastApprovalWarehouses,
  type Person,
  type PersonsMeta,
  type PersonPatch,
  type PersonCreateInput,
  type MolRecord,
  type BaseMeta,
} from '@pyn/core';
import { api } from './api';
import { usePersonsStore } from './persons-store';
import { useMolStore } from './stores';

const CACHE_NAME = 'persons-base';

// ── Runtime slim (юзер 2026-07-18): Потоку нужны МОЛы (~1k) + экспедиторы/водители,
// НЕ 19k всех контактов. На диске — полный слепок (Контакты). В RAM после login —
// только flow-actors; полный список подгружается при открытии «Контакты».
// WS/импорт МОЛ → refresh full → again slim (если Контакты не открыты).
type PersonsRuntimeMode = 'slim' | 'full';
let personsRuntimeMode: PersonsRuntimeMode = 'full';
/** Роли потока (как в FlowPlanGrid / PersonEditDialog). */
const FLOW_ROLE_GROUPS = new Set(['Экспедиторы', 'Водители-экспедиторы']);

/** Кто нужен Потоку/Транспорту в RAM (не вся книга контактов). */
export function isFlowActor(p: Person): boolean {
  if (p.isMol) return true;
  // Орфан-МОЛ без ФИО — нужен нормализации/плашке.
  if (p.isOrphan) return true;
  if (p.broadcastEnabled && FLOW_ROLE_GROUPS.has(p.broadcastGroup || '')) return true;
  return false;
}

/** Сжать store до flow-actors. Диск (полный) НЕ трогаем. */
function slimPersonsToFlowActors(): void {
  const s = usePersonsStore.getState();
  if (s.persons.length === 0) return;
  const slim = s.persons.filter(isFlowActor);
  // Не сжимаем, если уже slim или почти все нужны.
  if (slim.length === 0 || slim.length >= s.persons.length * 0.85) {
    personsRuntimeMode = slim.length >= s.persons.length ? 'full' : personsRuntimeMode;
    return;
  }
  personsRuntimeMode = 'slim';
  // setState напрямую — не saveCache (полный кэш на диске сохраняем только из full).
  usePersonsStore.setState({ persons: slim, status: 'loaded' });
}

// ── МОЛ как производное от базы ПЕРСОН (одна база «Контакты») ──────────────
// «База Контакты» (persons) — единственный источник: качается целиком на диск,
// расшифровывается. В RAM для Потока — slim (МОЛ+роли). МОЛ-справочник
// (useMolStore) выводится из persons на клиенте.

/**
 * persons → MolRecord[] (человек × склад; МОЛ без склада → 'МОЛ').
 *
 * Активные is_mol (не isWas). Фантомы «был» — ТОЛЬКО если на складе после
 * выгрузки не осталось ни одного активного МОЛ: иначе прошлые связи не
 * интересны (склад «живой»). Фантом: выбрать нельзя, смотреть можно.
 */
function deriveMolFromPersons(persons: Person[]): MolRecord[] {
  const out: MolRecord[] = [];
  let id = 1;
  const row = (p: Person, warehouseId: string, until: string): MolRecord => ({
    remoteId: id++,
    warehouseId,
    warehouseName: '',
    warehouseDesc: '',
    warehouseMark: '',
    warehouseKeeper: '',
    warehouseUntil: until,
    warehouseWorkPhones: '',
    fio: p.fio,
    status: p.status,
    position: p.position,
    mobile: p.mobile,
    work: p.work,
    mail: p.mail,
    tab: p.tab,
    searchText: [p.fio, p.mobile, p.mail, p.tab, warehouseId].filter(Boolean).join(' ').toLowerCase(),
    createdAt: p.updatedAt,
  });

  // Склады, у которых есть хотя бы один активный (не «был») МОЛ.
  const activeWh = new Set<string>();
  for (const p of persons) {
    if (p.isOrphan || !p.isMol) continue;
    for (const w of p.warehouses) {
      if (w.isWas) continue;
      const code = (w.code || '').trim();
      if (code && code !== 'МОЛ' && code !== 'MOL') activeWh.add(code.toLowerCase());
    }
  }

  for (const p of persons) {
    if (p.isOrphan) continue;
    if (p.isMol) {
      if (p.warehouses.length === 0) out.push(row(p, 'МОЛ', ''));
      else {
        for (const w of p.warehouses) {
          const code = (w.code || '').trim();
          if (w.isWas) {
            // «был» только если склад полностью без активного МОЛ.
            if (!code || activeWh.has(code.toLowerCase())) continue;
            out.push(row(p, code, 'был'));
          } else {
            out.push(row(p, code || 'МОЛ', w.until || ''));
          }
        }
      }
      continue;
    }
    // Не МОЛ, но «был» на пустом складе — фантом (без значка МОЛ в контактах).
    for (const w of p.warehouses) {
      if (!w.isWas) continue;
      const code = (w.code || '').trim();
      if (!code || activeWh.has(code.toLowerCase())) continue;
      out.push(row(p, code, 'был'));
    }
  }
  return out;
}

/** PersonsMeta → BaseMeta (recordsCount = кол-во МОЛ). Fallback при отсутствии. */
function personsMetaToBaseMeta(pm: PersonsMeta | null): BaseMeta {
  if (!pm) return { version: '', updatedAt: '', recordsCount: null, previous: null };
  return {
    version: pm.version,
    updatedAt: pm.updatedAt,
    note: pm.note,
    createdAt: pm.createdAt,
    recordsCount: pm.molCount ?? null,
    previous: pm.previous
      ? { version: pm.previous.version, updatedAt: pm.previous.updatedAt, recordsCount: pm.previous.molCount ?? null }
      : null,
  };
}

/** Пересобрать производный МОЛ в useMolStore из текущих persons. */
function syncMolFromPersons(): void {
  const s = usePersonsStore.getState();
  useMolStore.getState().setLoaded({
    records: deriveMolFromPersons(s.persons),
    meta: personsMetaToBaseMeta(s.meta),
    syncedNow: true,
  });
}

// Любое изменение базы ПЕРСОН (загрузка/refresh/optimistic-правка) → пересобрать
// производный МОЛ. Одна точка — потребители МОЛ всегда актуальны.
usePersonsStore.subscribe((state, prev) => {
  if (state.persons !== prev.persons) syncMolFromPersons();
});

interface CachePayload {
  meta: PersonsMeta | null;
  persons: Person[];
}

async function saveCache(): Promise<void> {
  // Никогда не пишем slim (1–2k) поверх полного слепка 19k на диске.
  if (personsRuntimeMode !== 'full') return;
  const s = usePersonsStore.getState();
  try {
    await window.pyn?.cache?.save(
      CACHE_NAME,
      JSON.stringify({ meta: s.meta, persons: s.persons } satisfies CachePayload),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:persons] cache save failed:', err);
  }
}

export async function loadPersonsFromCache(): Promise<boolean> {
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!Array.isArray(parsed.persons) || parsed.persons.length === 0) return false;
    personsRuntimeMode = 'full';
    usePersonsStore.getState().setLoaded({ persons: parsed.persons, meta: parsed.meta ?? null });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:persons] cache load failed:', err);
    return false;
  }
}

const REFRESH_TOAST_MS = 3_500;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** true, пока открыт раздел Контакты — не сжимать store в slim. */
let fullPersonsHoldRequested = false;

export async function refreshPersonsFromServer(opts: { force?: boolean } = {}): Promise<boolean> {
  const store = usePersonsStore.getState();
  const wasLoaded = store.status === 'loaded';
  if (opts.force || !wasLoaded) store.setStatus('loading');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  store.setRefreshOutcome(null);

  const scheduleToastReset = () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      usePersonsStore.getState().setRefreshOutcome(null);
      toastTimer = null;
    }, REFRESH_TOAST_MS);
  };

  try {
    const serverMeta = await personsVersion(api);
    const localMeta = store.meta;
    // Версии совпали и данные уже есть → «База актуальна» (даже на ручной refresh,
    // как у складов) — не перекачиваем и не пишем ложно «обновлена».
    if (localMeta && localMeta.version === serverMeta.version && usePersonsStore.getState().persons.length > 0) {
      usePersonsStore.setState({ meta: serverMeta, status: 'loaded', lastRefreshOutcome: 'up-to-date' });
      await saveCache();
      scheduleToastReset();
      return false;
    }

    // Эффективный путь — зашифрованный gzip-слепок из R2 (~700КБ) через preload.
    // Если preload-bridge ещё не загружен (нужен рестарт Pyn после деплоя) или
    // слепок недоступен — fallback на прямой JSON (personsDownload), чтобы
    // вкладка работала и без рестарта.
    let persons: Person[] | null = null;
    const hasBridge = typeof window.pyn?.persons?.fetchSnapshot === 'function';
    if (hasBridge) {
      try {
        const info = await personsDownloadUrl(api);
        if (info.url && info.blobKeyB64 && info.blobNonceB64) {
          const plainJson = await window.pyn.persons.fetchSnapshot(info.url, info.blobKeyB64, info.blobNonceB64);
          persons = parsePersonsSnapshotJson(plainJson).persons;
        }
      } catch (blobErr) {
        // eslint-disable-next-line no-console
        console.warn('[pyn:persons] blob path failed, falling back to direct JSON:', blobErr);
      }
    }
    if (!persons) {
      persons = (await personsDownload(api)).persons;
    }
    personsRuntimeMode = 'full';
    usePersonsStore.getState().setLoaded({ persons, meta: serverMeta });
    usePersonsStore.getState().setRefreshOutcome('updated');
    await saveCache(); // full → диск
    // Поток не держит 19k в RAM — сжимаем после записи полного кэша.
    // Контакты (ensureFullPersons) снова развернут из диска.
    if (!fullPersonsHoldRequested) slimPersonsToFlowActors();
    scheduleToastReset();
    return true;
  } catch (err) {
    usePersonsStore.setState({
      status: wasLoaded ? 'loaded' : 'error',
      lastRefreshOutcome: 'error',
    });
    scheduleToastReset();
    // eslint-disable-next-line no-console
    console.error('[pyn:persons] refresh failed:', err);
    return false;
  }
}

/**
 * Полная база в RAM (вкладка «Контакты»). С диска или force-refresh.
 * Пока hold=true, refresh не сжимает store.
 */
export async function ensureFullPersons(): Promise<void> {
  fullPersonsHoldRequested = true;
  if (personsRuntimeMode === 'full' && usePersonsStore.getState().persons.length > 3000) {
    return;
  }
  // Сначала диск (полный слепок) — без сети.
  const ok = await loadPersonsFromCache();
  if (ok && usePersonsStore.getState().persons.length > 3000) {
    personsRuntimeMode = 'full';
    return;
  }
  await refreshPersonsFromServer({ force: true });
  personsRuntimeMode = 'full';
}

/** Уход с Контактов — можно снова slim для 8 ГБ / скорости Потока. */
export function releaseFullPersonsHold(): void {
  fullPersonsHoldRequested = false;
  slimPersonsToFlowActors();
}

/**
 * Login: кэш → slim (МОЛ+роли в RAM) → фоновый version-check.
 * Полные 19k только на диске + при открытии Контактов (ensureFullPersons).
 */
export async function initPersons(): Promise<void> {
  await loadPersonsFromCache();
  slimPersonsToFlowActors();
  // Фон: если версия сменилась — скачает full, сохранит диск, снова slim.
  void refreshPersonsFromServer().then(() => {
    if (!fullPersonsHoldRequested) slimPersonsToFlowActors();
  });
}

/**
 * Правка контакта: optimistic local-патч + отправка на сервер. Сервер поднимает
 * версию (person_update) + рассылает WS другим клиентам; если задет МОЛ — сервер
 * пересобирает производную МОЛ. При ошибке откатываемся через refresh.
 */
export async function savePerson(id: number, patch: PersonPatch): Promise<void> {
  const store = usePersonsStore.getState();
  // optimistic: проецируем patch (snake) → Person (camel) для мгновенного UI.
  const optimistic: Partial<Person> = {};
  if (patch.tab !== undefined) optimistic.tab = patch.tab;
  if (patch.fio !== undefined) optimistic.fio = patch.fio;
  if (patch.position !== undefined) optimistic.position = patch.position;
  if (patch.status !== undefined) optimistic.status = patch.status;
  if (patch.mobile !== undefined) optimistic.mobile = patch.mobile;
  if (patch.work !== undefined) optimistic.work = patch.work;
  if (patch.mail !== undefined) optimistic.mail = patch.mail;
  if (patch.comment !== undefined) optimistic.comment = patch.comment;
  // broadcast-поля (рассылка / согласуемые склады) — тоже в локальную проекцию,
  // чтобы переоткрытие карточки показало свежий выбор сразу, не дожидаясь WS-refresh.
  if (patch.broadcast_enabled !== undefined) optimistic.broadcastEnabled = patch.broadcast_enabled === 1;
  if (patch.broadcast_group !== undefined) optimistic.broadcastGroup = patch.broadcast_group;
  if (patch.broadcast_purpose !== undefined) optimistic.broadcastPurpose = patch.broadcast_purpose;
  if (patch.broadcast_approval_warehouses !== undefined) {
    optimistic.broadcastApprovalWarehouses = parseBroadcastApprovalWarehouses(patch.broadcast_approval_warehouses);
  }
  if (patch.is_mol !== undefined) {
    optimistic.isMol = patch.is_mol === 1;
  }
  if (patch.dismissed !== undefined) {
    optimistic.isDismissed = patch.dismissed === 1;
  }
  if (patch.fio !== undefined || patch.is_mol !== undefined) {
    const fio = (patch.fio !== undefined ? patch.fio : optimistic.fio) ?? '';
    optimistic.isOrphan = !!(optimistic.isMol && !isValidPersonFio(fio));
  }
  store.patchLocal(id, optimistic);
  try {
    const res = await personUpdate(api, { id, patch });
    const meta = usePersonsStore.getState().meta;
    if (meta) {
      usePersonsStore.setState({
        meta: { ...meta, version: res.version || meta.version, updatedAt: res.updatedAt || meta.updatedAt },
      });
    }
    await saveCache();
  } catch (err) {
    await refreshPersonsFromServer({ force: true });
    throw err;
  }
}

/** Новый контакт («+ Контакт»): сервер создаёт → подтягиваем свежий список. */
export async function createPerson(input: PersonCreateInput): Promise<void> {
  await personCreate(api, input);
  await refreshPersonsFromServer({ force: true });
}
