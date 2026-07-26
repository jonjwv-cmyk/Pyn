import { useState } from 'react';
import {
  drawTextCell,
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
} from '@glideapps/glide-data-grid';
import { cn } from '@/lib/cn';
import { useFlipUpIfClipped } from './flow-cell-flip';

/**
 * Своя ячейка-выпадашка для раздела «Поток». Редактор оформлен КАК МЕНЮ КОЛОНКИ
 * (`FlowHeaderMenu`): тёмный поповер, clay-hover, галка у выбранного — а не
 * дефолтный react-select из пакета доп-ячеек (он не вписывался в стиль).
 *
 * Ячейка на canvas рисуется как текст значения + маленький ▾ справа; клик
 * открывает список опций в нашем стиле, выбор коммитит значение.
 */

/** Ветка раскрывающегося меню (STAT: АТУ / склад / цех / экспедиция). */
export interface FlowDropdownGroup {
  /** id узла; для листа без children — это и есть commit value. */
  readonly id: string;
  readonly label: string;
  /** Есть children → пункт только раскрывает, не коммитит. */
  readonly children?: readonly { value: string; label: string }[];
}

export interface FlowDropdownData {
  readonly kind: 'flow-dropdown';
  readonly value: string;
  /** Canvas-only text; editor still receives the full `value`. */
  readonly displayValue?: string;
  readonly options: readonly string[];
  /** Подписи пунктов (параллельно options): в списке «уровень 1», в ячейке «1».
   *  Не задано — показываем сами значения. */
  readonly labels?: readonly string[];
  /**
   * Иерархия: пункты с children раскрываются (▸ / ▾), подпункты коммитят value.
   * Если задано — рисуем groups вместо плоского options (options можно оставить
   * для paste/валидации).
   */
  readonly groups?: readonly FlowDropdownGroup[];
  /** Разрешить СВОЙ текст: сверху поле ввода (Enter коммитит, печать фильтрует
   *  список). Для колонок «выбери из частых ИЛИ напиши своё» (РАБОТА транспорта). */
  readonly allowCustom?: boolean;
  /** МУЛЬТИВЫБОР: значение = выбранные опции через `\n`, до `maxSelected` штук
   *  (ТИП ТС: БОРТ/ПУЛЬМАН/ФУРГОН/ГАЗЕЛЬ — наш маркер кузова, до 3). */
  readonly multi?: boolean;
  readonly maxSelected?: number;
}

/** Мульти-редактор (ТИП ТС): клик копит выбор без закрытия, коммит — кликом вне окна. */
function FlowMultiEditor({
  value: cell,
  onChange,
  onFinishedEditing,
}: {
  value: FlowDropdownCell;
  onChange?: (newValue: FlowDropdownCell) => void;
  onFinishedEditing: (newValue?: FlowDropdownCell) => void;
}) {
  void onFinishedEditing; // закрытие делает Glide (клик вне / Escape)
  const { options, value, maxSelected = 3 } = cell.data;
  const picked = value.split('\n').map((s) => s.trim()).filter(Boolean);
  // БЕЗ кнопки «Готово» (юзер 2026-07-04): клик выбрал / повторный снял; окно НЕ
  // закрываем — можно выбрать ещё (onChange копит temp-значение Glide, коммит — кликом
  // ВНЕ окна, Escape — отмена). Как у МОЛ, без галочек.
  const toggle = (o: string): void => {
    const next = picked.includes(o)
      ? picked.filter((x) => x !== o)
      : picked.length >= maxSelected
        ? picked
        : [...picked, o];
    onChange?.({ ...cell, data: { ...cell.data, value: next.join('\n') } });
  };
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  return (
    <div ref={flipRef} className="flex w-56 flex-col text-text-secondary">
      <div className="flex min-h-0 flex-col overflow-y-auto">
        {/* Выбранные ВВЕРХУ списка и подсвечены. */}
        {[...options]
          .sort((a, b) => (picked.includes(b) ? 1 : 0) - (picked.includes(a) ? 1 : 0))
          .map((o) => {
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
                {o}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export type FlowDropdownCell = CustomCell<FlowDropdownData>;

/** Редактор-список опций в стиле меню колонки (+опц. свой ввод / иерархия groups). */
function FlowDropdownEditor({
  value: cell,
  onFinishedEditing,
}: {
  value: FlowDropdownCell;
  onFinishedEditing: (newValue?: FlowDropdownCell) => void;
}) {
  const { options, value, labels, allowCustom, groups } = cell.data;
  const [query, setQuery] = useState('');
  // Раскрытые ветки: по id группы. Авто-раскрыть ветку, где лежит текущее value.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => {
    const init = new Set<string>();
    if (groups && value) {
      for (const g of groups) {
        if (g.children?.some((c) => c.value === value || c.label === value)) init.add(g.id);
        // value вида «цех · отказ» → parent id «цех»
        if (value.startsWith(`${g.id} · `) || value === g.id) init.add(g.id);
      }
    }
    return init;
  });
  const commit = (v: string) => onFinishedEditing({ ...cell, data: { ...cell.data, value: v } });
  const toggleGroup = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Свой ввод фильтрует список (как поиск); Enter коммитит набранный текст.
  const q = query.trim().toLowerCase();
  const shown = allowCustom && q !== '' ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const flipRef = useFlipUpIfClipped<HTMLDivElement>();
  // Прозрачный список: хром (тёмный фон, 12px скругление, тень, рамка, padding)
  // даёт КОНТЕЙНЕР оверлея через styleOverride ниже — иначе скруглённый поповер
  // сидел бы на квадратной светлой подложке контейнера Glide.
  return (
    <div ref={flipRef} className="flex max-h-[320px] w-full min-w-[200px] flex-col text-text-secondary">
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
        {groups && groups.length > 0 && !(allowCustom && q !== '') ? (
          // Иерархия: листья коммитят; ветки (АТУ/склад/цех/экспедиция) — только раскрытие.
          groups.map((g) => {
            const hasKids = !!(g.children && g.children.length > 0);
            const open = openIds.has(g.id);
            const leafSelected = !hasKids && (g.id === value || g.label === value);
            const childSelected = hasKids && g.children!.some((c) => c.value === value);
            return (
              <div key={g.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => (hasKids ? toggleGroup(g.id) : commit(g.id))}
                  className={cn(
                    'flex w-full shrink-0 items-center gap-1 rounded px-2 py-1 text-left text-[12px] transition-colors',
                    leafSelected || childSelected
                      ? 'bg-accent-clay/25 text-text-strong'
                      : 'text-text-primary hover:bg-accent-clay/20',
                  )}
                >
                  {hasKids && (
                    <span className="w-3 shrink-0 text-[10px] text-text-muted" aria-hidden>
                      {open ? '▾' : '▸'}
                    </span>
                  )}
                  {!hasKids && <span className="w-3 shrink-0" aria-hidden />}
                  <span className="truncate font-medium">{g.label}</span>
                </button>
                {hasKids && open && (
                  <div className="mb-0.5 ml-2 flex flex-col border-l border-white/10 pl-1">
                    {g.children!.map((c) => {
                      const selected = c.value === value;
                      return (
                        <button
                          type="button"
                          key={c.value}
                          onClick={() => commit(c.value)}
                          className={cn(
                            'w-full shrink-0 truncate rounded px-2 py-1 text-left text-[12px] transition-colors',
                            selected
                              ? 'bg-accent-clay/25 text-text-strong'
                              : 'text-text-primary hover:bg-accent-clay/20',
                          )}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          shown.map((o) => {
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
          })
        )}
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
    // (тип ТС) КАЖДОЕ значение — СО СВОЕЙ СТРОКИ (юзер 2026-07-05), как экспедиторы.
    const v = cell.data.displayValue ?? cell.data.value ?? '';
    if (!cell.data.multi || !v.includes('\n')) {
      drawTextCell(args, v, cell.contentAlign);
      return true;
    }
    const { ctx, rect, theme } = args;
    const lines = v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textDark;
    const padX = theme.cellHorizontalPadding;
    const slot = Math.max(13, Math.min(17, rect.height / lines.length));
    const startY = rect.y + rect.height / 2 - ((lines.length - 1) * slot) / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i] ?? '', rect.x + padX, startY + i * slot, rect.width - padX * 2);
    }
    ctx.restore();
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
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, value: '', displayValue: '' } }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
