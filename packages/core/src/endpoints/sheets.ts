/**
 * Google Sheets bridge (`handlers-sheets.js`, 7 actions). Wrappers сюда
 * добавляются по мере того как UI начинает использовать соответствующие
 * фичи в `TablesScreen`. Полная схема:
 *
 *   • list_sheets           — список таблиц + табов для меню
 *   • get_sheet             — данные таба (values/formats/notes)
 *   • update_cell           — write back с optimistic-concurrency revision
 *   • run_script            — выполнить макрос (server-orchestrated)
 *   • get_client_config     — google_api_key + setup для embedded webview
 *   • search_sap_doc        — поиск в SAP knowledge base
 *   • check_sheet_action_status — polling статуса async script execution
 */

import type { ApiClient } from '../api/client';

// ── Domain types ──────────────────────────────────────────────────────────

export interface SheetTab {
  name: string;
  index: number;
  rows: number;
  cols: number;
}

export interface SheetSummary {
  /** Внутренний ключ (WORKFLOW, OTIF5, …). */
  key: string;
  /** Видимое имя ("Workflow", "ОТИФ 5"). */
  label: string;
  canEdit: boolean;
  tabs: SheetTab[];
}

interface ListSheetsWire {
  ok: boolean;
  sheets?: Array<{
    key: string;
    label: string;
    can_edit: boolean;
    tabs: Array<{ name: string; index: number; rows: number; cols: number }>;
  }>;
}

/**
 * `list_sheets` — список доступных Google-таблиц + их вкладок. Сервер
 * пробует получить metadata для каждой sheetId из реестра; если конфиг не
 * настроен или REPLACE_ME — таблица в список не входит.
 *
 * Permission: admin/developer (server enforce'ит).
 */
export async function listSheets(client: ApiClient): Promise<SheetSummary[]> {
  const wire = await client.call<ListSheetsWire>('list_sheets', {});
  if (!wire.sheets) return [];
  return wire.sheets.map(
    (s): SheetSummary => ({
      key: s.key,
      label: s.label,
      canEdit: s.can_edit,
      tabs: s.tabs.map((t) => ({
        name: t.name,
        index: t.index,
        rows: t.rows,
        cols: t.cols,
      })),
    }),
  );
}

// ── get_sheet ─────────────────────────────────────────────────────────────

export interface SheetSnapshot {
  revision: string;
  values: string[][];
  formats?: unknown;
  notes?: unknown;
  validations?: unknown;
  /** true когда since_revision совпал с актуальным — клиент сохраняет старое. */
  unchanged?: boolean;
}

interface GetSheetWire {
  ok: boolean;
  revision: string;
  values?: string[][];
  formats?: unknown;
  validations?: unknown;
  notes?: unknown;
  unchanged?: boolean;
}

/**
 * `get_sheet` — содержимое вкладки. `sinceRevision` нужен для polling-flow:
 * сервер сравнит, если ничего не изменилось, вернёт `unchanged:true` без тела.
 */
export async function getSheet(
  client: ApiClient,
  args: { sheetKey: string; tabName: string; sinceRevision?: string },
): Promise<SheetSnapshot> {
  const wire = await client.call<GetSheetWire>('get_sheet', {
    sheet_key: args.sheetKey,
    tab_name: args.tabName,
    since_revision: args.sinceRevision ?? '',
  });
  return {
    revision: wire.revision,
    values: wire.values ?? [],
    formats: wire.formats,
    notes: wire.notes,
    validations: wire.validations,
    unchanged: wire.unchanged === true,
  };
}

// ── update_cell ───────────────────────────────────────────────────────────

export interface UpdateCellResult {
  revision: string;
  /** server вернул revision_conflict — данные клиента устарели. */
  conflict?: boolean;
}

interface UpdateCellWire {
  ok: boolean;
  revision?: string;
  error?: string;
}

/**
 * `update_cell` — записать значение в A1-cell. Optimistic concurrency:
 * передаём `expectedRevision`, сервер проверит и откажет если изменился.
 */
export async function updateCell(
  client: ApiClient,
  args: {
    sheetKey: string;
    tabName: string;
    a1: string;
    value: string;
    expectedRevision?: string;
  },
): Promise<UpdateCellResult> {
  const wire = await client.call<UpdateCellWire>('update_cell', {
    sheet_key: args.sheetKey,
    tab_name: args.tabName,
    a1: args.a1,
    value: args.value,
    expected_revision: args.expectedRevision ?? '',
  });
  if (wire.error === 'revision_conflict') {
    return { revision: wire.revision ?? '', conflict: true };
  }
  return { revision: wire.revision ?? '' };
}

// ── run_script ────────────────────────────────────────────────────────────

interface RunScriptWire {
  ok: boolean;
  action_id?: string;
  error?: string;
}

export interface RunScriptArgs {
  /** ID action'а из registry. */
  actionId: string;
  /** Человеко-читаемая подпись — попадает в lock-broadcast. */
  actionLabel: string;
  /** Лист (rawName) с которого запущен скрипт. */
  tabName: string;
  /** Login юзера-инициатора. */
  userName: string;
  /** Какие листы блокируем. Server использует это в broadcast'е. */
  lockedTabs: readonly string[];
  /** Если action.requiresPassword — пароль от юзера. */
  password?: string;
}

/**
 * `run_script` — запуск сервер-оркестрированного скрипта. Server делает:
 *  1. WS broadcast `sheet_lock_acquired` с lockedTabs.
 *  2. Fetch `scriptUrl` из registry (sync, до 3 мин).
 *  3. WS broadcast `sheet_lock_released`.
 * Клиент получает `{ ok, action_id, error? }`.
 *
 * Initiator ДОЛЖЕН до вызова сделать локальный optimistic acquire
 * (см. `useSheetsLockStore.acquire`) — WS roundtrip медленный.
 */
export async function runScript(
  client: ApiClient,
  args: RunScriptArgs,
): Promise<{ ok: boolean; actionId?: string; error?: string }> {
  const wire = await client.call<RunScriptWire>('run_script', {
    action_id: args.actionId,
    action_label: args.actionLabel,
    tab_name: args.tabName,
    user_name: args.userName,
    locked_tabs: Array.from(args.lockedTabs),
    password: args.password,
  });
  return { ok: !!wire.ok, actionId: wire.action_id, error: wire.error };
}

interface CheckActionWire {
  ok: boolean;
  action_id?: string;
  alive?: boolean;
  http_status?: number;
  response?: string;
  error?: string;
}

/**
 * `check_sheet_action_status` — server fetch'ит `statusUrl` из registry и
 * возвращает `alive` boolean (true пока скрипт работает). Клиент polling'ует
 * до тех пор пока `alive === false` (или timeout).
 */
export async function checkSheetActionStatus(
  client: ApiClient,
  actionId: string,
): Promise<{ alive: boolean; httpStatus?: number; error?: string }> {
  const wire = await client.call<CheckActionWire>('check_sheet_action_status', {
    action_id: actionId,
  });
  return {
    alive: !!wire.alive,
    httpStatus: wire.http_status,
    error: wire.error,
  };
}

// ── get_sheet_stats (кнопка «Проверка») ────────────────────────────────────

export interface SheetStatsResult {
  rows?: string[];
  matched?: number;
  total?: number;
  mode?: 'no_sheets' | 'no_supply' | 'all_ok' | 'missing';
  /** Apps Script вернул «не изменилось» (version-poll) — клиент держит старое. */
  unchanged?: boolean;
  /** Текущая версия данных (для следующего version-poll). */
  v?: string;
}

interface SheetStatsWire {
  ok: boolean;
  stats?: SheetStatsResult;
  error?: string;
}

/**
 * `get_sheet_stats` — серверный прокси кнопки «Проверка». CF сам фетчит
 * `statsUrl` (по file_id из registry) — раньше это делал клиент напрямую на
 * `script.google.com`, что режется корп-прокси EVRAZ. Version-poll: передаём
 * последнюю `v`, Apps Script отдаёт `{unchanged:true}` если данные не менялись.
 */
export async function getSheetStats(
  client: ApiClient,
  fileId: string,
  v?: string,
): Promise<SheetStatsResult> {
  const wire = await client.call<SheetStatsWire>('get_sheet_stats', {
    file_id: fileId,
    v: v ?? '',
  });
  return wire.stats ?? {};
}

/**
 * §pyn-1.2.20 — `release_sheet_lock` — явный release маски после polling.
 * Server broadcastит `sheet_lock_released` → все клиенты в room снимают
 * overlay. Раньше release делал server сразу после Apps Script dispatch →
 * маска снималась за 5 сек, юзер видел «маска слетела» при работе скрипта.
 *
 * Вызывается из initiator'а после того как `checkSheetActionStatus` вернул
 * `alive=false` (или после timeout polling). Безопасно вызывать многократно.
 */
export async function releaseSheetLock(
  client: ApiClient,
  actionId: string,
): Promise<{ ok: boolean }> {
  const wire = await client.call<{ ok: boolean }>('release_sheet_lock', {
    action_id: actionId,
  });
  return { ok: !!wire.ok };
}

// ── SAP-macro flow (Windows-only) ─────────────────────────────────────────

export interface MacroBundle {
  macroId: string;
  actionId: string;
  /** Полный исходник VBS-скрипта. Клиент пишет на диск без BOM и spawn'ит cscript. */
  vbsSource: string;
  /** HMAC-stateless token со сроком ~15 мин. Подписывает submit_macro_data. */
  macroToken: string;
  expiresInSec: number;
}

interface MacroBundleWire {
  ok: boolean;
  macro_id?: string;
  action_id?: string;
  vbs_source?: string;
  macro_token?: string;
  expires_in_sec?: number;
  error?: string;
}

/**
 * `get_macro_bundle` — получить VBS-исходник + macro_token для запуска
 * SAP-макроса. Server проверяет action.requiresPassword.
 *
 * Возвращает `{ ok, bundle, error }`:
 *   • bundle → можно запускать VBS.
 *   • error === 'wrong_password' → перепросить пароль.
 *   • error === 'not_a_macro_action' → у action.macroId === null.
 */
export async function getMacroBundle(
  client: ApiClient,
  args: {
    actionId: string;
    password?: string;
    /** §pyn-1.2.20 — для broadcast sheet_lock_acquired (label/tab/user). */
    tabName?: string;
    actionLabel?: string;
    userName?: string;
  },
): Promise<
  | { ok: true; bundle: MacroBundle }
  | { ok: false; error: string }
> {
  const wire = await client.call<MacroBundleWire>('get_macro_bundle', {
    action_id: args.actionId,
    password: args.password,
    tab_name: args.tabName,
    action_label: args.actionLabel,
    user_name: args.userName,
  });
  if (!wire.ok || !wire.vbs_source || !wire.macro_token) {
    return { ok: false, error: wire.error ?? 'unknown' };
  }
  return {
    ok: true,
    bundle: {
      macroId: wire.macro_id ?? '',
      actionId: wire.action_id ?? args.actionId,
      vbsSource: wire.vbs_source,
      macroToken: wire.macro_token,
      expiresInSec: wire.expires_in_sec ?? 900,
    },
  };
}

interface SubmitMacroWire {
  ok: boolean;
  macro_id?: string;
  rows_inserted?: number;
  range_written?: string;
  mode?: string;
  error?: string;
}

/**
 * `submit_macro_data` — отправить TSV-результат VBS-макроса серверу.
 * Сервер пишет данные в Sheets API и (опц.) дёргает Apps Script processor.
 */
export async function submitMacroData(
  client: ApiClient,
  args: { macroToken: string; data: string; actionId: string },
): Promise<{ ok: boolean; rowsInserted?: number; error?: string }> {
  const wire = await client.call<SubmitMacroWire>('submit_macro_data', {
    macro_token: args.macroToken,
    data: args.data,
    action_id: args.actionId,
  });
  return {
    ok: !!wire.ok,
    rowsInserted: wire.rows_inserted,
    error: wire.error,
  };
}

// ── search_sap_doc ────────────────────────────────────────────────────────

export interface SapDocHit {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchSapWire {
  ok: boolean;
  data?: Array<{ title: string; url: string; snippet?: string }>;
}

export async function searchSapDoc(
  client: ApiClient,
  query: string,
): Promise<SapDocHit[]> {
  const wire = await client.call<SearchSapWire>('search_sap_doc', { query });
  return (wire.data ?? []).map((d) => ({ title: d.title, url: d.url, snippet: d.snippet }));
}

// ── get_client_config ─────────────────────────────────────────────────────

export interface SheetsClientConfig {
  googleApiKey: string;
  /** Прочие поля сервер добавляет по мере необходимости — пробрасываем как есть. */
  raw: Record<string, unknown>;
}

interface ClientConfigWire {
  ok: boolean;
  /** Server отвечает `{ ok, config: { files: [...] } }` (sanitized SHEETS_REGISTRY). */
  config?: Record<string, unknown>;
  /** Legacy ключ `data` для будущих фич — оставляем pass-through. */
  data?: Record<string, unknown>;
}

export async function getSheetsClientConfig(
  client: ApiClient,
): Promise<SheetsClientConfig> {
  const wire = await client.call<ClientConfigWire>('get_client_config', {});
  const merged = { ...(wire.data ?? {}), ...(wire.config ?? {}) };
  return {
    googleApiKey:
      typeof merged['google_api_key'] === 'string' ? (merged['google_api_key'] as string) : '',
    raw: merged,
  };
}
