-- ============================================================================
-- Warehouses — справочник складов Pyn.
-- Источник: wf_warehouses (Google Sheets WORKFLOW.xlsx) — 534 записи на 2026-05.
-- Платформа: Cloudflare D1 (SQLite-compatible).
--
-- Назначение:
--   - Хранение метаданных склада (название, кладовщик, телефоны, обозначения)
--   - Привязка к графику доставки ОТЛ (cluster, день недели, флаг участия)
--   - Возможность редактировать cluster / delivery_day / is_shipping
--     прямо из Pyn (Проба tab) админами без правки Google Sheets-источника.
--
-- ID — primary key, immutable. Допускает буквы (КХП-склады: 825Т, 824Ц, OTKZ,
--   T103 итд — всего 23 alphanumeric ID из 534).
-- ============================================================================

CREATE TABLE warehouses (
  -- Identity (immutable PK)
  id TEXT PRIMARY KEY,

  -- ── Static reference (источник: wf_warehouses xlsx) ────────────────────
  shop_name TEXT NOT NULL,         -- 'Наименование' (цех): 'АВТОТРАНСПОРТНОЕ УПРАВЛЕНИЕ'
  shop_code TEXT,                  -- 'Код' цеха: '128', '026', '123'
  description TEXT,                -- 'Описание': 'Склад МОЛ' / 'Промежуточный склад'
  designation TEXT,                -- 'Обозначение': 'АТЦ ГСМ транз.', 'МПЗ тех уч.5,6'
  keeper TEXT,                     -- 'Кладовщик' (короткий alias): 'АТЦ ГСМ', 'МПЗ ГСС'
  work_phone TEXT,                 -- 'Тел. рабочий' (multiline OK: '49 03 94\n49 17 24')
  legacy_id TEXT,                  -- 'Склад до' — старый формат ID: '028', '028А', '0282807'

  -- ── Schedule attributes (editable from Pyn «Проба» tab) ───────────────
  cluster TEXT
    CHECK (cluster IS NULL OR cluster IN ('КХП','НТМК','ВЫЕЗД')),
  delivery_day TEXT
    CHECK (delivery_day IS NULL OR delivery_day IN ('ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС')),
  in_schedule INTEGER NOT NULL DEFAULT 0,   -- 0/1 — участвует ли в графике ОТЛ

  -- Кластер «Технология» — справочный флаг под сайт (юзер 2026-07-05).
  -- К плану/графику отношения НЕ имеет, в расчётах не учитывается.
  tech_cluster INTEGER NOT NULL DEFAULT 0,

  -- ── Flow markers ──────────────────────────────────────────────────────
  -- is_shipping: 1 — С этого склада МЫ ОТГРУЖАЕМ ТМЦ другим (не привозим к ним).
  -- Соответствует «СКЛАДЫ ОТГРУЗКИ ТМЦ» в листе графика.
  is_shipping INTEGER NOT NULL DEFAULT 0,

  -- is_removed: 1 — склад выведен из эксплуатации / отсутствует в актуальной выгрузке.
  -- Автомат: при следующем import'е если ID нет → flag поднимается; если появился → снимается.
  -- Соответствует «СКЛАДЫ УДАЛЕНЫ» в листе графика.
  is_removed INTEGER NOT NULL DEFAULT 0,

  -- ── Audit ──────────────────────────────────────────────────────────────
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes для частых запросов ──────────────────────────────────────────
CREATE INDEX idx_warehouses_shop_code ON warehouses(shop_code);
CREATE INDEX idx_warehouses_cluster ON warehouses(cluster) WHERE cluster IS NOT NULL;
CREATE INDEX idx_warehouses_delivery_day ON warehouses(delivery_day) WHERE delivery_day IS NOT NULL;
CREATE INDEX idx_warehouses_in_schedule ON warehouses(in_schedule);
CREATE INDEX idx_warehouses_is_shipping ON warehouses(is_shipping) WHERE is_shipping = 1;
CREATE INDEX idx_warehouses_is_removed ON warehouses(is_removed) WHERE is_removed = 1;

-- Триггер для updated_at — обновляется автоматически при любом UPDATE
CREATE TRIGGER trg_warehouses_updated_at
AFTER UPDATE ON warehouses
FOR EACH ROW
BEGIN
  UPDATE warehouses SET updated_at = datetime('now') WHERE id = NEW.id;
END;
