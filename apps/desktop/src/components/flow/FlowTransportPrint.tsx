import { Fragment, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import type { FlowTransportRow, FlowVehicle } from '@pyn/core';
import { cn } from '@/lib/cn';
import { formatMobilePhone } from '@/lib/mol-format';
import { formatUntilDate } from './flow-sandbox.fixtures';
import {
  vehicleBrand,
  fmtTimeRange,
  forceSummary,
  workIsSixPlus,
  fmtDaysTitle,
  fmtDaysSummary,
  weekdayRu,
} from './FlowTransportGrid';
import type { FlowDriverOption } from './flow-driver-cell';

/**
 * Печать листа «Транспорт» — С ПРЕВЬЮ (как График): открывается окно с РЕАЛЬНЫМ листом
 * (что видишь, то и печатается), из него «Печать» (системный диалог) или «PDF» через
 * канонический print-bridge (printToPDF, media=print). Поддержка НЕСКОЛЬКИХ дней
 * (юзер 2026-06-12): дни идут блоками с оранжевой линией-заголовком; чёрная линия внутри
 * дня отделяет блок пунктов «6+». «Стараемся вписать на лист»: если на последнюю страницу
 * сваливается «огрызок» 2-3 строки — лист слегка ужимается (zoom), чтобы влез на одну
 * страницу меньше (не размазывая).
 */
export function FlowTransportPrint({
  days,
  rows,
  vehByGarage,
  driverByFio,
  onClose,
}: {
  days: string[];
  rows: FlowTransportRow[];
  vehByGarage: Map<string, FlowVehicle>;
  driverByFio: Map<string, FlowDriverOption>;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const multiDay = days.length > 1;
  const title = fmtDaysTitle(days);
  const uniqVeh = useMemo(
    () => new Set(rows.filter((r) => r.garage_no).map((r) => r.garage_no)).size,
    [rows],
  );

  // «Стараемся вписать на лист» (юзер 2026-06-12): оценка высоты по числу строк/заголовков
  // дней; если последняя страница — «огрызок» (мало строк), ужимаем zoom'ом на страницу
  // меньше (но не мельче 72%). Детерминированно (без замера DOM), media=print это уважает.
  const zoom = useMemo(() => {
    const HEADER = 54;
    const THEAD = 22;
    const ROW = 34;
    const DAYHEAD = 24;
    const PAGE = 1040; // A4 портрет, поля 1 см ≈ 277 мм при 96dpi
    const h = HEADER + THEAD + rows.length * ROW + (multiDay ? days.length * DAYHEAD : 0);
    const pages = Math.max(1, Math.ceil(h / PAGE));
    if (pages > 1) {
      const lastH = h - (pages - 1) * PAGE;
      if (lastH < 150) {
        const z = ((pages - 1) * PAGE) / h;
        if (z >= 0.72) return z;
      }
    }
    return 1;
  }, [rows.length, days.length, multiDay]);

  const run = async (mode: 'dialog' | 'save'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    document.body.classList.add('tr-printing');
    try {
      // Кадр на применение print-классов до printToPDF.
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
        .tr-print-sheet h1 { font-size: 15px; margin: 0 0 2px; }
        .tr-print-sheet .tr-sub { font-size: 10px; color: #555; margin: 0 0 8px; }
        /* Один размер 10px на всём листе — и шапка, и тело (юзер 2026-06-12). Выравнивание:
           по ЦЕНТРУ относительно верха/низа (vertical middle) + по ЛЕВОМУ краю. */
        .tr-print-sheet table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: auto; }
        .tr-print-sheet th, .tr-print-sheet td {
          border: 0.5px solid #999; padding: 3px 6px; text-align: left; vertical-align: middle;
          white-space: nowrap;   /* колонки по содержимому — без лишней пустоты (юзер: «компактнее») */
          line-height: 1.25;     /* плотно: ячейка в 2 строки не раздувает строку (юзер: «вписать аккуратно, 10px») */
        }
        .tr-print-sheet th { background: #EFEDE8; font-weight: 600; font-size: 10px; }
        /* Перенос (юзер 2026-06-13): РАБОТА и комментарий — по словам; РАБОТА получает
           min-width, иначе авто-раскладка таблицы (комментарий width:100%) сжимала её до
           ширины одного слова — длинная работа не вписывалась. С min-width длинный текст
           укладывается в 2 строки аккуратно (перенос по словам, не разрывая слово). */
        .tr-print-sheet td.tr-grow { white-space: normal; width: 100%; }
        .tr-print-sheet td.tr-work {
          white-space: normal; min-width: 190px; max-width: 320px;
          overflow-wrap: break-word; word-break: normal;
        }
        /* ВОДИТЕЛЬ — ровно 2 строки: ФИО одной строкой (nowrap), под ним телефон + «МОЛ»
           одной строкой. Не даём ФИО переноситься (юзер 2026-06-13: «ФИО одна строка»). */
        .tr-print-sheet td.tr-driver { white-space: nowrap; }
        .tr-print-sheet .tr-off td { color: #999; background: #F6F5F2; }
        .tr-print-sheet .tr-time { font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-garage { font-weight: 700; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-sub2 { color: #777; }
        .tr-print-sheet .tr-drsub { white-space: nowrap; }
        .tr-print-sheet .tr-phone { font-weight: 700; color: #33312E; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-mol { color: #8A4B2E; font-weight: 600; }
        /* Разделительный блок 6+ — серая строка, текст тёмный и читабельный. */
        .tr-print-sheet .tr-cluster td { background: #D9D9D9; color: #222; border-top: 1px solid #666; }
        /* Заголовок ДНЯ (при печати нескольких дней) — ОРАНЖЕВАЯ линия + подпись. */
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
        {/* Панель превью — на печать НЕ идёт. */}
        <div className="tr-noprint flex items-center gap-2 text-[12px] text-white">
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
            Количество работ: {rows.length} · Машин: {uniqVeh}
            {multiDay ? ` · Дней: ${days.length}` : ''}
          </p>
          {/* Колонки — как в UI, БЕЗ Истории/Даты (юзер 2026-06-12):
              СТАТУС · РАБОТА · ТИП ТС · ВРЕМЯ · ФАКТ · МАРКА · № · ГОС · ВЫЕЗД · ВОДИТЕЛЬ · ФОРМ М · КОММЕНТАРИЙ. */}
          <table>
            <thead>
              <tr>
                <th>СТАТУС</th>
                <th>РАБОТА</th>
                <th>ТИП ТС</th>
                <th>ВРЕМЯ</th>
                <th>ФАКТ</th>
                <th>МАРКА</th>
                <th>№ · ГОС</th>
                <th>ВЫЕЗД</th>
                <th>ВОДИТЕЛЬ</th>
                <th>ФОРМ М</th>
                <th>КОММЕНТАРИЙ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const veh = vehByGarage.get(r.garage_no);
                const off = r.status === 'Отклонен' || r.status === 'Отмена';
                const brand = veh?.model ? vehicleBrand(veh.model) : '';
                const out = r.out_status || '';
                const driver = r.driver || veh?.driver || '';
                const dInfo = driver ? driverByFio.get(driver) : undefined;
                const phone = r.driver_phone || veh?.driver_phone || '';
                const phoneDisplay = phone ? formatMobilePhone(phone) : '';
                const prev = i > 0 ? rows[i - 1] : undefined;
                const dayChanged = !prev || prev.tdate !== r.tdate;
                // Чёрная линия — переход в блок «6+» ВНУТРИ одного дня.
                const cluster =
                  prev && prev.tdate === r.tdate && !workIsSixPlus(prev.work) && workIsSixPlus(r.work);
                return (
                  <Fragment key={r.id}>
                    {multiDay && dayChanged && (
                      <tr className="tr-dayhead">
                        <td colSpan={11}>
                          {weekdayRu(r.tdate)}, {fmtDaysSummary([r.tdate])}
                        </td>
                      </tr>
                    )}
                    <tr className={cn(off && 'tr-off', cluster && 'tr-cluster') || undefined}>
                      <td>{r.status}</td>
                      <td className="tr-work">{r.work}</td>
                      <td>{r.vehicle_type}</td>
                      <td className="tr-time">{fmtTimeRange(r.time_range)}</td>
                      <td className="tr-time">
                        {[fmtTimeRange(r.fact_start || ''), fmtTimeRange(r.fact_end || '')].filter(Boolean).join(' / ')}
                      </td>
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
                      {/* ВОДИТЕЛЬ — как в UI: ФИО одной строкой, под ним ТЕЛЕФОН (жирным) + «МОЛ»/«по дату». */}
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
                      <td className="tr-grow">{forceSummary(r.force_json || '[]')}</td>
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
