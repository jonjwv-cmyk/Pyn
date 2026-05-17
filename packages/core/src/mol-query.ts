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

  if (CYRILLIC.test(raw)) {
    return { mode: 'name', raw, tokens: [raw] };
  }

  if (ONLY_DIGITS_OR_SEPARATORS.test(raw)) {
    const allTokens = raw.split(SEPARATORS).filter((t) => t.length > 0);
    if (allTokens.length > 0) {
      // Phone — любой токен длиннее 4 цифр (склад — ровно 4).
      const hasLongToken = allTokens.some((t) => t.length > 4);
      if (hasLongToken) {
        return { mode: 'phone', raw, tokens: [raw.replace(/\D/g, '')] };
      }
      // Warehouse — фильтруем только валидные 4-значные. Неполные —
      // в invalidTokens (для error-карточки).
      const valid = allTokens.filter((t) => t.length === 4);
      const invalid = allTokens.filter((t) => t.length !== 4);
      return {
        mode: 'warehouse',
        raw,
        tokens: Array.from(new Set(valid)),
        invalidTokens: invalid.length > 0 ? Array.from(new Set(invalid)) : undefined,
      };
    }
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
      // Точное совпадение (склад = ровно 4-значный токен).
      return parsed.tokens.some((t) => wid === t);
    }
    case 'phone': {
      const phone = t0;
      if (!phone) return false;
      const mobile = record.mobile.replace(/\D/g, '');
      const work = record.work.replace(/\D/g, '');
      const warehousePhones = record.warehouseWorkPhones.replace(/\D/g, '');
      return mobile.includes(phone) || work.includes(phone) || warehousePhones.includes(phone);
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
    const key = `${r.fio.trim().toLowerCase()}|${r.mobile.trim()}`;
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
