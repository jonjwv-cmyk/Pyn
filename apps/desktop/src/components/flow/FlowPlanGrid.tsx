import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  type DataEditorRef,
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { Download, Redo2, Trash2, Undo2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import { colZeroRowSelection } from './flow-grid-selection';
import { FlowSearchPanel } from './FlowSearchPanel';
import { FlowDayPicker } from './FlowDayPicker';
import { useFlowGridSearch, type FlowSearchColumn } from './flow-grid-search';
import { FlowHeaderMenu } from './FlowHeaderMenu';
import { useFlowColumnFilters } from './flow-column-filter';
import { useWarehousesStore } from '@/lib/warehouses-store';
import {
  flowDeliveriesGet,
  flowDeliveriesEdit,
  flowDeliveriesDelete,
  flowWorkflowGet,
  flowWorkflowEdit,
  type FlowDeliveryRow,
  type FlowRow,
  type FlowChangedEvent,
  type FlowDeliveriesChangedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { useVghStore, normVghKey } from '@/lib/vgh-store';
import { ensureVghLoaded } from '@/lib/vgh-repo';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { fmtNum3, MONTH_ABBR_RU, parseMol } from './flow-sandbox.fixtures';
import {
  exportPlanForExpeditors,
  exportPlanFull,
  exportWarehouseSheet,
  type ExportCtx,
  type FlowExportVariant,
} from './flow-export';

/**
 * Этап «План» — грид поставок (flow_deliveries). Модель «якорь + поставки»:
 * МОЛ / «кто согласовал» / комментарий показываются С ЯКОРЯ (строка формирования
 * по ключу заказ+позиция) — правка «кто согласовал» здесь пишет якорь и
 * отражается во всех видах (ТЗ §3.8). Транспорт/кол-во — поля самой поставки.
 *
 * Черновик = поставка без SAP-номера (создана «Сформировать план», ждёт
 * VL10D/zm_vl). Проверка ошибок (ТЗ §3.7, эталон buildPlanDupGh_/buildPlanAggByG_):
 * DUPLICATE — пара поставка+П/П встречается 2+ раз; ERROR — один номер поставки
 * привязан к >1 отправителю ИЛИ >1 получателю. Колонка-флаг + подсветка строки.
 */

interface PlanColSpec {
  id: string;
  title: string;
  width: number;
  editable?: boolean;
}

const PLAN_COLS: readonly PlanColSpec[] = [
  { id: 'date', title: 'ДАТА', width: 78 },
  { id: 'fix', title: 'ФИКС', width: 60 },
  { id: 'dlv', title: 'ПОСТАВКА', width: 112 },
  { id: 'trz', title: 'ТЗ', width: 86, editable: true },
  { id: 'order', title: 'ЗАКАЗ', width: 112 },
  { id: 'fr', title: 'FR', width: 52 },
  { id: 'to', title: 'СП', width: 52 },
  { id: 'clst', title: 'CLST', width: 86 },
  { id: 'mol', title: 'МОЛ', width: 150 },
  { id: 'approved', title: 'СОГЛАСОВАЛ', width: 130, editable: true },
  { id: 'mat', title: 'МАТЕРИАЛ', width: 280 },
  { id: 'uom', title: 'ЕИ', width: 42 },
  { id: 'qty', title: 'КОЛ-ВО', width: 86, editable: true },
  { id: 'kg', title: 'КГ', width: 86 },
  { id: 'v', title: 'V', width: 64 },
  { id: 'exp1', title: 'ЭКСП. 1', width: 118, editable: true },
  { id: 'exp2', title: 'ЭКСП. 2', width: 118, editable: true },
  { id: 'vehicle', title: 'МАШИНА', width: 104, editable: true },
  { id: 'ride', title: 'ID', width: 58, editable: true },
  { id: 'note', title: 'КОММЕНТАРИЙ', width: 230 },
  { id: 'flag', title: 'ПРОВЕРКА', width: 92 },
];

/** Отчёт — те же поставки, но только зафиксированные + отметки выполнения.
 *  P4 (юзер 2026-06-14): «СТАТУС ВЫП.» и «ПРИЧИНА» — ОДНА колонка/редактор. P5: колонки
 *  «ПРОВЕРКА» (дубль/ERROR) в Отчёте нет — там одна и та же поставка, флаг ни к чему. */
const REPORT_COLS: readonly PlanColSpec[] = [
  { id: 'date', title: 'ДАТА', width: 78 },
  { id: 'fix', title: 'ФИКС', width: 60 },
  { id: 'dlv', title: 'ПОСТАВКА', width: 112 },
  { id: 'order', title: 'ЗАКАЗ', width: 112 },
  { id: 'fr', title: 'FR', width: 52 },
  { id: 'to', title: 'СП', width: 52 },
  { id: 'clst', title: 'CLST', width: 86 },
  { id: 'mol', title: 'МОЛ', width: 150 },
  { id: 'mat', title: 'МАТЕРИАЛ', width: 280 },
  { id: 'uom', title: 'ЕИ', width: 42 },
  { id: 'qty', title: 'КОЛ-ВО', width: 86 },
  { id: 'kg', title: 'КГ', width: 86 },
  { id: 'v', title: 'V', width: 64 },
  { id: 'exp1', title: 'ЭКСП. 1', width: 118, editable: true },
  { id: 'exp2', title: 'ЭКСП. 2', width: 118, editable: true },
  { id: 'vehicle', title: 'МАШИНА', width: 104, editable: true },
  { id: 'ride', title: 'ID', width: 58, editable: true },
  { id: 'status', title: 'СТАТУС ВЫП.', width: 210, editable: true },
  { id: 'note', title: 'КОММЕНТАРИЙ', width: 230 },
];

/** Причины невывоза (юзер 2026-06-14) — зеркало серверного списка (валидация). */
const FAIL_REASONS = ['нет на центральном складе', 'менее транспортной нормы', 'брак',
  'на приёмке', 'на входном контроле', 'отказ цеха', 'перенос на другой день',
  'нет МОЛа', 'иные причины'] as const;

/** Статус выполнения (юзер 2026-06-14): по умолчанию «ОЖИДАНИЕ» (пусто в БД), «выполнено»
 *  (зелёный в исходном отчёте) или ПРИЧИНА (серый, не увезено). Стереть ячейку → снова ожидание. */
const STATUS_WAIT = 'ожидание';
const STATUS_DONE = 'выполнено';
/** Опции выпадашки: ожидание / выполнено / каждая причина (выбор причины = «не увезли»). */
const STATUS_OPTIONS: readonly string[] = [STATUS_WAIT, STATUS_DONE, ...FAIL_REASONS];

/** Отображаемое значение статуса из (done_stat, fail_reason). Пусто → «ожидание». */
function statusValue(r: FlowDeliveryRow): string {
  if (r.done_stat === STATUS_DONE || r.done_stat === 'увезли') return STATUS_DONE;
  if (r.fail_reason) return r.fail_reason; // серый: не увезено, причина в ячейке
  if (r.done_stat === 'не увезли') return 'не увезли';
  return STATUS_WAIT; // по умолчанию — ожидание
}

/** Разбор выбранной опции статуса → поля поставки. «ожидание»/пусто → сброс в ноль. */
function decodeStatus(opt: string): { done_stat: string; fail_reason: string } {
  if (opt === STATUS_DONE) return { done_stat: STATUS_DONE, fail_reason: '' };
  if (opt === STATUS_WAIT || opt === '') return { done_stat: '', fail_reason: '' };
  return { done_stat: 'не увезли', fail_reason: opt }; // выбрана причина
}

const PLAN_RENDERERS = [flowDropdownRenderer];

/** Дата плана YYYY-MM-DD → «12 июня» (короткий показ в колонке). */
function fmtPlanDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

/** Число из редактора: запятая→точка, пробелы прочь. null — пусто/не число. */
function parseQty(raw: string): number | null {
  const s = raw.replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Кэш на сессию: мгновенный повторный вход (как у формирования), потом refetch.
let planDlvCache: FlowDeliveryRow[] | null = null;
let planAnchorsCache: FlowRow[] | null = null;

export function FlowPlanGrid({ mode = 'plan' }: { mode?: 'plan' | 'report' }): JSX.Element {
  const COLS = mode === 'report' ? REPORT_COLS : PLAN_COLS;
  const [rows, setRows] = useState<FlowDeliveryRow[]>(() => planDlvCache ?? []);
  const [anchors, setAnchors] = useState<FlowRow[]>(() => planAnchorsCache ?? []);
  const [loading, setLoading] = useState(() => planDlvCache === null);
  const [selection, setSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });
  const gridRef = useRef<DataEditorRef | null>(null);
  // Контейнер DataEditor — также для проверки видимости вкладки в ⌘Z-хоткее.
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [msg, setMsg] = useState('');
  // Календарь выбора дня (P7): null — все дни; иначе фильтр по plan_date.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // CLST: кластер/день доставки склада-получателя из живой базы складов.
  const whById = useWarehousesStore((st) => st.byId);
  // База ВГХ — живые КГ/V (КГ = кол-во × вес на 1 ЕИ; V = кол-во × объём).
  const vghByKey = useVghStore((s) => s.byKey);
  useEffect(() => {
    void ensureVghLoaded();
  }, []);

  // Загрузка: поставки + якоря (строки формирования — МОЛ/коммент/согласовал).
  useEffect(() => {
    let alive = true;
    void Promise.all([flowDeliveriesGet(api), flowWorkflowGet(api)])
      .then(([dlv, wf]) => {
        if (!alive) return;
        planDlvCache = dlv;
        planAnchorsCache = wf;
        setRows(dlv);
        setAnchors(wf);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setLoading(false);
        setMsg(`Ошибка загрузки: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Реалтайм: поставки (план сформирован / правка / резерв).
  useWsEvent<FlowDeliveriesChangedEvent>('flow_deliveries_changed', (e) => {
    setRows((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowDeliveryRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          if (Number(r.reserved) === 1) {
            byId.delete(r.id);
            continue;
          }
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      planDlvCache = next;
      return next;
    });
  });
  // Реалтайм якорей: правка МОЛ/коммента/согласовавшего в формировании видна тут.
  useWsEvent<FlowChangedEvent>('flow_changed', (e) => {
    setAnchors((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      planAnchorsCache = next;
      return next;
    });
  });

  const anchorByKey = useMemo(() => {
    const m = new Map<string, FlowRow>();
    for (const a of anchors) m.set(`${a.ord}|${a.it}`, a);
    return m;
  }, [anchors]);

  // Отчёт: окно 7 дней — строки старше (сегодня−7 по дате плана) ЗАКРЫТЫ полностью
  // (ничего не правится; юзер 2026-06-12 п.2). В Плане замок не действует.
  const reportCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const rowLocked = useCallback(
    (r: FlowDeliveryRow) => mode === 'report' && (r.plan_date || '') < reportCutoff,
    [mode, reportCutoff],
  );

  // База показа (порядок: день плана → группа сборки → номер поставки → материал).
  // Отчёт — только ЗАФИКСИРОВАННЫЕ строки, свежий день СВЕРХУ. Фильтры колонок и
  // колоночная сортировка накладываются ниже (viewRows).
  const baseRows = useMemo(() => {
    // P3 (юзер 2026-06-14): ПЛАН = только НЕзафиксированные черновики (fixation_id===0 и не
    // в резерве). Зафиксированное и сеяный импорт отчёта (fixation_id>0) сюда не попадают.
    let out =
      mode === 'report'
        ? rows.filter((r) => Number(r.fixation_id) > 0)
        : rows.filter((r) => Number(r.fixation_id) === 0 && Number(r.reserved) !== 1);
    // Календарь (P7): выбран день → показываем только его.
    if (selectedDay) out = out.filter((r) => (r.plan_date || '').slice(0, 10) === selectedDay);
    out.sort(
      (a, b) =>
        (mode === 'report'
          ? (b.plan_date || '').localeCompare(a.plan_date || '')
          : (a.plan_date || '').localeCompare(b.plan_date || '')) ||
        (a.grp || '').localeCompare(b.grp || '', 'ru') ||
        (a.dlv || '').localeCompare(b.dlv || '') ||
        (a.mat || '').localeCompare(b.mat || '', 'ru'),
    );
    return out;
  }, [rows, mode, selectedDay]);

  // Проверка ошибок (эталон buildPlanDupGh_ / buildPlanAggByG_): по SAP-номерам.
  const flagById = useMemo(() => {
    const cnt = new Map<string, number>();
    const agg = new Map<string, { fr: Set<string>; to: Set<string> }>();
    for (const r of rows) {
      const dlv = (r.dlv || '').trim();
      if (!dlv) continue;
      const k = `${dlv}|${(r.dlv_pos || '').trim()}`;
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
      let a = agg.get(dlv);
      if (!a) {
        a = { fr: new Set(), to: new Set() };
        agg.set(dlv, a);
      }
      if ((r.fr || '').trim()) a.fr.add((r.fr || '').trim());
      if ((r.to_wh || '').trim()) a.to.add((r.to_wh || '').trim());
    }
    const m = new Map<number, '' | 'DUPLICATE' | 'ERROR'>();
    for (const r of rows) {
      const dlv = (r.dlv || '').trim();
      if (!dlv) {
        m.set(r.id, '');
        continue;
      }
      const a = agg.get(dlv);
      if (a && (a.fr.size > 1 || a.to.size > 1)) m.set(r.id, 'ERROR');
      else if ((cnt.get(`${dlv}|${(r.dlv_pos || '').trim()}`) ?? 0) > 1) m.set(r.id, 'DUPLICATE');
      else m.set(r.id, '');
    }
    return m;
  }, [rows]);

  const draftCount = useMemo(() => rows.filter((r) => !(r.dlv || '').trim()).length, [rows]);
  const groupCount = useMemo(() => {
    const g = new Set<string>();
    for (const r of rows) g.add((r.dlv || '').trim() || `${r.plan_date}·${r.grp}`);
    return g.size;
  }, [rows]);

  const cellText = useCallback(
    (spec: PlanColSpec, r: FlowDeliveryRow): string => {
      const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
      switch (spec.id) {
        case 'date':
          return fmtPlanDate(r.plan_date);
        case 'fix': {
          const b = Number(r.batch_seq) || 0;
          return b === 0 ? '' : b === 1 ? 'план' : `доп ${b}`;
        }
        case 'clst': {
          const wh = whById.get(r.to_wh);
          const day = wh && Number(wh.in_schedule) === 1 ? wh.delivery_day : null;
          if (!day) return 'Нет';
          return wh?.cluster === 'ВЫЕЗД' || wh?.cluster === 'КХП' ? `${day} ${wh.cluster}` : day;
        }
        case 'done':
          return r.done_stat || '';
        case 'reason':
          return r.fail_reason || '';
        case 'status':
          return statusValue(r);
        case 'dlv':
          return (r.dlv || '').trim() ? `${r.dlv}${(r.dlv_pos || '').trim() ? `|${r.dlv_pos}` : ''}` : 'черновик';
        case 'trz':
          return r.trz || '';
        case 'order':
          return `${r.ord}${r.it ? `|${r.it}` : ''}`;
        case 'fr':
          return r.fr || '';
        case 'to':
          return r.to_wh || '';
        case 'mol': {
          // Зафиксированное (ТЗ §3.8 / B) читает ЗАМОРОЖЕННЫЙ snapshot, черновик — живьём
          // с якоря (он мог уехать под новый заказ той же связки).
          if (Number(r.fixation_id) > 0) return r.snap_mol ? (parseMol(r.snap_mol)?.fio ?? r.snap_mol) : '';
          return anchor?.mol ? (parseMol(anchor.mol)?.fio ?? anchor.mol) : '';
        }
        case 'approved':
          return Number(r.fixation_id) > 0 ? r.snap_approved || '' : (anchor?.approved_by ?? '');
        case 'mat':
          return r.mat || '';
        case 'uom':
          return r.uom || '';
        case 'qty':
          return r.qty == null ? '' : fmtNum3(r.qty);
        case 'kg': {
          const w = vghByKey.get(normVghKey(r.no_num))?.weight_kg;
          if (w != null && r.qty != null) return fmtNum3(Math.round(r.qty * w * 1000) / 1000);
          return '—';
        }
        case 'v': {
          const vol = vghByKey.get(normVghKey(r.no_num))?.volume_m3;
          if (vol != null && r.qty != null) return fmtSmart(r.qty * vol, 3);
          return '—';
        }
        case 'exp1':
          return r.exp1 || '';
        case 'exp2':
          return r.exp2 || '';
        case 'vehicle':
          return r.vehicle || '';
        case 'ride':
          return r.ride_id || '';
        case 'note':
          return Number(r.fixation_id) > 0 ? r.snap_note || '' : (anchor?.note ?? '');
        case 'flag':
          return flagById.get(r.id) ?? '';
        default:
          return '';
      }
    },
    [anchorByKey, vghByKey, flagById, whById],
  );

  // ── Поиск как в Формировании (подсветка/перелёт, не фильтр) ───────────────────
  // cellText уже склеивает объединённые колонки (ПОСТАВКА = dlv|pos, ЗАКАЗ = ord|it),
  // поэтому годится и для матча, и для показа совпадения. Индексы колонок поиска = COLS.
  const specById = useMemo(() => {
    const m = new Map<string, PlanColSpec>();
    for (const c of COLS) m.set(c.id, c);
    return m;
  }, [COLS]);
  const searchRaw = useCallback(
    (r: FlowDeliveryRow, colId: string): string => {
      const spec = specById.get(colId);
      return spec ? cellText(spec, r) : '';
    },
    [specById, cellText],
  );
  const searchDisplay = useCallback(
    (col: FlowSearchColumn, r: FlowDeliveryRow): string => {
      const spec = specById.get(col.id);
      return spec ? cellText(spec, r) : '';
    },
    [specById, cellText],
  );
  const searchColumns = useMemo<FlowSearchColumn[]>(
    () => COLS.map((c) => ({ id: c.id, title: c.title })),
    [COLS],
  );

  // Фильтры/сортировка колонок — меню-чек-лист как в Формировании. getValue = cellText
  // (объединённые ПОСТАВКА=dlv|pos, ЗАКАЗ=ord|it уже склеены — фильтр по любому под-значению
  // через поиск в меню). Индексы searchColumns выровнены с COLS/DataEditor.columns.
  const colFilters = useFlowColumnFilters<FlowDeliveryRow>({
    columns: searchColumns,
    rows: baseRows,
    getValue: searchRaw,
  });

  // Показ = база → фильтры колонок → (колоночная сортировка перекрывает дефолтную).
  const viewRows = useMemo(
    () => colFilters.applySort(colFilters.applyFilters(baseRows)),
    [baseRows, colFilters.applyFilters, colFilters.applySort],
  );

  // hasMenu → ▾ меню колонки (фильтр/сорт). Активный фильтр — лёгкая clay-подложка.
  const columns = useMemo<GridColumn[]>(
    () =>
      COLS.map((c) => ({
        id: c.id,
        title: c.title,
        width: c.width,
        hasMenu: true,
        ...(colFilters.activeFilterColIds.has(c.id)
          ? { themeOverride: { bgHeader: '#F4E6DE', bgHeaderHovered: '#EFD9CE' } }
          : {}),
      })),
    [COLS, colFilters.activeFilterColIds],
  );

  const gridSearch = useFlowGridSearch<FlowDeliveryRow>({
    columns: searchColumns,
    rows,
    viewRows,
    gridRef,
    getRaw: searchRaw,
    getDisplay: searchDisplay,
    setSelection,
  });

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      }
      const locked = rowLocked(r);
      if (spec.id === 'status') {
        // P4: объединённая отметка отчёта — одна выпадашка «увезли / не увезли — <причина>».
        const v = statusValue(r);
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: v,
          data: { kind: 'flow-dropdown', value: v, options: STATUS_OPTIONS },
        };
        return cell;
      }
      const text = cellText(spec, r);
      const editable = !!spec.editable && !locked;
      return {
        kind: GridCellKind.Text,
        data: spec.id === 'qty' ? (r.qty == null ? '' : String(r.qty).replace('.', ',')) : text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        contentAlign: spec.id === 'qty' || spec.id === 'kg' || spec.id === 'v' ? 'right' : 'left',
      };
    },
    [viewRows, cellText, COLS, rowLocked],
  );

  /** Применить серверные строки поставок (ответ правки/конфликта). */
  const applyServerDlv = useCallback((serverRows: FlowDeliveryRow[]) => {
    if (serverRows.length === 0) return;
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r] as const));
      for (const r of serverRows) {
        if (Number(r.reserved) === 1) byId.delete(r.id);
        else byId.set(r.id, r);
      }
      const next = [...byId.values()];
      planDlvCache = next;
      return next;
    });
  }, []);

  // ── Отмена/повтор правок (⌘Z / ⌘⇧Z, кнопки) — как в Формировании/Транспорте ───
  // Покрывает ПРАВКИ ПОЛЕЙ ПОСТАВКИ (qty/trz/exp1/exp2/vehicle/ride/done/reason).
  // «Согласовал» — поле ЯКОРЯ (другая таблица) → в историю НЕ кладём (правится из всех
  // видов). Удаление (резерв) тоже отдельно. rowsRef — свежий row_version при применении.
  const rowsRef = useRef<FlowDeliveryRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  type PlanEdit = { id: number; before: Record<string, string | number | null>; after: Record<string, string | number | null> };
  const undoRef = useRef<PlanEdit[]>([]);
  const redoRef = useRef<PlanEdit[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const syncHistory = useCallback(() => {
    setHistory({ canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0 });
  }, []);

  // Применить набор полей к поставке (оптимистично + сервер) БЕЗ записи в историю — общий
  // путь для правки и для отмены/повтора. row_version берём актуальный из rowsRef.
  const applyDlvFields = useCallback(
    (id: number, fields: Record<string, string | number | null>) => {
      const cur = rowsRef.current.find((x) => x.id === id);
      if (!cur) return;
      if (rowLocked(cur)) {
        setMsg('Старше 7 дней — отчёт закрыт, правки заблокированы');
        return;
      }
      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) => (x.id === id ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
        planDlvCache = next;
        rowsRef.current = next;
        return next;
      });
      void flowDeliveriesEdit(api, [{ id, row_version: cur.row_version, fields }]).then((res) =>
        applyServerDlv(res.rows),
      );
    },
    [applyServerDlv, rowLocked],
  );

  // Снимок текущих значений изменяемых полей (ключи fields = имена колонок строки).
  const captureBefore = useCallback(
    (r: FlowDeliveryRow, fields: Record<string, string | number | null>) => {
      const before: Record<string, string | number | null> = {};
      const rec = r as unknown as Record<string, unknown>;
      for (const k of Object.keys(fields)) {
        const v = rec[k];
        before[k] = (v === undefined ? null : v) as string | number | null;
      }
      return before;
    },
    [],
  );
  const pushHistory = useCallback(
    (e: PlanEdit) => {
      undoRef.current.push(e);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = []; // новый шаг обнуляет «повтор»
      syncHistory();
    },
    [syncHistory],
  );
  const undo = useCallback(() => {
    const e = undoRef.current.pop();
    if (!e) return;
    applyDlvFields(e.id, e.before);
    redoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, syncHistory]);
  const redo = useCallback(() => {
    const e = redoRef.current.pop();
    if (!e) return;
    applyDlvFields(e.id, e.after);
    undoRef.current.push(e);
    syncHistory();
  }, [applyDlvFields, syncHistory]);

  // ⌘Z / ⌘⇧Z (Ctrl на Win) — кроме случая когда фокус в поле ввода (там Cmd+Z правит текст).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (!measureRef.current || measureRef.current.offsetParent === null) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell;
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r || !spec.editable) return;
      if (rowLocked(r)) {
        setMsg('Старше 7 дней — отчёт закрыт, правки заблокированы');
        return;
      }
      // Объединённая отметка отчёта приходит из выпадашки (custom cell) — P4.
      if (newValue.kind === GridCellKind.Custom) {
        const d = (newValue as FlowDropdownCell).data;
        if (!d || d.kind !== 'flow-dropdown' || spec.id !== 'status') return;
        const { done_stat, fail_reason } = decodeStatus(d.value);
        const fields: Record<string, string | number | null> = { done_stat, fail_reason };
        const before = captureBefore(r, fields);
        const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
        if (!changed) return;
        applyDlvFields(r.id, fields);
        pushHistory({ id: r.id, before, after: fields });
        return;
      }
      if (newValue.kind !== GridCellKind.Text) return;
      const raw = String(newValue.data ?? '').trim();

      if (spec.id === 'approved') {
        // «Кто согласовал» — поле ЯКОРЯ: пишем строку формирования (отразится во всех видах).
        const anchor = anchorByKey.get(`${r.ord}|${r.it}`);
        if (!anchor) {
          setMsg('Не нашёл позицию формирования для этой поставки');
          return;
        }
        setAnchors((prev) => {
          const next = prev.map((a) => (a.id === anchor.id ? { ...a, approved_by: raw } : a));
          planAnchorsCache = next;
          return next;
        });
        void flowWorkflowEdit(api, [
          { id: anchor.id, row_version: anchor.row_version, fields: { approved_by: raw } },
        ]).then((res) => {
          if (res.rows.length > 0) {
            setAnchors((prev) => {
              const byId = new Map(prev.map((a) => [a.id, a] as const));
              for (const a of res.rows) byId.set(a.id, a);
              const next = [...byId.values()];
              planAnchorsCache = next;
              return next;
            });
          }
        });
        return;
      }

      // Поля самой поставки. Кол-во валидируем ДО оптимистичного показа.
      const fields: Record<string, string | number | null> = {};
      if (spec.id === 'qty') {
        if (Number(r.fixation_id) > 0) {
          setMsg('Состав зафиксирован — кол-во не меняется (свободны машина/экспедиторы/ID)');
          return;
        }
        const n = raw === '' ? null : parseQty(raw);
        if (raw !== '' && (n == null || n < 0)) {
          setMsg(`«${raw}» — не число`);
          return;
        }
        fields.qty = n;
      } else if (spec.id === 'trz') fields.trz = raw;
      else if (spec.id === 'exp1') fields.exp1 = raw;
      else if (spec.id === 'exp2') fields.exp2 = raw;
      else if (spec.id === 'vehicle') fields.vehicle = raw;
      else if (spec.id === 'ride') fields.ride_id = raw;
      else return;

      const before = captureBefore(r, fields);
      const changed = Object.keys(fields).some((k) => String(before[k] ?? '') !== String(fields[k] ?? ''));
      if (!changed) return;
      applyDlvFields(r.id, fields);
      pushHistory({ id: r.id, before, after: fields });
    },
    [viewRows, anchorByKey, applyDlvFields, captureBefore, pushHistory, rowLocked],
  );

  // Подсветка строк: ERROR — красная, DUPLICATE — янтарная, черновик — чуть приглушён.
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      // P5: дубль/ERROR-подсветка — только в Плане (в Отчёте поставка одна и та же).
      if (mode === 'plan') {
        const flag = flagById.get(r.id) ?? '';
        if (flag === 'ERROR') return { bgCell: '#FBE3E0', textDark: '#8A1F11' };
        if (flag === 'DUPLICATE') return { bgCell: '#FCEFD9', textDark: '#7A4B0F' };
      }
      if (mode === 'report') {
        // Зеркало исходного отчёта: выполнено = зелёный, причина (не увезено) = серый,
        // ожидание (по умолчанию) = нейтральный.
        if (r.done_stat === STATUS_DONE || r.done_stat === 'увезли') return { bgCell: '#EAF5EA' };
        if (r.fail_reason || r.done_stat === 'не увезли') return { bgCell: '#F0F0EE', textDark: '#6B6862' };
        if (rowLocked(r)) return { textDark: '#8C8983' }; // закрытый отчёт (>7 дней) — приглушён
      }
      if (!(r.dlv || '').trim()) return { textDark: '#5A5752' };
      return undefined;
    },
    [viewRows, flagById, mode, rowLocked],
  );

  const selectedCount = selection.rows.length;
  /** Массовая отметка отчёта (ТЗ §5.1): одно значение на все выделенные строки,
   *  БЕЗ привязки к складу — выбрал → протянулось. Причина чистится при «увезли». */
  const massMark = useCallback(
    (done: 'выполнено' | 'не увезли', reason: string) => {
      const targets: FlowDeliveryRow[] = [];
      let lockedHit = false;
      for (const idx of selection.rows) {
        const r = viewRows[idx];
        if (!r) continue;
        if (rowLocked(r)) {
          lockedHit = true;
          continue;
        }
        targets.push(r);
      }
      if (lockedHit) setMsg('Часть строк старше 7 дней — отчёт по ним закрыт');
      if (targets.length === 0) return;
      if (!lockedHit) setMsg('');
      const fields = { done_stat: done, fail_reason: done === 'не увезли' ? reason : '' };
      setRows((prev) => {
        const ids = new Set(targets.map((t) => t.id));
        const next = prev.map((x) => (ids.has(x.id) ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
        planDlvCache = next;
        return next;
      });
      void flowDeliveriesEdit(
        api,
        targets.map((t) => ({ id: t.id, row_version: t.row_version, fields })),
      ).then((res) => applyServerDlv(res.rows));
    },
    [selection, viewRows, applyServerDlv, rowLocked],
  );
  const deleteSelected = useCallback(() => {
    const ids: number[] = [];
    for (const idx of selection.rows) {
      const r = viewRows[idx];
      if (r) ids.push(r.id);
    }
    if (ids.length === 0) return;
    // Резерв (не стирание): позиции снова открыты → вернутся в формирование.
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      planDlvCache = next;
      return next;
    });
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    void flowDeliveriesDelete(api, ids).catch(() => undefined);
  }, [selection, viewRows]);

  // Размер контейнера для DataEditor.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridTheme = useMemo<Partial<Theme>>(() => ({ ...FLOW_GRID_THEME }), []);
  const exportCtx = useMemo<ExportCtx>(
    () => ({ anchorByKey, vghByKey, whById }),
    [anchorByKey, vghByKey, whById],
  );
  const runExport = useCallback(
    (variant: FlowExportVariant) => {
      if (viewRows.length === 0) {
        setMsg(mode === 'report' ? 'Отчёт пуст — нечего выгружать' : 'План пуст — нечего выгружать');
        return;
      }
      if (variant === 'full') exportPlanFull(viewRows, exportCtx);
      else if (variant === 'expeditors') exportPlanForExpeditors(viewRows, exportCtx);
      else exportWarehouseSheet(viewRows, exportCtx);
      setMsg('');
    },
    [exportCtx, mode, viewRows],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        {/* Отмена / Повтор правок поставки (как в Формировании/Транспорте) — ⌘Z / ⌘⇧Z. */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={undo}
            disabled={!history.canUndo}
            title="Отменить (⌘Z)"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:cursor-default disabled:opacity-35"
          >
            <Undo2 size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.canRedo}
            title="Повторить (⌘⇧Z)"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:cursor-default disabled:opacity-35"
          >
            <Redo2 size={13} strokeWidth={1.75} />
          </button>
        </div>
        {/* Календарь дня (P7): статусы дней — красный черновики / зелёный фиксация / смешанный. */}
        <FlowDayPicker mode={mode} rows={rows} selected={selectedDay} onSelect={setSelectedDay} />
        <div className="flex items-center gap-1">
          <Download size={13} strokeWidth={1.75} />
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as FlowExportVariant | '';
              if (v) runExport(v);
              e.target.value = '';
            }}
            title="Выгрузить текущий вид в Excel-совместимый CSV"
            className="h-6 max-w-[168px] rounded-md border border-black/10 bg-transparent px-1 text-[12px] text-[#3F3D38] outline-none transition-colors hover:border-black/25"
          >
            <option value="" disabled>
              Экспорт…
            </option>
            <option value="expeditors">Экспедиторам</option>
            <option value="full">{mode === 'report' ? 'Отчёт полный' : 'План полный'}</option>
            <option value="warehouse">Кладовщикам</option>
          </select>
        </div>
        <span className="tabular-nums">
          {rows.length} строк · {groupCount} поставок
          {draftCount > 0 ? ` · черновиков ${draftCount}` : ''}
        </span>
        <span className="text-[#6B6862]/60">
          {mode === 'report'
            ? 'Отчёт — зафиксированные поставки: отметьте «увезли / не увезли» (+причина)'
            : 'МОЛ · согласовал · комментарий — с позиции формирования (общие для всех видов)'}
        </span>
        {msg && (
          <span className="max-w-[300px] truncate text-[11px] text-danger" title={msg}>
            {msg}
          </span>
        )}
        {/* Поиск как в Формировании: панель-поповер по колонкам, подсветка + перелёт (⌘F).
            Не фильтрует строки. Замена скрыта (живая серверная база). */}
        <FlowSearchPanel
          open={gridSearch.open}
          onOpenChange={gridSearch.onOpenChange}
          query={gridSearch.query}
          onQueryChange={gridSearch.onQueryChange}
          groups={gridSearch.groups}
          totalMatches={gridSearch.totalMatches}
          active={gridSearch.activeMatch}
          onGoTo={gridSearch.goToMatch}
          onReplace={gridSearch.replaceAll}
          replaceResult={gridSearch.replaceResult}
          dimmed={gridSearch.dimmed}
          allowReplace={false}
        />
        {selectedCount > 0 && mode === 'report' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            <button
              type="button"
              onClick={() => massMark('выполнено', '')}
              className="rounded-md border border-black/10 px-2 py-0.5 text-[#1F7A33] transition-colors hover:border-[#1F7A33]/50"
            >
              Выполнено
            </button>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  massMark('не увезли', e.target.value);
                  e.target.value = '';
                }
              }}
              className="h-6 rounded-md border border-black/10 bg-transparent px-1 text-[12px] text-[#8A1F11] outline-none"
              title="Причина (не увезено) — выбрать и протянуть на все выделенные"
            >
              <option value="" disabled>
                Причина…
              </option>
              {FAIL_REASONS.map((fr) => (
                <option key={fr} value={fr}>
                  {fr}
                </option>
              ))}
            </select>
          </div>
        )}
        {selectedCount > 0 && mode === 'plan' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            <button
              type="button"
              onClick={deleteSelected}
              title="Убрать в резерв (восстановимо до закрытия месяца) — позиции вернутся в формирование"
              className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Убрать из плана
            </button>
          </div>
        )}
      </div>
      {/* Обёртка relative + измеряемый слой `absolute inset-0` (как в Транспорте): абсолютный
          слой повторяет размер родителя независимо от ширины канваса → появляются полосы
          прокрутки, а flex-1 НЕ растягивается под широкий грид (был баг: много колонок, но не
          прокрутить). */}
      <div className="relative min-h-0 flex-1">
        <div ref={measureRef} className="flow-grid absolute inset-0">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
            Загрузка плана…
          </div>
        )}
        {!loading && viewRows.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
            <span className="text-[14px] font-medium text-[#2A2925]">
              {mode === 'report' ? 'Отчёт пуст' : 'План пуст'}
            </span>
            <span>
              {mode === 'report'
                ? 'Зафиксируйте план на день (кнопка «Зафиксировать» на этапе План).'
                : 'Проставьте даты в колонке DAY формирования и нажмите «Сформировать план».'}
            </span>
          </div>
        )}
        {size.width > 0 && size.height > 0 && (
          <DataEditor
            ref={gridRef}
            theme={gridTheme}
            width={size.width}
            height={size.height}
            columns={columns}
            rows={viewRows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            gridSelection={selection}
            onGridSelectionChange={(sel) => setSelection(colZeroRowSelection(sel) ?? sel)}
            getRowThemeOverride={getRowThemeOverride}
            customRenderers={PLAN_RENDERERS}
            getCellsForSelection
            rowMarkers="none"
            freezeColumns={2}
            rowSelect="multi"
            columnSelect="none"
            rangeSelect="multi-rect"
            rowHeight={22}
            headerHeight={22}
            highlightRegions={gridSearch.highlightRegions}
            onVisibleRegionChanged={gridSearch.onVisibleRegionChanged}
            onHeaderMenuClick={colFilters.handleHeaderMenuClick}
            onKeyDown={(e) => {
              gridSearch.handleKey(e);
            }}
            smoothScrollX
            smoothScrollY
          />
        )}
        </div>
      </div>
      {/* Меню колонки (▾): сорт + поиск по колонке + чек-лист значений — как в Формировании.
          Объединённые ПОСТАВКА/ЗАКАЗ фильтруются по склейке (поиск в меню сужает по под-значению). */}
      <FlowHeaderMenu
        state={colFilters.menu}
        sortDir={colFilters.menuSortDir}
        search={colFilters.menuSearch}
        values={colFilters.menuValues}
        excluded={colFilters.menuExcluded}
        onSort={colFilters.onSort}
        onSortReset={colFilters.onSortReset}
        onSearchChange={colFilters.onMenuSearchChange}
        onToggleValue={colFilters.onToggleValue}
        onClear={colFilters.onClear}
        onDeselectAll={colFilters.onDeselectAll}
        onClose={colFilters.closeMenu}
      />
    </div>
  );
}
