import type { FlowViewMode } from './flow-view';

/**
 * «Вид» раздела «Транспорт» — UI-слой над данными (фильтры поиска / статусов / выбранных
 * дней). Строки таблицы не трогает. Два источника (как в Формировании):
 *   • ЛИЧНЫЙ  — приватный, localStorage (per-user), виден только себе;
 *   • ОБЩИЙ   — синхронный, на сервере (flow_transport_view_get/set + WS
 *     flow_transport_view_changed), виден всем; кто поставил — ФИО + дата.
 * Отдельные ключи от «Потока» — общий вид одного раздела не конфликтует с другим.
 */
export interface TransportView {
  search: string;
  statuses: string[];
  days: string[];
}

export const EMPTY_TRANSPORT_VIEW: TransportView = { search: '', statuses: [], days: [] };

function normalize(v: TransportView): TransportView {
  return {
    search: (v.search || '').trim(),
    statuses: [...new Set(v.statuses ?? [])].sort(),
    days: [...new Set(v.days ?? [])].sort(),
  };
}

/** Канонический JSON (сорт + trim) — для сравнения «изменилось ли» и хранения. */
export function canonicalTransportViewJson(v: TransportView): string {
  const n = normalize(v);
  return JSON.stringify({ search: n.search, statuses: n.statuses, days: n.days });
}

export const EMPTY_TRANSPORT_VIEW_JSON = canonicalTransportViewJson(EMPTY_TRANSPORT_VIEW);

export function isEmptyTransportViewJson(json: string): boolean {
  return json === EMPTY_TRANSPORT_VIEW_JSON;
}

/** Безопасный разбор (сервер / localStorage). Мусор → пустой вид. */
export function parseTransportView(value: string | null | undefined): TransportView {
  if (!value) return { ...EMPTY_TRANSPORT_VIEW };
  try {
    const o = JSON.parse(value) as Partial<TransportView>;
    return normalize({
      search: typeof o.search === 'string' ? o.search : '',
      statuses: Array.isArray(o.statuses) ? o.statuses.filter((x): x is string => typeof x === 'string') : [],
      days: Array.isArray(o.days) ? o.days.filter((x): x is string => typeof x === 'string') : [],
    });
  } catch {
    return { ...EMPTY_TRANSPORT_VIEW };
  }
}

// ── Личный вид + режим (localStorage, per-user) ─────────────────────────────
const PERSONAL_PREFIX = 'pyn.transportView.personal.';
const MODE_PREFIX = 'pyn.transportView.mode.';

export function readPersonalTransportView(login: string): TransportView | null {
  try {
    const raw = localStorage.getItem(PERSONAL_PREFIX + login);
    if (!raw) return null;
    const v = parseTransportView(raw);
    return isEmptyTransportViewJson(canonicalTransportViewJson(v)) ? null : v;
  } catch {
    return null;
  }
}

export function writePersonalTransportView(login: string, view: TransportView): void {
  try {
    localStorage.setItem(PERSONAL_PREFIX + login, canonicalTransportViewJson(view));
  } catch {
    /* localStorage недоступен/переполнен — личный вид просто не сохранится. */
  }
}

export function clearPersonalTransportView(login: string): void {
  try {
    localStorage.removeItem(PERSONAL_PREFIX + login);
  } catch {
    /* ignore */
  }
}

export function readTransportViewMode(login: string): FlowViewMode {
  try {
    return localStorage.getItem(MODE_PREFIX + login) === 'personal' ? 'personal' : 'shared';
  } catch {
    return 'shared';
  }
}

export function writeTransportViewMode(login: string, mode: FlowViewMode): void {
  try {
    localStorage.setItem(MODE_PREFIX + login, mode);
  } catch {
    /* ignore */
  }
}
