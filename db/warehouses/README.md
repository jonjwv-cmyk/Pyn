# Warehouses Database

Справочник складов Pyn — Cloudflare D1 (SQLite-compatible).

## Источник данных

- **Excel**: `WORKFLOW.xlsx`, лист `wf_warehouses`
- **Импортировано**: 2026-05, 534 склада
- **Из них в графике ОТЛ**: 247 (с `cluster` и `delivery_day`), остальные 287 — справочно

## Структура

### Таблица `warehouses`

| Колонка | Тип | Описание | Excel-источник |
|---|---|---|---|
| `id` | TEXT PK | Номер склада (immutable, всегда ориентируемся на него) | `ID` |
| `shop_name` | TEXT NOT NULL | Наименование цеха | `Наименование` |
| `shop_code` | TEXT | Код цеха | `Код` |
| `description` | TEXT | Тип склада: «Склад МОЛ» / «Промежуточный склад» | `Описание` |
| `designation` | TEXT | Обозначение склада | `Обозначение` |
| `keeper` | TEXT | Короткий alias (Кладовщик-кодовое имя) | `Кладовщик` |
| `work_phone` | TEXT | Рабочие телефоны (multiline OK) | `Тел. рабочий` |
| `legacy_id` | TEXT | Старый формат ID (справочно, **не использовать для идентификации**) | `Склад до` |
| `cluster` | TEXT (CHECK) | `КХП` / `НТМК` / `ВЫЕЗД` / NULL | `CLUSTER` |
| `delivery_day` | TEXT (CHECK) | `ПН` / `ВТ` / `СР` / `ЧТ` / `ПТ` / `СБ` / `ВС` / NULL | `DAY` |
| `in_schedule` | INTEGER NOT NULL | 0/1 — участвует ли в графике ОТЛ | `График ОТЛ` (yes/no) |
| `is_shipping` | INTEGER NOT NULL | 0/1 — **«Отгрузка ТМЦ»**: с этого склада МЫ отгружаем (не привозим). См. ниже. | — |
| `is_removed` | INTEGER NOT NULL | 0/1 — **«Склад удалён»**: автомат поднимается если ID отсутствует в next import. См. ниже. | — |
| `created_at` | TEXT | Auto: момент INSERT | — |
| `updated_at` | TEXT | Auto: обновляется триггером | — |

### Индексы

- `idx_warehouses_shop_code` — для поиска складов одного цеха
- `idx_warehouses_cluster` — partial (`WHERE cluster IS NOT NULL`)
- `idx_warehouses_delivery_day` — partial (`WHERE delivery_day IS NOT NULL`)
- `idx_warehouses_in_schedule` — для отбора активных складов графика
- `idx_warehouses_is_shipping` — partial (`WHERE is_shipping = 1`)
- `idx_warehouses_is_removed` — partial (`WHERE is_removed = 1`)

## Семантика полей

### Static reference (из xlsx, редко меняется)
- `shop_name`, `shop_code`, `description`, `designation`, `keeper`, `work_phone`, `legacy_id`
- Источник истины: бэк-офис через админ-импорт (или дальше — через Pyn admin UI).

### Schedule attributes (редактируются админом из Pyn / «Проба» tab)
- `cluster` — кластер площадки (КХП / НТМК / ВЫЕЗД)
- `delivery_day` — день недели доставки
- `in_schedule` — флаг участия в графике ОТЛ
- При редактировании из Pyn: `POST /admin/warehouse/schedule-attrs` → обновляет → bump base_version → WS push.

### Flow markers

**`is_shipping`** — С этого склада МЫ ОТГРУЖАЕМ ТМЦ другим (не привозим к нему).
- Соответствует блоку «СКЛАДЫ ОТГРУЗКИ ТМЦ» в листе графика
- Редактируется админом из Pyn UI: «отметить склад как отгрузочный»
- Default `0`. Текущий список Pyn'а (`824Ц 9002 9003 ...`) можно перенести вручную после деплоя.

**`is_removed`** — Склад выведен из эксплуатации / отсутствует в актуальной выгрузке.
- Соответствует блоку «СКЛАДЫ УДАЛЕНЫ» в листе графика.
- В UI пользователь видит просто статус «Удалено» (авто/ручное — скрытая деталь).
- Запись НЕ удаляется физически — сохраняем историю.

#### ⚠️ TODO — авто/ручное удаление + дата (СЕЙЧАС НЕ РЕАЛИЗОВАНО; всплывёт при постройке выгрузки/импорта складов)

> Сейчас серверного слоя складов нет: store клиентский (localStorage + bundle-seed),
> `is_removed` приходит из сида, мутации (`markRemoved` и т.п.) к UI не подключены.
> Когда появится серверный импорт складов — заложить логику ниже (требование юзера).

**Два источника удаления** (хранить внутренним полем; в UI НЕ показывать — там просто «Удалено»):
- **Авто** — склада нет в новой выгрузке → `is_removed=1`, `removal_kind='auto'`.
- **Ручное** — пользователь пометил из карточки → `is_removed=1`, `removal_kind='manual'`.

**Снятие отметки:**
- Авто: склад снова появился в выгрузке → `is_removed=0` (импорт снимает авто-метку).
- Ручное: импорт НЕ трогает (даже если склад есть в выгрузке) → снимается ТОЛЬКО вручную.

**Дата удаления `removed_month` (YYYY-MM)** — нужна для окна в графике:
- Ставится в момент `is_removed=1` (и авто, и ручное); если уже стоит — НЕ перезаписывать.
- При `is_removed=0` → очищать (NULL).
- График, строка «СКЛАДЫ УДАЛЕНЫ» (НЕзафиксированные месяцы): показывать склад в окне
  `M ∈ {R, R+1}` — месяц удаления R и следующий (= 2 месяца), потом исчезает.
  Зафиксированные месяцы — строго из снапшота (не меняются).
- Поиск склада в графике уже находит склад и в строке «удалены» (подсветка + скролл).

**Колонки к добавлению:** `removed_month TEXT`, `removal_kind TEXT CHECK (removal_kind IN ('auto','manual'))`
в `warehouses` + соответствующие поля в `Warehouse` type (`packages/core/src/types/warehouse.ts`).

## Файлы

- `schema.sql` — CREATE TABLE + indexes + триггер `updated_at`
- `seed.sql` — 534 INSERT'а, idempotent (`INSERT OR REPLACE`); без обёртки transaction (D1 `--remote` не принимает BEGIN/COMMIT)
- `data.json` — те же 534 записи в JSON (для инспекции / альтернативного импорта через Worker code)

## Применение к D1

> Склады — отдельный **датасет** (таблица `warehouses` + `warehouses_meta`) внутри
> общей боевой базы **`otl-db`** (тот же D1-инстанс, что МОЛ-база, график, юзеры).
> «Две базы» (МОЛы и Цеха) живут в одном `otl-db` как независимые таблицы со
> своими версиями/снэпшотами — отдельный D1 заводить не нужно.

```bash
# Локальная разработка
wrangler d1 execute otl-db --local --file=db/warehouses/schema.sql
wrangler d1 execute otl-db --local --file=db/warehouses/seed.sql

# Production (после code review)
wrangler d1 execute otl-db --remote --file=db/warehouses/schema.sql
wrangler d1 execute otl-db --remote --file=db/warehouses/seed.sql
```

## Алгоритм апдейта из SAP-выгрузки (псевдокод)

**Триггер:** внешний скрипт выгружает склады из SAP и пушит список к нам по цепочке
прокси работодателя → ВПС → CF Worker (endpoint `warehouses_import`). Не кнопка в
приложении и не cron-pull со стороны воркера.

**Что чьё:** ключ совпадения — **номер склада** (`id`). Из выгрузки обновляем только
«паспортные» поля: `shop_name`, `shop_code`, `description`, `designation`, `keeper`,
`legacy_id`. А `cluster`, `delivery_day`, `in_schedule`, `is_shipping`, `work_phone` —
**наши** данные (ведём вручную в карточке), импорт их НЕ трогает.

```ts
async function importWarehousesFromSap(rows: WarehouseRow[]) {
  const incomingIds = new Set(rows.map((r) => r.id));
  const existing = await db.query('SELECT id, is_removed, removal_kind FROM warehouses');
  const byId = new Map(existing.map((r) => [r.id, r]));

  // 1. Склад пропал из выгрузки → авто-удаление. Ручное удаление НЕ трогаем.
  for (const w of existing) {
    if (!incomingIds.has(w.id) && w.removal_kind !== 'manual' && w.is_removed !== 1) {
      await db.run(
        `UPDATE warehouses SET is_removed = 1, removal_kind = 'auto', removed_month = ?
           WHERE id = ?`,
        currentMonth, w.id,
      );
    }
  }

  // 2. Склад есть в выгрузке: обновляем ТОЛЬКО паспортные поля.
  for (const r of rows) {
    const cur = byId.get(r.id);
    if (cur?.removal_kind === 'manual') continue;   // ручное удаление — не трогаем вообще
    const unremove = cur?.removal_kind === 'auto';  // авто-удаление снять — склад вернулся
    await db.run(`
      INSERT INTO warehouses (id, shop_name, shop_code, description, designation, keeper, legacy_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shop_name = excluded.shop_name, shop_code = excluded.shop_code,
        description = excluded.description, designation = excluded.designation,
        keeper = excluded.keeper, legacy_id = excluded.legacy_id
        ${unremove ? `, is_removed = 0, removal_kind = NULL, removed_month = NULL` : ''}
    `, r.id, r.shop_name, r.shop_code, r.description, r.designation, r.keeper, r.legacy_id);
  }

  // 3. Bump версии + WS-рассылка (как МОЛ base_changed → warehouses_changed).
  await bumpWarehousesMeta();
  await broadcastWS('warehouses_changed');
}
```

Итог по удалению: **ручное** (`manual`) переживает любой импорт; **авто** (`auto`)
снимается, как только номер снова появился в выгрузке; пропал из выгрузки → `auto` +
`removed_month`. Запись с `is_removed=1` остаётся в БД (history), наши поля
(кластер / день / статус / телефоны) сохраняются.

## Что дальше (roadmap)

1. ✅ **Схема + seed** — этот PR
2. ⏭️ **Admin endpoints** на CF Worker: `warehouse/upsert`, `warehouse/schedule-attrs`, `warehouse/toggle-shipping`, `warehouse/import-batch` (с auto-removed logic)
3. ⏭️ **TS-типы** в `@pyn/core` (`Warehouse` interface) + endpoint wrappers
4. ⏭️ **Pyn admin UI** — формы редактирования cluster/delivery_day/is_shipping из «Проба» tab
5. ⏭️ **Snapshot integration** — JOIN warehouses в существующий R2 snapshot, заменить денормализованные warehouse-поля в `MolRecord` на FK→`warehouses.id`
6. ⏭️ **Отключение Google Apps Script** — после стабилизации direct-server-edit flow

## Статистика import'а 2026-05

```
Всего записей:       534
ID с буквами:        23  (825Т, 824Ц, OTKZ, T103, USL6, ...)
В графике (in_schedule=1): 247
Распределение по дням:
  ПН: 52   ВТ: 65   СР: 52   ЧТ: 40   ПТ: 38
Распределение по кластерам:
  НТМК: 213   КХП: 27   ВЫЕЗД: 7
С рабочим телефоном: 300
Уникальных shop_code: 57
is_shipping = 1:   0 (default — выставит админ)
is_removed  = 1:   0 (default — поднимется при отсутствии в next import)
```
