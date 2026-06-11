import { useState } from 'react';
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
  /** Разрешить СВОЙ текст: сверху поле ввода (Enter коммитит, печать фильтрует
   *  список). Для колонок «выбери из частых ИЛИ напиши своё» (РАБОТА транспорта). */
  readonly allowCustom?: boolean;
}

export type FlowDropdownCell = CustomCell<FlowDropdownData>;

/** Редактор-список опций в стиле меню колонки (+опц. свой ввод сверху). */
function FlowDropdownEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDropdownCell;
  onFinishedEditing: (newValue?: FlowDropdownCell) => void;
}) {
  const { options, value, allowCustom } = cell.data;
  const [query, setQuery] = useState('');
  const commit = (v: string) => onFinishedEditing({ ...cell, data: { ...cell.data, value: v } });
  // Свой ввод фильтрует список (как поиск); Enter коммитит набранный текст.
  const q = query.trim().toLowerCase();
  const shown = allowCustom && q !== '' ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  // Прозрачный список: хром (тёмный фон, 12px скругление, тень, рамка, padding)
  // даёт КОНТЕЙНЕР оверлея через styleOverride ниже — иначе скруглённый поповер
  // сидел бы на квадратной светлой подложке контейнера Glide.
  return (
    <div className="flex max-h-[320px] w-full flex-col text-text-secondary">
      {allowCustom && (
        <input
          autoFocus
          defaultValue={value}
          placeholder="Своя работа… (Enter)"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value.trim());
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onFinishedEditing(undefined);
            }
            e.stopPropagation();
          }}
          className="mx-1 mb-1 h-7 shrink-0 rounded-md border border-white/10 bg-transparent px-2 text-[12px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-accent-clay/60"
        />
      )}
      <div className="flex min-h-0 flex-col overflow-y-auto">
        {shown.map((o) => {
          const selected = o === value;
          return (
            <button
              type="button"
              key={o}
              onClick={() => commit(o)}
              className={cn(
                // Без галочки — выбранный просто подсвечен clay (компактнее).
                'w-full shrink-0 truncate rounded px-2 py-1 text-left text-[12px] transition-colors',
                selected ? 'bg-accent-clay/25 text-text-strong' : 'text-text-primary hover:bg-accent-clay/20',
              )}
            >
              {o === '' ? '(пусто)' : o}
            </button>
          );
        })}
      </div>
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
