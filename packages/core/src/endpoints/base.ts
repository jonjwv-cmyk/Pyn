import type { ApiClient } from '../api/client';

/**
 * МОЛ-справочник (Материально-Ответственные Лица) — справочник работников
 * + закреплённых за ними складов. Используется в разделе «МОЛы».
 *
 * Flow обновления (1:1 с Android `BaseSyncWorker`):
 *   1. `baseVersion()` → есть ли новая версия?
 *   2. Если да → `baseDownloadUrl()` → URL + AES key/nonce
 *   3. main process: fetch encrypted blob → AES-256-GCM decrypt → gunzip
 *      → parse JSON `{records:[…]}` → сохранить в encrypted local cache
 *   4. WS `base_changed` → invalidate, повторить с шага 1
 *
 * Auth: `baseVersion` + `baseDownloadUrl` требуют `user`+ роль.
 * `rebroadcastBase` — admin (force-push новой версии всем клиентам).
 */

// ── Domain types ──────────────────────────────────────────────────────────

export interface BaseMeta {
  /** Номер версии справочника (string — формат `1.2`/`1.3` и т.п.). */
  version: string;
  /** ISO-like timestamp последнего обновления — `YYYY-MM-DD HH:MM:SS`. */
  updatedAt: string;
  /** Заметка от админа (источник, причина обновления). */
  note?: string;
  /** Когда строка `base_meta` была создана server-side. */
  createdAt?: string;
  /**
   * Сколько записей в этой версии справочника. Authoritative с сервера.
   * `null` для legacy row'ей без `records_count` (до §MOL-PREVIOUS-COUNT
   * миграции).
   */
  recordsCount?: number | null;
  /**
   * Предыдущая версия — для diff-индикатора «ранее N (+10)» в МОЛ-topbar.
   * Server отдаёт её рядом с `current` в `base_version` response. `null`
   * если это самая первая версия или предыдущая row'я без records_count.
   */
  previous?: {
    version: string;
    updatedAt: string;
    recordsCount: number | null;
  } | null;
}

export interface BaseDownloadInfo {
  /** Прямой URL на R2 snapshot (cdn.otlhelper.com/<r2_key>). */
  url: string;
  version: string;
  updatedAt: string;
  /** Base64 AES-256 key (32 bytes) — для расшифровки blob'a. */
  blobKeyB64: string;
  /** Base64 12-byte nonce. */
  blobNonceB64: string;
}

/**
 * Одна запись справочника МОЛ. 1:1 поля с Android `MolRecord`.
 *
 * Часть полей складские (`warehouseXxx`) — заполнены только если запись
 * привязана к реальному складу. Если `warehouseId === "МОЛ"` → person —
 * материально-ответственный, но не привязан к конкретному складу
 * (legacy marker, см. `hasRealWarehouse` helper).
 */
export interface MolRecord {
  remoteId: number;
  warehouseId: string;
  warehouseName: string;
  warehouseDesc: string;
  warehouseMark: string;
  warehouseKeeper: string;
  warehouseWorkPhones: string;
  fio: string;
  status: string;
  position: string;
  mobile: string;
  work: string;
  mail: string;
  tab: string;
  /** Precomputed lowercased search-text (FIO+mobile+mail+tab+warehouse) — server-side. */
  searchText: string;
  createdAt: string;
}

/** true если запись привязана к реальному складу (не "МОЛ"/"MOL" marker). */
export function hasRealWarehouse(r: MolRecord): boolean {
  const id = r.warehouseId.trim();
  if (!id) return false;
  const upper = id.toUpperCase();
  return upper !== 'МОЛ' && upper !== 'MOL';
}

// ── Wire types ────────────────────────────────────────────────────────────

interface BaseMetaWire {
  version?: string;
  updated_at?: string;
  note?: string;
  created_at?: string;
  records_count?: number | null;
  previous?: {
    version?: string;
    updated_at?: string;
    records_count?: number | null;
  } | null;
}

interface BaseDownloadUrlWire {
  url?: string;
  version?: string;
  updated_at?: string;
  blob_key_b64?: string | null;
  blob_nonce_b64?: string | null;
}

interface MolRecordWire {
  id?: number;
  warehouse_id?: string;
  warehouse_name?: string;
  warehouse_desc?: string;
  warehouse_mark?: string;
  warehouse_keeper?: string;
  warehouse_work_phones?: string;
  fio?: string;
  status?: string;
  position?: string;
  mobile?: string;
  work?: string;
  mail?: string;
  tab?: string;
  search_text?: string;
  created_at?: string;
}

// ── Endpoints ─────────────────────────────────────────────────────────────

/**
 * Текущая версия справочника на сервере. Клиент сравнивает с локально
 * закешированной — если совпадает, ничего не скачивает.
 */
export async function baseVersion(client: ApiClient): Promise<BaseMeta> {
  const wire = await client.call<{ base?: BaseMetaWire }>('base_version', {});
  const b = wire.base;
  if (!b || !b.version) throw new Error('base_version: empty response');
  return {
    version: b.version,
    updatedAt: b.updated_at ?? '',
    note: b.note ?? undefined,
    createdAt: b.created_at ?? undefined,
    recordsCount: b.records_count ?? null,
    previous: b.previous && b.previous.version
      ? {
          version: b.previous.version,
          updatedAt: b.previous.updated_at ?? '',
          recordsCount: b.previous.records_count ?? null,
        }
      : null,
  };
}

/**
 * URL и AES key/nonce для скачивания snapshot'а. URL содержит 32-char hex
 * token → не перебирается. Snapshot — encrypted gzipped JSON `{records:[…]}`.
 *
 * Если `blob_key_b64` / `blob_nonce_b64` пришли как `null` — legacy
 * unencrypted snapshot (pre-2.3.27). Клиент должен в этом случае gunzip'ить
 * напрямую без AES.
 */
export async function baseDownloadUrl(client: ApiClient): Promise<BaseDownloadInfo> {
  const wire = await client.call<{ data?: BaseDownloadUrlWire }>('base_download_url', {});
  const d = wire.data;
  if (!d || !d.url) throw new Error('base_download_url: empty data');
  return {
    url: d.url,
    version: d.version ?? '',
    updatedAt: d.updated_at ?? '',
    blobKeyB64: d.blob_key_b64 ?? '',
    blobNonceB64: d.blob_nonce_b64 ?? '',
  };
}

/**
 * Server-side поиск по справочнику — на случай если локальная база ещё не
 * скачана (cold start). После скачивания UI делает поиск локально (быстрее +
 * offline). Возвращает максимум `limit` записей.
 */
export async function baseFind(
  client: ApiClient,
  args: { query: string; limit?: number },
): Promise<MolRecord[]> {
  const wire = await client.call<{ data?: MolRecordWire[] }>('base_find', {
    query: args.query,
    limit: args.limit,
  });
  return (wire.data ?? []).map(wireToMolRecord);
}

/**
 * Push новой версии справочника всем клиентам через WS broadcast. Admin-only.
 * UI кнопка «Обновить базу у всех» в Settings — в будущем.
 */
export async function rebroadcastBase(client: ApiClient): Promise<{ baseVersion: string; sent: number }> {
  const wire = await client.call<{ sent?: number; base_version?: string }>('rebroadcast_base', {});
  return {
    baseVersion: wire.base_version ?? '',
    sent: Number(wire.sent ?? 0),
  };
}

// ── Parser для скачанного snapshot'а (используется в main process) ────────

/**
 * Парсит plain JSON-string (после gunzip) в массив `MolRecord`. Server
 * отдаёт `{records:[{id, warehouse_id, ..., fio, status, ...}]}` — мы
 * мапим в camelCase domain тип.
 */
export function parseSnapshotJson(plainText: string): { records: MolRecord[] } {
  const root = JSON.parse(plainText) as { records?: MolRecordWire[] };
  const arr = root.records ?? [];
  return { records: arr.map(wireToMolRecord) };
}

function wireToMolRecord(wire: MolRecordWire): MolRecord {
  return {
    remoteId: Number(wire.id ?? 0),
    warehouseId: wire.warehouse_id ?? '',
    warehouseName: wire.warehouse_name ?? '',
    warehouseDesc: wire.warehouse_desc ?? '',
    warehouseMark: wire.warehouse_mark ?? '',
    warehouseKeeper: wire.warehouse_keeper ?? '',
    warehouseWorkPhones: wire.warehouse_work_phones ?? '',
    fio: wire.fio ?? '',
    status: wire.status ?? '',
    position: wire.position ?? '',
    mobile: wire.mobile ?? '',
    work: wire.work ?? '',
    mail: wire.mail ?? '',
    tab: wire.tab ?? '',
    searchText: wire.search_text ?? '',
    createdAt: wire.created_at ?? '',
  };
}
