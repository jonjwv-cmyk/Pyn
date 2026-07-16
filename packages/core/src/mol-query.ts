import type { MolRecord } from './endpoints/base';

/**
 * Разбор пользовательского ввода в поиске МОЛ / Контакты / Цеха.
 *
 * Главный кейс: вставка из буфера большого списка складов с мусором —
 *   «ляляля 8024 8024 8022 куля 824Т 824T …»
 * → mode=warehouse, tokens = уникальные коды в порядке первого появления.
 * Мусор (слова, пробелы, /, -, переносы, табы) отбрасывается.
 *
 * Склад: 4 знака — 3 цифры + цифра или буква (кириллица/латиница):
 *   `0609`, `8024`, `824Т`, `824T`, `824Ц`.
 *
 * Примеры:
 *   ""                        → {empty, []}
 *   "ivanov@otl"              → {email, ['ivanov@otl']}
 *   "0609"                    → {warehouse, ['0609']}
 *   "0609 0101"               → {warehouse, ['0609', '0101']}
 *   "ляляля 8024 куля 824Т"  → {warehouse, ['8024', '824Т']}
 *   "8-912-345-67-89"         → {phone, ['89123456789']}
 *   "Иванов"                  → {name, ['Иванов']}
 */

export type MolQueryMode = 'warehouse' | 'phone' | 'email' | 'name' | 'empty';

export interface ParsedMolQuery {
  mode: MolQueryMode;
  raw: string;
  /**
   * Warehouse: валидные 4-значные коды (порядок = порядок ввода, без дублей);
   * phone: digits-only; email/name: [raw или фрагмент].
   */
  tokens: string[];
  /**
   * Warehouse-mode only: токены, которые выглядели как «недописанный склад»
   * (1–3 цифры), когда весь ввод — только цифры/разделители без валидных кодов.
   * При paste с мусором invalidTokens не заполняем (мусор молча игнорируем).
   */
  invalidTokens?: string[];
}

const SEPARATORS = /[\s/\-,;|]+/;
const ONLY_DIGITS_OR_SEPARATORS = /^[\d\s/\-,;|]+$/;
const CYRILLIC = /[а-яА-ЯёЁ]/;
const LATIN = /[a-zA-Z]/
// Склад: 4 знака, первые 3 — цифры, 4-й — цифра или буква (кир/лат).
// Юзер: «если впереди три цифры потом буква любая хоть латинская хоть кириллица».
const WAREHOUSE_TOKEN = /^\d{3}[\dA-Za-zА-Яа-яёЁ]$/;
// Partial input — юзер ещё печатает (1-3 digit'a).
const PARTIAL_WAREHOUSE = /^\d{1,3}$/;
/**
 * Код склада в произвольном тексте: границы — не буква/цифра
 * (пробел, таб, перевод строки, / , ; | · и т.п.).
 * Не матчит середину табельного «1082426».
 */
const WAREHOUSE_IN_TEXT =
  /(?<![0-9A-Za-zА-Яа-яёЁ])(\d{3}[\dA-Za-zА-Яа-яёЁ])(?![0-9A-Za-zА-Яа-яёЁ])/g;

/**
 * Канон для сравнения кодов: upper + латиница T/C/M → кириллица Т/Ц/М
 * (в SAP/HTML бывает и `824T`, и `824Т`; база и ввод не всегда совпадают).
 */
export function warehouseCodeKey(code: string): string {
  const s = (code || '').trim().toUpperCase();
  if (!s) return '';
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === 'T') out += 'Т';
    else if (ch === 'C') out += 'Ц';
    else if (ch === 'M') out += 'М';
    else out += ch;
  }
  return out;
}

/** Извлечь уникальные коды складов из произвольной строки (порядок = first seen). */
export function extractWarehouseCodes(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(WAREHOUSE_IN_TEXT.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const code = (m[1] ?? '').trim();
    if (!code || !WAREHOUSE_TOKEN.test(code)) continue;
    const key = warehouseCodeKey(code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

/**
 * Правила определения режима (приоритет сверху вниз):
 *
 *   1. Пусто → empty
 *   2. В тексте есть ≥1 код склада (даже среди мусора «ляляля 8024 куля») → warehouse
 *   3. Содержит `@` и нет складов → email
 *   4. Только digits + separators, длинный токен → phone
 *   5. Кириллица без складов → name
 *   6. Латиница без складов → email (логин)
 *   7. name fallback
 */
export function parseMolQuery(input: string): ParsedMolQuery {
  const raw = input.trim();
  if (!raw) return { mode: 'empty', raw: '', tokens: [] };

  // ── 1) Склады из paste/мусора (главный путь для Контакты/Цеха) ──────────
  // «ляляля 8024 8024 8022 куля 824Т» → warehouse [8024, 8022, 824Т]
  const extracted = extractWarehouseCodes(raw);
  if (extracted.length > 0) {
    return { mode: 'warehouse', raw, tokens: extracted };
  }

  if (raw.includes('@')) {
    return { mode: 'email', raw, tokens: [raw] };
  }

  const splitTokens = raw.split(SEPARATORS).filter((t) => t.length > 0);

  // Pure-digit / separators only — телефон vs недописанный склад.
  if (ONLY_DIGITS_OR_SEPARATORS.test(raw)) {
    if (splitTokens.some((t) => t.length > 4)) {
      return { mode: 'phone', raw, tokens: [raw.replace(/\D/g, '')] };
    }
    const allDigits = raw.replace(/\D/g, '');
    if (allDigits.length > 4) {
      return { mode: 'phone', raw, tokens: [allDigits] };
    }
    // partial «060» / «9» — warehouse mode без валидных (пока печатают).
    return {
      mode: 'warehouse',
      raw,
      tokens: [],
      invalidTokens: Array.from(new Set(splitTokens.filter((t) => PARTIAL_WAREHOUSE.test(t) || t.length > 0))),
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
      const widKey = warehouseCodeKey(wid);
      return parsed.tokens.some((t) => warehouseCodeKey(t) === widKey);
    }
    case 'phone': {
      const q = t0;
      if (!q) return false;
      const mobile = record.mobile.replace(/\D/g, '');
      const work = record.work.replace(/\D/g, '');
      const warehousePhones = record.warehouseWorkPhones.replace(/\D/g, '');
      // §pyn-1.2.22 — search также по табельному (digits).
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
  /** Все склады человека с датой «по» (для колонки «Склад»): code='МОЛ' = маркер
   *  без конкретного склада; until='' = без срока. Порядок — как в источнике. */
  warehouses: Array<{ code: string; until: string }>;
}

/** Канонический ключ человека (как в dedupeMolByPerson): табельный, иначе fio+mobile.
 *  Стабилен между разными выдачами поиска → позволяет сопоставить человека из
 *  выдачи с его ПОЛНОЙ записью в базе (для «все склады МОЛа», а не только из поиска). */
export function molPersonKey(r: MolRecord): string {
  const tab = r.tab.trim();
  return tab.length > 0 ? `tab:${tab}` : `nm:${r.fio.trim().toLowerCase()}|${r.mobile.trim()}`;
}

export function dedupeMolByPerson(records: MolRecord[]): DedupedMolRecord[] {
  const byKey = new Map<string, { record: MolRecord; warehouses: Array<{ code: string; until: string }> }>();
  const order: string[] = [];
  for (const r of records) {
    // §pyn-1.2.22 — unique key = табельный (см. molPersonKey). Fallback на
    // fio+mobile только если tab пустой (legacy записи без табельного).
    const key = molPersonKey(r);
    const wid = r.warehouseId.trim();
    const until = r.warehouseUntil.trim();
    const existing = byKey.get(key);
    if (existing) {
      if (wid && !existing.warehouses.some((w) => warehouseCodeKey(w.code) === warehouseCodeKey(wid))) {
        existing.warehouses.push({ code: wid, until });
      }
      continue;
    }
    byKey.set(key, { record: r, warehouses: wid ? [{ code: wid, until }] : [] });
    order.push(key);
  }
  return order.map((k) => {
    const v = byKey.get(k);
    if (!v) throw new Error('dedupeMolByPerson: missing key');
    return {
      record: v.record,
      duplicateCount: v.warehouses.length || 1,
      warehouseIds: v.warehouses.map((w) => w.code),
      warehouses: v.warehouses,
    };
  });
}
