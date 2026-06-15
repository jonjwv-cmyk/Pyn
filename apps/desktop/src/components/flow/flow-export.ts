// ============================================================
// flow-export.ts — выгрузка План/Отчёт в Excel-совместимый CSV (ТЗ §7), 3 варианта.
// ============================================================
// БЕЗ внешних зависимостей: CSV с UTF-8 BOM + разделитель «;» (дефолт RU-Excel),
// корректное экранирование (кавычки/перевод строки), открывается в Excel двойным
// кликом. Сортировка APLAN + схлопывание CPRINT — на данных. (Стилизованный .xlsx —
// позже отдельной библиотекой: exceljs тянет несовместимый @types/node и ломает
// electron-typecheck; вводить только осознанно.)
//
// Варианты (§7):
//   • planFull          — полный план, БЕЗ схлопывания, МОЛ «Фамилия И.О.» без телефона (рассылка);
//   • planForExpeditors — схлопывание по склад+МОЛ+номенклатура (Σ кол-во/КГ/V, склейка номеров
//                         поставок), МОЛ С телефоном (задание экспедиторам);
//   • warehouseSheet    — по складу, только непустые места хранения (из stock_note), кладовщикам.
import type { FlowDeliveryRow, FlowRow } from '@pyn/core';
import { fmtNum3, parseMol } from './flow-sandbox.fixtures';
import { normVghKey } from '@/lib/vgh-store';

export interface ExportWarehouse {
  delivery_day?: string | null;
  cluster?: string | null;
  in_schedule?: number | null;
}
export interface ExportVgh {
  weight_kg?: number | null;
  volume_m3?: number | null;
}
export interface ExportCtx {
  // ReadonlyMap — ковариантна по значению: сторовые Map<string, …> присваиваются без cast.
  anchorByKey: ReadonlyMap<string, FlowRow>;
  vghByKey: ReadonlyMap<string, ExportVgh>;
  whById: ReadonlyMap<string, ExportWarehouse>;
}

const T = (v: unknown): string => String(v == null ? '' : v).trim();

/** CLST склада-получателя (день + ВЫЕЗД/КХП), как в гриде. */
function clstText(toWh: string, ctx: ExportCtx): string {
  const wh = ctx.whById.get(toWh);
  const day = wh && Number(wh.in_schedule) === 1 ? wh.delivery_day : null;
  if (!day) return '';
  return wh?.cluster === 'ВЫЕЗД' || wh?.cluster === 'КХП' ? `${day} ${wh.cluster}` : String(day);
}

/** Сокращение отчества до инициала: «Иванов Иван Иванович» → «Иванов Иван И.». */
function shortenPatronymic(fio: string): string {
  const parts = T(fio).split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return `${parts[0]} ${parts[1]} ${(parts[2] ?? '').charAt(0)}.`;
  return T(fio);
}

function molFio(r: FlowDeliveryRow, ctx: ExportCtx): string {
  const a = ctx.anchorByKey.get(`${r.ord}|${r.it}`);
  if (!a?.mol) return '';
  return parseMol(a.mol)?.fio ?? a.mol;
}
function molFull(r: FlowDeliveryRow, ctx: ExportCtx): string {
  const a = ctx.anchorByKey.get(`${r.ord}|${r.it}`);
  if (!a?.mol) return '';
  const m = parseMol(a.mol);
  if (!m) return T(a.mol);
  return m.phone ? `${m.fio} · ${m.phone}` : m.fio;
}
function noteOf(r: FlowDeliveryRow, ctx: ExportCtx): string {
  return T(ctx.anchorByKey.get(`${r.ord}|${r.it}`)?.note);
}
function kgOf(r: FlowDeliveryRow, ctx: ExportCtx): number | null {
  const w = ctx.vghByKey.get(normVghKey(r.no_num))?.weight_kg;
  return w != null && r.qty != null ? Math.round(r.qty * w * 1000) / 1000 : null;
}
function vOf(r: FlowDeliveryRow, ctx: ExportCtx): number | null {
  const vol = ctx.vghByKey.get(normVghKey(r.no_num))?.volume_m3;
  return vol != null && r.qty != null ? Math.round(r.qty * vol * 1000) / 1000 : null;
}
function planDateRu(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s || '';
}

/** APLAN-сортировка (дата плана → CLST ВЫЕЗД>КХП>прочее → склад → материал). */
function sortAplan(rows: FlowDeliveryRow[], ctx: ExportCtx): FlowDeliveryRow[] {
  const clRank = (toWh: string): number => {
    const wh = ctx.whById.get(toWh);
    if (wh?.cluster === 'ВЫЕЗД') return 0;
    if (wh?.cluster === 'КХП') return 1;
    return 2;
  };
  return rows.slice().sort(
    (a, b) =>
      (a.plan_date || '').localeCompare(b.plan_date || '') ||
      clRank(a.to_wh) - clRank(b.to_wh) ||
      (a.to_wh || '').localeCompare(b.to_wh || '') ||
      (a.mat || '').localeCompare(b.mat || '', 'ru'),
  );
}

// ── CSV-сборка (RU-Excel: BOM + «;»; экранируем «;» " и переводы строки) ──────
const SEP = ';';
function csvCell(v: unknown): string {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvText(header: string[], rows: (string | number)[][]): string {
  const lines = [header.map(csvCell).join(SEP)];
  for (const r of rows) lines.push(r.map(csvCell).join(SEP));
  return `﻿${lines.join('\r\n')}`;
}
function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const num = (n: number | null): string => (n == null ? '' : fmtNum3(n));
const stamp = (): string => new Date().toISOString().slice(0, 10);
function expeditorsOf(r: FlowDeliveryRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [r.exp1, r.exp2]) {
    for (const part of T(raw).split(/\r?\n|;/)) {
      const fio = part.trim();
      if (!fio) continue;
      const key = fio.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fio);
    }
  }
  return out;
}

/** Вариант 1 — полный план (без схлопывания), МОЛ «Фамилия И.О.» без телефона. */
export function exportPlanFull(rows: FlowDeliveryRow[], ctx: ExportCtx): void {
  const header = ['Дата плана', 'CLST', 'Поставка', 'Заказ', 'Откуда', 'Куда', 'МОЛ',
    'Материал', 'Коммент', 'ЕИ', 'Кол-во', 'КГ', 'V', 'ID', 'Эксп.'];
  const out = sortAplan(rows, ctx).map((r) => [
    planDateRu(r.plan_date),
    clstText(r.to_wh, ctx),
    T(r.dlv) ? `${r.dlv}${T(r.dlv_pos) ? `|${r.dlv_pos}` : ''}` : 'черновик',
    `${r.ord}${r.it ? `|${r.it}` : ''}`,
    r.fr || '',
    r.to_wh || '',
    shortenPatronymic(molFio(r, ctx)),
    r.mat || '',
    noteOf(r, ctx),
    r.uom || '',
    r.qty == null ? '' : fmtNum3(r.qty),
    num(kgOf(r, ctx)),
    num(vOf(r, ctx)),
    r.ride_id || '',
    expeditorsOf(r).join(', '),
  ]);
  downloadCsv(csvText(header, out), `План_${stamp()}.csv`);
}

/** Вариант 2 — задание экспедиторам: схлопывание по склад+МОЛ+номенклатура, МОЛ с телефоном. */
export function exportPlanForExpeditors(rows: FlowDeliveryRow[], ctx: ExportCtx): void {
  type Agg = {
    r0: FlowDeliveryRow; qty: number; kg: number; v: number;
    dlvs: Set<string>; rides: Set<string>; exps: Set<string>;
  };
  const groups = new Map<string, Agg>();
  for (const r of rows) {
    const key = `${T(r.to_wh)}|${molFio(r, ctx)}|${normVghKey(r.no_num)}|${T(r.mat)}`;
    let g = groups.get(key);
    if (!g) { g = { r0: r, qty: 0, kg: 0, v: 0, dlvs: new Set(), rides: new Set(), exps: new Set() }; groups.set(key, g); }
    g.qty += r.qty ?? 0;
    g.kg += kgOf(r, ctx) ?? 0;
    g.v += vOf(r, ctx) ?? 0;
    if (T(r.dlv)) g.dlvs.add(`${r.dlv}${T(r.dlv_pos) ? `|${r.dlv_pos}` : ''}`);
    if (T(r.ride_id)) g.rides.add(T(r.ride_id));
    for (const e of expeditorsOf(r)) g.exps.add(e);
  }
  const header = ['Дата плана', 'CLST', 'Куда', 'МОЛ', 'Материал', 'ЕИ',
    'Кол-во', 'КГ', 'V', 'Поставки', 'ID', 'Эксп.'];
  const out = sortAplan([...groups.values()].map((g) => g.r0), ctx).map((r0) => {
    const key = `${T(r0.to_wh)}|${molFio(r0, ctx)}|${normVghKey(r0.no_num)}|${T(r0.mat)}`;
    const g = groups.get(key);
    return [
      planDateRu(r0.plan_date),
      clstText(r0.to_wh, ctx),
      r0.to_wh || '',
      molFull(r0, ctx),
      r0.mat || '',
      r0.uom || '',
      g && g.qty ? fmtNum3(g.qty) : '',
      g && g.kg ? fmtNum3(Math.round(g.kg * 1000) / 1000) : '',
      g && g.v ? fmtNum3(Math.round(g.v * 1000) / 1000) : '',
      g ? [...g.dlvs].join(' / ') : '',
      g ? [...g.rides].join(', ') : '',
      g ? [...g.exps].join(', ') : '',
    ];
  });
  downloadCsv(csvText(header, out), `Экспедиторам_${stamp()}.csv`);
}

/** Вариант 3 — лист кладовщикам: по складу, только непустые места хранения (stock_note). */
export function exportWarehouseSheet(rows: FlowDeliveryRow[], ctx: ExportCtx): void {
  const header = ['Дата плана', 'Откуда', 'Куда', 'Поставка', 'Материал', 'ЕИ',
    'Кол-во', 'КГ', 'V', 'Справка (места с остатком)'];
  const ordered = rows.slice().sort(
    (a, b) =>
      (a.fr || '').localeCompare(b.fr || '') ||
      (a.plan_date || '').localeCompare(b.plan_date || '') ||
      (a.mat || '').localeCompare(b.mat || '', 'ru'),
  );
  const out = ordered.map((r) => [
    planDateRu(r.plan_date),
    r.fr || '',
    r.to_wh || '',
    T(r.dlv) ? `${r.dlv}${T(r.dlv_pos) ? `|${r.dlv_pos}` : ''}` : '',
    r.mat || '',
    r.uom || '',
    r.qty == null ? '' : fmtNum3(r.qty),
    num(kgOf(r, ctx)),
    num(vOf(r, ctx)),
    T(r.stock_note),
  ]);
  downloadCsv(csvText(header, out), `Кладовщикам_${stamp()}.csv`);
}

export type FlowExportVariant = 'full' | 'expeditors' | 'warehouse';
