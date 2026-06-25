/**
 * Типы раздела «Карта» — живая спутниковая карта (тайлы Google через VPS-релей)
 * + наши точки складов, области цехов, нарисованные дороги. Хранится ЛОКАЛЬНО
 * (зашифрованный кэш `flow-map`, как базы), пока модель не выверена.
 *
 * ⚙️ Координаты — НАСТОЯЩИЕ GPS (широта/долгота), движок географический
 * (MapLibre). Поэтому у каждой точки сразу есть lat/lng, калибровка не нужна.
 */

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
}

export interface PointEquipment {
  crane: boolean;
  forklift: boolean;
  stacker: boolean;
}

export const EMPTY_POINT_EQUIPMENT: PointEquipment = {
  crane: false,
  forklift: false,
  stacker: false,
};

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
 * Тип машины для «особенностей» дороги — кто может проехать по участку.
 * Фиксированный список (юзер 2026-06-24). Два «Пульмана» — это разный метраж.
 */
export type VehicleType = 'pullman9' | 'pullman12' | 'bortovik' | 'gazelle' | 'furgon_khp';

export const VEHICLE_TYPES: ReadonlyArray<{ id: VehicleType; label: string; short: string }> = [
  { id: 'pullman9', label: 'ПУЛЬМАН (9м)', short: 'П9' },
  { id: 'pullman12', label: 'ПУЛЬМАН (12м)', short: 'П12' },
  { id: 'bortovik', label: 'БОРТ', short: 'БОРТ' },
  { id: 'gazelle', label: 'ГАЗЕЛЬ', short: 'ГАЗ' },
  { id: 'furgon_khp', label: 'ФУРГОН КХП', short: 'КХП' },
];

export function vehicleLabel(id: VehicleType): string {
  return VEHICLE_TYPES.find((v) => v.id === id)?.label ?? id;
}
export function vehicleShort(id: VehicleType): string {
  return VEHICLE_TYPES.find((v) => v.id === id)?.short ?? id;
}

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
  { id: 'closed', label: 'НЕТ ПРОЕЗДА', short: 'СТОП', color: '#EF4444', kind: 'closed', vehicles: [] },
  { id: 'bortovik', label: 'БОРТ', short: 'БОРТ', color: '#F59E0B', kind: 'limited', vehicles: ['bortovik'] },
  { id: 'pullman9', label: 'ПУЛЬМАН (9м)', short: 'П9', color: '#8B5CF6', kind: 'limited', vehicles: ['pullman9'] },
  { id: 'pullman12', label: 'ПУЛЬМАН (12м)', short: 'П12', color: '#A855F7', kind: 'limited', vehicles: ['pullman12'] },
  { id: 'gazelle', label: 'ГАЗЕЛЬ', short: 'ГАЗ', color: '#22C55E', kind: 'limited', vehicles: ['gazelle'] },
  { id: 'furgon_khp', label: 'ФУРГОН КХП', short: 'КХП', color: '#06B6D4', kind: 'limited', vehicles: ['furgon_khp'] },
  { id: 'erase', label: 'ЛАСТИК', short: 'CLR', color: '#94A3B8', kind: 'erase', vehicles: [] },
];

export function roadPaintOption(id: RoadPaintMode) {
  return ROAD_PAINT_OPTIONS.find((o) => o.id === id) ?? ROAD_PAINT_OPTIONS[0]!;
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
}

/** Инструмент на тулбаре карты. */
export type MapTool = 'select' | 'point' | 'area' | 'road' | 'confirmRoad' | 'vehicles' | 'optimize';

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
  version: 4,
  points: [],
  areas: [],
  roads: [],
  roadSuggestions: [],
  roadAccess: [],
};
