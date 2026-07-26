import { Fragment, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import type { ReportComputeResult, ReportManualDay, ReportMode } from '@pyn/core';
import { cn } from '@/lib/cn';
import {
  countFleetExpeditors,
  countFleetVehicles,
  fleetGroupLine1,
  type ExpedGroup,
} from './report-fleet';

/**
 * Печать/PDF Сводки — как Транспорт:
 *  • лист верстается в ширине printable A4 portrait (не «видимость» экрана)
 *  • превью-оверлей + Печать / PDF
 *  • body.rp-printing: #root скрыт, в PDF только лист
 */

/** Printable A4 portrait content width @96dpi, margin 10mm (как printToPDF). */
const PAGE_W = 718;

function sumDays(
  days: string[],
  byDay: Record<string, ReportManualDay>,
  pick: (d: ReportManualDay | undefined) => number | null | undefined,
): number | null {
  let sum = 0;
  let any = false;
  for (const iso of days) {
    const v = pick(byDay[iso]);
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Пустое значение — пустая ячейка (без прочерка). */
function fmtN(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

type B1Row =
  | { kind: 'section'; title: string }
  | { kind: 'data'; label: string; unit: string; value: string };

function buildB1Rows(days: string[], byDay: Record<string, ReportManualDay>): B1Row[] {
  const refrSum = sumDays(days, byDay, (d) => {
    if (typeof d?.refr_9010 === 'number') return d.refr_9010;
    if (typeof d?.refr_9030 === 'number') return d.refr_9030;
    return null;
  });
  const liningSum = sumDays(days, byDay, (d) => {
    const t = d?.lining?.[0]?.tons;
    return typeof t === 'number' ? t : null;
  });
  const restowSum = sumDays(days, byDay, (d) => {
    const t = d?.restow?.[0]?.tons;
    return typeof t === 'number' ? t : null;
  });
  const raw: B1Row[] = [
    { kind: 'section', title: 'ОТЛ' },
    { kind: 'data', label: 'На больничном', unit: 'чел.', value: fmtN(sumDays(days, byDay, (d) => d?.sick)) },
    { kind: 'data', label: 'В отпуске', unit: 'чел.', value: fmtN(sumDays(days, byDay, (d) => d?.vacation)) },
    { kind: 'data', label: 'Технология', unit: 'т', value: fmtN(sumDays(days, byDay, (d) => d?.otl)) },
    { kind: 'data', label: 'Товарный двор', unit: 'конт.', value: fmtN(sumDays(days, byDay, (d) => d?.goods_yard)) },
    { kind: 'section', title: 'ДОК' },
    { kind: 'data', label: 'Реквизит деревянный', unit: 'рейс', value: fmtN(sumDays(days, byDay, (d) => d?.wood_prop)) },
    { kind: 'data', label: 'Щиты', unit: 'рейс', value: fmtN(sumDays(days, byDay, (d) => d?.shields)) },
    { kind: 'section', title: 'Огнеупоры 9010 и 9030' },
    { kind: 'data', label: 'В рамках общей технологии', unit: 'т', value: fmtN(refrSum) },
    { kind: 'data', label: 'Футеровка', unit: 'т', value: fmtN(liningSum) },
    { kind: 'data', label: 'Перескладировка', unit: 'т', value: fmtN(restowSum) },
  ];
  // Пустые показатели не выводим; заголовки секций (ОТЛ/ДОК/…) остаются.
  return raw.filter((r) => r.kind === 'section' || r.value !== '');
}

function shopWord(n: number): string {
  if (n === 1) return 'цех';
  if (n > 1 && n < 5) return 'цеха';
  return 'цехов';
}

/** Заголовок PDF: White без метки; Black — «· Black». */
export function reportPrintTitle(mode: ReportMode, daysTitle: string): string {
  const base = daysTitle ? `Сводка за ${daysTitle}` : 'Сводка';
  return mode === 'black' ? `${base} · Black` : base;
}

export function reportPdfFileName(mode: ReportMode, daysTitle: string): string {
  if (mode === 'black') {
    return `Сводка Black${daysTitle ? ` ${daysTitle}` : ''}`.slice(0, 80);
  }
  return `Сводка${daysTitle ? ` ${daysTitle}` : ''}`.slice(0, 80);
}

function SheetBody({
  mode,
  daysTitle,
  days,
  byDay,
  result,
  fleetGroups,
}: {
  mode: ReportMode;
  daysTitle: string;
  days: string[];
  byDay: Record<string, ReportManualDay>;
  result: ReportComputeResult;
  fleetGroups: ExpedGroup[];
}): JSX.Element {
  const rows = buildB1Rows(days, byDay);
  const notIn = result.notInScheduleShops;
  const off = result.offScheduleShops;
  const title = reportPrintTitle(mode, daysTitle);

  // tree уже: только невывезенные, алфавит
  const shops = result.tree;

  return (
    <div className="rp-print-sheet">
      <h1>{title}</h1>

      <h3>Блок 1</h3>
      {/* wrap: таблица не растягивается на ширину листа — только по содержимому */}
      <div className="rp-compact">
        <table className="rp-b1">
          <thead>
            <tr>
              <th>Показатель</th>
              <th>ЕИ</th>
              <th>Итого</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              r.kind === 'section' ? (
                /* Заголовок секции — только 1-я колонка, ЕИ/Итого пустые (не colspan). */
                <tr key={`s-${i}`} className="rp-sec">
                  <td className="rp-label">{r.title}</td>
                  <td className="rp-unit" />
                  <td className="rp-val" />
                </tr>
              ) : (
                <tr key={`d-${i}`}>
                  <td className="rp-label">{r.label}</td>
                  <td className="rp-unit">{r.unit}</td>
                  <td className="rp-val">{r.value}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* Блок 2 — сбор машин (если есть данные) */}
      {fleetGroups.length > 0 && (
        <>
          <h3>
            Блок 2 · ТС {countFleetVehicles(fleetGroups)} · Экспедиторы{' '}
            {countFleetExpeditors(fleetGroups)}
          </h3>
          <div className="rp-compact">
            <table className="rp-fleet">
              <tbody>
                {fleetGroups.map((g, i) => (
                  <tr key={`f-${g.garage || 'x'}-${i}`}>
                    <td className="rp-fleet-cell">
                      <div className="rp-fleet-l1">{fleetGroupLine1(g)}</div>
                      <div className="rp-fleet-ot">От: {g.frList || '—'}</div>
                      <div className="rp-fleet-sp">СП: {g.toList || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>Блок 3</h3>
      <p className="rp-line">
        По плану экспедиции вывезено <strong>{result.shipped}</strong> из{' '}
        <strong>{result.total}</strong> позиций — <strong>{result.percent}%</strong>
      </p>

      {notIn.length > 0 && (
        <>
          <p className="rp-line">
            Нет в графике: <strong>{notIn.length}</strong> {shopWord(notIn.length)}
          </p>
          <div className="rp-compact">
            <table className="rp-off">
              <tbody>
                {notIn.map((name, i) => (
                  <tr key={name}>
                    <td className="rp-off-n">{i + 1}.</td>
                    <td className="rp-off-name">{name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {off.length > 0 && (
        <>
          <p className="rp-line">
            Вне графика: <strong>{off.length}</strong> {shopWord(off.length)}
          </p>
          <div className="rp-compact">
            <table className="rp-off">
              <tbody>
                {off.map((name, i) => (
                  <tr key={name}>
                    <td className="rp-off-n">{i + 1}.</td>
                    <td className="rp-off-name">{name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="rp-h">Из невывезенных</p>
      {shops.length === 0 ? (
        <p className="rp-muted">
          {result.total === 0
            ? 'Нет зафиксированных позиций отчёта за выбранные дни.'
            : 'Все позиции вывезены — причин невывоза нет.'}
        </p>
      ) : (
        <div className="rp-compact">
          <table className="rp-shops">
            <thead>
              <tr>
                <th className="rp-n">№</th>
                <th>Цех</th>
                <th className="rp-cnt">поз.</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop, i) => (
                <Fragment key={shop.shop}>
                  <tr className="rp-shop-row">
                    <td className="rp-n">{i + 1}</td>
                    <td className="rp-shop-cell">{shop.shop}</td>
                    <td className="rp-cnt">
                      <strong>[{shop.count}]</strong>
                    </td>
                  </tr>
                  {shop.reasons.length > 0 && (
                    <tr className="rp-shop-detail">
                      <td />
                      <td colSpan={2}>
                        <ul className="rp-reason-list">
                          {shop.reasons.map((r) => (
                            <li key={r.label}>
                              <span className="rp-reason">
                                {r.label} <strong>[{r.count}]</strong>
                              </span>
                              {r.notes.length > 0 && (
                                <ul className="rp-note-list">
                                  {r.notes.map((n) => (
                                    <li key={n.note}>
                                      {n.note}
                                      {n.count > 1 ? <strong> ×{n.count}</strong> : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ReportPrint({
  mode,
  daysTitle,
  days,
  byDay,
  result,
  fleetGroups = [],
  onClose,
}: {
  mode: ReportMode;
  daysTitle: string;
  days: string[];
  byDay: Record<string, ReportManualDay>;
  result: ReportComputeResult;
  fleetGroups?: ExpedGroup[];
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const title = reportPrintTitle(mode, daysTitle);
  const fileName = reportPdfFileName(mode, daysTitle);

  const close = useCallback(() => {
    setBusy(false);
    document.body.classList.remove('rp-printing');
    onClose();
  }, [onClose]);

  // Esc всегда закрывает (даже если PDF/печать «зависла» в busy).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('rp-printing');
    };
  }, [close]);

  const run = useCallback(
    async (kind: 'dialog' | 'save') => {
      if (busy) return;
      setBusy(true);
      setMsg('');
      document.body.classList.add('rp-printing');
      try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 80));
        const pyn = window.pyn?.print;
        const opts = { landscape: false as const };
        if (pyn) {
          const res =
            kind === 'save' ? await pyn.savePdf(fileName, opts) : await pyn.dialog(fileName, opts);
          if (!res?.ok && res?.error) setMsg(`Печать: ${res.error}`);
          else if (kind === 'save' && res && 'path' in res && res.path) {
            setMsg(`Сохранено: ${String(res.path).split('/').pop()}`);
          } else if (kind === 'save' && res && 'canceled' in res && res.canceled) {
            setMsg('');
          }
        } else {
          window.print();
        }
      } catch (e) {
        setMsg(`Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
      } finally {
        document.body.classList.remove('rp-printing');
        setBusy(false);
      }
    },
    [busy, fileName],
  );

  return createPortal(
    <div className="rp-print-overlay">
      <style>{`
        .rp-print-overlay {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          padding: 12px; box-sizing: border-box;
        }
        .rp-print-frame {
          display: flex; flex-direction: column;
          width: min(780px, calc(100vw - 24px));
          height: min(92vh, calc(100vh - 24px));
          border-radius: 8px; overflow: hidden;
          background: #2a2926;
          box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        }
        .rp-print-toolbar {
          flex: 0 0 auto;
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
          padding: 10px 12px; color: #fff; font-size: 12px;
        }
        .rp-print-desk {
          flex: 1 1 auto; min-height: 0; overflow: auto;
          display: flex; justify-content: center; align-items: flex-start;
          padding: 16px; box-sizing: border-box;
          background: #3a3834;
        }
        .rp-print-paper {
          background: #fff;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          width: ${PAGE_W}px;
        }
        .rp-print-sheet {
          background: #fff;
          color: #111 !important;
          padding: 10px 12px;
          font-family: 'Inter Variable', system-ui, sans-serif;
          box-sizing: border-box;
          width: ${PAGE_W}px;
          font-size: 9.5px;
          line-height: 1.25;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .rp-print-sheet, .rp-print-sheet * {
          color: #111 !important;
        }
        .rp-print-sheet h1 {
          font-size: 14px; margin: 0 0 8px; color: #111 !important; font-weight: 700;
        }
        .rp-print-sheet h3 {
          font-size: 10px; margin: 10px 0 4px; color: #111 !important; font-weight: 700;
        }
        .rp-print-sheet h3:first-of-type { margin-top: 0; }
        /* Блок 2 — машины (две строки на машину) */
        .rp-print-sheet table.rp-fleet {
          font-size: 9.5px;
          color: #111;
          width: 100%;
        }
        .rp-print-sheet table.rp-fleet td.rp-fleet-cell {
          border: 0.5px solid #bbb;
          padding: 4px 6px;
          vertical-align: top;
          text-align: left;
        }
        .rp-print-sheet .rp-fleet-l1 {
          font-weight: 600;
          line-height: 1.25;
          color: #111;
          white-space: normal;
          word-break: break-word;
        }
        .rp-print-sheet .rp-fleet-ot,
        .rp-print-sheet .rp-fleet-sp {
          margin-top: 2px;
          font-size: 9px;
          color: #333;
          line-height: 1.25;
          white-space: normal;
          word-break: break-word;
        }
        /* Компактный wrap: table не может растянуться на ширину листа (Chromium print). */
        .rp-print-sheet .rp-compact {
          display: inline-block;
          width: max-content;
          max-width: 100%;
          vertical-align: top;
        }
        .rp-print-sheet .rp-compact table {
          width: max-content !important;
          max-width: 100%;
          border-collapse: collapse;
          table-layout: auto;
        }
        /* Блок 1 — колонки по тексту, ЕИ/Итого узкие */
        .rp-print-sheet table.rp-b1 {
          font-size: 9.5px;
          color: #111;
        }
        .rp-print-sheet table.rp-b1 th,
        .rp-print-sheet table.rp-b1 td {
          border: 0.5px solid #999;
          padding: 2px 6px;
          vertical-align: middle;
          line-height: 1.2;
          color: #111;
          white-space: nowrap;
          text-align: left;
        }
        .rp-print-sheet table.rp-b1 th {
          background: #EFEDE8;
          font-weight: 600;
          font-size: 9px;
        }
        .rp-print-sheet td.rp-label { text-align: left; }
        .rp-print-sheet th:nth-child(2),
        .rp-print-sheet td.rp-unit {
          text-align: left;
          color: #444;
          font-size: 9px;
          padding-left: 4px;
          padding-right: 4px;
        }
        .rp-print-sheet th:nth-child(3),
        .rp-print-sheet td.rp-val {
          text-align: left;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          padding-left: 4px;
          padding-right: 6px;
        }
        .rp-print-sheet tr.rp-sec td {
          background: #F5F3EF;
          border-top: 1px solid #888;
          padding: 3px 6px;
        }
        .rp-print-sheet tr.rp-sec td.rp-label {
          font-weight: 700;
          font-size: 9px;
          letter-spacing: 0.02em;
        }
        .rp-print-sheet tr.rp-sec td.rp-unit,
        .rp-print-sheet tr.rp-sec td.rp-val {
          font-weight: 400;
          background: #F5F3EF;
        }
        .rp-print-sheet .rp-line { margin: 0 0 3px; line-height: 1.3; color: #111; }
        .rp-print-sheet .rp-line strong { font-weight: 700; }
        /* Вне графика / нет в графике */
        .rp-print-sheet table.rp-off {
          margin: 0 0 8px;
          font-size: 9.5px;
          color: #111;
        }
        .rp-print-sheet table.rp-off td {
          border: none;
          padding: 0 6px 1px 0;
          vertical-align: top;
          line-height: 1.35;
          text-align: left;
          white-space: nowrap;
        }
        .rp-print-sheet table.rp-off .rp-off-n {
          text-align: center;
          vertical-align: middle;
          font-variant-numeric: tabular-nums;
          padding-right: 4px;
        }
        .rp-print-sheet .rp-h {
          margin: 6px 0 3px; font-weight: 700; font-size: 10px; color: #111;
        }
        .rp-print-sheet .rp-muted { color: #444; }
        /* Цеха невывезенные */
        .rp-print-sheet table.rp-shops {
          font-size: 9.5px;
          color: #111;
        }
        .rp-print-sheet table.rp-shops th,
        .rp-print-sheet table.rp-shops td {
          border: 0.5px solid #999;
          padding: 2px 6px;
          vertical-align: top;
          line-height: 1.25;
          color: #111;
          text-align: left;
        }
        .rp-print-sheet table.rp-shops th {
          background: #EFEDE8;
          font-weight: 600;
          font-size: 9px;
          white-space: nowrap;
        }
        .rp-print-sheet table.rp-shops .rp-n {
          text-align: center;
          vertical-align: middle;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .rp-print-sheet table.rp-shops th.rp-n { text-align: center; }
        .rp-print-sheet table.rp-shops .rp-cnt {
          text-align: left;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .rp-print-sheet table.rp-shops .rp-cnt strong { font-weight: 700; }
        .rp-print-sheet table.rp-shops .rp-shop-cell {
          white-space: nowrap;
          font-weight: 600;
        }
        .rp-print-sheet tr.rp-shop-detail td {
          background: #FAFAF8;
          border-top: none;
          padding-top: 1px;
          padding-bottom: 4px;
        }
        .rp-print-sheet .rp-reason-list {
          margin: 0; padding: 0 0 0 2px; list-style: none;
        }
        .rp-print-sheet .rp-reason { font-size: 9px; line-height: 1.25; font-weight: 400; }
        .rp-print-sheet .rp-reason strong { font-weight: 700; }
        .rp-print-sheet .rp-note-list {
          margin: 0.5px 0 2px 10px; padding: 0; list-style: none;
          font-size: 8.5px; color: #444;
        }
        .rp-print-sheet .rp-note-list strong { font-weight: 700; color: #111; }

        /* Тулбар прячем ТОЛЬКО на время генерации (body.rp-printing),
           не голым @media print — иначе media stuck = нельзя закрыть превью. */
        body.rp-printing .rp-noprint { display: none !important; }
        body.rp-printing .rp-print-desk { background: #fff !important; padding: 0 !important; }
        body.rp-printing .rp-print-paper {
          box-shadow: none !important;
          width: auto !important;
        }
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body.rp-printing #root { display: none !important; }
          body.rp-printing .rp-print-overlay {
            position: static; background: none; display: block; padding: 0;
          }
          body.rp-printing .rp-print-frame {
            width: auto; height: auto; border-radius: 0; overflow: visible;
            background: #fff; box-shadow: none;
          }
          body.rp-printing .rp-print-desk {
            display: block; overflow: visible; padding: 0; background: #fff;
          }
          body.rp-printing .rp-print-paper {
            width: auto !important; box-shadow: none !important;
          }
          body.rp-printing .rp-print-sheet {
            width: 100%; padding: 0;
            color: #111 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body.rp-printing .rp-print-sheet,
          body.rp-printing .rp-print-sheet * {
            color: #111 !important;
          }
          body.rp-printing .rp-print-sheet .rp-compact {
            display: inline-block !important;
            width: max-content !important;
            max-width: 100% !important;
          }
          body.rp-printing .rp-print-sheet .rp-compact table,
          body.rp-printing .rp-print-sheet table.rp-b1,
          body.rp-printing .rp-print-sheet table.rp-shops,
          body.rp-printing .rp-print-sheet table.rp-off {
            width: max-content !important;
            max-width: 100% !important;
          }
          body.rp-printing .rp-print-sheet table.rp-shops .rp-shop-cell {
            white-space: nowrap;
          }
        }
      `}</style>

      <div className="rp-print-frame">
        <div className="rp-print-toolbar rp-noprint">
          <span className="font-medium">Предпросмотр · {title}</span>
          {msg && (
            <span className="max-w-[240px] truncate text-white/70" title={msg}>
              {msg}
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
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
              className="flex h-7 items-center gap-1.5 rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Download size={13} strokeWidth={1.75} />
              PDF
            </button>
            <button
              type="button"
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/30 transition-colors hover:bg-white/10"
              title="Закрыть (Esc)"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </span>
        </div>

        <div className="rp-print-desk">
          <div className="rp-print-paper">
            <SheetBody
              mode={mode}
              daysTitle={daysTitle}
              days={days}
              byDay={byDay}
              result={result}
              fleetGroups={fleetGroups}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
