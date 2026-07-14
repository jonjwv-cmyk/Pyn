/**
 * ТИП ТС — единый список кузовов (юзер 2026-07-02, по эталону экспедиции).
 *
 * ОДИН источник имён для:
 *   • колонки «ТИП ТС» в Плане/Отчёте (мульти-выпадашка, до 3 на строку);
 *   • карты — «какая машина заедет в точку» и «особенности дороги»
 *     (юзер 2026-07-05: карта берёт этот же список с теми же названиями).
 */
export const BODY_TYPES = [
  'Фургон КХП',
  'Борт',
  'Пульман 9м',
  'Пульман 10м',
  'Пульман 12м',
  'Пульман 13,5 м',
  'Автобус',
  'Газель',
  'Масловоз',
  'Трал',
  'Бензовоз',
  'Фронтальный',
  'Автокран 25 т',
  'Автокран 100 т',
  'Автокран 400 т',
  'Самосвал борт',
  'Самосвал без борт',
  'БЕЛАЗ',
  'Погр. ковш.',
  'ATLAS',
  'Shit машина',
  'Фургон',
] as const;

export type BodyType = (typeof BODY_TYPES)[number];

/**
 * «Груз сзади: да/нет» — СТРУКТУРИРОВАННЫЙ признак типа ТС (ТЗ карты 2026-07-09):
 * можно ли грузить/выгружать машину С ЗАДНЕГО борта. НЕ кодируется текстом в
 * названии; нужен для расчёта совместимости площадок и точек («ТМЦ сзади»).
 * Дефолты по здравому смыслу — правятся здесь одним местом.
 */
const REAR_LOAD_BY_BODY_TYPE: Record<BodyType, boolean> = {
  'Фургон КХП': true,
  'Борт': true,
  'Пульман 9м': true,
  'Пульман 10м': true,
  'Пульман 12м': true,
  'Пульман 13,5 м': true,
  'Автобус': false,
  'Газель': true,
  'Масловоз': false,
  'Трал': true,
  'Бензовоз': false,
  'Фронтальный': false,
  'Автокран 25 т': false,
  'Автокран 100 т': false,
  'Автокран 400 т': false,
  'Самосвал борт': true,
  'Самосвал без борт': false,
  'БЕЛАЗ': false,
  'Погр. ковш.': false,
  'ATLAS': false,
  'Shit машина': false,
  'Фургон': true,
};

/** Может ли тип ТС принимать груз сзади. Неизвестный тип → false. */
export function bodyTypeRearLoad(label: string): boolean {
  return REAR_LOAD_BY_BODY_TYPE[label as BodyType] === true;
}

const CAPACITY_BY_BODY_TYPE_KG: Record<string, number> = {
  'борт': 10_000,
  'бортовик': 10_000,
  'пульман 9м': 15_000,
  'пульман 10м': 20_000,
  'пульман 12м': 20_000,
  'пульман 13,5м': 22_000,
  'автобус': 8_000,
  'самосвал борт': 10_000,
  'самосвал без борт': 10_000,
};

function bodyTypeKey(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[.]+$/g, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*м/g, '$1м')
    .replace(/\s+/g, ' ');
}

export function bodyTypeCapacityKg(label: string): number | null {
  const value = CAPACITY_BY_BODY_TYPE_KG[bodyTypeKey(label)];
  return value == null ? null : value;
}

export function adjustedBodyTypeCapacityKg(
  label: string,
  refs: { capacityKg?: number | null; maxMassKg?: number | null } = {},
): number | null {
  const estimated = bodyTypeCapacityKg(label);
  if (estimated == null) return null;
  const candidates = [refs.capacityKg, refs.maxMassKg]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return estimated;
  const closest = candidates.reduce((best, value) =>
    Math.abs(value - estimated) < Math.abs(best - estimated) ? value : best,
  );
  return Math.abs(closest - estimated) <= estimated * 0.6 ? closest : estimated;
}
