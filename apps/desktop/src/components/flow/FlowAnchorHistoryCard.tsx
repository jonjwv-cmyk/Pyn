import { useEffect, useMemo, useRef, useState } from 'react';
import { History, X, FileText, Phone, Check } from 'lucide-react';
import type { FlowDeliveryRow, FlowDeliveryEvent, FlowDeliveriesChangedEvent, Person } from '@pyn/core';
import { useWsEvent } from '@/lib/ws';
import { usePersonsStore } from '@/lib/persons-store';
import { formatMobilePhone, MOL_UNTIL_PILL_CLASS, molUntilStatus, molStatusKind } from '@/lib/mol-format';
import { cn } from '@/lib/cn';
import { sedComputed, SED_LABEL, SED_COLOR } from './flow-signal';
import { whKey } from './flow-warehouse';
import { formatUntilDate } from './flow-sandbox.fixtures';

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

/** Нормализация ФИО для фолбэк-поиска персоны «по контакту» (когда табель не нашёлся). */
const normFio = (s: string): string =>
  String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Табель без ведущих нулей: СЭД шлёт `01115106`, база персон хранит `1115106`. Без этого
 *  весь резолв подписанта (контакт/МОЛ/роль/«нет договора ПМО») молча не находил персону. */
const normTab = (s: string): string => String(s ?? '').trim().replace(/^0+/, '');

/** Дата СЭД: «мес дата [год если не текущий] 9:12 am» (юзер 2026-06-21). */
const SED_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function fmtAmpm(hh: string, mm: string): string {
  const h0 = Number(hh);
  if (!Number.isFinite(h0)) return `${hh}:${mm}`;
  const suffix = h0 >= 12 ? 'pm' : 'am';
  const h = h0 % 12 || 12;
  return `${h}:${mm} ${suffix}`;
}
function fmtSedTs(s: string): string {
  const m = (s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return (s || '').slice(0, 16);
  const y = Number(m[1] ?? '');
  const mo = Number(m[2] ?? '');
  const d = Number(m[3] ?? '');
  const yr = y && y !== new Date().getFullYear() ? ` ${y}` : '';
  const time = m[4] ? ` ${fmtAmpm(m[4], m[5] ?? '00')}` : '';
  return `${SED_MON[mo - 1] ?? ''} ${d}${yr}${time}`;
}

function sedStepTone(kind: string, doneStat: string, opts: { future?: boolean } = {}): { dot: string; line: string; bg: string; text: string } {
  // Боковая линия (юзер 2026-06-22): тон по KIND, НЕ по тексту done_stat (он врёт — у подписавшего
  // кладовщика done_stat бывает «На подписании»). ЗЕЛЁНЫМ — завершённый шаг (sign/launch = подписал/
  // запущен), ЖЁЛТЫМ — ТЕКУЩИЙ держатель (kind='wait' = ждёт подписи, «на ком сейчас»), СЕРЫМ — ещё
  // ВПЕРЕДИ (будущий ожидающий/синтетический шаг), КРАСНЫМ — отклонён/аннулирован/перезапуск.
  const s = String(doneStat ?? '').toLowerCase();
  if (kind === 'restart' || kind === 'reject' || kind === 'annul' || s.includes('отклон') || s.includes('аннулир'))
    return { dot: '#E5484D', line: 'rgba(229,72,77,0.40)', bg: 'rgba(229,72,77,0.14)', text: '#EF8A8A' };
  if (opts.future) return { dot: '#A6A39B', line: 'rgba(255,255,255,0.12)', bg: 'rgba(255,255,255,0.05)', text: '#CECCC5' };
  if (kind === 'wait') return { dot: '#FFB72B', line: 'rgba(255,183,43,0.40)', bg: 'rgba(255,183,43,0.14)', text: '#FFC95B' };
  return { dot: '#7DC061', line: 'rgba(125,192,97,0.40)', bg: 'rgba(125,192,97,0.14)', text: '#9BD17E' };
}

type SedChainStep = {
  ev: FlowDeliveryEvent;
  kind: string;
  role: string;
  /** Код роли из снимка сервера (shipping_keeper/expeditor/receiver_mol) — для определения,
   *  есть ли уже шаг приёмки МОЛ (иначе добавим синтетический «впереди»). Пусто — нет снимка. */
  prole: string;
  seq: number;
  phone: string;
  /** МОЛ-метка шага-приёмки — СНИМОК НА МОМЕНТ ПОСТАВКИ (роль из payload сервера, юзер 2026-06-22):
   *  'date' = был договорной МОЛ склада-получателя (срок «по дату»), 'nemol' = подписал, но НЕ МОЛ.
   *  null — не шаг приёмки. Берём из снимка, чтобы через месяц «МОЛ/не МОЛ» не переписался задним числом. */
  molTag: 'date' | 'nemol' | null;
  until: string;
  /** Статус контакта — ЖИВОЙ из базы персон (звонить или нет прямо сейчас). */
  contactStatus: string;
};

export function FlowAnchorHistoryCard({ target, load, onClose }: Props) {
  const [data, setData] = useState<{ episodes: FlowDeliveryRow[]; events: FlowDeliveryEvent[] } | null>(null);
  const [loading, setLoading] = useState(false);
  // Раскрытие движения СЭД — попап-«окошко» СПРАВА от блока (как меню), а не раскрытие вниз.
  const [sedPop, setSedPop] = useState<{ id: number; top: number; left: number } | null>(null);
  const loadRef = useRef(load);
  const dataRef = useRef(data);
  const anchorKeyRef = useRef('');
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Первичная загрузка по смене якоря (+ индикатор). setData(null) гасит прошлую позицию.
  useEffect(() => {
    anchorKeyRef.current = target ? `${target.ord}|${target.it}` : '';
    if (!target) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setData(null);
    loadRef.current(target.ord, target.it)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ episodes: [], events: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [target?.ord, target?.it]);

  // Реалтайм: пока карточка открыта — тихо подтягиваем изменения по СВОЕМУ якорю
  // (статус/МОЛ/перенос/факт zm_vl/СЭД/удаление) без индикатора и прыжков. ТЗ §1: открытая
  // карточка истории/СЭД обновляется по событиям, не требуя переоткрытия.
  useWsEvent<FlowDeliveriesChangedEvent>('flow_deliveries_changed', (e) => {
    if (!target) return;
    const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowDeliveryRow[]) : [];
    const touchesAnchor = incoming.some(
      (r) => String(r.ord) === target.ord && String(r.it) === target.it,
    );
    const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
    const touchesShown =
      deleted.size > 0 && (dataRef.current?.episodes ?? []).some((ep) => deleted.has(ep.id));
    if (!touchesAnchor && !touchesShown) return;
    // Дебаунс: одна перезагрузка на пачку событий (bulk-сверка шлёт чанками).
    const { ord, it } = target;
    const key = `${ord}|${it}`;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      loadRef.current(ord, it)
        .then((d) => { if (anchorKeyRef.current === key) setData(d); })
        .catch(() => { /* транзиент — оставляем что было */ });
    }, 250);
  });

  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  // Зона СЭД (ТЗ §5): телефон/статус контакта тянем из живой базы персон по табельному
  // подписанта. Карта по табельному.
  const persons = usePersonsStore((s) => s.persons);
  const personByTab = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of persons) if (p.tab) m.set(normTab(p.tab), p);
    return m;
  }, [persons]);
  // Фолбэк «по контакту»: персона по нормализованному ФИО (когда табель подписанта не нашёлся).
  const personByFio = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of persons) { const f = normFio(p.fio); if (f && !m.has(f)) m.set(f, p); }
    return m;
  }, [persons]);

  // СЭД у КАЖДОЙ поставки своя (ТЗ §5, юзер 2026-06-20): статус + на ком (ФИО/телефон/контакт из
  // базы по табельному) + цепочка движения ИМЕННО этой поставки (sed_update с её номером). По клику
  // на пилл — раскрытие дерева движения. Чистая функция (зовём per-episode в рендере).
  const sedFor = (e: FlowDeliveryRow) => {
    const dlv = String(e.dlv ?? '').trim();
    const tab = String(e.sed_who_tab ?? '').trim();
    const person = tab ? personByTab.get(normTab(tab)) : undefined;
    const status = sedComputed(e.sed_status, Number(e.sap_open) === 1);
    const whMatch = person?.warehouses?.find((w) => whKey(w.code) === whKey(e.to_wh));
    const shipWhMatch = person?.warehouses?.find((w) => whKey(w.code) === whKey(e.fr));
    const isShippingKeeper = !!person && String(person.position ?? '').toLowerCase().includes('кладов') && !!shipWhMatch;
    // «нет договора ПМО» (юзер 2026-06-20): подписант есть, но он НЕ договорной МОЛ склада-получателя
    // (нет в базе / не МОЛ / МОЛ, но другого склада). Тогда вместо «МОЛ по <дату>» — эта метка.
    // Кладовщик склада ОТГРУЗКИ — не ПМО-приёмка, поэтому предупреждение по ПМО здесь не показываем.
    const noPmo = status !== 'awaiting_shipment' && !isShippingKeeper &&
      !!String(e.sed_holder ?? '').trim() && (!person || !person.isMol || !whMatch);
    return {
      status,
      holder: String(e.sed_holder ?? ''),
      phone: person?.mobile || person?.work || '',
      contactStatus: person?.status ?? '',
      isMol: !!person?.isMol,
      until: whMatch?.until || '',
      noPmo,
      removed: Number(e.reserved) === 1,
      launchAt: String(e.sed_launch_at ?? '').trim(),
      signedAt: String(e.sed_signed_at ?? '').trim(),
      // ДВИЖЕНИЕ документа = ВСЕ запуски СЭД в хронологии (история перезапусков/отклонений).
      // Процесс (юзер 2026-06-22): запуск → кладовщик/МОЛ склада ОТГРУЗКИ «отгрузил» → промежуточные
      // лица (экспедитор/водитель) «в пути», 2-я подпись того же = «выдано МОЛу» → получатель: МОЛ
      // склада-получателя «получено», НЕ МОЛ — одно слово «принято» (нет договора ПМО). Роль из payload
      // сервера (снимок shipping_keeper/expeditor/receiver_mol) ПРИОРИТЕТНА; нет снимка — по ПОЗИЦИИ
      // в цепочке подписей (1-я=отгрузка, последняя=приёмка, средние=в пути).
      chain: (() => {
        // 1) сырые шаги движения этой поставки + дедуп точных повторов, сортировка по seq/времени
        const seen = new Set<string>();
        const raw = (data?.events ?? [])
          .filter((ev) => ev.event_kind === 'sed_step' && (dlv ? String(ev.dlv ?? '').trim() === dlv : true))
          .map((ev) => {
            let kind = 'sign';
            let stab = '';
            let seq = 0;
            let prole = '';
            if (ev.payload_json) {
              try {
                const pl = JSON.parse(ev.payload_json) as { kind?: string; tab?: string; seq?: number; role?: string };
                if (pl.kind) kind = pl.kind;
                stab = String(pl.tab ?? '');
                seq = Number(pl.seq) || 0;
                prole = String(pl.role ?? '');
              } catch { /* битый payload — роль по позиции, порядок по времени */ }
            }
            return { ev, kind, stab, seq, prole };
          })
          .filter((r) => {
            const k = `${r.kind}|${String(r.ev.created_at)}|${String(r.ev.full_name)}|${String(r.ev.done_stat)}|${String(r.ev.payload_json ?? '')}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .sort((a, b) => a.seq - b.seq || String(a.ev.created_at).localeCompare(String(b.ev.created_at)));
        // 2) индексы ПОДПИСЕЙ (kind='sign') — позиция нужна, когда сервер не дал роль
        const signs = raw.filter((r) => r.kind === 'sign');
        const lastSignIdx = signs.length - 1;
        const expSeen = new Set<string>(); // повторная подпись экспедитора → «выдано МОЛу»
        // 3) финальные шаги с ролью по снимку/позиции
        return raw.map((r) => {
          const { ev, kind, stab, seq, prole } = r;
          const sp = (stab && personByTab.get(normTab(stab))) || personByFio.get(normFio(ev.full_name));
          const phone = sp?.mobile || sp?.work || '';
          const whMatch = sp?.warehouses?.find((w) => whKey(w.code) === whKey(e.to_wh));
          // МОЛ-ность получателя — СНИМОК (роль из payload) приоритетнее живого справочника.
          const wasMol = prole ? prole === 'receiver_mol' : (!!sp?.isMol && !!whMatch);
          let role = '';
          let molTag: 'date' | 'nemol' | null = null;
          if (kind === 'launch') role = 'запущен в СЭД';
          else if (kind === 'restart') role = ev.done_stat || 'перезапущен';
          else if (kind === 'reject') role = 'отклонил';
          else if (kind === 'annul') role = 'аннулировал';
          else if (kind === 'wait') role = prole === 'shipping_keeper' ? 'ожидает отгрузки'
            : prole === 'receiver_mol' ? 'ожидает приёмки МОЛ'
              : prole === 'expeditor' ? 'ожидает передачи'
                : (ev.done_stat || 'ожидает');
          else {
            const si = signs.indexOf(r);
            const isKeeper = prole === 'shipping_keeper' || (!prole && si === 0);
            const isReceiver = prole === 'receiver_mol' || (!prole && si > 0 && si === lastSignIdx);
            const isExpeditor = prole === 'expeditor' || (!prole && si > 0 && si < lastSignIdx);
            if (isKeeper) role = 'отгрузил';
            else if (isExpeditor) {
              const key = String(sp?.tab || ev.full_name);
              const repeat = expSeen.has(key);
              expSeen.add(key);
              role = repeat ? 'выдано МОЛу' : 'в пути';
            } else if (isReceiver) {
              role = wasMol ? 'получено' : 'принято';
              molTag = wasMol ? 'date' : 'nemol';
            } else role = 'согласовал'; // запас (одиночная подпись вне роли)
          }
          return { ev, kind, role, prole, seq, phone, molTag, until: whMatch?.until || '', contactStatus: sp?.status || '' };
        });
      })(),
    };
  };

  // ГРУППИРОВКА по поставке (OBD) для раскладки «история | СЭД» (юзер 2026-06-20): одна поставка =
  // одна ГРУППА. Внутри — попытки по ДАТАМ (несколько отчётов по поставке → несколько блоков истории),
  // снимки одной даты схлопываем (берём свежую row_version). Справа — ОДИН блок СЭД на поставку.
  //
  // ШУМ СНЯТЫХ (юзер 2026-06-20): резерв БЕЗ результата (нет статуса отчёта, нет факта) — это
  // брошенные попытки включить позицию в план (черновики + копии переносов, перекрытые живой строкой).
  // Юзеру они НЕ нужны вообще — просто отбрасываем (ни блоков, ни счётчика). Остаётся реальная история.
  const obdGroups = useMemo(() => {
    const eps = data?.episodes ?? [];
    const meaningful: FlowDeliveryRow[] = [];
    for (const e of eps) {
      const isScrap =
        Number(e.reserved) === 1 && !String(e.done_stat ?? '').trim() && e.fact_qty == null;
      if (!isScrap) meaningful.push(e);
    }
    const byObd = new Map<string, { key: string; dlv: string; byState: Map<string, FlowDeliveryRow> }>();
    for (const e of meaningful) {
      const dlv = String(e.dlv ?? '').trim();
      const key = dlv ? `obd-${dlv}` : `draft-${e.id}`;
      let g = byObd.get(key);
      if (!g) {
        g = { key, dlv, byState: new Map() };
        byObd.set(key, g);
      }
      // Дедуп точных повторов: одно состояние = дата плана + статус + резерв (бьём двойные копии
      // переноса 6135/6141). Берём свежий снимок (row_version, затем id).
      const stateKey = `${String(e.plan_date ?? '').trim()}|${String(e.done_stat ?? '').trim()}|${e.reserved}`;
      const cur = g.byState.get(stateKey);
      if (!cur || Number(e.row_version) > Number(cur.row_version) || (Number(e.row_version) === Number(cur.row_version) && e.id > cur.id)) {
        g.byState.set(stateKey, e);
      }
    }
    const groups = [...byObd.values()]
      .map((g) => {
        const list = [...g.byState.values()].sort(
          (a, b) => String(b.plan_date || '').localeCompare(String(a.plan_date || '')) || b.id - a.id,
        );
        return { key: g.key, dlv: g.dlv, episodes: list, rep: list[0] as FlowDeliveryRow };
      })
      .sort((a, b) => String(b.rep?.plan_date || '').localeCompare(String(a.rep?.plan_date || '')) || b.rep.id - a.rep.id);
    return groups;
  }, [data]);

  if (!target) return null;

  // Изменение кол-ва по поставке (zm_vl Объем ≠ план) → показываем в блоке поставки «было → стало».
  const qtyChangeByDlv = new Map<string, { was: number; now: number }>();
  for (const ev of data?.events ?? []) {
    if (ev.event_kind !== 'zmvl_qty_change' || !ev.dlv) continue;
    try {
      const p = JSON.parse(ev.payload_json || '{}') as { was?: number; now?: number };
      qtyChangeByDlv.set(String(ev.dlv).trim(), { was: Number(p.was), now: Number(p.now) });
    } catch { /* битый payload — пропуск */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[84vh] w-[780px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border-subtle bg-bg-elevated shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text-strong">
              <History size={14} strokeWidth={1.9} className="text-accent-clay" />
              История движения позиции {target.it || '—'} заказа {target.ord || '—'}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-text-secondary">
              {target.mat || target.noNum}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-transparent p-1 text-text-secondary transition-colors hover:border-border-subtle hover:text-text-strong"
            title="Закрыть"
          >
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && <div className="py-8 text-center text-[12px] text-text-muted">Загрузка…</div>}
          {!loading && obdGroups.length === 0 && (
            <div className="py-8 text-center text-[12px] text-text-muted">
              По этой позиции движения ещё не было.
            </div>
          )}

          {/* ПОСТАВКИ: каждая — РЯД из двух прямоугольников. СЛЕВА история (попытки по отчётам —
              несколько блоков, если возили 2+ раза), СПРАВА ОДИН блок СЭД на поставку. Клик по СЭД →
              плавное дерево движения под рядом (этапы по времени, текущий выделен). ТЗ §5. */}
          {!loading && obdGroups.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                История доставки
              </div>
              <div className="flex flex-col gap-2.5">
                {obdGroups.map((g, gi) => {
                  // «Удалена из поставки» (юзер 2026-06-22): эта OBD — НЕ последняя попытка (есть новее)
                  // И по ней НИ РАЗУ не было факта (не провели) → поставку удалили/заменили новой. Какая
                  // была — видно по № и дате. Группы отсортированы новейшая→старая, потому gi>0 = старее.
                  const groupDeleted = gi > 0 && !!(g.dlv || '').trim() && !g.episodes.some((e) => e.fact_qty != null);
                  // СЭД-блок только для поставки, которая реально шла/идёт. «не увезли» / удалённую OBD
                  // не показываем как «возили по СЭД».
                  const sed = !groupDeleted && g.dlv && g.rep.done_stat !== 'не увезли' ? sedFor(g.rep) : null;
                  const isOpen = sedPop?.id === g.rep.id;
                  return (
                    <div key={g.key}>
                      <div className="flex items-stretch gap-2">
                        {/* ЛЕВО — прямоугольник(и) истории: попытки по датам */}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          {groupDeleted && (
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-danger">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
                              удалена из поставки{g.dlv ? ` ${g.dlv}` : ''} — заменена новой
                            </div>
                          )}
                          {g.episodes.map((e) => {
                            const reserved = Number(e.reserved) === 1;
                            // «активна» — ТОЛЬКО живая попытка БЕЗ результата (пустой статус отчёта).
                            // «не увезли»/«выполнено» — это результат, не активна (юзер 2026-06-21).
                            const active =
                              !reserved && (e.dlv || '').trim() !== '' && e.fact_qty == null &&
                              !String(e.done_stat || '').trim();
                            // «Перенос-без-дня» (юзер 2026-06-21): отмечен «перенос на другой день»
                            // БЕЗ назначенной даты (импорт/ручная заливка пишет голую причину, а
                            // настоящий перенос — «…: YYYY-MM-DD»), поставка ещё открыта в SAP
                            // (sap_open=1, нет факта). Это «оптеряшка переноса» — день не назначили.
                            const transferNoDay =
                              !reserved && e.fact_qty == null && Number(e.sap_open) === 1 &&
                              String(e.fail_reason || '').trim() === 'перенос на другой день';
                            const qchg = e.dlv ? qtyChangeByDlv.get(String(e.dlv).trim()) : undefined;
                            const mol = (e.snap_mol || '').trim();
                            const exps = [e.exp1, e.exp2].filter(Boolean).join(', ');
                            const veh = [e.ride_id, e.vehicle].filter(Boolean).join(' · ');
                            return (
                              <div
                                key={e.id}
                                className={`rounded-lg border px-3 py-2 ${reserved ? 'border-border-subtle bg-white/[0.04] opacity-70' : 'border-border-subtle bg-bg-primary'}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-strong">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: statusColor(e.done_stat, e.fail_reason) }} />
                                    {statusText(e.done_stat, e.fail_reason)}
                                    {reserved && <span className="text-[11px] font-normal text-text-muted">· {(e.dlv || '').trim() ? 'удалена из поставки' : 'снято'}</span>}
                                  </div>
                                  <span className="text-[10px] tabular-nums text-text-muted">{e.plan_date ? fmtSedTs(e.plan_date) : '—'}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-text-secondary">
                                  <span>{e.dlv ? `поставка ${e.dlv}${e.dlv_pos ? `/${e.dlv_pos}` : ''}` : 'черновик (без №)'}</span>
                                  {active && <span className="font-medium text-presence-away">активна</span>}
                                  {transferNoDay && <span className="font-medium text-presence-away">день переноса не назначен · поставка активна</span>}
                                  {e.qty != null && <span>{e.qty} {e.uom}</span>}
                                  {qchg && <span className="font-medium text-presence-away">было {qchg.was} → стало {qchg.now}</span>}
                                  {Number(e.fixation_id) > 0 && <span>зафикс.</span>}
                                  {e.fact_qty != null && <span className="text-success">факт {e.fact_qty}{e.fact_dt ? ` · ${fmtSedTs(e.fact_dt)}` : ''}</span>}
                                </div>
                                {(mol || exps || veh) && (
                                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
                                    {mol && <span>МОЛ: {mol}</span>}
                                    {exps && <span>возил: {exps}</span>}
                                    {veh && <span className="tabular-nums">{veh}</span>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* ПРАВО — блок СЭД: статус + «принято/на ком: ФИО» + дата РЯДОМ. Клик → попап
                            движения СПРАВА (как меню), не раскрытие вниз (юзер 2026-06-21). */}
                        {sed && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              if (isOpen) { setSedPop(null); return; }
                              const r = ev.currentTarget.getBoundingClientRect();
                              setSedPop({
                                id: g.rep.id,
                                top: Math.max(8, Math.min(r.top, window.innerHeight - 380)),
                                left: Math.min(r.right + 8, window.innerWidth - 360),
                              });
                            }}
                            className={`w-[280px] shrink-0 self-start rounded-lg border p-2 text-left transition-colors ${isOpen ? 'border-accent-clay/50 bg-bg-elevated' : 'border-border-subtle bg-bg-primary hover:border-border-default'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className="inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ background: `${SED_COLOR[sed.status]}1A`, color: SED_COLOR[sed.status] }}
                              >
                                <FileText size={9} strokeWidth={2} />
                                <span className="whitespace-normal">{SED_LABEL[sed.status]}</span>
                              </span>
                              <span className="shrink-0 text-text-muted">▸</span>
                            </div>
                            {sed.holder ? (
                              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug">
                                <span className="font-medium text-text-strong">
                                  {sed.removed ? 'по СЭД: ' : sed.status === 'signed' || sed.status === 'signed_open' ? 'принято: ' : 'на ком: '}
                                  {sed.holder}
                                </span>
                                {sed.signedAt ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted">
                                    <Check size={10} strokeWidth={2.4} className="text-success" />{fmtSedTs(sed.signedAt)}
                                  </span>
                                ) : sed.launchAt ? (
                                  <span className="text-[10px] text-text-muted">запущен {fmtSedTs(sed.launchAt)}</span>
                                ) : null}
                              </div>
                            ) : sed.launchAt ? (
                              <div className="mt-1 text-[10px] text-text-muted">запущен {fmtSedTs(sed.launchAt)}</div>
                            ) : sed.status === 'no_data' ? null : (
                              <div className="mt-1 text-[10px] text-text-muted">не отправлен</div>
                            )}
                            {sed.removed && (
                              <div className="mt-0.5 text-[10px] font-medium text-presence-away">позиции нет в текущей ZM_VL</div>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
      {/* ПОПАП движения СЭД — «окошко» СПРАВА от блока (как меню), прокручивается, не растит карточку. */}
      {sedPop && (() => {
        const g = obdGroups.find((x) => x.rep.id === sedPop.id);
        const sed = g && g.dlv && g.rep.done_stat !== 'не увезли' ? sedFor(g.rep) : null;
        if (!g || !sed) return null;
        return (
          <>
            <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setSedPop(null); }} />
            <div
              className="fixed z-[70] flex w-[340px] flex-col rounded-lg border border-border-subtle bg-bg-elevated shadow-2xl"
              style={{ top: sedPop.top, left: sedPop.left, maxHeight: Math.max(220, window.innerHeight - sedPop.top - 12) }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">Движение СЭД · {g.dlv}</span>
                <button type="button" onClick={() => setSedPop(null)} className="shrink-0 text-text-muted hover:text-text-strong">
                  <X size={13} strokeWidth={1.9} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {sed.chain.length === 0 ? (
                  <div className="text-[11px] text-text-muted">движение по СЭД ещё не зафиксировано</div>
                ) : ((() => {
                  // Жизненный цикл (юзер 2026-06-22): зелёным — подписанные шаги (готово), ЖЁЛТЫМ —
                  // ТЕКУЩИЙ держатель (первый ожидающий, «на ком сейчас»), СЕРЫМ — что ещё впереди
                  // (последующие ожидания + синтетический шаг приёмки МОЛ, если его в цепочке ещё нет).
                  const firstWaitIdx = sed.chain.findIndex((s) => s.kind === 'wait');
                  const pending = firstWaitIdx >= 0;
                  const hasMolStep = sed.chain.some(
                    (s) => s.prole === 'receiver_mol' || s.molTag != null || s.role === 'получено' || s.role === 'принято',
                  );
                  const synthMol = pending && !hasMolStep; // МОЛ ещё не в цепочке → серый шаг «впереди»
                  const total = sed.chain.length + (synthMol ? 1 : 0);
                  const rows = sed.chain.map((step, i) => {
                    const { ev, role, kind } = step;
                    const future = kind === 'wait' && i > firstWaitIdx; // не первый ожидающий = впереди (серым)
                    const isLast = i === total - 1;
                    const tone = sedStepTone(kind, ev.done_stat, { future });
                    return (
                      <div key={ev.id} className="flex gap-2">
                        <div className="flex flex-col items-center pt-1">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }} />
                          {!isLast && <span className="w-px flex-1" style={{ background: tone.line }} />}
                        </div>
                        <div className="mb-1.5 min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px]" style={{ background: tone.bg }}>
                          <div className="flex items-start justify-between gap-2">
                            <span className={`min-w-0 font-medium ${kind === 'restart' ? 'italic' : ''}`} style={{ color: tone.text }}>{role}</span>
                            <span className="shrink-0 tabular-nums text-text-muted">{fmtSedTs(ev.created_at)}</span>
                          </div>
                          {ev.full_name && kind !== 'restart' && (
                            <div className="mt-0.5 leading-snug text-text-secondary">
                              <div>{ev.full_name}{ev.done_stat && ev.done_stat !== 'запущен в СЭД' && ev.done_stat !== role ? ` · ${ev.done_stat}` : ''}</div>
                              {step.phone && (
                                <a
                                  href={`tel:${step.phone.replace(/[^\d+]/g, '')}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5 inline-flex items-center gap-1 tabular-nums text-accent-clay hover:underline"
                                >
                                  <Phone size={10} strokeWidth={2} />{formatMobilePhone(step.phone)}
                                </a>
                              )}
                              {/* Контакт РЯДОМ (как в базе МОЛ): сначала ЖИВОЙ статус контакта цветом
                                  (зел/красн/нейтр — звонить или нет сейчас), затем МОЛ-метка СНИМКОМ:
                                  «МОЛ по <дату>» (цвет по дедлайну) ЛИБО «не МОЛ». */}
                              {(step.molTag || step.contactStatus) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                  {step.contactStatus && (
                                    <span
                                      className={
                                        molStatusKind(step.contactStatus) === 'ok' ? 'font-medium text-success'
                                          : molStatusKind(step.contactStatus) === 'error' ? 'font-medium text-danger'
                                            : 'text-text-muted'
                                      }
                                    >
                                      {step.contactStatus}
                                    </span>
                                  )}
                                  {step.molTag === 'date' && step.until && (
                                    <span
                                      className={cn(
                                        'inline-flex items-center rounded-md px-1.5 py-0.5 font-medium tabular-nums ring-1',
                                        MOL_UNTIL_PILL_CLASS[molUntilStatus(step.until)],
                                      )}
                                    >
                                      МОЛ по {formatUntilDate(step.until)}
                                    </span>
                                  )}
                                  {step.molTag === 'nemol' && (
                                    <span className="font-medium text-danger">не МОЛ</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                  if (synthMol) {
                    const t = sedStepTone('synthetic', '', { future: true });
                    rows.push(
                      <div key="synth-mol" className="flex gap-2">
                        <div className="flex flex-col items-center pt-1">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.dot }} />
                        </div>
                        <div className="mb-1.5 min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px]" style={{ background: t.bg }}>
                          <span className="font-medium" style={{ color: t.text }}>приёмка МОЛ</span>
                          <span className="ml-1.5 text-text-muted">ожидается</span>
                        </div>
                      </div>,
                    );
                  }
                  return rows;
                })())}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
