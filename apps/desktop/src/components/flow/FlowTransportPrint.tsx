import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import type { FlowTransportRow, FlowVehicle } from '@pyn/core';
import { formatMobilePhone } from '@/lib/mol-format';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';
import { vehicleBrand } from './FlowTransportGrid';

/**
 * Печать листа «Транспорт на день» — С ПРЕВЬЮ (как График): открывается окно с
 * РЕАЛЬНЫМ листом (видимый HTML — что видишь, то и печатается), из него «Печать»
 * (системный диалог) или «PDF». Печать через канонический print-bridge
 * (printToPDF): на время печати body.tr-printing прячет #root и хром превью —
 * остаётся только лист. Фикс «скриншота»: раньше лист был скрытым (display:none)
 * порталом — теперь он отрисован на экране, printToPDF забирает его же.
 */
export function FlowTransportPrint({
  date,
  rows,
  vehByGarage,
  onClose,
}: {
  date: string;
  rows: FlowTransportRow[];
  vehByGarage: Map<string, FlowVehicle>;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (mode: 'dialog' | 'save'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    document.body.classList.add('tr-printing');
    try {
      // Кадр на применение print-классов до printToPDF.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const name = `Транспорт ${fmtDateFile(date)}`;
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

  const active = rows.filter((r) => r.status !== 'Отклонен' && r.status !== 'Отмена');

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
          max-height: 92vh; width: min(900px, 94vw);
        }
        .tr-print-sheet {
          background: #fff; color: #111; border-radius: 6px;
          padding: 18px 20px; overflow: auto;
          font-family: 'Inter Variable', system-ui, sans-serif;
        }
        .tr-print-sheet h1 { font-size: 15px; margin: 0 0 2px; }
        .tr-print-sheet .tr-sub { font-size: 10px; color: #555; margin: 0 0 8px; }
        .tr-print-sheet table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        .tr-print-sheet th, .tr-print-sheet td {
          border: 0.5px solid #999; padding: 2px 4px; text-align: left; vertical-align: top;
        }
        .tr-print-sheet th { background: #EFEDE8; font-weight: 600; font-size: 9px; }
        .tr-print-sheet .tr-off td { color: #999; background: #F6F5F2; }
        .tr-print-sheet .tr-num { text-align: right; font-variant-numeric: tabular-nums; }
        @media print {
          body.tr-printing #root { display: none !important; }
          .tr-print-overlay { position: static; background: none; display: block; }
          .tr-print-frame { max-height: none; width: auto; }
          .tr-print-sheet { border-radius: 0; padding: 0; overflow: visible;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .tr-noprint { display: none !important; }
          .tr-print-sheet tr { break-inside: avoid; }
          .tr-print-sheet thead { display: table-header-group; }
        }
      `}</style>
      <div className="tr-print-frame">
        {/* Панель превью — на печать НЕ идёт. */}
        <div className="tr-noprint flex items-center gap-2 text-[12px] text-white">
          <span className="font-medium">Предпросмотр · Транспорт {fmtDateRu(date)}</span>
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
        <div className="tr-print-sheet">
          <h1>Транспорт · {fmtDateRu(date)}</h1>
          <p className="tr-sub">
            машин в работе: {new Set(active.filter((r) => r.garage_no).map((r) => r.garage_no)).size} · строк:{' '}
            {rows.length}
          </p>
          <table>
            <thead>
              <tr>
                <th>МАРКА</th>
                <th>№</th>
                <th>ГОС. №</th>
                <th>ТН</th>
                <th>РАБОТА</th>
                <th>ВРЕМЯ</th>
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
                    <td>{veh?.model ? vehicleBrand(veh.model) : ''}</td>
                    <td className="tr-num">{r.garage_no}</td>
                    <td>{veh?.gos_no ?? ''}</td>
                    <td className="tr-num">
                      {veh?.capacity_kg != null ? fmtSmart(veh.capacity_kg / 1000, 2) : ''}
                    </td>
                    <td>{r.work}</td>
                    <td>{(r.time_range || '').replace(/(^|[^\d])0(\d:)/g, '$1$2')}</td>
                    <td>{r.status}</td>
                    <td>{r.driver || veh?.driver || ''}</td>
                    <td>{phone ? formatMobilePhone(phone) : ''}</td>
                    <td>{r.comment}</td>
                  </tr>
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

/** YYYY-MM-DD → «8 июня 2026». */
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
