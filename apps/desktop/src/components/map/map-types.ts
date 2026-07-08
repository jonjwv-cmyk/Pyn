/**
 * Типы раздела «Карта» — живая спутниковая карта (тайлы Google через VPS-релей)
 * + наши точки складов, области цехов, нарисованные дороги. Хранится ЛОКАЛЬНО
 * (зашифрованный кэш `flow-map`, как базы), пока модель не выверена.
 *
 * ⚙️ Координаты — НАСТОЯЩИЕ GPS (широта/долгота), движок географический
 * (MapLibre). Поэтому у каждой точки сразу есть lat/lng, калибровка не нужна.
 */

import { BODY_TYPES, type BodyType } from '@/components/flow/flow-body-types';

/** Географическая точка (широта/долгота). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Точка на карте. Склад может иметь несколько точек (несколько `MapPoint` с
 *  одним `warehouseId`) — «склад может быть в нескольких точках». */
export interface MapPoint extends LatLng {
  id: string;
  /** Привязка к складу из базы «Цеха» (Warehouse.id). null — свободная точка. */
  warehouseId: string | null;
  /** Подпись на карте (по умолчанию = номер склада). */
  label: string;
  /** Комментарий «что выгружаем / место выгрузки». */
  comment: string;
  /**
   * Вес точки для логистической оптимизации — объём/кол-во отгрузок в эту точку.
   * По умолчанию 1. Чем больше — тем сильнее точка «тянет» оптимум к себе.
   */
  weight: number;
  /** Оснастка на месте выгрузки. Если всё false — считаем, что погрузка ручная. */
  equipment: PointEquipment;
  /** Нюанс точки: ТМЦ ставить/забирать сзади. */
  rearUnload: boolean;
  /**
   * Какие машины могут заехать именно в эту точку. Пустой массив = без
   * ограничения, заехать можно всем.
   */
  allowedVehicles: VehicleType[];
}

export interface PointEquipment {
  crane: boolean;
  /** Кран-балка (мостовой/опорный кран в пролёте). */
  craneBeam: boolean;
  /** Авто-кран (стреловой кран на шасси). */
  autoCrane: boolean;
  stacker: boolean;
  /** Погрузчик (вилочный/фронтальный). В старых документах поля нет — читать falsy. */
  forklift: boolean;
  /** Ручная выгрузка/погрузка. */
  manual: boolean;
}

export const EMPTY_POINT_EQUIPMENT: PointEquipment = {
  crane: false,
  craneBeam: false,
  autoCrane: false,
  stacker: false,
  forklift: false,
  manual: false,
};

/** Описание оснастки для карточки точки (обозначения как просил пользователь). */
export const EQUIPMENT_META: ReadonlyArray<{ key: keyof PointEquipment; label: string; short: string }> = [
  { key: 'crane', label: 'КРАН', short: 'Кр' },
  { key: 'craneBeam', label: 'КРАН-БАЛКА', short: 'КБ' },
  { key: 'autoCrane', label: 'АВТО-КРАН', short: 'АК' },
  { key: 'stacker', label: 'ШТАБЕЛЕР', short: 'Шт' },
  { key: 'forklift', label: 'ПОГРУЗЧИК', short: 'Пгр' },
  { key: 'manual', label: 'РУЧНОЕ', short: 'Руч' },
];

/**
 * Категория точки для фильтра — выводится АВТОМАТИЧЕСКИ из статуса склада в
 * графике (ничего вручную проставлять не нужно):
 *   • shipping    — склад отгружается (активен в плане) → «Отгрузка»
 *   • unloading   — склад запланирован → «Выгрузка»
 *   • offSchedule — склада нет в графике / свободная точка → «Вне графика»
 */
export type PointCategory = 'shipping' | 'unloading' | 'offSchedule';

export const POINT_CATEGORY_META: ReadonlyArray<{ id: PointCategory; label: string; color: string }> = [
  { id: 'shipping', label: 'Отгрузка', color: '#C99BE0' },
  { id: 'unloading', label: 'Выгрузка', color: '#6FBF8E' },
  { id: 'offSchedule', label: 'Вне графика', color: '#5BA3D0' },
];

/** Категория точки по строке состояния склада из `getWarehouseState`. */
export function categoryFromWarehouseState(state: string | undefined | null): PointCategory {
  if (state === 'shipping') return 'shipping';
  if (state === 'scheduled') return 'unloading';
  return 'offSchedule';
}

/** Область (полигон) — «выделяем область, пишем: это конвертерный». */
export interface MapArea {
  id: string;
  name: string;
  /** HEX-цвет заливки/обводки. */
  color: string;
  vertices: LatLng[];
  /** Необязательная привязка к цеху (Warehouse.shop_name) — для фильтра. */
  shopName: string | null;
}

/** Дорога (ломаная) — «прорисовать самим», основа для маршрутов. */
export interface MapRoad {
  id: string;
  name: string;
  vertices: LatLng[];
  sourceId?: string;
}

/**
 * Ж/д путь (ломаная) — рисуем по желанию (не обязателен; обычно достаточно
 * отметить переезды). Это ВИЗУАЛЬНЫЙ слой, в авто-маршрутах не участвует.
 */
export interface MapRailway {
  id: string;
  name: string;
  vertices: LatLng[];
}

/**
 * Тип машины для «особенностей» дороги и «какая машина заедет в точку».
 * Названия и порядок — ЕДИНЫЙ список «ТИП ТС» Плана/Отчёта (юзер 2026-07-05),
 * см. flow-body-types.ts. Внутренние id стабильны — лежат в сохранённых картах.
 */
export type VehicleType =
  | 'pullman9'
  | 'pullman12'
  | 'bort'
  | 'bortovik'
  | 'gazelle'
  | 'furgon_khp'
  | 'maslovoz'
  | 'tral'
  | 'benzovoz'
  | 'frontal'
  | 'autocrane25'
  | 'autocrane100'
  | 'autocrane400'
  | 'samosval_bort'
  | 'samosval_bez_bort'
  | 'belaz'
  | 'atlas_bucket'
  | 'shit_car'
  | 'furgon';

/** Имя из списка ТИП ТС → стабильный id карты (TS ругнётся, если списки разъедутся). */
const BODY_TYPE_TO_VEHICLE: Record<BodyType, VehicleType> = {
  'Фургон КХП': 'furgon_khp',
  'Борт': 'bort',
  'Пульман 9м': 'pullman9',
  'Пульман 12м': 'pullman12',
  'Газель': 'gazelle',
  'Масловоз': 'maslovoz',
  'Трал': 'tral',
  'Бензовоз': 'benzovoz',
  'Фронтальный': 'frontal',
  'Автокран 25 т': 'autocrane25',
  'Автокран 100 т': 'autocrane100',
  'Автокран 400 т': 'autocrane400',
  'Самосвал борт': 'samosval_bort',
  'Самосвал без борт': 'samosval_bez_bort',
  'БЕЛАЗ': 'belaz',
  'Погр. ковш. ATLAS': 'atlas_bucket',
  'Shit машина': 'shit_car',
  'Фургон': 'furgon',
};

const VEHICLE_SHORT: Record<VehicleType, string> = {
  furgon_khp: 'КХП',
  bort: 'БОРТ',
  bortovik: 'БОРТ',
  pullman9: 'П9',
  pullman12: 'П12',
  gazelle: 'ГАЗ',
  maslovoz: 'МАСЛ',
  tral: 'ТРАЛ',
  benzovoz: 'БЕНЗ',
  frontal: 'ФРОНТ',
  autocrane25: 'АК25',
  autocrane100: 'АК100',
  autocrane400: 'АК400',
  samosval_bort: 'САМБ',
  samosval_bez_bort: 'САМ',
  belaz: 'БЕЛАЗ',
  atlas_bucket: 'ATLAS',
  shit_car: 'SHIT',
  furgon: 'ФУРГ',
};

export const VEHICLE_TYPES: ReadonlyArray<{ id: VehicleType; label: string; short: string }> =
  BODY_TYPES.map((label) => ({
    id: BODY_TYPE_TO_VEHICLE[label],
    label,
    short: VEHICLE_SHORT[BODY_TYPE_TO_VEHICLE[label]],
  }));

/** «Какая машина заедет в точку»: СТАРЫЕ типы сохраняем (юзер 2026-07-08 — на точках
 *  уже стоят П9/П12/БОРТ и т.д.), НОВЫЕ 5 добавляем следом. */
export const POINT_VEHICLE_TYPES: ReadonlyArray<{ id: VehicleType; label: string; short: string }> =
  ([
    'furgon_khp', 'bort', 'pullman9', 'pullman12', 'gazelle', 'maslovoz',
    'benzovoz', 'furgon', 'samosval_bort', 'samosval_bez_bort', 'belaz',
  ] as VehicleType[]).map((id) => ({
    id,
    label: vehicleLabelFromId(id),
    short: VEHICLE_SHORT[id],
  }));

/** Старые id из сохранённых карт → актуальные (БОРТОВИК переименован в Борт). */
const LEGACY_VEHICLE_IDS: Partial<Record<string, VehicleType>> = { bortovik: 'bort' };

/** Значение из сохранённого документа карты → актуальный id (null = мусор). */
export function normalizeVehicleId(v: unknown): VehicleType | null {
  if (typeof v !== 'string') return null;
  const actual = LEGACY_VEHICLE_IDS[v] ?? v;
  return VEHICLE_TYPES.some((t) => t.id === actual) ? (actual as VehicleType) : null;
}

function vehicleLabelFromId(id: VehicleType): string {
  const actual = LEGACY_VEHICLE_IDS[id] ?? id;
  return BODY_TYPES.find((label) => BODY_TYPE_TO_VEHICLE[label] === actual) ?? actual;
}

export function vehicleLabel(id: VehicleType): string {
  return vehicleLabelFromId(id);
}
export function vehicleShort(id: VehicleType): string {
  return VEHICLE_SHORT[id] ?? id;
}
/** Фирменный цвет машины (берём из палитры закраски дорог). */
export function vehicleColor(id: VehicleType): string {
  const actual = LEGACY_VEHICLE_IDS[id] ?? id;
  return ROAD_PAINT_OPTIONS.find((o) => o.id === actual)?.color ?? ROAD_ACCESS_FALLBACK_COLOR;
}

/** Бирюзовый — цвет участка со смешанными ограничениями (несколько машин). */
export const ROAD_ACCESS_FALLBACK_COLOR = '#22D3EE';

/**
 * «Особенность» участка дороги — обведённый кусок (лежит на дорогах) + какие
 * машины там могут ехать. По плану даёт понимание проходимости. `vertices`
 * привязаны к существующим дорогам (трасса инструмента «Особенности»).
 */
export interface RoadAccess {
  id: string;
  vertices: LatLng[];
  kind: 'limited' | 'closed';
  vehicles: VehicleType[];
  note: string;
}

export type RoadPaintMode = 'closed' | VehicleType | 'erase';

export const ROAD_PAINT_OPTIONS: ReadonlyArray<{
  id: RoadPaintMode;
  label: string;
  short: string;
  color: string;
  vehicles: VehicleType[];
  kind: RoadAccess['kind'] | 'erase';
}> = [
  { id: 'closed', label: 'Закрыто', short: 'Закрыто', color: '#EF4444', kind: 'closed', vehicles: [] },
  { id: 'furgon_khp', label: 'Фургон КХП', short: 'Фургон КХП', color: '#06B6D4', kind: 'limited', vehicles: ['furgon_khp'] },
  { id: 'gazelle', label: 'Газель', short: 'Газель', color: '#22C55E', kind: 'limited', vehicles: ['gazelle'] },
  { id: 'pullman9', label: 'Пульман 9м', short: 'Пульман 9м', color: '#8B5CF6', kind: 'limited', vehicles: ['pullman9'] },
  { id: 'pullman12', label: 'Пульман 12м', short: 'Пульман 12м', color: '#A855F7', kind: 'limited', vehicles: ['pullman12'] },
  { id: 'bort', label: 'Борт', short: 'Борт', color: '#F59E0B', kind: 'limited', vehicles: ['bort'] },
  { id: 'tral', label: 'Трал', short: 'Трал', color: '#64748B', kind: 'limited', vehicles: ['tral'] },
  { id: 'maslovoz', label: 'Масловоз', short: 'Масловоз', color: '#EC4899', kind: 'limited', vehicles: ['maslovoz'] },
  { id: 'erase', label: 'Ластик', short: 'Ластик', color: '#94A3B8', kind: 'erase', vehicles: [] },
];

export function roadPaintOption(id: RoadPaintMode) {
  return ROAD_PAINT_OPTIONS.find((o) => o.id === id) ?? ROAD_PAINT_OPTIONS[0]!;
}

/**
 * Ж/д переезд — точка пересечения дороги с ж/д путём. Это просто ФАКТ переезда
 * (риск задержки в расчётах) — никаких данных про шлагбаум/светофор не собираем.
 */
export interface MapCrossing extends LatLng {
  id: string;
  name: string;
  note: string;
}

/** Черновая дорога из внешней/ИИ-подсказки. До подтверждения не участвует в маршрутах. */
export interface MapRoadSuggestion {
  id: string;
  name: string;
  vertices: LatLng[];
  source: 'osm' | 'ai';
}

/** Весь документ карты (один на инсталляцию, локально). */
export interface MapDoc {
  version: number;
  points: MapPoint[];
  areas: MapArea[];
  roads: MapRoad[];
  roadSuggestions: MapRoadSuggestion[];
  roadAccess: RoadAccess[];
  /** Ж/д переезды. Может отсутствовать в старых документах — читать через `?? []`. */
  crossings: MapCrossing[];
  /** Ж/д пути (по желанию). Может отсутствовать в старых документах — `?? []`. */
  railways: MapRailway[];
}

/** Инструмент на тулбаре карты. */
export type MapTool =
  | 'select'
  | 'point'
  | 'area'
  | 'road'
  | 'eraseRoad'
  | 'confirmRoad'
  | 'vehicles'
  | 'crossing'
  | 'railway'
  | 'optimize';

/** Палитра цветов для областей (Linear-приглушённые тона). */
export const AREA_COLORS: string[] = [
  '#E8836B', // clay
  '#5BA3D0', // blue
  '#6FBF8E', // green
  '#C99BE0', // violet
  '#E0B84D', // amber
  '#E07B9A', // rose
  '#5BC2C2', // teal
];

/** Центр площадки ЕВРАЗ НТМК (стартовый вид карты). */
export const NTMK_CENTER: LatLng = { lat: 57.919494, lng: 60.02835 };
export const NTMK_ZOOM = 16.7;

export function makeId(): string {
  return crypto.randomUUID();
}

export const EMPTY_MAP_DOC: MapDoc = {
  version: 6,
  points: [],
  areas: [],
  roads: [],
  roadSuggestions: [],
  roadAccess: [],
  crossings: [],
  railways: [],
};
