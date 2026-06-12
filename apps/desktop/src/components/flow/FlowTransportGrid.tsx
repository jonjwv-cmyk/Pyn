import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from '@glideapps/glide-data-grid';
import { ChevronLeft, ChevronRight, ClipboardPaste, History, Plus, Printer, RefreshCw, Search, Trash2 } from 'lucide-react';
import '@glideapps/glide-data-grid/dist/index.css';
import * as Popover from '@radix-ui/react-popover';
import { FLOW_GRID_THEME } from './flow-grid-theme';
import { flowDropdownRenderer, type FlowDropdownCell } from './flow-dropdown-cell';
import {
  flowDeliveriesGet,
  flowTransportAdd,
  flowTransportDelete,
  flowTransportEdit,
  flowTransportGet,
  flowTransportPaste,
  flowVehiclesGet,
  parseTransportPaste,
  type FlowDeliveryRow,
  type FlowTransportChangedEvent,
  type FlowTransportRow,
  type FlowVehicle,
  type FlowVehiclesChangedEvent,
} from '@pyn/core';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/lib/ws';
import { formatMobilePhone, molStatusKind } from '@/lib/mol-format';
import { usePersonsStore } from '@/lib/persons-store';
import { initPersons } from '@/lib/persons-repo';
import { fmtSmart } from '@/components/vgh/vgh-staging.fixtures';
import { MONTH_ABBR_RU } from './flow-sandbox.fixtures';
import { flowDriverRenderer, type FlowDriverCell, type FlowDriverOption } from './flow-driver-cell';
import { flowStackRenderer, type FlowStackCell } from './flow-stack-cell';
import { colZeroRowSelection } from './flow-grid-selection';
import { VehicleCard } from './VehicleCard';
import { FlowTransportPrint } from './FlowTransportPrint';

/**
 * Раздел «Транспорт» — реестр «машина на день» (эталон — лист 🚚). Показ «без
 * мусора»: машинные колонки считаются из БАЗЫ МАШИН (ключ — гаражный №).
 *
 * По слову юзера (2026-06-11): МАРКА (тип техники из модели, полная модель — по
 * двойному клику), время без ведущих нулей (8:00-20:00), СТАТУС без «(пусто)»
 * (снять = Delete; Размещен — зелёная строка, Отклонен/Отмена — красная), колонка
 * ЦВЕТ возвращена, ТИП переносится по словам, РАБОТА целиком по ширине,
 * РЕЙС — история из отчёта (кто возил, склады ОТ/СП план-факт). Правки/добавление
 * только в пределах 7 дней назад (старое — read-only архив, защита и на сервере).
 */

interface TrColSpec {
  id: string;
  title: string;
  editable?: boolean;
}

// Порядок колонок (юзер 2026-06-12): дата · ИСТОРИЯ(рейс) · статус · работа · время · марка ·
// №·ГОС · выезд · водитель · комментарий. ТИП/ДОП.ТН/ТН/Д/Ш/В — НЕ колонки, а карточка машины
// по двойному клику на №·ГОС (как карточка MAT в формировании). Это ЧИСТО UI-показ: на сервере
// все поля хранятся отдельно (flow_vehicles), вставки приходят по колонкам — мы лишь красиво объединяем.
const TR_COLS: readonly TrColSpec[] = [
  { id: 'date', title: 'ДАТА' },
  { id: 'trip', title: 'ИСТОРИЯ' }, // бывш. РЕЙС — двойной клик: история машины за день
  { id: 'status', title: 'СТАТУС', editable: true },
  { id: 'work', title: 'РАБОТА', editable: true },
  { id: 'time', title: 'ВРЕМЯ', editable: true },
  { id: 'brand', title: 'МАРКА' }, // стек: марка + цвет
  { id: 'garage', title: '№ · ГОС' }, // стек: № (жирный) + гос; двойной клик → карточка характеристик
  { id: 'out', title: 'ВЫЕЗД' },
  { id: 'driver', title: 'ВОДИТЕЛЬ', editable: true }, // ФИО + СОТ под ним
  { id: 'comment', title: 'КОММЕНТАРИЙ', editable: true },
];

/** Порядок статусов в выпадашке — по слову юзера; «(пусто)» НЕТ (снять = Delete). */
const STATUS_ORDER = ['Размещен', 'Отклонен', 'Отмена', 'Новый', 'Открыт'] as const;

/** Шрифт как в Формировании: стандарт 10px на всю таблицу. Мелкие (8px) — только стек-ячейки
 *  МАРКА и №·ГОС (рисуют свой размер сами). Отдельных второстепенных текст-колонок не осталось
 *  (тип/тоннаж/габариты ушли в карточку машины). */
const SMALL_COLS = new Set<string>();
const STD_FONT = '10px';
const SMALL_FONT = '8px';

/** Известные марки техники (канонический регистр). Порядок не важен — матч по токену. */
const BRANDS = [
  'КамАЗ', 'ЗИЛ', 'МАЗ', 'КрАЗ', 'УРАЛ', 'ГАЗ', 'АМКОДОР', 'ЛТМ', 'SDLG', 'МТЗ',
  'UMG', 'JCB', 'HOWO', 'SHACMAN', 'MAN', 'VOLVO', 'SCANIA', 'ISUZU', 'HYUNDAI',
  'ПАЗ', 'КАВЗ', 'НЕФАЗ', 'FAW', 'DONGFENG',
];
const BRAND_BY_KEY = new Map(BRANDS.map((b) => [b.toUpperCase().replace(/-/g, ''), b] as const));

/**
 * МАРКА из полной модели: универсально — первый «словесный» токен без цифр,
 * сведённый к каноническому написанию по словарю (КамАЗ 6520-06 → КамАЗ,
 * «АМКОДОР-332С4-01» → АМКОДОР, «534С» → 534С как есть). Цифры юзеру не важны.
 */
export function vehicleBrand(model: string): string {
  const tokens = (model || '').trim().split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    // токен может быть «АМКОДОР-332С4» — берём буквенную голову до цифры
    const head = t.split(/(?=\d)/)[0]?.replace(/[-–—]+$/, '') ?? '';
    const key = head.toUpperCase().replace(/-/g, '');
    if (key.length >= 2) {
      const known = BRAND_BY_KEY.get(key);
      if (known) return known;
      if (!/\d/.test(head) && /^[A-ZА-ЯЁ]+$/i.test(head) && head.length >= 3) return head.toUpperCase();
    }
  }
  return tokens[0] ?? '';
}

/** YYYY-MM-DD → «8 июня». */
function fmtDay(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return s || '';
  return `${parseInt(m[3] ?? '1', 10)} ${MONTH_ABBR_RU[parseInt(m[2] ?? '1', 10) - 1] ?? ''}`;
}

/** «08:00-20:00» → «8:00-20:00» (ведущие нули из показа убраны). */
function fmtTimeRange(s: string): string {
  return (s || '').replace(/(^|[^\d])0(\d:)/g, '$1$2');
}

/** «20:00» → «8:00 pm» (24-часовое хранение → 12-часовой показ). */
function to12h(hm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return hm.trim();
  let h = Number(m[1]);
  const ampm = h < 12 ? 'am' : 'pm';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}
/** «08:00-20:00» (хранение 24ч) → ['8:00 am','8:00 pm'] (показ/печать 12ч); null если не диапазон. */
export function timeRange12hLines(s: string): [string, string] | null {
  const m = /^\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/.exec(s || '');
  if (!m) return null;
  return [to12h(m[1] ?? ''), to12h(m[2] ?? '')];
}
/** Для ячейки грида: две строки 12ч (или одной строкой 24ч без ведущих нулей, если не диапазон). */
function fmtTimeTwoLine(s: string): string {
  const lines = timeRange12hLines(s);
  return lines ? `${lines[0]}\n${lines[1]}` : fmtTimeRange(s);
}

/** Ключ сортировки РАБОТЫ по числовому префиксу. */
function workKey(w: string): number {
  const m = /^(\d+)(?:\.(\d+))?/.exec((w || '').trim());
  if (!m) return 9_000_000;
  return Number(m[1]) * 1000 + Number(m[2] ?? 0);
}

const tons = (kg: number | null | undefined): string =>
  kg == null || !Number.isFinite(kg) ? '' : fmtSmart(kg / 1000, 3);
const meters = (mm: number | null | undefined): string =>
  mm == null || !Number.isFinite(mm) ? '' : fmtSmart(mm / 1000, 2);

const isoToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Граница правок: сегодня − 7 дней (старое — read-only архив; зеркало серверного guard). */
const editCutoff = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Ключ сортировки склада: Т-код перед обычным (824Т → 8024), как формирование. */
function whKey(code: string): string {
  const s = (code || '').trim().toUpperCase().replace(/T/g, 'Т');
  const m = /^(\d{3})Т$/.exec(s);
  return m ? `${m[1]}0` : s; // 824Т → «8240» < «8024»? нет: «8240» > «8024». Нужен спец-ключ:
}
/** Сравнение складов: по числу, Т-код раньше обычного того же куста (824Т → 8024). */
function cmpWh(a: string, b: string): number {
  const norm = (x: string) => x.trim().toUpperCase().replace(/T/g, 'Т');
  const A = norm(a);
  const B = norm(b);
  // Пары «824Т ↔ 8024»: Т-код считаем тем же числом 8024, но с приоритетом (раньше).
  const baseOf = (x: string) => {
    const mT = /^(\d{3})Т$/.exec(x);
    if (mT) return Number(`80${(mT[1] ?? '').slice(1)}`);
    const mN = /^(\d{4})$/.exec(x);
    return mN ? Number(mN[1]) : Number.MAX_SAFE_INTEGER;
  };
  const tFirst = (x: string) => (/^\d{3}Т$/.test(x) ? 0 : 1);
  return baseOf(A) - baseOf(B) || tFirst(A) - tFirst(B) || A.localeCompare(B, 'ru');
}

const TR_RENDERERS = [flowDropdownRenderer, flowDriverRenderer, flowStackRenderer];

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
  // Поиск + фильтры (статус-чипы, день).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set());
  const [dayFilter, setDayFilter] = useState('');
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  // «Добавить машину»: дата (наш мини-календарь) + гаражный; карточка при отсутствии в базе.
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(isoToday);
  const [addGarage, setAddGarage] = useState('');
  const [cardGarage, setCardGarage] = useState<string | null>(null);
  const pendingAddRef = useRef<{ date: string; garage: string } | null>(null);
  // Печать (превью-окно) + РЕЙС-поповер.
  const [printDay, setPrintDay] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [trip, setTrip] = useState<{ row: FlowTransportRow; x: number; y: number } | null>(null);
  // Карточка характеристик машины (по двойному клику на №·ГОС).
  const [specCard, setSpecCard] = useState<{ garage: string; veh: FlowVehicle | null; x: number; y: number } | null>(null);
  const gridRef = useRef<DataEditorRef | null>(null);

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

  // База контактов — кандидаты в водители (должность содержит «водитель»; юзер 2026-06-12 п.4).
  const persons = usePersonsStore((s) => s.persons);
  useEffect(() => {
    void initPersons();
  }, []);
  const driverOptions = useMemo<FlowDriverOption[]>(() => {
    // Цвет статуса — как у МОЛ в формировании (зел/красн/серый).
    const COLOR = { ok: '#3FB950', error: '#F85149', neutral: '#9AA0A6' } as const;
    const out: FlowDriverOption[] = [];
    for (const p of persons) {
      // «водитель» как ОТДЕЛЬНОЕ слово (не часть «руководитель» и т.п.; юзер 2026-06-12):
      // совпадение «водител» только в начале токена (предыдущий символ — не буква).
      if (!/(?:^|[^а-яёa-z])водител/i.test(p.position || '')) continue;
      const phone = p.mobile || p.work || '';
      // Ближайший срок «по дату» из складов (если человек МОЛ).
      let until = '';
      for (const w of p.warehouses) if (w.until && (!until || w.until < until)) until = w.until;
      out.push({
        fio: p.fio,
        position: p.position || '',
        phone,
        phoneDisplay: phone ? formatMobilePhone(phone) : '',
        status: p.status || '',
        color: COLOR[molStatusKind(p.status || '')],
        isMol: p.isMol,
        until,
      });
    }
    out.sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    return out;
  }, [persons]);
  const driverByFio = useMemo(() => {
    const m = new Map<string, FlowDriverOption>();
    for (const o of driverOptions) m.set(o.fio, o);
    return m;
  }, [driverOptions]);

  const cellText = useCallback(
    (specId: string, r: FlowTransportRow): string => {
      const veh = vehByGarage.get(r.garage_no);
      switch (specId) {
        case 'date':
          return fmtDay(r.tdate);
        case 'brand':
          return veh?.model ? vehicleBrand(veh.model) : '';
        case 'garage':
          return r.garage_no || '';
        case 'out':
          return r.garage_no ? (veh ? (veh.ban ? 'НЕТ' : 'ДА') : '?') : '';
        case 'gos':
          return veh?.gos_no ?? '';
        case 'color':
          return veh?.color ?? '';
        case 'vtype':
          return veh?.vtype ?? '';
        case 'max':
          return tons(veh?.max_mass_kg);
        case 'cap':
          return tons(veh?.capacity_kg);
        case 'len':
          return meters(veh?.len_mm);
        case 'wid':
          return meters(veh?.wid_mm);
        case 'hei':
          return meters(veh?.hei_mm);
        case 'work':
          return r.work || '';
        case 'time':
          return fmtTimeRange(r.time_range);
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
        case 'trip':
          return '⟲';
        default:
          return '';
      }
    },
    [vehByGarage],
  );

  // Порядок: свежий день сверху, внутри дня по номеру работы; + поиск/фильтры.
  const viewRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (dayFilter && r.tdate !== dayFilter) return false;
      if (statusFilter.size > 0 && !statusFilter.has(r.status || '')) return false;
      if (q) {
        const veh = vehByGarage.get(r.garage_no);
        const hay = [
          r.garage_no, veh?.model, veh?.gos_no, veh?.vtype, veh?.color, r.work,
          r.time_range, r.status, r.comment, r.driver || veh?.driver, r.driver_phone || veh?.driver_phone,
          r.order_no, fmtDay(r.tdate),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort(
      (a, b) =>
        (b.tdate || '').localeCompare(a.tdate || '') ||
        workKey(a.work) - workKey(b.work) ||
        (a.garage_no || '').localeCompare(b.garage_no || '', 'ru') ||
        a.id - b.id,
    );
    return out;
  }, [rows, search, statusFilter, dayFilter, vehByGarage]);

  const dayCount = useMemo(() => new Set(rows.map((r) => r.tdate)).size, [rows]);
  const allDays = useMemo(() => [...new Set(rows.map((r) => r.tdate))].sort((a, b) => b.localeCompare(a)), [rows]);

  // Частые РАБОТЫ (3+ раз) — выпадашка + свой текст.
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

  // Авто-ширина «как формирование»: замер уникальных значений колонок (12px Inter),
  // клампы; РАБОТА и ТИП вписываются целиком (ТИП дополнительно переносится).
  const colWidths = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const widths = new Map<string, number>();
    if (!ctx) return widths;
    const sample = viewRows.length > 0 ? viewRows : rows;
    // Стек-ячейки (марка+цвет, №·гос) рисуются мелким (8px) — меряем тем же.
    const isSmallFont = (id: string) => SMALL_COLS.has(id) || id === 'garage' || id === 'brand';
    for (const spec of TR_COLS) {
      // Заголовок меряем шрифтом шапки (600 11px); значения — шрифтом тела колонки (10/8px).
      ctx.font = '600 11px "Inter Variable", system-ui, sans-serif';
      let max = ctx.measureText(spec.title).width;
      ctx.font = `${isSmallFont(spec.id) ? SMALL_FONT : STD_FONT} "Inter Variable", system-ui, sans-serif`;
      const uniq = new Set<string>();
      for (const r of sample) uniq.add(cellText(spec.id, r));
      // Объединённые ячейки — учесть и нижнюю строку (ГОС у гаражного, ЦВЕТ у марки).
      if (spec.id === 'garage') for (const r of sample) uniq.add(cellText('gos', r));
      else if (spec.id === 'brand') for (const r of sample) uniq.add(cellText('color', r));
      for (const v of uniq) max = Math.max(max, ctx.measureText(v).width);
      // Плотная подгонка по тексту (юзер: «много пустот» → меньше pad/мин-ширины).
      const pad = 12;
      const cap = spec.id === 'vtype' ? 150 : spec.id === 'work' ? 380 : spec.id === 'comment' ? 240 : spec.id === 'driver' ? 220 : 300;
      widths.set(spec.id, Math.min(cap, Math.max(32, Math.ceil(max + pad))));
    }
    return widths;
  }, [viewRows, rows, cellText]);

  // Колонка ДАТА показывается ТОЛЬКО в режиме «Все дни»: когда выбран конкретный день
  // (через календарь-фильтр), дата и так в шапке-фильтре → колонку прячем (юзер 2026-06-12 п.6).
  const showDate = dayFilter === '';
  const cols = useMemo(() => (showDate ? TR_COLS : TR_COLS.filter((c) => c.id !== 'date')), [showDate]);

  const columns = useMemo<GridColumn[]>(
    () => cols.map((c) => ({ id: c.id, title: c.title, width: colWidths.get(c.id) ?? 80 })),
    [cols, colWidths],
  );

  // Высота строки фиксирована и выше обычной: вмещает ВОДИТЕЛЬ (ФИО + СОТ под ним) и
  // ВРЕМЯ в две строки (юзер 2026-06-12 п.6); ТИП-перенос на 2 слова тоже влезает.
  const getRowHeight = useCallback((): number => 36, []);

  const cutoff = editCutoff();
  const rowLocked = useCallback((r: FlowTransportRow) => r.tdate < cutoff, [cutoff]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      const locked = rowLocked(r);
      if (spec.id === 'status') {
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: r.status || '',
          data: { kind: 'flow-dropdown', value: r.status || '', options: STATUS_ORDER },
        };
        return cell;
      }
      if (spec.id === 'work') {
        const cell: FlowDropdownCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: r.work || '',
          data: { kind: 'flow-dropdown', value: r.work || '', options: workOptions, allowCustom: true },
        };
        return cell;
      }
      const text = cellText(spec.id, r);
      // Шрифт значения: стандарт 10px, второстепенные — 8px (как в Формировании).
      const fontOverride = { baseFontStyle: SMALL_COLS.has(spec.id) ? SMALL_FONT : STD_FONT };
      if (spec.id === 'brand') {
        // МАРКА (сверху) + ЦВЕТ кузова (снизу) — одна ячейка (юзер 2026-06-12).
        const veh = vehByGarage.get(r.garage_no);
        const cell: FlowStackCell = {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: [text, veh?.color ?? ''].filter(Boolean).join(' · '),
          data: { kind: 'flow-stack', top: text, bottom: veh?.color ?? '', small: true },
        };
        return cell;
      }
      if (spec.id === 'garage') {
        // Гаражный № (жирный, сверху) + ГОС. № (снизу) — одна ячейка (юзер 2026-06-12).
        const veh = vehByGarage.get(r.garage_no);
        const cell: FlowStackCell = {
          kind: GridCellKind.Custom,
          allowOverlay: false,
          copyData: [r.garage_no, veh?.gos_no ?? ''].filter(Boolean).join(' · '),
          data: { kind: 'flow-stack', top: r.garage_no || '', bottom: veh?.gos_no ?? '', boldTop: true, small: true },
        };
        return cell;
      }
      if (spec.id === 'driver') {
        // ВОДИТЕЛЬ: ФИО + СОТ под ним; двойной клик → поиск по базе водителей.
        const veh = vehByGarage.get(r.garage_no);
        const driver = r.driver || (veh?.driver ?? '');
        const phone = r.driver_phone || (veh?.driver_phone ?? '');
        const cell: FlowDriverCell = {
          kind: GridCellKind.Custom,
          allowOverlay: !locked,
          copyData: driver,
          data: {
            kind: 'flow-driver',
            driver,
            phone,
            phoneDisplay: phone ? formatMobilePhone(phone) : '',
            color: driverByFio.get(driver)?.color ?? '',
            isMol: driverByFio.get(driver)?.isMol ?? false,
            until: driverByFio.get(driver)?.until ?? '',
            drivers: driverOptions,
          },
        };
        return cell;
      }
      const editable = !!spec.editable && !locked;
      if (spec.id === 'time') {
        // ВРЕМЯ в две строки: начало сверху, конец снизу (юзер 2026-06-12 п.6).
        return {
          kind: GridCellKind.Text,
          data: r.time_range,
          displayData: fmtTimeTwoLine(r.time_range),
          allowOverlay: editable,
          readonly: !editable,
          allowWrapping: true,
        };
      }
      const rawData = text;
      return {
        kind: GridCellKind.Text,
        data: rawData,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        allowWrapping: spec.id === 'comment', // КОМЕНТ. переносится по словам (строка 36px вмещает 2)
        contentAlign: ['max', 'cap', 'len', 'wid', 'hei'].includes(spec.id) ? 'right' : spec.id === 'trip' ? 'center' : 'left',
        themeOverride: fontOverride,
      };
    },
    [viewRows, cellText, vehByGarage, workOptions, rowLocked, driverOptions, driverByFio, cols],
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
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r) return;
      if (rowLocked(r)) {
        setMsg('Старше 7 дней — архив, правки заблокированы');
        return;
      }
      // ВОДИТЕЛЬ — особый случай: пишем ФИО + телефон ОДНОЙ правкой (телефон из базы водителей).
      if (spec.id === 'driver' && newValue.kind === GridCellKind.Custom) {
        const d = (newValue as FlowDriverCell).data;
        if (!d || d.kind !== 'flow-driver') return;
        const fields = { driver: d.driver, driver_phone: d.phone };
        setMsg('');
        setRows((prev) => {
          const next = prev.map((x) => (x.id === r.id ? ({ ...x, ...fields } as FlowTransportRow) : x));
          trRowsCache = next;
          return next;
        });
        void flowTransportEdit(api, [{ id: r.id, row_version: r.row_version, fields }]).then((res) =>
          applyServerRows(res.rows),
        );
        return;
      }
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
    [viewRows, applyServerRows, rowLocked, cols],
  );

  // Двойной клик/Enter: ИСТОРИЯ → поповер истории (план+факт из отчёта); №·ГОС → карточка
  // характеристик машины (тип/доп.тн/тн/Д/Ш/В — как карточка MAT в формировании).
  const onCellActivated = useCallback(
    ([col, row]: Item) => {
      const spec = cols[col];
      const r = viewRows[row];
      if (!spec || !r || !r.garage_no) return;
      const b = gridRef.current?.getBounds(col, row);
      if (!b) return;
      if (spec.id === 'trip') {
        setTrip({ row: r, x: b.x + b.width / 2, y: b.y + b.height });
      } else if (spec.id === 'garage') {
        const veh = vehByGarage.get(r.garage_no) ?? null;
        setSpecCard({ garage: r.garage_no, veh, x: b.x + b.width / 2, y: b.y + b.height });
      }
    },
    [viewRows, cols, vehByGarage],
  );

  // Подкраска по статусу (юзер): Размещен — зелёная; Отклонен/Отмена — красная;
  // Новый/Открыт — без подкраски. Архив (старше 7 дней) — слегка приглушён.
  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => {
      const r = viewRows[row];
      if (!r) return undefined;
      if (r.status === 'Размещен') return { bgCell: '#EAF5EA' };
      if (r.status === 'Отклонен' || r.status === 'Отмена') return { bgCell: '#FBE7E4', textDark: '#7A2A1D' };
      if (rowLocked(r)) return { textDark: '#8C8983' };
      return undefined;
    },
    [viewRows, rowLocked],
  );

  const pasteFromClipboard = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    void navigator.clipboard
      .readText()
      .then(async (tsv) => {
        const parsed = parseTransportPaste(tsv);
        if (parsed.length === 0) {
          setMsg('В буфере не нашёл строк шаблона (пришли образец — подгоню разбор)');
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

  const runAdd = useCallback((date: string, garage: string) => {
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
          pendingAddRef.current = { date, garage };
          setCardGarage(garage);
          setAddOpen(false);
        } else if (t.includes('date_too_old')) setMsg('Дата старше 7 дней — добавлять нельзя');
        else setMsg(`Ошибка: ${t.slice(0, 80)}`);
      })
      .finally(() => setBusy(false));
  }, []);

  const selectedCount = selection.rows.length;
  const deleteSelected = useCallback(() => {
    const ids: number[] = [];
    let lockedHit = false;
    for (const idx of selection.rows) {
      const r = viewRows[idx];
      if (!r) continue;
      if (rowLocked(r)) {
        lockedHit = true;
        continue;
      }
      ids.push(r.id);
    }
    if (lockedHit) setMsg('Часть строк старше 7 дней — они не удаляются (архив)');
    if (ids.length === 0) return;
    setRows((prev) => {
      const drop = new Set(ids);
      const next = prev.filter((r) => !drop.has(r.id));
      trRowsCache = next;
      return next;
    });
    setSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    void flowTransportDelete(api, ids).catch(() => undefined);
  }, [selection, viewRows, rowLocked]);

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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={busy}
          title="Вставить выгрузку из буфера — машины уйдут в базу, строки в дни (старше 7 дней пропускаются)"
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
              className="z-50 w-[248px] rounded-lg border border-border-subtle bg-bg-surface p-3 shadow-lg"
            >
              <div className="flex flex-col gap-2">
                <FlowMiniCalendar value={addDate} minDate={cutoff} onChange={setAddDate} />
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
        {/* Печать: превью-окно листа на день (как График — видишь, что уйдёт на бумагу). */}
        <Popover.Root open={printOpen} onOpenChange={setPrintOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              title="Печать листа транспорта на день (с предпросмотром)"
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
              className="z-50 w-[200px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
            >
              <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted/70">
                Лист на день
              </div>
              <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
                {allDays.slice(0, 14).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setPrintOpen(false);
                      setPrintDay(d);
                    }}
                    className="rounded-md px-2 py-1 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-deep hover:text-text-strong"
                  >
                    {fmtDay(d)}
                  </button>
                ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {/* Поиск + фильтры. */}
        <div className="flex h-6 items-center gap-1 rounded-md border border-black/10 px-1.5">
          <Search size={12} strokeWidth={1.75} className="text-[#6B6862]/70" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="w-[130px] bg-transparent text-[12px] text-[#0A0A0A] outline-none placeholder:text-[#6B6862]/50"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="text-[#6B6862] hover:text-[#0A0A0A]">
              ×
            </button>
          )}
        </div>
        {/* Выбор дня — наш календарь (юзер 2026-06-12 п.5). «Все дни» сбрасывает фильтр. */}
        <Popover.Root open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              title="Выбрать день (календарь)"
              className={cn(
                'flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] outline-none transition-colors',
                dayFilter
                  ? 'border-accent-clay/70 text-[#0A0A0A]'
                  : 'border-black/10 text-[#3F3D38] hover:border-black/25',
              )}
            >
              {dayFilter ? fmtDay(dayFilter) : 'Все дни'}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-[248px] rounded-lg border border-border-subtle bg-bg-surface p-2 shadow-lg"
            >
              <button
                type="button"
                onClick={() => {
                  setDayFilter('');
                  setDayPickerOpen(false);
                }}
                className={cn(
                  'mb-2 h-7 w-full rounded-md border text-[12px] transition-colors',
                  dayFilter
                    ? 'border-border-subtle text-text-secondary hover:border-border-default'
                    : 'border-accent-clay/60 text-text-strong',
                )}
              >
                Все дни
              </button>
              <FlowMiniCalendar
                value={dayFilter || allDays[0] || isoToday()}
                onChange={(iso) => {
                  setDayFilter(iso);
                  setDayPickerOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="flex items-center gap-1">
          {STATUS_ORDER.map((st) => {
            const on = statusFilter.has(st);
            return (
              <button
                key={st}
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(st)) next.delete(st);
                    else next.add(st);
                    return next;
                  })
                }
                title={`Фильтр: ${st}`}
                className={cn(
                  'rounded-full border px-1.5 py-[1px] text-[11px] transition-colors',
                  on ? 'border-accent-clay/70 text-[#0A0A0A]' : 'border-black/10 text-[#6B6862]/70 hover:text-[#3F3D38]',
                )}
              >
                {st}
              </button>
            );
          })}
        </div>
        {msg && (
          <span className="max-w-[300px] truncate text-[11px] text-[#6B6862]" title={msg}>
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
        {!loading && viewRows.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-[13px] text-[#6B6862]">
            <span className="text-[14px] font-medium text-[#2A2925]">Пусто</span>
            <span>Вставьте выгрузку из буфера или снимите фильтры.</span>
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
            onCellActivated={onCellActivated}
            gridSelection={selection}
            onGridSelectionChange={(sel) => setSelection(colZeroRowSelection(sel) ?? sel)}
            getRowThemeOverride={getRowThemeOverride}
            customRenderers={TR_RENDERERS}
            getCellsForSelection
            rowMarkers="none"
            freezeColumns={showDate ? 2 : 1}
            rowSelect="multi"
            columnSelect="none"
            rangeSelect="multi-rect"
            rowHeight={getRowHeight}
            headerHeight={22}
            smoothScrollX
            smoothScrollY
          />
        )}
      </div>
      {/* Нижняя строка-счётчик (как в Формировании, юзер 2026-06-12 п.8): сколько строк/дней/машин. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-black/[0.06] px-4 py-1.5 text-[12px] text-[#6B6862]">
        {selectedCount > 0 && (
          <span>
            Выбрано: <span className="tabular-nums text-[#2A2925]">{selectedCount}</span>
          </span>
        )}
        <span className="ml-auto tabular-nums">
          {viewRows.length !== rows.length ? (
            <>
              Показано <span className="text-[#2A2925]">{viewRows.length}</span> из{' '}
              <span className="text-[#2A2925]">{rows.length}</span> строк
            </>
          ) : (
            <>
              <span className="text-[#2A2925]">{rows.length}</span> строк
            </>
          )}{' '}
          · <span className="text-[#2A2925]">{dayCount}</span> дней ·{' '}
          <span className="text-[#2A2925]">{vehicles.length}</span> машин
        </span>
      </div>
      {trip && (
        <TransportTripCard
          row={trip.row}
          x={trip.x}
          y={trip.y}
          onClose={() => setTrip(null)}
        />
      )}
      {specCard && (
        <VehicleSpecCard
          garage={specCard.garage}
          veh={specCard.veh}
          x={specCard.x}
          y={specCard.y}
          onClose={() => setSpecCard(null)}
        />
      )}
      {printDay && (
        <FlowTransportPrint
          date={printDay}
          rows={rows
            .filter((r) => r.tdate === printDay)
            .sort((a, b) => workKey(a.work) - workKey(b.work) || a.id - b.id)}
          vehByGarage={vehByGarage}
          onClose={() => setPrintDay(null)}
        />
      )}
      {cardGarage !== null && (
        <VehicleCard
          garageNo={cardGarage}
          vehicle={vehByGarage.get(cardGarage) ?? null}
          onClose={() => setCardGarage(null)}
          onSaved={(veh) => {
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

/**
 * Мини-календарь в стиле приложения (вместо нативного date-input): месяц листается,
 * даты раньше `minDate` задизейблены (защита 7 дней). Переиспользуемый.
 */
export function FlowMiniCalendar({
  value,
  minDate,
  onChange,
}: {
  value: string;
  minDate?: string;
  onChange: (iso: string) => void;
}): JSX.Element {
  const init = /^\d{4}-(\d{2})/.exec(value);
  const [ym, setYm] = useState(() => ({
    y: init ? Number(value.slice(0, 4)) : new Date().getFullYear(),
    m: init ? Number(value.slice(5, 7)) : new Date().getMonth() + 1,
  }));
  const first = new Date(ym.y, ym.m - 1, 1);
  const startWd = (first.getDay() + 6) % 7; // ПН=0
  const daysIn = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWd }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => i + 1),
  ];
  const iso = (d: number) => `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return (
    <div className="rounded-md border border-border-subtle p-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[12px] font-medium text-text-strong">
          {MONTH_ABBR_RU[ym.m - 1]} {ym.y}
        </span>
        <button
          type="button"
          onClick={() => setYm((p) => (p.m === 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m: p.m + 1 }))}
          className="rounded p-0.5 text-text-muted hover:text-text-strong"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[2px] text-center text-[10px] text-text-muted/60">
        {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-[2px]">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const dIso = iso(d);
          const disabled = !!minDate && dIso < minDate;
          const selected = dIso === value;
          return (
            <button
              key={dIso}
              type="button"
              disabled={disabled}
              onClick={() => onChange(dIso)}
              className={cn(
                'rounded py-[2px] text-[11px] tabular-nums transition-colors',
                selected
                  ? 'bg-accent-clay/25 font-semibold text-text-strong'
                  : disabled
                    ? 'cursor-default text-text-muted/30'
                    : 'text-text-secondary hover:bg-accent-clay/15 hover:text-text-strong',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * РЕЙС — история машины за день из ОТЧЁТА: по зафиксированным поставкам с
 * ID == гаражный №: экспедиторы + склады ОТ/СП (план и факт). Склад зелёный,
 * если ХОТЬ ОДНА его поставка «увезли»; серый — всё отменено/не увезено.
 */
function TransportTripCard({
  row,
  x,
  y,
  onClose,
}: {
  row: FlowTransportRow;
  x: number;
  y: number;
  onClose: () => void;
}): JSX.Element {
  const [dlv, setDlv] = useState<FlowDeliveryRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void flowDeliveriesGet(api, { planDate: row.tdate })
      .then((rows) => {
        if (alive) setDlv(rows.filter((d) => Number(d.fixation_id) > 0 && (d.ride_id || '').trim() === row.garage_no));
      })
      .catch(() => {
        if (alive) setDlv([]);
      });
    return () => {
      alive = false;
    };
  }, [row]);

  const { exps, fromWhs, toWhs } = useMemo(() => {
    const e = new Set<string>();
    const from = new Map<string, boolean>(); // склад → есть «увезли»
    const to = new Map<string, boolean>();
    for (const d of dlv ?? []) {
      if (d.exp1) e.add(d.exp1);
      if (d.exp2) e.add(d.exp2);
      const ok = d.done_stat === 'увезли';
      if ((d.fr || '').trim()) from.set(d.fr, (from.get(d.fr) ?? false) || ok);
      if ((d.to_wh || '').trim()) to.set(d.to_wh, (to.get(d.to_wh) ?? false) || ok);
    }
    const sortEntries = (m: Map<string, boolean>) => [...m.entries()].sort((a, b) => cmpWh(a[0], b[0]));
    return { exps: [...e], fromWhs: sortEntries(from), toWhs: sortEntries(to) };
  }, [dlv]);

  const pill = ([wh, ok]: [string, boolean]) => (
    <span
      key={wh}
      className={cn(
        'rounded-full border px-1.5 py-[1px] text-[11px] tabular-nums',
        ok ? 'border-[#1F7A33]/50 bg-[#EAF5EA] text-[#1F7A33]' : 'border-black/15 bg-black/[0.04] text-[#8C8983]',
      )}
    >
      {wh}
    </span>
  );

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-[280px] -translate-x-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 shadow-xl"
        style={{ left: x, top: y + 4 }}
      >
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-strong">
          <History size={13} strokeWidth={1.75} className="text-accent-clay" />
          Машина {row.garage_no} · {fmtDay(row.tdate)}
        </div>
        {dlv === null && <div className="mt-2 text-[12px] text-text-muted">Загрузка…</div>}
        {dlv !== null && dlv.length === 0 && (
          <div className="mt-2 text-[12px] text-text-muted">
            В отчёте нет зафиксированных поставок с ID {row.garage_no} на этот день.
          </div>
        )}
        {dlv !== null && dlv.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 text-[12px] text-text-secondary">
            {exps.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-text-muted/60">Экспедиторы</div>
                <div>{exps.join(', ')}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted/60">ОТ (склады-отправители)</div>
              <div className="mt-0.5 flex flex-wrap gap-1">{fromWhs.map(pill)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-text-muted/60">СП (получатели)</div>
              <div className="mt-0.5 flex flex-wrap gap-1">{toWhs.map(pill)}</div>
            </div>
            <div className="text-[10px] text-text-muted/60">
              зелёный — увезли · серый — отменено/не увезено · {dlv.length} поставок
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Карточка характеристик машины (двойной клик по №·ГОС) — как карточка MAT в формировании.
 * ЧИСТО UI-показ: данные из базы машин (flow_vehicles), на сервере поля хранятся отдельно.
 * Порядок (юзер 2026-06-12): ТИП · ДОП.ТН · ТН · Длина · Ширина · Высота от площадки (метры).
 */
function VehicleSpecCard({
  garage,
  veh,
  x,
  y,
  onClose,
}: {
  garage: string;
  veh: FlowVehicle | null;
  x: number;
  y: number;
  onClose: () => void;
}): JSX.Element {
  const Row = ({ label, value }: { label: string; value: string }): JSX.Element => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-text-muted/60">{label}</span>
      <span className="tabular-nums text-text-secondary">{value || '—'}</span>
    </div>
  );
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-[252px] -translate-x-1/2 rounded-lg border border-border-subtle bg-bg-surface p-3 text-[12px] shadow-xl"
        style={{ left: x, top: y + 4 }}
      >
        <div className="flex items-baseline gap-2 text-[12px] font-medium text-text-strong">
          Машина {garage}
          {veh?.gos_no && <span className="tabular-nums text-text-muted">{veh.gos_no}</span>}
        </div>
        {!veh ? (
          <div className="mt-2 text-[12px] text-text-muted">Машины {garage} нет в базе.</div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            <Row label="Тип" value={veh.vtype ?? ''} />
            {veh.model && <Row label="Модель" value={veh.model} />}
            <Row label="Доп. тн" value={veh.max_mass_kg != null ? `${tons(veh.max_mass_kg)} т` : ''} />
            <Row label="Тн (грузоп.)" value={veh.capacity_kg != null ? `${tons(veh.capacity_kg)} т` : ''} />
            <Row label="Длина" value={veh.len_mm != null ? `${meters(veh.len_mm)} м` : ''} />
            <Row label="Ширина" value={veh.wid_mm != null ? `${meters(veh.wid_mm)} м` : ''} />
            <Row label="Высота от площадки" value={veh.hei_mm != null ? `${meters(veh.hei_mm)} м` : ''} />
          </div>
        )}
      </div>
    </>
  );
}

void whKey; // (резерв: ключ склада для будущих сортировок)
