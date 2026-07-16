import type { ApiClient } from '../api/client';

/**
 * База ПЕРСОН (ФИО + МОЛ) — вкладка «Контакты». Server-sync по образцу складов:
 *
 *   personsVersion()      → версия/дата на сервере (+ previous для дельты).
 *   personsDownloadUrl()   → URL + AES key/nonce R2-слепка (decrypt+gunzip).
 *   personsDownload()      → все контакты прямым JSON (fallback/debug).
 *   personUpdate()         → admin правит контакт → bump версии + WS 'persons_changed';
 *                            если МОЛ-задет — сервер пересобирает производную МОЛ.
 *   personCreate()         → admin «+ Контакт» (source=manual, табельный необязателен).
 *
 * МОЛ — производное от persons (сервер строит base_records/blob), поэтому
 * клиентский МОЛ-пайплайн не меняется.
 */

// ── Роль потока (поля контакта; внутр. имена остаются broadcast_*) ──────────

// Группы «роли потока» (UI-лейбл «Роль потока», юзер 2026-06-12). Экспедиторы и
// Водители-экспедиторы добавлены для транспорта/потока — для них «цель» необязательна.
// Технология заявка/Технология отгрузка/Логист (юзер 2026-07-05) — справочные роли
// под сайт, в плане/рассылке не участвуют.
export const BROADCAST_GROUPS = [
  'ИТР УПП',
  'Заявители',
  'Согласующие',
  'Экспедиторы',
  'Водители-экспедиторы',
  'Технология заявка',
  'Технология отгрузка',
  'Логист',
] as const;
export type BroadcastGroup = (typeof BROADCAST_GROUPS)[number];

/** Группы роли потока, для которых «цель/коммент» НЕ обязательна (Согласующие — там
 *  склады; Экспедиторы/Водители-экспедиторы — юзер 2026-06-12; Технология-роли и
 *  Логист — справочные, юзер 2026-07-05). */
export const BROADCAST_PURPOSE_OPTIONAL_GROUPS: ReadonlySet<string> = new Set([
  'Согласующие',
  'Экспедиторы',
  'Водители-экспедиторы',
  'Технология заявка',
  'Технология отгрузка',
  'Логист',
]);

/** Парсит JSON-массив кодов складов согласования из wire/БД. */
export function parseBroadcastApprovalWarehouses(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const code = String(item).trim();
      if (!code) continue;
      const key = code.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(code);
    }
    return out;
  } catch {
    return [];
  }
}

/** Сериализует склады согласования для patch/БД. */
export function serializeBroadcastApprovalWarehouses(codes: readonly string[]): string {
  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const code of codes) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(trimmed);
  }
  return JSON.stringify(filtered);
}

// ── Domain types ──────────────────────────────────────────────────────────

/** Склад человека: код (ведущие нули целы) + «по дату» (DD.MM.YYYY | ''). */
export interface PersonWarehouse {
  code: string;
  until: string;
  /** Исторический МОЛ — склад без нового назначения в SAP. */
  isWas?: boolean;
}

export interface Person {
  id: number;
  /** Табельный (может быть '' у ручных контактов). */
  tab: string;
  fio: string;
  position: string;
  status: string;
  /** Канон '+7XXXXXXXXXX'. */
  mobile: string;
  work: string;
  mail: string;
  comment: string;
  /** Материально-ответственное лицо (склад непустой ИЛИ флаг «МОЛ»). */
  isMol: boolean;
  /** Активный МОЛ без ФИО (панель «Новый МОЛ / Новые МОЛы»). */
  isOrphan: boolean;
  /**
   * «Уволился» (ручная пометка, главнее выгрузки): склады показываются с отметкой
   * «уволился», как МОЛ не выбирается, в Android-базу не идёт. isMol при этом может
   * быть true — договор в SAP ещё не закрыт (сигнал закрыть).
   */
  isDismissed: boolean;
  /** sap_mol — заведён выгрузкой МОЛ (табельный впервые); import — прочий импорт; manual — «+ Контакт». */
  source: 'import' | 'manual' | 'sap_mol';
  warehouses: PersonWarehouse[];
  updatedAt: string;
  /** Участвует в рассылке. */
  broadcastEnabled: boolean;
  /** '' | ИТР УПП | Заявители | Согласующие. */
  broadcastGroup: string;
  /** Цель рассылки (отдельно от comment). */
  broadcastPurpose: string;
  /** Склады согласования — только для группы «Согласующие». */
  broadcastApprovalWarehouses: string[];
}

export interface PersonsMeta {
  version: string;
  updatedAt: string;
  note?: string;
  createdAt?: string;
  /** Всего контактов. */
  recordsCount?: number | null;
  /** Из них МОЛ (is_mol=1, не орфан). */
  molCount?: number | null;
  previous?: {
    version: string;
    updatedAt: string;
    recordsCount: number | null;
    molCount: number | null;
  } | null;
}

export interface PersonsDownloadInfo {
  url: string;
  version: string;
  updatedAt: string;
  blobKeyB64: string;
  blobNonceB64: string;
}

/** Поля контакта для правки (snake-case — как в EDITABLE_COLUMNS сервера). */
export interface PersonPatch {
  tab?: string;
  fio?: string;
  position?: string;
  status?: string;
  mobile?: string;
  work?: string;
  mail?: string;
  comment?: string;
  is_mol?: 0 | 1;
  dismissed?: 0 | 1;
  broadcast_enabled?: 0 | 1;
  broadcast_group?: string;
  broadcast_purpose?: string;
  broadcast_approval_warehouses?: string;
}

/** Новый контакт («+ Контакт»). ФИО обязателен, табельный — нет. */
export interface PersonCreateInput {
  tab?: string;
  fio: string;
  position?: string;
  status?: string;
  mobile?: string;
  work?: string;
  mail?: string;
  comment?: string;
  is_mol?: 0 | 1;
  broadcast_enabled?: 0 | 1;
  broadcast_group?: string;
  broadcast_purpose?: string;
  broadcast_approval_warehouses?: string;
}

// ── Wire types ────────────────────────────────────────────────────────────

interface PersonsMetaWire {
  version?: string;
  updated_at?: string;
  note?: string;
  created_at?: string;
  records_count?: number | null;
  mol_count?: number | null;
  previous?: {
    version?: string;
    updated_at?: string;
    records_count?: number | null;
    mol_count?: number | null;
  } | null;
}

interface PersonWire {
  id?: number;
  tab?: string;
  fio?: string;
  position?: string;
  status?: string;
  mobile?: string;
  work?: string;
  mail?: string;
  comment?: string;
  is_mol?: number;
  is_orphan?: number;
  dismissed?: number;
  source?: string;
  warehouses?: Array<{ code?: string; until?: string }>;
  updated_at?: string;
  broadcast_enabled?: number;
  broadcast_group?: string;
  broadcast_purpose?: string;
  broadcast_approval_warehouses?: string;
}

interface PersonsDownloadUrlWire {
  url?: string;
  version?: string;
  updated_at?: string;
  blob_key_b64?: string | null;
  blob_nonce_b64?: string | null;
}

function wireToPerson(w: PersonWire): Person {
  return {
    id: Number(w.id ?? 0),
    tab: w.tab ?? '',
    fio: w.fio ?? '',
    position: w.position ?? '',
    status: w.status ?? '',
    mobile: w.mobile ?? '',
    work: w.work ?? '',
    mail: w.mail ?? '',
    comment: w.comment ?? '',
    isMol: Number(w.is_mol ?? 0) === 1,
    isOrphan: Number(w.is_orphan ?? 0) === 1,
    isDismissed: Number(w.dismissed ?? 0) === 1,
    source: w.source === 'manual' ? 'manual' : w.source === 'sap_mol' ? 'sap_mol' : 'import',
    warehouses: (w.warehouses ?? []).map((x) => ({
      code: x.code ?? '',
      until: x.until ?? '',
      isWas: Number((x as { is_was?: number }).is_was ?? 0) === 1 || x.until === 'был',
    })),
    updatedAt: w.updated_at ?? '',
    broadcastEnabled: Number(w.broadcast_enabled ?? 0) === 1,
    broadcastGroup: w.broadcast_group ?? '',
    broadcastPurpose: w.broadcast_purpose ?? '',
    broadcastApprovalWarehouses: parseBroadcastApprovalWarehouses(w.broadcast_approval_warehouses),
  };
}

function parseMeta(b: PersonsMetaWire | undefined): PersonsMeta {
  if (!b || !b.version) throw new Error('persons_version: empty response');
  return {
    version: b.version,
    updatedAt: b.updated_at ?? '',
    note: b.note ?? undefined,
    createdAt: b.created_at ?? undefined,
    recordsCount: b.records_count ?? null,
    molCount: b.mol_count ?? null,
    previous: b.previous && b.previous.version
      ? {
          version: b.previous.version,
          updatedAt: b.previous.updated_at ?? '',
          recordsCount: b.previous.records_count ?? null,
          molCount: b.previous.mol_count ?? null,
        }
      : null,
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────

export async function personsVersion(client: ApiClient): Promise<PersonsMeta> {
  const wire = await client.call<{ base?: PersonsMetaWire }>('persons_version', {});
  return parseMeta(wire.base);
}

export async function personsDownloadUrl(client: ApiClient): Promise<PersonsDownloadInfo> {
  const wire = await client.call<{ data?: PersonsDownloadUrlWire }>('persons_download_url', {});
  const d = wire.data;
  if (!d || !d.url) throw new Error('persons_download_url: empty data');
  return {
    url: d.url,
    version: d.version ?? '',
    updatedAt: d.updated_at ?? '',
    blobKeyB64: d.blob_key_b64 ?? '',
    blobNonceB64: d.blob_nonce_b64 ?? '',
  };
}

export async function personsDownload(
  client: ApiClient,
): Promise<{ persons: Person[]; version: string; updatedAt: string }> {
  const wire = await client.call<{ data?: PersonWire[]; version?: string; updated_at?: string }>(
    'persons_download',
    {},
  );
  return {
    persons: (wire.data ?? []).map(wireToPerson),
    version: wire.version ?? '',
    updatedAt: wire.updated_at ?? '',
  };
}

export async function personUpdate(
  client: ApiClient,
  args: { id: number; patch: PersonPatch },
): Promise<{ version: string; updatedAt: string }> {
  const wire = await client.call<{ version?: string; updated_at?: string }>('person_update', {
    id: args.id,
    patch: args.patch,
  });
  return { version: wire.version ?? '', updatedAt: wire.updated_at ?? '' };
}

export async function personCreate(
  client: ApiClient,
  person: PersonCreateInput,
): Promise<{ id: number; version: string; updatedAt: string }> {
  const wire = await client.call<{ id?: number; version?: string; updated_at?: string }>(
    'person_create',
    { person },
  );
  return { id: Number(wire.id ?? 0), version: wire.version ?? '', updatedAt: wire.updated_at ?? '' };
}

/** Запись импорта МОЛ из SAP HTML (по табельному). */
export interface PersonsMolsImportEntry {
  tab: string;
  position: string;
  warehouses: Array<{ code: string; until: string }>;
}

export interface PersonsMolsImportResult {
  version: string;
  updatedAt: string;
  received: number;
  molBefore: number;
  molAfter: number;
  newTabs: string[];
  newCount: number;
  /** Новые табельные (пополнение базы контактов). */
  contactsNew: number;
  whEmptyBefore: number;
  whEmptyAfter: number;
  whEmptyCodes: string[];
  startedAt: string;
  finishedAt: string;
}

export interface PersonsMolsBackupInfo {
  id: number;
  label: string;
  createdAt: string;
  createdBy: string;
  personsCount: number;
  molCount: number;
  warehouseLinksCount: number;
}

export interface PersonsMolsBackupRestoreResult {
  backupId: number;
  personsCount: number;
  molCount: number;
  molRows: number;
  version: string;
  updatedAt: string;
  backupCreatedAt: string;
  backupLabel: string;
}

/** Резервная копия контактов + привязок складов (перед синхронизацией МОЛ). */
export async function personsMolsBackupCreate(
  client: ApiClient,
  label?: string,
): Promise<PersonsMolsBackupInfo> {
  const wire = await client.call<{
    backup?: {
      id?: number;
      label?: string;
      created_at?: string;
      created_by?: string;
      persons_count?: number;
      mol_count?: number;
      warehouse_links_count?: number;
    };
  }>('persons_mols_backup_create', label ? { label } : {});
  const b = wire.backup ?? {};
  return {
    id: Number(b.id ?? 0),
    label: b.label ?? '',
    createdAt: b.created_at ?? '',
    createdBy: b.created_by ?? '',
    personsCount: Number(b.persons_count ?? 0),
    molCount: Number(b.mol_count ?? 0),
    warehouseLinksCount: Number(b.warehouse_links_count ?? 0),
  };
}

/** Список последних резервов МОЛ. */
export async function personsMolsBackupGet(
  client: ApiClient,
  limit = 5,
): Promise<PersonsMolsBackupInfo[]> {
  const wire = await client.call<{
    backups?: Array<{
      id?: number;
      label?: string;
      created_at?: string;
      created_by?: string;
      persons_count?: number;
      mol_count?: number;
      warehouse_links_count?: number;
    }>;
  }>('persons_mols_backup_get', { limit });
  return (wire.backups ?? []).map((b) => ({
    id: Number(b.id ?? 0),
    label: b.label ?? '',
    createdAt: b.created_at ?? '',
    createdBy: b.created_by ?? '',
    personsCount: Number(b.persons_count ?? 0),
    molCount: Number(b.mol_count ?? 0),
    warehouseLinksCount: Number(b.warehouse_links_count ?? 0),
  }));
}

/** Откат к резерву (по умолчанию — последний). */
export async function personsMolsBackupRestore(
  client: ApiClient,
  opts?: { backupId?: number; password?: string },
): Promise<PersonsMolsBackupRestoreResult & {
  versionFrom?: string;
  versionTo?: string;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
}> {
  const payload: Record<string, unknown> = {};
  if (opts?.backupId) payload.backup_id = opts.backupId;
  if (opts?.password) payload.password = opts.password;
  const wire = await client.call<{
    backup_id?: number;
    restored?: {
      persons_count?: number;
      mol_count?: number;
      mol_rows?: number;
      version?: string;
      updated_at?: string;
      backup_created_at?: string;
      backup_label?: string;
      version_from?: string;
      version_to?: string;
      duration_ms?: number;
      started_at?: string;
      finished_at?: string;
    };
  }>('persons_mols_backup_restore', payload);
  const r = wire.restored ?? {};
  return {
    backupId: Number(wire.backup_id ?? 0),
    personsCount: Number(r.persons_count ?? 0),
    molCount: Number(r.mol_count ?? 0),
    molRows: Number(r.mol_rows ?? 0),
    version: r.version ?? '',
    updatedAt: r.updated_at ?? '',
    backupCreatedAt: r.backup_created_at ?? '',
    backupLabel: r.backup_label ?? '',
    versionFrom: r.version_from ?? '',
    versionTo: r.version_to ?? r.version ?? '',
    durationMs: Number(r.duration_ms ?? 0),
    startedAt: r.started_at ?? '',
    finishedAt: r.finished_at ?? '',
  };
}

/** Полная перезапись МОЛ-данных в persons из SAP HTML. */
export async function personsImportMols(
  client: ApiClient,
  entries: PersonsMolsImportEntry[],
  startedAt?: string,
): Promise<PersonsMolsImportResult> {
  const wire = await client.call<{
    version?: string;
    updated_at?: string;
    received?: number;
    mol_before?: number;
    mol_after?: number;
    new_tabs?: string[];
    new_count?: number;
    contacts_new?: number;
    wh_empty_before?: number;
    wh_empty_after?: number;
    wh_empty_codes?: string[] | string;
    started_at?: string;
    finished_at?: string;
  }>('persons_import_mols', { entries, started_at: startedAt });
  const whCodes = Array.isArray(wire.wh_empty_codes)
    ? wire.wh_empty_codes.map(String)
    : String(wire.wh_empty_codes || '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    version: wire.version ?? '',
    updatedAt: wire.updated_at ?? '',
    received: Number(wire.received ?? 0),
    molBefore: Number(wire.mol_before ?? 0),
    molAfter: Number(wire.mol_after ?? 0),
    newTabs: Array.isArray(wire.new_tabs) ? wire.new_tabs.map(String) : [],
    newCount: Number(wire.new_count ?? 0),
    contactsNew: Number(wire.contacts_new ?? wire.new_count ?? 0),
    whEmptyBefore: Number(wire.wh_empty_before ?? 0),
    whEmptyAfter: Number(wire.wh_empty_after ?? 0),
    whEmptyCodes: whCodes,
    startedAt: wire.started_at ?? '',
    finishedAt: wire.finished_at ?? '',
  };
}

/** Парсит plain JSON (после decrypt+gunzip) слепка персон в Person[]. */
export function parsePersonsSnapshotJson(plainText: string): { persons: Person[] } {
  const root = JSON.parse(plainText) as { persons?: PersonWire[] };
  return { persons: (root.persons ?? []).map(wireToPerson) };
}
