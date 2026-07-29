/**
 * Поток: иерархия STAT + подстатус + STAT NOTE (свободный комментарий).
 * Модель (юзер 2026-07-26):
 *  • STAT / stat_sub — справочник (B1);
 *  • STAT NOTE — ручной текст-пояснение, не справочник;
 *  • Формирование: авто-ярлык строкой 1; ручные из плана/отчёта — ниже, жирные (A1 stack);
 *  • «выполнено» — только План/Отчёт.
 */

export type FlowStatTop =
  | 'выполнено'
  | 'запрет снабжения'
  | 'вопрос'
  | 'неликвиды'
  | 'АТУ'
  | 'склад'
  | 'цех'
  | 'экспедиция';

/** Одна ручная запись статуса (стек на якоре / снимок на поставке). */
export interface FlowStatEntry {
  stat: string;
  sub: string;
  note: string;
  /** report | plan | manual | transfer */
  src?: string;
  /** ISO timestamp optional */
  at?: string;
}

/** Узел справочника: верхний STAT → подстатусы (пустой = лист). */
export interface FlowStatNode {
  id: FlowStatTop | string;
  subs: readonly string[];
  /** Только План/Отчёт (не показывать в выпадашке Формирования). */
  planReportOnly?: boolean;
}

/**
 * Каноническое дерево из поток.docx + правки:
 * заявка/самовывоз/отказ → подстатусы цеха; неликвиды и вопрос — отдельные верхние;
 * выполнено — только план/отчёт.
 */
export const FLOW_STAT_TREE: readonly FlowStatNode[] = [
  { id: 'выполнено', subs: [], planReportOnly: true },
  { id: 'запрет снабжения', subs: [] },
  { id: 'вопрос', subs: [] },
  { id: 'неликвиды', subs: [] },
  {
    id: 'АТУ',
    subs: ['ТС неисправно', 'ТС снято', 'ТС отказано', 'нет водителя', 'отказ водителя'],
  },
  {
    id: 'склад',
    subs: [
      'нет',
      'мало',
      'нет отборки',
      'не нашли',
      'ТМЦ не опознан',
      'брак',
      'не отделен от тары',
      'персонал занят',
      'нет персонала',
      'кран сломан',
      'нет погрузчика',
      'погрузчик сломан',
      'не комплект',
    ],
  },
  {
    id: 'цех',
    subs: [
      'возврат на склад',
      'приемка',
      'нет МОЛа',
      'перенос',
      'отказ',
      'заявка',
      'самовывоз',
      'персонал занят',
      'нет персонала',
      'кран сломан',
      'нет погрузчика',
      'погрузчик сломан',
    ],
  },
  {
    id: 'экспедиция',
    subs: ['отказ', 'забыл', 'не успел', 'не влезло', 'не по пути', 'перенос', 'ошибочно'],
  },
] as const;

/**
 * «Ошибочно» (экспедиция · ошибочно, юзер 2026-07-28): позиция помечена как ошибка —
 * ведёт себя, будто её НЕ БЫЛО в плане/отчёте: серая, НЕ идёт в «белый отчёт», НЕ считается
 * в количестве позиций, НЕ участвует в переносах. Единая проверка для всех потребителей.
 */
export const FLOW_STAT_ERRONEOUS_SUB = 'ошибочно';
export function isFlowStatErroneous(stat: string, sub: string): boolean {
  return String(stat || '').trim() === 'экспедиция' && String(sub || '').trim() === FLOW_STAT_ERRONEOUS_SUB;
}

/** Авто-ярлыки Формирования (не из справочника отчёта; первая строка, не жирные). */
export const FLOW_STAT_AUTO = ['мало', 'заявка', 'мет_ок', 'масловоз', 'прекурсор'] as const;

export function flowStatNode(id: string): FlowStatNode | undefined {
  return FLOW_STAT_TREE.find((n) => n.id === id);
}

export function flowStatSubs(stat: string): readonly string[] {
  return flowStatNode(stat)?.subs ?? [];
}

/** Подстатус обязателен, если у узла есть children. */
export function flowStatNeedsSub(stat: string): boolean {
  return flowStatSubs(stat).length > 0;
}

export function formatFlowStat(stat: string, sub = ''): string {
  const s = String(stat || '').trim();
  const u = String(sub || '').trim();
  if (!s) return '';
  if (!u) return s;
  return `${s} · ${u}`;
}

export function parseFlowStatLabel(label: string): { stat: string; sub: string } {
  const t = String(label || '').trim();
  if (!t) return { stat: '', sub: '' };
  const i = t.indexOf(' · ');
  if (i < 0) {
    // legacy "цех|отказ" / "цех/отказ"
    const m = t.split(/[|/]/).map((x) => x.trim()).filter(Boolean);
    if (m.length >= 2) return { stat: m[0]!, sub: m.slice(1).join(' ') };
    return { stat: t, sub: '' };
  }
  return { stat: t.slice(0, i).trim(), sub: t.slice(i + 3).trim() };
}

/** Опции выпадашки STAT: «верх» или «верх · под» плоским списком (legacy/фильтр). */
export function flowStatFlatOptions(opts?: { includePlanReportOnly?: boolean }): string[] {
  const includePR = opts?.includePlanReportOnly !== false;
  const out: string[] = [];
  for (const n of FLOW_STAT_TREE) {
    if (n.planReportOnly && !includePR) continue;
    if (n.subs.length === 0) {
      out.push(n.id);
      continue;
    }
    for (const sub of n.subs) out.push(formatFlowStat(n.id, sub));
  }
  return out;
}

/**
 * Группы для раскрывающегося выбора (АТУ / склад / цех / экспедиция — пункт на
 * раскрытие; листья без children коммитятся сразу).
 */
export interface FlowStatDropdownGroup {
  /** Значение коммита для листа; для ветки — только id узла (не коммитится кликом). */
  id: string;
  label: string;
  /** Подпункты: value = «верх · под» (formatFlowStat). */
  children?: readonly { value: string; label: string }[];
}

export function flowStatDropdownGroups(opts?: {
  includePlanReportOnly?: boolean;
}): FlowStatDropdownGroup[] {
  const includePR = opts?.includePlanReportOnly !== false;
  const out: FlowStatDropdownGroup[] = [];
  for (const n of FLOW_STAT_TREE) {
    if (n.planReportOnly && !includePR) continue;
    if (n.subs.length === 0) {
      out.push({ id: n.id, label: n.id });
      continue;
    }
    out.push({
      id: n.id,
      label: n.id,
      children: n.subs.map((sub) => ({
        value: formatFlowStat(n.id, sub),
        label: sub,
      })),
    });
  }
  return out;
}

/**
 * Жёлтые маркеры из поток.docx (shd=ffff00 + верхние «общие»):
 * в White остаются «честными»; всё остальное → «выполнено» (липовый %).
 * Самовывоз: и legacy top-level, и цех·самовывоз.
 */
const WHITE_TOP = new Set(['выполнено', 'самовывоз', 'запрет снабжения']);
const WHITE_YELLOW_SUBS: Readonly<Record<string, ReadonlySet<string>>> = {
  АТУ: new Set(['ТС неисправно', 'ТС снято', 'ТС отказано', 'нет водителя', 'отказ водителя']),
  склад: new Set([
    'нет',
    'мало',
    'брак',
    'кран сломан',
    'нет погрузчика',
    'погрузчик сломан',
    'не комплект',
  ]),
  цех: new Set([
    'возврат на склад',
    'приемка',
    'нет МОЛа',
    'перенос',
    'отказ',
    'самовывоз',
    'персонал занят',
    'нет персонала',
    'кран сломан',
    'нет погрузчика',
    'погрузчик сломан',
  ]),
};

/** Жёлтый маркер White (docx): честный статус, не подменяется на «выполнено». */
export function isFlowStatYellow(stat: string, sub = ''): boolean {
  const s = String(stat || '').trim();
  const u = String(sub || '').trim();
  if (!s) return false;
  if (WHITE_TOP.has(s)) return true;
  const set = WHITE_YELLOW_SUBS[s];
  return !!(set && u && set.has(u));
}

/** Вывезено: выполнено / самовывоз (в т.ч. цех·самовывоз). */
export function isFlowStatShipped(stat: string, sub = ''): boolean {
  const s = String(stat || '').trim();
  const u = String(sub || '').trim();
  if (s === 'выполнено') return true;
  if (s === 'самовывоз') return true;
  if (s === 'цех' && u === 'самовывоз') return true;
  return false;
}

/**
 * White-проекция: жёлтые и пустой статус — как есть;
 * прочие (не жёлтые) → «выполнено» (считаются увезёнными).
 */
export function whiteEffectiveStat(stat: string, sub = ''): { stat: string; sub: string } {
  const s = String(stat || '').trim();
  const u = String(sub || '').trim();
  if (!s) return { stat: '', sub: '' };
  if (isFlowStatYellow(s, u)) return { stat: s, sub: u };
  return { stat: 'выполнено', sub: '' };
}

/** done_stat / fail_reason для совместимости occupies + старого UI. */
export function deriveDoneFromStat(
  stat: string,
  sub = '',
  transferDate = '',
): { done_stat: string; fail_reason: string } {
  const s = String(stat || '').trim();
  const u = String(sub || '').trim();
  if (!s) return { done_stat: '', fail_reason: '' };
  if (s === 'выполнено') return { done_stat: 'выполнено', fail_reason: '' };
  if (u === 'перенос' || s === 'перенос') {
    const d = String(transferDate || '').slice(0, 10);
    return {
      done_stat: 'не увезли',
      fail_reason: d ? `перенос на другой день: ${d}` : 'перенос на другой день',
    };
  }
  // Канон для моста/журнала: stat|sub
  return { done_stat: 'не увезли', fail_reason: u ? `${s}|${u}` : s };
}

/** Разбор legacy fail_reason / done_stat → stat+sub. */
export function legacyFailToStat(
  doneStat: string,
  failReason: string,
): { stat: string; sub: string; transferDate: string } {
  const ds = String(doneStat || '').trim();
  const fr = String(failReason || '').trim();
  if (ds === 'выполнено' || ds === 'увезли') return { stat: 'выполнено', sub: '', transferDate: '' };
  const tm = /^перенос на другой день:\s*(\d{4}-\d{2}-\d{2})/.exec(fr);
  if (tm) {
    // без знания цех/экспедиция — оставляем sub=перенос, stat пуст до выбора
    return { stat: '', sub: 'перенос', transferDate: tm[1]! };
  }
  if (!fr && (ds === 'не увезли' || !ds)) return { stat: '', sub: '', transferDate: '' };

  // stat|sub
  if (fr.includes('|')) {
    const [a, ...rest] = fr.split('|');
    return { stat: (a || '').trim(), sub: rest.join('|').trim(), transferDate: '' };
  }

  // короткие/старые причины → дерево
  const map: Record<string, { stat: string; sub: string }> = {
    'отказ цеха': { stat: 'цех', sub: 'отказ' },
    отказ: { stat: 'цех', sub: 'отказ' },
    самовывоз: { stat: 'цех', sub: 'самовывоз' },
    заявка: { stat: 'цех', sub: 'заявка' },
    неликвиды: { stat: 'неликвиды', sub: '' },
    вопрос: { stat: 'вопрос', sub: '' },
    'запрет снабжения': { stat: 'запрет снабжения', sub: '' },
    'нет на центральном складе': { stat: 'склад', sub: 'нет' },
    нет: { stat: 'склад', sub: 'нет' },
    'менее транспортной нормы': { stat: 'склад', sub: 'мало' },
    мало: { stat: 'склад', sub: 'мало' },
    'на приёмке': { stat: 'цех', sub: 'приемка' },
    приемка: { stat: 'цех', sub: 'приемка' },
    'на входном контроле': { stat: 'склад', sub: 'нет отборки' },
    'вх. контроль': { stat: 'склад', sub: 'нет отборки' },
    брак: { stat: 'склад', sub: 'брак' },
    'нет МОЛа': { stat: 'цех', sub: 'нет МОЛа' },
    'нет водителя': { stat: 'АТУ', sub: 'нет водителя' },
    'отказ водителя': { stat: 'АТУ', sub: 'отказ водителя' },
    'нет погрузчика': { stat: 'склад', sub: 'нет погрузчика' },
    'нет крана': { stat: 'склад', sub: 'кран сломан' },
    'нет людей': { stat: 'склад', sub: 'нет персонала' },
    'нет машины': { stat: 'АТУ', sub: 'ТС неисправно' },
    перенос: { stat: '', sub: 'перенос' },
  };
  const hit = map[fr] || map[fr.toLowerCase()];
  if (hit) return { ...hit, transferDate: '' };
  // свободный текст — кладём в stat как «склад»? лучше пустой stat + unknown in note later
  return { stat: fr, sub: '', transferDate: '' };
}

export function parseStatStack(raw: unknown): FlowStatEntry[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(normalizeEntry).filter((e) => e.stat || e.sub || e.note);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.map(normalizeEntry).filter((e) => e.stat || e.sub || e.note);
    } catch {
      /* plain text legacy — ignore */
    }
  }
  return [];
}

export function serializeStatStack(entries: FlowStatEntry[]): string {
  return JSON.stringify(entries.map(normalizeEntry));
}

function normalizeEntry(x: unknown): FlowStatEntry {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return {
    stat: String(o.stat ?? '').trim(),
    sub: String(o.sub ?? o.stat_sub ?? '').trim(),
    note: String(o.note ?? o.stat_note ?? '').trim(),
    src: o.src != null ? String(o.src) : undefined,
    at: o.at != null ? String(o.at) : undefined,
  };
}

/** Добавить ручную запись в стек (дедуп точного stat+sub+note). */
export function pushStatStack(
  stack: FlowStatEntry[],
  entry: FlowStatEntry,
  max = 8,
): FlowStatEntry[] {
  const e = normalizeEntry(entry);
  if (!e.stat && !e.sub && !e.note) return stack;
  const key = `${e.stat}\0${e.sub}\0${e.note}`;
  const next = stack.filter((x) => `${x.stat}\0${x.sub}\0${x.note}` !== key);
  next.push({ ...e, at: e.at || new Date().toISOString() });
  return next.slice(-max);
}

/** Многострочный показ: авто (обычный) + стек (жирный на клиенте). */
export function formatStatCellLines(
  autoStat: string,
  stack: FlowStatEntry[],
): { auto: string; manuals: string[] } {
  const auto = String(autoStat || '').trim();
  const manuals = stack
    .map((e) => {
      const head = formatFlowStat(e.stat, e.sub);
      if (head && e.note) return `${head}: ${e.note}`;
      if (head) return head;
      return e.note;
    })
    .filter(Boolean);
  return { auto, manuals };
}
