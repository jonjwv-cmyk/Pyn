/**
 * Контекст для реплик питомца: погода, план, отчёт, простой ТС.
 * Кэш + редкий refresh (экономия API / токенов DeepSeek).
 */
import { api } from '@/lib/api';
import { flowDeliveriesGet, type FlowDeliveryRow } from '@pyn/core';
import { flowTransportGet } from '@pyn/core';
import {
  isNonWorkingDay,
  pickYear,
} from '@/lib/prod-calendar';
import { useProdCalendarStore } from '@/lib/prod-calendar/store';
import { yekDayKey } from '@/lib/pet-schedule';

/** Екатеринбург — дефолт погоды для питомца. */
export const PET_WEATHER_LAT = 56.8389;
export const PET_WEATHER_LNG = 60.6057;

export type WeatherFx = 'none' | 'rain' | 'snow' | 'hot' | 'cold' | 'storm';

export interface PetWeatherSnap {
  tempC: number | null;
  code: number | null;
  precipMm: number | null;
  isPrecip: boolean;
  label: string;
  fx: WeatherFx;
  at: number;
}

export type PlanDayState = 'missing' | 'draft' | 'ready' | 'partial';

export interface PetPlanSnap {
  /** Ближайший рабочий день по графику (сегодня или следующий). */
  day: string;
  weekdayRu: string;
  state: PlanDayState;
  drafts: number;
  fixed: number;
  total: number;
}

export interface PetReportSnap {
  day: string;
  /** Строки отчёта (fixation>0) без STAT. */
  missingStat: number;
  totalFixed: number;
}

export interface PetIdleVehicle {
  garage: string;
  label: string;
  idleMin: number;
}

export interface PetWorkContext {
  weather: PetWeatherSnap | null;
  plan: PetPlanSnap | null;
  report: PetReportSnap | null;
  idle: PetIdleVehicle | null;
  refreshedAt: number;
}

const CTX_TTL_MS = 12 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const MOVING_SPEED = 3;
const STOPPED_SPEED = 0.6;

let cache: PetWorkContext = {
  weather: null,
  plan: null,
  report: null,
  idle: null,
  refreshedAt: 0,
};

/** garage → last time speed > MOVING_SPEED (ms). */
const lastMovingAt = new Map<string, number>();
/** garage → display name */
const garageLabel = new Map<string, string>();
let glonassIdByGarage = new Map<string, number>();

const WEEKDAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;

export function getPetWorkContext(): PetWorkContext {
  return cache;
}

export function weatherFxFromSnap(w: PetWeatherSnap | null): WeatherFx {
  return w?.fx ?? 'none';
}

function weatherLabel(code: number | null, precipMm: number | null): string {
  if ((precipMm ?? 0) > 0.2) {
    if (code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return 'снег';
    return 'дождь';
  }
  if (code == null) return 'без данных';
  if (code === 0) return 'ясно';
  if (code === 1 || code === 2 || code === 3) return 'облачно';
  if (code === 45 || code === 48) return 'туман';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'дождь';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'снег';
  if (code >= 95) return 'гроза';
  return 'обычная';
}

function weatherFx(tempC: number | null, code: number | null, precipMm: number | null): WeatherFx {
  if (code != null && code >= 95) return 'storm';
  if (
    (precipMm ?? 0) > 0.2 ||
    (code != null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)))
  ) {
    return 'rain';
  }
  if (code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return 'snow';
  if (tempC != null && tempC >= 28) return 'hot';
  if (tempC != null && tempC <= -8) return 'cold';
  if (tempC != null && tempC <= 0 && (precipMm ?? 0) <= 0) return 'cold';
  return 'none';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekdayRuForYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  // noon UTC → stable weekday for Yek (UTC+5) civil date
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 7, 0, 0));
  return WEEKDAY_RU[dt.getUTCDay()] ?? '';
}

function isWorkdayYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const cal = pickYear(useProdCalendarStore.getState().byYear, y!);
  if (!cal) {
    // fallback: mon–fri
    const dt = new Date(Date.UTC(y!, m! - 1, d!, 7, 0, 0));
    const wd = dt.getUTCDay();
    return wd !== 0 && wd !== 6;
  }
  return !isNonWorkingDay(cal, y!, m!, d!);
}

/** Ближайшие рабочие дни от today (включая today если рабочий), до `count`. */
export function nearestWorkdays(count = 3, now = Date.now()): string[] {
  const today = yekDayKey(now);
  const out: string[] = [];
  for (let i = 0; i < 21 && out.length < count; i++) {
    const d = addDaysYmd(today, i);
    if (isWorkdayYmd(d)) out.push(d);
  }
  return out;
}

function classifyPlan(rows: FlowDeliveryRow[]): Omit<PetPlanSnap, 'day' | 'weekdayRu'> {
  const active = rows.filter((r) => !(Number(r.reserved) > 0));
  const drafts = active.filter((r) => !(Number(r.fixation_id) > 0)).length;
  const fixed = active.filter((r) => Number(r.fixation_id) > 0).length;
  const total = active.length;
  let state: PlanDayState = 'missing';
  if (total === 0) state = 'missing';
  else if (drafts > 0 && fixed === 0) state = 'draft';
  else if (drafts > 0 && fixed > 0) state = 'partial';
  else state = 'ready';
  return { state, drafts, fixed, total };
}

function rowHasStat(r: FlowDeliveryRow): boolean {
  const stat = String(r.stat || '').trim();
  if (stat) return true;
  const ds = String(r.done_stat || '').trim();
  return ds === 'выполнено' || ds === 'увезли' || ds === 'не увезли';
}

async function refreshWeather(): Promise<PetWeatherSnap | null> {
  try {
    const res = await window.pyn?.mapWeather?.(PET_WEATHER_LAT, PET_WEATHER_LNG);
    const w = res?.weather;
    if (!w) return cache.weather;
    const tempC = w.tempC;
    const code = w.code;
    const precipMm = w.precipMm;
    return {
      tempC,
      code,
      precipMm,
      isPrecip: !!w.isPrecip || (precipMm ?? 0) > 0.1,
      label: weatherLabel(code, precipMm),
      fx: weatherFx(tempC, code, precipMm),
      at: Date.now(),
    };
  } catch {
    return cache.weather;
  }
}

async function refreshPlan(): Promise<PetPlanSnap | null> {
  const days = nearestWorkdays(2);
  if (days.length === 0) return null;
  // Первый «проблемный» день важнее «всё ок» на дальнем.
  let bestOk: PetPlanSnap | null = null;
  for (const day of days) {
    try {
      const rows = await flowDeliveriesGet(api, { planDate: day });
      const c = classifyPlan(rows);
      const snap: PetPlanSnap = {
        day,
        weekdayRu: weekdayRuForYmd(day),
        ...c,
      };
      if (c.state !== 'ready') return snap;
      if (!bestOk) bestOk = snap;
    } catch {
      /* skip day */
    }
  }
  return bestOk;
}

async function refreshReport(): Promise<PetReportSnap | null> {
  // Вчера и сегодня по Екб: отчёт без статуса.
  const today = yekDayKey();
  const candidates = [addDaysYmd(today, -1), today];
  let best: PetReportSnap | null = null;
  for (const day of candidates) {
    try {
      const rows = await flowDeliveriesGet(api, { planDate: day });
      const fixed = rows.filter((r) => Number(r.fixation_id) > 0 && !(Number(r.reserved) > 0));
      if (fixed.length === 0) continue;
      const missing = fixed.filter((r) => !rowHasStat(r)).length;
      if (missing <= 0) continue;
      const snap: PetReportSnap = {
        day,
        missingStat: missing,
        totalFixed: fixed.length,
      };
      // Предпочитаем день с дырами; если оба — больший missing, иначе более ранний.
      if (!best || snap.missingStat > best.missingStat) best = snap;
    } catch {
      /* */
    }
  }
  return best;
}

async function ensureGlonassMap(garages: string[]): Promise<void> {
  if (glonassIdByGarage.size > 0 || garages.length === 0) return;
  try {
    const res = await window.pyn?.glonass?.vehicles?.();
    if (!res?.ok || !Array.isArray(res.vehicles)) return;
    const want = new Set(garages.map((g) => g.trim()));
    for (const v of res.vehicles) {
      const g = String(v.garage || '').trim();
      if (!g || !want.has(g)) continue;
      glonassIdByGarage.set(g, v.id);
      const name = String(v.name || '').trim();
      const gos = String(v.gos || '').trim();
      garageLabel.set(g, [g, gos || name].filter(Boolean).join(' · '));
    }
  } catch {
    /* bridge offline */
  }
}

async function refreshIdle(): Promise<PetIdleVehicle | null> {
  const day = yekDayKey();
  let transportGarages: string[] = [];
  try {
    const rows = await flowTransportGet(api, day, { timeoutMs: 20_000 });
    transportGarages = [
      ...new Set(
        rows
          .map((r) => String(r.garage_no || '').trim())
          .filter((g) => g && g !== '0' && !g.startsWith('7.')),
      ),
    ];
  } catch {
    return cache.idle;
  }
  if (transportGarages.length === 0) return null;

  await ensureGlonassMap(transportGarages);
  const ids: number[] = [];
  const idToGarage = new Map<number, string>();
  for (const g of transportGarages) {
    const id = glonassIdByGarage.get(g);
    if (id != null) {
      ids.push(id);
      idToGarage.set(id, g);
    }
  }
  if (ids.length === 0) return null;

  try {
    const res = await window.pyn?.glonass?.positions?.(ids.slice(0, 40));
    if (!res?.ok || !Array.isArray(res.positions)) return cache.idle;
    const now = Date.now();
    let worst: PetIdleVehicle | null = null;
    for (const p of res.positions) {
      const g = idToGarage.get(p.id);
      if (!g) continue;
      const speed = p.speed == null ? null : Number(p.speed);
      if (speed != null && speed > MOVING_SPEED) {
        lastMovingAt.set(g, now);
        continue;
      }
      if (speed != null && speed > STOPPED_SPEED) continue;
      // stopped / unknown speed
      if (!lastMovingAt.has(g)) {
        // first sighting as stopped — start clock now (не орать сразу)
        lastMovingAt.set(g, now);
        continue;
      }
      const idleMs = now - (lastMovingAt.get(g) ?? now);
      if (idleMs < IDLE_MS) continue;
      const idleMin = Math.floor(idleMs / 60_000);
      const cand: PetIdleVehicle = {
        garage: g,
        label: garageLabel.get(g) || g,
        idleMin,
      };
      if (!worst || cand.idleMin > worst.idleMin) worst = cand;
    }
    return worst;
  } catch {
    return cache.idle;
  }
}

/** Обновить кэш (не чаще TTL, force=true — сразу). */
export async function refreshPetWorkContext(force = false): Promise<PetWorkContext> {
  const now = Date.now();
  if (!force && now - cache.refreshedAt < CTX_TTL_MS && cache.refreshedAt > 0) {
    return cache;
  }
  const [weather, plan, report, idle] = await Promise.all([
    refreshWeather(),
    refreshPlan(),
    refreshReport(),
    refreshIdle(),
  ]);
  cache = {
    weather: weather ?? cache.weather,
    plan: plan ?? null,
    report: report ?? null,
    idle: idle ?? null,
    refreshedAt: Date.now(),
  };
  return cache;
}

/** Короткие факты для DeepSeek (мин. токенов). */
export function contextFactsForAi(ctx: PetWorkContext): string {
  const bits: string[] = [];
  if (ctx.weather) {
    const t = ctx.weather.tempC != null ? `${Math.round(ctx.weather.tempC)}°` : '';
    bits.push(`погода:${ctx.weather.label}${t ? ' ' + t : ''}`);
  }
  if (ctx.plan && ctx.plan.state !== 'ready') {
    bits.push(
      `план ${ctx.plan.day}(${ctx.plan.weekdayRu}):` +
        (ctx.plan.state === 'missing'
          ? 'нет'
          : ctx.plan.state === 'draft'
            ? `черновик ${ctx.plan.drafts}`
            : `частично draft=${ctx.plan.drafts}`),
    );
  }
  if (ctx.report && ctx.report.missingStat > 0) {
    bits.push(`отчёт ${ctx.report.day}: без статуса ${ctx.report.missingStat}`);
  }
  if (ctx.idle) {
    bits.push(`простой ${ctx.idle.label} ${ctx.idle.idleMin}м`);
  }
  return bits.join('; ').slice(0, 180);
}

/** Локальные шаблоны (0 токенов) — без рода. */
export function localPhraseFromContext(
  kind: 'weather' | 'plan' | 'report' | 'transport_idle',
  ctx: PetWorkContext,
): string | null {
  if (kind === 'weather' && ctx.weather) {
    const t = ctx.weather.tempC != null ? `${Math.round(ctx.weather.tempC)}°` : '';
    const pool =
      ctx.weather.fx === 'rain'
        ? [
            `На улице дождь${t ? ', ' + t : ''}. Я с зонтиком ☔`,
            `Мокро за окном. Не забудь куртку!`,
            `Дождик. Укрылся листочком 🍃`,
          ]
        : ctx.weather.fx === 'snow'
          ? [`Снежок${t ? ' ' + t : ''}. Красиво и скользко ❄️`, `Снег идёт. Я в шарфе!`]
          : ctx.weather.fx === 'hot'
            ? [`Жара${t ? ' ' + t : ''}! Потёк… 💧 пей воду`, `Душно. Проветривайся 🔥`]
            : ctx.weather.fx === 'cold'
              ? [`Холодно${t ? ' ' + t : ''}. Укутался 🧣`, `Мороз. Согревайся чаем ☕`]
              : ctx.weather.fx === 'storm'
                ? [`Гроза! Лучше в помещении ⚡`, `Гремит. Я рядом, не боюсь`]
                : [
                    `Погода: ${ctx.weather.label}${t ? ', ' + t : ''}. Хорошего дня!`,
                    `За окном ${ctx.weather.label}. Я с тобой 👀`,
                  ];
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  if (kind === 'plan' && ctx.plan) {
    const d = ctx.plan.day;
    const wd = ctx.plan.weekdayRu;
    if (ctx.plan.state === 'missing') {
      return `План на ${wd} ${d} ещё не сформирован. Напомню 📋`;
    }
    if (ctx.plan.state === 'draft') {
      return `План на ${wd} ${d} — черновик (${ctx.plan.drafts} стр.). Не зафиксирован!`;
    }
    if (ctx.plan.state === 'partial') {
      return `План ${d}: ${ctx.plan.fixed} готово, ${ctx.plan.drafts} ещё черновик.`;
    }
    return `План на ${wd} ${d} готов. Красота ✨`;
  }

  if (kind === 'report' && ctx.report && ctx.report.missingStat > 0) {
    const { day, missingStat, totalFixed } = ctx.report;
    const parts = day.split('-');
    const human =
      parts.length === 3 ? `${Number(parts[2])}.${parts[1]}.${parts[0]}` : day;
    return `В отчёте за ${human} без статуса: ${missingStat} из ${totalFixed}. Заполни ✍️`;
  }

  if (kind === 'transport_idle' && ctx.idle) {
    return `Машина ${ctx.idle.label} простаивает уже ~${ctx.idle.idleMin} мин 🚛`;
  }

  return null;
}

/** Для badge / debug. */
export function formatDayHuman(ymd: string): string {
  const p = ymd.split('-');
  if (p.length !== 3) return ymd;
  return `${Number(p[2])}.${p[1]}`;
}
