# TZ: Server-sync для графика + collaboration locks + warehouses base update

**Дата постановки**: 2026-05-27
**Приоритет**: HIGH (предрелизный feature)
**Длительность**: ожидается 4–6 этапов, делать ПО ОЧЕРЕДИ с верификацией каждого

---

## 1. Цель

Перенести данные графика (раздел «График» — бывшая Проба) из `localStorage` на сервер. Несколько клиентов работают одновременно с одной и той же месячной картой графика, видят правки друг друга в реальном времени, при попытке редактировать одну и ту же область получают **lock-overlay с аватаркой и именем того, кто сейчас редактирует** + блюр фона + надпись «Редактирование заблокировано».

Аналогично — при глобальном обновлении базы складов (BASE update — например, при импорте новой выгрузки XLSX) все клиенты получают такой же overlay, кнопки серые, ничего нельзя редактировать пока обновление не закончится.

---

## 2. Архитектура

### 2.1 Network topology (уже работает)

```
Клиент на работе:   client → corp-proxy → VPS (45.12.239.5) → CF Worker (api.otlhelper.com)
Клиент дома:        client →                VPS              → CF Worker
```

Все данные E2E-шифрованные между client и Worker (VPS/прокси слепые — payload зашифрован). См. memory: `project_network_topology.md`.

WS уже работает через VPS — используем его для real-time push'ей.

### 2.2 D1 schema (Cloudflare D1)

**Таблица `schedule_state`** — состояние графика на конкретный (year, month):
```sql
CREATE TABLE schedule_state (
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,
  state_json   TEXT    NOT NULL,        -- весь ScheduleState как JSON
  version      INTEGER NOT NULL DEFAULT 1,  -- optimistic concurrency
  updated_at   TEXT    NOT NULL,        -- ISO timestamp
  updated_by   INTEGER NOT NULL,        -- user_id
  committed    INTEGER NOT NULL DEFAULT 0, -- 0/1 — irreversible lock
  committed_by INTEGER,                  -- user_id фиксации
  committed_at TEXT,                     -- ISO timestamp фиксации
  PRIMARY KEY (year, month)
);
CREATE INDEX idx_schedule_state_updated ON schedule_state(updated_at DESC);
```

**Таблица `schedule_edit_lock`** — короткоживущие lease-locks (~30s):
```sql
CREATE TABLE schedule_edit_lock (
  resource_id        TEXT     PRIMARY KEY,  -- e.g. 'schedule:2026-05:exceptions', 'warehouse:8401:edit'
  user_id            INTEGER  NOT NULL,
  user_full_name     TEXT     NOT NULL,
  user_avatar_url    TEXT,
  acquired_at        TEXT     NOT NULL,
  lease_expires_at   TEXT     NOT NULL      -- now + 30s, рефрешим heartbeat'ом
);
CREATE INDEX idx_lock_user ON schedule_edit_lock(user_id);
CREATE INDEX idx_lock_expires ON schedule_edit_lock(lease_expires_at);
```

**Таблица `base_update_status`** — глобальный флаг обновления базы складов:
```sql
CREATE TABLE base_update_status (
  id                  INTEGER PRIMARY KEY DEFAULT 1,   -- singleton row
  is_updating         INTEGER NOT NULL DEFAULT 0,      -- 0/1
  updated_by          INTEGER,
  updated_by_name     TEXT,
  updated_by_avatar   TEXT,
  started_at          TEXT,
  expected_done_at    TEXT,                            -- estimate
  CHECK (id = 1)
);
INSERT INTO base_update_status (id) VALUES (1);
```

**Таблица `warehouses` (уже есть в `db/warehouses/schema.sql`)** — добавить колонку версии:
```sql
ALTER TABLE warehouses ADD COLUMN updated_at TEXT;  -- если ещё нет
ALTER TABLE warehouses ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

### 2.3 Cloudflare Worker endpoints

Все E2E-encrypted через существующий `pyn:api` IPC bridge.

| Endpoint | Метод | Описание | Throttle |
|----------|-------|----------|----------|
| `/schedule/get` | POST `{year, month}` | Вернуть state_json + version + committed flag | по требованию |
| `/schedule/put` | POST `{year, month, state_json, version}` | Optimistic UPDATE: если version совпадает — пишем, version++, return new version. Иначе 409 conflict | по требованию |
| `/schedule/commit` | POST `{year, month, version}` | Set committed=1, committed_by, committed_at. Irreversible. Триггерит WS event | редко |
| `/schedule/lock` | POST `{resource_id}` | Acquire lock на 30s. Если уже залочен другим юзером — 409 + payload `{user_id, full_name, avatar_url}`. Триггерит WS event | по требованию |
| `/schedule/lock/heartbeat` | POST `{resource_id}` | Refresh lease на ещё 30s (только если owner — текущий юзер) | каждые 10s **только пока юзер редактирует** |
| `/schedule/lock/release` | POST `{resource_id}` | Free lock. Триггерит WS event | по требованию |
| `/schedule/months/list` | POST | Список (year, month, committed) для уже сохранённых — для нав-меню | при mount раздела |
| `/base/update/start` | POST | Admin only. Set `base_update_status.is_updating=1`. Триггерит WS event `base_update_started` | редко |
| `/base/update/done` | POST | Admin only. Reset `is_updating=0`. Триггерит WS event `base_update_done` | редко |
| `/base/update/status` | POST | Get current flag + updater info | mount + 1 раз/сессия |

### 2.4 WS push events (от Worker → клиенты)

| Event | Payload | Когда |
|-------|---------|-------|
| `schedule_state_changed` | `{year, month, version, updated_by_name}` | После put/commit |
| `schedule_lock_acquired` | `{resource_id, user_id, full_name, avatar_url}` | После lock/acquire |
| `schedule_lock_released` | `{resource_id}` | После lock/release или expiry |
| `base_update_started` | `{updater_id, name, avatar_url}` | После /base/update/start |
| `base_update_done` | `{}` | После /base/update/done |

WS broadcast — всем подключённым клиентам. Sender не получает свой же event (filter by `senderConnId` на Worker'е).

### 2.5 Optimistic UI + sync паттерн

**Запись**:
1. Юзер делает изменение → клиент сразу применяет к local store (UI обновляется)
2. Клиент отправляет PUT на сервер с version
3. Сервер: если version совпадает — accept, version++, broadcast
4. Сервер ответ → клиент обновляет version
5. Клиенты получают WS event → fetch GET (если version отличается → re-apply)

**Конфликт** (другой клиент успел записать раньше):
- Сервер вернёт 409 с актуальной version + state
- Клиент: показать toast «Кто-то изменил график раньше», merge или re-fetch
- Для совместного редактирования по разным месяцам конфликтов не будет (PK = year+month)

**Throttling**:
- PUT не чаще раза в 500ms (debounce при typing)
- Heartbeat — не чаще раза в 10s
- WS-event subscription — passive, нагрузки нет

---

## 3. Lock-механизм (collaboration)

### 3.1 Resources (что лочим)

Гранулярные locks на конкретные действия:
- `schedule:YYYY-MM:exceptions` — открыт ExceptionsEditor popover
- `schedule:YYYY-MM:holidays` — открыт HolidaysCalendar popover
- `schedule:YYYY-MM:commit` — открыт commit confirm popover
- `schedule:YYYY-MM:approver` — открыт PersonEditor для approver
- `schedule:YYYY-MM:deputy` — открыт PersonEditor для deputy
- `schedule:YYYY-MM:date` — открыт DatePicker
- `schedule:YYYY-MM:month` — открыт MonthYearPicker
- `warehouse:<id>:edit` — открыт EditDialog у склада

### 3.2 Lifecycle

```
useEditLock(resource_id) hook
  on mount:
    POST /schedule/lock { resource_id }
    if 409 (conflict):
      → setLocked({ ownedBy: 'other-user-name', avatar })
      → return early (компонент видит lock state, не позволяет редактировать)
    else:
      → start heartbeat interval (10s)
  on unmount:
    clearInterval heartbeat
    POST /schedule/lock/release { resource_id } (fire-and-forget)
  on WS schedule_lock_released { resource_id }:
    → setLocked(null), allow retry
```

### 3.3 UI overlay при lock'е

Компонент `<EditorLockedOverlay user={...} resource={...} />`:
```tsx
- fixed inset-0 z-[100]
- backdrop-blur-md bg-bg-deep/40
- центр экрана:
  • Большая аватарка (96x96 круг)
  • Имя пользователя (text-strong, 18px)
  • Строка: «{user_name} {redaktiruet}» (локализуется)
  • Строка: «{editing_blocked}» (локализуется)
- пока виден — все clickable elements под ним недоступны
```

Используется в:
1. **Schedule editing locks** — overlay над конкретным dialog/popover/area
2. **Base update overlay** — на весь app (когда `base_update_status.is_updating=1`)

---

## 4. Base update (обновление справочника warehouses)

### 4.1 Триггер
- Admin запускает import нового XLSX через CF Worker admin endpoint (вне scope этого TZ — отдельная задача)
- Worker calls `/base/update/start` → WS broadcast `base_update_started`
- Worker импортирует → flush в D1 → `/base/update/done` → WS broadcast `base_update_done`

### 4.2 Поведение клиента

При получении `base_update_started`:
- Set глобальный flag `useBaseUpdateStore.isUpdating = true`
- Над всем приложением рендерится `<EditorLockedOverlay user={updater} text={baseUpdateText} />`
- ВСЕ кнопки edit/save/commit становятся **disabled visually** (gray) и `pointer-events: none`
- Local store warehouses помечается stale → блокируется любые updateFields()

При получении `base_update_done`:
- Unset flag → overlay убирается
- Forced refetch warehouses base (новая версия)
- Local store обновляется

---

## 5. Data retention (2-year window)

Cron job на CF Worker (можно в queue + cron handler):
- Раз в месяц (1-го числа в 03:00 UTC) запускается
- Удаляет `schedule_state` где `year < CURRENT_YEAR - 1`
- Logged into audit table (для отладки)

Пример: 1 января 2027 → удаляются все записи за 2025. 1 января 2028 → 2026 удаляется. Хранится 2 полных календарных года.

---

## 6. Этапы реализации (делать ПО ОЧЕРЕДИ, с верификацией)

### Этап A: D1 schema + GET/PUT (без локов) ⏱ ~1 час
- D1 миграция: создать `schedule_state` таблицу
- Worker endpoints `/schedule/get` `/schedule/put`
- Client: `useScheduleState(year, month)` hook вместо localStorage
- Backfill: при первом mount проверить localStorage → migrate → cleanup
- **VERIFY**: один клиент пишет, другой делает refresh → видит изменения

### Этап B: WS push events для state changes ⏱ ~30 мин
- Worker: broadcast `schedule_state_changed` после PUT
- Client: subscribe → если version отличается → refetch
- **VERIFY**: два клиента, изменения одного видны второму в реальном времени (без F5)

### Этап C: Lock mechanism ⏱ ~1.5 часа
- D1 `schedule_edit_lock` таблица
- Worker: `/lock`, `/lock/heartbeat`, `/lock/release` endpoints + cleanup cron (раз в минуту удалять expired)
- Client: `useEditLock(resource_id)` hook
- Client: `<EditorLockedOverlay />` компонент
- Применить к: ExceptionsEditor, HolidaysCalendar, CommitButton, PersonEditor, DatePicker, MonthYearPicker, WarehouseSidebar EditDialog
- **VERIFY**: клиент A открывает Исключения → клиент B видит overlay → клиент A закрывает → overlay у B исчезает

### Этап D: Commit на сервере ⏱ ~30 мин
- Worker endpoint `/schedule/commit`
- Client: ChangeCommitButton call → server commit
- После commit — `committed=1`, остальные клиенты при попытке открыть edit-dialog получают перманентный lock (нельзя редактировать committed месяц)
- **VERIFY**: клиент A коммитит май → клиент B при попытке редактировать май видит «Зафиксировано» disabled-стейт

### Этап E: Base update mechanism ⏱ ~45 мин
- D1 `base_update_status` singleton row
- Worker endpoints `/base/update/start` `/base/update/done` `/base/update/status`
- Client: `useBaseUpdateStatus()` hook → store flag + updater info
- Global `<BaseUpdateOverlay />` рендерится в App.tsx при `isUpdating=true`
- ВСЕ кнопки edit становятся disabled
- **VERIFY**: trigger base update from admin → все клиенты получают overlay → после done → overlay убран

### Этап F: Retention cron ⏱ ~30 мин
- CF Worker scheduled handler `cron: 0 3 1 * *` (1-го каждого месяца в 03:00 UTC)
- DELETE FROM schedule_state WHERE year < strftime('%Y', 'now') - 1
- Logged
- **VERIFY**: вручную trigger через wrangler → старые записи удалены

---

## 7. Локализация (новые ключи)

Все новые user-facing строки локализуются во все 5 локалей (ru/en/de/es/uk):

```json
{
  "lock": {
    "overlay_title": "Редактирование заблокировано",
    "editing_now": "{{user}} сейчас редактирует",
    "wait_until_done": "Подождите, пока {{user}} закончит",
    "base_update_title": "Обновление базы складов",
    "base_update_body": "{{user}} обновляет базу. Редактирование временно недоступно.",
    "base_update_no_actor": "Идёт обновление базы складов",
    "permanent_committed_title": "График зафиксирован",
    "permanent_committed_body": "Месяц закрыт для редактирования. Зафиксировал: {{user}}"
  }
}
```

---

## 8. Performance / нагрузка на сервер — обязательные требования

❗ **CF Worker free tier**: 100k requests/day, 10ms CPU per request, 128MB memory. Не превышать.

### Правила:
1. **НИКАКОГО polling'a** — все changes через WS push (см. memory `feedback_no_server_polling.md`)
2. **Heartbeat** только пока юзер активно редактирует (popover/dialog open) — не каждые 10s глобально
3. **Lock cleanup cron** — раз в минуту, не чаще
4. **State fetch** — только при mount раздела + при WS event со старшим version. НЕ перефечивать на каждый рендер.
5. **Debounce PUTs**: при typing не отправлять чаще 500ms
6. **Batch WS events**: если несколько событий за <100ms — мерджить в один broadcast
7. **Cache schedule_state в memory** на стороне Worker'а (Durable Object?) — TODO решить нужен ли DO

### Метрики для контроля (добавить в worker dashboard):
- `/schedule/put` calls per minute
- WS events broadcast per minute
- Active locks count
- Average lease duration

---

## 9. Side notes / risks

- ⚠️ Concurrent editing race: оптимистичная concurrency + locks ДОЛЖНЫ предотвратить data loss. Если кто-то редактирует без lock'а (например через прямой API call) — данные могут потеряться. Frontend ВСЕГДА acquire lock перед редактированием.
- ⚠️ Лок-stale при network drop: если клиент потерял соединение, его heartbeat не доходит → lock expires через 30s → другие клиенты разблокируются. На клиенте при reconnect — re-acquire lock'и.
- ⚠️ Committed month editing: попытка put после commit → Worker отвергает с 403. Frontend disable edit UI.
- ⚠️ Migration localStorage → server: при первом запуске после релиза — клиент видит локальную работу, отправляет на сервер с force flag. Решить как мерджить если на сервере уже есть данные за этот месяц от другого юзера.

---

## 10. Тестирование

После каждого этапа:
1. Manual: 2 Electron инстанса (один логин — основной аккаунт; второй — тестовый аккаунт)
2. Action в одном → проверить эффект во втором в течение 2 секунд
3. Edge cases:
   - Network drop во время редактирования → lock expires → UI разблокирован
   - Параллельный PUT в conflict-окно → один из клиентов получает 409 → re-fetch
   - Browser refresh во время open lock → unmount triggers release → lock убирается

---

## 11. Миграция localStorage → server (на этапе A)

❗ Сейчас у юзеров уже есть LOCAL state в `localStorage`:
- `pyn:schedule:v1` — текущий рабочий буфер
- `pyn:schedule:months:v1` — архив снапшотов `{ "YYYY-MM": ScheduleState }`
- Внутри ScheduleState уже есть `meta.commit` (кто/когда зафиксировал) — это **локальные** фиксации, **не на сервере**.

**Алгоритм миграции** (выполняется один раз на первый mount раздела «График» после релиза):

1. Клиент читает `pyn:schedule:months:v1` из localStorage
2. Для каждой записи `[YYYY-MM, state]`:
   a. GET `/schedule/get?year=Y&month=M` — есть ли уже на сервере?
   b. Если на сервере **пусто** → POST `/schedule/put` с локальным state, version=1
   c. Если на сервере **есть** → **server wins**, локальный snapshot отбрасывается (на сервере уже могут быть данные от другого пользователя). Показать toast «Локальный график за {month} был отброшен — на сервере свежее»
   d. Если у локального snapshot есть `meta.commit` → дополнительно POST `/schedule/commit` после успешного put
3. После миграции: записать в localStorage флаг `pyn:schedule:migrated=true` чтобы не повторять
4. При успехе всех записей → УДАЛИТЬ `pyn:schedule:months:v1` и `pyn:schedule:v1` из localStorage (чистим, чтобы не висели stale-данные)

⚠️ Edge: если миграция упала на любой записи → НЕ удалять localStorage, retry на следующий mount. Если не получается — sentry/error log + кнопка «Re-try migration» в Settings.

---

## 12. Auto-save с debounce (как избежать спама PUT'ов)

Текущий код (после редактирования через server-sync должен быть заменён):
```ts
useEffect(() => {
  // saves to localStorage AND archive on EVERY state change
}, [state]);
```
Это даст ~1 PUT на keystroke если оставить как есть.

**Новый паттерн**:
- В `useScheduleState(year, month)` hook: при `setState(...)` запускать `debouncedPUT(state)` с задержкой 500ms (lodash.debounce или ручной setTimeout)
- При unmount раздела или смене месяца — `flush()` debounced PUT (немедленный сейв)
- При смене month → отменить pending debounce, сразу залить текущий state (для прошлого month) + загрузить новый
- Network failure → exponential retry (1s → 2s → 4s → 8s, max 5 attempts), потом показать «Не сохранено» toast + button retry

⚠️ Lock acquire/release **не debounce**ить — мгновенно. WS heartbeat — раз в 10s фиксированно.

---

## 13. Read-only UI для committed месяцев

Когда `schedule_state.committed === 1`:
- **Все edit-кнопки** disabled visually + cursor not-allowed:
  - «Исключения» / «Зафиксировать» / Holidays calendar / month-year picker (можно ТОЛЬКО листать, но не менять)
  - «Редактировать» в МОЛ карточке — disabled (для committed месяца ничего не меняем; **но базу складов меняем — она per-warehouse, не per-month**)
  - PersonEditor для approver / deputy — disabled
- В углу sheet'а (под proba-verstka) — большая plain-надпись «🔒 Зафиксировал {user_name} · {date}»
- **PDF / Print** — РАЗРЕШЕНЫ (просмотр + печать всегда доступны)

⚠️ Тонкость: МОЛ карточки склада живут отдельно от месячных state'ов. Изменение `is_removed`/`cluster`/`delivery_day` в МОЛ ВЛИЯЕТ только на ТЕКУЩИЙ + БУДУЩИЕ месяцы (committed месяцы — их snapshot уже зафиксирован и не пересчитывается). См. секцию 14.

---

## 14. Connection между warehouses store и месячным snapshot'ом

**Сейчас** клиент derive'ит shops для current month из warehouses store на лету (`useWarehousesStore((s) => s.warehouses)`). Для архивных/committed месяцев берёт `state.shops` из снапшота.

**После server-sync**:
- При PUT с состоянием месяца — клиент **сериализует** текущий derived shops в `state_json` (то что показывается сейчас) **И** override config (`meta.overrides` + `meta.holidays` + …)
- Когда другой клиент GET-ает этот месяц → видит ровно те `shops` (включая текущие warehouse data) + meta
- Если warehouse data ИЗМЕНИЛАСЬ (другой юзер удалил склад через МОЛ) → нужен пересчёт. Решение:
  - Committed месяц: state_json замораживается, warehouse changes НЕ влияют (snapshot вечен)
  - Non-committed месяц: server при GET может derive'ить shops on-the-fly из warehouses + meta. Простой подход — сохраняем raw `meta + overrides`, shops derive в client'е.
- **Рекомендуемая модель**: state_json = `{ meta, overrides, removedWarehouses, shippingWarehouses, shopsSnapshot? }`. `shopsSnapshot` пишется только при commit (заморозка). До commit'а — клиент derive'ит каждый раз из warehouses store. На сервере храним и то и другое.

```ts
interface ServerScheduleState {
  meta: ScheduleMeta;  // holidays, overrides, approver, deputy, year, month, commit?
  // Эти поля derive'ятся из warehouses store до commit'а, заморожены после:
  shopsFrozen?: ScheduleShop[];        // null/undefined до commit
  removedFrozen?: WarehouseCode[];     // null/undefined до commit
  shippingFrozen?: WarehouseCode[];    // null/undefined до commit
}
```

На client'е при `useScheduleState`:
- Если `committed === 1` → используй `shopsFrozen` / `removedFrozen` / `shippingFrozen`
- Иначе → derive из warehouses store + filter по `is_removed` / `is_shipping`

---

## 15. Avatar + user metadata для lock-overlay

Когда другой юзер acquire lock → нужно показать его аватарку и имя в overlay.

**Источник**:
- При acquire lock сервер сохраняет в `schedule_edit_lock` колонки `user_full_name`, `user_avatar_url`, `user_avatar_blob_key`, `user_avatar_blob_nonce` (берёт из session metadata)
- WS event `schedule_lock_acquired` несёт payload `{ resource_id, user_id, full_name, avatar_url, avatar_blob_key, avatar_blob_nonce }`
- Клиент рендерит overlay с этими данными — использует существующий `<Avatar>` компонент с поддержкой blob-decrypt (см. `apps/desktop/src/lib/avatar.ts` + `blob-bridge`)
- Если avatar отсутствует → fallback на initials (computeInitials helper)

---

## 16. Initial seed (когда сервер пуст)

После первого деплоя D1 пуста.

**Не нужно** пред-сидить `schedule_state` — клиент при GET пустого месяца получит 404 / `null` → создаст новый state на client'е (с дефолтами `INITIAL_SCHEDULE.meta`) и пушнёт через PUT при первой modification. Юзер начинает с пустого месяца, наполняет, авто-save.

**Нужно** пред-сидить `base_update_status` (singleton row с `is_updating=0`).

**Warehouse base** — отдельная задача (см. `db/warehouses/`), сидится через `wrangler d1 execute pyn-base --file=db/warehouses/seed.sql`.

---

## 17. Admin escape hatches

- **Force release lock**: admin endpoint `POST /admin/lock/force-release { resource_id }` — пробросить через wrangler или secret admin panel. Triggers WS `schedule_lock_released` всем.
- **Uncommit месяц** (если случайно зафиксировали): `POST /admin/schedule/uncommit { year, month }` — set `committed=0`, clear `committed_by`/`committed_at`. WS broadcast `schedule_state_changed`. Доступно ТОЛЬКО для роли admin/superadmin.
- **Force migrate** localStorage: кнопка в Settings → «Re-sync schedule from localStorage» (на случай если auto-migration упала).

---

## КАК ЗАПУСТИТЬ НОВЫЙ ЧАТ — ТЕКСТ ДЛЯ ВСТАВКИ

Скопируй в новый чат:

> Проект: Pyn Desktop в `/Users/jon/StudioProjects/Pyn`. Stack: Electron + React + Vite + Cloudflare Worker + D1.
>
> Задача: реализовать server-sync + collaboration locks для раздела «График» (бывшая Проба) согласно TZ в файле `HELPERS/TZ_server_sync_collab.md`. Сделать ПОЭТАПНО (этапы A→F), с верификацией после каждого. На каждом этапе показать результат двух Electron-инстансов: action в одном → эффект во втором.
>
> Текущее состояние: график живёт в `localStorage` (per-month archive + commits локальные). Нужно перенести на сервер с сохранением уже зафиксированных юзером месяцев (миграция, см. секцию 11 в TZ).
>
> Параллельно — глобальный механизм обновления базы складов (warehouses): когда админ запускает import, все клиенты видят overlay с аватаркой + «Идёт обновление», все кнопки edit становятся серые. Когда месяц committed — карточка с большим «🔒 Зафиксировал {user} · {date}», все edit-кнопки disabled (печать/PDF доступны).
>
> Полный TZ + детальная архитектура + D1 schema + endpoints + WS events + UI overlay компоненты + поэтапный план + checklist verification + performance requirements + миграция localStorage + read-only UI + avatar для locks + admin escape hatches: `HELPERS/TZ_server_sync_collab.md`. **ОБЯЗАТЕЛЬНО прочитать TZ ПОЛНОСТЬЮ перед началом** (17 секций).
>
> Ключевые моменты на которые обратить внимание:
> - **Семантика overrides**: `days: []` = «нет фильтра» (склад на всех natural-днях), непустой `days` = «склад только на этих днях». Reset при смене месяца → days: [].
> - **Connection между warehouses store и месячным snapshot'ом** — см. секцию 14. До commit'а — derive shops on-the-fly из warehouses store. На commit — заморозка `shopsFrozen` + `removedFrozen` + `shippingFrozen`.
> - **Миграция localStorage**: server wins при конфликте, локальные коммиты пушим через POST /commit после put.
> - **Performance** (секция 8 + 12): CF free tier 100k req/day. Auto-save debounce 500ms, WS heartbeat 10s только пока popover открыт, lock cleanup cron 1/min.
>
> Memory notes которые нужны: `project_network_topology.md` (как идут запросы), `project_realtime_base_updates.md` (паттерн WS base_changed), `feedback_no_server_polling.md` (правило), `project_pdf_print_canonical.md` (PDF flow не ломать).
>
> Стартуй с этапа A (D1 schema + GET/PUT без локов + миграция localStorage). После завершения — verify локально (2 инстанса, у одного есть localStorage снапшоты, у второго чисто) и спроси разрешение перейти к этапу B.

