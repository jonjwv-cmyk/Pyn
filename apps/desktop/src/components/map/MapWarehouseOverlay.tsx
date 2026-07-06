import { useMemo } from 'react';
import { Phone, X } from 'lucide-react';
import { groupByWarehouse, type MolRecord } from '@pyn/core';
import { splitAndFormatWorkPhones } from '@/lib/mol-format';
import { useMolStore } from '@/lib/stores';
import { WarehouseCard } from '@/components/mol/WarehouseSidebar';

/**
 * Оверлей «данные склада» ПОВЕРХ карты (юзер 2026-07-05): нажал точку →
 * кнопка «Склад» → поверх карты карточка склада «как в Цеха» + МОЛы,
 * всё с прокруткой. Панель точки при этом остаётся «чисто данными».
 * Закрытие — крестик или клик по подложке.
 */
export function MapWarehouseOverlay({
  warehouseId,
  onClose,
}: {
  warehouseId: string;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-[470] flex items-center justify-center bg-bg-deep/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[390px] max-w-full flex-col overflow-hidden rounded-xl border border-border-default bg-bg-deep/95 shadow-[0_10px_44px_rgba(0,0,0,0.55)] backdrop-blur-md"
      >
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-subtle/70 px-3">
          <span className="text-[12.5px] font-semibold text-text-strong">Склад {warehouseId}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted outline-none transition-colors hover:bg-bg-hover hover:text-text-strong"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          <WarehouseCard
            warehouseId={warehouseId}
            hideMapLink
            onContactAction={(req) => { void navigator.clipboard?.writeText(req.target); }}
          />
          <MolBlock warehouseId={warehouseId} />
        </div>
      </div>
    </div>
  );
}

// ─── МОЛы склада ──────────────────────────────────────────────────────────

export function MolBlock({ warehouseId }: { warehouseId: string }) {
  const records = useMolStore((s) => s.records);
  const mols = useMemo(() => {
    const m = groupByWarehouse(records);
    return m.get(warehouseId.trim().toLowerCase()) ?? [];
  }, [records, warehouseId]);

  if (mols.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">МОЛы склада</p>
      <div className="space-y-2">
        {mols.map((r) => <MolRow key={r.remoteId} r={r} />)}
      </div>
    </div>
  );
}

function MolRow({ r }: { r: MolRecord }) {
  const phones = r.work ? splitAndFormatWorkPhones(r.work) : [];
  return (
    <div className="text-[12px]">
      <p className="font-semibold text-text-strong">{r.fio || '—'}</p>
      {r.position && <p className="text-text-muted">{r.position}</p>}
      {r.mobile && (
        <p className="mt-0.5 flex items-center gap-1.5 font-mono tabular-nums text-text-secondary">
          <Phone className="h-3 w-3 text-text-muted" strokeWidth={1.75} /> {r.mobile}
        </p>
      )}
      {phones.map((p, i) => (
        <p key={i} className="font-mono tabular-nums text-text-secondary">{p}</p>
      ))}
    </div>
  );
}
