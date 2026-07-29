import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState, type ComponentProps } from 'react';
import { CompactSelection, DataEditor, type DataEditorRef, type GridSelection } from '@glideapps/glide-data-grid';
import { colZeroRowSelection } from './flow-grid-selection';

/**
 * FlowGridEditor — изолированная «быстрая» обёртка над Glide `<DataEditor>`.
 *
 * ЗАЧЕМ (Фаза 1 «убить лаги»): раньше `gridSelection` жил в state РОДИТЕЛЯ (лист —
 * 3000+ строк, десятки useState/useMemo). Glide-у нужна ЖИВАЯ выделенная область,
 * поэтому `onGridSelectionChange`→`setSelection` срабатывал на КАЖДЫЙ tick мыши при
 * протяжке и перерисовывал весь гигантский компонент (даже в Отчёте с одним днём —
 * лаг был от стоимости ре-рендера, не от числа строк).
 *
 * Здесь selection держится ВНУТРИ этой маленькой обёртки → протяжка перерисовывает
 * только её, а не родителя. Родитель узнаёт о выделении через СТАБИЛЬНЫЙ колбэк
 * `onSelectionChange` (пишет в свой ref + обновляет лёгкий счётчик), а меняет
 * выделение императивно через ref-handle (`setSelection`) — для поиска, очистки
 * после заливки/удаления и т.п. Так все действия (заливка/копирование/удаление/
 * вставка) читают выделение из ref БЕЗ подписки на ре-рендер.
 *
 * `gridRef` прокидывается как проп (тот же объект, что был у родителя) — поиск и
 * `updateCells` продолжают работать без изменений.
 */

export const EMPTY_GRID_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
  current: undefined,
};

export interface FlowGridEditorHandle {
  /** Задать выделение извне (поиск-переход, очистка). Обновляет и родительский ref. */
  setSelection: (sel: GridSelection) => void;
}

type DataEditorProps = ComponentProps<typeof DataEditor>;

export interface FlowGridEditorProps
  extends Omit<DataEditorProps, 'gridSelection' | 'onGridSelectionChange' | 'ref'> {
  /** Ссылка на сам DataEditor (для scrollTo/updateCells из родителя — напр. поиск). */
  gridRef?: React.MutableRefObject<DataEditorRef | null>;
  /**
   * Вызывается после КАЖДОГО изменения выделения. ДЕРЖАТЬ СТАБИЛЬНЫМ (useCallback []),
   * иначе протяжка снова начнёт ре-рендерить родителя.
   */
  onSelectionChange?: (sel: GridSelection) => void;
  /** Протяжка по колонке-0 → выделение целых строк (поведение План/Отчёт). */
  colZeroRowSelect?: boolean;
  /**
   * Преобразовать выделение ДО применения (напр. Формирование: колонка CLST →
   * целые строки, но только OFF). Читается через ref — стабильность не критична,
   * но колбэк не должен трогать state родителя (только refs).
   */
  transformSelection?: (sel: GridSelection) => GridSelection;
}

export const FlowGridEditor = memo(
  forwardRef<FlowGridEditorHandle, FlowGridEditorProps>(function FlowGridEditor(
    { gridRef, onSelectionChange, colZeroRowSelect, transformSelection, ...editorProps },
    ref,
  ) {
    const [selection, setSelection] = useState<GridSelection>(EMPTY_GRID_SELECTION);

    // onSelectionChange/transformSelection через ref — колбэки остаются стабильными
    // (apply не пересоздаётся), даже если родитель передал новую ссылку.
    const changeCb = useRef(onSelectionChange);
    changeCb.current = onSelectionChange;
    const transformCb = useRef(transformSelection);
    transformCb.current = transformSelection;

    const apply = useCallback((sel: GridSelection) => {
      setSelection(sel);
      changeCb.current?.(sel);
    }, []);

    useImperativeHandle(ref, () => ({ setSelection: apply }), [apply]);

    // Мост к родительскому gridRef через callback-ref (обходит несовпадение
    // nullable-типов ref у DataEditor и сохраняет стабильность — gridRef стабилен).
    const setGridRef = useCallback(
      (inst: DataEditorRef | null) => {
        if (gridRef) gridRef.current = inst;
      },
      [gridRef],
    );

    return (
      <DataEditor
        {...editorProps}
        // Юзер 2026-07-26: провал в ячейку / редактор только по двойному клику
        // (не single-click). Enter/type по-прежнему активируют.
        cellActivationBehavior={editorProps.cellActivationBehavior ?? 'double-click'}
        ref={setGridRef}
        gridSelection={selection}
        onGridSelectionChange={(sel) => {
          if (colZeroRowSelect) {
            // Протяжка по первой колонке → выделение строк. СОХРАНЯЕМ current, иначе Glide
            // теряет активную протяжку и выделяется только одна строка (юзер 2026-06-15).
            const rowsSel = colZeroRowSelection(sel);
            apply(rowsSel ? { ...rowsSel, current: sel.current } : sel);
          } else {
            const t = transformCb.current;
            apply(t ? t(sel) : sel);
          }
        }}
      />
    );
  }),
);
