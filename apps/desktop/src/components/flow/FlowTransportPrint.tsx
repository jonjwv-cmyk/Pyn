import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  isPrintGrayStatus,
  printStatusGroup,
} from './FlowTransportGrid';
import {
  isDokRow,
  isOkalinaRow,
  shouldPrintTransportRow,
  shouldShowTimeBold,
  workMajorPrefix,
} from './flow-transport-shift';
import type { FlowDriverOption } from './flow-driver-cell';

/**
 * Печать «как Google Sheets»:
 *
 * 1. Контент ВСЕГДА верстается в ширине печатного листа A4 landscape
 *    (не в ширине окна превью) — иначе переносы/высота/пунктир ≠ PDF.
 * 2. По умолчанию scale=100%: страницы режет Chromium сам.
 * 3. «Вписать на 1» = CSS zoom = pageH/contentH (layout реально сжимается → 1 PDF-стр.).
 * 4. Экранный viewScale (transform) только уменьшает превью, в PDF не идёт.
 * 5. Пунктир — offsetTop строк в print-px (без getBoundingClientRect×scale).
 */

/** Printable A4 landscape @96dpi, margin 10mm (как printToPDF 0.3937"). */
const PAGE_W = 1047;
const PAGE_H = 718;

/** Реальное фактическое время: непустое и не «0:00»/«00:00» (1С-заглушка). */
function hasRealFactTime(t: string | undefined | null): boolean {
  const s = (t || '').trim();
  if (!s) return false;
  return !/^0{1,2}:00$/.test(s);
}

/** Факта нет вообще (обе колонки пустые или нулевые) — строку красим серым,
 *  даже если статус «Размещен» (юзер 2026-08-02: «время ноль» и «факта нет»). */
function noFactTime(r: FlowTransportRow): boolean {
  return !hasRealFactTime(r.fact_start) && !hasRealFactTime(r.fact_end);
}

/**
 * Границы блока ДОК/ОГНЕУПОРЫ/ОКАЛИНА (работы 6/7/8) — РОВНО две жирные линии на
 * день: сверху первой строки блока и снизу последней. Блок 7 печатается всегда,
 * поэтому линий всегда две; ДОК/ОКАЛИНА лишь расширяют тот же блок, своих линий
 * не добавляют (юзер 2026-08-02: «если из трёх блоков хоть один есть — отделяем,
 * их всегда будет две»).
 *
 * ⚠️ Считаем по дню целиком, а НЕ по соседям (prev/next): сортировка печати —
 * (дата, статус-группа, работа), поэтому по соседям выходило до 4 линий.
 * ⚠️ Учитываем только основную статус-группу: «красные» статусы (Отклонён/Отмена/…)
 * идут отдельным серым блоком сверху и уже отделены своей линией — их работы 6+
 * не должны утаскивать верхнюю границу в начало дня.
 */
function computeClusterEdges(rows: FlowTransportRow[]): { top: Set<number>; bottom: Set<number> } {
  const firstByDay = new Map<string, number>();
  const lastByDay = new Map<string, number>();
  rows.forEach((r, i) => {
    if (printStatusGroup(r.status) !== 1) return;
    if (!workIsSixPlus(r.work)) return;
    const d = r.tdate || '';
    if (!firstByDay.has(d)) firstByDay.set(d, i);
    lastByDay.set(d, i);
  });
  const bottom = new Set<number>();
  for (const i of lastByDay.values()) {
    // Последнюю строку ВСЕЙ таблицы не подчёркиваем: там уже край таблицы, и
    // выходила третья лишняя линия (юзер 2026-08-02).
    if (i < rows.length - 1) bottom.add(i);
  }
  return { top: new Set(firstByDay.values()), bottom };
}

/**
 * Жирная линия между работами 4.n и 5.n — одна на день, на первой строке блока
 * 5.x основной статус-группы (юзер 2026-08-04). Считаем по дню целиком, как в
 * computeClusterEdges: по соседям выходили лишние линии из-за «красного» блока.
 */
function computeWorkFiveEdges(rows: FlowTransportRow[]): Set<number> {
  const firstByDay = new Map<string, number>();
  rows.forEach((r, i) => {
    if (printStatusGroup(r.status) !== 1) return;
    if (workMajorPrefix(r.work) !== 5) return;
    const d = r.tdate || '';
    if (!firstByDay.has(d)) firstByDay.set(d, i);
  });
  return new Set(firstByDay.values());
}

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

function offsetTopIn(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y;
}

/** Границы стр. по низу строк, print-координаты (без transform/zoom). */
function computeBreakYs(sheet: HTMLElement, pageH: number): number[] {
  const rows = [...sheet.querySelectorAll('tbody tr')] as HTMLElement[];
  if (!rows.length) return [];
  const bottoms = rows.map((tr) => offsetTopIn(tr, sheet) + tr.offsetHeight);
  const maxH = Math.max(sheet.offsetHeight, sheet.scrollHeight, bottoms[bottoms.length - 1] ?? 0);
  const out: number[] = [];
  let target = pageH;
  let guard = 0;
  while (target < maxH - 4 && guard++ < 60) {
    let edge = 0;
    for (const b of bottoms) {
      if (b <= target + 0.5) edge = b;
      else break;
    }
    const prev = out[out.length - 1] ?? 0;
    if (edge <= prev + 1) {
      const next = bottoms.find((b) => b > prev + 1);
      if (next == null) break;
      edge = next;
    }
    out.push(edge);
    target = edge + pageH;
  }
  return out;
}

export function FlowTransportPrint({
  days,
  rows,
  vehByGarage,
  driverByFio,
  printDok,
  printOkalina,
  onClose,
  /** Без превью: сразу dialog (печать) или save (PDF) и закрыть. */
  autoMode,
  onAutoDone,
}: {
  days: string[];
  rows: FlowTransportRow[];
  vehByGarage: Map<string, FlowVehicle>;
  driverByFio: Map<string, FlowDriverOption>;
  printDok: boolean;
  printOkalina: boolean;
  onClose: () => void;
  autoMode?: 'dialog' | 'save';
  onAutoDone?: (msg: string) => void;
}): JSX.Element {
  const silent = !!autoMode;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /** false = обычная печать (страницы сами); true = вписать на 1 лист. */
  const [fitOne, setFitOne] = useState(false);
  const autoStarted = useRef(false);
  const prodCalByYear = useProdCalendarStore((st) => st.byYear);

  const sheetRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  /** Высота контента при zoom=1, width=PAGE_W. */
  const [contentH, setContentH] = useState(0);
  const [deskW, setDeskW] = useState(0);
  const [breakYs, setBreakYs] = useState<number[]>([]);

  const printRows = useMemo(
    () => rows.filter((r) => shouldPrintTransportRow(r.work, printDok, printOkalina)),
    [rows, printDok, printOkalina],
  );
  const clusterEdges = useMemo(() => computeClusterEdges(printRows), [printRows]);
  const workFiveEdges = useMemo(() => computeWorkFiveEdges(printRows), [printRows]);

  const multiDay = days.length > 1;
  const title = fmtDaysTitle(days);
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

  const measureContent = useCallback(() => {
    const el = sheetRef.current;
    const fitEl = fitRef.current;
    if (!el) return;
    // Снять zoom на время замера — иначе height «сжатый» и fit/пунктир врут.
    const prevZoom = fitEl?.style.zoom ?? '';
    if (fitEl) fitEl.style.zoom = '1';
    // force reflow
    void el.offsetHeight;
    const h = Math.max(el.offsetHeight, el.scrollHeight);
    const breaks = computeBreakYs(el, PAGE_H);
    if (fitEl) fitEl.style.zoom = prevZoom;
    setContentH(h);
    setBreakYs(breaks);
  }, []);

  useLayoutEffect(() => {
    const t = window.setTimeout(measureContent, 0);
    return () => window.clearTimeout(t);
  }, [measureContent, printRows, days, printDok, printOkalina, multiDay]);

  useLayoutEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const ro = new ResizeObserver(() => setDeskW(desk.clientWidth));
    ro.observe(desk);
    setDeskW(desk.clientWidth);
    return () => ro.disconnect();
  }, []);

  // После включения/выключения fit — перемерить (zoom=1 внутри measure)
  useLayoutEffect(() => {
    const t = window.setTimeout(measureContent, 30);
    return () => window.clearTimeout(t);
  }, [fitOne, measureContent]);

  const h = Math.max(1, contentH);
  const naturalPages = Math.max(1, Math.ceil(h / PAGE_H - 1e-9));
  const needsFit = h > PAGE_H + 1;
  /** Только по высоте: ширина уже = PAGE_W. */
  const fitScale = fitOne && needsFit ? Math.max(0.5, PAGE_H / h) : 1;
  const pages = fitOne ? 1 : naturalPages;

  // Превью: уменьшить лист в стол; silent — всегда 1:1 для PDF.
  const viewScale = silent ? 1 : deskW > 48 ? Math.min(1, (deskW - 32) / PAGE_W) : 1;

  const busyRef = useRef(false);
  const run = useCallback(
    async (mode: 'dialog' | 'save'): Promise<string> => {
      if (busyRef.current) return '';
      busyRef.current = true;
      setBusy(true);
      setMsg('');
      document.body.classList.add('tr-printing');
      let out = '';
      try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, silent ? 120 : 80));
        const name = `Транспорт ${fmtDaysSummary(days) || 'лист'}`.slice(0, 80);
        const pyn = window.pyn?.print;
        const opts = { landscape: true as const };
        if (pyn) {
          const res = mode === 'save' ? await pyn.savePdf(name, opts) : await pyn.dialog(name, opts);
          if (!res?.ok && res?.error) out = `Печать: ${res.error}`;
          else if (mode === 'save' && res && 'path' in res && res.path) {
            out = `PDF: ${String(res.path).split('/').pop()}`;
          } else if (mode === 'save' && res && 'canceled' in res && res.canceled) {
            out = '';
          } else if (mode === 'dialog') {
            out = 'Печать';
          }
        } else {
          window.print();
          out = mode === 'save' ? 'PDF' : 'Печать';
        }
        if (out) setMsg(out);
      } catch (e) {
        out = `Печать: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`;
        setMsg(out);
      } finally {
        document.body.classList.remove('tr-printing');
        busyRef.current = false;
        setBusy(false);
      }
      return out;
    },
    [days, silent],
  );

  // onClose/onAutoDone — свежие инлайн-функции у родителя на КАЖДЫЙ его
  // ре-рендер (WS-пуши идут постоянно). Раньше они были в deps эффекта ниже —
  // при ре-рендере родителя ВНУТРИ 60мс-паузы React гонял cleanup (cancelled
  // = true) ДО вызова run(autoMode), печать тихо не запускалась вовсе (юзер
  // 2026-08-02: «нажимаю печать — ничего не происходит»). Через ref — эффект
  // не зависит от их идентичности, дергается ровно один раз за job.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onAutoDoneRef = useRef(onAutoDone);
  onAutoDoneRef.current = onAutoDone;

  // Silent: без превью — сверстали off-screen → print/PDF → close.
  // jobKey снаружи гарантирует remount; здесь сбрасываем guard при смене job.
  useEffect(() => {
    autoStarted.current = false;
  }, [autoMode, days.join('|')]);

  useEffect(() => {
    if (!autoMode || autoStarted.current) return;
    // ждём хотя бы один measure (contentH>0) или пустой набор строк
    if (printRows.length > 0 && contentH <= 0) return;
    autoStarted.current = true;
    let cancelled = false;
    void (async () => {
      await new Promise((r) => setTimeout(r, 60));
      if (cancelled) return;
      const m = await run(autoMode);
      if (cancelled) return;
      onAutoDoneRef.current?.(m);
      onCloseRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [autoMode, contentH, printRows.length, run, days.join('|')]);

  const close = () => {
    setBusy(false);
    document.body.classList.remove('tr-printing');
    onClose();
  };

  // Высота слота на экране: при fit — одна страница; иначе — весь контент (scroll).
  const paperH = fitOne && fitScale < 1 ? PAGE_H : h;
  const slotW = Math.round(PAGE_W * viewScale);
  const slotH = Math.round(paperH * viewScale);

  return createPortal(
    <div className={silent ? 'tr-print-overlay tr-print-silent' : 'tr-print-overlay'}>
      <style>{`
        .tr-print-overlay {
          position: fixed; inset: 0; z-index: 60;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          padding: 12px; box-sizing: border-box;
        }
        /* Silent: лист вне экрана, без UI — только paint для printToPDF */
        .tr-print-overlay.tr-print-silent {
          background: transparent;
          pointer-events: none;
          opacity: 0;
          left: -10000px;
          top: 0;
          width: ${PAGE_W + 40}px;
          height: auto;
          overflow: visible;
          padding: 0;
        }
        .tr-print-overlay.tr-print-silent .tr-print-frame {
          width: ${PAGE_W}px;
          height: auto;
          box-shadow: none;
          border-radius: 0;
          background: #fff;
        }
        .tr-print-overlay.tr-print-silent .tr-print-desk {
          padding: 0;
          background: #fff;
          overflow: visible;
        }
        .tr-print-frame {
          display: flex; flex-direction: column;
          width: min(1100px, calc(100vw - 24px));
          height: min(92vh, calc(100vh - 24px));
          border-radius: 8px; overflow: hidden;
          background: #2a2926;
          box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        }
        .tr-print-toolbar {
          flex: 0 0 auto;
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
          padding: 10px 12px; color: #fff; font-size: 12px;
        }
        .tr-print-desk {
          flex: 1 1 auto; min-height: 0; overflow: auto;
          display: flex; justify-content: center; align-items: flex-start;
          padding: 16px; box-sizing: border-box;
          background: #3a3834;
        }
        .tr-print-slot { flex-shrink: 0; position: relative; }
        .tr-print-paper {
          background: #fff;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          transform-origin: top left;
          overflow: hidden;
        }
        .tr-fit { transform-origin: top left; }
        .tr-print-sheet {
          background: #fff; color: #000;
          padding: 10px 12px;
          font-family: 'Inter Variable', system-ui, sans-serif;
          position: relative;
          box-sizing: border-box;
          width: ${PAGE_W}px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .tr-print-sheet, .tr-print-sheet * { color: #000; }
        .tr-print-sheet h1 { font-size: 15px; margin: 0 0 3px; color: #000; font-weight: 700; letter-spacing: -0.01em; }
        .tr-print-sheet .tr-sub { font-size: 9.5px; color: #000; margin: 0 0 8px; }
        .tr-print-sheet .tr-sub strong { font-weight: 700; color: #000; }
        .tr-print-sheet .tr-sub-sep { margin: 0 0.3em; color: #000; opacity: 0.45; }
        .tr-print-sheet table {
          width: 100%; border-collapse: collapse; font-size: 9.5px;
          table-layout: fixed; color: #000;
        }
        .tr-print-sheet th, .tr-print-sheet td {
          border: 0.5px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: middle;
          color: #000; line-height: 1.25;
        }
        .tr-print-sheet th {
          background: #f3f1ec; font-weight: 700; font-size: 9px; white-space: nowrap;
          letter-spacing: 0.02em; color: #000;
        }
        .tr-print-sheet td { white-space: nowrap; }
        .tr-print-sheet td.tr-work {
          white-space: normal; overflow-wrap: anywhere; word-break: normal;
        }
        .tr-print-sheet td.tr-type {
          white-space: normal; overflow-wrap: break-word;
        }
        .tr-print-sheet td.tr-grow {
          white-space: normal; overflow-wrap: break-word;
        }
        /* ФИО целиком, БЕЗ обрезки (юзер 2026-08-02): длинное ФИО переносится по
           пробелам на вторую строку. Ранее было nowrap + ellipsis — фамилия
           резалась «…». overflow-wrap: break-word рвёт само слово только если
           оно не влезает даже в отдельную строку. */
        .tr-print-sheet td.tr-driver { white-space: normal; }
        .tr-print-sheet .tr-fio {
          white-space: normal; overflow-wrap: break-word;
          max-width: 100%; display: block;
        }
        .tr-print-sheet col.c-status { width: 7%; }
        .tr-print-sheet col.c-work { width: 24%; }
        .tr-print-sheet col.c-type { width: 7.5%; }
        .tr-print-sheet col.c-time { width: 6.5%; }
        .tr-print-sheet col.c-brand { width: 8%; }
        .tr-print-sheet col.c-garage { width: 6.5%; }
        .tr-print-sheet col.c-out { width: 3.5%; }
        /* +2% водителю за счёт комментария — чтобы ФИО чаще влезало в одну строку. */
        .tr-print-sheet col.c-driver { width: 19%; }
        .tr-print-sheet col.c-comment { width: 18%; }
        .tr-print-sheet .tr-print-gray td { color: #000; background: #e4e4e4; }
        .tr-print-sheet .tr-time { font-variant-numeric: tabular-nums; color: #000; }
        .tr-print-sheet .tr-time-bold { font-weight: 700; }
        .tr-print-sheet .tr-garage { font-weight: 700; font-variant-numeric: tabular-nums; color: #000; }
        .tr-print-sheet .tr-sub2 { color: #000; font-size: 8.5px; opacity: 0.72; }
        /* Телефон/МОЛ — тоже без «…»: переносим, а не режем. */
        .tr-print-sheet .tr-drsub {
          white-space: normal; font-size: 8.5px;
          overflow-wrap: break-word; display: block; color: #000;
        }
        .tr-print-sheet .tr-phone { font-weight: 700; color: #000; font-variant-numeric: tabular-nums; }
        .tr-print-sheet .tr-mol { color: #000; font-weight: 700; opacity: 0.75; }
        /* Границы блока 6/7/8. 2px + !important: при border-collapse тонкая линия
           конфликтует с 0.5px-границей соседней строки и в PDF терялась
           (юзер 2026-08-02: «в пдф нет этой линии»). */
        .tr-print-sheet .tr-cluster-line td { border-top: 2px solid #000 !important; }
        .tr-print-sheet .tr-cluster-line-bottom td { border-bottom: 2px solid #000 !important; }
        .tr-print-sheet .tr-status-sep td { border-top: 2px solid #000; }
        /* Отбивка работ 4.n | 5.n — как границы блока 6/7/8. */
        .tr-print-sheet .tr-work5-line td { border-top: 2px solid #000 !important; }
        .tr-print-sheet .tr-print-dok td,
        .tr-print-sheet .tr-print-okalina td { background: #e4e4e4; color: #000; }
        .tr-print-sheet .tr-dayhead td {
          background: #f5f0eb; color: #000; font-weight: 700; font-size: 10px;
          border-top: 2px solid #000; padding: 4px 5px;
        }
        .tr-page-break-mark {
          position: absolute; left: 0; right: 0; height: 0;
          border-top: 2px dashed #D97757;
          pointer-events: none; z-index: 2;
        }
        .tr-page-break-mark span {
          position: absolute; right: 6px; top: -10px;
          background: #D97757; color: #fff; font-size: 9px; font-weight: 600;
          padding: 1px 5px; border-radius: 3px;
        }
        /* PDF/печать: без viewScale, с fit zoom */
        body.tr-printing .tr-print-desk { background: #fff !important; padding: 0 !important; }
        body.tr-printing .tr-print-slot {
          width: auto !important; height: auto !important;
        }
        body.tr-printing .tr-print-paper {
          transform: none !important;
          width: auto !important; height: auto !important;
          overflow: visible !important; box-shadow: none !important;
        }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          /* ⚠️ ВСЁ внутри @media print скоупим на body.tr-printing. Без скоупа
             правила ниже оживляли лист Транспорта и в ЧУЖОЙ печати (Сводка):
             оверлей — портал в <body>, #root его не прячет, и в PDF попадали
             обе бумаги сразу (юзер 2026-08-02). */
          /* Печатаем ТОЛЬКО свой лист: любой другой прямой ребёнок body
             (#root, портал Сводки, тосты) скрыт. */
          body.tr-printing > *:not(.tr-print-overlay) { display: none !important; }
          body.tr-printing .tr-print-overlay {
            position: static; background: none; display: block; padding: 0;
          }
          /* Silent-режим (без превью) держит лист вне экрана с opacity:0 —
             под печатью его нужно вернуть в видимый вид, иначе PDF/печать пустые. */
          body.tr-printing .tr-print-overlay.tr-print-silent {
            opacity: 1; left: auto; top: auto; width: auto; height: auto;
          }
          body.tr-printing .tr-print-frame {
            width: auto; height: auto; border-radius: 0; overflow: visible;
            background: #fff; box-shadow: none;
          }
          body.tr-printing .tr-print-desk {
            display: block; overflow: visible; padding: 0; background: #fff;
          }
          body.tr-printing .tr-print-slot { width: auto !important; height: auto !important; }
          body.tr-printing .tr-print-paper {
            transform: none !important; width: auto !important; height: auto !important;
            overflow: visible !important; box-shadow: none !important;
          }
          body.tr-printing .tr-print-sheet {
            width: 100%; padding: 0;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
          }
          body.tr-printing .tr-noprint { display: none !important; }
          body.tr-printing .tr-page-break-mark { display: none !important; }
          body.tr-printing .tr-print-sheet tr { break-inside: avoid; }
          body.tr-printing .tr-print-sheet thead { display: table-header-group; }
          body.tr-printing .tr-print-sheet .tr-dayhead { break-after: avoid; }
        }
      `}</style>

      <div className="tr-print-frame">
        {!silent && (
          <div className="tr-print-toolbar tr-noprint">
            <span className="font-medium">Предпросмотр · Транспорт {title}</span>
            <span className="rounded-md bg-white/15 px-2 py-0.5 tabular-nums">
              {contentH === 0
                ? '…'
                : fitOne
                  ? `1 стр.${fitScale < 0.999 ? ` · ${Math.round(fitScale * 100)}%` : ''}`
                  : pages === 1
                    ? '1 страница'
                    : `${pages} страницы`}
            </span>
            {msg && (
              <span className="max-w-[220px] truncate text-white/70" title={msg}>
                {msg}
              </span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFitOne((v) => !v)}
                disabled={!needsFit && !fitOne}
                className={cn(
                  'flex h-7 items-center rounded-md border px-2.5 font-medium transition-colors disabled:opacity-40',
                  fitOne ? 'border-white bg-white text-[#1a1a1a]' : 'border-white/30 hover:bg-white/10',
                )}
                title={
                  !needsFit && !fitOne
                    ? 'Уже на 1 странице'
                    : fitOne
                      ? 'Обычный масштаб — страницы сами'
                      : 'Вписать весь лист на 1 страницу A4'
                }
              >
                Вписать на 1 страницу
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('dialog')}
                className="flex h-7 items-center gap-1.5 rounded-md border border-white/30 px-2.5 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                <Printer size={13} strokeWidth={1.75} />
                Печать{pages > 1 ? ` (${pages})` : ''}
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
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-white/30 transition-colors hover:bg-white/10"
                title="Закрыть"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </span>
          </div>
        )}

        <div className="tr-print-desk" ref={deskRef}>
          {/*
            slot = размер на экране (PAGE × viewScale)
            paper = print-px, transform: viewScale (только экран)
            fit = CSS zoom (и экран, и PDF) — реально сжимает layout → 1 страница
          */}
          <div className="tr-print-slot" style={{ width: slotW, height: Math.max(slotH, 1) }}>
            <div
              className="tr-print-paper"
              style={{
                width: PAGE_W,
                height: paperH,
                transform: viewScale < 0.999 ? `scale(${viewScale})` : undefined,
              }}
            >
              <div
                ref={fitRef}
                className="tr-fit"
                style={fitScale < 0.999 ? { zoom: String(fitScale) } : undefined}
              >
                <div ref={sheetRef} className="tr-print-sheet">
                  {!fitOne &&
                    breakYs.map((y, i) => (
                      <div
                        key={`br-${i}-${Math.round(y)}`}
                        className="tr-page-break-mark tr-noprint"
                        style={{ top: y }}
                      >
                        <span>стр. {i + 2}</span>
                      </div>
                    ))}
                  <h1>Транспорт · {title}</h1>
                  <p className="tr-sub">
                    <strong>работ</strong> {totalWorks} · <strong>машин</strong> {totalVeh}
                    {multiDay ? ` · дней ${days.length}` : ''}
                    {!fullSchedule && !printDok ? (
                      <>
                        <span className="tr-sub-sep">|</span>
                        <strong>ДОК</strong>: <strong>работ</strong> {dokStats.works} · <strong>машин</strong>{' '}
                        {dokStats.veh}
                      </>
                    ) : null}
                    {!fullSchedule && !printOkalina ? (
                      <>
                        <span className="tr-sub-sep">|</span>
                        <strong>ОКАЛИНА</strong>: <strong>работ</strong> {okalinaStats.works} ·{' '}
                        <strong>машин</strong> {okalinaStats.veh}
                      </>
                    ) : null}
                  </p>
                  <table>
                    <colgroup>
                      <col className="c-status" />
                      <col className="c-work" />
                      <col className="c-type" />
                      <col className="c-time" />
                      <col className="c-brand" />
                      <col className="c-garage" />
                      <col className="c-out" />
                      <col className="c-driver" />
                      <col className="c-comment" />
                    </colgroup>
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
                        const grayStatus = isPrintGrayStatus(r.status) || noFactTime(r);
                        const brand = veh?.model ? vehicleBrand(veh.model) : '';
                        const out = r.out_status || '';
                        const driver = r.driver || veh?.driver || '';
                        const dInfo = driver ? driverByFio.get(driver) : undefined;
                        const phone = r.driver_phone || veh?.driver_phone || '';
                        const phoneDisplay = phone ? formatMobilePhone(phone) : '';
                        const prev = i > 0 ? printRows[i - 1] : undefined;
                        const dayChanged = !prev || prev.tdate !== r.tdate;
                        // Ровно две жирные на день — см. computeClusterEdges().
                        const clusterLine = clusterEdges.top.has(i);
                        const clusterLineBottom = clusterEdges.bottom.has(i);
                        // Отбивка 4.n | 5.n — не рисуем, если тут уже линия блока 6/7/8.
                        const workFiveLine = workFiveEdges.has(i) && !clusterEdges.top.has(i);
                        const statusSep =
                          !!prev &&
                          prev.tdate === r.tdate &&
                          printStatusGroup(prev.status) === 0 &&
                          printStatusGroup(r.status) === 1;
                        const dok = isDokRow(r.work);
                        const okalina = isOkalinaRow(r.work);
                        const timeBold = shouldShowTimeBold(
                          r.time_range,
                          r.work,
                          r.tdate,
                          prodCalByYear,
                          r.time_bold,
                        );
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
                                  grayStatus && 'tr-print-gray',
                                  clusterLine && 'tr-cluster-line',
                                  clusterLineBottom && 'tr-cluster-line-bottom',
                                  workFiveLine && 'tr-work5-line',
                                  statusSep && 'tr-status-sep',
                                  dok && 'tr-print-dok',
                                  okalina && 'tr-print-okalina',
                                ) || undefined
                              }
                            >
                              <td>{r.status}</td>
                              <td className="tr-work">{r.work}</td>
                              <td className="tr-type">{r.vehicle_type}</td>
                              <td className={cn('tr-time', timeBold && 'tr-time-bold')}>
                                {fmtTimeRange(r.time_range)}
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
                              <td className="tr-driver">
                                {driver ? <span className="tr-fio">{driver}</span> : null}
                                {phoneDisplay || dInfo?.isMol ? (
                                  <span className="tr-drsub">
                                    {phoneDisplay && <span className="tr-phone">{phoneDisplay}</span>}
                                    {dInfo?.isMol ? (
                                      <span className="tr-mol">
                                        {phoneDisplay ? ' · ' : ''}МОЛ
                                        {dInfo.until ? ` · по ${formatUntilDate(dInfo.until)}` : ''}
                                      </span>
                                    ) : null}
                                  </span>
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
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
