import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type {
  ScheduleRow,
  ScheduleShop,
  WarehouseCode,
  Weekday,
} from '@/lib/schedule/types';
import { WeekdayPicker } from './WeekdayPicker';

const WEEKDAY_ORDER: Record<Weekday, number> = {
  ПН: 0, ВТ: 1, СР: 2, ЧТ: 3, ПТ: 4, СБ: 5, ВС: 6,
};

interface ShopWarehousesEditorProps {
  shop: ScheduleShop;
  onUpdate: (shop: ScheduleShop) => void;
  children: React.ReactNode;
}

interface WarehouseWithDay {
  warehouse: WarehouseCode;
  weekday: Weekday;
}

/**
 * Popover-редактор: показывает все склады цеха flat-списком с picker'ом
 * дня недели рядом с каждым. Смена дня → склад уезжает в соответствующую
 * строку (создаётся если не было) и сортируется по возрастанию кода.
 * Пустые row'ы удаляются автоматом. Add/remove складов сейчас не делаем —
 * полный реестр придёт из большой таблицы позже.
 */
export function ShopWarehousesEditor({
  shop,
  onUpdate,
  children,
}: ShopWarehousesEditorProps) {
  const allWarehouses: WarehouseWithDay[] = useMemo(() => {
    const out: WarehouseWithDay[] = [];
    for (const row of shop.rows) {
      for (const w of row.warehouses) {
        out.push({ warehouse: w, weekday: row.weekday });
      }
    }
    out.sort((a, b) =>
      a.warehouse.code.localeCompare(b.warehouse.code, 'ru', { numeric: true }),
    );
    return out;
  }, [shop.rows]);

  const moveWarehouseToDay = (
    warehouseCode: string,
    currentWeekday: Weekday,
    newWeekday: Weekday,
  ) => {
    if (currentWeekday === newWeekday) return;

    // Найдём перемещаемый склад
    const sourceRow = shop.rows.find((r) => r.weekday === currentWeekday);
    const movedWarehouse = sourceRow?.warehouses.find(
      (w) => w.code === warehouseCode,
    );
    if (!movedWarehouse) return;

    // Удалим из старого row, выкинем пустые row'ы
    let updatedRows: ScheduleRow[] = shop.rows
      .map((r) =>
        r.weekday === currentWeekday
          ? { ...r, warehouses: r.warehouses.filter((w) => w.code !== warehouseCode) }
          : r,
      )
      .filter((r) => r.warehouses.length > 0);

    // Добавим в новый row (если есть) или создадим новый
    const targetRowExists = updatedRows.find((r) => r.weekday === newWeekday);
    if (targetRowExists) {
      updatedRows = updatedRows.map((r) =>
        r.weekday === newWeekday
          ? {
              ...r,
              warehouses: [...r.warehouses, movedWarehouse].sort((a, b) =>
                a.code.localeCompare(b.code, 'ru', { numeric: true }),
              ),
            }
          : r,
      );
    } else {
      const newRow: ScheduleRow = {
        id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        weekday: newWeekday,
        warehouses: [movedWarehouse],
      };
      updatedRows = [...updatedRows, newRow];
    }

    // Sort rows by weekday order
    updatedRows.sort(
      (a, b) => WEEKDAY_ORDER[a.weekday] - WEEKDAY_ORDER[b.weekday],
    );

    onUpdate({ ...shop, rows: updatedRows });
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[340px] rounded-lg border border-white/[0.08] bg-bg-elevated p-3 text-text-primary shadow-2xl outline-none"
        >
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <div className="text-[12px] font-medium text-text-strong">
              Склады цеха
            </div>
            <div className="text-[10px] tabular-nums text-text-muted">
              {allWarehouses.length}
            </div>
          </div>

          <div className="mb-2 text-[10.5px] text-text-muted">{shop.name}</div>

          {allWarehouses.length === 0 ? (
            <div className="rounded bg-white/[0.03] px-2 py-3 text-center text-[11px] italic text-text-muted">
              У цеха нет складов
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto pr-0.5">
              <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
                {allWarehouses.map(({ warehouse, weekday }) => (
                  <div
                    key={`${warehouse.code}-${weekday}`}
                    className="contents"
                  >
                    <span className="flex h-7 items-center rounded px-2 font-mono text-[11.5px] tabular-nums text-text-primary transition-colors hover:bg-white/[0.04]">
                      {warehouse.code}
                    </span>
                    <WeekdayPicker
                      value={weekday}
                      onChange={(newWd) =>
                        moveWarehouseToDay(warehouse.code, weekday, newWd)
                      }
                    >
                      <button
                        type="button"
                        className="h-7 w-9 rounded bg-white/[0.04] text-[11px] font-semibold text-text-primary outline-none transition-colors hover:bg-white/[0.08] data-[state=open]:bg-accent-clay-bg data-[state=open]:text-accent-clay data-[state=open]:ring-1 data-[state=open]:ring-inset data-[state=open]:ring-accent-clay/40"
                        title="Сменить день недели"
                      >
                        {weekday}
                      </button>
                    </WeekdayPicker>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Popover.Arrow className="fill-bg-elevated" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
