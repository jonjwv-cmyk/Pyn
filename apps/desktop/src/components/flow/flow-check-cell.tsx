import { useEffect } from 'react';
import {
  GridCellKind,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorCallback,
} from '@glideapps/glide-data-grid';

/**
 * Компактная галочка для Потока/Транспорта (вместо огромного Boolean Glide).
 * Canvas: квадрат 12×12, clay при включении; клик = мгновенный toggle (как Excel).
 */
export interface FlowCheckData {
  readonly kind: 'flow-check';
  readonly checked: boolean;
}
export type FlowCheckCell = CustomCell<FlowCheckData>;

const BOX = 12;
const CLAY = '#D97757';
const CLAY_DIM = 'rgba(217,119,87,0.85)';
const BORDER = 'rgba(0,0,0,0.28)';
const BORDER_HOVER = 'rgba(217,119,87,0.55)';

/** Мгновенный toggle при открытии оверлея (один клик = вкл/выкл). */
function FlowCheckEditor({
  value,
  onFinishedEditing,
}: {
  value: FlowCheckCell;
  onFinishedEditing: (newValue?: FlowCheckCell) => void;
}): null {
  // Пустые deps: только при mount оверлея (один клик → один toggle).
  useEffect(() => {
    const next = !value.data.checked;
    onFinishedEditing({
      ...value,
      // «НЕТ» — не пустая строка: иначе copy пустой галочки не попадает в буфер.
      copyData: next ? 'ДА' : 'НЕТ',
      data: { ...value.data, checked: next },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only toggle
  }, []);
  return null;
}

export const flowCheckRenderer: CustomRenderer<FlowCheckCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowCheckCell =>
    typeof c.data === 'object' && c.data !== null && (c.data as { kind?: unknown }).kind === 'flow-check',
  draw: (args, cell) => {
    const { ctx, rect, hoverAmount } = args;
    const on = cell.data.checked;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const x = Math.round(cx - BOX / 2);
    const y = Math.round(cy - BOX / 2);
    const r = 2.5;
    const hover = hoverAmount ?? 0;

    ctx.save();
    // фон квадрата
    ctx.beginPath();
    ctx.roundRect(x, y, BOX, BOX, r);
    if (on) {
      ctx.fillStyle = hover > 0.1 ? CLAY : CLAY_DIM;
      ctx.fill();
    } else {
      ctx.fillStyle = hover > 0.1 ? 'rgba(217,119,87,0.08)' : 'rgba(0,0,0,0.03)';
      ctx.fill();
      ctx.strokeStyle = hover > 0.1 ? BORDER_HOVER : BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // галочка
    if (on) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 2.5, y + BOX * 0.52);
      ctx.lineTo(x + BOX * 0.4, y + BOX - 3);
      ctx.lineTo(x + BOX - 2.5, y + 3);
      ctx.stroke();
    }
    ctx.restore();
    return true;
  },
  provideEditor: (() => ({
    editor: FlowCheckEditor,
    disablePadding: true,
    disableStyling: true,
    // невидимый оверлей — toggle сразу в useEffect
    styleOverride: {
      background: 'transparent',
      border: 'none',
      boxShadow: 'none',
      padding: 0,
      width: 1,
      height: 1,
      overflow: 'hidden',
    },
  })) as ProvideEditorCallback<FlowCheckCell>,
  onDelete: (cell) => ({
    ...cell,
    copyData: 'НЕТ',
    data: { ...cell.data, checked: false },
  }),
  onPaste: (v, d) => {
    const s = String(v ?? '').trim();
    // пусто / НЕТ / 0 → снять; ДА / 1 / ✓ → поставить
    const off = !s || /^(нет|no|0|false|off|-|☐|□)$/i.test(s);
    const on = !off && (/^(да|yes|1|true|on|✓|✔|x|х|v|☑)$/i.test(s) || s.toUpperCase() === 'ДА');
    return { ...d, checked: on };
  },
};
