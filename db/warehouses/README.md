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
- Соответствует блоку «СКЛАДЫ УДАЛЕНЫ» в листе графика
- **Авто-управление при следующем import'е xlsx:**
  - Если `id` отсутствует в новой выгрузке → `is_removed = 1` (флаг поднимается, запись остаётся)
  - Если `id` появился обратно → `is_removed = 0` (флаг снимается)
- Запись НЕ удаляется физически — сохраняем historу.

## Файлы

- `schema.sql` — CREATE TABLE + indexes + триггер `updated_at`
- `seed.sql` — 534 INSERT'а, обёрнуты в transaction, idempotent (`INSERT OR REPLACE`)
- `data.json` — те же 534 записи в JSON (для инспекции / альтернативного импорта через Worker code)

## Применение к D1

```bash
# Локальная разработка
wrangler d1 execute pyn-base --local --file=db/warehouses/schema.sql
wrangler d1 execute pyn-base --local --file=db/warehouses/seed.sql

# Production (после code review)
wrangler d1 execute pyn-base --remote --file=db/warehouses/schema.sql
wrangler d1 execute pyn-base --remote --file=db/warehouses/seed.sql
```

## Алгоритм апдейта из next-import (псевдокод)

```ts
async function importWarehousesFromXlsx(rows: WarehouseRow[]) {
  const incomingIds = new Set(rows.map(r => r.id));
  const existing = await db.query('SELECT id FROM warehouses');
  const existingIds = new Set(existing.map(r => r.id));

  // 1. Поднять is_removed для тех, кого нет в новой выгрузке
  for (const id of existingIds) {
    if (!incomingIds.has(id)) {
      await db.run('UPDATE warehouses SET is_removed = 1 WHERE id = ?', id);
    }
  }

  // 2. UPSERT входящих — снять is_removed если был
  for (const r of rows) {
    await db.run(`
      INSERT INTO warehouses (id, shop_name, shop_code, ...)
        VALUES (?, ?, ?, ...)
      ON CONFLICT(id) DO UPDATE SET
        shop_name = excluded.shop_name,
        shop_code = excluded.shop_code,
        ...,
        is_removed = 0
    `, r.id, r.shop_name, r.shop_code, ...);
  }

  // 3. Bump version + broadcast WS
  await bumpBaseVersion();
  await broadcastWS('base_changed');
}
```

Запись с `is_removed=1` остаётся в БД (history). Если склад вернулся — флаг снимается, запись обновляется новыми данными.

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
