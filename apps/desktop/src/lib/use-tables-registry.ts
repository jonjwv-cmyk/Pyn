import { useEffect, useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import i18next from 'i18next';
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
  statsUrl?: string | null;
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
 * Листы (tabs) файла WORKFLOW, которые скрываем из UI (флайаут сайдбара + выбор
 * initial-tab) — «Склады» и «График ТМЦ». Их данные приходят в Pyn отдельными
 * фичами (справочник складов / График через API), сами Google-листы юзеру не
 * нужны. Client-side ground truth — легко поправить без серверного релиза.
 * Матчим и rawName (📊SCHEDULE / WF_WAREHOUSES), и displayName (ГРАФИК ТМЦ / СКЛАДЫ).
 */
const HIDDEN_WORKFLOW_TABS = new Set([
  'WF_WAREHOUSES',
  'СКЛАДЫ',
  '📊SCHEDULE',
  'ГРАФИК ТМЦ',
]);

/**
 * Кастомные display-имена для таблиц. Server отдаёт raw title ("WORKFLOW",
 * "OTIF5"); UI показывает короткие/русские/title-case аналоги. Override map
 * ниже — клиент-side ground truth, легко поправить без серверного релиза.
 */
const TABLE_NAME_OVERRIDES: Record<string, string> = {
  WORKFLOW: 'Workflow',
  // §2026-05-19 — OTIF5 → OTIF override убран (юзер: показывать 'OTIF5' как
  // на сервере, без переименования).
};

/** Короткое имя для collapsed-режима sidebar (3-4 символа). */
const TABLE_SHORT_OVERRIDES: Record<string, string> = {
  WORKFLOW: 'WF',
  // §2026-05-19 — явный 'OTIF5' для collapsed sidebar, иначе fallback
  // slice(0,4) от 'OTIF5' дал бы 'OTIF' (что обрезает цифру).
  OTIF5: 'OTIF5',
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
 * показываем кастомное в UI. Значения — translation keys в `tables_registry.*`.
 */
/**
 * Mapping rawName/displayName (uppercase) → translation key. Когда сервер
 * присылает уже-русские displayName ("План", "Рассылка"), также матчим их —
 * иначе они оставались бы RU при смене языка. Ключи всегда в верхнем регистре,
 * сравнение через `trimmed.toUpperCase()` ниже.
 */
const TAB_NAME_KEYS: Record<string, string> = {
  // §2026-05-19 — OTIF5 override убран. Tab name внутри showed как 'OTIF5'.
  // Server raw names:
  WF_CUSTODIANS: 'tables_registry.tab_mol',
  WF_PLAN: 'tables_registry.tab_plan',
  RECIPIENTS: 'tables_registry.tab_recipients',
  WF_WAREHOUSES: 'tables_registry.tab_warehouses',
  WF_IMPORT: 'tables_registry.tab_import',
  '📊SCHEDULE': 'tables_registry.tab_schedule',
  '🚚': 'tables_registry.tab_dispatch',
  '💩': 'tables_registry.tab_undersupplied',
  // Server displayName (русские) — для случаев когда server уже отдаёт
  // переведённое имя; локализация всё равно должна работать через i18n:
  МОЛЫ: 'tables_registry.tab_mol',
  ПЛАН: 'tables_registry.tab_plan',
  РАССЫЛКА: 'tables_registry.tab_recipients',
  СКЛАДЫ: 'tables_registry.tab_warehouses',
  ИМПОРТ: 'tables_registry.tab_import',
  'ГРАФИК ТМЦ': 'tables_registry.tab_schedule',
  РАЗНАРЯДКА: 'tables_registry.tab_dispatch',
  НЕДОВОЗЫ: 'tables_registry.tab_undersupplied',
  СЭД: 'tables_registry.tab_sed',
  ОТЧЕТ: 'tables_registry.tab_report',
  'ОТЧЁТ': 'tables_registry.tab_report',
};

/**
 * Локализованное имя tab'а. Принимает t — должен передаваться caller'ом
 * (компоненты передают через useTranslation()). Без t fallback на raw string —
 * используется в редких контекстах вне React (например, debug logs).
 */
export function customTabName(rawOrDisplay: string, t?: TFunction): string {
  const trimmed = (rawOrDisplay || '').trim();
  const key = TAB_NAME_KEYS[trimmed.toUpperCase()];
  if (!key) return trimmed;
  return t ? t(key) : i18next.t(key);
}

/**
 * Override для подписей скриптов (TableAction.label). Server отдаёт сырые
 * лейблы типа "↕ Сортировка", "↻ МОЛы/ВГХ" — UI хочет глаголы без эмодзи-
 * префиксов и без пометок «(пароль)».
 *
 * Сначала пробуем точное совпадение, затем нормализуем (убираем emoji-prefix,
 * парные скобки «(пароль)») и пробуем снова, затем substring-match.
 */
/** Значения — translation keys в `tables_registry.*`. */
const ACTION_LABEL_KEYS: Record<string, string> = {
  Сортировка: 'tables_registry.action_sort',
  'МОЛы/ВГХ': 'tables_registry.action_mol_vgh',
  'TECH NAME': 'tables_registry.action_tech_name',
  Подтянуть: 'tables_registry.action_collect_mol',
  'БД МОЛов': 'tables_registry.action_db_mol',
  'Сформировать план': 'tables_registry.action_make_plan',
  'Обновить заказы': 'tables_registry.action_update_orders',
};

function stripActionLabelDecor(s: string): string {
  // Убираем эмодзи/символьные префиксы (↕↻▶⬇📊🚚💩 и подобные) + ведущие
  // пробелы, плюс пометки в скобках вроде «(пароль)».
  return s
    .replace(/^[\p{Emoji}←-⇿■-◿☀-➿\u{1F300}-\u{1FAFF}\s]+/u, '')
    .replace(/\s*\([^)]+\)\s*$/u, '')
    .trim();
}

export function customActionLabel(rawLabel: string, t?: TFunction): string {
  const raw = (rawLabel || '').trim();
  if (!raw) return raw;
  const translator = t ?? i18next.t;
  if (ACTION_LABEL_KEYS[raw]) return translator(ACTION_LABEL_KEYS[raw]!);
  const stripped = stripActionLabelDecor(raw);
  if (ACTION_LABEL_KEYS[stripped]) return translator(ACTION_LABEL_KEYS[stripped]!);
  // Substring — например server label "↻ Заказы [SAP]" → "Обновить план".
  const lower = stripped.toLowerCase();
  for (const key of Object.keys(ACTION_LABEL_KEYS)) {
    if (lower.indexOf(key.toLowerCase()) !== -1) {
      return translator(ACTION_LABEL_KEYS[key]!);
    }
  }
  return stripped || raw;
}

interface RegistryShape {
  files?: TableFile[];
  /** §bridge — VPS-релей для обхода корп-прокси к Google (только если CF выдал). */
  bridge?: { url?: string; ticket?: string };
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
      const filtered = all
        .filter((f) => !MOL_KEYS.has(String(f.title || '').toUpperCase()))
        .map((f) => {
          if (String(f.title || '').toUpperCase() !== 'WORKFLOW') return f;
          return {
            ...f,
            tabs: f.tabs.map((tab) => {
              const raw = String(tab.rawName || '').trim().toUpperCase();
              const disp = String(tab.displayName || '').trim().toUpperCase();
              return HIDDEN_WORKFLOW_TABS.has(raw) || HIDDEN_WORKFLOW_TABS.has(disp)
                ? { ...tab, hidden: true }
                : tab;
            }),
          };
        });
      state = { files: filtered, loading: false, error: null, loadedAt: Date.now() };
      retryAttempt = 0;
      nextRetryAt = 0;
      // §bridge — если CF выдал bridge-конфиг, передаём в main (он сам решит,
      // включать ли мост — только при корп-прокси). Webview Google-таблиц
      // тогда поедет через VPS-релей вместо прямого (заблокированного) docs.google.com.
      const bridge = shape.bridge;
      if (bridge?.url && bridge?.ticket) {
        void window.pyn?.bridge?.configure?.(bridge.url, bridge.ticket)?.catch?.(() => undefined);
      }
    } catch (err) {
      state = {
        ...state,
        loading: false,
        error: err instanceof Error ? err.message : i18next.t('tables_registry.load_failed'),
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
