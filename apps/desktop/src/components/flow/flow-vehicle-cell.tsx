import { useMemo, useState } from 'react';
import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';

export interface FlowVehicleOption {
  readonly garageNo: string;
  readonly type: string;
  readonly model: string;
  readonly gosNo: string;
  readonly driver: string;
}

export interface FlowVehicleData {
  readonly kind: 'flow-vehicle';
  readonly value: string;
  readonly selected: readonly string[];
  readonly vehicles: readonly FlowVehicleOption[];
  readonly maxSelected?: number;
}

export type FlowVehicleCell = CustomCell<FlowVehicleData>;

function splitVehicleIds(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(/\r?\n|;/)) {
    const id = part.trim();
    if (!id) continue;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function FlowVehicleEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowVehicleCell;
  onFinishedEditing: (next?: FlowVehicleCell) => void;
}) {
  const { vehicles, selected, maxSelected = 3 } = cell.data;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(() => (selected.length > 0 ? [...selected] : splitVehicleIds(cell.data.value)));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? vehicles.filter((v) =>
          [v.garageNo, v.gosNo, v.type, v.model, v.driver].some((x) => x.toLowerCase().includes(q)),
        )
      : vehicles;
    return base.slice(0, 60);
  }, [query, vehicles]);

  const finish = (items: readonly string[]): void =>
    onFinishedEditing({
      ...cell,
      data: {
        ...cell.data,
        value: items.join('\n'),
        selected: [...items],
      },
    });

  const toggle = (v: FlowVehicleOption): void =>
    setPicked((prev) => {
      const exists = prev.some((x) => x.toUpperCase() === v.garageNo.toUpperCase());
      if (exists) return prev.filter((x) => x.toUpperCase() !== v.garageNo.toUpperCase());
      if (prev.length >= maxSelected) return prev;
      return [...prev, v.garageNo];
    });

  return (
    <div className="flex max-h-80 w-80 flex-col">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span className="tabular-nums">{picked.length}/{maxSelected}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => finish([])}
            className="rounded border border-white/[0.10] px-1.5 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-text-strong"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={() => finish(picked)}
            className="rounded border border-accent-clay/40 px-1.5 py-0.5 text-accent-clay transition-colors hover:bg-accent-clay/10"
          >
            Готово
          </button>
        </div>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        spellCheck={false}
        placeholder="найти"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) toggle(matches[0]);
        }}
        className="mb-1 h-8 w-full rounded-md border border-white/[0.12] bg-white/[0.04] px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent-clay/60"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5 py-0.5 text-text-secondary">
        {matches.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-text-muted/70">Машины не найдены</div>
        ) : (
          matches.map((v) => {
            const active = picked.some((x) => x.toUpperCase() === v.garageNo.toUpperCase());
            return (
              <button
                key={v.garageNo}
                type="button"
                onClick={() => toggle(v)}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-left transition-colors',
                  active ? 'border-accent-clay/40 bg-accent-clay/15' : 'border-white/[0.06] bg-white/[0.02] hover:bg-accent-clay/10',
                )}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-primary">
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px]',
                      active ? 'border-accent-clay bg-accent-clay text-white' : 'border-white/[0.18] text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  <span className="font-mono tabular-nums">{v.garageNo}</span>
                  {v.gosNo && <span className="text-text-muted">· {v.gosNo}</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-text-muted/75">
                  {[v.type, v.model].filter(Boolean).join(' · ') || 'тип не указан'}
                </span>
                {v.driver && <span className="mt-0.5 block text-[10.5px] text-text-muted/60">{v.driver}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export const flowVehicleRenderer: CustomRenderer<FlowVehicleCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowVehicleCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-vehicle',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const ids = cell.data.selected.length > 0 ? cell.data.selected : splitVehicleIds(cell.data.value);
    const byGarage = new Map(cell.data.vehicles.map((v) => [v.garageNo.toUpperCase(), v] as const));
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.textBaseline = 'middle';
    const x = rect.x + theme.cellHorizontalPadding;
    const right = rect.x + rect.width - theme.cellHorizontalPadding;
    const shown = ids.slice(0, 3);
    const lineH = Math.min(16, Math.max(12, rect.height / Math.max(shown.length, 1)));
    const startY = rect.y + rect.height / 2 - ((shown.length - 1) * lineH) / 2;
    for (let i = 0; i < shown.length; i += 1) {
      const id = shown[i] ?? '';
      const v = byGarage.get(id.toUpperCase());
      const y = startY + i * lineH;
      ctx.font = `700 10px ${theme.fontFamily}`; // R3.5: ГАРАЖНЫЙ — жирным
      ctx.fillStyle = theme.textDark;
      ctx.fillText(id, x, y, Math.max(30, rect.width * 0.45));
      if (v?.gosNo) {
        ctx.font = `9px ${theme.fontFamily}`;
        ctx.fillStyle = theme.textMedium;
        ctx.textAlign = 'right';
        ctx.fillText(v.gosNo, right, y, Math.max(30, rect.width * 0.52));
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
    return true;
  },
  provideEditor: () => ({
    editor: FlowVehicleEditor,
    disablePadding: true,
    disableStyling: true,
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '6px',
      minWidth: '300px',
    },
  }),
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '', selected: [] } }),
  onPaste: (v, d) => ({ ...d, value: v, selected: splitVehicleIds(v) }),
};
