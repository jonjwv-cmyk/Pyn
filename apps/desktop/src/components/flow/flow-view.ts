// ============================================================
// flow-view.ts — «вид» раздела «Поток» (filter-views, как в Google-таблицах).
// ============================================================
// Вид — UI-слой НАД данными: фильтры колонок / умные фильтры MAT и заказов /
// сортировка / масштаб. Строки таблицы он НЕ меняет (у всех они одни, реалтайм).
//
// Два источника состояния вида (движок фильтрации/сортировки — один и тот же):
//   • ЛИЧНЫЙ  — приватный, в localStorage (per-user), виден только себе.
//   • ОБЩИЙ   — синхронный, на сервере (flow_view_get/set + WS flow_view_changed),
//               виден всем, с аватаром того, кто последний менял.
//
// Здесь — сериализация живого состояния грида ↔ компактный JSON (Set ↔ Array),
// канонизация для сравнения «изменилось ли» и хранилище личного вида/режима.

import type { FlowMatSubId } from './flow-sandbox.fixtures';

/** Режим вида: общий (сервер, всем) или личный (localStorage, себе). */
export type FlowViewMode = 'shared' | 'personal';

/** Один уровень сортировки (в порядке выбора): колонка + направление. */
export interface FlowViewSort {
  colId: string;
  dir: 'asc' | 'desc';
}

/** Сериализуемый фильтр (Set исключённых → массив). */
interface SerializedFilter {
  search: string;
  excluded: string[];
}

/**
 * Сериализуемое состояние «вида». Ровно те поля, что живут в `FlowSandboxGrid`
 * как useState: filters / matFilter / ordFilter / sortLevels / zoom. Set'ы хранятся
 * массивами — это и есть «конвертация Set↔Array», о которой ТЗ.
 */
export interface FlowViewState {
  /** Фильтры показа колонок: colId → {поиск, снятые галочкой значения}. */
  filters: Record<string, SerializedFilter>;
  /** Умный фильтр MAT: под-поле (название/создал/даты/тех-имя) → {поиск, исключённые}. */
  matFilter: Record<string, SerializedFilter>;
  /** Умный фильтр заказов: целые заказы + отдельные позиции (ключ `ord|it`). */
  ordFilter: { orders: string[]; positions: string[] };
  /** Уровни сортировки в порядке выбора (пусто — порядок по умолчанию WF_SORT). */
  sortLevels: FlowViewSort[];
  /** Масштаб листа (0.5–2.0). */
  zoom: number;
}

/** Живое состояние вида в гриде (Set'ы — как в useState). Вход сериализатора / выход разбора. */
export interface FlowViewLive {
  filters: Record<string, { search: string; excluded: ReadonlySet<string> }>;
  matFilter: Partial<Record<FlowMatSubId, { search: string; excluded: ReadonlySet<string> }>>;
  ordFilter: { orders: ReadonlySet<string>; positions: ReadonlySet<string> };
  sortLevels: FlowViewSort[];
  zoom: number;
}

/** Разобранное живое состояние (Set'ы мутабельные — готово в setState грида). */
export interface FlowViewLiveOut {
  filters: Record<string, { search: string; excluded: Set<string> }>;
  matFilter: Partial<Record<FlowMatSubId, { search: string; excluded: Set<string> }>>;
  ordFilter: { orders: Set<string>; positions: Set<string> };
  sortLevels: FlowViewSort[];
  zoom: number;
}

/** Пустой («по умолчанию») вид: без фильтров/сортировки, масштаб 100%. */
export const EMPTY_FLOW_VIEW: FlowViewState = {
  filters: {},
  matFilter: {},
  ordFilter: { orders: [], positions: [] },
  sortLevels: [],
  zoom: 1,
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

/** Активен ли фильтр (есть поиск или снятые галочкой значения). Пустые — не храним. */
function filterActive(f: { search: string; excluded: ReadonlySet<string> }): boolean {
  return f.search.trim() !== '' || f.excluded.size > 0;
}

/** Живое состояние грида → сериализуемый вид (Set → Array; пустые фильтры опускаем). */
export function serializeFlowView(live: FlowViewLive): FlowViewState {
  const filters: Record<string, SerializedFilter> = {};
  for (const [colId, f] of Object.entries(live.filters)) {
    if (f && filterActive(f)) filters[colId] = { search: f.search, excluded: [...f.excluded] };
  }
  const matFilter: Record<string, SerializedFilter> = {};
  for (const [sub, f] of Object.entries(live.matFilter)) {
    if (f && filterActive(f)) matFilter[sub] = { search: f.search, excluded: [...f.excluded] };
  }
  return {
    filters,
    matFilter,
    ordFilter: { orders: [...live.ordFilter.orders], positions: [...live.ordFilter.positions] },
    sortLevels: live.sortLevels.map((l) => ({ colId: l.colId, dir: l.dir })),
    zoom: live.zoom,
  };
}

/** Сериализуемый вид → живое состояние (Array → Set; защита от мусора во входе). */
export function deserializeFlowView(view: FlowViewState | null | undefined): FlowViewLiveOut {
  const v = view ?? EMPTY_FLOW_VIEW;
  const filters: FlowViewLiveOut['filters'] = {};
  for (const [colId, f] of Object.entries(v.filters ?? {})) {
    filters[colId] = { search: String(f?.search ?? ''), excluded: new Set((f?.excluded ?? []).map(String)) };
  }
  const matFilter: FlowViewLiveOut['matFilter'] = {};
  for (const [sub, f] of Object.entries(v.matFilter ?? {})) {
    matFilter[sub as FlowMatSubId] = {
      search: String(f?.search ?? ''),
      excluded: new Set((f?.excluded ?? []).map(String)),
    };
  }
  const zoomRaw = Number(v.zoom);
  const zoom = Number.isFinite(zoomRaw) && zoomRaw >= ZOOM_MIN && zoomRaw <= ZOOM_MAX ? zoomRaw : 1;
  const sortLevels = Array.isArray(v.sortLevels)
    ? v.sortLevels
        .filter((l): l is FlowViewSort => !!l && typeof l.colId === 'string' && (l.dir === 'asc' || l.dir === 'desc'))
        .map((l) => ({ colId: l.colId, dir: l.dir }))
    : [];
  return {
    filters,
    matFilter,
    ordFilter: {
      orders: new Set((v.ordFilter?.orders ?? []).map(String)),
      positions: new Set((v.ordFilter?.positions ?? []).map(String)),
    },
    sortLevels,
    zoom,
  };
}

/**
 * Канонический JSON вида — стабильный (ключи/массивы отсортированы), чтобы сравнивать
 * «изменилось ли» без ложных срабатываний от порядка. Порядок sortLevels ЗНАЧИМ
 * (приоритет ключей) — его не сортируем.
 */
export function canonicalFlowViewJson(view: FlowViewState): string {
  const sortRec = (rec: Record<string, SerializedFilter>) => {
    const out: Record<string, SerializedFilter> = {};
    for (const k of Object.keys(rec).sort()) {
      const f = rec[k];
      if (f) out[k] = { search: f.search, excluded: [...f.excluded].sort() };
    }
    return out;
  };
  return JSON.stringify({
    filters: sortRec(view.filters),
    matFilter: sortRec(view.matFilter),
    ordFilter: {
      orders: [...view.ordFilter.orders].sort(),
      positions: [...view.ordFilter.positions].sort(),
    },
    sortLevels: view.sortLevels,
    zoom: view.zoom,
  });
}

/** Канонический JSON пустого вида — «вид по умолчанию» (с ним сравниваем «сброшен ли»). */
export const EMPTY_FLOW_VIEW_JSON = canonicalFlowViewJson(EMPTY_FLOW_VIEW);

/** Пустой ли вид (по умолчанию) — по каноническому JSON. */
export function isEmptyFlowViewJson(json: string): boolean {
  return json === EMPTY_FLOW_VIEW_JSON;
}

/** Безопасный разбор JSON-строки вида (с сервера / localStorage). Мусор → пустой вид. */
export function parseFlowView(value: string | null | undefined): FlowViewState {
  if (!value || !value.trim()) return EMPTY_FLOW_VIEW;
  try {
    const o = JSON.parse(value);
    return o && typeof o === 'object' ? (o as FlowViewState) : EMPTY_FLOW_VIEW;
  } catch {
    return EMPTY_FLOW_VIEW;
  }
}

// ── Хранилище личного вида + режима (localStorage, per-user) ────────────────

const PERSONAL_PREFIX = 'flow_view_personal:';
const MODE_PREFIX = 'flow_view_mode:';

/** Прочитать личный вид пользователя (null — не сохранён). */
export function readPersonalView(login: string): FlowViewState | null {
  if (!login) return null;
  try {
    const raw = localStorage.getItem(PERSONAL_PREFIX + login);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? (o as FlowViewState) : null;
  } catch {
    return null;
  }
}

/** Записать личный вид пользователя. */
export function writePersonalView(login: string, view: FlowViewState): void {
  if (!login) return;
  try {
    localStorage.setItem(PERSONAL_PREFIX + login, JSON.stringify(view));
  } catch {
    /* localStorage недоступен/переполнен — личный вид просто не сохранится. */
  }
}

/** Удалить личный вид пользователя (сброс к виду по умолчанию). */
export function clearPersonalView(login: string): void {
  if (!login) return;
  try {
    localStorage.removeItem(PERSONAL_PREFIX + login);
  } catch {
    /* no-op */
  }
}

/** Прочитать выбранный режим вида (по умолчанию — Общий). */
export function readViewMode(login: string): FlowViewMode {
  if (!login) return 'shared';
  try {
    return localStorage.getItem(MODE_PREFIX + login) === 'personal' ? 'personal' : 'shared';
  } catch {
    return 'shared';
  }
}

/** Запомнить режим вида пользователя. */
export function writeViewMode(login: string, mode: FlowViewMode): void {
  if (!login) return;
  try {
    localStorage.setItem(MODE_PREFIX + login, mode);
  } catch {
    /* no-op */
  }
}
