/**
 * map-repo — персистентность карты.
 *
 * СЕРВЕР = источник правды (D1 map_state). Локальный кэш `flow-map` — только
 * быстрый старт / офлайн. Писать map_set может только сборка ≥ 1.3.11
 * (старые EXE сервер отвергает — не затрут карту).
 *
 *   • initMap() — кэш мгновенно → всегда дотягивает сервер; пустой сервер +
 *     локальный контент → push (миграция / recovery).
 *   • любое изменение doc → debounce → cache.save + map_set на сервер.
 *   • WS map_changed → refreshMapFromServer().
 *   • На сервере: утренний суточный бэкап (map_daily) + anti-wipe.
 */

import { mapGet, mapSet } from '@pyn/core';
import { legacyNormToLatLng } from '@/components/map/geo';
import {
  EMPTY_MAP_DOC,
  EMPTY_POINT_EQUIPMENT,
  POINT_VEHICLE_TYPES,
  normalizeVehicleId,
  type AreaKind,
  type LatLng,
  type MapDoc,
  type PointEquipment,
  type PointPurpose,
  type RoadAccessKind,
  type VehicleType,
} from '@/components/map/map-types';
import { api } from './api';
import { useMapStore } from './map-store';

const CACHE_NAME = 'flow-map';
const BACKUP_NAME = 'pyn:flow-map:plain-backup:v1';
const SAVE_DEBOUNCE_MS = 80;
/** Каждое изменение карты сразу уходит на сервер (короткий debounce только
 *  чтобы схлопнуть пачку вершин при рисовании полилинии). */
const PUSH_DEBOUNCE_MS = 120;
/** Не принимать remote / не пушить, если score «схлопнулся» сильнее чем в 2 раза
 *  относительно уже известной живой карты. */
const MAP_PROTECT_MIN_SCORE = 500;
const MAP_SHRINK_RATIO = 0.5;
/** Совпадает с серверным MAP_MIN_CLIENT_VERSION — ниже не пушим (сервер всё равно 403). */
const MAP_MIN_CLIENT_VERSION = '1.3.11';

function appClientVersion(): string {
  try {
    return String(window.pyn?.appVersion || '').trim();
  } catch {
    return '';
  }
}

function semverGte(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = String(v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}

/** Можно ли этой сборке писать карту на сервер. */
export function canWriteMapToServer(): boolean {
  return semverGte(appClientVersion(), MAP_MIN_CLIENT_VERSION);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;
let lastSavedDoc: MapDoc | null = null;
/** Последняя известная версия серверного документа (для гашения эха своих правок). */
let serverVersion = 0;
/** true пока применяем входящий серверный документ — не пушим его обратно. */
let applyingRemote = false;

function toLatLng(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.lat === 'number' && typeof r.lng === 'number') {
    return { lat: r.lat, lng: r.lng };
  }
  // Миграция старого локального формата: x/y в долях статичного снимка.
  if (typeof r.x === 'number' && typeof r.y === 'number') {
    return legacyNormToLatLng(r.x, r.y);
  }
  return null;
}

function normalizeDoc(raw: Partial<MapDoc> & Record<string, unknown>): MapDoc {
  const incomingVersion = typeof raw.version === 'number' ? raw.version : 0;
  const points = Array.isArray(raw.points)
    ? raw.points.flatMap((p) => {
      const ll = toLatLng(p);
      if (!ll || !p || typeof p !== 'object') return [];
      const r = p as unknown as Record<string, unknown>;
      const warehouseId = typeof r.warehouseId === 'string' ? r.warehouseId : null;
      // Старые id (bortovik→bort) ПЕРЕИМЕНОВЫВАЕМ, не выкидываем — иначе
      // пересохранение молча стирает отметки с точек.
      const allowedVehicles = normalizeVehicleList(r.allowedVehicles);
      // Миграция назначений: точка со складом → «Технология» (сайт и так строил
      // техточки из точек склада — поведение 1:1), свободная → «Иное».
      const purposes = normalizePurposes(r.purposes, warehouseId);
      const vehiclesByPurpose = seedMatrixV8(
        normalizeVehiclesByPurpose(r.vehiclesByPurpose),
        purposes,
        allowedVehicles,
        incomingVersion,
      );
      const rearByPurpose = normalizeRearByPurpose(
        normalizeVehiclesByPurpose(r.rearByPurpose),
        vehiclesByPurpose,
        r.rearUnload === true,
      );
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        ...ll,
        warehouseId,
        label: typeof r.label === 'string' ? r.label : '',
        comment: typeof r.comment === 'string' ? r.comment : '',
        weight: typeof r.weight === 'number' ? r.weight : 1,
        equipment: normalizePointEquipment(r.equipment),
        rearUnload: vehicleMatrixHasAny(rearByPurpose),
        allowedVehicles,
        purposes,
        // v8: карточка перешла на матрицу «тип ТС × назначение». Засеваем матрицу
        // из старых назначений+общего списка, чтобы существующие тех/эксп-точки
        // не потеряли поток (пустой общий список = «все машины» → все галочки).
        vehiclesByPurpose,
        rearByPurpose,
      }];
    })
    : [];
  const areas = Array.isArray(raw.areas)
    ? raw.areas.flatMap((a) => {
      if (!a || typeof a !== 'object') return [];
      const r = a as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 3) return [];
      const areaKinds: AreaKind[] = ['shop', 'loading', 'unloading', 'work'];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        color: typeof r.color === 'string' ? r.color : '#E8836B',
        vertices: verts,
        shopName: typeof r.shopName === 'string' ? r.shopName : null,
        // Старые области без типа → «область цеха» (мигрируются как есть).
        kind: areaKinds.includes(r.kind as AreaKind) ? (r.kind as AreaKind) : 'shop',
        comment: typeof r.comment === 'string' ? r.comment : '',
      }];
    })
    : [];
  const roads = Array.isArray(raw.roads)
    ? raw.roads.flatMap((road) => {
      if (!road || typeof road !== 'object') return [];
      const r = road as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        vertices: verts,
        sourceId: typeof r.sourceId === 'string' ? r.sourceId : undefined,
      }];
    })
    : [];
  const roadSuggestions = Array.isArray(raw.roadSuggestions)
    ? raw.roadSuggestions.flatMap((road) => {
      if (!road || typeof road !== 'object') return [];
      const r = road as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      const source: 'osm' | 'ai' = r.source === 'ai' ? 'ai' : 'osm';
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        vertices: verts,
        source,
      }];
    })
    : [];
  const roadAccess = Array.isArray(raw.roadAccess)
    ? raw.roadAccess.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      const vehicles = normalizeVehicleList(r.vehicles);
      // Миграция «особенностей» → «ограничения участка»: старые kind limited/closed
      // валидны как есть; новые free/temp_closed + режим allow/deny + даты.
      const kinds: RoadAccessKind[] = ['free', 'limited', 'closed', 'temp_closed'];
      const kind: RoadAccessKind = kinds.includes(r.kind as RoadAccessKind) ? (r.kind as RoadAccessKind) : 'limited';
      const storedMatrix = normalizeRoadVehiclesByPurpose(r.vehiclesByPurpose);
      const vehiclesByPurpose = hasStoredVehiclePurposeMatrix(r.vehiclesByPurpose)
        ? storedMatrix
        : migrateRoadVehiclesByPurpose(kind, vehicles, r.vehiclesMode === 'deny' ? 'deny' : 'allow');
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        vertices: verts,
        kind,
        vehicles,
        vehiclesMode: r.vehiclesMode === 'deny' ? 'deny' as const : 'allow' as const,
        vehiclesByPurpose,
        note: typeof r.note === 'string' ? r.note : '',
        closedFrom: typeof r.closedFrom === 'string' ? r.closedFrom : '',
        closedTo: typeof r.closedTo === 'string' ? r.closedTo : '',
      }];
    })
    : [];

  // Миграция v8 (ТЗ 2026-07-10): СТАРЫЕ покрашенные участки «по типу ТС»
  // (только фургон / только газель… — kind 'limited') и «свободна» ('free') —
  // это старьё от прежнего инструмента «трасса машин». Оставляем ТОЛЬКО запреты
  // ('closed' / 'temp_closed'). Разовая чистка при загрузке документа версии < 8;
  // новые ограничения (кисть «Ограничение дороги») сохранятся уже как v8 и не
  // трогаются. НАРИСОВАННЫЕ ДОРОГИ (doc.roads — «жёлтая база») здесь не трогаем.
  const roadAccessMigrated = incomingVersion < 8
    ? roadAccess.filter((a) => a.kind === 'closed' || a.kind === 'temp_closed')
    : roadAccess;

  const crossings = Array.isArray(raw.crossings)
    ? raw.crossings.flatMap((entry) => {
      const ll = toLatLng(entry);
      if (!ll || !entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        ...ll,
        name: typeof r.name === 'string' ? r.name : '',
        note: typeof r.note === 'string' ? r.note : '',
      }];
    })
    : [];
  const railways = Array.isArray(raw.railways)
    ? raw.railways.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      const verts = Array.isArray(r.vertices) ? r.vertices.map(toLatLng).filter(Boolean) as LatLng[] : [];
      if (verts.length < 2) return [];
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        name: typeof r.name === 'string' ? r.name : '',
        vertices: verts,
      }];
    })
    : [];

  const clearances = Array.isArray(raw.clearances)
    ? raw.clearances.flatMap((entry) => {
      const ll = toLatLng(entry);
      if (!ll || !entry || typeof entry !== 'object') return [];
      const r = entry as unknown as Record<string, unknown>;
      const heightMm = Number(r.heightMm);
      return [{
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        ...ll,
        heightMm: Number.isFinite(heightMm) && heightMm > 0 ? Math.round(heightMm) : 5000,
        note: typeof r.note === 'string' ? r.note : '',
      }];
    })
    : [];

  return {
    version: EMPTY_MAP_DOC.version,
    points,
    areas,
    // Желтая база — ручная статичная геометрия. Не сшиваем и не нормализуем ее
    // при загрузке, иначе приложение само сдвигает нарисованные дороги.
    roads,
    roadSuggestions,
    roadAccess: roadAccessMigrated,
    crossings,
    railways,
    clearances,
  };
}

function normalizeVehicleList(raw: unknown): VehicleType[] {
  return Array.isArray(raw)
    ? [...new Set(raw.map(normalizeVehicleId).filter((v): v is VehicleType => v !== null))]
    : [];
}

function normalizePurposes(raw: unknown, warehouseId: string | null): PointPurpose[] {
  const valid: PointPurpose[] = ['tech', 'exped', 'other'];
  if (Array.isArray(raw)) {
    const list = [...new Set(raw.filter((v): v is PointPurpose => valid.includes(v as PointPurpose)))];
    if (list.length > 0) return list;
  }
  // Старый документ без назначений: со складом → Технология, свободная → Иное.
  return warehouseId ? ['tech'] : ['other'];
}

function normalizeVehiclesByPurpose(raw: unknown): Partial<Record<PointPurpose, VehicleType[]>> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<PointPurpose, VehicleType[]>> = {};
  for (const key of ['tech', 'exped', 'other'] as PointPurpose[]) {
    const list = normalizeVehicleList(r[key]);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

function normalizeRoadVehiclesByPurpose(raw: unknown): Partial<Record<PointPurpose, VehicleType[]>> {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const out: Partial<Record<PointPurpose, VehicleType[]>> = {};
  for (const key of ['tech', 'exped', 'other'] as PointPurpose[]) {
    if (Array.isArray(record[key])) out[key] = normalizeVehicleList(record[key]);
  }
  return out;
}

function hasStoredVehiclePurposeMatrix(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  return (['tech', 'exped', 'other'] as PointPurpose[]).some((key) => Array.isArray(record[key]));
}

function migrateRoadVehiclesByPurpose(
  kind: RoadAccessKind,
  vehicles: VehicleType[],
  mode: 'allow' | 'deny',
): Partial<Record<PointPurpose, VehicleType[]>> {
  if (kind !== 'limited') return {};
  const all = POINT_VEHICLE_TYPES.map((vehicle) => vehicle.id);
  const allowed = mode === 'deny'
    ? all.filter((vehicle) => !vehicles.includes(vehicle))
    : (vehicles.length > 0 ? vehicles : all);
  return { tech: [...allowed], exped: [...allowed], other: [...allowed] };
}

function vehicleMatrixHasAny(matrix: Partial<Record<PointPurpose, VehicleType[]>>): boolean {
  return Object.values(matrix).some((list) => Array.isArray(list) && list.length > 0);
}

function normalizeRearByPurpose(
  rearByPurpose: Partial<Record<PointPurpose, VehicleType[]>>,
  vehiclesByPurpose: Partial<Record<PointPurpose, VehicleType[]>>,
  legacyRearUnload: boolean,
): Partial<Record<PointPurpose, VehicleType[]>> {
  const clean = pruneRearByPurpose(rearByPurpose, vehiclesByPurpose);
  if (vehicleMatrixHasAny(clean) || !legacyRearUnload) return clean;

  const migrated: Partial<Record<PointPurpose, VehicleType[]>> = {};
  for (const key of ['tech', 'exped', 'other'] as PointPurpose[]) {
    const selected = vehiclesByPurpose[key] ?? [];
    if (selected.length > 0) migrated[key] = [...selected];
  }
  return migrated;
}

function pruneRearByPurpose(
  rearByPurpose: Partial<Record<PointPurpose, VehicleType[]>>,
  vehiclesByPurpose: Partial<Record<PointPurpose, VehicleType[]>>,
): Partial<Record<PointPurpose, VehicleType[]>> {
  const out: Partial<Record<PointPurpose, VehicleType[]>> = {};
  for (const key of ['tech', 'exped', 'other'] as PointPurpose[]) {
    const selected = new Set(vehiclesByPurpose[key] ?? []);
    const list = (rearByPurpose[key] ?? []).filter((v) => selected.has(v));
    if (list.length > 0) out[key] = list;
  }
  return out;
}

const ALL_POINT_VEHICLE_IDS: VehicleType[] = POINT_VEHICLE_TYPES.map((v) => v.id);

/**
 * Разовый (v<8) засев матрицы «тип ТС × назначение» из старой модели: для каждого
 * назначения точки берём её общий список машин, а если он пуст (=«все машины»),
 * ставим ВСЕ типы — иначе точка потеряла бы назначение при первой же правке
 * (назначение теперь выводится из непустого столбца). Заполненную матрицу не трогаем.
 */
function seedMatrixV8(
  vbp: Partial<Record<PointPurpose, VehicleType[]>>,
  purposes: PointPurpose[],
  allowed: VehicleType[],
  incomingVersion: number,
): Partial<Record<PointPurpose, VehicleType[]>> {
  if (incomingVersion >= 8) return vbp;
  const out = { ...vbp };
  for (const p of purposes) {
    if (!out[p] || out[p]!.length === 0) {
      out[p] = allowed.length > 0 ? [...allowed] : [...ALL_POINT_VEHICLE_IDS];
    }
  }
  return out;
}

function normalizePointEquipment(raw: unknown): PointEquipment {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_POINT_EQUIPMENT };
  const r = raw as Record<string, unknown>;
  return {
    crane: r.crane === true,
    craneBeam: r.craneBeam === true,
    autoCrane: r.autoCrane === true,
    stacker: r.stacker === true,
    // Погрузчик возвращён в оснастку (юзер 2026-07-05); старые документы с
    // давним forklift-флагом просто подхватят его обратно.
    forklift: r.forklift === true,
    manual: r.manual === true,
  };
}

async function flush(doc: MapDoc): Promise<void> {
  writePlainBackup(doc);
  writeDailySnapshot(doc);
  try {
    await window.pyn?.cache?.save(CACHE_NAME, JSON.stringify(doc));
    lastSavedDoc = doc;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] cache save failed:', err);
  }
}

const SNAPSHOT_DAY_KEY = 'pyn:flow-map:snapshot-day';

/**
 * Ротация 7 суточных копий карты (`flow-map-day-0..6`, по дню недели): точки
 * восстановления до недели назад на случай сбоя сервера/испорченного документа —
 * даже если плохой doc перезапишет и кэш, и plain-бэкап. Пишем раз в день.
 */
function writeDailySnapshot(doc: MapDoc): void {
  try {
    if (scoreDoc(doc) <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    if (window.localStorage?.getItem(SNAPSHOT_DAY_KEY) === today) return;
    window.localStorage?.setItem(SNAPSHOT_DAY_KEY, today);
    void window.pyn?.cache?.save(`${CACHE_NAME}-day-${new Date().getDay()}`, JSON.stringify(doc));
  } catch { /* snapshot is best-effort */ }
}

function scheduleSave(doc: MapDoc): void {
  writePlainBackup(doc);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flush(doc);
  }, SAVE_DEBOUNCE_MS);
}

function writePlainBackup(doc: MapDoc): void {
  try {
    // «От сбоя»: не даём сбойному ПУСТОМУ документу затереть уже сохранённую
    // локальную копию всех отметок. Если сейчас doc пуст, а в бэкапе есть контент
    // — это почти наверняка сбой загрузки/синхронизации, а не «стёрли всё руками».
    // Проверка только когда doc пуст (редко) — на обычные правки не тормозит.
    if (scoreDoc(doc) === 0) {
      const existing = loadPlainBackup();
      if (existing && scoreDoc(existing) > 0) return;
    }
    window.localStorage?.setItem(BACKUP_NAME, JSON.stringify(doc));
  } catch { /* localStorage backup is best-effort */ }
}

function loadPlainBackup(): MapDoc | null {
  try {
    const raw = window.localStorage?.getItem(BACKUP_NAME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>;
    return normalizeDoc(parsed);
  } catch {
    return null;
  }
}

function scoreDoc(doc: MapDoc | null): number {
  if (!doc) return -1;
  return doc.points.length * 10 + doc.areas.length * 10 + doc.roads.length * 100 + doc.roadSuggestions.length + doc.roadAccess.length * 5 + (doc.crossings?.length ?? 0) * 5 + (doc.railways?.length ?? 0) * 10 + (doc.clearances?.length ?? 0) * 5;
}

/** Загрузка карты из кэша (encrypted). true если найдена. */
export async function loadMapFromCache(): Promise<boolean> {
  let encryptedDoc: MapDoc | null = null;
  try {
    const raw = await window.pyn?.cache?.load(CACHE_NAME);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>;
      encryptedDoc = normalizeDoc(parsed);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] cache load failed:', err);
  }

  const backupDoc = loadPlainBackup();
  const doc = scoreDoc(backupDoc) > scoreDoc(encryptedDoc) ? backupDoc : encryptedDoc;
  if (!doc) return false;
  const sc = scoreDoc(doc);
  if (sc > 0) {
    everHadContent = true;
    if (sc > knownGoodScore) knownGoodScore = sc;
  }
  applyingRemote = true;
  try {
    lastSavedDoc = doc;
    useMapStore.getState().setDoc(doc);
  } finally {
    applyingRemote = false;
  }
  if (doc === backupDoc) void flush(doc);
  return true;
}

// ─── Серверная синхронизация (общий документ карты) ──────────────────────────

/** Применить документ с сервера в стор (без обратного пуша). */
function applyServerDoc(raw: string, version: number): void {
  let doc: MapDoc;
  try {
    doc = normalizeDoc(JSON.parse(raw) as Partial<MapDoc> & Record<string, unknown>);
  } catch {
    return;
  }
  // 🛡️ Сервер прислал ПУСТО / СИЛЬНО УРЕЗАННОЕ, а у нас локально ЕСТЬ контент
  // → не затираем себя. Запоминаем версию, чтобы не зациклиться, и
  // ВОССТАНАВЛИВАЕМ сервер своим непустым документом (сервер теперь сам
  // отвергает empty/shrink, но клиент — второй рубеж).
  const localDoc = useMapStore.getState().doc;
  const remoteScore = scoreDoc(doc);
  const localScore = scoreDoc(localDoc);
  if (remoteScore === 0 && localScore > 0) {
    serverVersion = version;
    everHadContent = true;
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] сервер пуст, а локально есть данные — восстанавливаю сервер');
    schedulePush(localDoc);
    return;
  }
  if (
    localScore >= MAP_PROTECT_MIN_SCORE &&
    remoteScore > 0 &&
    remoteScore < localScore * MAP_SHRINK_RATIO
  ) {
    serverVersion = version;
    everHadContent = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[pyn:map] сервер схлопнут (score ${remoteScore} << local ${localScore}) — не применяю, пушу локальное`,
    );
    schedulePush(localDoc);
    return;
  }
  if (remoteScore > 0) everHadContent = true;
  applyingRemote = true;
  try {
    lastSavedDoc = doc;   // не триггерим повторный cache-save / push на этот doc
    useMapStore.getState().setDoc(doc);
    serverVersion = version;
    void flush(doc);      // в локальный кэш как есть
  } finally {
    applyingRemote = false;
  }
}

/** Видели ли мы за сессию НЕпустой документ (был контент на сервере/локально). */
let everHadContent = false;
/** Лучший score, который мы уже видели (локально или с сервера) — baseline anti-shrink. */
let knownGoodScore = 0;

/** Отправить текущий документ на сервер (admin). Обновляет serverVersion. */
async function pushNow(doc: MapDoc): Promise<void> {
  // Только 1.3.11+ — старые сборки не должны даже пытаться (сервер всё равно 403).
  if (!canWriteMapToServer()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pyn:map] push пропущен: нужна сборка ≥ ${MAP_MIN_CLIENT_VERSION}, сейчас ${appClientVersion() || '?'}`,
    );
    return;
  }
  // 🛡️ ЗАЩИТА ОТ ПОТЕРИ ДАННЫХ: не затираем общий документ карты ПУСТЫМ / сильно
  // урезанным. Если за сессию был контент (точки/дороги), а теперь doc пуст или
  // score схлопнулся — это почти наверняка сбой, а не «удалили всё». Не пушим.
  const nextScore = scoreDoc(doc);
  const baselineScore = Math.max(scoreDoc(lastSavedDoc), knownGoodScore);
  if (nextScore > 0) {
    everHadContent = true;
    if (nextScore > knownGoodScore) knownGoodScore = nextScore;
  } else if (everHadContent || baselineScore > 0) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] пропускаю push ПУСТОГО документа — не затираем общую карту');
    return;
  }
  if (
    baselineScore >= MAP_PROTECT_MIN_SCORE &&
    nextScore > 0 &&
    nextScore < baselineScore * MAP_SHRINK_RATIO
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pyn:map] пропускаю push схлопнутого doc (score ${nextScore} << baseline ${baselineScore})`,
    );
    return;
  }
  try {
    const res = await mapSet(api, JSON.stringify(doc), appClientVersion());
    serverVersion = res.version;
    lastSavedDoc = doc;
    if (nextScore > knownGoodScore) knownGoodScore = nextScore;
  } catch (err) {
    // Не admin (403) / old client / нет сети / anti-wipe 409 — локальный кэш остаётся.
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] server push failed:', err);
  }
}

function schedulePush(doc: MapDoc): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushNow(doc); }, PUSH_DEBOUNCE_MS);
}

/** Догнать сервер, если там версия новее нашей. Вызывается на WS `map_changed`. */
export async function refreshMapFromServer(): Promise<void> {
  try {
    const res = await mapGet(api);
    if (res.doc && res.version > serverVersion) applyServerDoc(res.doc, res.version);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] server refresh failed:', err);
  }
}

/** Первичная синхронизация: СЕРВЕР = правда. Локальное пушим только если сервер пуст. */
async function syncFromServerInitial(): Promise<void> {
  try {
    const res = await mapGet(api);
    if (res.doc && res.version > 0) {
      // Сервер приоритет: всегда применяем (anti-shrink внутри applyServerDoc
      // защитит, если сервер внезапно «пустой» относительно локального).
      applyServerDoc(res.doc, res.version);
    } else {
      serverVersion = res.version;
      const localDoc = useMapStore.getState().doc;
      // Сервер пуст — единственный случай «залить локальное» (миграция/recovery).
      if (scoreDoc(localDoc) > 0 && canWriteMapToServer()) await pushNow(localDoc);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:map] initial server sync failed (остаёмся на кэше):', err);
  }
}

/** Грузит кэш + сервер + включает авто-сохранение (локально + на сервер). */
export async function initMap(): Promise<void> {
  await loadMapFromCache();
  useMapStore.getState().setLoaded(true);

  if (!subscribed) {
    subscribed = true;
    useMapStore.subscribe((state) => {
      if (state.doc !== lastSavedDoc) {
        scheduleSave(state.doc);
        if (!applyingRemote) schedulePush(state.doc);
      }
    });
    window.addEventListener('beforeunload', () => {
      const doc = useMapStore.getState().doc;
      writePlainBackup(doc);
      void flush(doc);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      void flushMapNow();
    });
  }

  // После локального кэша — синхронизируемся с сервером (общая карта у всех).
  void syncFromServerInitial();
}

/** Принудительный сброс на диск + на сервер (visibility hidden / logout). */
export async function flushMapNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const doc = useMapStore.getState().doc;
  await flush(doc);
  if (!applyingRemote) await pushNow(doc);
}
