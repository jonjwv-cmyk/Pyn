import type { ApiClient } from '../api/client';
import type { Warehouse, WarehouseCluster, WarehouseWeekday } from '../types/warehouse';

/**
 * Справочник складов («Цеха»-база) — server-sync по образцу МОЛ-базы.
 *
 *   warehousesVersion()  → версия/дата на сервере (клиент сравнивает с кешем).
 *   warehousesDownload() → все склады (прямой JSON через E2E-API; клиент
 *                          кэширует зашифрованно через safeStorage).
 *   warehouseUpdate()    → admin/developer правит карточку → сервер поднимает
 *                          версию/дату + WS 'warehouses_changed' всем.
 */

export interface WarehousesMeta {
  version: string;
  updatedAt: string;
  note?: string;
  createdAt?: string;
  recordsCount?: number | null;
  previous?: {
    version: string;
    updatedAt: string;
    recordsCount: number | null;
  } | null;
}

interface WarehousesMetaWire {
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

interface WarehouseWire {
  id?: string;
  shop_name?: string;
  shop_code?: string | null;
  description?: string | null;
  designation?: string | null;
  keeper?: string | null;
  work_phone?: string | null;
  legacy_id?: string | null;
  cluster?: string | null;
  delivery_day?: string | null;
  in_schedule?: number;
  is_shipping?: number;
  is_removed?: number;
  removal_kind?: string | null;
  removed_month?: string | null;
}

/** Поля карточки склада, которые admin может править (patch для warehouseUpdate). */
export interface WarehousePatch {
  work_phone?: string | null;
  cluster?: WarehouseCluster | null;
  delivery_day?: WarehouseWeekday | null;
  in_schedule?: 0 | 1;
  is_shipping?: 0 | 1;
  is_removed?: 0 | 1;
  removal_kind?: 'auto' | 'manual' | null;
  removed_month?: string | null;
}

function flag(v: number | undefined): 0 | 1 {
  return v ? 1 : 0;
}

function wireToWarehouse(w: WarehouseWire): Warehouse {
  const cluster = w.cluster === 'КХП' || w.cluster === 'НТМК' || w.cluster === 'ВЫЕЗД' ? w.cluster : null;
  const day = (['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'] as const).includes(w.delivery_day as WarehouseWeekday)
    ? (w.delivery_day as WarehouseWeekday)
    : null;
  const kind = w.removal_kind === 'auto' || w.removal_kind === 'manual' ? w.removal_kind : null;
  return {
    id: w.id ?? '',
    shop_name: w.shop_name ?? '',
    shop_code: w.shop_code ?? null,
    description: w.description ?? null,
    designation: w.designation ?? null,
    keeper: w.keeper ?? null,
    work_phone: w.work_phone ?? null,
    legacy_id: w.legacy_id ?? null,
    cluster,
    delivery_day: day,
    in_schedule: flag(w.in_schedule),
    is_shipping: flag(w.is_shipping),
    is_removed: flag(w.is_removed),
    removal_kind: kind,
    removed_month: w.removed_month ?? null,
  };
}

function parseMeta(b: WarehousesMetaWire | undefined): WarehousesMeta {
  if (!b || !b.version) throw new Error('warehouses_version: empty response');
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

export async function warehousesVersion(client: ApiClient): Promise<WarehousesMeta> {
  const wire = await client.call<{ base?: WarehousesMetaWire }>('warehouses_version', {});
  return parseMeta(wire.base);
}

export async function warehousesDownload(
  client: ApiClient,
): Promise<{ warehouses: Warehouse[]; version: string; updatedAt: string }> {
  const wire = await client.call<{ data?: WarehouseWire[]; version?: string; updated_at?: string }>(
    'warehouses_download',
    {},
  );
  return {
    warehouses: (wire.data ?? []).map(wireToWarehouse),
    version: wire.version ?? '',
    updatedAt: wire.updated_at ?? '',
  };
}

export async function warehouseUpdate(
  client: ApiClient,
  args: { id: string; patch: WarehousePatch },
): Promise<{ version: string; updatedAt: string }> {
  const wire = await client.call<{ version?: string; updated_at?: string }>('warehouse_update', {
    id: args.id,
    patch: args.patch,
  });
  return { version: wire.version ?? '', updatedAt: wire.updated_at ?? '' };
}

export interface WarehousesDownloadInfo {
  /** Прямой URL на R2 snapshot (cdn.otlhelper.com/<r2_key>). */
  url: string;
  version: string;
  updatedAt: string;
  /** Base64 AES-256 key (32 bytes) — для расшифровки blob'a. */
  blobKeyB64: string;
  /** Base64 12-byte nonce. */
  blobNonceB64: string;
}

interface WarehousesDownloadUrlWire {
  url?: string;
  version?: string;
  updated_at?: string;
  blob_key_b64?: string | null;
  blob_nonce_b64?: string | null;
}

/** URL + AES key/nonce R2-снэпшота складов (как baseDownloadUrl у МОЛ). */
export async function warehousesDownloadUrl(client: ApiClient): Promise<WarehousesDownloadInfo> {
  const wire = await client.call<{ data?: WarehousesDownloadUrlWire }>('warehouses_download_url', {});
  const d = wire.data;
  if (!d || !d.url) throw new Error('warehouses_download_url: empty data');
  return {
    url: d.url,
    version: d.version ?? '',
    updatedAt: d.updated_at ?? '',
    blobKeyB64: d.blob_key_b64 ?? '',
    blobNonceB64: d.blob_nonce_b64 ?? '',
  };
}

/** Парсит plain JSON (после decrypt+gunzip) снэпшота складов в Warehouse[]. */
export function parseWarehousesSnapshotJson(plainText: string): { warehouses: Warehouse[] } {
  const root = JSON.parse(plainText) as { warehouses?: WarehouseWire[] };
  return { warehouses: (root.warehouses ?? []).map(wireToWarehouse) };
}
