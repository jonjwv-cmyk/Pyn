import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import type { FlowDeliveryRow, FlowDeliveryEvent } from '@pyn/core';

/**
 * Карточка ИСТОРИИ движения позиции по ЯКОРЮ (заказ+позиция) — «как в Транспорте».
 * Модель «якорь ord|it + эпизод dlv|dlv_pos»: показываем таймлайн ДИСКРЕТНЫХ событий
 * (статус/перенос/удаление/исчезновение из zm_vl) + список ЭПИЗОДОВ (строки поставок,
 * включая резервные) с их судьбой: когда была в плане, поставка/позиция, кол-во, статус/
 * причина, кто возил/машина, МОЛ/согласовал, факт. Данные грузятся по клику (не polling).
 */
export interface FlowAnchorHistoryTarget {
  ord: string;
  it: string;
  mat: string;
  noNum: string;
}

interface Props {
  target: FlowAnchorHistoryTarget | null;
  load: (ord: string, it: string) => Promise<{ episodes: FlowDeliveryRow[]; events: FlowDeliveryEvent[] }>;
  onClose: () => void;
}

/** Метка вида события (человекочитаемо). */
const KIND_LABEL: Record<string, string> = {
  plan_form: 'в план',
  fix: 'фиксация',
  status_set: 'статус',
  transfer_out: 'перенос →',
  transfer_in: '← перенос',
  delete_reserve: 'удалено (резерв)',
  return_to_forming: 'возврат в формирование',
  zmvl_update: 'факт zm_vl',
  zmvl_missing_reserve: 'исчезла из zm_vl',
  sed_update: 'СЭД',
};

/** Статус эпизода/события в одну строку: ожидание / увезено / не увезли · причина. */
function statusText(doneStat: string, failReason: string): string {
  const d = (doneStat || '').trim();
  if (d === 'выполнено' || d === 'увезли') return 'увезено';
  if (d === 'не увезли') return failReason ? `не увезли · ${failReason}` : 'не увезли';
  return failReason ? `не увезли · ${failReason}` : 'ожидание';
}

/** Цвет точки статуса. */
function statusColor(doneStat: string, failReason: string): string {
  const d = (doneStat || '').trim();
  if (d === 'выполнено' || d === 'увезли') return '#1F7A33';
  if (d === 'не увезли' || failReason) return '#9A6B12';
  return '#9C9892';
}

function ts(s: string): string {
  const v = (s || '').trim();
  return v.length >= 16 ? v.slice(0, 16) : v;
}

export function FlowAnchorHistoryCard({ target, load, onClose }: Props) {
  const [data, setData] = useState<{ episodes: FlowDeliveryRow[]; events: FlowDeliveryEvent[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setData(null);
    load(target.ord, target.it)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ episodes: [], events: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target, load]);

  if (!target) return null;

  const episodes = data?.episodes ?? [];
  const events = data?.events ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[560px] flex-col rounded-xl border border-black/10 bg-[#FDFDFB] shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#2A2925]">
              <History size={14} strokeWidth={1.9} className="text-[#D97757]" />
              История позиции
            </div>
            <div className="mt-0.5 truncate text-[12px] text-[#6B6862]">
              {target.mat || target.noNum}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-[#9C9892]">
              заказ {target.ord || '—'} · поз {target.it || '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-transparent p-1 text-[#6B6862] transition-colors hover:border-black/10 hover:text-[#2A2925]"
            title="Закрыть"
          >
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && <div className="py-8 text-center text-[12px] text-[#9C9892]">Загрузка…</div>}
          {!loading && episodes.length === 0 && events.length === 0 && (
            <div className="py-8 text-center text-[12px] text-[#9C9892]">
              По этой позиции движения ещё не было.
            </div>
          )}

          {/* ЭПИЗОДЫ — строки поставок (включая резервные), судьба каждой попытки. */}
          {!loading && episodes.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9C9892]">
                Поставки ({episodes.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {episodes.map((e) => {
                  const reserved = Number(e.reserved) === 1;
                  // «Активна» — есть номер SAP, не в резерве, ещё не увезена/без факта: поставка ЖИВА
                  // у нас (важный сигнал, если позиция при этом числится не увезённой/вернулась).
                  const active =
                    !reserved && (e.dlv || '').trim() !== '' && e.fact_qty == null &&
                    e.done_stat !== 'увезли' && e.done_stat !== 'выполнено';
                  const mol = (e.snap_mol || '').trim();
                  const exps = [e.exp1, e.exp2].filter(Boolean).join(', ');
                  const veh = [e.ride_id, e.vehicle].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={e.id}
                      className={`rounded-lg border px-3 py-2 ${reserved ? 'border-black/5 bg-black/[0.02] opacity-70' : 'border-black/10 bg-white'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#2A2925]">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: statusColor(e.done_stat, e.fail_reason) }}
                          />
                          {statusText(e.done_stat, e.fail_reason)}
                          {reserved && <span className="text-[11px] font-normal text-[#9C9892]">· снято</span>}
                        </div>
                        <div className="text-[11px] tabular-nums text-[#6B6862]">
                          {e.plan_date || '—'}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-[#6B6862]">
                        <span>{e.dlv ? `поставка ${e.dlv}${e.dlv_pos ? `/${e.dlv_pos}` : ''}` : 'черновик (без №)'}</span>
                        {active && <span className="font-medium text-[#B45309]">активна</span>}
                        {e.qty != null && <span>{e.qty} {e.uom}</span>}
                        {Number(e.fixation_id) > 0 && <span>зафикс.</span>}
                        {e.fact_qty != null && <span className="text-[#1F7A33]">факт {e.fact_qty}{e.fact_dt ? ` · ${e.fact_dt}` : ''}</span>}
                      </div>
                      {(mol || exps || veh) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6B6862]">
                          {mol && <span>МОЛ: {mol}</span>}
                          {exps && <span>возил: {exps}</span>}
                          {veh && <span className="tabular-nums">{veh}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* СОБЫТИЯ — дискретный журнал переходов (новые сверху). */}
          {!loading && events.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9C9892]">
                Журнал ({events.length})
              </div>
              <div className="flex flex-col gap-1">
                {events.map((ev) => (
                  <div key={ev.id} className="flex items-baseline gap-2 text-[11px] text-[#6B6862]">
                    <span className="w-[92px] shrink-0 tabular-nums text-[#9C9892]">{ts(ev.created_at)}</span>
                    <span className="w-[120px] shrink-0 font-medium text-[#2A2925]">
                      {KIND_LABEL[ev.event_kind] ?? ev.event_kind}
                    </span>
                    <span className="min-w-0 flex-1">
                      {ev.event_kind === 'status_set' && statusText(ev.done_stat, ev.fail_reason)}
                      {(ev.event_kind === 'transfer_out' || ev.event_kind === 'transfer_in') && (ev.plan_date || ev.fail_reason)}
                      {ev.event_kind === 'delete_reserve' && (ev.dlv ? `поставка ${ev.dlv}` : 'черновик')}
                      {ev.event_kind === 'zmvl_missing_reserve' && (ev.dlv ? `поставка ${ev.dlv} не пришла` : '')}
                      {ev.full_name && <span className="ml-1 text-[#9C9892]">· {ev.full_name}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
