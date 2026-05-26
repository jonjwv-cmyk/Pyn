/**
 * Типы для раздела «График» — расписание доставки ТМЦ по цехам.
 *
 * Архитектура: цех = блок, внутри 1..N строк по дням недели. Каждая строка
 * имеет день недели (ПН/ВТ/СР/ЧТ/ПТ/СБ/ВС) и список warehouse-кодов. Даты
 * вычисляются динамически из (год, месяц, день недели, праздники, override).
 *
 * Источник правды — этот тип. Excel-источник (📊schedule в WORKFLOW.xlsx)
 * мигрирован один раз в `data.ts`, дальше Pyn = master.
 */

export type Weekday = 'ПН' | 'ВТ' | 'СР' | 'ЧТ' | 'ПТ' | 'СБ' | 'ВС';

export const WEEKDAYS: readonly Weekday[] = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

/** Маппинг: день недели → JS Date.getDay() (0=Sun, 1=Mon, …, 6=Sat). */
export const WEEKDAY_TO_JS: Record<Weekday, number> = {
  ПН: 1, ВТ: 2, СР: 3, ЧТ: 4, ПТ: 5, СБ: 6, ВС: 0,
};

/**
 * Warehouse-код. Сырая строка из E-колонки Excel может содержать префиксы
 * `*` (= КХП production) и `#` (= выезд). Хранится как раздельные поля,
 * чтобы UI отображал чипы и матчился с справочником без regex'ов.
 */
export interface WarehouseCode {
  /** Очищенный 4-символьный код: `\d{3}[\dA-Za-zА-Яа-яёЁ]`, e.g. `2803`, `824Т`. */
  code: string;
  /** Маркер КХП (Коксохимическое производство) — отображается как `*`. */
  isKhp?: boolean;
  /** Маркер «выезд» — отображается как `#`. Юзер выезжает к складу, не наоборот. */
  isVyezd?: boolean;
}

export interface ScheduleRow {
  id: string;
  weekday: Weekday;
  warehouses: WarehouseCode[];
}

export interface ScheduleShop {
  id: string;
  /** Порядковый номер для отображения (пересчитывается при reorder). */
  idx: number;
  name: string;
  rows: ScheduleRow[];
}

/**
 * Override-правило: для перечисленных кодов даты НЕ вычисляются по weekly
 * schedule, а берутся явно. Пример: `1274 /7, 21` = склад 1274 возим только
 * 7-го и 21-го числа, weekly schedule для этого кода игнорируется.
 */
export interface ScheduleOverrideRule {
  id: string;
  codes: string[];
  days: number[];
}

export interface ScheduleApprover {
  /** Должность, e.g. «Начальник УПП». */
  title: string;
  /** Инициалы + фамилия, e.g. «П.А. Харламцев». */
  name: string;
}

/** Дата подписания (год / месяц 1..12 / день 1..31). */
export interface ScheduleApproverDate {
  year: number;
  month: number;
  day: number;
}

export interface ScheduleCommit {
  /** Имя пользователя, зафиксировавшего график (fullName или login). */
  author: string;
  /** ISO-timestamp момента фиксации (UTC). Для отображения конвертится в Yekaterinburg. */
  committedAt: string;
}

export interface ScheduleMeta {
  /** Полный год, e.g. 2026. */
  year: number;
  /** Месяц 1..12. */
  month: number;
  /** Праздничные/нерабочие дни месяца — НЕ возим. */
  holidays: number[];
  overrides: ScheduleOverrideRule[];
  approver: ScheduleApprover;
  deputy: ScheduleApprover;
  /**
   * Дата под подписью «Утверждаю». Optional — старые snapshots без поля
   * получают сегодняшнюю дату на display через fallback.
   */
  approverDate?: ScheduleApproverDate;
  /**
   * Фиксация графика — irreversible lock. После set'а:
   *   - график read-only (edit'ы UI заблокированы)
   *   - synced changes (warehouse store updates) НЕ влияют на этот месяц
   *   - снизу шапки появляется subtle «Зафиксировал: name · date»
   */
  commit?: ScheduleCommit;
}

export interface ScheduleState {
  meta: ScheduleMeta;
  shops: ScheduleShop[];
  /**
   * Список складов, выведенных из эксплуатации. Отображается отдельным
   * блоком внизу листа как «СКЛАДЫ УДАЛЕНЫ» — служебная справка, чтобы
   * не путались с актуальными. В xlsx это была row 77 листа `📊schedule`.
   */
  removedWarehouses: WarehouseCode[];
  /**
   * Склады отгрузки ТМЦ — отдельный служебный блок (row 78 xlsx).
   * Не цех, не на доставку — это терминалы откуда отгружают, справочно.
   */
  shippingWarehouses: WarehouseCode[];
}
