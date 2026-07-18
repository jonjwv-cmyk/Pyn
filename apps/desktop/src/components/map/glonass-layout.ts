/**
 * Геометрия панели Глонасс: пилл под «В движении 999 км/ч»,
 * колонка ФИО по самому длинному водителю, погода сдвигается синхронно.
 */

const PANEL_LEFT = 12; // left-3
const WEATHER_GAP = 10;
const COL_ACTIONS = 28;
const COL_GAP = 6;
// Список: свой px-1.5 (12) + строка px-1.5 (12) + бордер (2) + вертикальный
// скроллбар (~12). Иначе фикс-колонки не влезают → горизонтальный вылет/«скролл едет».
const PANEL_PAD_X = 40;

const MIN_PANEL = 320;
/** Шире — полное ФИО (Фамилия Имя Отчество) без обрезки «странно». */
const MAX_PANEL = 680;
const MIN_FIO = 140;
const MAX_FIO = 420;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function measure(text: string, font: string): number {
  if (!text) return 0;
  if (typeof document === 'undefined') {
    return Math.ceil(text.length * (font.includes('mono') ? 7.2 : 6.6));
  }
  if (measureCtx === undefined) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  if (!measureCtx) return Math.ceil(text.length * 7);
  measureCtx.font = font;
  return Math.ceil(measureCtx.measureText(text).width);
}

/** Эталон: самый длинный статус + max скорость — должны влезть в 1 строку пилла. */
export const GLONASS_STATUS_SAMPLE = 'В движении 999 км/ч';

export type GlonassLayout = {
  panelWidth: number;
  pillWidth: number;
  fioWidth: number;
  weatherLeft: number;
  rowHeight: number;
};

const DEFAULT_LAYOUT: GlonassLayout = {
  panelWidth: 360,
  pillWidth: 128,
  fioWidth: 150,
  weatherLeft: PANEL_LEFT + 360 + WEATHER_GAP,
  rowHeight: 42,
};

export function computeGlonassLayout(drivers: readonly string[]): GlonassLayout {
  // Пилл: status line + pad (не переносим «В движении 999 км/ч»)
  const statusW = measure(GLONASS_STATUS_SAMPLE, '600 10.5px system-ui, -apple-system, sans-serif');
  const garageW = measure('9999', '700 12px ui-monospace, SFMono-Regular, Menlo, monospace');
  // гаражный + небольшой тип рядом
  const line1Min = garageW + 6 + 36;
  const pillWidth = Math.max(statusW, line1Min) + 14; // px-1.5*2

  let maxFio = MIN_FIO;
  for (const d of drivers) {
    const t = String(d || '').trim();
    if (!t) continue;
    const w = measure(t, '500 12px system-ui, -apple-system, sans-serif') + 4;
    if (w > maxFio) maxFio = w;
  }
  // типовой гос + марка на 2-й строке (не уже чем ФИО min)
  const sampleGosBrand = measure('Т 955 РК КамАЗ', '600 11.5px system-ui, sans-serif');
  // fioWidth = реальное max ФИО (cap MAX_FIO); панель под него, без clamp mid-word
  const fioWidth = Math.min(MAX_FIO, Math.max(MIN_FIO, maxFio, sampleGosBrand));

  const panelWidth = Math.min(
    MAX_PANEL,
    Math.max(MIN_PANEL, Math.ceil(PANEL_PAD_X + pillWidth + COL_GAP + fioWidth + COL_GAP + COL_ACTIONS)),
  );

  return {
    panelWidth,
    pillWidth,
    fioWidth,
    weatherLeft: PANEL_LEFT + panelWidth + WEATHER_GAP,
    rowHeight: 42,
  };
}

export function defaultGlonassLayout(): GlonassLayout {
  return { ...DEFAULT_LAYOUT };
}
