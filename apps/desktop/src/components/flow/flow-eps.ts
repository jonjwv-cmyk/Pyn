// ============================================================
// flow-eps.ts — EPS-движок Балла для Потока (клиентский порт tmc-distribution.js).
// ============================================================
// Тот же алгоритм срочности (EPS 0–100 + объяснение), что и модуль ранжирования
// сайта, перенесён в TS: данные Плана E2E-шифрованы и живут в приложении, считать
// на клиенте — без серверного round-trip. Веса/пороги 1:1 с сервером.
//
// EPS отвечает ТОЛЬКО «насколько срочно откладывать позицию» — не выбирает машину
// и не строит маршрут. Для Плана расчёт чуть отличается от сайта (позиция может быть
// ПЕРЕНЕСЕНА), но веса те же: перенос вес СОХРАНЯЕТ (юзер 2026-07-12).

import type { FlowDeliveryRow, FlowRow } from '@pyn/core';

export type UserPriority = 'high' | 'mid' | 'low';
export type EpsLevel = 'low' | 'mid' | 'high' | 'critical';

/** Веса EPS (1:1 с сервером tmc-distribution TMC_CONFIG). */
export const EPS_CONFIG = {
  W_BASE: 0.15,
  W_SLACK: 0.35,
  W_WINDOW: 0.1,
  W_WAIT: 0.1,
  W_FULFILLMENT: 0.2,
  W_CHANGE: 0.1,
  CARRYOVER_WAIT_RETENTION: 0.5, // вклад вчерашнего ожидания при переносе
  SERVICE_TIME_DEFAULT_MIN: 30,
  RECOVERY_DECAY_HOURS: 4,
};

export const EPS_LEVEL_LABEL: Record<EpsLevel, string> = {
  low: 'низкий',
  mid: 'средний',
  high: 'высокий',
  critical: 'критический',
};
// Пользовательский приоритет (юзер 2026-07-13): переименован в Срочный/Повышенный/Обычный.
// Внутренние ключи high/mid/low НЕ меняются — веса EPS и сортировка завязаны на них.
export const USER_PRIORITY_LABEL: Record<UserPriority, string> = {
  high: 'Срочный',
  mid: 'Повышенный',
  low: 'Обычный',
};
export const USER_PRIORITY_ORDER: readonly UserPriority[] = ['high', 'mid', 'low'];

/** Канонический список опций выпадашки приоритета (по убыванию срочности).
 *  ЕДИНСТВЕННЫЙ источник — гриды/фикстуры импортируют его, не хардкодят слова. */
export const PRIORITY_OPTIONS: readonly string[] = [
  USER_PRIORITY_LABEL.high,
  USER_PRIORITY_LABEL.mid,
  USER_PRIORITY_LABEL.low,
];

/** Любое сохранённое значение → каноническая метка. Старое «Высокий»/SAP-мусор/пусто
 *  показываем НОВЫМ словом, чтобы вид не был смешанным (миграции данных не требуется). */
export function priorityDisplay(raw: string | null | undefined): string {
  return USER_PRIORITY_LABEL[normPriority(raw)];
}

/** Системный уровень по баллу (для цвета бейджа). НЕ путать с пользовательским. */
export function levelFor(eps: number): EpsLevel {
  if (eps >= 75) return 'critical';
  if (eps >= 50) return 'high';
  if (eps >= 25) return 'mid';
  return 'low';
}

/** Пользовательский приоритет из строки якоря (пусто/мусор → обычный).
 *  Понимает и НОВЫЕ слова (Срочный/Повышенный/Обычный), и СТАРЫЕ (высокий/средний/низкий)
 *  для обратной совместимости со всеми ранее сохранёнными якорями/слепками. */
export function normPriority(v: string | null | undefined): UserPriority {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'high' || s.startsWith('выс') || s.startsWith('сроч')) return 'high';
  if (s === 'mid' || s.startsWith('сред') || s.startsWith('повыш')) return 'mid';
  return 'low'; // «Обычный»/«низкий»/пусто/мусор
}

const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** Кусочно-линейная интерполяция по таблице границ (по возрастанию x). */
function interp(x: number, table: ReadonlyArray<readonly [number, number]>): number {
  if (x <= table[0]![0]) return table[0]![1];
  const last = table[table.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      const t = (x - x0) / (x1 - x0 || 1);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

// ── Компоненты EPS (пороги 1:1 с сервером) ──────────────────────────────────
function basePriorityScore(priority: UserPriority): number {
  if (priority === 'high') return 100;
  if (priority === 'low') return 0;
  return 50;
}
function slackRiskScore(slackMinutes: number): number {
  return clamp100(interp(slackMinutes, [
    [0, 100], [30, 95], [60, 90], [120, 80], [240, 60], [360, 40], [480, 20], [600, 0],
  ]));
}
function windowTightnessScore(windowMinutes: number | null): number {
  if (windowMinutes == null) return 0;
  return clamp100(interp(windowMinutes, [[120, 100], [240, 70], [360, 40], [480, 20], [600, 0]]));
}
function waitScore(effectiveWaitMinutes: number): number {
  const h = effectiveWaitMinutes / 60;
  return clamp100(interp(h, [[0, 0], [2, 20], [4, 40], [6, 60], [8, 80], [10, 100]]));
}
function fulfillmentNeedScore(remainingRatio: number): number {
  const pct = remainingRatio * 100;
  return clamp100(interp(pct, [[0, 0], [10, 10], [20, 25], [40, 50], [60, 70], [80, 85], [100, 100]]));
}

export interface EpsChange {
  qtyChangePct?: number;
  afterPartial?: boolean;
  operationalFail?: boolean;
  breakdownCarry?: boolean;
  ageHours?: number;
}
function changeRecoveryScore(change: EpsChange | null | undefined): number {
  if (!change) return 0;
  let base = 0;
  const pct = Number(change.qtyChangePct || 0);
  if (change.breakdownCarry) base = 100;
  else if (change.operationalFail) base = 80;
  else if (change.afterPartial) base = 60;
  else if (pct > 0.25) base = 50;
  else if (pct >= 0.1) base = 30;
  else if (pct > 0) base = 10;
  if (base === 0) return 0;
  const age = Number(change.ageHours || 0);
  const decay = Math.max(0, 1 - age / (EPS_CONFIG.RECOVERY_DECAY_HOURS || 4));
  return clamp100(base * decay);
}

export interface EpsPos {
  priority: UserPriority;
  hasWindow: boolean;
  windowStartMin: number | null;
  windowEndMin: number | null;
  nowMin: number;
  travelMin: number;
  serviceMin: number;
  knownDelayMin: number;
  effectiveWaitMin: number;
  currentQty: number;
  deliveredQty: number;
  wholePosition?: boolean;
  change?: EpsChange | null;
}

export interface EpsResult {
  eps: number;
  level: EpsLevel;
  components: { base: number; slack: number; window: number; wait: number; fulfillment: number; change: number };
  facts: { remaining: number; remainingRatio: number; slackMin: number | null; windowMin: number | null; hasWindow: boolean };
  whyHigh: string[];
  whyLow: string[];
}

/** Рассчитать EPS позиции (1:1 с серверным computeEps) + объяснение. */
export function computeEps(pos: EpsPos): EpsResult {
  const remaining = Math.max(0, Number(pos.currentQty || 0) - Number(pos.deliveredQty || 0));
  const remainingRatio = Number(pos.currentQty || 0) > 0
    ? remaining / Number(pos.currentQty)
    : (remaining > 0 ? 1 : 0);

  let slackMin: number | null = null;
  if (pos.hasWindow && pos.windowEndMin != null) {
    slackMin = pos.windowEndMin - pos.nowMin
      - Number(pos.travelMin || 0) - Number(pos.serviceMin || 0) - Number(pos.knownDelayMin || 0);
  }
  const windowMin = pos.hasWindow && pos.windowEndMin != null && pos.windowStartMin != null
    ? pos.windowEndMin - pos.windowStartMin
    : null;

  const c = {
    base: basePriorityScore(pos.priority),
    slack: slackMin == null ? 0 : slackRiskScore(slackMin),
    window: windowTightnessScore(windowMin),
    wait: waitScore(Number(pos.effectiveWaitMin || 0)),
    fulfillment: fulfillmentNeedScore(remainingRatio),
    change: changeRecoveryScore(pos.change),
  };
  const eps = Math.round(clamp100(
    EPS_CONFIG.W_BASE * c.base + EPS_CONFIG.W_SLACK * c.slack + EPS_CONFIG.W_WINDOW * c.window +
    EPS_CONFIG.W_WAIT * c.wait + EPS_CONFIG.W_FULFILLMENT * c.fulfillment + EPS_CONFIG.W_CHANGE * c.change,
  ));

  const facts = { remaining, remainingRatio, slackMin, windowMin, hasWindow: !!pos.hasWindow };
  const { whyHigh, whyLow } = explain(facts, c, pos);
  return { eps, level: levelFor(eps), components: c, facts, whyHigh, whyLow };
}

/** Детерминированное «почему сейчас так» (1:1 с серверным explain). */
function explain(
  f: EpsResult['facts'],
  c: EpsResult['components'],
  pos: EpsPos,
): { whyHigh: string[]; whyLow: string[] } {
  const whyHigh: string[] = [];
  const whyLow: string[] = [];
  if (f.hasWindow && f.slackMin != null) {
    const mm = Math.round(f.slackMin);
    if (mm <= 60) whyHigh.push(`прогнозируемый запас времени ${mm <= 0 ? 'исчерпан' : `${mm} мин`}`);
    else if (mm >= 240) whyLow.push(`большой запас времени (${Math.round(mm / 60)} ч)`);
  } else {
    whyLow.push('окно не задано — считаем по смене');
  }
  if (f.windowMin != null) {
    const wh = f.windowMin / 60;
    if (wh <= 2) whyHigh.push(`узкое окно доставки (${wh.toFixed(wh % 1 ? 1 : 0)} ч)`);
    else if (wh >= 8) whyLow.push('окно широкое');
  }
  const remPct = Math.round(f.remainingRatio * 100);
  if (pos.wholePosition) whyHigh.push('позиция учитывается целиком');
  else if (remPct >= 60) whyHigh.push(`остаток ${remPct}% потребности`);
  else if (remPct > 0 && remPct <= 20) whyLow.push(`почти выполнено — остаток ${remPct}%`);
  const waitH = Number(pos.effectiveWaitMin || 0) / 60;
  if (waitH >= 4) {
    const txt = waitH >= 24 ? `${Math.round(waitH / 24)} дн` : `${waitH.toFixed(waitH % 1 ? 1 : 0)} ч`;
    whyHigh.push(`ожидает ${txt}`);
  }
  if (pos.priority === 'high') whyHigh.push('приоритет: высокий');
  if (pos.priority === 'low') whyLow.push('приоритет: низкий');
  if (c.change >= 30) whyHigh.push('позиция перенесена — восстановление веса');
  return { whyHigh, whyLow };
}

// ── Адаптер: строка Плана/Отчёта → позиция EPS ──────────────────────────────

/** «HH:MM–HH:MM» / «HH:MM-HH:MM» → [startMin, endMin] минут суток или null. */
export function parseDeliveryWindow(delivery: string | null | undefined): [number, number] | null {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(String(delivery || ''));
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  const e = Number(m[3]) * 60 + Number(m[4]);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return [s, e];
}

/** Минуты суток «сейчас» в Екб (UTC+5). */
export function ekbNowMinutes(now: Date = new Date()): number {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + 5 * 60) % (24 * 60);
}

export interface PlanEpsInput {
  /** Приоритет из якоря (anchor.priority). */
  priority: string | null | undefined;
  /** Окно доставки из якоря (anchor.delivery). */
  delivery: string | null | undefined;
  /** Текущее кол-во заказа. */
  currentQty: number | null | undefined;
  /** Доставлено (факт/увезли). */
  deliveredQty: number | null | undefined;
  /** Часы ожидания с активности (для wait). */
  waitHours?: number;
  /** Позиция перенесена (transfer_src>0) — вес сохраняется. */
  transferred?: boolean;
  /** Часов с момента переноса (затухание восстановления). */
  transferAgeHours?: number;
  nowMin?: number;
  wholePosition?: boolean;
}

/** Балл строки Плана/Отчёта. Мульти-точка = одна позиция (кол-во НЕ множим). */
export function planRowEps(input: PlanEpsInput): EpsResult {
  const win = parseDeliveryWindow(input.delivery);
  const waitBase = Math.max(0, Number(input.waitHours || 0)) * 60;
  // Перенос: вклад «вчерашнего» ожидания сохраняется частично (как carryover сайта).
  const effWait = input.transferred
    ? waitBase * (1 + EPS_CONFIG.CARRYOVER_WAIT_RETENTION)
    : waitBase;
  return computeEps({
    priority: normPriority(input.priority),
    hasWindow: !!win,
    windowStartMin: win ? win[0] : null,
    windowEndMin: win ? win[1] : null,
    nowMin: input.nowMin ?? ekbNowMinutes(),
    travelMin: 0,
    serviceMin: EPS_CONFIG.SERVICE_TIME_DEFAULT_MIN,
    knownDelayMin: 0,
    effectiveWaitMin: effWait,
    currentQty: Number(input.currentQty || 0),
    deliveredQty: Number(input.deliveredQty || 0),
    wholePosition: input.wholePosition === true,
    // Перенос вес сохраняет: восстановление после операц. срыва (затухает).
    change: input.transferred
      ? { operationalFail: true, ageHours: Number(input.transferAgeHours || 0) }
      : null,
  });
}

/** Удобный вызов из грида: (строка поставки, якорь) → Балл.
 *  В Потоке «% выполнено» НЕ учитываем (юзер 2026-07-12): позиция важна ЦЕЛИКОМ,
 *  частичное закрытие балл не снижает → deliveredQty=0 (остаток всегда полный).
 *  Ключевой фактор вместо % — был ли ПЕРЕНОС (transfer_src). */
export function deliveryRowEps(
  row: Pick<FlowDeliveryRow, 'qty' | 'transfer_src' | 'plan_date'>,
  anchor: Pick<FlowRow, 'priority' | 'delivery'> | null | undefined,
  opts: { nowMin?: number; waitHours?: number } = {},
): EpsResult {
  return planRowEps({
    priority: anchor?.priority,
    delivery: anchor?.delivery,
    currentQty: row.qty,
    deliveredQty: 0, // позиция важна целиком — % не снижает балл
    wholePosition: true,
    transferred: Number(row.transfer_src || 0) > 0,
    waitHours: opts.waitHours,
    nowMin: opts.nowMin,
  });
}
