import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { Trash2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
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

/** Отчёт — те же поставки, но только зафиксированные + отметки выполнения. */
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
  { id: 'done', title: 'СТАТУС ВЫП.', width: 100, editable: true },
  { id: 'reason', title: 'ПРИЧИНА', width: 130, editable: true },
  { id: 'note', title: 'КОММЕНТАРИЙ', width: 230 },
  { id: 'flag', title: 'ПРОВЕРКА', width: 92 },
];

/** Причины невывоза (ТЗ §5.1) — зеркало серверного списка. */
const FAIL_REASONS = ['нет на складе', 'мало', 'брак', 'приёмка', 'входной контроль',
  'отказ цеха', 'перенос', 'нет МОЛа', 'иное'] as const;

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
  const [msg, setMsg] = useState('');

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

  // Порядок показа: день плана → группа сборки → номер поставки → материал.
  // Отчёт — только ЗАФИКСИРОВАННЫЕ строки, свежий день СВЕРХУ (работают по дню).
  const viewRows = useMemo(() => {
    const out = (mode === 'report' ? rows.filter((r) => Number(r.fixation_id) > 0) : rows.slice());
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
  }, [rows, mode]);

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

  const columns = useMemo<GridColumn[]>(
    () => COLS.map((c) => ({ id: c.id, title: c.title, width: c.width })),
    [COLS],
  );

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
        case 'mol':
          return anchor?.mol ? (parseMol(anchor.mol)?.fio ?? anchor.mol) : '';
        case 'approved':
          return anchor?.approved_by ?? '';
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
          return anchor?.note ?? '';
        case 'flag':
          return flagById.get(r.id) ?? '';
        default:
          return '';
      }
    },
    [anchorByKey, vghByKey, flagById, whById],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = COLS[col];
      const r = viewRows[row];
      if (!spec || !r) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      }
      const locked = rowLocked(r);
      if (spec.id === 'done' || spec.id === 'reason') {
        // Отметки отчёта — выпадашки (ТЗ §5.1): статус вып. + причина невывоза.
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: spec.id === 'done' ? r.done_stat || '' : r.fail_reason || '',
          data: {
            kind: 'flow-dropdown',
            value: spec.id === 'done' ? r.done_stat || '' : r.fail_reason || '',
            options: spec.id === 'done' ? ['', 'увезли', 'не увезли'] : ['', ...FAIL_REASONS],
          },
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
      // Отметки отчёта приходят из выпадашки (custom cell).
      if (newValue.kind === GridCellKind.Custom) {
        const d = (newValue as FlowDropdownCell).data;
        if (!d || d.kind !== 'flow-dropdown') return;
        const v = d.value;
        const fields: Record<string, string | number | null> = {};
        if (spec.id === 'done') {
          fields.done_stat = v;
          if (v !== 'не увезли' && r.fail_reason) fields.fail_reason = ''; // причина только при «не увезли»
        } else if (spec.id === 'reason') {
          if (v && r.done_stat !== 'не увезли') {
            setMsg('Причина — только при статусе «не увезли»');
            return;
          }
          fields.fail_reason = v;
        } else return;
        setMsg('');
        setRows((prev) => {
          const next = prev.map((x) => (x.id === r.id ? ({ ...x, ...fields } as FlowDeliveryRow) : x));
          planDlvCache = next;
          return next;
        });
        void flowDeliveriesEdit(api, [{ id: r.id, row_version: r.row_version, fields }]).then((res) =>
          applyServerDlv(res.rows),
        );
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

      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) =>
          x.id === r.id ? ({ ...x, ...fields } as FlowDeliveryRow) : x,
        );
        planDlvCache = next;
        return next;
      });
      void flowDeliveriesEdit(api, [{ id: r.id, row_version: r.row_version, fields }]).then((res) => {
        applyServerDlv(res.rows); // успех/конфликт — догоняем серверной версией
      });
    },
    [viewRows, anchorByKey, applyServerDlv, rowLocked],
  );

  // Подсветка строк: ERROR — красная, DUPLICATE — янтарная, черновик — чуть приглушён.
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      const flag = flagById.get(r.id) ?? '';
      if (flag === 'ERROR') return { bgCell: '#FBE3E0', textDark: '#8A1F11' };
      if (flag === 'DUPLICATE') return { bgCell: '#FCEFD9', textDark: '#7A4B0F' };
      if (mode === 'report') {
        if (r.done_stat === 'увезли') return { bgCell: '#EAF5EA' };
        if (r.done_stat === 'не увезли') return { bgCell: '#FBEAE7' };
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
    (done: 'увезли' | 'не увезли', reason: string) => {
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
  const measureRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#FDFDFB]">
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
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
        {selectedCount > 0 && mode === 'report' && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            <button
              type="button"
              onClick={() => massMark('увезли', '')}
              className="rounded-md border border-black/10 px-2 py-0.5 text-[#1F7A33] transition-colors hover:border-[#1F7A33]/50"
            >
              Увезли
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
              title="Не увезли — выбрать причину и протянуть на все выделенные"
            >
              <option value="" disabled>
                Не увезли…
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
      <div ref={measureRef} className="flow-grid relative min-h-0 flex-1">
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
            theme={gridTheme}
            width={size.width}
            height={size.height}
            columns={columns}
            rows={viewRows.length}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            getRowThemeOverride={getRowThemeOverride}
            customRenderers={PLAN_RENDERERS}
            getCellsForSelection
            rowMarkers="none"
            freezeColumns={2}
            rowSelect="multi"
            columnSelect="none"
            rangeSelect="rect"
            rowHeight={22}
            headerHeight={22}
            smoothScrollX
            smoothScrollY
          />
        )}
      </div>
    </div>
  );
}
