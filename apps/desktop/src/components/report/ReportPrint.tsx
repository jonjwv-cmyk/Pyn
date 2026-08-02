import { Fragment, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import type { ReportComputeResult, ReportManualDay, ReportMode } from '@pyn/core';
import { cn } from '@/lib/cn';
import {
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

/**
 * Заголовок PDF/превью: только период · N дн.
 * Пример: «июль 27-30 · 4 дн.» — без White/Black в тексте.
 */
export function reportPrintTitle(_mode: ReportMode, daysTitle: string, dayCount = 0): string {
  if (!daysTitle) return 'Сводка';
  if (dayCount <= 0) return daysTitle;
  if (dayCount === 1) return `${daysTitle} · 1 день`;
  return `${daysTitle} · дней ${dayCount}`;
}

export function reportPdfFileName(mode: ReportMode, daysTitle: string): string {
  if (mode === 'black') {
    return `Сводка Black${daysTitle ? ` ${daysTitle}` : ''}`.slice(0, 80);
  }
  return `Сводка${daysTitle ? ` ${daysTitle}` : ''}`.slice(0, 80);
}

function pctToneClass(p: number): string {
  if (p >= 90) return 'rp-tone-ok';
  if (p >= 60) return 'rp-tone-mid';
  return 'rp-tone-bad';
}

function pctPrint(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function SheetBody({
  mode,
  daysTitle,
  days,
  byDay,
  result,
  fleetGroups,
  includeFleet,
  planShops,
  planWarehouses,
  fleetPeople,
}: {
  mode: ReportMode;
  daysTitle: string;
  days: string[];
  byDay: Record<string, ReportManualDay>;
  result: ReportComputeResult;
  fleetGroups: ExpedGroup[];
  includeFleet: boolean;
  planShops: number;
  planWarehouses: number;
  fleetPeople: { expeditors: number; driverExpeditors: number; others: number };
}): JSX.Element {
  const rows = buildB1Rows(days, byDay);
  const notIn = result.notInScheduleShops;
  const off = result.offScheduleShops;
  const title = reportPrintTitle(mode, daysTitle, days.length);
  const shops = result.tree;
  const barW = Math.min(100, Math.max(0, result.percent));
  const tone = pctToneClass(result.percent);
  const ni = result.notInStats;
  const of = result.offStats;
  const planPos = result.total;
  const shopPlanPct =
    planShops > 0 ? Math.round((result.shopCount / planShops) * 1000) / 10 : 0;
  const whPlanPct =
    planWarehouses > 0
      ? Math.round((result.warehouseCount / planWarehouses) * 1000) / 10
      : 0;

  const sliceMetaPlan = (s: typeof ni): string => {
    const pPct = pctPrint(s.positions, planPos);
    const wPct = pctPrint(s.warehouses, planWarehouses);
    const pos =
      planPos > 0
        ? `${s.positions} поз. ${pPct}% от плана`
        : `${s.positions} поз.`;
    const wh =
      planWarehouses > 0
        ? `${s.warehouses} скл. ${wPct}% от плана`
        : `${s.warehouses} скл.`;
    return `${pos} · ${wh}`;
  };

  return (
    <div className={`rp-print-sheet rp-mode-${mode}`}>
      <header className="rp-hero">
        <div className="rp-hero-top">
          <span className={`rp-badge rp-badge-${mode}`}>{mode === 'black' ? 'B' : 'W'}</span>
          <h1>{title}</h1>
        </div>
        <div className="rp-kpi-row">
          <div className={`rp-kpi ${tone}`}>
            <div className="rp-kpi-label">Вывезено позиций</div>
            <div className="rp-kpi-val">
              {result.percent}
              <span className="rp-kpi-unit">%</span>
            </div>
            <div className="rp-kpi-meta">
              {result.shipped} из {result.total}
            </div>
            <div className="rp-kpi-bar">
              <div className="rp-kpi-bar-fill" style={{ width: `${barW}%` }} />
            </div>
          </div>
          <div className="rp-kpi">
            <div className="rp-kpi-label">Цеха всего</div>
            <div className="rp-kpi-val">
              {planShops > 0 ? (
                <>
                  {shopPlanPct}
                  <span className="rp-kpi-unit">%</span>
                </>
              ) : (
                result.shopCount
              )}
            </div>
            <div className="rp-kpi-meta">
              {planShops > 0
                ? `${result.shopCount} из ${planShops}`
                : `${result.shopCount}`}
            </div>
          </div>
        </div>
        <div className="rp-detail-row">
          <div className={`rp-detail ${ni.shops > 0 ? 'rp-tone-bad' : ''}`}>
            <div className="rp-kpi-label">Нет в графике</div>
            <div className="rp-detail-val">
              {ni.shops}
              <span className="rp-kpi-unit"> {shopWord(ni.shops)}</span>
            </div>
            <div className="rp-kpi-meta">{sliceMetaPlan(ni)}</div>
          </div>
          <div className={`rp-detail ${of.shops > 0 ? 'rp-tone-mid' : ''}`}>
            <div className="rp-kpi-label">Вне графика</div>
            <div className="rp-detail-val">
              {of.shops}
              <span className="rp-kpi-unit"> {shopWord(of.shops)}</span>
            </div>
            <div className="rp-kpi-meta">{sliceMetaPlan(of)}</div>
          </div>
          <div className="rp-detail">
            <div className="rp-kpi-label">Склады</div>
            <div className="rp-detail-val">
              {planWarehouses > 0 ? (
                <>
                  {whPlanPct}
                  <span className="rp-kpi-unit">%</span>
                </>
              ) : (
                result.warehouseCount
              )}
            </div>
            <div className="rp-kpi-meta">
              {planWarehouses > 0
                ? `${result.warehouseCount} из ${planWarehouses}`
                : `${result.warehouseCount}`}
              {' · '}
              нет в графике {ni.warehouses}
              {planWarehouses > 0 ? ` (${pctPrint(ni.warehouses, planWarehouses)}%)` : ''}
              {' · '}
              вне {of.warehouses}
              {planWarehouses > 0 ? ` (${pctPrint(of.warehouses, planWarehouses)}%)` : ''}
            </div>
          </div>
        </div>
      </header>

      {/* Блок 1 — списки + причины (без дубля %/позиций) */}
      <section className="rp-sec-block">
        <h3>
          <span className="rp-sec-num">1</span>
          План экспедиции
        </h3>

        {notIn.length > 0 && (
          <>
            <p className="rp-line rp-warn">
              Нет в графике: <strong>{notIn.length}</strong> {shopWord(notIn.length)}
              <span className="rp-muted"> · {sliceMetaPlan(ni)}</span>
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
            <p className="rp-line rp-accent">
              Вне графика: <strong>{off.length}</strong> {shopWord(off.length)}
              <span className="rp-muted"> · {sliceMetaPlan(of)}</span>
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
      </section>

      {rows.length > 0 && (
        <section className="rp-sec-block">
          <h3>
            <span className="rp-sec-num">2</span>
            Блок 2
          </h3>
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
        </section>
      )}

      {includeFleet && fleetGroups.length > 0 && (
        <section className="rp-sec-block">
          <h3>
            <span className="rp-sec-num">3</span>
            Блок 3 · ТС {countFleetVehicles(fleetGroups)} · Экспедиторы{' '}
            {fleetPeople.expeditors}
            {fleetPeople.driverExpeditors > 0
              ? ` · Водители-экспедиторы ${fleetPeople.driverExpeditors}`
              : ''}
            {fleetPeople.others > 0 ? ` · Иные ${fleetPeople.others}` : ''}
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
        </section>
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
  planShops = 0,
  planWarehouses = 0,
  fleetPeople = { expeditors: 0, driverExpeditors: 0, others: 0 },
  onClose,
}: {
  mode: ReportMode;
  daysTitle: string;
  days: string[];
  byDay: Record<string, ReportManualDay>;
  result: ReportComputeResult;
  fleetGroups?: ExpedGroup[];
  planShops?: number;
  planWarehouses?: number;
  fleetPeople?: { expeditors: number; driverExpeditors: number; others: number };
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /** Превью и PDF по умолчанию без Блока 3. */
  const [includeFleet, setIncludeFleet] = useState(false);
  /** Спросить про Блок 3 перед печатью/PDF. */
  const [fleetAsk, setFleetAsk] = useState<'dialog' | 'save' | null>(null);
  /**
   * После выбора «с/без блока 3» — job на следующий paint (includeFleet уже в DOM).
   */
  const [printJob, setPrintJob] = useState<'dialog' | 'save' | null>(null);
  const title = reportPrintTitle(mode, daysTitle, days.length);
  const fileName = reportPdfFileName(mode, daysTitle);
  const hasFleet = fleetGroups.length > 0;

  const close = useCallback(() => {
    setBusy(false);
    setFleetAsk(null);
    setPrintJob(null);
    document.body.classList.remove('rp-printing');
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (fleetAsk) {
          setFleetAsk(null);
          return;
        }
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('rp-printing');
    };
  }, [close, fleetAsk]);

  // printJob выставляется только после setIncludeFleet → React commit → SheetBody актуален.
  useEffect(() => {
    if (!printJob) return;
    let cancelled = false;
    setBusy(true);
    setMsg('');
    document.body.classList.add('rp-printing');
    void (async () => {
      try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 80));
        if (cancelled) return;
        const pyn = window.pyn?.print;
        const opts = { landscape: false as const };
        if (pyn) {
          const res =
            printJob === 'save'
              ? await pyn.savePdf(fileName, opts)
              : await pyn.dialog(fileName, opts);
          if (cancelled) return;
          if (!res?.ok && res?.error) setMsg(`Печать: ${res.error}`);
          else if (printJob === 'save' && res && 'path' in res && res.path) {
            setMsg(`Сохранено: ${String(res.path).split('/').pop()}`);
          } else if (printJob === 'save' && res && 'canceled' in res && res.canceled) {
            setMsg('');
          }
        } else {
          window.print();
        }
      } catch (e) {
        if (!cancelled) {
          setMsg(`Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
        }
      } finally {
        if (!cancelled) {
          document.body.classList.remove('rp-printing');
          setBusy(false);
          setPrintJob(null);
          setIncludeFleet(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [printJob, fileName]);

  const startPrint = useCallback(
    (kind: 'dialog' | 'save', withFleet: boolean) => {
      if (busy || printJob) return;
      setFleetAsk(null);
      setIncludeFleet(withFleet);
      setPrintJob(kind);
    },
    [busy, printJob],
  );

  const requestRun = useCallback(
    (kind: 'dialog' | 'save') => {
      if (busy || printJob) return;
      if (hasFleet) {
        setFleetAsk(kind);
        return;
      }
      startPrint(kind, false);
    },
    [busy, printJob, hasFleet, startPrint],
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
          --rp-ink: #1a1917;
          --rp-muted: #5c5954;
          --rp-faint: #8a8680;
          --rp-border: #e5e0d8;
          --rp-soft: #faf8f5;
          --rp-clay: #c45c3e;
          --rp-clay-soft: #f3e4dc;
          --rp-ok: #2f7a3e;
          --rp-ok-bg: #e8f5ea;
          --rp-mid: #b45309;
          --rp-mid-bg: #fef3c7;
          --rp-bad: #b42318;
          --rp-bad-bg: #fee4e2;
          background: #ffffff;
          color: var(--rp-ink);
          padding: 14px 14px 16px;
          font-family: 'Inter Variable', system-ui, sans-serif;
          box-sizing: border-box;
          width: ${PAGE_W}px;
          font-size: 9.5px;
          line-height: 1.3;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        /* Светлая инфографика (GitHub density) на белом */
        .rp-print-sheet .rp-hero {
          background: #fff;
          color: var(--rp-ink);
          padding: 0 0 12px;
          margin: 0 0 12px;
          border-bottom: 1px solid var(--rp-border);
        }
        .rp-print-sheet .rp-hero-top {
          display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
        }
        .rp-print-sheet .rp-badge {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          font-size: 9px; font-weight: 800; letter-spacing: 0.02em;
          text-transform: uppercase; border-radius: 5px;
        }
        .rp-print-sheet .rp-badge-white {
          background: #fde68a; color: #78350f;
        }
        .rp-print-sheet .rp-badge-black {
          background: #e2e8f0; color: #1e293b;
        }
        .rp-print-sheet h1 {
          font-size: 16px; margin: 0; color: var(--rp-ink); font-weight: 700;
          letter-spacing: -0.02em; text-transform: capitalize;
        }
        .rp-print-sheet .rp-kpi-row {
          display: flex; gap: 8px;
        }
        .rp-print-sheet .rp-detail-row {
          display: flex; gap: 8px; margin-top: 8px;
        }
        .rp-print-sheet .rp-detail {
          flex: 1; min-width: 0;
          background: var(--rp-soft);
          border: 1px solid var(--rp-border);
          border-radius: 10px;
          padding: 8px 10px 9px;
        }
        .rp-print-sheet .rp-detail-val {
          font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
          color: var(--rp-ink); line-height: 1.1;
        }
        .rp-print-sheet .rp-detail.rp-tone-bad .rp-detail-val { color: var(--rp-bad); }
        .rp-print-sheet .rp-detail.rp-tone-mid .rp-detail-val { color: var(--rp-mid); }
        .rp-print-sheet .rp-kpi {
          flex: 1; min-width: 0;
          background: var(--rp-soft);
          border: 1px solid var(--rp-border);
          border-radius: 10px;
          padding: 9px 10px 10px;
        }
        .rp-print-sheet .rp-kpi-label {
          font-size: 8px; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--rp-faint);
          margin-bottom: 4px;
        }
        .rp-print-sheet .rp-kpi-val {
          font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;
          color: var(--rp-ink); line-height: 1.05;
        }
        .rp-print-sheet .rp-kpi-unit {
          font-size: 12px; font-weight: 600; color: var(--rp-muted);
        }
        .rp-print-sheet .rp-kpi-meta {
          margin-top: 3px; font-size: 8.5px; color: var(--rp-muted);
          font-variant-numeric: tabular-nums;
        }
        .rp-print-sheet .rp-kpi-bar {
          margin-top: 7px; height: 5px; border-radius: 99px;
          background: #ebe6df; overflow: hidden;
        }
        .rp-print-sheet .rp-kpi-bar-fill {
          height: 100%; border-radius: 99px; background: var(--rp-clay);
        }
        .rp-print-sheet .rp-kpi.rp-tone-ok .rp-kpi-val { color: var(--rp-ok); }
        .rp-print-sheet .rp-kpi.rp-tone-ok .rp-kpi-bar-fill { background: #3d9b50; }
        .rp-print-sheet .rp-kpi.rp-tone-ok { background: var(--rp-ok-bg); border-color: #c6e6cc; }
        .rp-print-sheet .rp-kpi.rp-tone-mid .rp-kpi-val { color: var(--rp-mid); }
        .rp-print-sheet .rp-kpi.rp-tone-mid .rp-kpi-bar-fill { background: #d97706; }
        .rp-print-sheet .rp-kpi.rp-tone-mid { background: var(--rp-mid-bg); border-color: #fde68a; }
        .rp-print-sheet .rp-kpi.rp-tone-bad .rp-kpi-val { color: var(--rp-bad); }
        .rp-print-sheet .rp-kpi.rp-tone-bad .rp-kpi-bar-fill { background: #e11d48; }
        .rp-print-sheet .rp-kpi.rp-tone-bad { background: var(--rp-bad-bg); border-color: #fecdd3; }

        .rp-print-sheet .rp-sec-block {
          padding: 0; margin: 0 0 14px;
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .rp-print-sheet h3 {
          display: flex; align-items: center; gap: 7px;
          font-size: 11px; margin: 0 0 7px; color: var(--rp-ink); font-weight: 700;
          letter-spacing: -0.01em;
        }
        .rp-print-sheet .rp-sec-num {
          display: inline-flex; align-items: center; justify-content: center;
          width: 16px; height: 16px; border-radius: 5px;
          background: var(--rp-clay); color: #fff;
          font-size: 9px; font-weight: 800; flex-shrink: 0;
        }
        .rp-print-sheet table.rp-fleet {
          font-size: 9.5px; color: var(--rp-ink); width: 100%;
        }
        .rp-print-sheet table.rp-fleet td.rp-fleet-cell {
          border: 0.5px solid var(--rp-border);
          border-left: 3px solid var(--rp-clay);
          padding: 5px 7px; vertical-align: top; text-align: left;
          background: var(--rp-soft);
        }
        .rp-print-sheet .rp-fleet-l1 {
          font-weight: 600; line-height: 1.25; color: var(--rp-ink);
          white-space: normal; word-break: break-word;
        }
        .rp-print-sheet .rp-fleet-ot,
        .rp-print-sheet .rp-fleet-sp {
          margin-top: 2px; font-size: 9px; color: var(--rp-muted);
          line-height: 1.25; white-space: normal; word-break: break-word;
        }
        .rp-print-sheet .rp-compact {
          display: inline-block; width: max-content; max-width: 100%; vertical-align: top;
        }
        .rp-print-sheet .rp-compact table {
          width: max-content !important; max-width: 100%;
          border-collapse: collapse; table-layout: auto;
        }
        .rp-print-sheet table.rp-b1 { font-size: 9.5px; color: var(--rp-ink); }
        .rp-print-sheet table.rp-b1 th,
        .rp-print-sheet table.rp-b1 td {
          border: 0.5px solid var(--rp-border); padding: 2px 6px;
          vertical-align: middle; line-height: 1.2; color: var(--rp-ink);
          white-space: nowrap; text-align: left;
        }
        .rp-print-sheet table.rp-b1 th {
          background: var(--rp-clay-soft); color: #7a3b28;
          font-weight: 700; font-size: 9px;
        }
        .rp-print-sheet td.rp-label { text-align: left; }
        .rp-print-sheet th:nth-child(2),
        .rp-print-sheet td.rp-unit {
          text-align: left; color: var(--rp-muted); font-size: 9px;
          padding-left: 4px; padding-right: 4px;
        }
        .rp-print-sheet th:nth-child(3),
        .rp-print-sheet td.rp-val {
          text-align: left; font-variant-numeric: tabular-nums;
          font-weight: 700; color: var(--rp-clay);
          padding-left: 4px; padding-right: 6px;
        }
        .rp-print-sheet tr.rp-sec td {
          background: #efe8e2; border-top: 1px solid #c9b8ac; padding: 3px 6px;
        }
        .rp-print-sheet tr.rp-sec td.rp-label {
          font-weight: 700; font-size: 9px; letter-spacing: 0.04em;
          color: #7a3b28; text-transform: uppercase;
        }
        .rp-print-sheet tr.rp-sec td.rp-unit,
        .rp-print-sheet tr.rp-sec td.rp-val {
          font-weight: 400; background: #efe8e2;
        }
        .rp-print-sheet .rp-line { margin: 0 0 4px; line-height: 1.35; color: var(--rp-ink); }
        .rp-print-sheet .rp-line strong { font-weight: 700; }
        .rp-print-sheet .rp-line.rp-warn strong { color: var(--rp-bad); }
        .rp-print-sheet .rp-line.rp-accent strong { color: var(--rp-mid); }
        .rp-print-sheet .rp-tone-ok { color: var(--rp-ok) !important; }
        .rp-print-sheet .rp-tone-mid { color: var(--rp-mid) !important; }
        .rp-print-sheet .rp-tone-bad { color: var(--rp-bad) !important; }
        .rp-print-sheet table.rp-off {
          margin: 0 0 8px; font-size: 9.5px; color: var(--rp-ink);
        }
        .rp-print-sheet table.rp-off td {
          border: none; padding: 0 6px 1px 0; vertical-align: top;
          line-height: 1.35; text-align: left; white-space: nowrap;
        }
        .rp-print-sheet table.rp-off .rp-off-n {
          text-align: center; vertical-align: middle;
          font-variant-numeric: tabular-nums; padding-right: 4px; color: var(--rp-faint);
        }
        .rp-print-sheet table.rp-off .rp-off-name {
          white-space: normal !important;
          word-break: break-word;
          overflow-wrap: anywhere;
          max-width: 420px;
        }
        .rp-print-sheet .rp-h {
          margin: 8px 0 4px; font-weight: 700; font-size: 10px; color: var(--rp-ink);
        }
        .rp-print-sheet .rp-muted { color: var(--rp-muted); }
        .rp-print-sheet table.rp-shops { font-size: 9.5px; color: var(--rp-ink); }
        .rp-print-sheet table.rp-shops th,
        .rp-print-sheet table.rp-shops td {
          border: 0.5px solid var(--rp-border); padding: 2px 6px;
          vertical-align: top; line-height: 1.25; color: var(--rp-ink); text-align: left;
        }
        .rp-print-sheet table.rp-shops th {
          background: var(--rp-clay-soft); color: #7a3b28;
          font-weight: 700; font-size: 9px; white-space: nowrap;
        }
        .rp-print-sheet table.rp-shops .rp-n {
          text-align: center; vertical-align: middle;
          font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--rp-faint);
        }
        .rp-print-sheet table.rp-shops th.rp-n { text-align: center; color: #7a3b28; }
        .rp-print-sheet table.rp-shops .rp-cnt {
          text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .rp-print-sheet table.rp-shops .rp-cnt strong {
          font-weight: 700; color: var(--rp-clay);
        }
        .rp-print-sheet table.rp-shops .rp-shop-cell {
          white-space: normal; word-break: break-word; overflow-wrap: anywhere;
          font-weight: 600; max-width: 380px;
        }
        .rp-print-sheet tr.rp-shop-detail td {
          background: var(--rp-soft); border-top: none;
          padding-top: 1px; padding-bottom: 4px;
        }
        .rp-print-sheet .rp-reason-list {
          margin: 0; padding: 0 0 0 2px; list-style: none;
        }
        .rp-print-sheet .rp-reason { font-size: 9px; line-height: 1.25; font-weight: 400; }
        .rp-print-sheet .rp-reason strong { font-weight: 700; color: var(--rp-clay); }
        .rp-print-sheet .rp-note-list {
          margin: 0.5px 0 2px 10px; padding: 0; list-style: none;
          font-size: 8.5px; color: var(--rp-muted);
        }
        .rp-print-sheet .rp-note-list strong { font-weight: 700; color: var(--rp-ink); }

        body.rp-printing .rp-noprint { display: none !important; }
        body.rp-printing .rp-print-desk { background: #fff !important; padding: 0 !important; }
        body.rp-printing .rp-print-paper {
          box-shadow: none !important; width: auto !important;
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
            width: 100%; padding: 0 0 12px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body.rp-printing .rp-print-sheet .rp-compact {
            display: inline-block !important;
            width: max-content !important; max-width: 100% !important;
          }
          body.rp-printing .rp-print-sheet .rp-compact table,
          body.rp-printing .rp-print-sheet table.rp-b1,
          body.rp-printing .rp-print-sheet table.rp-shops,
          body.rp-printing .rp-print-sheet table.rp-off {
            width: max-content !important; max-width: 100% !important;
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
              onClick={() => requestRun('dialog')}
              className="flex h-7 items-center gap-1.5 rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Printer size={13} strokeWidth={1.75} />
              Печать
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => requestRun('save')}
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

        {fleetAsk && (
          <div className="rp-noprint flex flex-wrap items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white">
            <span className="min-w-0 flex-1">
              Включить Блок 3 (ТС и экспедиторы)?
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => startPrint(fleetAsk, false)}
              className="h-7 rounded-md border border-white/30 px-2.5 hover:bg-white/10 disabled:opacity-50"
            >
              Без блока 3
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => startPrint(fleetAsk, true)}
              className="h-7 rounded-md border border-accent-clay/50 bg-accent-clay/20 px-2.5 text-accent-clay hover:bg-accent-clay/30 disabled:opacity-50"
            >
              С блоком 3
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setFleetAsk(null)}
              className="h-7 rounded-md border border-white/20 px-2 text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              Отмена
            </button>
          </div>
        )}

        <div className="rp-print-desk">
          <div className="rp-print-paper">
            <SheetBody
              mode={mode}
              daysTitle={daysTitle}
              days={days}
              byDay={byDay}
              result={result}
              fleetGroups={fleetGroups}
              includeFleet={includeFleet}
              planShops={planShops}
              planWarehouses={planWarehouses}
              fleetPeople={fleetPeople}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
