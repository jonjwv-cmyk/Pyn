import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FlowTransportRow, FlowVehicle } from '@pyn/core';
import { formatMobilePhone } from '@/lib/mol-format';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';

/**
 * Печатный лист «Транспорт на день». На экране НЕ виден (display:none) — живёт
 * порталом вне #root; при печати наоборот: #root прячется (body.tr-printing),
 * лист показывается. Печать — через канонический print-bridge (printToPDF):
 * монтируется → ставит класс на body → зовёт `window.pyn.print.dialog/savePdf` →
 * прибирает за собой и закрывается. Браузерный fallback — window.print().
 */
export function FlowTransportPrint({
  date,
  mode,
  rows,
  vehByGarage,
  onDone,
}: {
  date: string;
  mode: 'dialog' | 'save';
  rows: FlowTransportRow[];
  vehByGarage: Map<string, FlowVehicle>;
  onDone: (ok: boolean, error?: string) => void;
}): JSX.Element {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    document.body.classList.add('tr-printing');
    const name = `Транспорт ${fmtDateFile(date)}`;
    // Кадр на отрисовку листа до printToPDF (print-CSS применит сам Chromium).
    const run = async (): Promise<void> => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const api = window.pyn?.print;
        if (api) {
          const res = mode === 'save' ? await api.savePdf(name) : await api.dialog(name);
          onDone(!!res?.ok, res?.ok ? undefined : res?.error);
        } else {
          window.print();
          onDone(true);
        }
      } catch (e) {
        onDone(false, e instanceof Error ? e.message : String(e));
      } finally {
        document.body.classList.remove('tr-printing');
      }
    };
    void run();
    return () => document.body.classList.remove('tr-printing');
  }, [date, mode, onDone]);

  const active = rows.filter((r) => r.status !== 'Отклонен' && r.status !== 'Отмена');

  return createPortal(
    <div className="tr-print-root">
      <style>{`
        .tr-print-root { display: none; }
        @media print {
          body.tr-printing #root { display: none !important; }
          body.tr-printing .tr-print-root {
            display: block !important;
            color: #111;
            font-family: 'Inter Variable', system-ui, sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .tr-print-root h1 { font-size: 14px; margin: 0 0 2px; }
          .tr-print-root .tr-sub { font-size: 10px; color: #555; margin: 0 0 8px; }
          .tr-print-root table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
          .tr-print-root th, .tr-print-root td {
            border: 0.5px solid #999; padding: 2px 4px; text-align: left; vertical-align: top;
          }
          .tr-print-root th { background: #EFEDE8; font-weight: 600; font-size: 9px; }
          .tr-print-root tr { break-inside: avoid; }
          .tr-print-root thead { display: table-header-group; }
          .tr-print-root .tr-off td { color: #999; background: #F6F5F2; }
          .tr-print-root .tr-num { text-align: right; font-variant-numeric: tabular-nums; }
        }
      `}</style>
      <h1>Транспорт · {fmtDateRu(date)}</h1>
      <p className="tr-sub">
        машин в работе: {new Set(active.filter((r) => r.garage_no).map((r) => r.garage_no)).size} ·
        строк: {rows.length}
      </p>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>ГОС. №</th>
            <th>МОДЕЛЬ</th>
            <th>ТН</th>
            <th>РАБОТА</th>
            <th>⏰</th>
            <th>СТАТУС</th>
            <th>ВОДИТЕЛЬ</th>
            <th>СОТ.</th>
            <th>КОМЕНТ.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const veh = vehByGarage.get(r.garage_no);
            const off = r.status === 'Отклонен' || r.status === 'Отмена';
            const phone = r.driver_phone || veh?.driver_phone || '';
            return (
              <tr key={r.id} className={off ? 'tr-off' : undefined}>
                <td className="tr-num">{r.garage_no}</td>
                <td>{veh?.gos_no ?? ''}</td>
                <td>{veh?.model ?? ''}</td>
                <td className="tr-num">
                  {veh?.capacity_kg != null ? fmtSmart(veh.capacity_kg / 1000, 2) : ''}
                </td>
                <td>{r.work}</td>
                <td>{r.time_range}</td>
                <td>{r.status}</td>
                <td>{r.driver || veh?.driver || ''}</td>
                <td>{phone ? formatMobilePhone(phone) : ''}</td>
                <td>{r.comment}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

/** YYYY-MM-DD → «8 июня 2026» (заголовок листа). */
function fmtDateRu(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''} ${m[1]}`;
}

/** Имя файла: «Транспорт 08.06.2026». */
function fmtDateFile(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
