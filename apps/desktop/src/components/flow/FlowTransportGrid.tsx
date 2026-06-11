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
import { ClipboardPaste, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import * as Popover from '@radix-ui/react-popover';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import {
  FLOW_TRANSPORT_STATUSES,
  flowTransportAdd,
  flowTransportDelete,
  flowTransportEdit,
  flowTransportGet,
  flowTransportPaste,
  flowVehiclesGet,
  parseTransportPaste,
  type FlowTransportChangedEvent,
  type FlowTransportRow,
  type FlowVehicle,
  type FlowVehiclesChangedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { useWsEvent } from '@/lib/ws';
import { formatMobilePhone } from '@/lib/mol-format';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';
import { VehicleCard } from './VehicleCard';
import { FlowTransportPrint } from './FlowTransportPrint';

/**
 * Вкладка «Транспорт» — реестр «машина на день» (эталон — лист 🚚 Google-файла).
 * Показ «без мусора»: машинные колонки (ВЫЕЗД/ГОС№/тип/модель/тн/габариты/телефон)
 * считаются из БАЗЫ МАШИН (flow_vehicles, ключ — гаражный №), а не из формул листа.
 *
 * Вставка из буфера — шаблон выгрузки КАК ЕСТЬ (29 колонок): наполняет базу машин
 * + строки дня; повторная вставка того же дня обновляет, не дублирует; на НОВУЮ
 * дату постоянные «0.*»-машины (0.1 ФУРГОН КХП / 0.2 БОРТ КХП) добавляются сами.
 *
 * «Добавить» — машина на дату по гаражному №; если машины нет в базе — карточка
 * заполнения (водитель ищется в базе контактов), затем строка добавляется.
 */

interface TrColSpec {
  id: string;
  title: string;
  width: number;
  editable?: boolean;
}

const TR_COLS: readonly TrColSpec[] = [
  { id: 'date', title: 'ДАТА', width: 84 },
  { id: 'garage', title: '№', width: 56, editable: true },
  { id: 'out', title: 'ВЫЕЗД', width: 60 },
  { id: 'gos', title: 'ГОС. №', width: 94 },
  { id: 'model', title: 'МОДЕЛЬ', width: 150 },
  { id: 'vtype', title: 'ТИП', width: 150 },
  { id: 'cap', title: 'ТН', width: 58 },
  { id: 'max', title: 'ДОП.ТН', width: 64 },
  { id: 'len', title: 'Д', width: 50 },
  { id: 'wid', title: 'Ш', width: 50 },
  { id: 'hei', title: 'В', width: 50 },
  { id: 'work', title: 'РАБОТА', width: 250, editable: true },
  { id: 'time', title: '⏰', width: 100, editable: true },
  { id: 'status', title: 'СТАТУС', width: 96, editable: true },
  { id: 'comment', title: 'КОМЕНТ.', width: 170, editable: true },
  { id: 'driver', title: 'ВОДИТЕЛЬ', width: 210, editable: true },
  { id: 'phone', title: 'СОТ.', width: 130, editable: true },
  { id: 'exp', title: 'ЭКСПЕДИТОРЫ', width: 150, editable: true },
  { id: 'ot', title: 'ОТ', width: 56, editable: true },
  { id: 'sp', title: 'СП', width: 56, editable: true },
  { id: 'order', title: 'ЗАКАЗ', width: 116, editable: true },
];

/** YYYY-MM-DD → «8 июня» (короткий показ). */
function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

/** Ключ сортировки РАБОТЫ по числовому префиксу: «0.1…» < «1.1…» < «2.4…» < «10…». */
function workKey(w: string): number {
  const m = /^(\d+)(?:\.(\d+))?/.exec((w || '').trim());
  if (!m) return 9_000_000;
  return Number(m[1]) * 1000 + Number(m[2] ?? 0);
}

/** кг → тонны для показа (пусто если нет). */
function tons(kg: number | null | undefined): string {
  return kg == null || !Number.isFinite(kg) ? '' : fmtSmart(kg / 1000, 3);
}

/** мм → метры для показа. */
function meters(mm: number | null | undefined): string {
  return mm == null || !Number.isFinite(mm) ? '' : fmtSmart(mm / 1000, 2);
}

const TR_RENDERERS = [flowDropdownRenderer];

// Кэш на сессию (мгновенный повторный вход, потом refetch + реалтайм).
let trRowsCache: FlowTransportRow[] | null = null;
let trVehCache: FlowVehicle[] | null = null;

export function FlowTransportGrid(): JSX.Element {
  const [rows, setRows] = useState<FlowTransportRow[]>(() => trRowsCache ?? []);
  const [vehicles, setVehicles] = useState<FlowVehicle[]>(() => trVehCache ?? []);
  const [loading, setLoading] = useState(() => trRowsCache === null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [selection, setSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });
  // «Добавить машину»: поповер с датой+гаражным; карточка открывается, если машины нет.
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [addGarage, setAddGarage] = useState('');
  const [cardGarage, setCardGarage] = useState<string | null>(null); // карточка машины (null — закрыта)
  const pendingAddRef = useRef<{ date: string; garage: string } | null>(null);
  // Печать листа на день: открытый поповер выбора дня + активный запрос печати.
  const [printOpen, setPrintOpen] = useState(false);
  const [printReq, setPrintReq] = useState<{ date: string; mode: 'dialog' | 'save' } | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([flowTransportGet(api), flowVehiclesGet(api)])
      .then(([tr, veh]) => {
        if (!alive) return;
        trRowsCache = tr;
        trVehCache = veh;
        setRows(tr);
        setVehicles(veh);
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

  useWsEvent<FlowTransportChangedEvent>('flow_transport_changed', (e) => {
    setRows((prev) => {
      let next = prev;
      const deleted = new Set(Array.isArray(e.deleted) ? e.deleted : []);
      if (deleted.size > 0) next = next.filter((r) => !deleted.has(r.id));
      const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowTransportRow[]) : [];
      if (incoming.length > 0) {
        const byId = new Map(next.map((r) => [r.id, r] as const));
        for (const r of incoming) {
          const cur = byId.get(r.id);
          if (!cur || Number(r.row_version) >= Number(cur.row_version)) byId.set(r.id, r);
        }
        next = [...byId.values()];
      }
      trRowsCache = next;
      return next;
    });
  });
  useWsEvent<FlowVehiclesChangedEvent>('flow_vehicles_changed', (e) => {
    const incoming = Array.isArray(e.rows) ? (e.rows as unknown as FlowVehicle[]) : [];
    if (incoming.length === 0) return;
    setVehicles((prev) => {
      const byKey = new Map(prev.map((v) => [v.garage_no, v] as const));
      for (const v of incoming) byKey.set(v.garage_no, v);
      const next = [...byKey.values()];
      trVehCache = next;
      return next;
    });
  });

  const vehByGarage = useMemo(() => {
    const m = new Map<string, FlowVehicle>();
    for (const v of vehicles) m.set(v.garage_no, v);
    return m;
  }, [vehicles]);

  // Порядок: свежий день СВЕРХУ; внутри дня — по числовому префиксу РАБОТЫ (как эталон).
  const viewRows = useMemo(() => {
    const out = rows.slice();
    out.sort(
      (a, b) =>
        (b.tdate || '').localeCompare(a.tdate || '') ||
        workKey(a.work) - workKey(b.work) ||
        (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
        a.id - b.id,
    );
    return out;
  }, [rows]);

  const dayCount = useMemo(() => new Set(rows.map((r) => r.tdate)).size, [rows]);

  // Статистика РАБОТ по всей истории: частые (3+ раз) — в выпадашку, порядок по
  // числовому префиксу (0.1 → 1.1 → 8.2). Свой текст вводится прямо в редакторе.
  const workOptions = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const r of rows) {
      const w = (r.work || '').trim();
      if (w) cnt.set(w, (cnt.get(w) ?? 0) + 1);
    }
    return [...cnt.entries()]
      .filter(([, n]) => n >= 3)
      .map(([w]) => w)
      .sort((a, b) => workKey(a) - workKey(b) || a.localeCompare(b, 'ru'));
  }, [rows]);

  const columns = useMemo<GridColumn[]>(
    () => TR_COLS.map((c) => ({ id: c.id, title: c.title, width: c.width })),
    [],
  );

  const cellText = useCallback(
    (spec: TrColSpec, r: FlowTransportRow, rowIdx: number): string => {
      const veh = vehByGarage.get(r.garage_no);
      switch (spec.id) {
        case 'date': {
          // Дата — один раз на блок дня (как разделитель), внутри блока пусто.
          const prev = viewRows[rowIdx - 1];
          return !prev || prev.tdate !== r.tdate ? fmtDay(r.tdate) : '';
        }
        case 'garage':
          return r.garage_no || '';
        case 'out':
          return r.garage_no ? (veh ? (veh.ban ? 'НЕТ' : 'ДА') : '?') : '';
        case 'gos':
          return veh?.gos_no ?? '';
        case 'model':
          return veh?.model ?? '';
        case 'vtype':
          return veh?.vtype ?? '';
        case 'cap':
          return tons(veh?.capacity_kg);
        case 'max':
          return tons(veh?.max_mass_kg);
        case 'len':
          return meters(veh?.len_mm);
        case 'wid':
          return meters(veh?.wid_mm);
        case 'hei':
          return meters(veh?.hei_mm);
        case 'work':
          return r.work || '';
        case 'time':
          return r.time_range || '';
        case 'status':
          return r.status || '';
        case 'comment':
          return r.comment || '';
        case 'driver':
          return r.driver || (veh?.driver ?? '');
        case 'phone': {
          const p = r.driver_phone || (veh?.driver_phone ?? '');
          return p ? formatMobilePhone(p) : '';
        }
        case 'exp':
          return r.expeditors || '';
        case 'ot':
          return r.ot || '';
        case 'sp':
          return r.sp || '';
        case 'order':
          return r.order_no || '';
        default:
          return '';
      }
    },
    [vehByGarage, viewRows],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = TR_COLS[col];
      const r = viewRows[row];
      if (!spec || !r) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      if (spec.id === 'status') {
        // СТАТУС — выпадашка СТРОГО как в эталоне (пусто + 5 значений).
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: r.status || '',
          data: { kind: 'flow-dropdown', value: r.status || '', options: ['', ...FLOW_TRANSPORT_STATUSES] },
        };
        return cell;
      }
      if (spec.id === 'work') {
        // РАБОТА — частые задания из статистики + свой текст (поле сверху, Enter).
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: r.work || '',
          data: { kind: 'flow-dropdown', value: r.work || '', options: workOptions, allowCustom: true },
        };
        return cell;
      }
      const text = cellText(spec, r, row);
      const editable = !!spec.editable;
      // Правки пишем сырьём (телефон — raw цифры), показ — форматированный.
      const rawData =
        spec.id === 'phone'
          ? r.driver_phone || (vehByGarage.get(r.garage_no)?.driver_phone ?? '')
          : spec.id === 'driver'
            ? r.driver || (vehByGarage.get(r.garage_no)?.driver ?? '')
            : text;
      return {
        kind: GridCellKind.Text,
        data: rawData,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        contentAlign: ['cap', 'max', 'len', 'wid', 'hei'].includes(spec.id) ? 'right' : 'left',
      };
    },
    [viewRows, cellText, vehByGarage, workOptions],
  );

  const applyServerRows = useCallback((serverRows: FlowTransportRow[]) => {
    if (serverRows.length === 0) return;
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r] as const));
      for (const r of serverRows) byId.set(r.id, r);
      const next = [...byId.values()];
      trRowsCache = next;
      return next;
    });
  }, []);

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell;
      const spec = TR_COLS[col];
      const r = viewRows[row];
      if (!spec || !r || !spec.editable) return;

      let value = '';
      if (newValue.kind === GridCellKind.Custom) {
        const d = (newValue as FlowDropdownCell).data;
        if (!d || d.kind !== 'flow-dropdown') return;
        value = d.value;
      } else if (newValue.kind === GridCellKind.Text) {
        value = String(newValue.data ?? '').trim();
      } else return;

      const fieldByCol: Record<string, string> = {
        garage: 'garage_no',
        work: 'work',
        time: 'time_range',
        status: 'status',
        comment: 'comment',
        driver: 'driver',
        phone: 'driver_phone',
        exp: 'expeditors',
        ot: 'ot',
        sp: 'sp',
        order: 'order_no',
      };
      const field = fieldByCol[spec.id];
      if (!field) return;
      setMsg('');
      setRows((prev) => {
        const next = prev.map((x) => (x.id === r.id ? ({ ...x, [field]: value } as FlowTransportRow) : x));
        trRowsCache = next;
        return next;
      });
      void flowTransportEdit(api, [{ id: r.id, row_version: r.row_version, fields: { [field]: value } }]).then(
        (res) => applyServerRows(res.rows),
      );
    },
    [viewRows, applyServerRows],
  );

  // Подсветка по статусу + разделение дней (верх блока чуть темнее заголовочно).
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      if (r.status === 'Отклонен' || r.status === 'Отмена') return { textDark: '#9B9892', bgCell: '#F6F5F2' };
      if (r.status === 'Размещен') return { bgCell: '#EAF5EA' };
      if (r.status === 'Новый') return { bgCell: '#FCF3E3' };
      return undefined;
    },
    [viewRows],
  );

  // «Вставить из буфера» — шаблон как есть; разбор у нас, итог тостом.
  const pasteFromClipboard = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    void navigator.clipboard
      .readText()
      .then(async (tsv) => {
        const parsed = parseTransportPaste(tsv);
        if (parsed.length === 0) {
          setMsg('В буфере не нашёл строк шаблона (ДАТА + колонки листа)');
          return;
        }
        const res = await flowTransportPaste(api, parsed);
        const parts = [`+${res.inserted} новых`, `${res.updated} обновлено`];
        if (res.autoAdded > 0) parts.push(`${res.autoAdded} авто 0.x`);
        if (res.vehicles > 0) parts.push(`машин: ${res.vehicles}`);
        setMsg(`Вставка: ${parts.join(' · ')}`);
      })
      .catch((e) => setMsg(`Ошибка вставки: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`))
      .finally(() => setBusy(false));
  }, [busy]);

  // «Добавить машину» на дату: есть в базе → строка; нет → карточка → повтор.
  const runAdd = useCallback(
    (date: string, garage: string) => {
      setBusy(true);
      setMsg('');
      void flowTransportAdd(api, { date, garageNo: garage })
        .then(() => {
          setAddOpen(false);
          setAddGarage('');
          setMsg(`Машина ${garage} добавлена на ${fmtDay(date)}`);
        })
        .catch((e) => {
          const t = e instanceof Error ? e.message : String(e);
          if (t.includes('vehicle_not_found')) {
            // Машины нет в базе → карточка; после сохранения добавим строку сами.
            pendingAddRef.current = { date, garage };
            setCardGarage(garage);
            setAddOpen(false);
          } else setMsg(`Ошибка: ${t.slice(0, 80)}`);
        })
        .finally(() => setBusy(false));
    },
    [],
  );

  const selectedCount = selection.rows.length;
  const deleteSelected = useCallback(() => {
    const ids: number[] = [];
    for (const idx of selection.rows) {
      const r = viewRows[idx];
      if (r) ids.push(r.id);
    }
    if (ids.length === 0) return;
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      trRowsCache = next;
      return next;
    });
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    void flowTransportDelete(api, ids).catch(() => undefined);
  }, [selection, viewRows]);

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
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={busy}
          title="Вставить выгрузку из буфера (шаблон листа как есть) — машины уйдут в базу, строки в дни"
          className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <ClipboardPaste size={13} strokeWidth={1.75} />
          )}
          Вставить из буфера
        </button>
        <Popover.Root open={addOpen} onOpenChange={setAddOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy}
              title="Добавить машину на дату по гаражному № (новая машина — через карточку)"
              className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
            >
              <Plus size={13} strokeWidth={1.75} />
              Добавить
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[230px] rounded-lg border border-border-subtle bg-bg-surface p-3 shadow-lg"
            >
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-text-muted/70">
                  Дата
                  <input
                    type="date"
                    value={addDate}
                    min={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="h-7 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-text-muted/70">
                  Гаражный №
                  <input
                    value={addGarage}
                    onChange={(e) => setAddGarage(e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addGarage && addDate) runAdd(addDate, addGarage);
                    }}
                    placeholder="363"
                    autoFocus
                    className="h-7 rounded-md border border-border-subtle bg-transparent px-2 text-[12px] text-text-primary outline-none focus:border-accent-clay/60"
                  />
                </label>
                <button
                  type="button"
                  disabled={!addGarage || !addDate || busy}
                  onClick={() => runAdd(addDate, addGarage)}
                  className="h-7 rounded-md border border-accent-clay/60 text-[12px] text-text-strong transition-colors hover:bg-accent-clay/15 disabled:opacity-40"
                >
                  Добавить на {fmtDay(addDate)}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {/* Печать листа на день: выбор дня → системная печать или PDF. */}
        <Popover.Root open={printOpen} onOpenChange={setPrintOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              title="Печать листа транспорта на день"
              className="flex h-6 items-center gap-1.5 rounded-md border border-black/10 px-2 text-[#3F3D38] transition-colors hover:border-black/25 hover:text-[#0A0A0A] disabled:opacity-50"
            >
              <Printer size={13} strokeWidth={1.75} />
              Печать
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[230px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
            >
              <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/70">
                Лист на день
              </div>
              <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
                {[...new Set(rows.map((r) => r.tdate))]
                  .sort((a, b) => b.localeCompare(a))
                  .slice(0, 14)
                  .map((d) => (
                    <div key={d} className="flex items-center justify-between gap-1 rounded-md px-2 py-0.5 hover:bg-bg-deep">
                      <span className="text-[12px] text-text-secondary">{fmtDay(d)}</span>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Системная печать"
                          onClick={() => {
                            setPrintOpen(false);
                            setPrintReq({ date: d, mode: 'dialog' });
                          }}
                          className="rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent-clay/60 hover:text-text-strong"
                        >
                          Печать
                        </button>
                        <button
                          type="button"
                          title="Сохранить PDF"
                          onClick={() => {
                            setPrintOpen(false);
                            setPrintReq({ date: d, mode: 'save' });
                          }}
                          className="rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent-clay/60 hover:text-text-strong"
                        >
                          PDF
                        </button>
                      </span>
                    </div>
                  ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <span className="tabular-nums">
          {rows.length} строк · {dayCount} дней · {vehicles.length} машин в базе
        </span>
        {msg && (
          <span className="max-w-[340px] truncate text-[11px] text-[#6B6862]" title={msg}>
            {msg}
          </span>
        )}
        {selectedCount > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums text-[#2A2925]">Выбрано: {selectedCount}</span>
            <button
              type="button"
              onClick={deleteSelected}
              className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#6B6862] transition-colors hover:border-danger/50 hover:text-danger"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Удалить
            </button>
          </div>
        )}
      </div>
      <div ref={measureRef} className="flow-grid relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#FDFDFB]/70 text-[13px] text-[#6B6862]">
            Загрузка транспорта…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
            <span className="text-[14px] font-medium text-[#2A2925]">Транспорта пока нет</span>
            <span>Скопируйте выгрузку и нажмите «Вставить из буфера» — машины уйдут в базу сами.</span>
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
            customRenderers={TR_RENDERERS}
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
      {printReq && (
        <FlowTransportPrint
          date={printReq.date}
          mode={printReq.mode}
          rows={viewRows.filter((r) => r.tdate === printReq.date)}
          vehByGarage={vehByGarage}
          onDone={(ok, error) => {
            setPrintReq(null);
            setMsg(ok ? `Лист на ${fmtDay(printReq.date)} отправлен на печать` : `Печать: ${error ?? 'ошибка'}`);
          }}
        />
      )}
      {cardGarage !== null && (
        <VehicleCard
          garageNo={cardGarage}
          vehicle={vehByGarage.get(cardGarage) ?? null}
          onClose={() => setCardGarage(null)}
          onSaved={(veh) => {
            // Обновляем базу локально и, если карточку открыло «Добавить», доводим добавление.
            setVehicles((prev) => {
              const byKey = new Map(prev.map((v) => [v.garage_no, v] as const));
              byKey.set(veh.garage_no, veh);
              const next = [...byKey.values()];
              trVehCache = next;
              return next;
            });
            setCardGarage(null);
            const pending = pendingAddRef.current;
            if (pending && pending.garage === veh.garage_no) {
              pendingAddRef.current = null;
              runAdd(pending.date, pending.garage);
            }
          }}
        />
      )}
    </div>
  );
}
