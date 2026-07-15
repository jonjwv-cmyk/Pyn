import { Fragment, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import type { FlowTransportRow, FlowVehicle } from '@pyn/core';
import { cn } from '@/lib/cn';
import { formatMobilePhone } from '@/lib/mol-format';
import { useProdCalendarStore } from '@/lib/prod-calendar';
import { formatUntilDate } from './flow-sandbox.fixtures';
import {
  vehicleBrand,
  fmtTimeRange,
  workIsSixPlus,
  fmtDaysTitle,
  fmtDaysSummary,
  weekdayRu,
} from './FlowTransportGrid';
import { isDokRow, isOkalinaRow, isShiftUndershoot, shouldPrintTransportRow } from './flow-transport-shift';
import type { FlowDriverOption } from './flow-driver-cell';

/** Уникальные гаражные по каждому дню (одна машина — один раз в день, без дублей по работам). */
function uniqGarageCountByDay(rows: FlowTransportRow[]): number {
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const g = (r.garage_no || '').trim();
    if (!g) continue;
    const d = r.tdate || '';
    let set = byDay.get(d);
    if (!set) {
      set = new Set();
      byDay.set(d, set);
    }
    set.add(g);
  }
  let n = 0;
  for (const set of byDay.values()) n += set.size;
  return n;
}

/**
 * Печать листа «Транспорт» — С ПРЕВЬЮ (как График): открывается окно с РЕАЛЬНЫМ листом
 * (что видишь, то и печатается), из него «Печать» (системный диалог) или «PDF» через
 * канонический print-bridge (printToPDF, media=print). Поддержка НЕСКОЛЬКИХ дней
 * (юзер 2026-06-12): дни идут блоками с оранжевой линией-заголовком; чёрная линия внутри
 * дня отделяет блок пунктов «6+». Галочки ДОК/ОКАЛИНА — в поповере «Печать» тулбара;
 * серая заливка только у строк 6.x (ДОК) и 8.x (ОКАЛИНА), чёрная линия — без заливки.
 */
export function FlowTransportPrint({
  days,
  rows,
  vehByGarage,
  driverByFio,
  printDok,
  printOkalina,
  onClose,
}: {
  days: string[];
  rows: FlowTransportRow[];
  vehByGarage: Map<string, FlowVehicle>;
  driverByFio: Map<string, FlowDriverOption>;
  printDok: boolean;
  printOkalina: boolean;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const prodCalByYear = useProdCalendarStore((st) => st.byYear);

  const printRows = useMemo(
    () => rows.filter((r) => shouldPrintTransportRow(r.work, printDok, printOkalina)),
    [rows, printDok, printOkalina],
  );

  const multiDay = days.length > 1;
  const title = fmtDaysTitle(days);
  // Общий счётчик — полная разнарядка дня(дней), не зависит от галочек ДОК/ОКАЛИНА.
  const totalWorks = rows.length;
  const totalVeh = useMemo(() => uniqGarageCountByDay(rows), [rows]);
  const fullSchedule = printDok && printOkalina;
  const dokStats = useMemo(() => {
    const dokRows = rows.filter((r) => isDokRow(r.work));
    return { works: dokRows.length, veh: uniqGarageCountByDay(dokRows) };
  }, [rows]);
  const okalinaStats = useMemo(() => {
    const okRows = rows.filter((r) => isOkalinaRow(r.work));
    return { works: okRows.length, veh: uniqGarageCountByDay(okRows) };
  }, [rows]);
  const zoom = useMemo(() => {
    const HEADER = 54;
    const THEAD = 22;
    const ROW = 34;
    const DAYHEAD = 24;
    const PAGE = 1040;
    const h = HEADER + THEAD + printRows.length * ROW + (multiDay ? days.length * DAYHEAD : 0);
    const pages = Math.max(1, Math.ceil(h / PAGE));
    if (pages > 1) {
      const lastH = h - (pages - 1) * PAGE;
      if (lastH < 150) {
        const z = ((pages - 1) * PAGE) / h;
        if (z >= 0.72) return z;
      }
    }
    return 1;
  }, [printRows.length, days.length, multiDay]);

  const run = async (mode: 'dialog' | 'save'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    document.body.classList.add('tr-printing');
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const name = `Транспорт ${fmtDaysSummary(days) || 'лист'}`.slice(0, 80);
      const pyn = window.pyn?.print;
      if (pyn) {
        const res = mode === 'save' ? await pyn.savePdf(name) : await pyn.dialog(name);
        if (!res?.ok && res?.error) setMsg(`Печать: ${res.error}`);
      } else {
        window.print();
      }
    } catch (e) {
      setMsg(`Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
    } finally {
      document.body.classList.remove('tr-printing');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="tr-print-overlay">
      <style>{`
        .tr-print-overlay {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
        }
        .tr-print-frame {
          display: flex; flex-direction: column; gap: 8px;
          max-height: 92vh; width: min(1180px, 96vw);
        }
        .tr-print-sheet {
          background: #fff; color: #111; border-radius: 6px;
          padding: 18px 20px; overflow: auto;
          font-family: 'Inter Variable', system-ui, sans-serif;
        }
        .tr-print-sheet h1 { font-size: 15px; margin: 0 0 2px; color: #111; }
        .tr-print-sheet .tr-sub { font-size: 10px; color: #111; margin: 0 0 8px; }
        .tr-print-sheet .tr-sub strong { font-weight: 700; }
        .tr-print-sheet .tr-sub-sep { margin: 0 0.35em; color: #666; font-weight: 400; }
        .tr-print-sheet table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: auto; color: #111; }
        .tr-print-sheet th, .tr-print-sheet td {
          border: 0.5px solid #999; padding: 3px 6px; text-align: left; vertical-align: middle;
          white-space: nowrap; color: #111;
          line-height: 1.25;
        }
        .tr-print-sheet th { background: #EFEDE8; font-weight: 600; font-size: 10px; color: #111; }
        .tr-print-sheet td.tr-grow { white-space: normal; width: 100%; }
        .tr-print-sheet td.tr-work {
          white-space: normal; min-width: 190px; max-width: 320px;
          overflow-wrap: break-word; word-break: normal;
        }
        .tr-print-sheet td.tr-driver { white-space: nowrap; }
        .tr-print-sheet .tr-off td { color: #111; background: #F6F5F2; }
        .tr-print-sheet .tr-time { font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-time-bold { font-weight: 700; }
        .tr-print-sheet .tr-garage { font-weight: 700; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-sub2 { color: #333; }
        .tr-print-sheet .tr-drsub { white-space: nowrap; }
        .tr-print-sheet .tr-phone { font-weight: 700; color: #111; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-mol { color: #8A4B2E; font-weight: 600; }
        .tr-print-sheet .tr-cluster-line td { border-top: 1.5px solid #111; }
        .tr-print-sheet .tr-print-dok td { background: #D9D9D9; color: #111; }
        .tr-print-sheet .tr-print-okalina td { background: #D9D9D9; color: #111; }
        .tr-print-sheet .tr-dayhead td {
          background: #FBEDE7; color: #8A4B2E; font-weight: 700; font-size: 10px;
          border-top: 2.5px solid #D97757; padding: 4px 6px;
        }
        @media print {
          @page { size: A4 landscape; margin: 8mm 10mm; }
          body.tr-printing #root { display: none !important; }
          .tr-print-overlay { position: static; background: none; display: block; }
          .tr-print-frame { max-height: none; width: auto; }
          .tr-print-sheet { border-radius: 0; padding: 0; overflow: visible;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .tr-noprint { display: none !important; }
          .tr-print-sheet tr { break-inside: avoid; }
          .tr-print-sheet thead { display: table-header-group; }
          .tr-print-sheet .tr-dayhead { break-after: avoid; }
        }
      `}</style>
      <div className="tr-print-frame">
        <div className="tr-noprint flex flex-wrap items-center gap-2 text-[12px] text-white">
          <span className="font-medium">Предпросмотр · Транспорт {title}</span>
          {msg && <span className="text-white/70">{msg}</span>}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('dialog')}
              className="flex h-7 items-center gap-1.5 rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Printer size={13} strokeWidth={1.75} />
              Печать
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('save')}
              className="flex h-7 items-center rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/30 transition-colors hover:bg-white/10"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </span>
        </div>
        <div className="tr-print-sheet" style={{ zoom }}>
          <h1>Транспорт · {title}</h1>
          <p className="tr-sub">
            <strong>работ</strong> {totalWorks} · <strong>машин</strong> {totalVeh}
            {multiDay ? ` · дней ${days.length}` : ''}
            {!fullSchedule && !printDok ? (
              <>
                <span className="tr-sub-sep">|</span>
                <strong>ДОК</strong>: <strong>работ</strong> {dokStats.works} · <strong>машин</strong> {dokStats.veh}
              </>
            ) : null}
            {!fullSchedule && !printOkalina ? (
              <>
                <span className="tr-sub-sep">|</span>
                <strong>ОКАЛИНА</strong>: <strong>работ</strong> {okalinaStats.works} · <strong>машин</strong>{' '}
                {okalinaStats.veh}
              </>
            ) : null}
          </p>
          <table>
            <thead>
              <tr>
                <th>СТАТУС</th>
                <th>РАБОТА</th>
                <th>ТИП ТС</th>
                <th>ВРЕМЯ</th>
                <th>МАРКА</th>
                <th>№ · ГОС</th>
                <th>ВЫЕЗД</th>
                <th>ВОДИТЕЛЬ</th>
                <th>КОММЕНТАРИЙ</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((r, i) => {
                const veh = vehByGarage.get(r.garage_no);
                const off = r.status === 'Отклонен' || r.status === 'Отмена';
                const brand = veh?.model ? vehicleBrand(veh.model) : '';
                const out = r.out_status || '';
                const driver = r.driver || veh?.driver || '';
                const dInfo = driver ? driverByFio.get(driver) : undefined;
                const phone = r.driver_phone || veh?.driver_phone || '';
                const phoneDisplay = phone ? formatMobilePhone(phone) : '';
                const prev = i > 0 ? printRows[i - 1] : undefined;
                const dayChanged = !prev || prev.tdate !== r.tdate;
                const clusterLine =
                  prev && prev.tdate === r.tdate && !workIsSixPlus(prev.work) && workIsSixPlus(r.work);
                const dok = isDokRow(r.work);
                const okalina = isOkalinaRow(r.work);
                const timeBold = isShiftUndershoot(r.time_range, r.work, r.tdate, prodCalByYear);
                return (
                  <Fragment key={r.id}>
                    {multiDay && dayChanged && (
                      <tr className="tr-dayhead">
                        <td colSpan={9}>
                          {weekdayRu(r.tdate)}, {fmtDaysSummary([r.tdate])}
                        </td>
                      </tr>
                    )}
                    <tr
                      className={
                        cn(
                          off && 'tr-off',
                          clusterLine && 'tr-cluster-line',
                          dok && 'tr-print-dok',
                          okalina && 'tr-print-okalina',
                        ) || undefined
                      }
                    >
                      <td>{r.status}</td>
                      <td className="tr-work">{r.work}</td>
                      <td>{r.vehicle_type}</td>
                      <td className={cn('tr-time', timeBold && 'tr-time-bold')}>{fmtTimeRange(r.time_range)}</td>
                      <td>
                        {brand}
                        {veh?.color ? (
                          <>
                            <br />
                            <span className="tr-sub2">{veh.color}</span>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <span className="tr-garage">{r.garage_no}</span>
                        {veh?.gos_no ? (
                          <>
                            <br />
                            <span className="tr-sub2">{veh.gos_no}</span>
                          </>
                        ) : null}
                      </td>
                      <td>{out}</td>
                      <td className="tr-driver">
                        {driver}
                        {phoneDisplay || dInfo?.isMol ? (
                          <>
                            <br />
                            <span className="tr-drsub">
                              {phoneDisplay && <span className="tr-phone">{phoneDisplay}</span>}
                              {dInfo?.isMol ? (
                                <span className="tr-mol">
                                  {phoneDisplay ? ' · ' : ''}МОЛ
                                  {dInfo.until ? ` · по ${formatUntilDate(dInfo.until)}` : ''}
                                </span>
                              ) : null}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td className="tr-grow">{r.comment}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}