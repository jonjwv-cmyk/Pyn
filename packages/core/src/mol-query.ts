import type { MolRecord } from './endpoints/base';

/**
 * Разбор пользовательского ввода в поиске МОЛ. Автоопределяет режим
 * и для warehouse-mode дробит запрос на отдельные склады.
 *
 * Примеры:
 *
 *   ""                        → {empty, []}
 *   "ivanov@otl"              → {email, ['ivanov@otl']}
 *   "0609"                    → {warehouse, ['0609']}
 *   "0609 0101"               → {warehouse, ['0609', '0101']}
 *   "0609 / 9013"             → {warehouse, ['0609', '9013']}
 *   "0609-9013"               → {warehouse, ['0609', '9013']}
 *   "8-912-345-67-89"         → {phone, ['89123456789']}
 *   "Иванов"                  → {name, ['Иванов']}
 *
 * Правило warehouse: вход состоит ТОЛЬКО из digits + разделителей
 * `[\s\/\-]+`. Phone это тоже digits, но обычно с ≥7 подряд → различим
 * после split.
 */

export type MolQueryMode = 'warehouse' | 'phone' | 'email' | 'name' | 'empty';

export interface ParsedMolQuery {
  mode: MolQueryMode;
  raw: string;
  /**
   * Warehouse: РОВНО 4-значные токены (валидные); phone: digits-only;
   * email/name: [raw]. Неполные/невалидные warehouse-токены НЕ попадают
   * сюда — только в `invalidTokens` (для error-карточки в sidebar).
   */
  tokens: string[];
  /**
   * Warehouse-mode only: токены, которые юзер ввёл, но они НЕ 4-значные
   * (например `0609 9` → tokens=[0609], invalidTokens=[9]). Показываются
   * отдельной error-карточкой «Не удалось найти».
   */
  invalidTokens?: string[];
}

const SEPARATORS = /[\s/\-]+/;
const ONLY_DIGITS_OR_SEPARATORS = /^[\d\s/\-]+$/;
const CYRILLIC = /[а-яА-ЯёЁ]/;
const LATIN = /[a-zA-Z]/;
// §pyn-1.2.54 — склад: 4 знака, первые 3 — цифры, 4-й — цифра или буква
// (кириллица или латиница). Примеры: `0609`, `8024`, `824Т`, `824T`.
// Юзер: «если впереди три цифры потом буква любая хоть латинская хоть кириллица».
const WAREHOUSE_TOKEN = /^\d{3}[\dA-Za-zА-Яа-яёЁ]$/;
// Partial input — юзер ещё печатает (1-3 digit'a). Чтобы в режиме warehouse
// показать как invalidTokens, а не неверно ребрендить в phone/name.
const PARTIAL_WAREHOUSE = /^\d{1,4}$/;

/**
 * Правила определения режима (приоритет сверху вниз):
 *
 *   1. Содержит `@`           → email
 *   2. Кириллица              → name (ФИО / должность / таб.)
 *   3. Только digits + separators:
 *      • Все токены = 4 цифры → warehouse (multi-token поддерживается:
 *        `0609 9013`, `0609/9013`, `0609-9013`).
 *      • Хотя бы один токен > 4 цифр → phone (склад = только 4-значный).
 *      • Иначе → warehouse с invalidTokens (неполный ввод типа `0609 9`).
 *   4. Латиница (без @)       → email (юзер вводит часть email-логина).
 *   5. Иначе                  → name fallback.
 *
 * Юзерская модель: «4 цифры = склад, всё длиннее = телефон, латиница =
 * почта, кириллица = ФИО». Это даёт детерминированное поведение без
 * случайных переключений mode'a по символу.
 */
export function parseMolQuery(input: string): ParsedMolQuery {
  const raw = input.trim();
  if (!raw) return { mode: 'empty', raw: '', tokens: [] };

  if (raw.includes('@')) {
    return { mode: 'email', raw, tokens: [raw] };
  }

  // §pyn-1.2.54 — warehouse-check ПЕРЕД cyrillic/latin: склад может содержать
  // букву в 4-й позиции (824Т, 824T), и это не должно сбить parser в name-mode.
  const splitTokens = raw.split(SEPARATORS).filter((t) => t.length > 0);
  if (splitTokens.length > 0) {
    const isAllWarehouseLike = splitTokens.every(
      (t) => WAREHOUSE_TOKEN.test(t) || PARTIAL_WAREHOUSE.test(t),
    );
    const anyValid = splitTokens.some((t) => WAREHOUSE_TOKEN.test(t));
    const allDigitsOnly = ONLY_DIGITS_OR_SEPARATORS.test(raw);
    if (isAllWarehouseLike && (anyValid || allDigitsOnly)) {
      // Если все digits-only И есть длинный (>4) токен — это телефон, не склад.
      if (allDigitsOnly && splitTokens.some((t) => t.length > 4)) {
        return { mode: 'phone', raw, tokens: [raw.replace(/\D/g, '')] };
      }
      const valid = Array.from(new Set(splitTokens.filter((t) => WAREHOUSE_TOKEN.test(t))));
      const invalid = Array.from(new Set(splitTokens.filter((t) => !WAREHOUSE_TOKEN.test(t))));
      return {
        mode: 'warehouse',
        raw,
        tokens: valid,
        invalidTokens: invalid.length > 0 ? invalid : undefined,
      };
    }
  }

  // Pure-digit ввод который не matched warehouse-pattern — phone (длинный).
  if (ONLY_DIGITS_OR_SEPARATORS.test(raw)) {
    const allTokens = splitTokens;
    if (allTokens.some((t) => t.length > 4)) {
      return { mode: 'phone', raw, tokens: [raw.replace(/\D/g, '')] };
    }
    // Все короткие digit'ы, но не сформировался валидный warehouse — partial.
    return {
      mode: 'warehouse',
      raw,
      tokens: [],
      invalidTokens: Array.from(new Set(allTokens)),
    };
  }

  if (CYRILLIC.test(raw)) {
    return { mode: 'name', raw, tokens: [raw] };
  }

  if (LATIN.test(raw)) {
    return { mode: 'email', raw, tokens: [raw] };
  }

  return { mode: 'name', raw, tokens: [raw] };
}

/**
 * `true` если запись подходит под parsed-query. Используется в client-side
 * фильтрации списка после того как база скачана (быстрее серверного `base_find`,
 * работает offline).
 */
export function matchesMolQuery(record: MolRecord, parsed: ParsedMolQuery): boolean {
  if (parsed.mode === 'empty') return true;
  const t0 = parsed.tokens[0] ?? '';

  switch (parsed.mode) {
    case 'warehouse': {
      if (parsed.tokens.length === 0) return false;
      const wid = record.warehouseId.trim();
      if (!wid) return false;
      // §pyn-1.2.54 — case-insensitive compare: warehouse-id может содержать
      // букву (824Т / 824T), юзер вводит в любом регистре.
      const widLower = wid.toLowerCase();
      return parsed.tokens.some((t) => widLower === t.toLowerCase());
    }
    case 'phone': {
      const q = t0;
      if (!q) return false;
      const mobile = record.mobile.replace(/\D/g, '');
      const work = record.work.replace(/\D/g, '');
      const warehousePhones = record.warehouseWorkPhones.replace(/\D/g, '');
      // §pyn-1.2.22 — search также по табельному (digits). Юзер: «добавить
      // поиск по табельному номеру». Естественно — юзер вводит число и
      // оно ищется в телефонах и в tab одновременно.
      const tab = record.tab.replace(/\D/g, '');
      return (
        mobile.includes(q)
        || work.includes(q)
        || warehousePhones.includes(q)
        || (tab.length > 0 && tab.includes(q))
      );
    }
    case 'email': {
      const q = t0.toLowerCase();
      return record.mail.toLowerCase().includes(q);
    }
    case 'name': {
      const q = t0.toLowerCase();
      // searchText — server-precomputed lowercased (FIO+phone+mail+tab+...).
      // Если он есть — самый дешёвый match. Иначе fall through на отдельные поля.
      if (record.searchText && record.searchText.includes(q)) return true;
      return (
        record.fio.toLowerCase().includes(q) ||
        record.position.toLowerCase().includes(q) ||
        record.tab.toLowerCase().includes(q)
      );
    }
    default:
      return false;
  }
}

/**
 * Группирует найденные записи по складам — для warehouse-mode, чтобы UI мог
 * отрендерить правый sidebar с отдельным блоком на каждый склад.
 * Только записи с реальным `warehouseId` (не `МОЛ`-marker) попадают сюда.
 */
export function groupByWarehouse(records: MolRecord[]): Map<string, MolRecord[]> {
  const groups = new Map<string, MolRecord[]>();
  for (const r of records) {
    const wid = r.warehouseId.trim();
    if (!wid) continue;
    const upper = wid.toUpperCase();
    if (upper === 'МОЛ' || upper === 'MOL') continue;
    const arr = groups.get(wid) ?? [];
    arr.push(r);
    groups.set(wid, arr);
  }
  return groups;
}

/**
 * Дедупликация: один человек = одна запись в таблице, даже если на сервере
 * у него N records (по одной на каждый склад). Group-key = `fio + mobile` —
 * как в Android `groupByPerson` (см. SearchTab.kt).
 *
 * Возвращает первую запись для каждой person + счётчик дублей. Дубли НЕ
 * теряются — оригинальный array остаётся для warehouseGroups (sidebar
 * показывает все склады человека из original records).
 */
export interface DedupedMolRecord {
  /** Первая встретившаяся запись этого человека (та чей order был раньше). */
  record: MolRecord;
  /** Сколько ВСЕГО записей у этого человека (1 = уникален; N>1 = N складов). */
  duplicateCount: number;
  /** warehouseId всех вхождений (для сводки «числится на: 0609, 9013, ...»). */
  warehouseIds: string[];
}

export function dedupeMolByPerson(records: MolRecord[]): DedupedMolRecord[] {
  const byKey = new Map<string, { record: MolRecord; wids: string[] }>();
  const order: string[] = [];
  for (const r of records) {
    // §pyn-1.2.22 — unique key = табельный номер (юзер: «уникальный МОЛ
    // это именно табельный номер. если в гугл таблице изменится телефон
    // почта или даже фамилия а табельный сохранится тогда это ничего не
    // значит»). Fallback на fio+mobile только если tab пустой (защита от
    // legacy записей без табельного).
    const tab = r.tab.trim();
    const key = tab.length > 0
      ? `tab:${tab}`
      : `nm:${r.fio.trim().toLowerCase()}|${r.mobile.trim()}`;
    const existing = byKey.get(key);
    if (existing) {
      const wid = r.warehouseId.trim();
      if (wid && !existing.wids.includes(wid)) existing.wids.push(wid);
      continue;
    }
    const wid = r.warehouseId.trim();
    byKey.set(key, { record: r, wids: wid ? [wid] : [] });
    order.push(key);
  }
  return order.map((k) => {
    const v = byKey.get(k);
    if (!v) throw new Error('dedupeMolByPerson: missing key');
    return {
      record: v.record,
      duplicateCount: v.wids.length || 1,
      warehouseIds: v.wids,
    };
  });
}
