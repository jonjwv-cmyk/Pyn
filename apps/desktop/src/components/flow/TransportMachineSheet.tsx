/**
 * Сводка по машине (рейс) — стиль «Блок 3» дашборда Сводки.
 * Не история правок ячеек: гаражный · тип · экспедиторы · От/СП (зелёный = вывезено).
 */
import { useEffect, useMemo, useState } from 'react';
import { Truck, X } from 'lucide-react';
import { flowDeliveriesGet, isFlowStatShipped, type FlowDeliveryRow, type FlowTransportRow } from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { cmpWh, fmtDay, fmtTimeRange } from './FlowTransportGrid';

function splitParts(raw: string): string[] {
  return String(raw || '')
    .split(/[\n;,|/]+/)
    .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

function rowShipped(d: FlowDeliveryRow): boolean {
  const stat = String(d.stat || '').trim();
  const sub = String(d.stat_sub || '').trim();
  if (stat) return isFlowStatShipped(stat, sub);
  const ds = String(d.done_stat || '').trim();
  if (ds === 'увезли' || ds === 'выполнено' || ds === 'самовывоз') return true;
  if (d.fact_qty != null || !!(d.fact_dt || '').trim()) return true;
  return false;
}

function WhChip({ code, ok }: { code: string; ok: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-medium tabular-nums',
        ok
          ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
          : 'border-white/[0.1] bg-white/[0.04] text-zinc-400',
      )}
    >
      {code}
      {ok ? <span className="text-[10px] opacity-80">✓</span> : null}
    </span>
  );
}

export function TransportMachineSheet({
  row,
  onClose,
}: {
  row: FlowTransportRow;
  onClose: () => void;
}): JSX.Element {
  const [dlv, setDlv] = useState<FlowDeliveryRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const g = (row.garage_no || '').trim().toUpperCase();
    void flowDeliveriesGet(api, { planDate: row.tdate })
      .then((rows) => {
        if (!alive) return;
        setDlv(
          rows.filter((d) => {
            if (!(Number(d.fixation_id) > 0)) return false;
            const ids = splitParts(d.ride_id || '').map((x) =>
              x.replace(/^(гр\.?\s*№\s*|гр\.?\s*№?|№\s*)/i, '').trim().toUpperCase(),
            );
            return ids.some((id) => id === g);
          }),
        );
      })
      .catch(() => {
        if (alive) setDlv([]);
      });
    return () => {
      alive = false;
    };
  }, [row.garage_no, row.tdate]);

  const snap = useMemo(() => {
    const exps = new Set<string>();
    const from = new Map<string, boolean>();
    const to = new Map<string, boolean>();
    const obd = new Set<string>();
    let shippedPos = 0;
    let totalPos = 0;
    for (const d of dlv ?? []) {
      totalPos += 1;
      const ok = rowShipped(d);
      if (ok) shippedPos += 1;
      for (const raw of [d.exp1, d.exp2]) {
        for (const part of splitParts(raw || '')) exps.add(part);
      }
      const fr = (d.fr || '').trim();
      const sp = (d.to_wh || '').trim();
      if (fr) from.set(fr, (from.get(fr) ?? false) || ok);
      if (sp) to.set(sp, (to.get(sp) ?? false) || ok);
      const num = String(d.dlv || '').trim();
      if (num) obd.add(num);
    }
    const sortM = (m: Map<string, boolean>) =>
      [...m.entries()].sort((a, b) => cmpWh(a[0], b[0]));
    return {
      exps: [...exps],
      fromWhs: sortM(from),
      toWhs: sortM(to),
      obdCount: obd.size,
      shippedPos,
      totalPos,
    };
  }, [dlv]);

  const typeLabel = (row.vehicle_type || '').trim() || '—';
  const status = (row.status || '').trim();

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="fixed left-1/2 top-[12%] z-[71] w-[min(400px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#2a2926] shadow-2xl"
        role="dialog"
        aria-label="Сводка по машине"
      >
        {/* Hero */}
        <div className="border-b border-white/[0.08] bg-gradient-to-br from-[#3a342f] to-[#2a2926] px-4 pb-3.5 pt-3.5">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-clay/20 text-accent-clay">
                <Truck size={18} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight text-[#f5f4ef]">
                  гр. № {row.garage_no || '—'}
                </div>
                <div className="mt-0.5 text-[12px] text-zinc-400">{typeLabel}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              title="Закрыть"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-zinc-400">
            <span className="tabular-nums text-zinc-300">{fmtDay(row.tdate)}</span>
            {status ? (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-300">{status}</span>
              </>
            ) : null}
            {(row.fact_start || row.fact_end) && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="tabular-nums">
                  {fmtTimeRange(row.fact_start || '—')} – {fmtTimeRange(row.fact_end || '—')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="max-h-[min(60vh,420px)] space-y-3.5 overflow-y-auto px-4 py-3.5">
          {/* Экспедиторы */}
          <section>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Экспедиторы
            </div>
            {dlv === null ? (
              <div className="text-[12.5px] text-zinc-500">Загрузка…</div>
            ) : snap.exps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[12.5px] text-zinc-500">
                Экспедитор не указан
              </div>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {snap.exps.map((fio, i) => (
                  <li
                    key={fio}
                    className="flex gap-2 text-[12.5px] leading-snug text-[#e8e6e1]"
                  >
                    <span className="w-4 shrink-0 tabular-nums text-zinc-500">{i + 1}.</span>
                    <span className="min-w-0">{fio}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {dlv !== null && dlv.length === 0 && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12.5px] text-zinc-500">
              В отчёте нет зафиксированных поставок с этой машиной на {fmtDay(row.tdate)}.
            </div>
          )}

          {dlv !== null && dlv.length > 0 && (
            <>
              <section>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    От · склады отгрузки
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    зелёный = вывезено
                  </span>
                </div>
                {snap.fromWhs.length === 0 ? (
                  <div className="text-[12.5px] text-zinc-500">—</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {snap.fromWhs.map(([code, ok]) => (
                      <WhChip key={code} code={code} ok={ok} />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  СП · склады выгрузки
                </div>
                {snap.toWhs.length === 0 ? (
                  <div className="text-[12.5px] text-zinc-500">—</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {snap.toWhs.map(([code, ok]) => (
                      <WhChip key={code} code={code} ok={ok} />
                    ))}
                  </div>
                )}
              </section>

              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2.5 text-[11px] tabular-nums text-zinc-500">
                <span>
                  поставок <span className="text-zinc-300">{snap.obdCount}</span>
                </span>
                <span>
                  позиций{' '}
                  <span className="text-zinc-300">
                    {snap.shippedPos}/{snap.totalPos}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
