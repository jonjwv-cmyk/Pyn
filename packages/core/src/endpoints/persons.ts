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
export const BROADCAST_GROUPS = [
  'ИТР УПП',
  'Заявители',
  'Согласующие',
  'Экспедиторы',
  'Водители-экспедиторы',
] as const;
export type BroadcastGroup = (typeof BROADCAST_GROUPS)[number];

/** Группы роли потока, для которых «цель/коммент» НЕ обязательна (Согласующие — там
 *  склады; Экспедиторы/Водители-экспедиторы — юзер 2026-06-12). */
export const BROADCAST_PURPOSE_OPTIONAL_GROUPS: ReadonlySet<string> = new Set([
  'Согласующие',
  'Экспедиторы',
  'Водители-экспедиторы',
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
  /** МОЛ-табельный без ФИО (для панели «Нет данных МОЛов»). */
  isOrphan: boolean;
  source: 'import' | 'manual';
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
    source: w.source === 'manual' ? 'manual' : 'import',
    warehouses: (w.warehouses ?? []).map((x) => ({ code: x.code ?? '', until: x.until ?? '' })),
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

/** Парсит plain JSON (после decrypt+gunzip) слепка персон в Person[]. */
export function parsePersonsSnapshotJson(plainText: string): { persons: Person[] } {
  const root = JSON.parse(plainText) as { persons?: PersonWire[] };
  return { persons: (root.persons ?? []).map(wireToPerson) };
}
