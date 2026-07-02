// ============================================================
// flow-plan-sort.ts — сортировка Плана/Отчёта по ЭТАЛОНУ экспедиции (юзер 2026-07-02).
// ============================================================
// Порт VBA `SmartSort_Custom` из «A. План экспедиции ….xlsm» (APLAN): ключи
//   1) ОТПРАВИТЕЛЬ (BuildKeyC): не-специальные склады по алфавиту ВПЕРЕДИ, затем
//      специальные строго в порядке SPECIAL_FR (8006 → 806Т → 806М → … → 9013);
//   2) КЛАСТЕР (BuildKeyF): ВЫЕЗД → КХП → пусто → прочее;
//   3) ПОЛУЧАТЕЛЬ (BuildKeyD): пустые вперёд; Т-пары перед базой (824Т < 8024, 806М < 806Т < 8006);
//   4) поставка → П/П → наименование → номенклатура → кол-во.
// Латиница-двойники (A/В/С/…) нормализуются в кириллицу как в эталоне.
// Один модуль на грид План/Отчёт И на xlsx-экспорт — сортировка везде одинаковая.

/** Порядок специальных складов-отправителей (SpecialIndexC из эталона, 1-based). */
const SPECIAL_FR = [
  '8006',
  '806Т', '806М',
  '8008',
  '8021', '821Т', '8022', '8023', '823Т', '8024', '824Т', '8025', '825Т', '8026',
  '9011', '9113', '9036', '9997',
  '9010', '9030', '9050', '9051',
  '9508', '9002', '9003', '9006', '9044', '9054', '9023', '9012', '9013',
] as const;
const SPECIAL_FR_INDEX = new Map<string, number>(SPECIAL_FR.map((v, i) => [v, i + 1]));

/** Латиница-двойники → кириллица (NormalizeRusLat эталона) + верхний регистр. */
export function normalizeRusLat(s: string): string {
  const t = String(s ?? '').trim().toUpperCase();
  const map: Record<string, string> = {
    A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М',
    O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  };
  let out = '';
  for (const ch of t) out += map[ch] ?? ch;
  return out;
}

/** Ключ ОТПРАВИТЕЛЯ (BuildKeyC): пусто/не-специальные "0|…" (алфавит), специальные "1|NNNN".
 *  `frIndex` — серверный порядок складов (xlsx-layout), по умолчанию эталонный. */
export function planSortKeyFr(raw: string, frIndex: ReadonlyMap<string, number> = SPECIAL_FR_INDEX): string {
  const v = normalizeRusLat(raw);
  if (v === '') return `0|${' '.repeat(20)}`;
  const idx = frIndex.get(v) ?? 0;
  return idx === 0 ? `0|${v}` : `1|${String(idx).padStart(4, '0')}`;
}

/** Ключ КЛАСТЕРА (BuildKeyF): ВЫЕЗД → КХП → пусто → прочее. Принимает «ПН КХП 6» — ищет вхождение. */
export function planSortKeyClst(raw: string): string {
  const v = normalizeRusLat(raw);
  if (v.includes('ВЫЕЗД')) return '0|';
  if (v.includes('КХП')) return '1|';
  if (v === '' || v === 'НЕТ') return '2|';
  return `3|${v}`;
}

/** Ключ ПОЛУЧАТЕЛЯ (BuildKeyD): пустые вперёд; Т-пары перед базовым складом. */
export function planSortKeyTo(raw: string): string {
  const v = normalizeRusLat(raw);
  if (v === '') return `0|${' '.repeat(20)}`;
  let baseK = v;
  let subK = 5;
  const pairs: Record<string, [string, number]> = {
    '806М': ['8006', 0], '806Т': ['8006', 1], '8006': ['8006', 2],
    '821Т': ['8021', 0], '8021': ['8021', 1],
    '823Т': ['8023', 0], '8023': ['8023', 1],
    '824Т': ['8024', 0], '8024': ['8024', 1],
    '825Т': ['8025', 0], '8025': ['8025', 1],
  };
  const p = pairs[v];
  if (p) { baseK = p[0]; subK = p[1]; }
  return `1|${baseK}|${subK}|${v}`;
}

/** Строка, достаточная для эталонной сортировки (грид и экспорт дают её по-своему). */
export interface PlanSortable {
  fr: string;
  clst: string; // «ВЫЕЗД»/«КХП»/'' (или текст с вхождением)
  to_wh: string;
  dlv: string;
  dlv_pos: string;
  mat: string;
  no_num: string;
  qty: number | null;
}

/** Компаратор APLAN с настраиваемым порядком отправителей (серверный xlsx-layout). */
export function makePlanEtalonCompare(specialFr?: readonly string[]): (a: PlanSortable, b: PlanSortable) => number {
  const frIndex =
    specialFr && specialFr.length > 0
      ? new Map<string, number>(specialFr.map((v, i) => [normalizeRusLat(v), i + 1]))
      : SPECIAL_FR_INDEX;
  return (a, b) =>
    planSortKeyFr(a.fr, frIndex).localeCompare(planSortKeyFr(b.fr, frIndex), 'ru') ||
    planSortKeyClst(a.clst).localeCompare(planSortKeyClst(b.clst), 'ru') ||
    planSortKeyTo(a.to_wh).localeCompare(planSortKeyTo(b.to_wh), 'ru') ||
    String(a.dlv ?? '').localeCompare(String(b.dlv ?? ''), 'ru', { numeric: true }) ||
    String(a.dlv_pos ?? '').localeCompare(String(b.dlv_pos ?? ''), 'ru', { numeric: true }) ||
    String(a.mat ?? '').localeCompare(String(b.mat ?? ''), 'ru') ||
    String(a.no_num ?? '').localeCompare(String(b.no_num ?? ''), 'ru', { numeric: true }) ||
    (Number(a.qty ?? 0) - Number(b.qty ?? 0));
}

/** Эталонный компаратор APLAN: отправитель → кластер → получатель → поставка → П/П →
 *  наименование → номенклатура → кол-во. */
export const planEtalonCompare = makePlanEtalonCompare();
