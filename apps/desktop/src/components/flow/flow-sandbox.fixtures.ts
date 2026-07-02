/**
 * Данные раздела «Поток» — лист WORKFLOW, Этап 1 «Формирование».
 *
 * ВРЕМЕННО: реальные строки грузятся из СНИМКА `flow-workflow.sample.json`
 * (экспорт из D1 `flow_workflow`, 2201 строки 1:1 с Google). База остаётся «как
 * есть» — здесь только СЛОЙ ПОКАЗА: часть колонок свёрнута/скрыта и уходит в
 * карточку материала; правятся лишь вспомогательные поля.
 */
import sampleRows from './flow-workflow.sample.json';
import { fmtVolume } from '../vgh/vgh-staging.fixtures';

/** Тип ячейки колонки: простые + СОСТАВНЫЕ (несколько полей в одной колонке). */
export type FlowColumnKind =
  | 'text'
  | 'number'
  | 'dropdown'
  | 'order' // ЗАКАЗ = заказ (ORD) + позиция (IT), разделитель «|»
  | 'kgv' // вес (KG) + объём (V), разделитель «|»
  | 'info' // кто создал (CREATEDBY) + дата (LOADDT)
  | 'percent' // % — живой пересчёт; расчёт подсказкой при наведении
  | 'time' // дата-время: часики; полная дата подсказкой
  | 'mol' // МОЛ: статус-точка + ФИО; телефон/срок подсказкой
  | 'day' // new / OFF / дата доставки (поповер); объединяет ST + день недели
  | 'mat' // материал: ⚠ ручной заказ + название; карточка-оверлей по двойному клику
  | 'history' // ИСТОРИЯ движения позиции (иконка-часы; карточка-таймлайн по клику)
  | 'to'; // склад-получатель: выпадашка складов того же цеха

/** Строка листа WORKFLOW (снимок 1:1). Коды складов — текст (ведущий ноль важен). */
export interface FlowSandboxRow {
  id: number;
  clst: string; // A CLST — кластер ВЫЕЗД/КХП/ПН-ПТ (формула: снимок)
  ord: string; // B ORD — заказ
  it: string; // C IT — позиция
  fr: string; // D FR — склад-отправитель
  to_wh: string; // E TO — склад-получатель
  pr: string; // F PR — прежний/исходный склад
  day_wk: string; // G DAY — единая колонка: 'new' | 'OFF' | дата (ISO). Стадия ST схлопнута сюда (2026-06-05).
  stat: string; // I STAT — статус (хранимый: липкий ручной ИЛИ пусто=авто)
  stat_manual?: number; // флаг «статус задан/снят руками» (0 авто / 1 ручной); снимок → undefined=авто
  time_at: string; // J TIME — когда выгружен к нам (до секунд)
  off_at?: string; // когда удалён (пропал из выгрузки → day_wk='OFF'); пусто — активен
  pct: number | null; // % — ВИРТУАЛЬНАЯ (в БД нет): считаем livePct из qty/chg; поле-ключ колонки
  history?: undefined; // ИСТОРИЯ — синтетическая колонка-иконка (не поле строки; ключ для FlowColumnSpec)
  sed?: undefined; // СЭД — синтетическая колонка (статус движения + на ком с активной поставки)
  q: string; // L Q — значок аварийного запаса
  warn: string; // M ⚠️ — ручной заказ + ФИО
  no_num: string; // N NO.№ — номенклатура
  mat: string; // O MAT — наименование
  mat_full: string; // O коммент — полное тех-имя (ГОСТ)
  uom: string; // P UoM — ед. изм.
  qty: number | null; // Q QTY — текущее кол-во заказа (ИСТИНА из выгрузки, перезаписывается)
  ordered_init?: number | null; // «изначально по заказу» — неизменно (справка, выгрузка не трогает)
  kg: number | null; // R KG — вес
  v: number | null; // S V — объём
  note: string; // T NOTE — примечание (+ служебная окраска)
  mol: string; // U МОЛ — мат. ответственный
  request: string; // V ЗАПРОС — кто просил
  created_by: string; // W CREATEDBY — кто создал (GROKHOVSKIJ = авто)
  load_dt: string; // X LOADDT — дата создания заказа
  chg: number | null; // Y CHG — исходное количество
  approved_by?: string; // «кто согласовал» — поле якоря (правится из любого вида: план/отчёт)
  off_schedule?: number; // доставка вне графика (0/1)
  split_level?: number; // уровень дробления поставки (0=основная; 1..3 — отдельные внутри fr+to)
  row_version?: number; // версия строки (оптимистичная блокировка, реалтайм)
}

/** Спецификация колонки грида. */
export interface FlowColumnSpec {
  id: keyof FlowSandboxRow;
  title: string;
  width: number;
  kind: FlowColumnKind;
  options?: readonly string[];
  /** Правится руками? Иначе read-only (данные выгрузки, правка = каша). */
  editable?: boolean;
}

/** Все возможные значения STAT (для ранжирования фильтра/чек-листа). Порядок задан
 *  юзером 2026-06-05. «нет ВГХ» УБРАН (юзер 2026-06-07): нет нормы → пусто (сигнал
 *  «новый/без нормы» несёт стадия NEW), отдельный статус не нужен. */
export const FLOW_STAT_OPTIONS = [
  'мало',
  'заявка',
  'мет_ок',
  'вопрос',
  'самовывоз',
  'отказ',
  'масловоз',
  'неликвиды',
  'прекурсор',
] as const;

/**
 * ФИНАЛЬНАЯ модель STAT (юзер 2026-06-07). Два класса значений:
 *
 * РАСЧЁТНЫЕ (авто, живой вердикт по норме+связке+номенклатуре, руками НЕ ставятся):
 *   `мало`=недобор нормы (Σкол-ва×1.5 < MIN QTY); `заявка`=9002 + получатель куст КХП/8006
 *   при норме-ок; `мет_ок`=9002 прочие получатели при норме-ок; `масловоз`/`прекурсор`=по
 *   номенклатуре. Нет нормы → пусто (НЕ «нет ВГХ» — статус убран). Считаются в `statMetaById`
 *   (FlowSandboxGrid) реалтайм от базы ВГХ — вписал норму в карточке → строка сама стала ярлыком.
 *
 * РУЧНЫЕ-ЛИПКИЕ (хранятся в БД `stat`, `stat_manual=1`, перекрывают расчёт):
 *   `отказ`/`самовывоз`/`вопрос`/`неликвиды` — на любой строке; `заявка` — руками только на
 *   строках БЕЗ авто-правила (не 9002 / не масловоз/прекурсор). СНЯЛ липкий (`stat_manual=0`) →
 *   возврат к расчётному ярлыку (заявка/мало/мет_ок/масловоз/пусто), НЕ в пусто.
 */
export const FLOW_STAT_MANUAL = ['заявка', 'вопрос', 'самовывоз', 'отказ', 'неликвиды'] as const;

/** Расчётные ярлыки (показываются, когда нет ручного-липкого; считаются в `statMetaById`). */
export const FLOW_STAT_AUTO = ['мало', 'заявка', 'мет_ок', 'масловоз', 'прекурсор'] as const;

/** Номенклатуры-масловоз — авто-ярлык «масловоз» (недобор → «мало»). */
export const MASLOVOZ_NOS = new Set(['2030054', '2030058', '2030077', '2031541', '2031542']);
/** Номенклатура-прекурсор — авто-ярлык «прекурсор» (недобор → «мало»). */
export const PRECURSOR_NO = '2266901';

/**
 * Базовый набор значений выпадашки STAT (статичный fallback для спецификации колонки).
 * Реальные пункты считаются ПО СТРОКЕ в `statOptionsForRow` (FlowSandboxGrid): на строках
 * с авто-правилом (9002 / масловоз / прекурсор) — только отказ/самовывоз/вопрос/неликвиды
 * (ярлык авто, не трогаем); на обычных — + заявка; + «мало» при реальном недоборе.
 * `мет_ок`/`масловоз`/`прекурсор` руками не ставятся НИГДЕ (только авто).
 */
export const FLOW_STAT_DROPDOWN = ['мало', 'заявка', 'вопрос', 'самовывоз', 'отказ', 'неликвиды'] as const;

/**
 * ВИДИМЫЕ колонки «Формирования» (слой показа, юзер 2026-06-04). Свёрнуто:
 * заказ|поз — одна колонка; DAY = NEW/OFF/дата (ST+день слиты); ⚠ — префикс
 * материала; вторичные поля выгрузки (TIME/%/CREATEDBY/LOADDT/CHG/тех-имя) скрыты
 * и уходят в карточку материала. Правятся только вспомогательные (editable).
 */
export const FLOW_COLUMNS: readonly FlowColumnSpec[] = [
  { id: 'clst', title: 'ГРАФ', width: 70, kind: 'text' },
  { id: 'ord', title: 'ORD', width: 128, kind: 'order' },
  { id: 'fr', title: 'FR', width: 62, kind: 'text', editable: true },
  { id: 'to_wh', title: 'TO', width: 62, kind: 'to', editable: true },
  { id: 'pr', title: 'PR', width: 62, kind: 'text' },
  { id: 'day_wk', title: 'DAY', width: 84, kind: 'day', editable: true },
  { id: 'request', title: 'ЗАПРОС', width: 108, kind: 'text', editable: true },
  { id: 'mol', title: 'МОЛ', width: 172, kind: 'mol', editable: true },
  { id: 'stat', title: 'STAT', width: 104, kind: 'dropdown', options: FLOW_STAT_DROPDOWN, editable: true },
  { id: 'pct', title: '%', width: 52, kind: 'percent' },
  { id: 'q', title: 'Q', width: 38, kind: 'text' },
  // УР — уровень дробления поставки (0=пусто — основная; 1..3 — отдельные поставки
  // внутри связки отправитель+получатель). Скрипт создания поставок гонит SAP
  // МНОГОУРОВНЕВО: сначала база, затем уровень 1, 2, 3 — заказ дробится на разные
  // поставки под разные машины. Группировка плана: fr+to+уровень (flow_plan_form).
  { id: 'split_level', title: 'УР', width: 44, kind: 'dropdown',
    options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], editable: true },
  { id: 'history', title: 'ИСТОРИЯ', width: 64, kind: 'history' },
  { id: 'no_num', title: 'NO. №', width: 86, kind: 'text' },
  { id: 'mat', title: 'MAT', width: 210, kind: 'mat' },
  { id: 'uom', title: 'UoM', width: 50, kind: 'text' },
  { id: 'qty', title: 'QTY', width: 80, kind: 'number' },
  { id: 'kg', title: 'KG', width: 80, kind: 'number' },
  { id: 'v', title: 'V', width: 70, kind: 'number' },
  { id: 'note', title: 'NOTE', width: 150, kind: 'text', editable: true },
];

/**
 * Размер шрифта ЗНАЧЕНИЙ по колонкам (px при 100%; зум домножает). Юзер: кластер —
 * самый мелкий; день/статус/КГ/объём/МОЛ/запрос — компактные; остальное стандарт.
 * Заголовки колонок НЕ трогаем. Применяется как per-cell `themeOverride`.
 */
export const FLOW_FONT_PX_DEFAULT = 10;
const FLOW_COL_FONT_PX: Partial<Record<keyof FlowSandboxRow, number>> = {
  clst: 7,
  day_wk: 8,
  stat: 8,
  kg: 8,
  v: 8,
  mol: 8,
  request: 8,
};
/** Размер шрифта значения колонки (px при 100%). */
export function colFontPx(id: keyof FlowSandboxRow): number {
  return FLOW_COL_FONT_PX[id] ?? FLOW_FONT_PX_DEFAULT;
}

/** Колонки с ЖИРНЫМ значением (юзер 2026-06-04): отправитель/получатель, Q, КГ, V,
 *  DAY. Процент уже рисуется жирным своей ячейкой — НЕ дублируем (двойной вес). */
const FLOW_BOLD_COLS = new Set<keyof FlowSandboxRow>(['fr', 'to_wh', 'q', 'kg', 'v', 'day_wk']);
/** Значение колонки рисуется жирным? */
export function isBoldCol(id: keyof FlowSandboxRow): boolean {
  return FLOW_BOLD_COLS.has(id);
}

/** «Фамилия Имя Отчество» → «Фамилия Имя О.» (первые два слова целиком, последующие —
 *  инициалом с точкой). Для компактного показа в выпадашке-карточке МОЛ. */
export function compactFio(fio: string): string {
  const toks = fio.trim().split(/\s+/).filter(Boolean);
  if (toks.length <= 2) return toks.join(' ');
  const initials = toks.slice(2).map((t) => `${(t[0] ?? '').toUpperCase()}.`).join(' ');
  return `${toks[0]} ${toks[1]} ${initials}`;
}

/** «Фамилия Имя Отчество» → «Фамилия И.О.» (фамилия + инициалы остальных). Для
 *  компактного КОПИРОВАНИЯ мола в обычные ячейки. */
export function molInitials(fio: string): string {
  const toks = fio.trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return '';
  if (toks.length === 1) return toks[0] ?? '';
  const initials = toks.slice(1).map((t) => `${(t[0] ?? '').toUpperCase()}.`).join('');
  return `${toks[0]} ${initials}`;
}

/** Реальные строки снимка (JSON уже в нужной форме). */
const ROWS = sampleRows as unknown as FlowSandboxRow[];

/** Строки набора (сейчас — снимок из JSON; параметр игнорируется). Копия — чтобы
 *  правки/удаление в гриде не мутировали импортированный модуль. */
export function makeFlowRows(_count?: number): FlowSandboxRow[] {
  return ROWS.map((r) => ({ ...r }));
}

/** Число → 3 знака, разряды пробелом, точка-десятич (`1 366.000`). Пусто → ''. */
export function fmtNum3(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const fixed = Math.abs(n).toFixed(3);
  const [int = '0', frac = '000'] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '-' : '') + grouped + ',' + frac; // запятая-десятич, разряды пробелом
}

/** Доля (0..1) → целый процент (`0.7979` → `80%`). Пусто → ''. */
export function fmtPct(frac: number | null | undefined): string {
  if (frac == null || !Number.isFinite(frac)) return '';
  return Math.round(frac * 100) + '%';
}

/** Доля закрытия строки (живой пересчёт: 1 − qty/chg). null если нечего / ≤0.
 *  В Google-формуле был сдвиг (счёт с 3-й строки) — считаем сами, корректно. */
export function livePct(row: { qty: number | null; chg: number | null }): number | null {
  const q = row.qty; // сколько сейчас
  const c = row.chg; // сколько было по заказу
  if (q == null || c == null || c === 0) return null;
  return (c - q) / c; // >0 — часть вывезена; <0 — заказ увеличили (в минус)
}

const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_LONG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

/** Унифицированные сокращения месяцев «Потока»: первые 3 буквы + точка. Короткие
 *  месяцы (4 буквы: март/июнь/июль и 3-буквенный май) пишем ЦЕЛИКОМ — сокращение на
 *  одну букву (июнь→июн.) той же длины, смысла нет (юзер). Один источник на ВСЕ даты
 *  раздела (DAY, план, отчёт) — не думаем об этом отдельно. */
export const MONTH_ABBR_RU = [
  'янв.', 'фев.', 'март', 'апр.', 'май', 'июнь',
  'июль', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.',
] as const;

/** Единый формат даты «Потока»: «месяц ЧИСЛО[, ГОД][, ВРЕМЯ]» — сначала месяц, потом
 *  число, потом год (в DAY год не показываем). Сокращения месяца — общие (MONTH_ABBR_RU). */
export function flowDate(s: string, opts?: { year?: boolean; time?: boolean }): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d, hh, mm] = m;
  let out = `${MONTH_ABBR_RU[parseInt(mo ?? '1', 10) - 1] ?? mo} ${parseInt(d ?? '1', 10)}`;
  if (opts?.year ?? true) out += `, ${y}`;
  if ((opts?.time ?? false) && hh != null && mm != null && !(hh === '00' && mm === '00')) {
    const h = parseInt(hh, 10);
    out += `, ${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
  }
  return out;
}

// ── ГРАФ: ближайшая дата по графику (юзер 2026-07-02, В4) ────────────────────
// День недели графика («ПН»/«ПТ КХП») дополняем ЧИСЛОМ ближайшего вхождения:
// «ПТ.3» = пятница 3-е. Ближайшее = первое вхождение дня недели НЕ РАНЬШЕ опорной
// даты (план-дата строки / выбранный DAY / сегодня). Зелёная подпись — дата «без
// перескока недель»: в пределах сегодня+7 (текущая неделя или начало следующей).

/** День недели РУ (кратко) → JS getDay(). */
const WEEKDAY_RU_JS: Record<string, number> = { ПН: 1, ВТ: 2, СР: 3, ЧТ: 4, ПТ: 5, СБ: 6, ВС: 0 };

/** Сегодня локально в YYYY-MM-DD. */
export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ближайшее вхождение дня недели графика ≥ fromIso. null — день/дата не распознаны. */
export function nearestGraphDate(weekdayRu: string, fromIso: string): string | null {
  const wd = WEEKDAY_RU_JS[weekdayRu.trim().toUpperCase().slice(0, 2)];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  if (wd === undefined || !m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO-дата + N дней → ISO. */
export function isoAddDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Подпись ГРАФ: «ПТ 3» (день недели + число ближайшей даты); без даты — просто день. */
export function graphDayLabel(weekdayRu: string, iso: string | null): string {
  return iso ? `${weekdayRu} ${parseInt(iso.slice(8, 10), 10)}` : weekdayRu;
}

/** Зелёная подпись ГРАФ: дата в пределах сегодня+7 дней (без перескока недель). */
export function graphDateSoon(iso: string | null, todayIso: string): boolean {
  if (!iso) return false;
  const parse = (s: string): number => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).getTime();
  const diff = (parse(iso) - parse(todayIso)) / 86400000;
  return diff >= 0 && diff <= 7;
}

/** Срок ответственности МОЛ «DD.MM.YYYY» (из базы) → единый формат «месяц число, год».
 *  `{ comma:false }` — без запятой («май 12 2026», для окна «срок истёк»).
 *  Не распознали формат — отдаём как есть. */
export function formatUntilDate(until: string, opts?: { comma?: boolean }): string {
  const m = until.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return until.trim();
  const [, d, mo, y] = m;
  const sep = (opts?.comma ?? true) ? ',' : '';
  return `${MONTH_ABBR_RU[parseInt(mo ?? '1', 10) - 1] ?? mo} ${parseInt(d ?? '1', 10)}${sep} ${y}`;
}

/** «2026-06-03 08:01:47» → короткое («3 июн») и полное («3 июня 2026, 8:01 am»). */
export function parseTime(s: string): { short: string; full: string } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return { short: s, full: s };
  const [, y, mo, d, hh, mm] = m;
  const mi = parseInt(mo ?? '1', 10) - 1;
  const day = parseInt(d ?? '1', 10);
  const h = parseInt(hh ?? '0', 10);
  const h12 = h % 12 || 12;
  const ampm = h < 12 ? 'am' : 'pm';
  return {
    short: `${day} ${MON_SHORT[mi] ?? mo}`,
    full: `${day} ${MON_LONG[mi] ?? mo} ${y}, ${h12}:${mm} ${ampm}`,
  };
}

/** Цвет статус-кружка МОЛ по эмодзи (🟢 на работе / 🟡 / 🟠 / 🔴 / ⚫ нет). */
const MOL_DOT: Record<string, string> = {
  '🟢': '#3FB950', // работает — зелёный
  '🟡': '#F85149', // иной статус — красный
  '🟠': '#F85149',
  '🔴': '#F85149',
  '⚫️': '#9AA0A6', // нет инфо — серый
  '⚫': '#9AA0A6',
};

/** Разобрать МОЛ «🟢ФИО - по DD.MM.YYYY\n8 xxx xxx xxxx» на части. null — пусто. */
export function parseMol(
  s: string,
): { color: string; fio: string; until: string; phone: string } | null {
  if (!s || !s.trim()) return null;
  // «Нет МОЛа» — в данных могло прийти как «⚠️НЕТ МОЛа⚠️» (со смайликами). Нормализуем
  // в чистый текст «Нет МОЛа» (без эмодзи) — чтобы фильтр/копирование/поиск показывали
  // ровно то же, что грид (статус = ЦВЕТ пилюли, не смайлик).
  if (/нет\s*мол/i.test(s)) return { color: '#E5484D', fio: 'Нет МОЛа', until: '', phone: '' };
  let rest = s;
  let color = '#9AA0A6';
  for (const emoji of Object.keys(MOL_DOT)) {
    if (rest.startsWith(emoji)) {
      color = MOL_DOT[emoji] as string;
      rest = rest.slice(emoji.length);
      break;
    }
  }
  rest = rest.trimStart();
  const nl = rest.indexOf('\n');
  const head = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
  const phone = nl >= 0 ? rest.slice(nl + 1).trim() : '';
  const um = head.match(/\s*-\s*по\s+(.+)$/i);
  const until = um ? (um[1] ?? '').trim() : '';
  const fio = um && um.index != null ? head.slice(0, um.index).trim() : head;
  return { color, fio, until, phone };
}

/**
 * Состояние DAY-колонки. Одна колонка `day_wk` = 'new' | 'OFF' | дата(ISO) | пусто
 * (юзер 2026-06-05: стадию ST схлопнули в DAY, легаси дни недели → реальные даты).
 * Показ: off / дата доставки / new / пусто. Никаких заглушек-«new» на строках без даты.
 */
/** Цвета пилюль DAY: NEW — насыщенный оранжевый; OFF («нет заказа») — насыщенный
 *  красный (заметнее и приоритетнее NEW). Экспортируются — пилюлю рисует
 *  `flow-day-cell.tsx` (DAY-колонку рендерит он, не flow-two). */
export const DAY_NEW_COLOR = '#C2620E';
export const DAY_OFF_COLOR = '#B42318';

export function dayState(row: FlowSandboxRow): { label: string; color?: string } {
  const d = (row.day_wk || '').trim();
  if (d === 'OFF') return { label: 'off' }; // строчными, без точки
  // Конкретная дата доставки → «месяц число» БЕЗ года (единый формат «Потока»).
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return { label: flowDate(d, { year: false }) };
  // 'new' (стадия) или иной заданный день — как есть; пусто → пусто.
  return { label: d };
}

/** Заказ помечается значком ⚠ (приоритет/внимание), если выполнено ЛЮБОЕ условие:
 *  • создан НЕ Гроховским (ручной заказ) — как было; ИЛИ
 *  • номер заказа начинается на «43» (особая группа; у нас заказы 44* / 42* / 43*).
 *  Юзер 2026-06-05: к правилу «кто создал» добавили правило на номер «43*». */
export function needsWarn(row: { created_by: string; ord: string }): boolean {
  const by = (row.created_by || '').trim().toUpperCase();
  const manual = by !== '' && by !== 'GROKHOVSKIJ';
  const ord43 = (row.ord || '').trim().startsWith('43');
  return manual || ord43;
}

/** Составная ячейка: основное (тёмное) + вторичное (приглушённое) + опц. значок/точка. */
export function flowComposed(
  spec: FlowColumnSpec,
  row: FlowSandboxRow,
): {
  primary: string;
  secondary: string;
  icon?: 'clock' | 'warn';
  dot?: string;
  pill?: string;
  pillStrong?: boolean;
  expand?: boolean;
  bold?: boolean;
  alignSep?: boolean;
} {
  switch (spec.kind) {
    case 'order':
      // alignSep — «|поз» на фиксированном x, чтобы разделители стояли друг под другом.
      return { primary: row.ord ?? '', secondary: row.it ? `|${row.it}` : '', alignSep: true };
    case 'kgv': {
      const kg = fmtNum3(row.kg);
      const v = fmtNum3(row.v);
      return { primary: kg || (v ? '' : '—'), secondary: v ? `|${v}` : '' };
    }
    case 'info':
      return { primary: row.created_by ?? '', secondary: row.load_dt ? `· ${row.load_dt}` : '' };
    case 'percent': {
      const p = livePct(row);
      return { primary: p == null || p === 0 ? '' : fmtPct(p), secondary: '', bold: true };
    }
    case 'time': {
      const t = parseTime(row.time_at);
      return { primary: t ? t.short : '', secondary: '', icon: t ? 'clock' : undefined };
    }
    case 'mol': {
      const m = parseMol(row.mol);
      if (!m) return { primary: '', secondary: '' };
      // ФИО в цветной пилюле по статусу; раскрытие списка МОЛ — стрелкой на hover.
      return { primary: m.fio, secondary: '', pill: m.color, expand: true };
    }
    case 'day': {
      const d = (row.day_wk || '').trim();
      // NEW/OFF — насыщенные пилюли (как «Нет МОЛа»); OFF (нет заказа) краснее и приоритетнее.
      if (d === 'new') return { primary: 'new', secondary: '', pill: DAY_NEW_COLOR, pillStrong: true, expand: true };
      if (d === 'OFF') return { primary: 'OFF', secondary: '', pill: DAY_OFF_COLOR, pillStrong: true, expand: true };
      const s = dayState(row);
      return { primary: s.label, secondary: '', dot: s.color, expand: true };
    }
    case 'mat':
      // Без ▾: карточка раскрывается по КЛИКУ на ячейку (стрелка не нужна).
      return { primary: row.mat ?? '', secondary: '', icon: needsWarn(row) ? 'warn' : undefined };
    default:
      return { primary: '', secondary: '' };
  }
}

/** Полная строка показа колонки (для авто-ширины и копирования). */
export function flowDisplayText(spec: FlowColumnSpec, row: FlowSandboxRow): string {
  switch (spec.kind) {
    case 'order':
    case 'kgv':
    case 'info':
    case 'percent':
    case 'time':
    case 'mol':
    case 'day':
    case 'mat': {
      const { primary, secondary } = flowComposed(spec, row);
      return secondary ? `${primary} ${secondary}` : primary;
    }
    case 'number': {
      const n = row[spec.id];
      if (typeof n !== 'number') return '';
      return spec.id === 'v' ? fmtVolume(n) : fmtNum3(n); // объём — умно до первого значащего
    }
    default: {
      const raw = row[spec.id];
      return raw == null ? '' : String(raw);
    }
  }
}

/**
 * Значение колонки для ФИЛЬТРА показа (и его чек-листа) — отформатировано КАК В
 * ТАБЛИЦЕ: проценты «12%», даты «июн. 4», числа «1 366,000» — а не сырьём («0.1234…»,
 * «2026-06-04»). Для составных колонок берём смысловое поле (заказ — номер без позиции,
 * МОЛ — ФИО, материал — название), чтобы чек-лист не дробился по каждой позиции.
 * Фильтр сверяет РОВНО это значение — что видишь в списке, то и фильтруешь.
 */
export function flowFilterText(spec: FlowColumnSpec, row: FlowSandboxRow): string {
  switch (spec.kind) {
    case 'day':
      return dayState(row).label;
    case 'percent': {
      const p = livePct(row);
      return p == null || p === 0 ? '' : fmtPct(p);
    }
    case 'number': {
      const n = row[spec.id];
      if (typeof n !== 'number') return '';
      return spec.id === 'v' ? fmtVolume(n) : fmtNum3(n); // объём — умно до первого значащего
    }
    case 'order':
      return row.ord ?? '';
    case 'mol': {
      const m = parseMol(row.mol);
      return m ? m.fio : (row.mol ?? '');
    }
    case 'mat':
      return row.mat ?? '';
    case 'to':
      return row.to_wh ?? '';
    case 'time': {
      const t = parseTime(row.time_at);
      return t ? t.short : '';
    }
    default: {
      const raw = row[spec.id];
      return raw == null ? '' : String(raw);
    }
  }
}

/** Под-поля «умного» фильтра колонки MAT (скрыты в карточке материала). Фильтруем по
 *  каждому отдельно, условия объединяются И. Без процента — он отдельной колонкой. */
export type FlowMatSubId = 'mat' | 'created_by' | 'load_dt' | 'time_at' | 'mat_full';
export const FLOW_MAT_SUBFIELDS: readonly { id: FlowMatSubId; title: string }[] = [
  { id: 'mat', title: 'Название' },
  { id: 'created_by', title: 'Создал' },
  { id: 'load_dt', title: 'Дата создания' },
  { id: 'time_at', title: 'Дата выгрузки' },
  { id: 'mat_full', title: 'Тех-имя' },
];
/** Значение под-поля MAT для фильтра/чек-листа — отформатировано как в карточке:
 *  даты «месяц число, год» (выгрузка — со временем, это метка партии выгрузки). */
export function flowMatSubText(sub: FlowMatSubId, row: FlowSandboxRow): string {
  switch (sub) {
    case 'load_dt':
      return row.load_dt ? flowDate(row.load_dt, { year: true }) : '';
    case 'time_at':
      return row.time_at ? formatDateRu(row.time_at) : '';
    default: {
      const raw = row[sub];
      return raw == null ? '' : String(raw);
    }
  }
}

/** Одна строка карточки/подсказки. */
export interface FlowCardLine {
  t: string;
  muted?: boolean;
  nowrap?: boolean;
  /** Цвет пилюли вокруг текста (МОЛ — статус). */
  pill?: string;
}

/** Дата → «2 июня 2026» (+ «, 8:01 am» если есть время и оно не полночь). */
export function formatDateRu(s: string): string {
  if (!s) return '';
  // Единый формат: «месяц число, год[, время]» (MAT-карточка и пр.).
  return flowDate(s, { year: true, time: true });
}

/** Карточка/подсказка колонки строками. null — нет. */
/** Структурный набор полей якоря для MAT-карточки — общий для Формирования (FlowSandboxRow)
 *  и Плана/Отчёта (FlowRow-якорь). ТЗ §7: одна и та же карточка во всех видах. */
export interface MatCardRow {
  created_by: string;
  load_dt: string;
  time_at: string;
  day_wk: string;
  off_at?: string;
  qty: number | null;
  chg: number | null;
  uom: string;
  mat_full: string;
}

/** Read-only строки карточки материала: Создал → Выгружен → (Удалён) → Вывезено% → тех-имя.
 *  Единый источник (ТЗ §7) — данные из ЯКОРЯ (живой расчёт, до фиксации меняется везде). */
export function matCardLines(row: MatCardRow): FlowCardLine[] | null {
  const lines: FlowCardLine[] = [];
  if (row.created_by) {
    const cd = formatDateRu(row.load_dt);
    lines.push({ t: `Создал: ${row.created_by}${cd ? ` — ${cd}` : ''}`, muted: true, nowrap: true });
  }
  const up = formatDateRu(row.time_at);
  if (up) lines.push({ t: `Выгружен: ${up}`, muted: true, nowrap: true });
  // Дата удаления — для OFF-строк (когда заказ пропал из выгрузки).
  if (row.day_wk === 'OFF' && row.off_at) {
    const off = formatDateRu(row.off_at);
    if (off) lines.push({ t: `Удалён: ${off}`, muted: true, nowrap: true });
  }
  // В КАРТОЧКЕ показываем вывоз всегда, когда есть данные (в т.ч. 0%); в КОЛОНКЕ 0 не пишем.
  const p = livePct(row);
  if (p != null && row.qty != null && row.chg != null) {
    const uom = row.uom ? ` ${row.uom}` : '';
    lines.push({
      t: `Вывезено ${Math.round(p * 100)}% — ${fmtNum3(row.chg - row.qty)} из ${fmtNum3(row.chg)}${uom}`,
      nowrap: true,
    });
  }
  // Тех-имя ПЕРЕНОСИТСЯ, если длиннее стандарта (ширину задаёт шапка карточки).
  if (row.mat_full) lines.push({ t: row.mat_full });
  return lines.length ? lines : null;
}

export function flowCard(spec: FlowColumnSpec, row: FlowSandboxRow): FlowCardLine[] | null {
  switch (spec.id) {
    case 'mat':
      return matCardLines(row);
    case 'mol': {
      const m = parseMol(row.mol);
      if (!m) return null;
      // ФИО в пилюле по статусу (как в листе МОЛ), ниже — телефон с трубкой.
      const lines: FlowCardLine[] = [{ t: m.fio, pill: m.color }];
      if (m.phone) lines.push({ t: `📞 ${m.phone}`, muted: true });
      if (m.until) lines.push({ t: `по ${formatUntilDate(m.until)}`, muted: true });
      return lines;
    }
    default:
      return null;
  }
}

/** Стиль значения = его условное форматирование в таблице (заливка/текст или живой
 *  градиент). Нужен, чтобы пункты выпадашек DAY/STAT выглядели как в таблице.
 *  undefined — без особого форматирования (пункт оставляем как есть). */
export interface FlowOptionStyle {
  bg?: string;
  text?: string;
  /** Живой переливающийся фон (как в строке): NEW — оранжевый, «вопрос» — янтарь. */
  gradient?: 'new' | 'vopros';
}

/** Цвет статуса STAT (единый источник для строки таблицы И пунктов выпадашки STAT). */
export function statTheme(stat: string): FlowOptionStyle | undefined {
  switch (stat) {
    case 'мало':
    case 'самовывоз':
      return { bg: '#F1F0EC', text: '#8A8782' };
    case 'отказ':
      return { bg: '#F1F0EC', text: '#5A5752' };
    case 'заявка':
      return { bg: '#F1F0EC' };
    case 'вопрос':
      return { gradient: 'vopros' };
    case 'масловоз':
      return { bg: '#FBEDE3', text: '#8A5A2E' };
    case 'мет_ок':
      return { bg: '#EDF5E6', text: '#2E7D4F' };
    case 'прекурсор':
      return { bg: '#ECE3F3', text: '#5E3E86' };
    default:
      return undefined;
  }
}

/** Цвет значения DAY (для пунктов выпадашки DAY): new — градиент, OFF — розово-красный. */
export function dayOptionTheme(value: string): FlowOptionStyle | undefined {
  if (value === 'new') return { gradient: 'new' };
  if (value === 'OFF' || value === 'off') return { bg: '#F6E8E5', text: '#8A3030' };
  return undefined;
}

// Статичные градиенты для пунктов (те же цвета, что живой «вжух» строки в гриде).
const OPT_GRAD_NEW = 'linear-gradient(90deg, rgba(247,130,22,0.20), rgba(247,130,22,0.55) 50%, rgba(247,130,22,0.20))';
const OPT_GRAD_VOPROS = 'linear-gradient(90deg, rgba(233,176,30,0.18), rgba(233,176,30,0.50) 50%, rgba(233,176,30,0.18))';

/** Стиль `FlowOptionStyle` → CSS для пункта (на тёмном оверлее выпадашки). Светлая
 *  заливка → тёмный текст (как в таблице); градиент — без заливки текста. */
export function flowOptionStyleCss(s: FlowOptionStyle | undefined): { background?: string; color?: string } {
  if (!s) return {};
  if (s.gradient === 'new') return { background: OPT_GRAD_NEW };
  if (s.gradient === 'vopros') return { background: OPT_GRAD_VOPROS };
  return { background: s.bg, color: s.text ?? '#2A2925' };
}

/**
 * Условное форматирование СТРОКИ — мягкий фон по статусу (перенос из Google-листа,
 * адаптировано под светлый лист: тихие тона иной палитры, чтобы clay-выделение
 * текста читалось поверх). Приоритет как в листе: NOTE-метки → стадия (OFF, дата=YES)
 * → нет МОЛа → статус. NEW — НЕ красим фоном (иначе перебивал бы статус строки): стадию
 * NEW показывает подпись «new» в колонке DAY + анимированный оранжевый «вжух» по строке
 * (drawCell в гриде). undefined — без подсветки. Возвращаем фон ячеек строки.
 */
export function rowTheme(
  row: FlowSandboxRow,
  molGone = false,
): { bg?: string; text?: string } | undefined {
  const note = (row.note || '').trim().toUpperCase();
  if (note === 'DUPLICATE') return { bg: '#F8E3DF', text: '#9A2B22' };
  if (note === 'ERROR') return { bg: '#E2F0F1', text: '#1C5A60' };
  if (note === 'OBD NO') return { bg: '#FBF3D6', text: '#7A5A1E' };
  if (note === 'WORKFLOW NO') return { bg: '#EFEEE9', text: '#7A7770' };
  if (row.day_wk === 'OFF') return { bg: '#F4C5BE', text: '#8A1E14' }; // насыщеннее: OFF = нет заказа, приоритет
  // Выбрана конкретная дата доставки → заливка YES — сочный салатовый (не бледный,
  // чтобы не сливался со светлым листом); тёмный текст поверх читается.
  if (/^\d{4}-\d{2}-\d{2}/.test(row.day_wk || '')) return { bg: '#C8E6A0' };
  if (molGone || (row.mol || '').toUpperCase().includes('НЕТ МОЛ')) return { bg: '#F2BFB7', text: '#7C1812' };
  // STAT — единый источник цвета (statTheme, он же красит пункты выпадашки). «вопрос» =
  // живой переливающийся градиент (drawCell в гриде), поэтому фоном здесь его НЕ красим.
  const st = statTheme(row.stat);
  return st && !st.gradient ? { bg: st.bg, text: st.text } : undefined;
}
