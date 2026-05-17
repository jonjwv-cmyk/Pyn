import { useEffect, useSyncExternalStore } from 'react';
import { getSheetsClientConfig } from '@pyn/core';
import { api } from './api';

/**
 * Глобальный singleton-cache для sanitized `SHEETS_REGISTRY.files[]`.
 * Один запрос `get_client_config` на сессию (или ручной refresh) — данные
 * читаются и Sidebar'ом (raise sub-menu таблиц), и TablesScreen'ом.
 *
 * Используем простой module-level state + subscribe pattern — Zustand для
 * этого избыточен (нет mutate-action'ов).
 */

export interface TableAction {
  id: string;
  label: string;
  icon?: string;
  requiresPassword?: boolean;
  hasStatusUrl?: boolean;
  locksTabs?: string[];
  macroId?: string | null;
}

export interface TableTab {
  gid: number;
  rawName: string;
  displayName: string;
  hidden?: boolean;
  actions?: TableAction[];
}

export interface TableFile {
  id: string;
  title: string;
  emoji?: string;
  tabs: TableTab[];
}

interface State {
  files: TableFile[];
  loading: boolean;
  error: string | null;
  loadedAt: number;
}

let state: State = { files: [], loading: false, error: null, loadedAt: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function snapshot(): State {
  return state;
}

const MOL_KEYS = new Set(['MOL', 'MOLY', 'МОЛ', 'МОЛЫ']);

/**
 * Кастомные display-имена для таблиц. Server отдаёт raw title ("WORKFLOW",
 * "OTIF5"); UI показывает короткие/русские/title-case аналоги. Override map
 * ниже — клиент-side ground truth, легко поправить без серверного релиза.
 */
const TABLE_NAME_OVERRIDES: Record<string, string> = {
  WORKFLOW: 'Workflow',
  OTIF5: 'OTIF',
};

/** Короткое имя для collapsed-режима sidebar (3-4 символа). */
const TABLE_SHORT_OVERRIDES: Record<string, string> = {
  WORKFLOW: 'WF',
  OTIF5: 'OTIF',
};

export function customTableName(rawTitle: string): string {
  const upper = rawTitle.toUpperCase();
  return TABLE_NAME_OVERRIDES[upper] ?? rawTitle;
}

export function customTableShortName(rawTitle: string): string {
  const upper = rawTitle.toUpperCase();
  if (TABLE_SHORT_OVERRIDES[upper]) return TABLE_SHORT_OVERRIDES[upper]!;
  // Fallback: первые 4 буквы full-name.
  const full = customTableName(rawTitle);
  return full.slice(0, 4).toUpperCase();
}

/**
 * Override для имён конкретных листов (tabs). Server отдаёт `rawName` =
 * исходное имя в Google Sheets; если оно неудобное (например «wf_custodians»),
 * показываем кастомное в UI.
 */
const TAB_NAME_OVERRIDES: Record<string, string> = {
  OTIF5: 'OTIF',
  WF_CUSTODIANS: 'МОЛы',
  WF_PLAN: 'План',
  RECIPIENTS: 'Рассылка',
  WF_WAREHOUSES: 'Склады',
  WF_IMPORT: 'Импорт',
  '📊SCHEDULE': 'График ТМЦ',
};

export function customTabName(rawOrDisplay: string): string {
  const trimmed = (rawOrDisplay || '').trim();
  return TAB_NAME_OVERRIDES[trimmed.toUpperCase()] ?? trimmed;
}

/**
 * Override для подписей скриптов (TableAction.label). Server отдаёт сырые
 * лейблы типа "↕ Сортировка", "↻ МОЛы/ВГХ" — UI хочет глаголы без эмодзи-
 * префиксов и без пометок «(пароль)».
 *
 * Сначала пробуем точное совпадение, затем нормализуем (убираем emoji-prefix,
 * парные скобки «(пароль)») и пробуем снова, затем substring-match.
 */
const ACTION_LABEL_OVERRIDES: Record<string, string> = {
  Сортировка: 'Сортировка',
  'МОЛы/ВГХ': 'Обновить МОЛы и ВГХ',
  'TECH NAME': 'Обновить тех. имена',
  План: 'Выгрузить план',
  Заказы: 'Обновить план',
  Подтянуть: 'Скомплектовать МОЛов',
  'БД МОЛов': 'Обновить БД МОЛов',
};

function stripActionLabelDecor(s: string): string {
  // Убираем эмодзи/символьные префиксы (↕↻▶⬇📊🚚💩 и подобные) + ведущие
  // пробелы, плюс пометки в скобках вроде «(пароль)».
  return s
    .replace(/^[\p{Emoji}←-⇿■-◿☀-➿\u{1F300}-\u{1FAFF}\s]+/u, '')
    .replace(/\s*\([^)]+\)\s*$/u, '')
    .trim();
}

export function customActionLabel(rawLabel: string): string {
  const raw = (rawLabel || '').trim();
  if (!raw) return raw;
  if (ACTION_LABEL_OVERRIDES[raw]) return ACTION_LABEL_OVERRIDES[raw]!;
  const stripped = stripActionLabelDecor(raw);
  if (ACTION_LABEL_OVERRIDES[stripped]) return ACTION_LABEL_OVERRIDES[stripped]!;
  // Substring — например server label "↻ Заказы [SAP]" → "Обновить план".
  const lower = stripped.toLowerCase();
  for (const key of Object.keys(ACTION_LABEL_OVERRIDES)) {
    if (lower.indexOf(key.toLowerCase()) !== -1) {
      return ACTION_LABEL_OVERRIDES[key]!;
    }
  }
  return stripped || raw;
}

interface RegistryShape {
  files?: TableFile[];
}

let inFlight: Promise<void> | null = null;
/** Backoff после неуспешной попытки — чтобы не спамить сервер. Растёт до 30с. */
let nextRetryAt = 0;
let retryAttempt = 0;

async function fetchOnce(): Promise<void> {
  if (inFlight) return inFlight;
  state = { ...state, loading: true, error: null };
  emit();
  inFlight = (async () => {
    try {
      const cfg = await getSheetsClientConfig(api);
      const shape = cfg.raw as RegistryShape;
      const all = Array.isArray(shape.files) ? shape.files : [];
      const filtered = all.filter(
        (f) => !MOL_KEYS.has(String(f.title || '').toUpperCase()),
      );
      state = { files: filtered, loading: false, error: null, loadedAt: Date.now() };
      retryAttempt = 0;
      nextRetryAt = 0;
    } catch (err) {
      state = {
        ...state,
        loading: false,
        error: err instanceof Error ? err.message : 'Не удалось загрузить таблицы',
      };
      // Auto-retry с экспоненциальным backoff'ом (1, 2, 4, 8, 16, 30c capped).
      retryAttempt += 1;
      const delay = Math.min(1000 * Math.pow(2, retryAttempt - 1), 30_000);
      nextRetryAt = Date.now() + delay;
      setTimeout(() => {
        if (state.files.length === 0) void fetchOnce();
      }, delay);
    } finally {
      inFlight = null;
      emit();
    }
  })();
  return inFlight;
}

/**
 * Хук подписки на registry. При первом mount запускает fetch (если ещё нет).
 * Повторные mount'ы используют cached state. Если предыдущая попытка
 * провалилась — auto-retry с backoff'ом + ручной retry при каждом mount.
 */
export function useTablesRegistry(): {
  files: TableFile[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    // Если уже идёт fetch — ничего не делаем (он эмитнет обновление).
    // Если registry пустой и backoff истёк — пробуем заново. Это покрывает
    // случай `auth_required` на первом запросе (session ещё не прогрелась):
    // mount компонента, который дергает useTablesRegistry → новый fetch.
    if (inFlight) return;
    if (snap.files.length === 0 && Date.now() >= nextRetryAt) {
      void fetchOnce();
    }
  }, [snap.files.length]);
  return { files: snap.files, loading: snap.loading, error: snap.error, refresh: fetchOnce };
}

/** Reset на logout — sidebar следующего юзера получит свежий fetch. */
export function clearTablesRegistry(): void {
  state = { files: [], loading: false, error: null, loadedAt: 0 };
  retryAttempt = 0;
  nextRetryAt = 0;
  emit();
}
