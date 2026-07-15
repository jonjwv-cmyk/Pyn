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

// ── МОЛ как производное от базы ПЕРСОН (одна база «Контакты») ──────────────
// «База Контакты» (persons) — единственный источник: качается целиком,
// расшифровывается, кэшируется. МОЛ-справочник (useMolStore) НЕ качается
// отдельно — выводится из persons на клиенте (МОЛ = подмножество is_mol).
// Потребители МОЛ (Поток/Цеха/резолв) читают useMolStore как прежде.

/** persons → MolRecord[] (человек × склад; МОЛ без склада → 'МОЛ'). */
function deriveMolFromPersons(persons: Person[]): MolRecord[] {
  const out: MolRecord[] = [];
  let id = 1;
  for (const p of persons) {
    if (!p.isMol || p.isOrphan) continue;
    const row = (warehouseId: string, until: string): MolRecord => ({
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
    if (p.warehouses.length === 0) out.push(row('МОЛ', ''));
    else {
      for (const w of p.warehouses) {
        const until = w.isWas ? 'был' : w.until;
        out.push(row(w.code, until));
      }
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
    usePersonsStore.getState().setLoaded({ persons, meta: serverMeta });
    usePersonsStore.getState().setRefreshOutcome('updated');
    await saveCache();
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
 * Кэш сразу (МОЛ доступен мгновенно из persons-кэша) + refresh в фоне.
 * Вызывается eager после логина (App.tsx) — «База Контакты» нужна и вкладке
 * «Контакты», и потребителям МОЛ (Поток/Цеха) с первого экрана.
 */
export async function initPersons(): Promise<void> {
  await loadPersonsFromCache();
  await refreshPersonsFromServer();
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
    if (patch.is_mol === 1 && patch.fio !== undefined && patch.fio.trim()) optimistic.isOrphan = false;
  }
  if (patch.fio !== undefined && patch.fio.trim()) optimistic.isOrphan = false;
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
