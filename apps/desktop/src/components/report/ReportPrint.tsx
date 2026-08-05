import { Fragment, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  formatShiftDays,
  type ReportComputeResult,
  type ReportManualDay,
  type ReportMode,
  type ReportShiftShop,
} from '@pyn/core';
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
  /** `phone` — рабочий номер участка, печатаем рядом с заголовком секции. */
  | { kind: 'section'; title: string; phone?: string }
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
    { kind: 'section', title: 'ДОК', phone: '49 66 97' },
    { kind: 'data', label: 'Реквизит деревянный', unit: 'рейс', value: fmtN(sumDays(days, byDay, (d) => d?.wood_prop)) },
    { kind: 'data', label: 'Щиты', unit: 'рейс', value: fmtN(sumDays(days, byDay, (d) => d?.shields)) },
    { kind: 'section', title: 'Огнеупоры 9010 и 9030', phone: '49 11 75' },
    { kind: 'data', label: 'В рамках общей технологии', unit: 'т', value: fmtN(refrSum) },
    { kind: 'data', label: 'Футеровка', unit: 'т', value: fmtN(liningSum) },
    { kind: 'data', label: 'Перескладировка', unit: 'т', value: fmtN(restowSum) },
  ];
  // Пустые показатели не выводим; заголовки секций (ОТЛ/ДОК/…) остаются.
  return raw.filter((r) => r.kind === 'section' || r.value !== '');
}

/** Подпись вместо процента, когда графика на день нет («не возим»). */
const NO_SCHEDULE_HINT = 'по графику доставок нет';

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
  unit,
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
  /** Единица счёта — та же, что выбрана на экране Сводки. */
  unit: 'pos' | 'kg';
}): JSX.Element {
  const rows = buildB1Rows(days, byDay);
  const notIn = result.notInScheduleShops;
  const off = result.offScheduleShops;
  const title = reportPrintTitle(mode, daysTitle, days.length);
  const shops = result.tree;
  // Шкала — по СВОЕМУ плану: она физически не может быть длиннее 100%, а цвет
  // должен говорить о выполнении плана, а не о перевыполнении чужими позициями.
  const barW = Math.min(100, Math.max(0, result.planPercent));
  const tone = pctToneClass(result.planPercent);
  const ni = result.notInStats;
  const of = result.offStats;
  /** Килограммы → тонны, как на экране. */
  const tons = (kg: number): string => (Math.round(kg / 100) / 10).toFixed(1);
  const t = result.tonnage;
  const shopPlanPct =
    planShops > 0 ? Math.round((result.shopCount / planShops) * 1000) / 10 : 0;
  const whPlanPct =
    planWarehouses > 0
      ? Math.round((result.warehouseCount / planWarehouses) * 1000) / 10
      : 0;

  /**
   * Карточка среза (печать) — один в один с экраном: крупно позиции, ниже
   * % от плана дня и охват цехов/складов. Проценты берём готовыми из среза:
   * там знаменатель — план ДНЯ. Раньше склады делились на график дня, и в одной
   * строке стояли два разных «от плана» (юзер 2026-08-04).
   *
   * Печатаем всегда, включая нули: «нет в графике 0» в отчёте — тоже ответ.
   */
  const sliceDetail = (
    label: string,
    s: typeof ni,
    toneCls = '',
    signed?: boolean,
    /** «Сверх плана»: цеха/склады не подмножество дня — вместо долей «новых». */
    growth?: { shops: number; warehouses: number },
  ): JSX.Element => (
    <div className={`rp-detail ${s.positions > 0 ? toneCls : ''}`}>
      <div className="rp-kpi-label">{label}</div>
      <div className="rp-detail-val">
        {unit === 'kg' ? tons(s.kg) : s.positions}
        <span className="rp-kpi-unit">{unit === 'kg' ? ' т' : ' поз.'}</span>
      </div>
      <div className="rp-kpi-meta">
        {`${signed && s.positions > 0 ? '+' : ''}${unit === 'kg' ? s.kgPct : s.positionPct}% от плана дня`}
        {unit === 'kg' && s.positions > 0 ? ` · ${s.positions} поз.` : ''}
        {growth
          ? ` · ${s.shops} ${shopWord(s.shops)} · ${s.warehouses} скл.` +
            (growth.shops === 0 && growth.warehouses === 0
              ? ' · новых нет'
              : ` · новых ${growth.shops} ${shopWord(growth.shops)} · ${growth.warehouses} скл.`)
          : ` · ${s.shops} ${shopWord(s.shops)} ${s.shopPct}% · ${s.warehouses} скл. ${s.warehousePct}%`}
      </div>
    </div>
  );

  /** Список цехов графика (Блок 1). Пустой — не печатаем, чтобы не мусорить листом. */
  const shopList = (
    title: string,
    names: readonly string[],
    lineCls: string,
  ): JSX.Element | null =>
    names.length === 0 ? null : (
      <>
        <p className={`rp-line ${lineCls}`}>
          {title}: <strong>{names.length}</strong> {shopWord(names.length)}
        </p>
        <div className="rp-compact">
          <table className="rp-off">
            <tbody>
              {names.map((name, i) => (
                <tr key={name}>
                  <td className="rp-off-n">{i + 1}.</td>
                  <td className="rp-off-name">{name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );

  /**
   * Цеха расхождения плана и факта — с датами, как дерево причин: цех, под ним
   * дни. `dayWord` подписывает, что за дата: у «сверх плана» это день ПЛАНА
   * («за какой день сверх»), у опережения и смещения — день ВЫВОЗА.
   */
  const shiftShopList = (
    title: string,
    rows: readonly ReportShiftShop[],
    dayWord: string,
    lineCls: string,
  ): JSX.Element | null =>
    rows.length === 0 ? null : (
      <>
        <p className={`rp-line ${lineCls}`}>
          {title}: <strong>{rows.length}</strong> {shopWord(rows.length)}
        </p>
        <div className="rp-compact">
          <table className="rp-off">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.shop}>
                  <td className="rp-off-n">{i + 1}.</td>
                  <td className="rp-off-name">
                    {r.shop} — {unit === 'kg' ? `${tons(r.kg)} т` : `${r.count} поз.`}
                    {r.isNew ? <span className="rp-shift-new">новый</span> : null}
                    <div className="rp-shift-days">
                      {dayWord} {formatShiftDays(r.days)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );

  return (
    <div className={`rp-print-sheet rp-mode-${mode}`}>
      <header className="rp-hero">
        <div className="rp-hero-top">
          <span className={`rp-badge rp-badge-${mode}`}>{mode === 'black' ? 'B' : 'W'}</span>
          <h1>{title}</h1>
        </div>
        <div className="rp-kpi-row">
          <div className={`rp-kpi ${tone}`}>
            <div className="rp-kpi-label">
              {unit === 'kg' ? 'Вывезено тоннажа' : 'Вывезено позиций'}
            </div>
            <div className="rp-kpi-val">
              {unit === 'kg' && t ? t.percent : result.percent}
              <span className="rp-kpi-unit">%</span>
            </div>
            <div className="rp-kpi-meta">
              {unit === 'kg' && t ? (
                <>
                  {tons(t.shippedKg)} из {tons(t.planKg)} т
                  {t.percent !== t.planPercent ? <> · свой план {t.planPercent}%</> : null}
                  {' · '}вес у {t.coveredRows} из {t.totalRows} поз. ({t.coveragePct}%)
                </>
              ) : (
                <>
                  {result.shipped} из {result.total}
                  {result.percent !== result.planPercent ? (
                    <> · свой план {result.planPercent}%</>
                  ) : null}
                </>
              )}
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
            {/* Нет графика на день → крупная цифра и так цеха; вместо её
                повтора пишем причину отсутствия процента. */}
            <div className="rp-kpi-meta">
              {planShops > 0 ? `${result.shopCount} из ${planShops}` : NO_SCHEDULE_HINT}
            </div>
          </div>
        </div>
        <div className="rp-detail-row">
          {sliceDetail('Нет в графике', ni, 'rp-tone-bad')}
          {sliceDetail('Вне графика', of, 'rp-tone-mid')}
          {/* Единственное место, где знаменатель — ГРАФИК дня. Дубль «нет в
              графике N · вне M» убран: он уже есть в двух карточках слева. */}
          <div className="rp-detail">
            <div className="rp-kpi-label">Охват графика</div>
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
                ? `${result.warehouseCount} из ${planWarehouses} скл. · ${
                    planShops > 0
                      ? `${result.shopCount} из ${planShops} ${shopWord(planShops)}`
                      : `${result.shopCount} ${shopWord(result.shopCount)}`
                  }`
                : `скл. в плане · ${result.shopCount} ${shopWord(result.shopCount)} · ${NO_SCHEDULE_HINT}`}
            </div>
          </div>
        </div>
        {/* План против факта — как на экране, всегда, включая нули. */}
        <div className="rp-detail-row">
          {sliceDetail('Сверх плана', result.overStats, '', true, {
            shops: result.overNewShops,
            warehouses: result.overNewWarehouses,
          })}
          {sliceDetail('Опережение плана', result.aheadStats)}
          {sliceDetail('Смещённый тайминг', result.shiftedStats, 'rp-tone-mid')}
        </div>
      </header>

      {/* Блок 1 — списки + причины (без дубля %/позиций) */}
      <section className="rp-sec-block">
        <h3>
          <span className="rp-sec-num">1</span>
          План экспедиции
        </h3>

        {shopList('Нет в графике', notIn, 'rp-warn')}
        {shopList('Вне графика', off, 'rp-accent')}
        {/* Расхождение плана и факта — поимённо, с датами. «Сверх плана» — только
            цеха, которых в плане дня не было (уже учтённые не дублируем). */}
        {shiftShopList('Сверх плана', result.overShops, 'план', 'rp-accent')}
        {shiftShopList('Опережение плана', result.aheadShops, 'увезено', 'rp-accent')}
        {shiftShopList('Смещённый тайминг', result.shiftedShops, 'увезено', 'rp-accent')}

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
                        <strong>[{unit === 'kg' ? `${tons(shop.kg)} т` : shop.count}]</strong>
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
                                  {r.label}{' '}
                                  <strong>[{unit === 'kg' ? `${tons(r.kg)} т` : r.count}]</strong>
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
                      <td className="rp-label">
                        <span className="rp-sec-head">
                          <span>{r.title}</span>
                          {r.phone ? <span className="rp-sec-phone">{r.phone}</span> : null}
                        </span>
                      </td>
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
  includeFleet,
  /** Без превью: сразу dialog (печать) или save (PDF) и unmount. Как Транспорт. */
  autoMode,
  onDone,
  unit = 'pos',
}: {
  mode: ReportMode;
  /** Единица счёта — та же, что выбрана на экране Сводки (позиции / тонны). */
  unit?: 'pos' | 'kg';
  daysTitle: string;
  days: string[];
  byDay: Record<string, ReportManualDay>;
  result: ReportComputeResult;
  fleetGroups?: ExpedGroup[];
  planShops?: number;
  planWarehouses?: number;
  fleetPeople?: { expeditors: number; driverExpeditors: number; others: number };
  includeFleet: boolean;
  autoMode: 'dialog' | 'save';
  onDone: (msg: string) => void;
}): JSX.Element {
  const fileName = reportPdfFileName(mode, daysTitle);
  const autoStarted = useRef(false);
  // onDone — свежая инлайн-функция у родителя на каждый его ре-рендер (WS-пуши
  // идут постоянно). Раньше была в deps эффекта — ре-рендер родителя внутри
  // ~200мс паузы гонял cleanup (cancelled=true) ДО вызова pyn.print.*, печать
  // тихо не запускалась (юзер 2026-08-02: «нажимаю печать — ничего не
  // происходит»). Через ref эффект не зависит от её идентичности.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    document.body.classList.add('rp-printing');
    let cancelled = false;
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 120));
      let out = '';
      if (!cancelled) {
        try {
          const pyn = window.pyn?.print;
          const opts = { landscape: false as const };
          if (pyn) {
            const res =
              autoMode === 'save' ? await pyn.savePdf(fileName, opts) : await pyn.dialog(fileName, opts);
            if (!res?.ok && res?.error) out = `Печать: ${res.error}`;
            else if (autoMode === 'save' && res && 'path' in res && res.path) {
              out = `PDF: ${String(res.path).split('/').pop()}`;
            } else if (autoMode === 'dialog') {
              out = 'Печать';
            }
          } else {
            window.print();
            out = autoMode === 'save' ? 'PDF' : 'Печать';
          }
        } catch (e) {
          out = `Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`;
        }
      }
      document.body.classList.remove('rp-printing');
      if (!cancelled) onDoneRef.current(out);
    })();
    return () => {
      cancelled = true;
      document.body.classList.remove('rp-printing');
    };
  }, [autoMode, fileName]);

  return createPortal(
    <div className="rp-print-overlay">
      <style>{`
        /* Silent: лист вне экрана, без UI — только paint для printToPDF.
           Offscreen через position/left (не opacity) — под печатью position:static
           сам возвращает лист в поток, без риска забыть сбросить прозрачность. */
        .rp-print-overlay {
          position: fixed; left: -10000px; top: 0;
          width: ${PAGE_W}px; height: auto;
          pointer-events: none;
          background: #fff;
        }
        .rp-print-paper {
          background: #fff;
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
        /* Заголовок секции: название слева, рабочий номер прижат к правому краю
           колонки «Показатель» — номера секций встают друг под друга и никогда
           не заходят на «ЕИ» (юзер 2026-08-04). */
        .rp-print-sheet .rp-sec-head {
          display: flex;
          width: 100%;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        /* Номер тем же кеглем и чернотой: по нему звонят каждый день. */
        .rp-print-sheet .rp-sec-phone {
          color: var(--rp-ink);
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* Метка «цех добавился к дню» — рядом с названием, но тише. */
        .rp-print-sheet .rp-shift-new {
          margin-left: 6px;
          font-size: 8px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--rp-muted);
        }
        /* Даты расхождения под цехом — как примечание под причиной. */
        .rp-print-sheet .rp-shift-days {
          margin-top: 1px;
          padding-left: 8px;
          font-size: 8.5px;
          color: var(--rp-muted);
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

        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          /* Печатаем ТОЛЬКО свой лист: любой другой прямой ребёнок body
             (#root, портал Транспорта, тосты) скрыт — иначе в один PDF
             попадали и сводка, и разнарядка (юзер 2026-08-02). */
          body.rp-printing > *:not(.rp-print-overlay) { display: none !important; }
          body.rp-printing .rp-print-overlay {
            position: static; left: auto; top: auto; width: auto; height: auto;
          }
          body.rp-printing .rp-print-paper { width: auto !important; }
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
          unit={unit}
        />
      </div>
    </div>,
    document.body,
  );
}
