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
  /** Подписи пунктов (параллельно options): в списке «уровень 1», в ячейке «1».
   *  Не задано — показываем сами значения. */
  readonly labels?: readonly string[];
  /** Разрешить СВОЙ текст: сверху поле ввода (Enter коммитит, печать фильтрует
   *  список). Для колонок «выбери из частых ИЛИ напиши своё» (РАБОТА транспорта). */
  readonly allowCustom?: boolean;
  /** МУЛЬТИВЫБОР: значение = выбранные опции через `\n`, до `maxSelected` штук
   *  (ТИП ТС: БОРТ/ПУЛЬМАН/ФУРГОН/ГАЗЕЛЬ — наш маркер кузова, до 3). */
  readonly multi?: boolean;
  readonly maxSelected?: number;
}

/** Мульти-редактор (ТИП ТС): чек-лист опций, локальный набор → «Готово» коммитит. */
function FlowMultiEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDropdownCell;
  onFinishedEditing: (newValue?: FlowDropdownCell) => void;
}) {
  const { options, value, maxSelected = 3 } = cell.data;
  const [picked, setPicked] = useState<string[]>(() =>
    value.split('\n').map((s) => s.trim()).filter(Boolean),
  );
  const commit = (items: readonly string[]) =>
    onFinishedEditing({ ...cell, data: { ...cell.data, value: items.join('\n') } });
  const toggle = (o: string) =>
    setPicked((prev) =>
      prev.includes(o) ? prev.filter((x) => x !== o) : prev.length >= maxSelected ? prev : [...prev, o],
    );
  return (
    <div className="flex w-56 flex-col text-text-secondary">
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-text-muted">
        <span className="tabular-nums">{picked.length}/{maxSelected}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => commit([])}
            className="rounded border border-white/10 px-1.5 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-text-strong"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={() => commit(picked)}
            className="rounded border border-accent-clay/40 bg-accent-clay/20 px-1.5 py-0.5 text-text-strong transition-colors hover:bg-accent-clay/30"
          >
            Готово
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto">
        {options.map((o) => {
          const selected = picked.includes(o);
          return (
            <button
              type="button"
              key={o}
              onClick={() => toggle(o)}
              className={cn(
                'flex w-full shrink-0 items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors',
                selected ? 'bg-accent-clay/25 text-text-strong' : 'text-text-primary hover:bg-accent-clay/20',
              )}
            >
              <span className={cn('inline-block h-3 w-3 shrink-0 rounded-sm border', selected ? 'border-accent-clay bg-accent-clay/70' : 'border-white/25')} />
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
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
  const { options, value, labels, allowCustom } = cell.data;
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
          const label = labels?.[options.indexOf(o)] ?? o;
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
              {label === '' ? '(пусто)' : label}
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
    // Без стрелки — раскрытие двойным кликом (как в Google Sheets). В multi-режиме
    // значения через `\n` показываем в одну строку через запятую.
    const v = cell.data.value ?? '';
    drawTextCell(args, cell.data.multi ? v.replace(/\n/g, ', ') : v, cell.contentAlign);
    return true;
  },
  provideEditor: (cell) => ({
    editor: cell.data.multi ? FlowMultiEditor : FlowDropdownEditor,
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
