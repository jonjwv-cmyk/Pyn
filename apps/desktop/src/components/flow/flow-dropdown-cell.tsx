import {
  drawTextCell,
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';

/**
 * Своя ячейка-выпадашка для раздела «Поток». Редактор оформлен КАК МЕНЮ КОЛОНКИ
 * (`FlowHeaderMenu`): тёмный поповер, clay-hover, галка у выбранного — а не
 * дефолтный react-select из пакета доп-ячеек (он не вписывался в стиль).
 *
 * Ячейка на canvas рисуется как текст значения + маленький ▾ справа; клик
 * открывает список опций в нашем стиле, выбор коммитит значение.
 */

export interface FlowDropdownData {
  readonly kind: 'flow-dropdown';
  readonly value: string;
  readonly options: readonly string[];
}

export type FlowDropdownCell = CustomCell<FlowDropdownData>;

/** Редактор-список опций в стиле меню колонки. */
function FlowDropdownEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDropdownCell;
  onFinishedEditing: (newValue?: FlowDropdownCell) => void;
}) {
  const { options, value } = cell.data;
  // Прозрачный список: хром (тёмный фон, 12px скругление, тень, рамка, padding)
  // даёт КОНТЕЙНЕР оверлея через styleOverride ниже — иначе скруглённый поповер
  // сидел бы на квадратной светлой подложке контейнера Glide.
  return (
    <div className="flex w-full flex-col text-text-secondary">
      {options.map((o) => {
        const selected = o === value;
        return (
          <button
            type="button"
            key={o}
            onClick={() => onFinishedEditing({ ...cell, data: { ...cell.data, value: o } })}
            className={cn(
              // Без галочки — выбранный просто подсвечен clay (компактнее).
              'w-full truncate rounded px-2 py-1 text-left text-[12px] transition-colors',
              selected ? 'bg-accent-clay/25 text-text-strong' : 'text-text-primary hover:bg-accent-clay/20',
            )}
          >
            {o === '' ? '(пусто)' : o}
          </button>
        );
      })}
    </div>
  );
}

/** Рендерер кастомной ячейки-выпадашки (значение + ▾ на canvas, наш редактор). */
export const flowDropdownRenderer: CustomRenderer<FlowDropdownCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowDropdownCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-dropdown',
  draw: (args, cell) => {
    // Без стрелки — раскрытие двойным кликом (как в Google Sheets).
    drawTextCell(args, cell.data.value ?? '', cell.contentAlign);
    return true;
  },
  provideEditor: () => ({
    editor: FlowDropdownEditor,
    disablePadding: true,
    disableStyling: true,
    // Оформляем САМ контейнер оверлея (он внешний — не клипается, тень снаружи,
    // скругление честное), чтобы поповер выглядел как меню колонки, без квадратной
    // подложки. Значения = токены темы (bg-elevated / border-subtle).
    styleOverride: {
      background: '#302F2D',
      border: '1px solid rgba(234,221,216,0.10)',
      borderRadius: '12px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
      padding: '4px',
    },
  }),
  // Delete на ячейке-выпадашке стирает значение (как в Excel) — без пункта «пусто».
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
