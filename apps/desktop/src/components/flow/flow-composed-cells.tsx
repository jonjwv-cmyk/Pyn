import { GridCellKind, type CustomCell, type CustomRenderer } from '@glideapps/glide-data-grid';

/**
 * Составная ячейка «Потока»: основное (тёмное) + вторичное (приглушённое) в одной
 * колонке — ЗАКАЗ (заказ|поз), КГ/V, %, TIME (часики), МОЛ (ФИО в цветной пилюле),
 * DAY (NEW/OFF/дата), MAT (⚠ ручной + название). Только показ. Подробности — в
 * карточке/подсказке при наведении. Стрелка раскрытия (▾) — ТОЛЬКО на hover.
 */
export interface FlowTwoData {
  readonly kind: 'flow-two';
  readonly primary: string;
  readonly secondary: string;
  /** Значок слева: часики (TIME) или ⚠ ручного заказа (MAT). */
  readonly icon?: 'clock' | 'warn';
  /** Цвет статус-точки слева (DAY). */
  readonly dot?: string;
  /** Цвет «пилюли» под основным текстом (МОЛ — по статусу). */
  readonly pill?: string;
  /** Колонка с раскрытием — на hover рисуем ▾ (как в заголовке). */
  readonly expand?: boolean;
  /** Жирный основной текст (колонка %). */
  readonly bold?: boolean;
  /** Разделитель вторичного текста на фиксированном x (ЗАКАЗ «|поз» ровно). */
  readonly alignSep?: boolean;
}
export type FlowTwoCell = CustomCell<FlowTwoData>;

/** Маленькие часики (кружок + 2 стрелки) — аффорданс «время, наведи». */
function drawClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - 2.8);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + 2.6, cy + 0.8);
  ctx.stroke();
  ctx.restore();
}

export const flowTwoToneRenderer: CustomRenderer<FlowTwoCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FlowTwoCell =>
    typeof c.data === 'object' &&
    c.data !== null &&
    (c.data as { kind?: unknown }).kind === 'flow-two',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { primary, secondary, icon, dot, pill, bold, alignSep } = cell.data;
    const padX = theme.cellHorizontalPadding;
    const cy = rect.y + rect.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.font = `${bold ? '600 ' : ''}${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    let x = rect.x + padX;
    if (icon === 'clock') {
      drawClock(ctx, x + 5, cy, theme.textLight);
      x += 15;
    } else if (icon === 'warn') {
      ctx.fillStyle = '#E3873A';
      ctx.fillText('⚠', x, cy);
      x += ctx.measureText('⚠').width + 4;
    } else if (dot) {
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(x + 3.5, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      x += 13;
    }
    if (pill && primary) {
      // Пилюля по статусу: тонкий фон + точка слева + ФИО внутри.
      const tw = ctx.measureText(primary).width;
      const padP = 5;
      const dotR = 3;
      const ph = Math.min(rect.height - 6, 18);
      const pw = padP + dotR * 2 + 4 + tw + padP;
      const py = cy - ph / 2;
      ctx.fillStyle = pill + '2E'; // ~18% alpha (#RRGGBBAA)
      ctx.beginPath();
      ctx.roundRect(x, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = pill;
      ctx.beginPath();
      ctx.arc(x + padP + dotR, cy, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.textDark;
      ctx.fillText(primary, x + padP + dotR * 2 + 4, cy);
      x += pw + 5;
    } else if (primary) {
      ctx.fillStyle = theme.textDark;
      ctx.fillText(primary, x, cy);
      // alignSep — «|поз» на фиксированном x (ширина 10-значного заказа), чтобы
      // разделители стояли ровной линией друг под другом, а не шахматно.
      x = alignSep
        ? rect.x + padX + ctx.measureText('0000000000').width + 2
        : x + ctx.measureText(primary).width + 5;
    }
    if (secondary) {
      ctx.fillStyle = theme.textLight;
      ctx.fillText(secondary, x, cy);
    }
    ctx.restore();
    return true;
  },
};
